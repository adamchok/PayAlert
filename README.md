# PayAlert — Real-Time Fraud Detection & Transaction Auditing

PayAlert is a cloud-native financial transaction monitoring system that ingests a continuous stream of transactions, scores each one for fraud risk, stores them in DynamoDB, and delivers email alerts for high-risk activity. An audit portal gives fraud analysts a live dashboard to investigate accounts and transactions.

---

## Architecture

```
Transaction Generator (Python)
        │
        ▼ SQS Standard Queue
        │
        ▼ AWS Lambda (Python 3.11)
        ├── DynamoDB  ← primary store
        └── SNS       ← email alert (risk ≥ 50)

Audit Portal (Next.js 16)
        └── DynamoDB  ← server-side reads via AWS SDK v3
```

All AWS infrastructure is defined in a single CloudFormation/SAM template. No CLI tooling is required — everything deploys through the AWS Management Console.

---

## Components

| Directory | Description |
|-----------|-------------|
| `infra/` | Transaction processor Lambda + CloudFormation template |
| `audit-portal-v2/` | Next.js 16 audit dashboard |
| `transaction-generator/` | Python synthetic transaction producer |
| `doc/` | Deployment and local development guides |

---

## Features

### Transaction Processing Pipeline
- Consumes transaction batches from SQS with configurable concurrency
- Idempotent writes to DynamoDB via conditional `attribute_not_exists` puts (handles SQS at-least-once delivery)
- Partial batch failure — only failed messages are retried, not the entire batch
- SNS email alerts for transactions where `riskScore >= 50` (threshold is configurable)

### Risk Scoring Engine

Scores are computed 0–100 from additive rules:

| Rule | Points | Condition |
|------|--------|-----------|
| `VERY_HIGH_AMOUNT` | +40 | Amount > 150% of account tier cap |
| `VELOCITY_BREACH` | +30 | Multiple rapid transactions |
| `INTERNATIONAL_ATM` | +25 | ATM withdrawal outside Malaysia |
| `HIGH_AMOUNT` | +20 | Amount > 70% of tier cap |
| `UNUSUAL_HOUR` | +20 | Transaction between 23:00–05:00 MYT |
| `CROSS_BORDER` | +15 | Merchant country ≠ account home country |
| `UNRECOGNISED_DEVICE` | +15 | Mobile transaction on unknown device |
| `FOREIGN_CURRENCY` | +10 | Non-MYR transaction |
| `ROUND_AMOUNT` | +8 | Large round-number MYR amount |

Risk levels: **LOW** (0–24) · **MEDIUM** (25–49) · **HIGH** (50–74) · **CRITICAL** (75–100)

### Audit Portal
- **Dashboard** — today's stats, risk distribution donut chart, 7-day volume trend, channel breakdown, recent transactions table; auto-refreshes every 5 seconds
- **Transactions** — full transaction feed for any date, filterable by risk level
- **Account Details** — per-account history, merchant category breakdown, geo-mapped spending (Leaflet)
- **Transaction Details** — full enriched record, risk score gauge, hourly activity histogram, merchant location map

---

## Tech Stack

**Frontend**
- Next.js 16 / React 19 / TypeScript 5
- Tailwind CSS 4, Radix UI, Recharts, Leaflet

**Backend**
- Python 3.11 Lambda (ARM64 / Graviton2)
- boto3, AWS SDK v3 (`@aws-sdk/client-dynamodb`)

**Infrastructure**
- AWS SQS (standard queue + dead-letter queue)
- AWS DynamoDB (on-demand, PITR enabled, TTL)
- AWS SNS, CloudWatch Alarms, IAM
- CloudFormation with SAM Transform

---

## DynamoDB Schema

**Table:** `payalert-transactions`  
**Primary key:** `transactionId` (UUID)

| GSI | Partition Key | Sort Key | Use Case |
|-----|---------------|----------|----------|
| `AccountTransactionsIndex` | `accountId` | `timestamp` | Per-account history |
| `RiskLevelIndex` | `riskLevel` | `timestamp` | Risk-level feeds |
| `DatePartitionIndex` | `datePartition` | `timestamp` | Day-scoped dashboard queries |

---

## Deployment

Full step-by-step instructions are in [`doc/`](doc/).

### Lambda (CloudFormation)

1. Zip `infra/src/` and upload to S3
2. Deploy `infra/lambda-stack.yaml` via the CloudFormation console
3. Set parameters: `Environment`, `AlertEmail`, `AlertRiskThreshold`, `TransactionTTLDays`

CloudFormation creates: SQS queue + DLQ, DynamoDB table, Lambda function, SNS topic, CloudWatch alarms.

### Audit Portal

```bash
cd audit-portal-v2
cp .env.example .env.local   # fill in DynamoDB table name and region
npm install
npm run build
npm start                    # production server on :3000
```

### Transaction Generator

```bash
cd transaction-generator
pip install -r requirements.txt
export SQS_QUEUE_URL=https://sqs.<region>.amazonaws.com/<account>/<queue>

python3 generator.py                        # continuous stream
python3 generator.py --mode batch --count 100   # send 100 transactions
python3 generator.py --fraud-mode               # elevated fraud scenarios
python3 generator.py --dry-run                  # print to stdout, no SQS
```

---

## Configuration

### Lambda Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DYNAMODB_TABLE` | *(required)* | DynamoDB table name |
| `ALERT_TOPIC_ARN` | *(optional)* | SNS topic ARN; alerts disabled if empty |
| `ALERT_RISK_THRESHOLD` | `50` | Minimum risk score to trigger an alert |
| `TTL_DAYS` | `90` | Days before DynamoDB auto-expires a record |
| `AWS_REGION` | `us-east-1` | AWS region |

### Audit Portal (`.env.local`)

```env
DYNAMODB_TABLE=payalert-transactions
AWS_REGION=us-east-1
NEXT_PUBLIC_ENVIRONMENT=prod
```

---

## Running Tests

```bash
cd lambda
pip install -r tests/requirements-test.txt
pytest tests/ -v
```

17 unit tests covering the processor and risk scoring engine, using `moto` for DynamoDB/SQS/SNS mocks.

---

## Multi-Environment Support

The CloudFormation template appends an environment suffix to every resource name. Deploy the same template with `Environment=dev`, `staging`, or `prod` to get fully isolated stacks.

---

## License

MIT
