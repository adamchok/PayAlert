#!/usr/bin/env bash
# Full setup for payalert-portal-ec2 (Next.js audit portal).
# Automates DEPLOYMENT.md Steps 7.3 – 7.9. Safe to re-run (idempotent).
#
# Run on the instance via SSM Session Manager after running `bash`:
#
#   ACCOUNT_ID=123456789012 \
#   PORTAL_PASSWORD=YourStrongPassword \
#   GITHUB_USERNAME=your-github-username \
#   bash /opt/payalert-repo/scripts/setup-audit-portal-ec2.sh
#
# Required env vars:
#   ACCOUNT_ID       Your 12-digit AWS account ID
#   PORTAL_USERNAME  Username for the audit portal login
#   PORTAL_PASSWORD  Password for the audit portal login
#   GITHUB_USERNAME  GitHub username (SSH key must already be added to GitHub)
#
# Optional env vars:
#   ENVIRONMENT      Deployment environment suffix (default: dev) — controls table, queue, and DLQ names
#   DYNAMODB_TABLE   Override the auto-constructed DynamoDB table name (default: payalert-transactions-{ENVIRONMENT})
#   AUTH_SECRET      NextAuth secret (auto-generated with openssl if not set)
#   AWS_REGION       AWS region (default: us-east-1)
#   FORCE_ENV        Set to 1 to overwrite an existing .env.local

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[$(date +%H:%M:%S)] ${*}${NC}"; }
warn()  { echo -e "${YELLOW}[$(date +%H:%M:%S)] WARNING: ${*}${NC}"; }
error() { echo -e "${RED}[$(date +%H:%M:%S)] ERROR: ${*}${NC}" >&2; exit 1; }

# ── Validate required vars ───────────────────────────────────────────────────
[[ -n "${ACCOUNT_ID:-}" ]]      || error "ACCOUNT_ID is required"
[[ -n "${PORTAL_USERNAME:-}" ]] || error "PORTAL_USERNAME is required"
[[ -n "${PORTAL_PASSWORD:-}" ]] || error "PORTAL_PASSWORD is required"
[[ -n "${GITHUB_USERNAME:-}" ]] || error "GITHUB_USERNAME is required"

AUTH_SECRET="${AUTH_SECRET:-$(openssl rand -base64 32)}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
DYNAMODB_TABLE="${DYNAMODB_TABLE:-payalert-transactions-${ENVIRONMENT}}"
FORCE_ENV="${FORCE_ENV:-0}"
REPO_DIR=/opt/payalert-repo
APP_DIR=/opt/payalert/audit-portal-v2
ENV_FILE="${APP_DIR}/.env.local"
CURRENT_USER=$(whoami)

echo ""
info "=== PayAlert Audit Portal EC2 Setup ==="
info "User: ${CURRENT_USER} | App: ${APP_DIR}"
echo ""

# ── 1. System packages ───────────────────────────────────────────────────────
info "Step 1/6: Checking system packages..."
if ! node --version 2>/dev/null | grep -q 'v20'; then
    warn "Node.js 20 not found — installing..."
    sudo apt-get update -q
    sudo apt-get install -y git curl
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
info "  node: $(node --version) | npm: $(npm --version) | git: $(git --version | cut -d' ' -f3)"

# ── 2. Directory ownership ───────────────────────────────────────────────────
sudo mkdir -p "$REPO_DIR" /opt/payalert
sudo chown -R "${CURRENT_USER}:${CURRENT_USER}" "$REPO_DIR" /opt/payalert

# ── 3. Clone or update repository ───────────────────────────────────────────
info "Step 2/6: Syncing repository..."
if [[ -d "${REPO_DIR}/.git" ]]; then
    info "  Pulling latest changes..."
    git -C "$REPO_DIR" pull
else
    info "  Cloning PayAlert from GitHub..."
    git clone "git@github.com:${GITHUB_USERNAME}/PayAlert.git" "$REPO_DIR"
fi
info "  HEAD: $(git -C "$REPO_DIR" log -1 --format='%h %s')"

# ── 4. Copy app to deployment directory ─────────────────────────────────────
info "Step 3/6: Deploying audit-portal-v2 to ${APP_DIR}..."
# Track package-lock to decide whether npm ci is needed on re-runs
LOCK_OLD=""
if [[ -f "${APP_DIR}/package-lock.json" ]]; then
    LOCK_OLD=$(md5sum "${APP_DIR}/package-lock.json" | cut -d' ' -f1)
fi
LOCK_NEW=$(md5sum "${REPO_DIR}/audit-portal-v2/package-lock.json" | cut -d' ' -f1)

sudo rm -rf "$APP_DIR"
sudo cp -r "${REPO_DIR}/audit-portal-v2" /opt/payalert/
sudo chown -R "${CURRENT_USER}:${CURRENT_USER}" "$APP_DIR"

if [[ "$LOCK_OLD" == "$LOCK_NEW" && -n "$LOCK_OLD" ]]; then
    SKIP_INSTALL=1
    info "  package-lock unchanged — will skip npm ci"
else
    SKIP_INSTALL=0
    info "  package-lock changed — will run npm ci"
fi

# ── 5. Environment file ──────────────────────────────────────────────────────
info "Step 4/6: Writing environment file..."
if [[ -f "$ENV_FILE" && "$FORCE_ENV" != "1" ]]; then
    warn "  ${ENV_FILE} already exists — skipping (set FORCE_ENV=1 to overwrite)"
else
    cat > "$ENV_FILE" <<EOF
DYNAMODB_TABLE=${DYNAMODB_TABLE}
AWS_REGION=${AWS_REGION}
NEXT_PUBLIC_ENVIRONMENT=prod
MAIN_QUEUE_URL=https://sqs.${AWS_REGION}.amazonaws.com/${ACCOUNT_ID}/payalert-transactions-queue-${ENVIRONMENT}
AUTH_SECRET=${AUTH_SECRET}
PORTAL_USERNAME=${PORTAL_USERNAME}
PORTAL_PASSWORD=${PORTAL_PASSWORD}
EOF
    chmod 600 "$ENV_FILE"
    info "  Written: ${ENV_FILE}"
    info "  AUTH_SECRET auto-generated — note it down if sharing sessions across ASG instances"
fi

# ── 6. Install dependencies and build ───────────────────────────────────────
cd "$APP_DIR"
if [[ "$SKIP_INSTALL" != "1" ]]; then
    info "Step 5/6: Installing npm dependencies (~1 min)..."
    npm ci --silent
else
    info "Step 5/6: Skipping npm ci (dependencies unchanged)"
fi

info "  Building Next.js app (1–5 min)..."
npm run build
info "  Build complete"

# ── 7. Systemd service ───────────────────────────────────────────────────────
info "Step 6/6: Installing systemd service..."
bash "${REPO_DIR}/scripts/setup-audit-portal-service.sh"

echo ""
info "=== Setup complete ==="
echo ""
echo "  Logs:    sudo journalctl -u payalert-audit-portal -f"
echo "  Status:  sudo systemctl status payalert-audit-portal"
echo "  Restart: sudo systemctl restart payalert-audit-portal"
echo "  Test:    curl -s http://localhost:3000 | head -5"
echo ""
