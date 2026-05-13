# Deploying the Lambda Pipeline with AWS SAM

This guide covers deploying the PayAlert transaction processor to AWS using the AWS SAM CLI. The stack provisions:

- An SQS queue (with a dead-letter queue)
- A Lambda function (Python 3.11, arm64)
- A DynamoDB table (`payalert-transactions`)
- An SNS topic for high-risk transaction email alerts
- CloudWatch alarms for DLQ depth, Lambda errors, and throttles

---

## Prerequisites

- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) installed (`sam --version` to check)
- AWS credentials configured (`aws configure` or environment variables) with permissions to deploy CloudFormation, Lambda, DynamoDB, SQS, and SNS
- Python 3.11 (only needed if you run `sam build` locally without Docker; SAM can build in a container)

---

## 1. Build

From the `lambda/` directory:

```bash
sam build
```

SAM reads `template.yaml`, installs `transaction-processor/requirements.txt` into a staging directory, and produces a `.aws-sam/build/` artifact. The build output is automatically used by `sam deploy`.

> **Note:** `*.zip` is in `.gitignore`. The packaged Lambda ZIP produced by SAM lives inside `.aws-sam/` which is also ignored.

---

## 2. Deploy

### First-time deploy (guided)

```bash
sam deploy --guided
```

SAM will prompt you for each parameter:

| Parameter | Description | Suggested value |
|---|---|---|
| `Stack name` | CloudFormation stack name | `payalert` |
| `AWS Region` | Deploy region | `ap-southeast-1` |
| `Environment` | Deployment environment tag | `prod` |
| `AlertEmail` | Email that receives HIGH/CRITICAL alerts | your email address |
| `AlertRiskThreshold` | Minimum riskScore (0–100) to trigger an alert | `50` |
| `TransactionTTLDays` | Days before DynamoDB expires stored transactions | `90` |

After the first run, SAM writes the answers to `samconfig.toml`. Subsequent deploys can use:

```bash
sam deploy
```

### Non-interactive deploy

```bash
sam deploy \
  --stack-name payalert \
  --region ap-southeast-1 \
  --parameter-overrides \
      Environment=prod \
      AlertEmail=your@email.com \
      AlertRiskThreshold=50 \
      TransactionTTLDays=90 \
  --capabilities CAPABILITY_IAM \
  --resolve-s3
```

`--resolve-s3` tells SAM to create and manage the S3 deployment bucket automatically.

---

## 3. Confirm the SNS subscription

After the stack deploys, AWS sends a confirmation email to `AlertEmail`. **You must click the confirmation link** before alerts will be delivered.

---

## 4. Retrieve stack outputs

```bash
aws cloudformation describe-stacks \
  --stack-name payalert \
  --query "Stacks[0].Outputs" \
  --output table
```

Key outputs:

| Output key | What it's for |
|---|---|
| `TransactionQueueUrl` | Set as `SQS_QUEUE_URL` in the transaction generator |
| `TransactionsTableName` | Always `payalert-transactions`; used by the audit portal |
| `AlertTopicArn` | SNS topic — subscribe additional endpoints here if needed |

---

## 5. Send a test message

With the queue URL from the outputs:

```bash
aws sqs send-message \
  --queue-url <TransactionQueueUrl> \
  --message-body "$(cat tests/sample_event.json | python3 -c "import json,sys; print(json.load(sys.stdin)['Records'][0]['body'])")"
```

Or send the full batch from `tests/local-batch-event.json` one record at a time. The Lambda processes each SQS message independently.

---

## 6. Monitor

**CloudWatch Logs** (Lambda output):
```bash
sam logs --stack-name payalert --name TransactionProcessorFunction --tail
```

**DLQ depth** (failed messages after 3 retries):
```bash
aws sqs get-queue-attributes \
  --queue-url <DeadLetterQueueUrl> \
  --attribute-names ApproximateNumberOfMessages
```

**Purge the DLQ** (after investigating failures):
```bash
aws sqs purge-queue --queue-url <DeadLetterQueueUrl>
```

---

## 7. Update the deployment

After code or template changes:

```bash
sam build && sam deploy
```

SAM performs a CloudFormation change-set update. Existing data in DynamoDB is preserved — the table has `DeletionPolicy: Retain`.

---

## 8. Tear down

```bash
sam delete --stack-name payalert
```

> **Important:** The DynamoDB table has `DeletionPolicy: Retain`. `sam delete` will remove all stack resources **except** the table — it will remain in your account with all data intact. To delete it manually:
> ```bash
> aws dynamodb delete-table --table-name payalert-transactions
> ```

---

## Architecture

```
Transaction Generator
        │
        ▼  SQS send-message
┌─────────────────────────────────────┐
│  payalert-transactions-queue        │
│  (VisibilityTimeout 180s, DLQ × 3) │
└───────────────┬─────────────────────┘
                │ SQS trigger (batch 10)
                ▼
┌───────────────────────────────────────────┐
│  Lambda: payalert-transaction-processor   │
│  Python 3.11 · arm64 · 256 MB · 30s      │
│  ReportBatchItemFailures enabled          │
└──────────┬──────────────────┬────────────┘
           │ PutItem          │ Publish (riskScore >= threshold)
           ▼                  ▼
┌──────────────────┐   ┌──────────────────┐
│  DynamoDB        │   │  SNS             │
│  payalert-       │   │  payalert-alerts │
│  transactions    │   │       │          │
│  (TTL 90 days)   │   │       ▼ Email    │
└──────────────────┘   └──────────────────┘
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `CREATE_FAILED` on first deploy | IAM permissions missing | Ensure your deploying IAM user has `cloudformation:*`, `iam:*`, `lambda:*`, `dynamodb:*`, `sqs:*`, `sns:*` |
| Messages piling up in DLQ | Lambda crashing on malformed records | Check `sam logs --tail`; fix the bad messages or update handler |
| No alerts received | SNS subscription not confirmed | Check inbox for confirmation email and click the link |
| `ResourceInUseException` on table | Table already exists from a prior deploy | Safe to ignore — the stack will adopt the existing table |
| Lambda timeout | DynamoDB unreachable (VPC config issue) | Ensure Lambda has either a NAT gateway or a DynamoDB VPC endpoint |
