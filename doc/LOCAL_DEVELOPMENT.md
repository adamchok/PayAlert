# PayAlert — Local Development Guide

How to run each component of the PayAlert architecture on your machine, without deploying to AWS.

> **Platform:** These instructions target **Ubuntu 26.04 LTS**. Commands are standard bash — they also work on macOS with no changes. Windows users should run commands inside **WSL2** (Ubuntu), or substitute `python3` with `python` and adjust path separators where needed.

---

## Overview

| Goal | What you need | AWS required? |
|---|---|---|
| Test the generator output | Python only | No |
| Run Lambda unit tests | Python only | No |
| Invoke the Lambda locally | Python only | No |
| Run the audit portal | Node.js + AWS credentials | Real AWS only |
| Full local pipeline | Python + Node.js + Docker (DynamoDB Local) | **No** |

Work through the sections that match your goal. Section 5 (full local pipeline) is the most complete — it wires DynamoDB Local → Lambda → Next.js portal entirely on your machine.

---

## Prerequisites

| Tool | Sections needed | Install on Ubuntu 26.04 |
|---|---|---|
| Python 3.11+ | 1, 2, 3, 5 | `sudo apt install python3 python3-pip python3-venv` |
| Node.js 20+ | 4, 5 | `curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo -E bash - && sudo apt install nodejs` |
| Docker Desktop | Section 5 (DynamoDB Local only) | [docs.docker.com/desktop/linux](https://docs.docker.com/desktop/linux/) |
| AWS credentials | Section 4 only | env vars or `~/.aws/credentials` |

> **No AWS CLI, SAM CLI, or Docker required for Sections 1–3.**

---

## 1. Transaction Generator (no AWS, no Docker)

The generator can run completely offline using `--dry-run`, which prints transactions to stdout instead of sending them to SQS.

### 1.1 Install dependencies

```bash
cd transaction-generator/
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 1.2 Dry-run (zero AWS dependencies)

```bash
# Print 5 transactions to stdout
python3 generator.py --dry-run --mode batch --count 5

# Print continuously (Ctrl+C to stop)
python3 generator.py --dry-run

# Print fraud-scenario transactions
python3 generator.py --dry-run --fraud-mode --mode batch --count 10

# Pin to one account
python3 generator.py --dry-run --mode batch --count 5 --account ACC-MY-4F291A3B
```

Each transaction is printed as a JSON object. This is the exact payload shape that the Lambda function receives inside an SQS message body.

### 1.3 Verbose mode

```bash
python3 generator.py --dry-run --verbose
```

Verbose mode prints the risk-scoring breakdown alongside each transaction — useful for understanding why a transaction is flagged.

---

## 2. Lambda Unit Tests (no AWS, no Docker)

The Lambda tests use [moto](https://docs.getmoto.org/) to mock DynamoDB and SNS in-process. No real AWS resources are touched.

### 2.1 Install test dependencies

```bash
cd infra/
python3 -m venv .venv
source .venv/bin/activate
pip install -r tests/requirements-test.txt
```

### 2.2 Run all tests

```bash
pytest tests/ -v
```

Expected output:

```
tests/test_transaction_processor.py::TestProcessTransaction::test_stores_transaction_in_dynamodb PASSED
tests/test_transaction_processor.py::TestProcessTransaction::test_datePartition_computed_from_timestamp PASSED
tests/test_transaction_processor.py::TestProcessTransaction::test_duplicate_transaction_is_skipped_without_error PASSED
tests/test_transaction_processor.py::TestProcessTransaction::test_missing_transaction_id_raises PASSED
tests/test_transaction_processor.py::TestProcessTransaction::test_floats_stored_as_decimal PASSED
tests/test_transaction_processor.py::TestProcessTransaction::test_none_values_stripped_from_stored_item PASSED
tests/test_transaction_processor.py::TestAlertDispatch::test_high_risk_transaction_publishes_alert PASSED
tests/test_transaction_processor.py::TestAlertDispatch::test_low_risk_transaction_does_not_publish_alert PASSED
tests/test_transaction_processor.py::TestAlertDispatch::test_alert_subject_contains_risk_level_and_account PASSED
tests/test_transaction_processor.py::TestLambdaHandler::test_successful_batch_returns_no_failures PASSED
tests/test_transaction_processor.py::TestLambdaHandler::test_invalid_json_body_reports_batch_item_failure PASSED
tests/test_transaction_processor.py::TestLambdaHandler::test_partial_batch_failure_only_reports_failed_messages PASSED
tests/test_transaction_processor.py::TestLambdaHandler::test_empty_event_returns_empty_failures PASSED
tests/test_transaction_processor.py::TestCleanItem::test_float_converted_to_decimal PASSED
tests/test_transaction_processor.py::TestCleanItem::test_none_values_removed PASSED
tests/test_transaction_processor.py::TestCleanItem::test_nested_dict_cleaned PASSED
tests/test_transaction_processor.py::TestCleanItem::test_list_of_floats_converted PASSED

14 passed
```

### 2.3 Run a specific test class

```bash
pytest tests/ -v -k "TestAlertDispatch"
```

---

## 3. Lambda: Direct Python Invocation (no Docker)

The Lambda handler is a plain Python function. You can invoke it directly — no Docker, no SAM CLI required. The helper script `tests/invoke_local.py` sets the required environment variables (including the DynamoDB Local endpoint) before importing the handler module.

### 3.1 Install handler dependencies

```bash
cd infra/
python3 -m venv .venv
source .venv/bin/activate
pip install -r transaction-processor/requirements.txt
pip install -r tests/requirements-test.txt  # only needed if also running unit tests
```

### 3.2 Create a sample SQS event file

Save this as `infra/tests/sample_event.json`:

```json
{
  "Records": [
    {
      "messageId": "local-001",
      "receiptHandle": "local-receipt-001",
      "body": "{\"transactionId\":\"local-test-0001-0000-0000-000000001\",\"accountId\":\"ACC-MY-4F291A3B\",\"amount\":125.50,\"currency\":\"MYR\",\"timestamp\":\"2026-05-11T14:30:22+0800\",\"merchantId\":\"MER-LSS-0001\",\"transactionType\":\"PURCHASE\",\"referenceId\":\"PAY-LOCAL-001\",\"description\":\"Contactless payment at Lotus's Supermarket\",\"channel\":\"CONTACTLESS\",\"merchantName\":\"Lotus's Supermarket\",\"merchantCategory\":\"GROCERY\",\"merchantCity\":\"Kuala Lumpur\",\"merchantState\":\"Wilayah Persekutuan\",\"merchantCountry\":\"MY\",\"customerId\":\"CUST-4F291A3B\",\"customerName\":\"Ahmad Farid bin Ismail\",\"customerEmail\":\"customer@example.com\",\"customerTier\":\"GOLD\",\"cardLast4\":\"4821\",\"cardType\":\"VISA_DEBIT\",\"location\":{\"city\":\"Kuala Lumpur\",\"state\":\"Wilayah Persekutuan\",\"country\":\"MY\"},\"exchangeRate\":1.0,\"amountMYR\":125.50,\"riskScore\":5,\"riskLevel\":\"LOW\",\"riskFlags\":[],\"isFlagged\":false,\"flagReason\":null,\"generatorVersion\":\"2.0.0\"}",
      "attributes": {},
      "messageAttributes": {},
      "md5OfBody": "",
      "eventSource": "aws:sqs",
      "eventSourceARN": "arn:aws:sqs:us-east-1:123456789012:payalert-transactions-queue-dev",
      "awsRegion": "us-east-1"
    }
  ]
}
```

### 3.3 Invoke against real AWS DynamoDB

Reads AWS credentials from the standard boto3 chain (environment variables or `~/.aws/credentials`). Setting both SNS topic ARNs to empty disables all SNS publishing — no SNS topics required.

```bash
cd infra/
source .venv/bin/activate

DYNAMODB_TABLE=payalert-transactions \
ALERT_TOPIC_ARN="" \
CUSTOMER_RECEIPT_TOPIC_ARN="" \
ALERT_RISK_THRESHOLD=50 \
TTL_DAYS=90 \
AWS_DEFAULT_REGION=us-east-1 \
python3 -c "
import os, json, sys
sys.path.insert(0, 'transaction-processor/')
import handler
with open('tests/sample_event.json') as f:
    event = json.load(f)
print(json.dumps(handler.lambda_handler(event, None), indent=2))
"
```

Expected output:

```json
{"batchItemFailures": []}
```

---

## 4. Audit Portal (local, against real AWS DynamoDB)

The portal is a Next.js 16 application. It reads from DynamoDB directly via AWS SDK v3 server-side API routes — no EC2 or SQS required. You need valid AWS credentials and a deployed `payalert-stack`.

### 4.1 Install dependencies

```bash
cd audit-portal-v2/
npm install
```

### 4.2 Configure environment

Create `audit-portal-v2/.env.local`:

```env
DYNAMODB_TABLE=payalert-transactions-dev
AWS_REGION=us-east-1
NEXT_PUBLIC_ENVIRONMENT=dev
MAIN_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/<account-id>/payalert-transactions-queue-dev
AUTH_SECRET=any-string-for-local-dev
PORTAL_USERNAME=admin
PORTAL_PASSWORD=admin
```

AWS credentials are read from the standard SDK chain — set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in your shell, or configure `~/.aws/credentials`.

### 4.3 Run

```bash
npm run dev
```

Open `http://localhost:3000` in a browser. Login with the `PORTAL_USERNAME` / `PORTAL_PASSWORD` set above.

The portal queries your real DynamoDB table in AWS. If you have already deployed the Lambda stack and the generator has been running, you will see live data.

---

## 5. Full Local Pipeline (no AWS required)

This section wires up the complete pipeline on your machine:

```
generator.py --dry-run
     │  (JSON payloads)
     ▼
tests/invoke_local.py  ──────────────────►  DynamoDB Local (Docker)
                                                      │
                                                      ▼
                                           audit-portal-v2 (Next.js)
                                           http://localhost:3000
```

SQS is bypassed entirely — transaction payloads are fed directly to the Lambda handler function as SQS event files. SNS alerts and receipts are disabled. Everything else (Lambda processing logic, DynamoDB writes, portal queries) runs exactly as it does in production.

> **Known limitation:** The `FailedTransactionsIndex` GSI is not created by `setup_local_table.py`, so the **Failed Transactions** page in the portal will not return results locally. All other portal pages work fully.

### 5.1 Start DynamoDB Local

Open a dedicated terminal. DynamoDB Local runs in Docker and stays open for the rest of the session.

```bash
# Pull the image (first time only)
docker pull amazon/dynamodb-local

# Start DynamoDB Local
docker run --rm \
  --name dynamodb-local \
  -p 8000:8000 \
  amazon/dynamodb-local \
  -jar DynamoDBLocal.jar -sharedDb -inMemory
```

Leave this terminal open. The `-inMemory` flag means all data is lost when the container stops — run `tests/setup_local_table.py` again each time you restart it.

### 5.2 Create the DynamoDB table

In a new terminal, run the setup script once per session:

```bash
cd infra/
source .venv/bin/activate   # activate venv from Section 3.1
python3 tests/setup_local_table.py
```

Expected output:

```
Table created: payalert-transactions
```

Running it a second time prints `Table already exists — skipping creation.`

### 5.3 Load the sample batch

```bash
cd infra/
source .venv/bin/activate
python3 tests/invoke_local.py tests/local-batch-event.json
```

Expected output:

```json
{"batchItemFailures": []}
```

Save the file below as `infra/tests/local-batch-event.json` if it does not already exist. It contains five transactions covering all four risk levels.

> Update the `timestamp` dates to today if you want them to appear on the dashboard (which groups by `datePartition` = today's date).

```json
{
  "Records": [
    {
      "messageId": "local-001", "receiptHandle": "r1", "attributes": {}, "messageAttributes": {}, "md5OfBody": "", "eventSource": "aws:sqs", "eventSourceARN": "arn:aws:sqs:us-east-1:000000000000:local", "awsRegion": "us-east-1",
      "body": "{\"transactionId\":\"local-0000-0000-0000-000000000001\",\"accountId\":\"ACC-MY-4F291A3B\",\"amount\":45.50,\"currency\":\"MYR\",\"timestamp\":\"2026-06-16T09:15:00+0800\",\"merchantId\":\"MER-LSS-0001\",\"transactionType\":\"PURCHASE\",\"referenceId\":\"PAY-LOCAL-001\",\"description\":\"Contactless payment at Lotus's Supermarket\",\"channel\":\"CONTACTLESS\",\"merchantName\":\"Lotus's Supermarket\",\"merchantCategory\":\"GROCERY\",\"merchantCity\":\"Kuala Lumpur\",\"merchantState\":\"Wilayah Persekutuan\",\"merchantCountry\":\"MY\",\"customerId\":\"CUST-4F291A3B\",\"customerName\":\"Ahmad Farid bin Ismail\",\"customerEmail\":\"customer@example.com\",\"customerTier\":\"GOLD\",\"cardLast4\":\"4821\",\"cardType\":\"VISA_DEBIT\",\"location\":{\"city\":\"Kuala Lumpur\",\"state\":\"Wilayah Persekutuan\",\"country\":\"MY\"},\"exchangeRate\":1.0,\"amountMYR\":45.50,\"riskScore\":5,\"riskLevel\":\"LOW\",\"riskFlags\":[],\"isFlagged\":false,\"flagReason\":null,\"generatorVersion\":\"2.0.0\"}"
    },
    {
      "messageId": "local-002", "receiptHandle": "r2", "attributes": {}, "messageAttributes": {}, "md5OfBody": "", "eventSource": "aws:sqs", "eventSourceARN": "arn:aws:sqs:us-east-1:000000000000:local", "awsRegion": "us-east-1",
      "body": "{\"transactionId\":\"local-0000-0000-0000-000000000002\",\"accountId\":\"ACC-MY-7C8D1E4F\",\"amount\":1200.00,\"currency\":\"MYR\",\"timestamp\":\"2026-06-16T11:42:00+0800\",\"merchantId\":\"MER-AIR-0001\",\"transactionType\":\"PURCHASE\",\"referenceId\":\"PAY-LOCAL-002\",\"description\":\"AirAsia flight booking\",\"channel\":\"ONLINE\",\"merchantName\":\"AirAsia\",\"merchantCategory\":\"AIRLINE\",\"merchantCity\":\"Kuala Lumpur\",\"merchantState\":\"Wilayah Persekutuan\",\"merchantCountry\":\"MY\",\"customerId\":\"CUST-7C8D1E4F\",\"customerName\":\"Nurul Ain binti Razak\",\"customerEmail\":\"customer@example.com\",\"customerTier\":\"PLATINUM\",\"cardLast4\":\"9923\",\"cardType\":\"MASTERCARD_CREDIT\",\"location\":{\"city\":\"Kuala Lumpur\",\"state\":\"Wilayah Persekutuan\",\"country\":\"MY\"},\"exchangeRate\":1.0,\"amountMYR\":1200.00,\"riskScore\":30,\"riskLevel\":\"MEDIUM\",\"riskFlags\":[\"ROUND_AMOUNT\"],\"isFlagged\":false,\"flagReason\":null,\"generatorVersion\":\"2.0.0\"}"
    },
    {
      "messageId": "local-003", "receiptHandle": "r3", "attributes": {}, "messageAttributes": {}, "md5OfBody": "", "eventSource": "aws:sqs", "eventSourceARN": "arn:aws:sqs:us-east-1:000000000000:local", "awsRegion": "us-east-1",
      "body": "{\"transactionId\":\"local-0000-0000-0000-000000000003\",\"accountId\":\"ACC-MY-2B5E9C1D\",\"amount\":4800.00,\"currency\":\"SGD\",\"timestamp\":\"2026-06-16T13:05:00+0800\",\"merchantId\":\"MER-ZAR-SG01\",\"transactionType\":\"PURCHASE\",\"referenceId\":\"PAY-LOCAL-003\",\"description\":\"Zara Singapore — online order\",\"channel\":\"ONLINE\",\"merchantName\":\"Zara\",\"merchantCategory\":\"APPAREL\",\"merchantCity\":\"Singapore\",\"merchantState\":\"Central Region\",\"merchantCountry\":\"SG\",\"customerId\":\"CUST-2B5E9C1D\",\"customerName\":\"Lim Wei Jian\",\"customerEmail\":\"customer@example.com\",\"customerTier\":\"STANDARD\",\"cardLast4\":\"3341\",\"cardType\":\"MASTERCARD_DEBIT\",\"location\":{\"city\":\"Singapore\",\"state\":\"Central Region\",\"country\":\"SG\"},\"exchangeRate\":3.50,\"amountMYR\":16800.00,\"riskScore\":65,\"riskLevel\":\"HIGH\",\"riskFlags\":[\"VERY_HIGH_AMOUNT\",\"CROSS_BORDER\",\"FOREIGN_CURRENCY\"],\"isFlagged\":true,\"flagReason\":\"VERY_HIGH_AMOUNT | CROSS_BORDER | FOREIGN_CURRENCY\",\"generatorVersion\":\"2.0.0\"}"
    },
    {
      "messageId": "local-004", "receiptHandle": "r4", "attributes": {}, "messageAttributes": {}, "md5OfBody": "", "eventSource": "aws:sqs", "eventSourceARN": "arn:aws:sqs:us-east-1:000000000000:local", "awsRegion": "us-east-1",
      "body": "{\"transactionId\":\"local-0000-0000-0000-000000000004\",\"accountId\":\"ACC-MY-4F291A3B\",\"amount\":9500.00,\"currency\":\"USD\",\"timestamp\":\"2026-06-16T02:30:00+0800\",\"merchantId\":\"ATM-CITI-US01\",\"transactionType\":\"WITHDRAWAL\",\"referenceId\":\"PAY-LOCAL-004\",\"description\":\"ATM cash withdrawal - New York, US\",\"channel\":\"ATM\",\"merchantName\":\"Citibank ATM (USA)\",\"merchantCategory\":\"ATM_WITHDRAWAL\",\"merchantCity\":\"New York\",\"merchantState\":\"New York\",\"merchantCountry\":\"US\",\"customerId\":\"CUST-4F291A3B\",\"customerName\":\"Ahmad Farid bin Ismail\",\"customerEmail\":\"customer@example.com\",\"customerTier\":\"GOLD\",\"cardLast4\":\"4821\",\"cardType\":\"VISA_DEBIT\",\"location\":{\"city\":\"New York\",\"state\":\"New York\",\"country\":\"US\"},\"exchangeRate\":4.72,\"amountMYR\":44840.00,\"riskScore\":95,\"riskLevel\":\"CRITICAL\",\"riskFlags\":[\"VERY_HIGH_AMOUNT\",\"UNUSUAL_HOUR\",\"CROSS_BORDER\",\"INTERNATIONAL_ATM\",\"FOREIGN_CURRENCY\"],\"isFlagged\":true,\"flagReason\":\"VERY_HIGH_AMOUNT | UNUSUAL_HOUR | CROSS_BORDER | INTERNATIONAL_ATM | FOREIGN_CURRENCY\",\"generatorVersion\":\"2.0.0\",\"fraudScenario\":\"cross_border_atm\"}"
    },
    {
      "messageId": "local-005", "receiptHandle": "r5", "attributes": {}, "messageAttributes": {}, "md5OfBody": "", "eventSource": "aws:sqs", "eventSourceARN": "arn:aws:sqs:us-east-1:000000000000:local", "awsRegion": "us-east-1",
      "body": "{\"transactionId\":\"local-0000-0000-0000-000000000005\",\"accountId\":\"ACC-MY-9A6F2D8E\",\"amount\":32.00,\"currency\":\"MYR\",\"timestamp\":\"2026-06-16T12:10:00+0800\",\"merchantId\":\"MER-GRB-0001\",\"transactionType\":\"PURCHASE\",\"referenceId\":\"PAY-LOCAL-005\",\"description\":\"GrabFood delivery order\",\"channel\":\"MOBILE_APP\",\"merchantName\":\"GrabFood\",\"merchantCategory\":\"FOOD_DELIVERY\",\"merchantCity\":\"George Town\",\"merchantState\":\"Pulau Pinang\",\"merchantCountry\":\"MY\",\"customerId\":\"CUST-9A6F2D8E\",\"customerName\":\"Priya a/p Subramaniam\",\"customerEmail\":\"customer@example.com\",\"customerTier\":\"GOLD\",\"cardLast4\":\"7712\",\"cardType\":\"VISA_CREDIT\",\"location\":{\"city\":\"George Town\",\"state\":\"Pulau Pinang\",\"country\":\"MY\"},\"exchangeRate\":1.0,\"amountMYR\":32.00,\"riskScore\":8,\"riskLevel\":\"LOW\",\"riskFlags\":[],\"isFlagged\":false,\"flagReason\":null,\"generatorVersion\":\"2.0.0\"}"
    }
  ]
}
```

### 5.4 Verify the items were written

```bash
python3 tests/verify_local.py
```

Expected output (order may vary):

```
{'accountId': 'ACC-MY-4F291A3B', 'riskLevel': 'LOW', 'transactionId': 'local-0000-0000-0000-000000000001', 'riskScore': '5'}
{'accountId': 'ACC-MY-7C8D1E4F', 'riskLevel': 'MEDIUM', 'transactionId': 'local-0000-0000-0000-000000000002', 'riskScore': '30'}
{'accountId': 'ACC-MY-2B5E9C1D', 'riskLevel': 'HIGH', 'transactionId': 'local-0000-0000-0000-000000000003', 'riskScore': '65'}
{'accountId': 'ACC-MY-4F291A3B', 'riskLevel': 'CRITICAL', 'transactionId': 'local-0000-0000-0000-000000000004', 'riskScore': '95'}
{'accountId': 'ACC-MY-9A6F2D8E', 'riskLevel': 'LOW', 'transactionId': 'local-0000-0000-0000-000000000005', 'riskScore': '8'}

Total items: 5
```

Run the invoke command a second time to confirm idempotency — you should still see exactly 5 items (duplicates are silently discarded by the conditional put).

### 5.5 Run the audit portal against DynamoDB Local

Create `audit-portal-v2/.env.local` for local development:

```env
DYNAMODB_TABLE=payalert-transactions
AWS_REGION=us-east-1
AWS_ENDPOINT_URL_DYNAMODB=http://localhost:8000
AWS_ACCESS_KEY_ID=local
AWS_SECRET_ACCESS_KEY=local
NEXT_PUBLIC_ENVIRONMENT=dev
MAIN_QUEUE_URL=
AUTH_SECRET=local-dev-secret
PORTAL_USERNAME=admin
PORTAL_PASSWORD=admin
```

Then start the portal:

```bash
cd audit-portal-v2/
npm install   # first time only
npm run dev
```

Open `http://localhost:3000`. Login with `admin` / `admin`.

You should see:
- **Dashboard** → Total: 5 / Flagged: 2 / HIGH: 1 / CRITICAL: 1
- The CRITICAL row for Ahmad Farid (Citibank ATM, New York) highlighted in red
- The HIGH row for Lim Wei Jian (Zara Singapore) highlighted in orange/yellow

Click any Account ID to see per-account history. Click any Transaction ID for the full detail view with risk gauge and merchant map.

> **Failed Transactions page** will show no results locally — `FailedTransactionsIndex` is not created by `setup_local_table.py`. All other pages work fully.

### 5.6 Load more test data

To add more variety, pipe the generator's dry-run output directly into the Lambda handler:

```bash
cd transaction-generator/
source .venv/bin/activate

python3 generator.py --dry-run --mode batch --count 1 | \
python3 -c "
import sys, json
body = sys.stdin.read().strip()
event = {'Records': [{'messageId': 'gen-001', 'receiptHandle': 'r',
  'body': body, 'attributes': {}, 'messageAttributes': {}, 'md5OfBody': '',
  'eventSource': 'aws:sqs',
  'eventSourceARN': 'arn:aws:sqs:us-east-1:000000000000:local',
  'awsRegion': 'us-east-1'}]}
print(json.dumps(event))
" > /tmp/gen-event.json

cd ../infra/
source .venv/bin/activate
python3 tests/invoke_local.py /tmp/gen-event.json
```

Refresh the portal to see the new transaction.

---

## Quick Reference

### Starting the full local stack

Open three terminals:

**Terminal 1 — DynamoDB Local:**
```bash
docker run --rm --name dynamodb-local \
  -p 8000:8000 \
  amazon/dynamodb-local -jar DynamoDBLocal.jar -sharedDb -inMemory
```

**Terminal 2 — Create table + load data:**
```bash
cd infra/
source .venv/bin/activate

# Create table (run once per DynamoDB Local session)
python3 tests/setup_local_table.py

# Load the 5-transaction sample batch
python3 tests/invoke_local.py tests/local-batch-event.json

# Verify
python3 tests/verify_local.py
```

**Terminal 3 — Audit Portal:**
```bash
cd audit-portal-v2/
npm run dev
```

Open `http://localhost:3000` — login with `admin` / `admin`.

---

### File cheat sheet

| File | Purpose |
|---|---|
| `infra/tests/setup_local_table.py` | Create DynamoDB Local table with all GSIs (run once per session) |
| `infra/tests/invoke_local.py` | Invoke the Lambda handler directly against DynamoDB Local |
| `infra/tests/verify_local.py` | Print a summary of all items in the local table |
| `infra/tests/local-batch-event.json` | 5-transaction SQS event (all four risk levels) |
| `infra/tests/sample_event.json` | Single-transaction SQS event |
| `audit-portal-v2/.env.local` | Portal environment variables (create from Section 5.5) |

---

### Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `docker: Cannot connect to the Docker daemon` | Docker Desktop not running | Open Docker Desktop and wait for it to start |
| `EndpointResolutionError` on `invoke_local.py` | DynamoDB Local not running | Start the DynamoDB Local container (Terminal 1) |
| `ResourceNotFoundException` on invoke | Table not created yet | Run `python3 tests/setup_local_table.py` |
| Portal shows blank dashboard | Table empty or wrong date | Run `invoke_local.py`; check timestamps in event file match today's date |
| Portal login fails | `AUTH_SECRET` not set or wrong credentials | Check `audit-portal-v2/.env.local` — `PORTAL_USERNAME` and `PORTAL_PASSWORD` must match login |
| `Error: No module named 'boto3'` in `invoke_local.py` | Lambda venv not activated | `source .venv/bin/activate` inside `infra/` |
| `python3-venv` not found | Ubuntu missing venv package | `sudo apt install python3-venv` |
| `npm: command not found` | Node.js not installed | Install Node.js 20+ (see Prerequisites) |
| Failed Transactions page empty locally | `FailedTransactionsIndex` not in local table | Known limitation — this page only works against real AWS |
