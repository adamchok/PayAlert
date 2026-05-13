# PayAlert Transaction Generator

Simulates a realistic stream of financial transactions for the PayAlert audit pipeline. Each transaction is a fully-enriched JSON event that covers retail purchases, bill payments, fund transfers, ATM withdrawals, e-wallet top-ups, and merchant refunds — including deliberate fraud scenario injection for audit portal demonstrations.

---

## Architecture Role

```
EC2 (this script) ──▶ SQS Standard Queue ──▶ Lambda Processor ──▶ DynamoDB
                                                                        │
                                                                   Audit Portal
```

The generator runs continuously on the EC2 Producer instance inside the PayAlert VPC, sending bursts of 1–5 transactions to the SQS queue at random intervals (0.1–2.0 s by default). All traffic stays on the AWS private network via the SQS VPC Interface Endpoint — no public internet required.

---

## Enriched Transaction Schema

The generator produces the six fields required by the Lambda processor, plus an additional set of enrichment fields that are stored in DynamoDB and surfaced on the audit portal.

### Core Fields (Lambda-required)

| Field | Type | Example |
|---|---|---|
| `transactionId` | string (UUID v4) | `"3f4a5b6c-7d8e-9f10-a11b-12c13d14e15f"` |
| `accountId` | string | `"ACC-MY-4F291A3B"` |
| `amount` | number | `125.50` |
| `currency` | string (ISO-4217) | `"MYR"` |
| `timestamp` | string (ISO-8601 MYT) | `"2026-05-09T14:30:00+0800"` |
| `merchantId` | string | `"MER-LSS-0001"` |

### Enrichment Fields

| Field | Type | Description |
|---|---|---|
| `transactionType` | string | `PURCHASE`, `PAYMENT`, `TRANSFER`, `WITHDRAWAL`, `REFUND`, `TOPUP` |
| `referenceId` | string | Human-readable ID e.g. `PAY-20260509-8F3A2B1C` |
| `description` | string | Plain-language description of the transaction |
| `channel` | string | `POS`, `CONTACTLESS`, `ONLINE`, `MOBILE_APP`, `ATM` |
| `merchantName` | string | e.g. `"Lotus's Supermarket"` |
| `merchantCategory` | string | e.g. `GROCERY`, `FAST_FOOD`, `AIRLINE`, `STREAMING` |
| `merchantCity` | string | e.g. `"Kuala Lumpur"` |
| `merchantState` | string | e.g. `"Wilayah Persekutuan"` |
| `merchantCountry` | string (ISO 3166-1 alpha-2) | e.g. `"MY"` |
| `customerId` | string | e.g. `"CUST-4F291A3B"` |
| `customerName` | string | e.g. `"Ahmad Farid bin Ismail"` |
| `customerTier` | string | `STANDARD`, `SILVER`, `GOLD`, `PLATINUM` |
| `cardLast4` | string | e.g. `"4821"` |
| `cardType` | string | `VISA_DEBIT`, `VISA_CREDIT`, `MASTERCARD_DEBIT`, `MASTERCARD_CREDIT` |
| `location` | object | `{ city, state, country }` (merchant location) |
| `exchangeRate` | number | MYR conversion rate for the transaction currency |
| `amountMYR` | number | Amount normalised to MYR for reporting |
| `riskScore` | integer (0–100) | Composite fraud risk score |
| `riskLevel` | string | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `riskFlags` | string[] | Triggered risk rules (see below) |
| `isFlagged` | boolean | `true` when `riskScore ≥ 50` |
| `flagReason` | string \| null | Pipe-delimited list of active risk flags |
| `generatorVersion` | string | Generator build version |

#### Conditional Enrichment Fields

| Field | Present When | Example |
|---|---|---|
| `ipAddress` | `channel` is `ONLINE` or `MOBILE_APP` | `"115.164.43.21"` |
| `userAgent` | `channel` is `ONLINE` or `MOBILE_APP` | Browser / mobile UA string |
| `deviceId` | `channel` is `MOBILE_APP` | `"DEV-A1B2C3D4E5F6G7H8"` |
| `deviceOS` | `channel` is `MOBILE_APP` | `"Android 14"` |
| `appVersion` | `channel` is `MOBILE_APP` | `"3.4.1"` |
| `recipientAccountId` | `transactionType` is `TRANSFER` | `"ACC-MY-7C8D1E4F"` |
| `recipientName` | `transactionType` is `TRANSFER` | `"Nurul Ain binti Razak"` |
| `transferPurpose` | `transactionType` is `TRANSFER` | `"Rental payment"` |
| `fraudScenario` | Fraud injection active | `"high_amount"`, `"late_night"`, etc. |

---

## Risk Engine

Each transaction is scored 0–100 based on the following rules:

| Flag | Condition | Points |
|---|---|---|
| `VERY_HIGH_AMOUNT` | Amount > 150% of tier spending cap | +40 |
| `HIGH_AMOUNT` | Amount > 70% of tier spending cap | +20 |
| `UNUSUAL_HOUR` | Transaction between 23:00–05:00 MYT | +20 |
| `VELOCITY_BREACH` | Simulated multiple rapid transactions | +30 |
| `CROSS_BORDER` | Merchant country ≠ account home country | +15 |
| `INTERNATIONAL_ATM` | ATM withdrawal outside Malaysia | +25 |
| `UNRECOGNISED_DEVICE` | Mobile transaction on unknown device | +15 |
| `FOREIGN_CURRENCY` | Non-MYR transaction | +10 |
| `ROUND_AMOUNT` | MYR amount ≥ 500 divisible by 100 | +8 |

| Risk Level | Score Range |
|---|---|
| `LOW` | 0–24 |
| `MEDIUM` | 25–49 |
| `HIGH` | 50–74 |
| `CRITICAL` | 75–100 |

Transactions with `riskScore ≥ 50` have `isFlagged = true` and are highlighted on the audit portal.

---

## Simulated Accounts

| Account ID | Customer Name | Tier | Home City | Card |
|---|---|---|---|---|
| `ACC-MY-4F291A3B` | Ahmad Farid bin Ismail | GOLD | Kuala Lumpur | VISA Debit |
| `ACC-MY-7C8D1E4F` | Nurul Ain binti Razak | PLATINUM | Petaling Jaya | Mastercard Credit |
| `ACC-MY-2B5E9C1D` | Lim Wei Jian | SILVER | Johor Bahru | Mastercard Debit |
| `ACC-MY-9A6F2D8E` | Priya a/p Subramaniam | GOLD | George Town | VISA Credit |
| `ACC-MY-3D7B0F5A` | Muhammad Zulkifli bin Hassan | STANDARD | Ipoh | VISA Debit |
| `ACC-MY-1E4C8B7F` | Siti Norzahra binti Kamarudin | PLATINUM | Kuala Lumpur | Mastercard Credit |
| `ACC-MY-6A0D3E2C` | Rajesh a/l Krishnamurthy | SILVER | Shah Alam | VISA Debit |
| `ACC-MY-5F1B9A4D` | Tan Mei Ling | GOLD | Subang Jaya | Mastercard Credit |
| `ACC-MY-8C2E6D0B` | Faizal bin Abdul Rahman | STANDARD | Kota Kinabalu | VISA Debit |
| `ACC-MY-0B8F5C3A` | Wong Kok Wai | GOLD | Kuching | VISA Credit |

---

## Setup

### Prerequisites

- Python 3.11+
- An IAM role or credentials with `sqs:SendMessage` on the target queue

### Installation

```bash
pip install -r requirements.txt
```

### Configuration

Set the following environment variables (or pass as CLI flags):

| Variable | Required | Default | Description |
|---|---|---|---|
| `SQS_QUEUE_URL` | Yes (unless `--dry-run`) | — | Full SQS queue endpoint URL |
| `AWS_REGION` | No | `ap-southeast-1` | AWS region |
| `MIN_INTERVAL` | No | `0.1` | Minimum seconds between bursts |
| `MAX_INTERVAL` | No | `2.0` | Maximum seconds between bursts |
| `BURST_SIZE_MIN` | No | `1` | Minimum transactions per burst |
| `BURST_SIZE_MAX` | No | `5` | Maximum transactions per burst |

---

## Usage

### Continuous Stream (default)

```bash
export SQS_QUEUE_URL="<paste TransactionQueueUrl from CloudFormation Outputs>"
python3 generator.py
```

### Dry-Run (print to stdout, no SQS)

```bash
python3 generator.py --dry-run
```

### Batch Mode

```bash
# Send 100 transactions immediately
python3 generator.py --mode batch --count 100

# Generate 50 transactions for a single account without sending
python3 generator.py --mode batch --count 50 --account ACC-MY-4F291A3B --dry-run
```

### Fraud Injection Mode

Elevates the probability of fraud-scenario transactions to ~30% for audit portal demonstrations.

```bash
python3 generator.py --fraud-mode
```

### Custom Throughput

```bash
# Higher throughput: 3–5 tx every 0.1–0.5 s
python3 generator.py --burst-min 3 --burst-max 5 --min-interval 0.1 --max-interval 0.5

# Low-and-slow: 1 tx every 5–10 s
python3 generator.py --burst-min 1 --burst-max 1 --min-interval 5 --max-interval 10
```

### Full CLI Reference

```
usage: generator.py [-h] [--mode {stream,batch}] [--count COUNT]
                    [--queue-url QUEUE_URL] [--region REGION]
                    [--min-interval MIN_INTERVAL] [--max-interval MAX_INTERVAL]
                    [--burst-min BURST_MIN] [--burst-max BURST_MAX]
                    [--account ACCOUNT] [--fraud-mode] [--dry-run] [--verbose]
```

---

## Deploying to EC2 (AWS Console)

The generator runs on the PayAlert **EC2 Producer** instance. All setup is performed via the AWS Management Console — no AWS CLI or SAM CLI required.

### Step 1 — Create an IAM role for the EC2 instance

The generator sends messages to SQS. The EC2 instance must carry an IAM role with the required permission — no hard-coded access keys are needed on the instance.

1. Open the **[IAM Console](https://console.aws.amazon.com/iam/home#/roles)** → **Roles** → **Create role**.
2. **Trusted entity type**: AWS service → **EC2** → **Next**.
3. Skip the managed policies page — click **Next**.
4. **Role name**: `payalert-generator-ec2-role` → **Create role**.
5. Open the newly created role → **Permissions** tab → **Add permissions** → **Create inline policy**.
6. Switch to the **JSON** editor and paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:SendMessageBatch",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:ap-southeast-1:*:payalert-transactions-queue-*"
    }
  ]
}
```

7. **Policy name**: `PayAlertGeneratorSQSSend` → **Create policy**.

---

### Step 2 — Launch the EC2 instance

1. Open the **[EC2 Console](https://ap-southeast-1.console.aws.amazon.com/ec2/home?region=ap-southeast-1#LaunchInstances:)** → **Launch instances**.
2. Configure the instance:

| Setting | Value |
|---|---|
| **Name** | `payalert-generator` |
| **AMI** | Ubuntu Server 26.04 LTS (64-bit x86) |
| **Instance type** | `t3.micro` |
| **Key pair** | Select or create a key pair — download the `.pem` file |
| **Network** | Default VPC |
| **Security group** | Allow **SSH (port 22)** from your IP; allow **TCP 5001** if you will run the web UI |

3. Expand **Advanced details** → **IAM instance profile** → select `payalert-generator-ec2-role`.
4. Click **Launch instance**.

---

### Step 3 — Connect to the instance

Wait for the instance status to reach **Running** (approximately 1–2 minutes).

**From Ubuntu / macOS terminal:**

```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@<instance-public-ip>
```

**Windows (PuTTY)**

Convert the `.pem` to `.ppk` using PuTTYgen, then connect via PuTTY to `ubuntu@<instance-public-ip>`.

To find the public IP: EC2 Console → **Instances** → select `payalert-generator` → **Public IPv4 address**.

Alternatively, use **Session Manager**: EC2 Console → **Instances** → **Connect** → **Session Manager** — no SSH key or open port required.

---

### Step 4 — Install Python dependencies

On the instance:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-pip python3-venv git

# Transfer the transaction-generator source to the instance
# Option A — clone from your repository:
git clone https://github.com/your-org/payalert.git /opt/payalert

# Option B — copy files using SCP from your workstation:
# scp -i your-key.pem -r transaction-generator/ ubuntu@<ip>:/opt/payalert/

cd /opt/payalert/transaction-generator
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

When running via systemd later, use the venv Python path in `ExecStart`:  
`/opt/payalert/transaction-generator/.venv/bin/python3`

---

### Step 5 — Configure the queue URL and region

Retrieve the `TransactionQueueUrl` from the Lambda stack:

1. Open the **[CloudFormation Console](https://ap-southeast-1.console.aws.amazon.com/cloudformation/home?region=ap-southeast-1)**.
2. Click `payalert` → **Outputs** tab → copy `TransactionQueueUrl`.

Create the environment file on the instance:

```bash
sudo tee /opt/payalert/generator.env <<’EOF’
AWS_REGION=ap-southeast-1
SQS_QUEUE_URL=<paste TransactionQueueUrl from CloudFormation Outputs>
EOF
sudo chmod 600 /opt/payalert/generator.env
sudo chown root:root /opt/payalert/generator.env
```

Replace the `SQS_QUEUE_URL` value with the actual URL from the CloudFormation outputs.

---

### How to start generation

Pick one of the following depending on whether you want a one-off manual run or a service that survives logout and reboot.

#### A. One-off test in the foreground

Confirms SQS permissions and queue URL before you background the process:

```bash
cd /opt/payalert/transaction-generator
export AWS_REGION=ap-southeast-1
export SQS_QUEUE_URL="<paste TransactionQueueUrl from CloudFormation Outputs>"
python3 generator.py --verbose
```

Stop with `Ctrl+C`. To verify payload shape without calling AWS, use `python3 generator.py --dry-run` first.

#### B. Continuous stream in the background (`nohup`)

Use this when you want the default behaviour (random bursts to SQS every `MIN_INTERVAL`–`MAX_INTERVAL` seconds):

```bash
cd /opt/payalert/transaction-generator
export AWS_REGION=ap-southeast-1
export SQS_QUEUE_URL="<paste TransactionQueueUrl from CloudFormation Outputs>"

nohup python3 generator.py \
  --min-interval 0.1 --max-interval 2.0 \
  >> /opt/payalert/transaction-generator/generator.log 2>&1 &

echo "Generator PID: $!"
```

View logs: `tail -f /opt/payalert/transaction-generator/generator.log`. Find/stop the process: `pgrep -af generator.py` then `kill <pid>`.

Optional flags (same as local): `--fraud-mode`, `--burst-min` / `--burst-max`, or `--mode batch --count N` for a fixed batch instead of an endless stream.

#### C. Production: `systemd` service (survives reboot)

Create the unit file:

```bash
sudo tee /etc/systemd/system/payalert-generator.service > /dev/null <<'EOF'
[Unit]
Description=PayAlert Transaction Generator
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/payalert/transaction-generator
ExecStart=/opt/payalert/transaction-generator/.venv/bin/python3 generator.py
EnvironmentFile=/opt/payalert/generator.env
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now payalert-generator
sudo systemctl status payalert-generator
sudo journalctl -u payalert-generator -f
```

Stop or disable:

```bash
sudo systemctl stop payalert-generator
sudo systemctl disable payalert-generator
```

#### D. Web UI (`app.py`)

The generator ships with a browser-based control panel (`app.py`) that lets you start and stop the transaction stream, adjust throughput, and watch live log output — without needing to SSH in for routine operations.

**Run the web UI in the foreground:**

```bash
cd /opt/payalert/transaction-generator
source .venv/bin/activate
export $(cat /opt/payalert/generator.env | xargs)
ENVIRONMENT=dev python3 app.py
```

Open `http://<instance-public-ip>:5001` in your browser.

**Run as a systemd service:**

```bash
sudo tee /etc/systemd/system/payalert-generator-ui.service > /dev/null <<'EOF'
[Unit]
Description=PayAlert Generator Web UI
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/payalert/transaction-generator
ExecStart=/opt/payalert/transaction-generator/.venv/bin/python3 app.py
EnvironmentFile=/opt/payalert/generator.env
Environment=ENVIRONMENT=prod
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now payalert-generator-ui
```

> The web UI and the CLI generator are independent — do not run both simultaneously or they will compete for the same SQS send rate.

#### Connect with Session Manager

If the instance only has SSM (no SSH), open a shell in the console: **EC2 → Instances → Connect → Session Manager**, then run the same `cd`, `export`, and `python3 generator.py` commands as in sections A–D above.

---

## Sample Output

```json
{
  "transactionId": "3f4a5b6c-7d8e-9f10-a11b-12c13d14e15f",
  "accountId": "ACC-MY-4F291A3B",
  "amount": 125.50,
  "currency": "MYR",
  "timestamp": "2026-05-09T14:30:22+0800",
  "merchantId": "MER-LSS-0001",
  "transactionType": "PURCHASE",
  "referenceId": "PAY-20260509-8F3A2B1C",
  "description": "Contactless payment at Lotus's Supermarket",
  "channel": "CONTACTLESS",
  "merchantName": "Lotus's Supermarket",
  "merchantCategory": "GROCERY",
  "merchantCity": "Kuala Lumpur",
  "merchantState": "Wilayah Persekutuan",
  "merchantCountry": "MY",
  "customerId": "CUST-4F291A3B",
  "customerName": "Ahmad Farid bin Ismail",
  "customerTier": "GOLD",
  "cardLast4": "4821",
  "cardType": "VISA_DEBIT",
  "location": {
    "city": "Kuala Lumpur",
    "state": "Wilayah Persekutuan",
    "country": "MY"
  },
  "exchangeRate": 1.0,
  "amountMYR": 125.50,
  "riskScore": 5,
  "riskLevel": "LOW",
  "riskFlags": [],
  "isFlagged": false,
  "flagReason": null,
  "generatorVersion": "2.0.0"
}
```

---

## Fraud Injection Scenarios

When `--fraud-mode` is active (or randomly at ~5% baseline), one of the following scenarios may be injected:

| Scenario | Description | Expected Flags |
|---|---|---|
| `high_amount` | Amount set to 160–300% of tier spending cap | `VERY_HIGH_AMOUNT` |
| `late_night` | Timestamp overridden to 00:00–04:59 MYT | `UNUSUAL_HOUR` |
| `cross_border_atm` | ATM withdrawal in Singapore or USA | `CROSS_BORDER`, `INTERNATIONAL_ATM`, `FOREIGN_CURRENCY` |
| `velocity` | Rapid successive purchases (simulated flag) | `VELOCITY_BREACH` |

---

## Merchant Catalogue Coverage

| Category | Merchants |
|---|---|
| Grocery & Supermarket | Lotus's, AEON, Mydin, Cold Storage, Jaya Grocer |
| Fast Food & Restaurants | McDonald's, KFC, Pizza Hut, Nando's, Secret Recipe |
| Café | Starbucks |
| Food Delivery | GrabFood |
| Fuel | Petronas, Shell |
| Ride-Hailing | GrabCar |
| Toll | PLUS Highway |
| E-Commerce (MY) | Lazada, Shopee, Zalora |
| E-Commerce (International) | Amazon.com |
| Apparel | Uniqlo, Zara |
| Healthcare | KPJ Specialist Hospital |
| Pharmacy | Watson's |
| Telco | TM Unifi, Maxis, Celcom |
| Utilities | Tenaga Nasional, Syabas |
| Streaming | Netflix, Spotify |
| Digital Goods | Apple Inc. |
| Gaming | Steam |
| Travel | AirAsia, Singapore Airlines, Agoda |
| Education | Coursera |
| E-Wallet Top-Up | Touch 'n Go, Boost, GrabPay, ShopeePay |
| ATM (Malaysia) | Maybank, CIMB, Public Bank, RHB |
| ATM (International) | DBS Singapore, Citibank USA |
