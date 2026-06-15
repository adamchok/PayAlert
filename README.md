# PayAlert — Real-Time Fraud Detection & Transaction Auditing

PayAlert is a cloud-native financial transaction monitoring system built on AWS. A Python transaction generator streams synthetic bank transactions through SQS to a Lambda processor, which scores each one for fraud risk, persists it in DynamoDB, and sends email alerts for high-risk activity and transaction receipts for every processed payment. A Next.js audit portal gives fraud analysts a live dashboard to investigate flagged accounts and redrive failed messages.

The entire infrastructure deploys from three CloudFormation templates — no CLI tooling or Docker required.

---

## Architecture

```
                ┌──────────────────────────────────────────────────────────────┐
                │  Custom VPC (10.0.0.0/16)                                    │
                │                                                              │
                │  Public Subnets — 10.0.1.0/24  ·  10.0.2.0/24                │
  Internet      │  ┌─────────────────┐   ┌──────────────────────────────────┐  │
     │          │  │  NAT Gateway    │   │  Application Load Balancer       │  │
     └─► ALB ───┼──┤  (Elastic IP)   │   │  :80  → Audit Portal             │  │
     :80 / 5001 │  └────────┬────────┘   │  :5001 → Generator UI            │  │
                │           │            └─────────────────┬────────────────┘  │
  Developer     │           │                              │                   │
     │          │  Private Subnets — 10.0.3.0/24  ·  10.0.4.0/24               │
     └─► SSM ───┼──────────────────────────────────────────│                   │
    (browser)   │  ┌─────────────────────────────┐  ┌──────┴───────────────┐   │
                │  │  payalert-producer-ec2      │  │  payalert-portal-ec2 │   │
                │  │  Generator + Flask UI :5001 │  │  Next.js portal :3000│   │
                │  │  private-1                  │  │  private-2  + ASG    │   │
                │  └─────────────┬───────────────┘  └──────────────────────┘   │
                └────────────────┼─────────────────────────────────────────────┘
                                 │ outbound via NAT Gateway
                                 ▼
                  ┌──────────────────────────────────────┐
                  │           AWS Services               │
                  │                                      │
                  │  SQS ──► Lambda ──► DynamoDB         │
                  │                 ├─► SNS (alerts)     │
                  │                 └─► SNS (receipts)   │
                  │                                      │
                  │  SQS DLQ ──► DLQ Lambda              │
                  └──────────────────────────────────────┘
```

EC2 instances live in private subnets with no inbound internet access. Browser shell access via **AWS Systems Manager Session Manager** — no SSH, no key pair needed.

---

## Repository Layout

```
PayAlert/
├── audit-portal-v2/             Next.js 16 fraud audit dashboard
│   ├── app/                     App Router pages + API routes
│   └── lib/                     DynamoDB, SQS clients, types
├── infra/
│   ├── transaction-processor/   Lambda handler (handler.py) + DLQ handler
│   ├── tests/                   Python unit tests (pytest + moto)
│   ├── lambda-stack.yaml        CloudFormation stack 1 — Lambda pipeline
│   ├── network-stack.yaml       CloudFormation stack 2 — VPC, EC2, ALB
│   └── asg-stack.yaml           CloudFormation stack 3 — Launch Templates + ASGs
├── transaction-generator/       Python synthetic transaction producer + Flask UI
├── scripts/                     EC2 setup scripts (run via UserData on first boot)
└── doc/
    ├── DEPLOYMENT.md            Full step-by-step AWS deployment guide
    └── LOCAL_DEV.md             Local development guide
```

---

## Features

### Transaction Processing Pipeline

- Consumes SQS batches with **partial batch failure** — only failed messages return to the queue, not the entire batch
- **Idempotent writes** via DynamoDB conditional `attribute_not_exists` — safe under SQS at-least-once delivery
- **SNS fraud alerts** (email) when `riskScore >= ALERT_RISK_THRESHOLD` (default 50)
- **SNS transaction receipts** (email) sent for every successfully processed transaction, formatted as bank-style confirmations
- **DLQ processor** Lambda captures unprocessable messages to DynamoDB with `processingStatus = "failed"` for portal-based review

### Risk Scoring Engine

Scores are computed 0–100 from additive rules evaluated per transaction:

| Rule | Points | Trigger |
|------|--------|---------|
| `VERY_HIGH_AMOUNT` | +40 | Amount > 150% of account tier cap |
| `VELOCITY_BREACH` | +30 | Multiple rapid transactions |
| `INTERNATIONAL_ATM` | +25 | ATM withdrawal outside Malaysia |
| `HIGH_AMOUNT` | +20 | Amount > 70% of tier cap |
| `UNUSUAL_HOUR` | +20 | Transaction between 23:00–05:00 MYT |
| `CROSS_BORDER` | +15 | Merchant country ≠ account home country |
| `UNRECOGNISED_DEVICE` | +15 | Mobile transaction from unknown device |
| `FOREIGN_CURRENCY` | +10 | Non-MYR transaction |
| `ROUND_AMOUNT` | +8 | Large round-number MYR amount |

**Risk levels:** LOW (0–24) · MEDIUM (25–49) · HIGH (50–74) · CRITICAL (75–100)

### Audit Portal (Next.js 16)

| Page | What it shows |
|------|--------------|
| **Dashboard** `/dashboard` | Today's count, HIGH/CRITICAL breakdown, risk distribution donut, 7-day volume trend, channel breakdown, recent transactions table. Auto-refreshes every 5 s. |
| **Live Audit** `/live-audit` | 20 most recent transactions across all accounts, refreshing every 5 s. |
| **Transactions** `/transactions` | Full feed filterable by date and risk level. |
| **Account Details** `/account/[id]` | Per-account transaction history, merchant category breakdown, geo-mapped spending (Leaflet). |
| **Transaction Details** `/transaction/[id]` | Full enriched record, risk score gauge, hourly activity histogram, merchant location map. |
| **Failed Transactions** `/failed-transactions` | DLQ viewer — lists messages with `processingStatus = "failed"`. **Redrive** re-queues to the main SQS queue; **Discard** marks them removed without deletion. |

All portal pages are protected by NextAuth.js credential login.

### Transaction Generator

```bash
python3 generator.py                              # continuous stream (default)
python3 generator.py --mode batch --count 100     # send N transactions then exit
python3 generator.py --fraud-mode                 # elevated fraud scenario rate (~30%)
python3 generator.py --dry-run                    # print JSON to stdout, no SQS
python3 generator.py --verbose                    # log each message sent
```

Generates realistic Malaysian bank transactions across 10 synthetic accounts spanning 5 states. Each transaction carries account tier, card type, merchant category, FX rate (for foreign currency), and a pre-computed risk assessment that the Lambda re-validates server-side.

A **Flask web UI** serves a browser control panel on port 5001 through the ALB.

---

## Tech Stack

**Audit Portal**
- Next.js 16 · React 19 · TypeScript 5
- Tailwind CSS 4 · Radix UI · Recharts · Leaflet
- NextAuth.js (credentials) · AWS SDK v3

**Lambda Processor**
- Python 3.11 · boto3 · ARM64 (Graviton2)

**Infrastructure**
- SQS standard queue + dead-letter queue
- DynamoDB on-demand · PITR enabled · TTL 90 days
- SNS (two topics: fraud alerts + customer receipts) · KMS encryption
- CloudWatch alarms (CPU, DLQ depth, Lambda errors)
- ALB (internet-facing) · Auto Scaling Groups (portal + producer)
- NAT Gateway · SSM Session Manager (browser-based EC2 access)
- CloudFormation with SAM Transform

---

## DynamoDB Schema

**Table:** `payalert-transactions` | **Primary key:** `transactionId` (String, UUID)

| GSI | Partition Key | Sort Key | Used by |
|-----|---------------|----------|---------|
| `AccountTransactionsIndex` | `accountId` | `timestamp` | Account details page |
| `DatePartitionIndex` | `datePartition` (YYYY-MM-DD) | `timestamp` | Dashboard daily stats |
| `RiskLevelIndex` | `riskLevel` | `timestamp` | Transactions feed filter |
| `FailedTransactionsIndex` | `processingStatus` | `failedAt` | Failed transactions page |

---

## CloudFormation Stacks

| Template | Stack name | What it creates | Deploy order |
|----------|-----------|-----------------|-------------|
| `infra/lambda-stack.yaml` | `payalert-stack` | SQS queues, DynamoDB, Lambda functions, SNS topics, CloudWatch alarms, KMS key | 1st |
| `infra/network-stack.yaml` | `payalert-network-stack` | VPC, subnets, NAT gateway, security groups, EC2 instances, ALB, target groups | 2nd |
| `infra/asg-stack.yaml` | `payalert-asg-stack` | Launch Templates, ASGs (portal + producer), ALB request-count scaling policy | 3rd (after AMIs are built) |

All resources are tagged `Project: Capstone`, `Group: 4`, `Scenario: PayAlert`, `Environment: dev`.

---

## Deployment

> **Full deployment guide:** [`doc/DEPLOYMENT.md`](doc/DEPLOYMENT.md)
> Step-by-step instructions with exact AWS Console paths, parameter tables, and verification commands for every step.

**High-level summary:**

1. Zip `infra/transaction-processor/` and upload to S3 as `function.zip`
2. Deploy `infra/lambda-stack.yaml` via CloudFormation Console — confirm **two** SNS subscription emails (fraud alerts + receipts)
3. Deploy `infra/network-stack.yaml` — EC2 instances boot and self-configure via UserData (~10 min)
4. Connect via SSM Session Manager; confirm `USERDATA_SUCCESS` in `/var/log/payalert-setup.log`
5. Create AMIs from both configured EC2 instances
6. Deploy `infra/asg-stack.yaml` with both AMI IDs — ASGs attach to ALB target groups automatically
7. Open `http://<AlbDnsName>` — portal is live

### Key Parameters (`lambda-stack.yaml`)

| Parameter | Purpose |
|-----------|---------|
| `AlertEmail` | Receives HIGH/CRITICAL fraud alert emails |
| `CustomerReceiptEmail` | Receives bank-style receipt for every processed transaction |
| `AlertRiskThreshold` | Minimum risk score to trigger an alert (default `50`) |
| `LambdaRoleArn` | `arn:aws:iam::<account-id>:role/LabRole` (AWS Academy Learner Labs) |

---

## Environment Variables

### Lambda (injected automatically by CloudFormation)

| Variable | Default | Description |
|----------|---------|-------------|
| `DYNAMODB_TABLE` | *(required)* | DynamoDB table name |
| `ALERT_TOPIC_ARN` | *(required)* | SNS topic ARN for fraud alerts |
| `CUSTOMER_RECEIPT_TOPIC_ARN` | *(required)* | SNS topic ARN for customer receipts |
| `ALERT_RISK_THRESHOLD` | `50` | Minimum risk score to trigger an alert |
| `TTL_DAYS` | `90` | Days before DynamoDB auto-expires a record |
| `ENABLE_FORCE_FAIL` | `false` | Force all transactions to fail — used to test DLQ flow |

### Audit Portal (`audit-portal-v2/.env.local`)

```env
DYNAMODB_TABLE=payalert-transactions-dev
AWS_REGION=us-east-1
NEXT_PUBLIC_ENVIRONMENT=dev
MAIN_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/<account-id>/payalert-transactions-queue-dev
AUTH_SECRET=<run: openssl rand -base64 32>
PORTAL_USERNAME=admin
PORTAL_PASSWORD=change-me
```

### Transaction Generator (environment or `/opt/payalert/generator.env` on EC2)

| Variable | Default | Description |
|----------|---------|-------------|
| `SQS_QUEUE_URL` | *(required)* | Main SQS queue URL |
| `AWS_REGION` | `us-east-1` | AWS region |
| `MIN_INTERVAL` | `0.1` | Minimum seconds between sends |
| `MAX_INTERVAL` | `2.0` | Maximum seconds between sends |
| `BURST_SIZE_MIN` | `1` | Minimum messages per burst |
| `BURST_SIZE_MAX` | `5` | Maximum messages per burst |
| `CUSTOMER_EMAIL` | `customer@example.com` | Email embedded in all transaction payloads — simulates one shared customer inbox |

---

## Running the Tests

The Lambda processor has **14 unit tests** using `pytest` and `moto` (AWS service mocks — no real AWS account needed).

```bash
cd infra/tests
pip install -r requirements-test.txt
pytest -v
```

| Test class | Tests | Covers |
|------------|-------|--------|
| `TestCleanItem` | 4 | Float→Decimal conversion, None-stripping, nested dict cleaning |
| `TestProcessTransaction` | 6 | DynamoDB writes, idempotency, validation, TTL, datePartition |
| `TestAlertDispatch` | 3 | Alert published for high risk, suppressed for low risk, subject format |
| `TestLambdaHandler` | 4 | Batch success, invalid JSON failure, partial batch failure, empty event |

---

## Synthetic Test Accounts

The generator includes 10 pre-defined Malaysian accounts across 5 states and 3 customer tiers:

| Account ID | State | Tier | Monthly Cap |
|------------|-------|------|-------------|
| ACC-MY-4F291A3B | Wilayah Persekutuan | GOLD | MYR 5,000 |
| ACC-MY-7C8D1E4F | Selangor | PLATINUM | MYR 15,000 |
| ACC-MY-2B5E9C1D | Johor | STANDARD | MYR 2,000 |
| ACC-MY-9A6F2D8E | Penang | GOLD | MYR 5,000 |
| ACC-MY-3D7B0F5A | Perak | STANDARD | MYR 1,000 |
| ACC-MY-1E4C8B7F | Wilayah Persekutuan | PLATINUM | MYR 15,000 |
| ACC-MY-6A0D3E2C | Selangor | STANDARD | MYR 2,000 |
| ACC-MY-5F1B9A4D | Selangor | GOLD | MYR 5,000 |
| ACC-MY-8C2E6D0B | Sabah | STANDARD | MYR 1,000 |
| ACC-MY-0B8F5C3A | Sarawak | GOLD | MYR 5,000 |

---

## Quick Smoke Test

After deployment, send this message via **SQS Console → `payalert-transactions-queue-dev` → Send and receive messages** to trigger a CRITICAL alert and a receipt simultaneously:

```json
{
  "transactionId": "smoke-test-0001-0000-0000-000000000001",
  "accountId": "ACC-MY-4F291A3B",
  "amount": 9500.00,
  "currency": "USD",
  "timestamp": "2026-05-11T02:30:00+0800",
  "merchantId": "ATM-CITI-US01",
  "transactionType": "WITHDRAWAL",
  "referenceId": "PAY-SMOKE-TEST-001",
  "description": "ATM cash withdrawal - New York, US",
  "channel": "ATM",
  "merchantName": "Citibank ATM (USA)",
  "merchantCategory": "ATM_WITHDRAWAL",
  "merchantCity": "New York",
  "merchantState": "New York",
  "merchantCountry": "US",
  "customerId": "CUST-4F291A3B",
  "customerName": "Ahmad Farid bin Ismail",
  "customerEmail": "your@email.com",
  "customerTier": "GOLD",
  "cardLast4": "4821",
  "cardType": "VISA_DEBIT",
  "exchangeRate": 4.72,
  "amountMYR": 44840.00,
  "riskScore": 95,
  "riskLevel": "CRITICAL",
  "riskFlags": ["VERY_HIGH_AMOUNT","UNUSUAL_HOUR","CROSS_BORDER","INTERNATIONAL_ATM","FOREIGN_CURRENCY"],
  "isFlagged": true
}
```

Within 30 seconds:
- Transaction appears on the portal dashboard highlighted in red
- `[PayAlert] CRITICAL Risk` alert email arrives at `AlertEmail`
- Bank-style receipt email arrives at `CustomerReceiptEmail`
