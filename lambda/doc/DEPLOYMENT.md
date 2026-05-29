# Deploying the Lambda Pipeline with AWS SAM

This guide covers deploying the PayAlert transaction processor to AWS using the AWS SAM CLI. The stack provisions:

- An SQS queue (with a dead-letter queue)
- A Lambda function (Python 3.11, x86_64)
- A DynamoDB table (`payalert-transactions-<env>`)
- An SNS topic for high-risk transaction email alerts
- A KMS customer-managed key (CloudWatch Logs + SNS encryption)
- CloudWatch alarms for DLQ depth, Lambda errors, and throttles

---

## Prerequisites

- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) installed (`sam --version` to check)
- AWS credentials configured — Academy Labs: paste the credentials from the **AWS Details** panel into `~/.aws/credentials`
- Python 3.11 (only needed if running `sam build` locally without Docker; SAM can build in a container)

---

## Shell compatibility (Windows)

| Shell | Line continuation | Chain commands |
|---|---|---|
| Git Bash | `\` | `cmd1 && cmd2` |
| PowerShell 5.1 | `` ` `` | `cmd1; if ($?) { cmd2 }` |

Multi-line commands below use **Git Bash** (`\`) syntax. In PowerShell, replace each trailing `\` with a backtick `` ` ``.
Steps where the command differs between shells show both variants explicitly.

---

## 1. Build

From the `lambda/` directory:

```bash
sam build
```

SAM reads `template.yaml`, installs `transaction-processor/requirements.txt` into a staging directory, and produces a `.aws-sam/build/` artifact used automatically by `sam deploy`.

> `*.zip` and `.aws-sam/` are in `.gitignore` — packaged artifacts are never committed.

---

## 2. Deploy

### First-time deploy (guided)

```bash
sam deploy --guided
```

SAM prompts for each parameter:

| Parameter | Description | Suggested value |
|---|---|---|
| `Stack name` | CloudFormation stack name | `payalert` |
| `AWS Region` | Deploy region | `us-east-1` |
| `Environment` | Deployment environment tag | `prod` |
| `AlertEmail` | Email that receives HIGH/CRITICAL alerts | your email address |
| `AlertRiskThreshold` | Minimum riskScore (0–100) to trigger an alert | `50` |
| `TransactionTTLDays` | Days before DynamoDB expires stored transactions | `90` |
| `LambdaRoleArn` | IAM role ARN for the Lambda function | `arn:aws:iam::<AccountId>:role/LabRole` |
| `EnableForceFail` | DLQ demo backdoor — **leave `false` in all real deployments** | `false` |

> **Academy Labs:** Find your Account ID in the **AWS Details** panel. LabRole ARN format: `arn:aws:iam::<AccountId>:role/LabRole`.
> Run `aws sts get-caller-identity --query Account --output text` to print your Account ID.

After the first guided run, SAM writes answers to `samconfig.toml`. Update `LambdaRoleArn` in that file, then subsequent deploys use:

```bash
sam deploy
```

### Non-interactive deploy

**Git Bash:**
```bash
sam deploy \
  --stack-name payalert \
  --region us-east-1 \
  --parameter-overrides \
      Environment=prod \
      AlertEmail=your@email.com \
      AlertRiskThreshold=50 \
      TransactionTTLDays=90 \
      LambdaRoleArn=arn:aws:iam::ACCOUNT_ID:role/LabRole \
      EnableForceFail=false \
  --capabilities CAPABILITY_IAM \
  --resolve-s3
```

**PowerShell:**
```powershell
sam deploy `
  --stack-name payalert `
  --region us-east-1 `
  --parameter-overrides `
      "Environment=prod" `
      "AlertEmail=your@email.com" `
      "AlertRiskThreshold=50" `
      "TransactionTTLDays=90" `
      "LambdaRoleArn=arn:aws:iam::ACCOUNT_ID:role/LabRole" `
      "EnableForceFail=false" `
  --capabilities CAPABILITY_IAM `
  --resolve-s3
```

`--resolve-s3` tells SAM to create and manage the S3 deployment bucket automatically.

---

## 3. Confirm the SNS subscription

After the stack deploys, AWS sends a confirmation email to `AlertEmail`. **Click the confirmation link** before alerts will be delivered.

---

## 4. Retrieve stack outputs

**Git Bash:**
```bash
aws cloudformation describe-stacks \
  --stack-name payalert \
  --query "Stacks[0].Outputs" \
  --output table
```

**PowerShell:**
```powershell
aws cloudformation describe-stacks `
  --stack-name payalert `
  --query "Stacks[0].Outputs" `
  --output table
```

Key outputs:

| Output key | What it's for |
|---|---|
| `TransactionQueueUrl` | Set as `SQS_QUEUE_URL` in the transaction generator |
| `TransactionsTableName` | `payalert-transactions-prod` — used by the audit portal |
| `AlertTopicArn` | SNS topic — subscribe additional endpoints here if needed |

---

## 5. Send a test message

With the queue URL from the outputs:

**Git Bash:**
```bash
aws sqs send-message \
  --queue-url <TransactionQueueUrl> \
  --message-body "$(python3 -c "import json; d=json.load(open('tests/sample_event.json')); print(d['Records'][0]['body'])")"
```

> If `python3` is not found, use `python` instead.

**PowerShell:**
```powershell
$msgBody = (Get-Content tests/sample_event.json | ConvertFrom-Json).Records[0].body
aws sqs send-message `
  --queue-url <TransactionQueueUrl> `
  --message-body $msgBody
```

---

## 6. Monitor

**CloudWatch Logs** (Lambda output):
```bash
sam logs --stack-name payalert --name TransactionProcessorFunction --tail
```

**DLQ depth** (failed messages after 3 retries):

*Git Bash:*
```bash
aws sqs get-queue-attributes \
  --queue-url <DeadLetterQueueUrl> \
  --attribute-names ApproximateNumberOfMessages
```

*PowerShell:*
```powershell
aws sqs get-queue-attributes `
  --queue-url <DeadLetterQueueUrl> `
  --attribute-names ApproximateNumberOfMessages
```

**Purge the DLQ** (after investigating failures):
```bash
aws sqs purge-queue --queue-url <DeadLetterQueueUrl>
```

---

## 7. Update the deployment

After code or template changes:

**Git Bash:**
```bash
sam build && sam deploy
```

**PowerShell:**
```powershell
sam build; if ($?) { sam deploy }
```

SAM performs a CloudFormation change-set update. Existing data in DynamoDB is preserved — the table has `DeletionPolicy: Retain`.

---

## 8. Tear down

```bash
sam delete --stack-name payalert
```

> **Important:** The DynamoDB table has `DeletionPolicy: Retain`. `sam delete` removes all stack resources **except** the table — it stays in your account with all data intact. To delete it manually:
> ```bash
> aws dynamodb delete-table --table-name payalert-transactions-prod
> ```

---

## Academy Lab notes

- **Region:** Use `us-east-1` — Academy Labs only allow `us-east-1` and `us-west-2`.
- **Session timeout:** Sessions expire after ~4 hours. EC2 instances stop; Lambda, SQS, DynamoDB, and the CloudFormation stack persist. Refresh credentials from the **AWS Details** panel on every session start.
- **KMS:** If deployment fails with `AccessDeniedException` on `PayAlertKmsKey`, the LabRole in your lab lacks `kms:CreateKey`. Contact your instructor or replace the CMK with AWS-managed keys (`alias/aws/sns`, `alias/aws/logs`).

---

## Architecture

```
Transaction Generator
        │
        ▼  SQS send-message
┌─────────────────────────────────────┐
│  payalert-transactions-queue        │
│  (VisibilityTimeout 180s, DLQ × 3)  │
└───────────────┬─────────────────────┘
                │ SQS trigger (batch 10)
                ▼
┌───────────────────────────────────────────┐
│  Lambda: payalert-transaction-processor   │
│  Python 3.11 · x86_64 · 256 MB · 30s     │
│  ReportBatchItemFailures enabled          │
└──────────┬──────────────────┬─────────────┘
           │ PutItem          │ Publish (riskScore >= threshold)
           ▼                  ▼
┌──────────────────┐   ┌──────────────────┐
│  DynamoDB        │   │  SNS             │
│  payalert-       │   │  payalert-alerts │
│  transactions    │   │       │          │
│  (TTL 90 days)   │   │       ▼ Email    │
└──────────────────┘   └──────────────────┘
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `CREATE_FAILED` on first deploy | Missing or wrong `LambdaRoleArn` | Verify: `aws iam get-role --role-name LabRole --query Role.Arn` |
| `AccessDeniedException` on KMS | LabRole lacks `kms:CreateKey` | See Academy Lab notes above |
| Messages piling up in DLQ | Lambda crashing on malformed records | Check `sam logs --tail`; fix bad messages or update handler |
| No alerts received | SNS subscription not confirmed | Check inbox for confirmation email and click the link |
| `ResourceInUseException` on table | Table already exists from a prior deploy | Safe to ignore — the stack adopts the existing table |
| Lambda timeout | DynamoDB unreachable | Ensure Lambda has a NAT gateway or DynamoDB VPC endpoint |
| `python3: command not found` | Python installed as `python` on Windows | Replace `python3` with `python` in Step 5 Git Bash command |
