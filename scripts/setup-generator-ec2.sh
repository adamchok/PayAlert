#!/usr/bin/env bash
# Full setup for payalert-producer-ec2 (transaction generator + web UI).
# Automates DEPLOYMENT.md Steps 5.1 – 6.2. Safe to re-run (idempotent).
#
# Run on the instance via SSM Session Manager after running `bash`:
#
#   ACCOUNT_ID=123456789012 \
#   ENVIRONMENT=dev \
#   UI_USERNAME=payalert \
#   UI_PASSWORD=YourStrongPassword \
#   GITHUB_USERNAME=your-github-username \
#   bash /opt/payalert-repo/scripts/setup-generator-ec2.sh
#
# Required env vars:
#   ACCOUNT_ID       Your 12-digit AWS account ID
#   UI_USERNAME      Username for the generator web UI login
#   UI_PASSWORD      Password for the generator web UI login
#   GITHUB_USERNAME  GitHub username (SSH key must already be added to GitHub)
#
# Optional env vars:
#   ENVIRONMENT      Deployment environment suffix for SQS queue name (default: dev)
#   SQS_QUEUE_URL    Override the auto-constructed SQS URL (takes precedence over ACCOUNT_ID + ENVIRONMENT)
#   AWS_REGION       AWS region (default: us-east-1)
#   FORCE_ENV        Set to 1 to overwrite an existing generator.env

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[$(date +%H:%M:%S)] ${*}${NC}"; }
warn()  { echo -e "${YELLOW}[$(date +%H:%M:%S)] WARNING: ${*}${NC}"; }
error() { echo -e "${RED}[$(date +%H:%M:%S)] ERROR: ${*}${NC}" >&2; exit 1; }

# ── Validate required vars ───────────────────────────────────────────────────
[[ -n "${UI_USERNAME:-}" ]]     || error "UI_USERNAME is required"
[[ -n "${UI_PASSWORD:-}" ]]     || error "UI_PASSWORD is required"
[[ -n "${GITHUB_USERNAME:-}" ]] || error "GITHUB_USERNAME is required"
AWS_REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
FORCE_ENV="${FORCE_ENV:-0}"

# Construct SQS URL from ACCOUNT_ID + ENVIRONMENT if not explicitly provided
if [[ -z "${SQS_QUEUE_URL:-}" ]]; then
    [[ -n "${ACCOUNT_ID:-}" ]] || error "ACCOUNT_ID is required when SQS_QUEUE_URL is not set"
    SQS_QUEUE_URL="https://sqs.${AWS_REGION}.amazonaws.com/${ACCOUNT_ID}/payalert-transactions-queue-${ENVIRONMENT}"
fi
REPO_DIR=/opt/payalert-repo
APP_DIR=/opt/payalert/transaction-generator
ENV_FILE=/opt/payalert/generator.env
CURRENT_USER=$(whoami)

echo ""
info "=== PayAlert Generator EC2 Setup ==="
info "User: ${CURRENT_USER} | App: ${APP_DIR}"
echo ""

# ── 1. System packages ───────────────────────────────────────────────────────
info "Step 1/6: Checking system packages..."
MISSING=""
command -v python3 &>/dev/null || MISSING="${MISSING} python3"
command -v git     &>/dev/null || MISSING="${MISSING} git"
# python3 -m venv --help exits 0 even without ensurepip — check directly.
# python3-full is required on Ubuntu 26.04 (python3-venv has no candidate for 3.14).
python3 -c "import ensurepip" &>/dev/null 2>&1 || MISSING="${MISSING} python3-full"

if [[ -n "$MISSING" ]]; then
    warn "Installing:${MISSING}"
    sudo apt-get update -q
    sudo apt-get install -y python3 python3-pip python3-full git
fi
info "  python3: $(python3 --version) | git: $(git --version | cut -d' ' -f3)"

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
info "Step 3/6: Deploying transaction-generator to ${APP_DIR}..."
VENV_BACKUP=""
if [[ -d "${APP_DIR}/.venv" && -f "${APP_DIR}/.venv/bin/pip" ]]; then
    VENV_BACKUP=$(mktemp -d)
    cp -r "${APP_DIR}/.venv" "${VENV_BACKUP}/"
    info "  Preserved existing .venv"
fi

sudo rm -rf "$APP_DIR"
sudo cp -r "${REPO_DIR}/transaction-generator" /opt/payalert/
sudo chown -R "${CURRENT_USER}:${CURRENT_USER}" "$APP_DIR"

if [[ -n "$VENV_BACKUP" ]]; then
    cp -r "${VENV_BACKUP}/.venv" "${APP_DIR}/"
    rm -rf "$VENV_BACKUP"
fi

# ── 5. Python virtualenv and dependencies ───────────────────────────────────
info "Step 4/6: Installing Python dependencies..."
if [[ ! -d "${APP_DIR}/.venv" ]]; then
    python3 -m venv "${APP_DIR}/.venv"
fi
"${APP_DIR}/.venv/bin/pip" install --quiet --upgrade pip
"${APP_DIR}/.venv/bin/pip" install --quiet -r "${APP_DIR}/requirements.txt"
info "  Packages: $(${APP_DIR}/.venv/bin/pip list --format=freeze 2>/dev/null | grep -v '==' | wc -l) installed"

# ── 6. Environment file ──────────────────────────────────────────────────────
info "Step 5/6: Writing environment file..."
if [[ -f "$ENV_FILE" && "$FORCE_ENV" != "1" ]]; then
    warn "  ${ENV_FILE} already exists — skipping (set FORCE_ENV=1 to overwrite)"
else
    sudo tee "$ENV_FILE" > /dev/null <<EOF
AWS_REGION=${AWS_REGION}
SQS_QUEUE_URL=${SQS_QUEUE_URL}
UI_USERNAME=${UI_USERNAME}
UI_PASSWORD=${UI_PASSWORD}
EOF
    sudo chmod 600 "$ENV_FILE"
    sudo chown "${CURRENT_USER}:${CURRENT_USER}" "$ENV_FILE"
    info "  Written: ${ENV_FILE}"
fi

# ── 7. Systemd service ───────────────────────────────────────────────────────
info "Step 6/6: Installing systemd service..."
bash "${REPO_DIR}/scripts/setup-generator-service.sh"

echo ""
info "=== Setup complete ==="
echo ""
echo "  Logs:       sudo journalctl -u payalert-portal -f"
echo "  Status:     sudo systemctl status payalert-portal"
echo "  Restart:    sudo systemctl restart payalert-portal"
echo "  Test:       curl -u ${UI_USERNAME}:<password> http://localhost:5001"
echo ""
