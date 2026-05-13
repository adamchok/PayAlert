# Local Development

This guide covers two ways to run the Lambda handler locally without deploying to AWS:

1. **Unit tests** — mocked AWS via `moto` (no real services needed)
2. **DynamoDB Local** — invoke the handler against a real local DynamoDB instance

---

## Unit Tests

Tests live in `lambda/tests/` and use [moto](https://github.com/getmoto/moto) to mock DynamoDB, SQS, and SNS. No AWS credentials or network access required.

### Setup

```bash
cd lambda/tests

python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

pip install -r requirements-test.txt
```

### Run

```bash
pytest -v
```

Expected output: all tests pass with no real AWS calls made.

### Test structure

| File | What it tests |
|---|---|
| `conftest.py` | Shared fixtures: `dynamodb_table`, `make_transaction`, `make_sqs_event`, `create_test_table` |
| `test_transaction_processor.py` | `process_transaction`, SNS dispatch, `lambda_handler` end-to-end, `_clean_item` |

The `dynamodb_table` fixture creates a fully-configured table (with all three GSIs) inside a `mock_aws` context. Tests that use the `@mock_aws` decorator call `create_test_table()` directly because the decorator starts a fresh mock context outside the fixture.

---

## DynamoDB Local

For manual end-to-end testing, you can run DynamoDB Local (Amazon's official offline emulator) and invoke the Lambda handler directly.

### Step 1 — Start DynamoDB Local

The simplest way is Docker:

```bash
docker run -d -p 8000:8000 --name dynamodb-local \
  amazon/dynamodb-local -jar DynamoDBLocal.jar -inMemory
```

Data is in-memory only — it resets when the container stops. To persist data across restarts, omit `-inMemory` and add `-dbPath` with a volume mount.

Verify it's running:
```bash
curl http://localhost:8000
# Returns: "healthy"
```

### Step 2 — Create the table

```bash
cd lambda
python3 tests/setup_local_table.py
```

This creates the `payalert-transactions` table with all three GSIs in the local instance.

### Step 3 — Set up the virtual environment

The handler itself only needs `boto3`:

```bash
cd lambda
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r transaction-processor/requirements.txt
```

### Step 4 — Invoke the handler

Run a single transaction from `tests/sample_event.json`:

```bash
cd lambda
python3 tests/invoke_local.py
```

Run the five-transaction batch from `tests/local-batch-event.json`:

```bash
python3 tests/invoke_local.py tests/local-batch-event.json
```

The script pre-sets all required environment variables (pointing boto3 at `http://localhost:8000`) before importing `handler.py`. Output is the `batchItemFailures` response JSON.

### Step 5 — Verify stored data

```bash
python3 tests/verify_local.py
```

Prints `transactionId`, `riskLevel`, `riskScore`, and `accountId` for every item in the table, plus a total count.

---

## Environment Variables

| Variable | Default in `invoke_local.py` | Description |
|---|---|---|
| `DYNAMODB_TABLE` | `payalert-transactions` | Table name |
| `AWS_ENDPOINT_URL_DYNAMODB` | `http://localhost:8000` | Points boto3 to DynamoDB Local |
| `ALERT_TOPIC_ARN` | `""` (empty) | Empty string disables SNS publishing |
| `ALERT_RISK_THRESHOLD` | `50` | Minimum riskScore to trigger an alert |
| `TTL_DAYS` | `90` | Transaction expiry in days |
| `AWS_ACCESS_KEY_ID` | `local` | Dummy value accepted by DynamoDB Local |
| `AWS_SECRET_ACCESS_KEY` | `local` | Dummy value accepted by DynamoDB Local |
| `AWS_DEFAULT_REGION` | `ap-southeast-1` | Region (affects table ARN construction) |

You can override any of these by setting the environment variable before running `invoke_local.py`:

```bash
ALERT_TOPIC_ARN="" ALERT_RISK_THRESHOLD=30 python3 tests/invoke_local.py
```

---

## The `worker.py` Pipeline Script

`tests/worker.py` is a streaming processor used in Docker-based end-to-end runs with the transaction generator. It reads newline-delimited JSON transactions from stdin, wraps each one in a minimal SQS event envelope, and calls `lambda_handler` directly.

```bash
# Example: pipe 100 generated transactions through the Lambda handler
python3 ../transaction-generator/generator.py --count 100 --dry-run \
  | python3 tests/worker.py
```

The script exits with code `1` if any transaction failed, `0` if all succeeded.

---

## Tips

- **Handler module reload:** The handler initialises boto3 clients and reads env vars at import time (module level). `invoke_local.py` sets env vars before the import, so restarting the script picks up any env changes.
- **Table already exists:** `setup_local_table.py` is idempotent — it prints `"Table already exists"` and exits cleanly if you run it twice.
- **DynamoDB Local admin UI:** The [NoSQL Workbench](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/workbench.settingup.html) desktop app can connect to `localhost:8000` and provides a visual table browser.
