# PayAlert Lambda Pipeline

Real-time transaction processing layer for the PayAlert fraud detection system. This directory contains the AWS CloudFormation infrastructure template and the **Transaction Processor** Lambda function that bridges the SQS queue (fed by the EC2 transaction generator) to DynamoDB, with automatic SNS email alerts for high-risk transactions.

---

## Architecture

```
EC2 Producer
(transaction-generator/generator.py)
        │
        │  SQS batch send (1–5 tx per burst, 0.1–2.0 s interval)
        ▼
┌───────────────────────────────┐
│   SQS Standard Queue          │  payalert-transactions-queue-{env}
│   VisibilityTimeout: 180 s    │
│   Redrive → DLQ after 3×      │
└───────────────────────────────┘
        │
        │  SQS event source mapping  (batch size 10, partial batch failure)
        ▼
┌───────────────────────────────┐
│   Lambda: Transaction         │  payalert-transaction-processor-{env}
│   Processor                   │  Python 3.11 · arm64 · 256 MB · 30 s
│                               │
│   • Parse & validate JSON     │
│   • Add processedAt, ttl,     │
│     datePartition             │
│   • Idempotent DynamoDB put   │
│   • Publish SNS if            │
│     riskScore >= threshold    │
└───────────────────────────────┘
        │                  │
        │                  │  SNS publish (riskScore >= 50 by default)
        ▼                  ▼
┌─────────────────┐  ┌─────────────────────────────────┐
│   DynamoDB      │  │   SNS Topic                     │
│   Transactions  │  │   payalert-alerts-{env}         │
│   Table         │  │                                 │
│                 │  │   → Email subscription          │
│   3 GSIs:       │  │     (confirmed after deploy)    │
│   • by account  │  └─────────────────────────────────┘
│   • by risk     │
│   • by date     │
└─────────────────┘
        │
        ▼
   Audit Portal
   (audit-portal/ — see that directory)
```

### Supporting Infrastructure

| Resource | Name pattern | Purpose |
|---|---|---|
| SQS Queue | `payalert-transactions-queue-{env}` | Primary ingest queue |
| SQS DLQ | `payalert-transactions-dlq-{env}` | Captures messages that fail 3× |
| DynamoDB Table | `payalert-transactions-{env}` | Persistent transaction store |
| SNS Topic | `payalert-alerts-{env}` | Email fan-out for fraud alerts |
| CloudWatch Alarm | `payalert-dlq-depth-{env}` | Fires when DLQ receives any message |
| CloudWatch Alarm | `payalert-processor-errors-{env}` | Fires on ≥ 5 Lambda errors / 5 min |
| CloudWatch Alarm | `payalert-processor-throttles-{env}` | Fires on any Lambda throttle |

---

## Directory Structure

```
infra/
├── README.md                        # This file
├── lambda-stack.yaml                # CloudFormation / SAM transform template
├── .gitignore
├── transaction-processor/
│   ├── handler.py                   # Lambda entry point
│   └── requirements.txt
└── tests/
    ├── conftest.py                  # Shared fixtures and helper factories
    ├── test_transaction_processor.py
    └── requirements-test.txt
```

---

## DynamoDB Schema

### Table: `payalert-transactions-{env}`

**Primary key**

| Attribute | Type | Key |
|---|---|---|
| `transactionId` | String (UUID v4) | Partition key |

All other attributes are non-key enrichment fields forwarded from the generator, plus the three fields added by the Lambda processor at write time.

**Fields added by the processor**

| Attribute | Type | Description |
|---|---|---|
| `processedAt` | String (ISO-8601 UTC) | Lambda write timestamp |
| `datePartition` | String (`YYYY-MM-DD`) | Derived from `timestamp[:10]`; used by DatePartitionIndex |
| `ttl` | Number (Unix epoch) | Auto-expire time (default: 90 days from `processedAt`) |

**Global Secondary Indexes**

| Index | Partition Key | Sort Key | Use case |
|---|---|---|---|
| `AccountTransactionsIndex` | `accountId` | `timestamp` | All transactions for one customer, chronological |
| `RiskLevelIndex` | `riskLevel` | `timestamp` | All HIGH / CRITICAL transactions across all accounts |
| `DatePartitionIndex` | `datePartition` | `timestamp` | Full transaction feed for a given calendar day |

**Example query patterns for the audit portal**

```python3
# All transactions for account ACC-MY-4F291A3B today
table.query(
    IndexName="AccountTransactionsIndex",
    KeyConditionExpression=Key("accountId").eq("ACC-MY-4F291A3B")
        & Key("timestamp").begins_with("2026-05-09"),
)

# All CRITICAL transactions on 2026-05-09
table.query(
    IndexName="RiskLevelIndex",
    KeyConditionExpression=Key("riskLevel").eq("CRITICAL")
        & Key("timestamp").begins_with("2026-05-09"),
)

# Full transaction feed for 2026-05-09 (newest first)
table.query(
    IndexName="DatePartitionIndex",
    KeyConditionExpression=Key("datePartition").eq("2026-05-09"),
    ScanIndexForward=False,
)
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| AWS account | With permission to create CloudFormation stacks, S3 buckets, Lambda, SQS, DynamoDB, SNS, IAM roles, and CloudWatch resources |
| Python 3.11+ | Required only for packaging the Lambda function locally (`sudo apt install python3 python3-pip` on Ubuntu 26.04) |
| Web browser | For the AWS Management Console |
| SSH client | Built into Ubuntu and macOS terminals; PuTTY on Windows |

> **No AWS CLI, SAM CLI, or Docker required.** Everything is deployed through the AWS Management Console.

### IAM permissions for the deploying identity

The AWS user or role you log in with needs at minimum:

- `cloudformation:*`
- `s3:CreateBucket`, `s3:PutObject`, `s3:GetObject`
- `lambda:*`, `sqs:*`, `dynamodb:*`, `sns:*`
- `iam:CreateRole`, `iam:AttachRolePolicy`, `iam:PassRole`
- `logs:*`, `cloudwatch:*`

---

## Deployment

### Step 1 — Create an S3 bucket for the Lambda artifact

The Lambda deployment package must be stored in S3 before CloudFormation can reference it.

1. Open the **[S3 Console](https://s3.console.aws.amazon.com/s3/buckets)**.
2. Click **Create bucket**.
3. Configure the bucket:
   - **Bucket name**: `payalert-artifacts-{your-12-digit-account-id}` (must be globally unique; substitute your actual account ID)
   - **AWS Region**: `us-east-1`
   - Leave all other settings at their defaults.
4. Click **Create bucket**.

---

### Step 2 — Package the Lambda function

The Lambda handler (`handler.py`) uses only `boto3`, which is pre-installed in the Lambda runtime. The deployment package is a single zip containing the handler file.

Run the following from the `infra/transaction-processor/` directory on your workstation:

**macOS / Linux**

```bash
cd infra/transaction-processor/
zip function.zip handler.py
```

**Windows (PowerShell)**

```powershell
cd lambda\transaction-processor\
Compress-Archive -Path handler.py -DestinationPath function.zip
```

Result: `infra/transaction-processor/function.zip`

---

### Step 3 — Upload the Lambda zip to S3

1. Open the **[S3 Console](https://s3.console.aws.amazon.com/s3/buckets)**.
2. Click the bucket you created in Step 1 (`payalert-artifacts-{account-id}`).
3. Click **Upload** → **Add files** → select `function.zip` → **Upload**.

Note the S3 URI for use in the next step:

```
s3://payalert-artifacts-{account-id}/function.zip
```

---

### Step 4 — Update the CloudFormation template

Open `infra/lambda-stack.yaml` in a text editor and replace the `CodeUri` line under `TransactionProcessorFunction`:

```yaml
# Before (SAM local path — not valid for console deployment)
CodeUri: transaction-processor/

# After (S3 URI — replace with your actual bucket name)
CodeUri: s3://payalert-artifacts-{account-id}/function.zip
```

Save the file.

---

### Step 5 — Deploy via CloudFormation Console

1. Open the **[CloudFormation Console](https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1)**.
2. Click **Create stack** → **With new resources (standard)**.
3. Under **Template source**, select **Upload a template file** → **Choose file** → select `infra/lambda-stack.yaml` → **Next**.
4. Fill in the stack details:
   - **Stack name**: `payalert-dev`
5. Fill in the parameters:

| Parameter | Value | Description |
|---|---|---|
| `Environment` | `dev` | Appended to all resource names |
| `AlertEmail` | your real email address | Recipient for HIGH/CRITICAL alerts |
| `AlertRiskThreshold` | `50` | Minimum `riskScore` to trigger an alert |
| `TransactionTTLDays` | `90` | Days before DynamoDB auto-expires a transaction |

6. Click **Next** → **Next**.
7. Under **Capabilities** at the bottom of the page, check:  
   **☑ I acknowledge that AWS CloudFormation might create IAM resources.**
8. Click **Submit**.

The **Events** tab updates in real time. Wait for the stack status to reach **CREATE_COMPLETE** (approximately 2–3 minutes).

---

### Step 6 — Retrieve the stack outputs

1. Open the **[CloudFormation Console](https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1)**.
2. Click the `payalert-dev` stack → **Outputs** tab.

| Key | Example value |
|---|---|
| `TransactionQueueUrl` | `https://sqs.us-east-1.amazonaws.com/123456789012/payalert-transactions-queue-dev` |
| `TransactionsTableName` | `payalert-transactions-dev` |
| `AlertTopicArn` | `arn:aws:sns:us-east-1:123456789012:payalert-alerts-dev` |

Keep the `TransactionQueueUrl` handy — it is needed when configuring the transaction generator.

---

### Step 7 — Confirm the SNS email subscription

AWS sends a confirmation email to `AlertEmail` immediately after deployment. Open the email from `no-reply@sns.amazonaws.com` and click **Confirm subscription**. Alert emails are not delivered until this step is completed.

To verify the subscription status:

1. Open the **[SNS Console](https://us-east-1.console.aws.amazon.com/sns/v3/home?region=us-east-1#/subscriptions)**.
2. Locate the subscription for `payalert-alerts-dev`.
3. The **Status** column should show **Confirmed** (not `PendingConfirmation`).

---

### Step 8 — Configure the transaction generator

Set the `TransactionQueueUrl` from Step 6 on the EC2 producer instance. Refer to `transaction-generator/README.md` for full EC2 setup instructions.

---

## Deploying to a Different Environment

To deploy staging or prod stacks, repeat Steps 5–7 with the following parameter changes:

| | dev | staging | prod |
|---|---|---|---|
| Stack name | `payalert-dev` | `payalert-staging` | `payalert-prod` |
| `Environment` | `dev` | `staging` | `prod` |
| `AlertEmail` | your email | your email | your email |
| `TransactionTTLDays` | `90` | `90` | `365` |

Each environment creates an independent set of resources with the environment suffix in the name (e.g. `payalert-transactions-queue-prod`).

---

## Running Tests Locally

### Install test dependencies

```bash
cd infra/
pip install -r tests/requirements-test.txt
```

### Run all tests

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

17 passed in ...s
```

All tests use [moto](https://docs.getmoto.org/) to mock AWS services in-process — no real AWS resources are touched.

---

## Testing the Live Deployment

### Send a test transaction via the SQS Console

1. Open the **[SQS Console](https://us-east-1.console.aws.amazon.com/sqs/v3/home?region=us-east-1#/queues)**.
2. Click `payalert-transactions-queue-dev` → **Send and receive messages**.
3. Paste the JSON below into the **Message body** field and click **Send message**.

**Low-risk transaction** (should NOT trigger an alert email):

```json
{
  "transactionId": "test-0001-0000-0000-000000000001",
  "accountId": "ACC-MY-4F291A3B",
  "amount": 45.50,
  "currency": "MYR",
  "timestamp": "2026-05-09T10:00:00+0800",
  "merchantId": "MER-LSS-0001",
  "transactionType": "PURCHASE",
  "referenceId": "PAY-20260509-TEST001",
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
  "location": {"city": "Kuala Lumpur", "state": "Wilayah Persekutuan", "country": "MY"},
  "exchangeRate": 1.0,
  "amountMYR": 45.50,
  "riskScore": 5,
  "riskLevel": "LOW",
  "riskFlags": [],
  "isFlagged": false,
  "flagReason": null,
  "generatorVersion": "2.0.0"
}
```

**CRITICAL-risk transaction** (WILL trigger an alert email):

```json
{
  "transactionId": "test-0001-0000-0000-000000000002",
  "accountId": "ACC-MY-4F291A3B",
  "amount": 9500.00,
  "currency": "USD",
  "timestamp": "2026-05-09T02:30:00+0800",
  "merchantId": "ATM-CITI-US01",
  "transactionType": "WITHDRAWAL",
  "referenceId": "PAY-20260509-TEST002",
  "description": "ATM cash withdrawal - New York, US",
  "channel": "ATM",
  "merchantName": "Citibank ATM (USA)",
  "merchantCategory": "ATM_WITHDRAWAL",
  "merchantCity": "New York",
  "merchantState": "New York",
  "merchantCountry": "US",
  "customerId": "CUST-4F291A3B",
  "customerName": "Ahmad Farid bin Ismail",
  "customerTier": "GOLD",
  "cardLast4": "4821",
  "cardType": "VISA_DEBIT",
  "location": {"city": "New York", "state": "New York", "country": "US"},
  "exchangeRate": 4.72,
  "amountMYR": 44840.00,
  "riskScore": 95,
  "riskLevel": "CRITICAL",
  "riskFlags": ["VERY_HIGH_AMOUNT", "UNUSUAL_HOUR", "CROSS_BORDER", "INTERNATIONAL_ATM", "FOREIGN_CURRENCY"],
  "isFlagged": true,
  "flagReason": "VERY_HIGH_AMOUNT | UNUSUAL_HOUR | CROSS_BORDER | INTERNATIONAL_ATM | FOREIGN_CURRENCY",
  "generatorVersion": "2.0.0",
  "fraudScenario": "cross_border_atm"
}
```

### Verify the item was stored in DynamoDB

1. Open the **[DynamoDB Console](https://us-east-1.console.aws.amazon.com/dynamodbv2/home?region=us-east-1#tables)**.
2. Click `payalert-transactions-dev` → **Explore table items**.
3. Under **Filters**, set:
   - Attribute: `transactionId`
   - Condition: `Equal`
   - Value: `test-0001-0000-0000-000000000001`
4. Click **Run**.

The item should appear with `processedAt`, `datePartition`, and `ttl` fields added by the Lambda processor.

### Invoke the Lambda directly with a test event

1. Open the **[Lambda Console](https://us-east-1.console.aws.amazon.com/infra/home?region=us-east-1#/functions)**.
2. Click `payalert-transaction-processor-dev` → **Test** tab.
3. Create a new test event named `SQSTestEvent` with the following payload:

```json
{
  "Records": [
    {
      "messageId": "manual-test-001",
      "receiptHandle": "manual-receipt",
      "body": "{\"transactionId\":\"manual-test-0001\",\"accountId\":\"ACC-MY-4F291A3B\",\"amount\":125.50,\"currency\":\"MYR\",\"timestamp\":\"2026-05-09T14:30:22+0800\",\"merchantId\":\"MER-LSS-0001\",\"transactionType\":\"PURCHASE\",\"referenceId\":\"PAY-20260509-MANUAL\",\"description\":\"Test transaction\",\"channel\":\"CONTACTLESS\",\"merchantName\":\"Lotus's Supermarket\",\"merchantCategory\":\"GROCERY\",\"merchantCity\":\"Kuala Lumpur\",\"merchantState\":\"Wilayah Persekutuan\",\"merchantCountry\":\"MY\",\"customerId\":\"CUST-4F291A3B\",\"customerName\":\"Ahmad Farid bin Ismail\",\"customerTier\":\"GOLD\",\"cardLast4\":\"4821\",\"cardType\":\"VISA_DEBIT\",\"location\":{\"city\":\"Kuala Lumpur\",\"state\":\"Wilayah Persekutuan\",\"country\":\"MY\"},\"exchangeRate\":1.0,\"amountMYR\":125.50,\"riskScore\":5,\"riskLevel\":\"LOW\",\"riskFlags\":[],\"isFlagged\":false,\"flagReason\":null,\"generatorVersion\":\"2.0.0\"}",
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

4. Click **Test**. The execution result and logs appear inline.

---

## Monitoring

### Lambda logs (CloudWatch)

1. Open the **[CloudWatch Console](https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups)**.
2. Click log group `/aws/lambda/payalert-transaction-processor-dev`.
3. Select a log stream to view recent invocation logs.
4. To search across all streams, click **Search log group** and enter a filter pattern such as `isFlagged=True`.

### CloudWatch Alarms

1. Open the **[CloudWatch Alarms Console](https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#alarmsV2:)**.
2. Search for `payalert` to see all three pipeline alarms:

| Alarm | Triggers when |
|---|---|
| `payalert-dlq-depth-dev` | Any message lands in the DLQ |
| `payalert-processor-errors-dev` | ≥ 5 Lambda errors in 5 minutes |
| `payalert-processor-throttles-dev` | Any Lambda throttle event |

### SQS queue depth

1. Open the **[SQS Console](https://us-east-1.console.aws.amazon.com/sqs/v3/home?region=us-east-1#/queues)**.
2. Click `payalert-transactions-queue-dev`.
3. The **Details** pane shows **Messages available** (visible) and **Messages in flight** (not visible).
4. For DLQ depth, repeat with `payalert-transactions-dlq-dev` — this should read **0** during normal operation.

### DynamoDB metrics

1. Open the **[DynamoDB Console](https://us-east-1.console.aws.amazon.com/dynamodbv2/home?region=us-east-1#tables)**.
2. Click `payalert-transactions-dev` → **Monitor** tab for read/write capacity graphs.
3. The **Overview** tab shows estimated item count and table size (updated approximately every 6 hours).

---

## Troubleshooting

### Lambda function not processing messages

**Check 1 — Are messages arriving in the queue?**

Console: **SQS** → `payalert-transactions-queue-dev` → **Send and receive messages** → **Poll for messages**. If no messages appear within the visibility timeout, the generator is not sending.

**Check 2 — Are there Lambda errors?**

Console: **CloudWatch** → **Log groups** → `/aws/lambda/payalert-transaction-processor-dev` → select the most recent log stream and look for `ERROR` lines.

**Check 3 — Is the SQS event source mapping enabled?**

1. Console: **Lambda** → `payalert-transaction-processor-dev` → **Configuration** → **Triggers**.
2. The SQS trigger for `payalert-transactions-queue-dev` should show state **Enabled**.
3. If it shows **Disabled**, click the trigger → **Edit** → toggle it to **Enabled** → **Save**.

---

### Messages accumulating in the DLQ

Messages reach the DLQ when processing fails 3 consecutive times. Investigate:

**Find the root cause**: Console: **CloudWatch** → **Log groups** → `/aws/lambda/payalert-transaction-processor-dev` → search for `ERROR` near the time the DLQ messages arrived.

**Inspect a DLQ message without deleting it**: Console: **SQS** → `payalert-transactions-dlq-dev` → **Send and receive messages** → **Poll for messages** → expand a message to read its body.

**Redrive DLQ messages after fixing the root cause**:

1. Console: **SQS** → `payalert-transactions-dlq-dev` → **Start DLQ redrive**.
2. Set **Destination queue** to `payalert-transactions-queue-dev`.
3. Click **Start**.

---

### Alert emails not being received

1. Check your inbox (including spam) for an email from `no-reply@sns.amazonaws.com` with subject **AWS Notification - Subscription Confirmation**.
2. Click the **Confirm subscription** link in that email.
3. Verify status: Console: **SNS** → **Subscriptions** → confirm the `payalert-alerts-dev` subscription shows **Confirmed** (not `PendingConfirmation`).
4. Verify the threshold: Console: **Lambda** → `payalert-transaction-processor-dev` → **Configuration** → **Environment variables** → confirm `ALERT_RISK_THRESHOLD` is `50`. If all test transactions have `riskScore < 50`, no alerts will be dispatched.

---

### DynamoDB `ConditionalCheckFailedException` warnings in logs

These are expected and benign. The Lambda uses an idempotent conditional put (`attribute_not_exists(transactionId)`) to deduplicate messages. If SQS delivers the same message twice (at-least-once delivery), the second write is silently skipped.

---

## Lambda Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `DYNAMODB_TABLE` | Yes | — | DynamoDB table name (injected by CloudFormation) |
| `ALERT_TOPIC_ARN` | No | `""` | SNS topic ARN; alerts disabled if empty |
| `ALERT_RISK_THRESHOLD` | No | `50` | Min `riskScore` to trigger an alert |
| `TTL_DAYS` | No | `90` | Days until DynamoDB TTL expiry |
| `AWS_REGION` | No | `us-east-1` | AWS region for boto3 clients |

To update a variable after deployment: Console: **Lambda** → `payalert-transaction-processor-dev` → **Configuration** → **Environment variables** → **Edit**.

---

## Updating the Stack

After any code change:

1. Re-zip the handler: repeat **Step 2** (Package) and **Step 3** (Upload to S3).
2. Update the Lambda function code directly:
   - Console: **Lambda** → `payalert-transaction-processor-dev` → **Code** tab → **Upload from** → **Amazon S3 location** → enter `s3://payalert-artifacts-{account-id}/function.zip` → **Save**.

After any template change (adding/removing resources or parameters):

1. Console: **CloudFormation** → `payalert-dev` → **Update**.
2. Choose **Replace current template** → upload `infra/lambda-stack.yaml`.
3. Review the changeset and confirm.

---

## Tearing Down

To delete all AWS resources created by the stack:

1. Console: **CloudFormation** → **Stacks** → select `payalert-dev` → **Delete** → **Delete stack**.

> The DynamoDB table has `DeletionPolicy: Retain` and will **not** be deleted with the stack. This is intentional to prevent accidental data loss.

To also delete the retained DynamoDB table after stack deletion:

1. Console: **DynamoDB** → **Tables** → `payalert-transactions-dev` → **Delete** → confirm deletion.

To clean up the S3 artifacts bucket:

1. Console: **S3** → select `payalert-artifacts-{account-id}` → **Empty** → confirm, then **Delete** → confirm.

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **Partial batch failure (`ReportBatchItemFailures`)** | SQS retries only the failed messages in a batch, not the entire batch. Prevents good messages from being reprocessed due to a single bad one. |
| **Idempotent conditional put** | SQS provides at-least-once delivery. `attribute_not_exists(transactionId)` ensures duplicates are silently discarded without error. |
| **`DeletionPolicy: Retain` on DynamoDB** | Prevents irreversible data loss if the CloudFormation stack is accidentally deleted. The table survives stack deletion. |
| **SNS alert failure is non-fatal** | An SNS publish failure is logged but does not cause the DynamoDB write to be rolled back or the SQS message to be retried. The transaction is stored regardless. |
| **Float → Decimal conversion** | DynamoDB's Python SDK (boto3 resource API) rejects Python `float` types. All floats are converted to `Decimal(str(value))` before writing to preserve precision. |
| **`datePartition` synthetic field** | Derived from `timestamp[:10]` at write time. Enables efficient `DatePartitionIndex` queries without a full table scan for the audit portal's "today's transactions" view. |
| **ARM64 architecture** | AWS Graviton2 processors deliver ~20% better price-performance than x86_64 for compute-bound Lambda workloads at no additional configuration cost. |
