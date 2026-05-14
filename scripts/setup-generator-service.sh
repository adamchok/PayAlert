#!/bin/bash
set -e

CURRENT_USER=$(whoami)

echo "Creating payalert-portal.service as user: ${CURRENT_USER}"

sudo tee /etc/systemd/system/payalert-portal.service > /dev/null <<EOF
[Unit]
Description=PayAlert Generator Web UI
After=network.target

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=/opt/payalert/transaction-generator
ExecStart=/opt/payalert/transaction-generator/.venv/bin/python3 app.py
EnvironmentFile=/opt/payalert/generator.env
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now payalert-portal
sudo systemctl status payalert-portal
