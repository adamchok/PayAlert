# PayAlert — AWS Deployment Guide

Step-by-step instructions for deploying and running the full PayAlert architecture from scratch: Lambda pipeline, EC2 transaction generator, and EC2 audit portal.

> **Platform:** EC2 steps target **Ubuntu Server 26.04 LTS**. All deployment is performed through the **AWS Management Console** — no AWS CLI or SAM CLI required.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Your Workstation                                                │
│  Package handler.py → S3 → CloudFormation Console  ─────────►    │
└──────────────────────────────────────────────────────────────────┘
                                                                   │
                                                                   ▼
┌──────────────────┐    SQS Queue     ┌────────────────────────────┐
│  EC2 (Ubuntu     │ ──────────────►  │  Lambda                    │
│  26.04 LTS)      │                  │  (CloudFormation-deployed  │
│                  │                  └────────────────────────────┘
│  generator.py    │                            │
│  app.py (portal) │◄───────────────────────────┘  DynamoDB + SNS
└──────────────────┘       (audit portal reads DynamoDB)
```

**Components deployed:**


| Component                     | Where                            | What it does                                          |
| ----------------------------- | -------------------------------- | ----------------------------------------------------- |
| Lambda + SQS + DynamoDB + SNS | AWS (via CloudFormation Console) | Processes and stores transactions, sends fraud alerts |
| Transaction Generator         | EC2                              | Streams synthetic transactions to SQS                 |
| Audit Portal                  | EC2 (same instance)              | Flask web UI querying DynamoDB                        |


---

## Prerequisites

### On your workstation


| Requirement  | Notes                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| Python 3.11+ | For packaging the Lambda function (`sudo apt install python3 python3-pip python3-venv` on Ubuntu 26.04) |
| Web browser  | For the AWS Management Console                                                                          |
| SSH client   | Built into Ubuntu and macOS terminals; PuTTY on Windows                                                 |


> **No AWS CLI, SAM CLI, or Docker required.**

### AWS account

You need an AWS account with permissions to create IAM roles, CloudFormation stacks, Lambda functions, SQS queues, DynamoDB tables, SNS topics, S3 buckets, and CloudWatch alarms.

---

## Step 1 — Deploy the Lambda pipeline

All steps in this section are performed through the AWS Management Console.

### 1.1 Create an S3 bucket for the Lambda artifact

1. Open the **[S3 Console](https://s3.console.aws.amazon.com/s3/buckets)** → **Create bucket**.
2. **Bucket name:** `payalert-artifacts-{your-12-digit-account-id}` (must be globally unique)
3. **Region:** `ap-southeast-1`
4. Leave all other settings at their defaults → **Create bucket**.

### 1.2 Package the Lambda function

The handler has no external dependencies beyond `boto3`, which is pre-installed in the Lambda runtime. The deployment package is a single zip file.

Run from the `lambda/transaction-processor/` directory on your workstation:

**Ubuntu / macOS:**

```bash
cd lambda/transaction-processor/
zip function.zip handler.py
```

**Windows (PowerShell):**

```powershell
cd lambda\transaction-processor\
Compress-Archive -Path handler.py -DestinationPath function.zip
```

### 1.3 Upload the Lambda zip to S3

1. Open the **[S3 Console](https://s3.console.aws.amazon.com/s3/buckets)** → click `payalert-artifacts-{account-id}`.
2. **Upload** → **Add files** → select `function.zip` → **Upload**.

### 1.4 Update the CloudFormation template

Open `lambda/template.yaml` and replace the `CodeUri` line under `TransactionProcessorFunction`:

```yaml
# Before
CodeUri: transaction-processor/

# After (replace with your actual bucket name)
CodeUri: s3://payalert-artifacts-{account-id}/function.zip
```

Save the file.

### 1.5 Deploy via CloudFormation Console

1. Open the **[CloudFormation Console](https://ap-southeast-1.console.aws.amazon.com/cloudformation/home?region=ap-southeast-1)**.
2. **Create stack** → **With new resources (standard)**.
3. **Template source:** Upload a template file → **Choose file** → select the modified `lambda/template.yaml` → **Next**.
4. Fill in the stack details:
  - **Stack name:** `payalert-dev`
5. Fill in the parameters:


| Parameter            | Value                   |
| -------------------- | ----------------------- |
| `Environment`        | `dev`                   |
| `AlertEmail`         | your real email address |
| `AlertRiskThreshold` | `50`                    |
| `TransactionTTLDays` | `90`                    |


1. **Next** → **Next**.
2. Under **Capabilities**, check **☑ I acknowledge that AWS CloudFormation might create IAM resources**.
3. **Submit**.

The **Events** tab updates in real time. Wait for status **CREATE_COMPLETE** (~2–3 minutes).

### 1.6 Save the stack outputs

1. **CloudFormation** → **Stacks** → `payalert-dev` → **Outputs** tab.
2. **Copy these values** — you will need them in later steps.


| Key                     | Example value                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `TransactionQueueUrl`   | `https://sqs.ap-southeast-1.amazonaws.com/123456789012/payalert-transactions-queue-dev` |
| `TransactionsTableName` | `payalert-transactions-dev`                                                             |
| `AlertTopicArn`         | `arn:aws:sns:ap-southeast-1:123456789012:payalert-alerts-dev`                           |


### 1.7 Confirm the SNS email subscription

AWS sends a confirmation email to `AlertEmail` immediately after deployment. Open the email from `no-reply@sns.amazonaws.com` and click **Confirm subscription**.

To verify: **SNS** → **Subscriptions** → confirm `payalert-alerts-dev` shows **Confirmed** (not `PendingConfirmation`).

---

## Step 2 — Create the EC2 IAM role

The EC2 instance needs permission to write to SQS (generator) and read from DynamoDB (audit portal). One role covers both.

### 2.1 Create the IAM policy

1. **[IAM Console](https://console.aws.amazon.com/iam/home#/policies)** → **Policies** → **Create policy**.
2. Switch to the **JSON** editor and paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SQSWrite",
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:SendMessageBatch",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:ap-southeast-1:*:payalert-transactions-queue-*"
    },
    {
      "Sid": "DynamoDBRead",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query"
      ],
      "Resource": [
        "arn:aws:dynamodb:ap-southeast-1:*:table/payalert-transactions-*",
        "arn:aws:dynamodb:ap-southeast-1:*:table/payalert-transactions-*/index/*"
      ]
    }
  ]
}
```

1. **Policy name:** `PayAlertEC2Policy` → **Create policy**.

### 2.2 Create the IAM role

1. **[IAM Console](https://console.aws.amazon.com/iam/home#/roles)** → **Roles** → **Create role**.
2. **Trusted entity type:** AWS service → **EC2** → **Next**.
3. Search for and select `PayAlertEC2Policy` → **Next**.
4. **Role name:** `PayAlertEC2Role` → **Create role**.

---

## Step 3 — Launch the EC2 instance

### 3.1 Create a key pair (if you do not have one)

1. **[EC2 Console](https://ap-southeast-1.console.aws.amazon.com/ec2/home?region=ap-southeast-1#KeyPairs:)** → **Key Pairs** → **Create key pair**.
2. **Name:** `payalert-key`, **Type:** RSA, **Format:** `.pem`.
3. Download and save the `.pem` file.

On Ubuntu/macOS, set correct permissions before using it:

```bash
chmod 400 ~/Downloads/payalert-key.pem
```

### 3.2 Create a security group

1. **EC2** → **Security Groups** → **Create security group**.
2. **Name:** `PayAlertEC2SG`, **VPC:** the default VPC.
3. Add the following inbound rules:


| Type       | Port | Source | Purpose                                       |
| ---------- | ---- | ------ | --------------------------------------------- |
| SSH        | 22   | My IP  | Terminal access                               |
| Custom TCP | 5000 | My IP  | Audit portal (or `0.0.0.0/0` for demo access) |


1. **Create security group**.

### 3.3 Launch the instance

1. **[EC2 Console](https://ap-southeast-1.console.aws.amazon.com/ec2/home?region=ap-southeast-1#LaunchInstances:)** → **Launch instances**.
2. Configure:


| Setting            | Value                                |
| ------------------ | ------------------------------------ |
| **Name**           | `payalert-ec2`                       |
| **AMI**            | Ubuntu Server 26.04 LTS (64-bit x86) |
| **Instance type**  | `t3.micro`                           |
| **Key pair**       | `payalert-key`                       |
| **Security group** | `PayAlertEC2SG`                      |


1. Expand **Advanced details** → **IAM instance profile** → select `PayAlertEC2Role`.
2. **Launch instance**.

### 3.4 Connect to the instance

Wait ~60 seconds for the instance to enter the **Running** state and pass both status checks.

Get the public IP from **EC2** → **Instances** → select `payalert-ec2` → **Public IPv4 address**, then connect:

**Ubuntu / macOS:**

```bash
ssh -i ~/Downloads/payalert-key.pem ubuntu@<PUBLIC_IP>
```

**Windows (PuTTY):**

Convert the `.pem` to `.ppk` using PuTTYgen, then connect via PuTTY to `ubuntu@<PUBLIC_IP>`.

---

## Step 4 — Set up the transaction generator

All commands in this section run **on the EC2 instance** unless noted otherwise.

### 4.1 Update the system and install Python

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-pip python3-venv git
python3 --version
```

### 4.2 Copy the generator to the instance

Run this **on your workstation**, substituting the actual public IP:

```bash
scp -i ~/Downloads/payalert-key.pem -r \
  ./transaction-generator \
  ubuntu@<PUBLIC_IP>:/tmp/
```

Back on the EC2 instance:

```bash
sudo mkdir -p /opt/payalert
sudo mv /tmp/transaction-generator /opt/payalert/transaction-generator
sudo chown -R ubuntu:ubuntu /opt/payalert
```

### 4.3 Install Python dependencies

```bash
cd /opt/payalert/transaction-generator
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
deactivate
```

### 4.4 Create the environment file

Replace the `SQS_QUEUE_URL` value with the `TransactionQueueUrl` you saved in Step 1.6:

```bash
sudo tee /opt/payalert/generator.env > /dev/null <<'EOF'
AWS_REGION=ap-southeast-1
SQS_QUEUE_URL=https://sqs.ap-southeast-1.amazonaws.com/ACCOUNT_ID/payalert-transactions-queue-dev
EOF
```

### 4.5 Run a quick test

```bash
cd /opt/payalert/transaction-generator
source .venv/bin/activate
export $(cat /opt/payalert/generator.env | xargs)
python3 generator.py --mode batch --count 5 --verbose
deactivate
```

You should see 5 transactions sent successfully. If you get `AccessDenied`, verify that `PayAlertEC2Role` is attached: **EC2** → **Instances** → select instance → **Security** tab → **IAM Role**.

### 4.6 Create the systemd service

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

sudo systemctl daemon-reload
sudo systemctl enable --now payalert-generator
sudo systemctl status payalert-generator
```

You should see `Active: active (running)`. View live logs:

```bash
sudo journalctl -u payalert-generator -f
```

Press `Ctrl+C` to stop following logs (the service keeps running).

---

## Step 5 — Set up the audit portal

All commands in this section run **on the EC2 instance** unless noted otherwise.

### 5.1 Copy the audit portal to the instance

Run this **on your workstation**:

```bash
scp -i ~/Downloads/payalert-key.pem -r \
  ./audit-portal \
  ubuntu@<PUBLIC_IP>:/tmp/
```

Back on the EC2 instance:

```bash
sudo mv /tmp/audit-portal /opt/payalert/audit-portal
sudo chown -R ubuntu:ubuntu /opt/payalert/audit-portal
```

### 5.2 Install Python dependencies

```bash
cd /opt/payalert/audit-portal
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
deactivate
```

### 5.3 Create the environment file

```bash
sudo tee /opt/payalert/portal.env > /dev/null <<'EOF'
ENVIRONMENT=dev
AWS_REGION=ap-southeast-1
DYNAMODB_TABLE=payalert-transactions-dev
PORT=5000
FLASK_SECRET_KEY=change-this-to-a-long-random-string
EOF
```

### 5.4 Run a quick test

```bash
cd /opt/payalert/audit-portal
source .venv/bin/activate
export $(cat /opt/payalert/portal.env | xargs)
python3 app.py
```

You should see:

```
 * Running on http://0.0.0.0:5000
```

Open `http://<PUBLIC_IP>:5000` in a browser. The dashboard should load (it may show no transactions if the generator has not sent any yet). Press `Ctrl+C` to stop.

```bash
deactivate
```

### 5.5 Create the systemd service

```bash
sudo tee /etc/systemd/system/payalert-portal.service > /dev/null <<'EOF'
[Unit]
Description=PayAlert Audit Portal
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/payalert/audit-portal
ExecStart=/opt/payalert/audit-portal/.venv/bin/gunicorn \
    --bind 0.0.0.0:5000 --workers 2 app:app
EnvironmentFile=/opt/payalert/portal.env
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
```

The portal is now running on `http://<PUBLIC_IP>:5000` and will restart automatically on reboot.

---

## Step 6 — End-to-end smoke test

By this point the generator is continuously pushing transactions to SQS and the portal is live. This step verifies each layer of the pipeline.

### 6.1 Verify Lambda is processing

1. **[CloudWatch Console](https://ap-southeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1#logsV2:log-groups)** → log group `/aws/lambda/payalert-transaction-processor-dev`.
2. Select the most recent log stream.
3. Look for lines like:

```
Stored transaction=<uuid> account=ACC-MY-4F291A3B riskScore=12 riskLevel=LOW isFlagged=False
```

### 6.2 Verify DynamoDB is being populated

1. **[DynamoDB Console](https://ap-southeast-1.console.aws.amazon.com/dynamodbv2/home?region=ap-southeast-1#tables)** → `payalert-transactions-dev` → **Explore table items**.
2. Records should be visible and accumulating.

### 6.3 Check the audit portal

Open `http://<PUBLIC_IP>:5000` in a browser.

- The **Dashboard** shows today's transaction count and the HIGH / CRITICAL breakdown.
- Click **Transactions** in the navbar to see the full list.
- Click any **Account ID** to see that account's full transaction history.
- Click any **Transaction ID** to see the full detail view.

### 6.4 Trigger a fraud alert email

Send a CRITICAL test transaction via the SQS Console to verify the SNS email path:

1. **[SQS Console](https://ap-southeast-1.console.aws.amazon.com/sqs/v3/home?region=ap-southeast-1#/queues)** → `payalert-transactions-queue-dev` → **Send and receive messages**.
2. Paste the following JSON into the **Message body** field and click **Send message**:

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
  "customerTier": "GOLD",
  "cardLast4": "4821",
  "cardType": "VISA_DEBIT",
  "location": {"city": "New York", "state": "New York", "country": "US"},
  "exchangeRate": 4.72,
  "amountMYR": 44840.00,
  "riskScore": 95,
  "riskLevel": "CRITICAL",
  "riskFlags": ["VERY_HIGH_AMOUNT","UNUSUAL_HOUR","CROSS_BORDER","INTERNATIONAL_ATM","FOREIGN_CURRENCY"],
  "isFlagged": true,
  "flagReason": "VERY_HIGH_AMOUNT | UNUSUAL_HOUR | CROSS_BORDER | INTERNATIONAL_ATM | FOREIGN_CURRENCY",
  "generatorVersion": "2.0.0",
  "fraudScenario": "cross_border_atm"
}
```

Within 30 seconds:

- The transaction appears on the audit portal dashboard highlighted in red.
- You receive a `[PayAlert] CRITICAL Risk` email at the address set during stack deployment.

### 6.5 Verify the DLQ is empty

Normal operation should produce zero DLQ messages.

**[SQS Console](https://ap-southeast-1.console.aws.amazon.com/sqs/v3/home?region=ap-southeast-1#/queues)** → `payalert-transactions-dlq-dev` → **Details** pane → **Messages available** should be `0`.

Any non-zero value means a transaction failed processing three times. Investigate via **CloudWatch** → log group `/aws/lambda/payalert-transaction-processor-dev`.

---

## Step 7 — Run in fraud mode

To generate a higher volume of flagged transactions for audit portal demonstrations:

On the EC2 instance, stop the service and run the generator manually in fraud mode:

```bash
sudo systemctl stop payalert-generator

cd /opt/payalert/transaction-generator
source .venv/bin/activate
export $(cat /opt/payalert/generator.env | xargs)

# Sends ~30% fraud-scenario transactions continuously
python3 generator.py --fraud-mode --verbose
```

Press `Ctrl+C` when done, then restart the service:

```bash
deactivate
sudo systemctl start payalert-generator
```

---

## Cleanup / Teardown

### Stop the EC2 services

On the EC2 instance:

```bash
sudo systemctl stop payalert-generator payalert-portal
sudo systemctl disable payalert-generator payalert-portal
```

### Delete the Lambda stack

1. **[CloudFormation Console](https://ap-southeast-1.console.aws.amazon.com/cloudformation/home?region=ap-southeast-1)** → **Stacks** → select `payalert-dev` → **Delete** → **Delete stack**.

> The DynamoDB table has `DeletionPolicy: Retain` and will **not** be deleted with the stack.

To also delete the retained DynamoDB table:

**[DynamoDB Console](https://ap-southeast-1.console.aws.amazon.com/dynamodbv2/home?region=ap-southeast-1#tables)** → `payalert-transactions-dev` → **Delete** → confirm.

To clean up the S3 artifacts bucket:

**[S3 Console](https://s3.console.aws.amazon.com/s3/buckets)** → `payalert-artifacts-{account-id}` → **Empty** → confirm, then **Delete** → confirm.

### Terminate the EC2 instance

**EC2** → **Instances** → select `payalert-ec2` → **Instance state** → **Terminate instance**.

---

## Quick Reference

### Resource names (dev environment)


| Resource             | Name                                             |
| -------------------- | ------------------------------------------------ |
| SQS queue            | `payalert-transactions-queue-dev`                |
| SQS DLQ              | `payalert-transactions-dlq-dev`                  |
| DynamoDB table       | `payalert-transactions-dev`                      |
| SNS topic            | `payalert-alerts-dev`                            |
| Lambda function      | `payalert-transaction-processor-dev`             |
| CloudWatch log group | `/aws/lambda/payalert-transaction-processor-dev` |
| CloudFormation stack | `payalert-dev`                                   |
| S3 artifacts bucket  | `payalert-artifacts-{account-id}`                |
| EC2 IAM role         | `PayAlertEC2Role`                                |


### Console navigation cheat sheet


| Task                    | Console path                                                               |
| ----------------------- | -------------------------------------------------------------------------- |
| View Lambda logs        | CloudWatch → Log groups → `/aws/lambda/payalert-transaction-processor-dev` |
| Check CloudWatch alarms | CloudWatch → Alarms → search `payalert`                                    |
| Browse DynamoDB items   | DynamoDB → Tables → `payalert-transactions-dev` → Explore table items      |
| Check SQS queue depth   | SQS → `payalert-transactions-queue-dev` → Details pane                     |
| Check DLQ depth         | SQS → `payalert-transactions-dlq-dev` → Details pane                       |
| Redrive DLQ messages    | SQS → `payalert-transactions-dlq-dev` → Start DLQ redrive                  |
| Send a test message     | SQS → `payalert-transactions-queue-dev` → Send and receive messages        |
| Invoke Lambda directly  | Lambda → `payalert-transaction-processor-dev` → Test tab                   |
| Update stack            | CloudFormation → `payalert-dev` → Update                                   |
| View stack outputs      | CloudFormation → `payalert-dev` → Outputs tab                              |


### EC2 service management (on the instance)

```bash
# View live logs
sudo journalctl -u payalert-generator -f
sudo journalctl -u payalert-portal -f

# Restart services
sudo systemctl restart payalert-generator payalert-portal

# Check status
sudo systemctl status payalert-generator payalert-portal
```

### Updating after a code change

**Lambda code change:**

1. Re-zip: `cd lambda/transaction-processor/ && zip function.zip handler.py`
2. Re-upload to S3: S3 Console → `payalert-artifacts-{account-id}` → Upload → `function.zip`.
3. Update Lambda: **Lambda** → `payalert-transaction-processor-dev` → **Code** tab → **Upload from** → **Amazon S3 location** → enter `s3://payalert-artifacts-{account-id}/function.zip` → **Save**.

**Template / infrastructure change:**

1. **CloudFormation** → `payalert-dev` → **Update** → **Replace current template** → upload the modified `template.yaml`.
2. Review the changeset and confirm.

**EC2 application change:**

```bash
# Copy new files to the instance
scp -i ~/Downloads/payalert-key.pem -r ./transaction-generator ubuntu@<PUBLIC_IP>:/opt/payalert/
scp -i ~/Downloads/payalert-key.pem -r ./audit-portal       ubuntu@<PUBLIC_IP>:/opt/payalert/

# Restart the affected service
sudo systemctl restart payalert-generator   # or payalert-portal
```

### Minimum IAM permissions for the deploying identity

If you cannot use `AdministratorAccess`:

```
cloudformation:*
s3:CreateBucket, s3:PutObject, s3:GetObject, s3:ListBucket, s3:DeleteObject
lambda:CreateFunction, lambda:UpdateFunctionCode, lambda:UpdateFunctionConfiguration,
  lambda:AddPermission, lambda:GetFunction, lambda:DeleteFunction
sqs:CreateQueue, sqs:DeleteQueue, sqs:SetQueueAttributes, sqs:GetQueueAttributes
dynamodb:CreateTable, dynamodb:DeleteTable, dynamodb:DescribeTable, dynamodb:UpdateTable
sns:CreateTopic, sns:DeleteTopic, sns:Subscribe, sns:SetTopicAttributes
iam:CreateRole, iam:DeleteRole, iam:AttachRolePolicy, iam:DetachRolePolicy,
  iam:PutRolePolicy, iam:DeleteRolePolicy, iam:PassRole, iam:GetRole
logs:CreateLogGroup, logs:PutRetentionPolicy, logs:DeleteLogGroup
cloudwatch:PutMetricAlarm, cloudwatch:DeleteAlarms
```

