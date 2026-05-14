#!/bin/bash
set -e

CURRENT_USER=$(whoami)

echo "Creating payalert-audit-portal.service as user: ${CURRENT_USER}"

sudo tee /etc/systemd/system/payalert-audit-portal.service > /dev/null <<EOF
[Unit]
Description=PayAlert Audit Portal
After=network.target

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=/opt/payalert/audit-portal-v2
ExecStart=/usr/bin/npm start
EnvironmentFile=/opt/payalert/audit-portal-v2/.env.local
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now payalert-audit-portal
sudo systemctl status payalert-audit-portal
