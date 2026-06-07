# Deploying to AWS EC2

This guide covers deploying the Next.js audit portal to a single EC2 instance using the AWS Console only — no CLI, no SAM, no CDK. The setup uses:

- EC2 (Ubuntu 26.04 LTS) running the Next.js production server
- PM2 to keep the process alive and auto-restart on reboot
- Nginx as a reverse proxy on port 80/443
- An **IAM Instance Role** for DynamoDB access (no access keys on the server)

---

## Step 1 — Create an IAM Role for the EC2 instance

The instance needs permission to query DynamoDB. You'll attach this role at launch time so the app never needs hardcoded credentials.

1. Open the [IAM Console](https://console.aws.amazon.com/iam) → **Roles** → **Create role**
2. **Trusted entity:** AWS service → **EC2** → Next
3. **Permissions:** click **Create policy** (opens a new tab), use the JSON editor:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query"
      ],
      "Resource": [
        "arn:aws:dynamodb:ap-southeast-1:YOUR_ACCOUNT_ID:table/payalert-transactions",
        "arn:aws:dynamodb:ap-southeast-1:YOUR_ACCOUNT_ID:table/payalert-transactions/index/*"
      ]
    }
  ]
}
```

Replace `YOUR_ACCOUNT_ID` with your 12-digit AWS account ID. Name the policy `payalert-audit-portal-policy` and save.

4. Back on the role tab, attach the policy you just created.
5. Name the role **`payalert-audit-portal-role`** → **Create role**.

---

## Step 2 — Launch an EC2 Instance

1. Open the [EC2 Console](https://console.aws.amazon.com/ec2) → **Launch Instances**
2. **Name:** `payalert-audit-portal`
3. **AMI:** Ubuntu Server 26.04 LTS (64-bit x86) — search "Ubuntu 26.04" in the AMI catalog; the official Canonical AMI will be listed under **AWS Marketplace** or **Quick Start**
4. **Instance type:** `t3.small` is sufficient for low traffic; `t3.medium` if you expect multiple concurrent users
5. **Key pair:** Select **Proceed without a key pair** — access is via SSM Session Manager, no SSH required.
6. **Network settings:**
   - VPC: your default VPC (or the VPC where DynamoDB is accessible — DynamoDB uses AWS-internal endpoints so any VPC works as long as internet access or a VPC endpoint is available)
   - **Auto-assign public IP:** Enable
   - **Security group:** Create new, named `payalert-audit-portal-sg`
     - Inbound rule 1: **HTTP** (TCP 80) — Source: **0.0.0.0/0** (or restrict to your office IP)
     - Inbound rule 2: **HTTPS** (TCP 443) — Source: **0.0.0.0/0** _(add later if you set up TLS)_
7. **Storage:** 20 GB gp3 (default is fine)
8. **Advanced details → IAM instance profile:** Select **`payalert-audit-portal-role`**
9. Click **Launch instance**

Wait ~1 minute for the instance to reach the `running` state.

---

## Step 3 — Connect to the Instance

In the EC2 Console, select your instance → **Connect** → **Session Manager** tab → **Connect**.

> After the browser shell opens, run `bash` to get a full interactive shell.

> If the Session Manager tab is greyed out, wait 1–2 minutes for the SSM agent to register, then refresh the page. The instance profile must include `AmazonSSMManagedInstanceCore` (or the `LabInstanceProfile` in Learner Labs).

---

## Step 4 — Install Node.js and PM2

```bash
# Update package index
sudo apt update && sudo apt upgrade -y

# Install Node.js 22 (LTS) via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node -v   # should print v22.x.x
npm -v

# Install PM2 globally
sudo npm install -g pm2
```

---

## Step 5 — Deploy the App

### 5a. Transfer the code

**Clone from Git (via the SSM Session Manager shell):**

```bash
sudo apt install -y git
git clone https://github.com/YOUR_ORG/audit-portal-v2.git /home/ubuntu/audit-portal-v2
cd /home/ubuntu/audit-portal-v2
```

### 5b. Create the environment file

On the EC2 instance, create `.env.local` in the project directory:

```bash
cat > /home/ubuntu/audit-portal-v2/.env.local << 'EOF'
DYNAMODB_TABLE=payalert-transactions
AWS_REGION=ap-southeast-1
NEXT_PUBLIC_ENVIRONMENT=prod
EOF
```

> **Do not add `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` here.** The IAM instance role attached in Step 2 provides credentials automatically via the EC2 metadata service — the AWS SDK picks them up with no configuration.

### 5c. Install dependencies and build

```bash
cd /home/ubuntu/audit-portal-v2
npm ci --omit=dev
npm run build
```

`npm ci` is faster and more reproducible than `npm install` for deployments. The build output goes to `.next/`.

---

## Step 6 — Run with PM2

```bash
cd /home/ubuntu/audit-portal-v2

# Start the Next.js production server on port 3000
pm2 start npm --name "audit-portal" -- start

# Save PM2 process list so it restarts after a reboot
pm2 save

# Configure PM2 to start on system boot
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
# Run the command that PM2 prints out (it starts with "sudo systemctl enable...")
```

Verify it's running:

```bash
pm2 status
pm2 logs audit-portal --lines 20
```

The app is now running on `http://localhost:3000` on the EC2 instance.

---

## Step 7 — Configure Nginx as a Reverse Proxy

Nginx sits on port 80, forwards requests to the Next.js server on port 3000.

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
```

Create a site config:

```bash
sudo tee /etc/nginx/sites-available/audit-portal > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;   # replace with your domain name if you have one

    # Security headers
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF
```

Enable the site, disable the default, then start:

```bash
sudo ln -s /etc/nginx/sites-available/audit-portal /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t          # should print "syntax is ok"
sudo systemctl start nginx
```

Your app is now accessible at `http://<PUBLIC_IP>`.

---

## Step 8 — (Optional) Add HTTPS with Let's Encrypt

If you have a domain name pointing to your EC2 instance:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Certbot will edit the Nginx config and install a certificate automatically. It also sets up auto-renewal.

---

## Updating the App

To deploy a new version:

```bash
cd /home/ubuntu/audit-portal-v2

# Pull latest code (or re-upload via scp)
git pull

# Rebuild
npm ci --omit=dev
npm run build

# Restart the process (zero-downtime reload)
pm2 reload audit-portal
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `502 Bad Gateway` from Nginx | Next.js server not running | `pm2 status` — restart with `pm2 start audit-portal` |
| DynamoDB `AccessDeniedException` | IAM role not attached or policy wrong | Verify role in EC2 Console → Instance → **IAM Role**; check policy ARN |
| DynamoDB `ResourceNotFoundException` | Wrong table name | Check `DYNAMODB_TABLE` in `.env.local` matches the actual table |
| App starts but shows no data | Region mismatch | `AWS_REGION` in `.env.local` must match the region of the DynamoDB table |
| `ENOSPC: no space left` during build | Disk full | Increase EBS volume in EC2 Console or run `sudo apt clean && npm cache clean --force` |
| Port 80 unreachable | Security group | Confirm inbound rule for TCP 80 is `0.0.0.0/0` in the security group |

---

## Architecture Summary

```
Internet
    │
    ▼
EC2 Security Group (port 80/443)
    │
    ▼
Nginx :80  ──proxy──►  Next.js (PM2) :3000
                              │
                              ▼
                    AWS DynamoDB (ap-southeast-1)
                    via IAM Instance Role (no keys)
```
