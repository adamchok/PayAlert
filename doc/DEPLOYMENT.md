# PayAlert — AWS Deployment Guide

Step-by-step instructions for deploying and running the full PayAlert architecture from scratch: Lambda pipeline, custom VPC, EC2 transaction generator, audit portal, ALB, and ASG.

> **Platform:** EC2 steps target **Ubuntu Server 26.04 LTS**. All deployment is performed through the **AWS Management Console** — no SAM CLI or Docker required.

---

## Architecture

```
                    ┌──────────────────────────────────────────────────────────┐
                    │  Custom VPC (10.0.0.0/16)                                │
                    │                                                          │
                    │  Public Subnets — 10.0.1.0/24  ·  10.0.2.0/24            │
  Internet          │  ┌─────────────────┐   ┌───────────────────────────────┐ │
     │              │  │  NAT Gateway    │   │  Application Load Balancer    │ │
     └─► ALB ───────┼──┤  (Elastic IP)   │   │  :80  → Audit Portal          │ │
       :80 / :5001  │  └────────┬────────┘   │  :5001 → Generator UI         │ │
                    │           │            └────────────────┬──────────────┘ │
  Developer         │           │                             │                │
     │              │  Private Subnets — 10.0.3.0/24 · 10.0.4.0/24             │
     └─► EIC ───────┼─────────────────────────────────────────│                │
       (SSH tunnel) │  ┌──────────────────────┐  ┌────────────┴─────────────┐  │
                    │  │  EC2 — payalert-ec2  │  │  ASG — Audit Portal      │  │
                    │  │  Generator + Web UI  │  │  (port 3000)             │  │
                    │  │  (port 5001)         │  │  Next.js 16              │  │
                    │  └──────────────────────┘  └──────────────────────────┘  │
                    └──────────────────────────────────────────────────────────┘
                                        │ outbound via NAT Gateway
                                        ▼
                                  AWS Lambda ◄─── SQS
                                 ┌────┴────┐
                              DynamoDB   SNS (email)
```

**EIC** = EC2 Instance Connect Endpoint. Provides SSH access to private instances with no public IP and no bastion host required.

**Components deployed:**

| Component                     | Where                               | What it does                                          |
| ----------------------------- | ----------------------------------- | ----------------------------------------------------- |
| Lambda + SQS + DynamoDB + SNS | AWS (via CloudFormation Console)    | Processes and stores transactions, sends fraud alerts |
| Custom VPC                    | AWS                                 | Isolates all EC2 resources from the default VPC       |
| NAT Gateway                   | Public Subnet (payalert-public-1)   | Outbound internet access for private subnet instances |
| EIC Endpoint                  | Private Subnet (payalert-private-1) | SSH tunnel to private EC2 — no public IP, no bastion |
| Transaction Generator         | EC2 (Private Subnet)                | Streams synthetic transactions to SQS                 |
| Generator Web UI              | EC2 (Private Subnet, via ALB :5001) | Browser control panel — protected by login            |
| Audit Portal                  | ASG behind ALB (port 80)            | Live fraud dashboard reading DynamoDB                 |

---

## Prerequisites

### On your workstation

| Requirement      | Notes                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| Web browser      | For the AWS Management Console                                                                     |
| AWS CLI v2       | Required for SSH tunnelling via EIC Endpoint. [Install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) |
| SSH client       | Built into macOS and Linux terminals; Git Bash or WSL2 on Windows                                  |
| Python 3.11+     | For packaging the Lambda function (only needed on your workstation for Step 1)                     |

**AWS CLI credentials for Learner Labs:** In the Academy portal, click **AWS Details** → **Show** next to AWS CLI → copy the block and paste it into `~/.aws/credentials` (create the file if it doesn't exist). Repeat whenever the session restarts.

> No Docker or SAM CLI required.

### AWS account

You need an AWS account with permissions to create CloudFormation stacks, Lambda functions, SQS queues, DynamoDB tables, SNS topics, S3 buckets, VPCs, load balancers, and VPC endpoints.

---

## Step 1 — Deploy the Lambda pipeline

All steps in this section are performed through the AWS Management Console.

### 1.1 Create an S3 bucket for the Lambda artifact

1. Open the **[S3 Console](https://s3.console.aws.amazon.com/s3/buckets)** → **Create bucket**.
2. **Bucket name:** `payalert-artifacts-{your-12-digit-account-id}` (must be globally unique)
3. **Region:** `us-east-1`
4. Leave all other settings at their defaults → **Create bucket**.

### 1.2 Package the Lambda function

The handler has no external dependencies beyond `boto3`, which is pre-installed in the Lambda runtime.

Run from the `lambda/transaction-processor/` directory on your workstation:

**Ubuntu / macOS / Git Bash:**

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

1. Open the **[CloudFormation Console](https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1)**.
2. **Create stack** → **With new resources (standard)**.
3. **Template source:** Upload a template file → **Choose file** → select the modified `lambda/template.yaml` → **Next**.
4. Fill in the stack details:
   - **Stack name:** `payalert-stack`
5. Fill in the parameters:

| Parameter            | Value                                         |
| -------------------- | --------------------------------------------- |
| `Environment`        | `dev`                                         |
| `AlertEmail`         | your real email address                       |
| `AlertRiskThreshold` | `50`                                          |
| `TransactionTTLDays` | `90`                                          |
| `LambdaRoleArn`      | `arn:aws:iam::<your-account-id>:role/LabRole` |

> **Resource tagging:** All resources in this stack are tagged `Project: PayAlert`, `Group: payalert-group-4`, and `Environment: dev`. These tags are applied automatically — no manual action needed.

> **AWS Academy Learner Labs:** You cannot create IAM roles. The `LambdaRoleArn` parameter lets you supply the pre-existing `LabRole` instead. Find your account ID in the top-right corner of the AWS Console. The full ARN is `arn:aws:iam::<account-id>:role/LabRole`.
>
> **Note:** Learner Lab account IDs change between sessions. If you redeploy after restarting a lab, update this parameter with the new account ID.

6. **Next** → **Next**.
7. Under **Capabilities**, check **☑ I acknowledge that AWS CloudFormation might create IAM resources**.
8. **Submit**.

Wait for status **CREATE_COMPLETE** (~2–3 minutes).

### 1.6 Save the stack outputs

1. **CloudFormation** → **Stacks** → `payalert-stack` → **Outputs** tab.
2. Copy these values — you will need them in later steps:

| Key                     | Example value                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `TransactionQueueUrl`   | `https://sqs.us-east-1.amazonaws.com/123456789012/payalert-transactions-queue-dev` |
| `DLQUrl`                | `https://sqs.us-east-1.amazonaws.com/123456789012/payalert-transactions-dlq-dev`   |
| `TransactionsTableName` | `payalert-transactions`                                                            |
| `AlertTopicArn`         | `arn:aws:sns:us-east-1:123456789012:payalert-alerts-dev`                           |

### 1.7 Confirm the SNS email subscription

AWS sends a confirmation email to `AlertEmail` immediately after deployment. Open the email from `no-reply@sns.amazonaws.com` and click **Confirm subscription**.

---

## Step 2 — Create the EC2 IAM role

> **AWS Academy Learner Labs:** You cannot create IAM roles. Skip this step and use the existing `LabRole` — attach it as the instance profile in Step 4.

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
        "sqs:GetQueueAttributes",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage"
      ],
      "Resource": "arn:aws:sqs:us-east-1:*:payalert-transactions-*"
    },
    {
      "Sid": "DynamoDBRead",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:*:table/payalert-transactions*",
        "arn:aws:dynamodb:us-east-1:*:table/payalert-transactions*/index/*"
      ]
    }
  ]
}
```

3. **Policy name:** `PayAlertEC2Policy` → **Create policy**.

### 2.2 Create the IAM role

1. **[IAM Console](https://console.aws.amazon.com/iam/home#/roles)** → **Roles** → **Create role**.
2. **Trusted entity type:** AWS service → **EC2** → **Next**.
3. Search for and select `PayAlertEC2Policy` → **Next**.
4. **Role name:** `PayAlertEC2Role` → **Create role**.

---

## Step 3 — Create the Custom VPC

All resources must reside in a custom VPC. This step builds the full network: subnets, internet gateway, NAT gateway, route tables, EC2 Instance Connect Endpoint, and security groups.

### 3.1 Create the VPC

1. **[VPC Console](https://us-east-1.console.aws.amazon.com/vpc/home?region=us-east-1#vpcs:)** → **Create VPC**.
2. Configure:

| Setting                 | Value          |
| ----------------------- | -------------- |
| **Resources to create** | VPC only       |
| **Name tag**            | `payalert-vpc` |
| **IPv4 CIDR block**     | `10.0.0.0/16`  |

3. **Create VPC**.

### 3.2 Create subnets

Create four subnets. The **public** subnets hold the ALB and NAT Gateway. The **private** subnets hold all EC2 compute — no direct internet access.

**[VPC Console](https://us-east-1.console.aws.amazon.com/vpc/home?region=us-east-1#subnets:)** → **Create subnet** → select `payalert-vpc`, then add all four:

| Subnet name          | Availability Zone | IPv4 CIDR     | Purpose                    |
| -------------------- | ----------------- | ------------- | -------------------------- |
| `payalert-public-1`  | `us-east-1a`      | `10.0.1.0/24` | ALB + NAT Gateway          |
| `payalert-public-2`  | `us-east-1b`      | `10.0.2.0/24` | ALB (second AZ)            |
| `payalert-private-1` | `us-east-1a`      | `10.0.3.0/24` | EC2 generator + EIC endpoint |
| `payalert-private-2` | `us-east-1b`      | `10.0.4.0/24` | ASG instances (second AZ)  |

After creating, enable **auto-assign public IPv4** on both **public** subnets only:
- Select `payalert-public-1` → **Actions** → **Edit subnet settings** → ☑ **Enable auto-assign public IPv4 address** → **Save**.
- Repeat for `payalert-public-2`.

Do **not** enable auto-assign public IPv4 on the private subnets.

### 3.3 Create and attach an Internet Gateway

1. **[VPC Console](https://us-east-1.console.aws.amazon.com/vpc/home?region=us-east-1#igws:)** → **Internet Gateways** → **Create internet gateway**.
2. **Name tag:** `payalert-igw` → **Create internet gateway**.
3. Select `payalert-igw` → **Actions** → **Attach to VPC** → select `payalert-vpc` → **Attach**.

### 3.4 Configure the public route table

1. **[VPC Console](https://us-east-1.console.aws.amazon.com/vpc/home?region=us-east-1#routetables:)** → **Route Tables** → select the route table automatically created with `payalert-vpc`.
2. Rename it: **Name tag** → `payalert-public-rt`.
3. **Routes** tab → **Edit routes** → **Add route**:
   - **Destination:** `0.0.0.0/0`
   - **Target:** `payalert-igw`
   - **Save changes**.
4. **Subnet associations** tab → **Edit subnet associations** → select `payalert-public-1` and `payalert-public-2` → **Save associations**.

### 3.5 Create a NAT Gateway

The NAT Gateway allows private subnet instances to reach AWS APIs (SQS, DynamoDB) and install packages — without being reachable from the internet.

1. **[VPC Console](https://us-east-1.console.aws.amazon.com/vpc/home?region=us-east-1#eips:)** → **Elastic IPs** → **Allocate Elastic IP address** → **Allocate**.
   - Add **Name tag:** `payalert-eip`. Note the **Allocation ID**.

2. **[VPC Console](https://us-east-1.console.aws.amazon.com/vpc/home?region=us-east-1#NatGateways:)** → **NAT Gateways** → **Create NAT gateway**.

| Setting               | Value               |
| --------------------- | ------------------- |
| **Name**              | `payalert-nat-gw`   |
| **Subnet**            | `payalert-public-1` |
| **Connectivity type** | Public              |
| **Elastic IP**        | `payalert-eip`      |

3. **Create NAT gateway**. Wait for status **Available** (~60 seconds).

### 3.6 Configure the private route table

1. **VPC Console** → **Route Tables** → **Create route table**.

| Setting      | Value                 |
| ------------ | --------------------- |
| **Name tag** | `payalert-private-rt` |
| **VPC**      | `payalert-vpc`        |

2. Select `payalert-private-rt` → **Routes** tab → **Edit routes** → **Add route**:
   - **Destination:** `0.0.0.0/0`
   - **Target:** `payalert-nat-gw`
   - **Save changes**.
3. **Subnet associations** tab → **Edit subnet associations** → select `payalert-private-1` and `payalert-private-2` → **Save associations**.

### 3.7 Create security groups

Three security groups control all network access.

#### ALB security group (`PayAlertALBSG`)

**[EC2 Console](https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#SecurityGroups:)** → **Security Groups** → **Create security group**.

- **Name:** `PayAlertALBSG` — **VPC:** `payalert-vpc`

Inbound rules:

| Type       | Port | Source    | Purpose                                        |
| ---------- | ---- | --------- | ---------------------------------------------- |
| HTTP       | 80   | 0.0.0.0/0 | Public access to audit portal                  |
| Custom TCP | 5001 | My IP     | Generator UI — locked to your IP address only  |

> Keep port 5001 locked to **My IP**. This means only your workstation can reach the generator UI, even though the ALB is internet-facing.

**Create security group**. Copy the **Security Group ID** — needed in the next step.

#### EIC Endpoint security group (`PayAlertEICESG`)

**Security Groups** → **Create security group**.

- **Name:** `PayAlertEICESG` — **VPC:** `payalert-vpc`

No inbound rules. Outbound rules (replace the default):

| Type       | Port | Destination | Purpose                            |
| ---------- | ---- | ----------- | ---------------------------------- |
| Custom TCP | 22   | 10.0.0.0/16 | SSH from the endpoint into the VPC |

**Create security group**.

#### EC2 security group (`PayAlertEC2SG`)

**Security Groups** → **Create security group**.

- **Name:** `PayAlertEC2SG` — **VPC:** `payalert-vpc`

Inbound rules:

| Type       | Port | Source           | Purpose                              |
| ---------- | ---- | ---------------- | ------------------------------------ |
| SSH        | 22   | `PayAlertEICESG` | SSH tunnelled via EIC Endpoint only  |
| Custom TCP | 3000 | `PayAlertALBSG`  | Audit portal — ALB only              |
| Custom TCP | 5001 | `PayAlertALBSG`  | Generator UI — ALB only              |

**Create security group**.

> Port 22 is only reachable via the EIC Endpoint — not from the public internet. This means SSH is available without exposing port 22 externally.

### 3.8 Create the EC2 Instance Connect Endpoint

The EIC Endpoint is a managed tunnel that lets you SSH into private EC2 instances using your existing key pair, without a bastion host or public IP.

1. **[VPC Console](https://us-east-1.console.aws.amazon.com/vpc/home?region=us-east-1#Endpoints:)** → **Endpoints** → **Create endpoint**.
2. Configure:

| Setting                 | Value                   |
| ----------------------- | ----------------------- |
| **Name tag**            | `payalert-eice`         |
| **Service category**    | EC2 Instance Connect Endpoint |
| **VPC**                 | `payalert-vpc`          |
| **Security groups**     | `PayAlertEICESG`        |
| **Subnet**              | `payalert-private-1`    |

3. **Create endpoint**. Wait for status **Available** (~2 minutes).

---

## Step 4 — Launch the EC2 instance

### 4.1 Create a key pair

1. **[EC2 Console](https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#KeyPairs:)** → **Key Pairs** → **Create key pair**.
2. **Name:** `payalert-key`, **Type:** RSA, **Format:** `.pem`.
3. Download and save the `.pem` file.

On macOS/Linux, set correct permissions:

```bash
chmod 400 ~/Downloads/payalert-key.pem
```

### 4.2 Launch the instance

1. **[EC2 Console](https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#LaunchInstances:)** → **Launch instances**.
2. Configure:

| Setting           | Value                                |
| ----------------- | ------------------------------------ |
| **Name**          | `payalert-ec2`                       |
| **AMI**           | Ubuntu Server 26.04 LTS (64-bit x86) |
| **Instance type** | `t3.micro`                           |
| **Key pair**      | `payalert-key`                       |

3. Under **Network settings** → **Edit**:
   - **VPC:** `payalert-vpc`
   - **Subnet:** `payalert-private-1`
   - **Auto-assign public IP:** **Disable**
   - **Security group:** select existing → `PayAlertEC2SG`

4. Expand **Advanced details** → **IAM instance profile** → select `LabRole` (or `PayAlertEC2Role`).
5. **Launch instance**.

### 4.3 Connect via SSH through the EIC Endpoint

Wait ~60 seconds for the instance to enter the **Running** state and pass both status checks.

Get the **Instance ID** from **EC2** → **Instances** → select `payalert-ec2` (format: `i-xxxxxxxxxxxxxxxxx`).

**macOS / Linux / Git Bash (Windows):**

```bash
ssh -i ~/Downloads/payalert-key.pem \
  -o ProxyCommand="aws ec2-instance-connect open-tunnel --instance-id %h --region us-east-1" \
  ubuntu@<INSTANCE_ID>
```

**Windows (PowerShell + OpenSSH):**

```powershell
ssh -i "$HOME\Downloads\payalert-key.pem" `
  -o ProxyCommand="aws ec2-instance-connect open-tunnel --instance-id %h --region us-east-1" `
  ubuntu@<INSTANCE_ID>
```

> The EIC tunnel authenticates using your AWS CLI credentials (`~/.aws/credentials`). Ensure they are up-to-date if you restarted your Learner Lab session.

You can also connect from the **AWS Console**: **EC2** → **Instances** → select `payalert-ec2` → **Connect** → **EC2 Instance Connect** tab → **Connect** (this uses a browser-based terminal without needing the key pair).

---

## Step 5 — Set up the transaction generator

All commands in this section run **on the EC2 instance** unless noted otherwise.

### 5.1 Update the system and install Python

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-pip python3-venv git
python3 --version
```

### 5.2 Copy the generator to the instance

Run this **on your workstation**, replacing `<INSTANCE_ID>` with the EC2 Instance ID from Step 4.3.

**macOS / Linux / Git Bash:**

```bash
scp -i ~/Downloads/payalert-key.pem \
  -o ProxyCommand="aws ec2-instance-connect open-tunnel --instance-id %h --region us-east-1" \
  -r ./transaction-generator ubuntu@<INSTANCE_ID>:/tmp/
```

**Windows (PowerShell + OpenSSH):**

```powershell
scp -i "$HOME\Downloads\payalert-key.pem" `
  -o ProxyCommand="aws ec2-instance-connect open-tunnel --instance-id %h --region us-east-1" `
  -r .\transaction-generator ubuntu@<INSTANCE_ID>:/tmp/
```

Back on the EC2 instance:

```bash
sudo mkdir -p /opt/payalert
sudo mv /tmp/transaction-generator /opt/payalert/transaction-generator
sudo chown -R ubuntu:ubuntu /opt/payalert
```

### 5.3 Install Python dependencies

```bash
cd /opt/payalert/transaction-generator
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
deactivate
```

### 5.4 Create the environment file

Replace `SQS_QUEUE_URL` with the `TransactionQueueUrl` from Step 1.6. Set a strong `UI_PASSWORD` — this is the login for the generator web UI.

```bash
sudo tee /opt/payalert/generator.env > /dev/null <<'EOF'
AWS_REGION=us-east-1
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/ACCOUNT_ID/payalert-transactions-queue-dev
UI_USERNAME=payalert
UI_PASSWORD=ChangeMe123!
EOF
```

### 5.5 Run a quick test

```bash
cd /opt/payalert/transaction-generator
source .venv/bin/activate
export $(cat /opt/payalert/generator.env | xargs)
python3 generator.py --mode batch --count 5 --verbose
deactivate
```

You should see 5 transactions sent successfully. If you get `AccessDenied`, verify the IAM role is attached: **EC2** → **Instances** → select instance → **Security** tab → **IAM Role**.

### 5.6 Create the systemd service

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

View live logs:

```bash
sudo journalctl -u payalert-generator -f
```

---

## Step 6 — Set up the generator web UI

The web UI (`app.py`) lives in the same `transaction-generator` directory already deployed in Step 5. It provides a browser control panel to start/stop the transaction stream and watch live logs via Server-Sent Events. Access is protected by HTTP Basic Auth — the browser will prompt for the `UI_USERNAME` and `UI_PASSWORD` you set in Step 5.4.

### 6.1 Run a quick test

```bash
cd /opt/payalert/transaction-generator
source .venv/bin/activate
export $(cat /opt/payalert/generator.env | xargs)
python3 app.py
```

You should see `* Running on http://0.0.0.0:5001`. Press `Ctrl+C`, then `deactivate`.

The UI will be accessible through the ALB after Step 8. You do not need to open the instance's IP directly.

### 6.2 Create the systemd service

```bash
sudo tee /etc/systemd/system/payalert-portal.service > /dev/null <<'EOF'
[Unit]
Description=PayAlert Generator Web UI
After=network.target

[Service]
Type=simple
User=ubuntu
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
```

---

## Step 7 — Set up the audit portal

The audit portal is a Next.js 16 app that reads from DynamoDB and gives fraud analysts a live dashboard.

All commands in this section run **on the EC2 instance** unless noted otherwise.

### 7.1 Install Node.js 20

Ubuntu 26.04 ships with an older Node.js. Install the LTS version via NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should print v20.x.x
```

### 7.2 Copy the audit portal to the instance

Run this **on your workstation**:

**macOS / Linux / Git Bash:**

```bash
rsync -avz --exclude='node_modules' --exclude='.next' \
  -e "ssh -i ~/Downloads/payalert-key.pem -o 'ProxyCommand=aws ec2-instance-connect open-tunnel --instance-id %h --region us-east-1'" \
  ./audit-portal-v2/ ubuntu@<INSTANCE_ID>:/opt/payalert/audit-portal-v2/
```

**Windows (PowerShell + OpenSSH — no rsync):**

```powershell
# Zip the portal directory (skips node_modules and .next which won't exist on dev machine)
Compress-Archive -Path .\audit-portal-v2 -DestinationPath "$env:TEMP\audit-portal-v2.zip" -Force

# Copy the zip to the instance
scp -i "$HOME\Downloads\payalert-key.pem" `
  -o ProxyCommand="aws ec2-instance-connect open-tunnel --instance-id %h --region us-east-1" `
  "$env:TEMP\audit-portal-v2.zip" ubuntu@<INSTANCE_ID>:/tmp/
```

Then on the EC2 instance (Windows path):

```bash
unzip /tmp/audit-portal-v2.zip -d /opt/payalert/
sudo chown -R ubuntu:ubuntu /opt/payalert/audit-portal-v2
```

### 7.3 Create the environment file

```bash
cat > /opt/payalert/audit-portal-v2/.env.local <<'EOF'
DYNAMODB_TABLE=payalert-transactions
AWS_REGION=us-east-1
NEXT_PUBLIC_ENVIRONMENT=prod
DLQ_URL=https://sqs.us-east-1.amazonaws.com/ACCOUNT_ID/payalert-transactions-dlq-dev
MAIN_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/ACCOUNT_ID/payalert-transactions-queue-dev
EOF
```

> Replace `ACCOUNT_ID` with your 12-digit AWS account ID. `DLQ_URL` and `MAIN_QUEUE_URL` are in the CloudFormation stack Outputs tab (Step 1.6).

### 7.4 Install dependencies and build

```bash
cd /opt/payalert/audit-portal-v2
npm install
npm run build
```

The build takes 1–5 minutes. You should see a `✓ Compiled successfully` message at the end.

### 7.5 Quick test

```bash
cd /opt/payalert/audit-portal-v2
npm start
```

From another SSH session: `curl -s http://localhost:3000 | head -5` — you should see HTML. Press `Ctrl+C` to stop.

### 7.6 Create the systemd service

```bash
sudo tee /etc/systemd/system/payalert-audit-portal.service > /dev/null <<'EOF'
[Unit]
Description=PayAlert Audit Portal
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/payalert/audit-portal-v2
ExecStart=/usr/bin/npm start
EnvironmentFile=/opt/payalert/audit-portal-v2/.env.local
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now payalert-audit-portal
sudo systemctl status payalert-audit-portal
```

---

## Step 8 — Create the Target Groups and ALB

The ALB serves both applications from a single endpoint, using separate listeners and target groups.

### 8.1 Create the audit portal target group

1. **[EC2 Console](https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#TargetGroups:)** → **Target Groups** → **Create target group**.
2. Configure:

| Setting               | Value               |
| --------------------- | ------------------- |
| **Target type**       | Instances           |
| **Target group name** | `payalert-audit-tg` |
| **Protocol**          | HTTP                |
| **Port**              | `3000`              |
| **VPC**               | `payalert-vpc`      |

3. Health checks: Protocol HTTP, Path `/`, Healthy threshold 2, Unhealthy threshold 3, Interval 30 s.
4. **Next** → **Register targets** → select `payalert-ec2` → **Include as pending below** → **Create target group**.

### 8.2 Create the generator target group

1. **Target Groups** → **Create target group**.
2. Configure:

| Setting               | Value                   |
| --------------------- | ----------------------- |
| **Target type**       | Instances               |
| **Target group name** | `payalert-generator-tg` |
| **Protocol**          | HTTP                    |
| **Port**              | `5001`                  |
| **VPC**               | `payalert-vpc`          |

3. Health checks: Protocol HTTP, Path `/`, Healthy threshold 2, Unhealthy threshold 3, Interval 30 s.
4. **Next** → **Register targets** → select `payalert-ec2` → **Include as pending below** → **Create target group**.

### 8.3 Create the Application Load Balancer

1. **[EC2 Console](https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#LoadBalancers:)** → **Load Balancers** → **Create load balancer** → **Application Load Balancer**.
2. Configure:

| Setting              | Value                                                                          |
| -------------------- | ------------------------------------------------------------------------------ |
| **Name**             | `payalert-alb`                                                                 |
| **Scheme**           | Internet-facing                                                                |
| **IP address type**  | IPv4                                                                           |
| **VPC**              | `payalert-vpc`                                                                 |
| **Mappings**         | ☑ `us-east-1a` → `payalert-public-1` <br> ☑ `us-east-1b` → `payalert-public-2` |
| **Security group**   | `PayAlertALBSG` (remove the default)                                           |

3. **Listeners and routing** — add two listeners:

| Listener | Protocol | Port | Default action                   |
| -------- | -------- | ---- | -------------------------------- |
| 1        | HTTP     | 80   | Forward to `payalert-audit-tg`   |
| 2        | HTTP     | 5001 | Forward to `payalert-generator-tg` |

Click **Add listener** to add the second row.

4. **Create load balancer**.
5. Wait ~2 minutes, then copy the **DNS name** (e.g. `payalert-alb-123456789.us-east-1.elb.amazonaws.com`). This is the base URL for both applications.

---

## Step 9 — Create the Launch Template and Auto Scaling Group

The ASG ensures the audit portal remains available and can scale. The Launch Template is created from an AMI snapshot of the configured EC2 instance.

### 9.1 Prepare the instance and create an AMI

Before taking the AMI, stop and disable the generator services so that ASG instances only run the audit portal (not the generator):

```bash
sudo systemctl stop payalert-generator payalert-portal
sudo systemctl disable payalert-generator payalert-portal
```

> The original `payalert-ec2` will keep running these services — you are only disabling them for the AMI snapshot.

Now take the AMI:

1. **EC2** → **Instances** → select `payalert-ec2` → **Actions** → **Image and templates** → **Create image**.

| Setting         | Value                 |
| --------------- | --------------------- |
| **Image name**  | `payalert-portal-ami` |
| **Description** | PayAlert audit portal |
| **No reboot**   | ☑ Enable              |

2. **Create image**. Wait for the AMI status to become **Available** (~2–5 minutes): **EC2** → **AMIs**.

After the AMI is created, re-enable the generator services on the original EC2:

```bash
sudo systemctl enable --now payalert-generator payalert-portal
```

### 9.2 Create a Launch Template

1. **[EC2 Console](https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#LaunchTemplates:)** → **Launch Templates** → **Create launch template**.
2. Configure:

| Setting             | Value                                         |
| ------------------- | --------------------------------------------- |
| **Name**            | `payalert-portal-lt`                          |
| **AMI**             | `payalert-portal-ami` (select from My AMIs)   |
| **Instance type**   | `t3.large`                                    |
| **Key pair**        | `payalert-key`                                |
| **Security groups** | `PayAlertEC2SG`                               |

3. Expand **Advanced details** → **IAM instance profile** → select `LabRole` (or `PayAlertEC2Role`).
4. **Create launch template**.

### 9.3 Create the Auto Scaling Group

1. **[EC2 Console](https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#AutoScalingGroups:)** → **Auto Scaling Groups** → **Create Auto Scaling group**.
2. **Step 1 — Name and template:**
   - **Name:** `payalert-portal-asg`
   - **Launch template:** `payalert-portal-lt`
   - **Next**.

3. **Step 2 — Instance launch options:**
   - **VPC:** `payalert-vpc`
   - **Availability Zones and subnets:** `payalert-private-1`, `payalert-private-2`
   - **Next**.

4. **Step 3 — Load balancing:**
   - ☑ **Attach to an existing load balancer**
   - **Choose from your load balancer target groups** → `payalert-audit-tg`
   - ☑ **Turn on Elastic Load Balancing health checks**
   - **Next**.

5. **Step 4 — Configure group size:**

| Setting              | Value |
| -------------------- | ----- |
| **Desired capacity** | `1`   |
| **Minimum capacity** | `1`   |
| **Maximum capacity** | `2`   |

6. **Next** → **Next** → **Create Auto Scaling group**.

### 9.4 Verify the target group health

1. **EC2** → **Target Groups** → `payalert-audit-tg` → **Targets** tab.
2. Wait until both the EC2 and ASG instances show **Healthy** (~2–3 minutes).
3. Open `http://<ALB_DNS_NAME>` in a browser — the audit portal should load via the ALB.

---

## Step 10 — End-to-end smoke test

### 10.1 Verify Lambda is processing

1. **[CloudWatch Console](https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups)** → log group `/aws/lambda/payalert-transaction-processor-dev`.
2. Select the most recent log stream.
3. Look for lines like:

```
Stored transaction=<uuid> account=ACC-MY-4F291A3B riskScore=12 riskLevel=LOW isFlagged=False
```

### 10.2 Verify DynamoDB is being populated

**[DynamoDB Console](https://us-east-1.console.aws.amazon.com/dynamodbv2/home?region=us-east-1#tables)** → `payalert-transactions` → **Explore table items** — records should be visible and accumulating.

### 10.3 Check the generator web UI

Open `http://<ALB_DNS_NAME>:5001` in a browser.

- The browser prompts for a username and password — enter the `UI_USERNAME` and `UI_PASSWORD` from Step 5.4.
- The control panel shows the configured queue URL and available accounts.
- Click **Start** to begin streaming transactions; live logs appear in the browser.
- Switch between **Stream**, **Batch**, and **Fraud** modes.

### 10.4 Check the audit portal via ALB

Open `http://<ALB_DNS_NAME>` in a browser.

- The **Dashboard** shows today's transaction count and the HIGH / CRITICAL breakdown.
- Click **Transactions** in the navbar to see the full list.
- Click any **Account ID** to see that account's full transaction history.
- Click **Dead Letter Queue** in the navbar to see failed messages with Redrive / Delete actions.

### 10.5 Trigger a fraud alert email

**[SQS Console](https://us-east-1.console.aws.amazon.com/sqs/v3/home?region=us-east-1#/queues)** → `payalert-transactions-queue-dev` → **Send and receive messages** → paste the following JSON and click **Send message**:

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

### 10.6 Verify the DLQ is empty

Normal operation should produce zero DLQ messages.

**[SQS Console](https://us-east-1.console.aws.amazon.com/sqs/v3/home?region=us-east-1#/queues)** → `payalert-transactions-dlq-dev` → **Details** pane → **Messages available** should be `0`.

Any non-zero value means a transaction failed processing three times. Investigate via **CloudWatch** → log group `/aws/lambda/payalert-transaction-processor-dev`.

---

## Step 11 — Run in fraud mode

To generate a higher volume of flagged transactions for audit portal demonstrations:

```bash
# SSH into the generator EC2
ssh -i ~/Downloads/payalert-key.pem \
  -o ProxyCommand="aws ec2-instance-connect open-tunnel --instance-id %h --region us-east-1" \
  ubuntu@<INSTANCE_ID>

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

SSH into the instance and run:

```bash
sudo systemctl stop payalert-generator payalert-portal payalert-audit-portal
sudo systemctl disable payalert-generator payalert-portal payalert-audit-portal
```

### Delete the ASG and ALB

1. **EC2** → **Auto Scaling Groups** → select `payalert-portal-asg` → **Delete** → confirm.
2. **EC2** → **Load Balancers** → select `payalert-alb` → **Actions** → **Delete** → confirm.
3. **EC2** → **Target Groups** → select `payalert-audit-tg` → **Actions** → **Delete** → confirm.
4. **EC2** → **Target Groups** → select `payalert-generator-tg` → **Actions** → **Delete** → confirm.
5. **EC2** → **Launch Templates** → select `payalert-portal-lt` → **Actions** → **Delete** → confirm.
6. **EC2** → **AMIs** → select `payalert-portal-ami` → **Actions** → **Deregister AMI** → confirm.

### Delete the Lambda stack

1. **[CloudFormation Console](https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1)** → **Stacks** → select `payalert-stack` → **Delete** → **Delete stack**.

> The DynamoDB table has `DeletionPolicy: Retain` and will **not** be deleted with the stack.

To also delete the retained table: **DynamoDB** → `payalert-transactions` → **Delete**.

To clean up S3: **S3** → `payalert-artifacts-{account-id}` → **Empty** → confirm, then **Delete**.

### Delete the VPC and networking

Delete in this order to avoid dependency errors:

1. **VPC** → **Endpoints** → select `payalert-eice` → **Actions** → **Delete VPC endpoints** → confirm.
2. **VPC** → **NAT Gateways** → select `payalert-nat-gw` → **Actions** → **Delete NAT gateway** → confirm. Wait for status **Deleted** (~60 seconds).
3. **VPC** → **Elastic IPs** → select `payalert-eip` → **Actions** → **Release Elastic IP address** → confirm.
4. **EC2** → **Security Groups** → delete `PayAlertALBSG`, `PayAlertEICESG`, and `PayAlertEC2SG`.
5. **VPC** → **Internet Gateways** → select `payalert-igw` → **Actions** → **Detach from VPC** → then **Delete**.
6. **VPC** → **Subnets** → delete all four `payalert-*` subnets.
7. **VPC** → **Route Tables** → delete `payalert-public-rt` and `payalert-private-rt`.
8. **VPC** → **Your VPCs** → select `payalert-vpc` → **Actions** → **Delete VPC** → confirm.

### Terminate EC2 instances

**EC2** → **Instances** → select `payalert-ec2` → **Instance state** → **Terminate instance**.

> ASG instances are terminated automatically when the ASG is deleted.

---

## Quick Reference

### Resource names

| Resource                   | Name / Value                                     |
| -------------------------- | ------------------------------------------------ |
| VPC                        | `payalert-vpc` (10.0.0.0/16)                     |
| Public subnets             | `payalert-public-1`, `payalert-public-2`         |
| Private subnets            | `payalert-private-1`, `payalert-private-2`       |
| Internet Gateway           | `payalert-igw`                                   |
| Elastic IP                 | `payalert-eip`                                   |
| NAT Gateway                | `payalert-nat-gw`                                |
| Public route table         | `payalert-public-rt`                             |
| Private route table        | `payalert-private-rt`                            |
| EIC Endpoint               | `payalert-eice`                                  |
| ALB security group         | `PayAlertALBSG`                                  |
| EIC security group         | `PayAlertEICESG`                                 |
| EC2 security group         | `PayAlertEC2SG`                                  |
| Load balancer              | `payalert-alb`                                   |
| Audit portal target group  | `payalert-audit-tg` (port 3000)                  |
| Generator target group     | `payalert-generator-tg` (port 5001)              |
| Launch template            | `payalert-portal-lt`                             |
| Auto Scaling Group         | `payalert-portal-asg`                            |
| SQS queue                  | `payalert-transactions-queue-dev`                |
| SQS DLQ                    | `payalert-transactions-dlq-dev`                  |
| DynamoDB table             | `payalert-transactions`                          |
| SNS topic                  | `payalert-alerts-dev`                            |
| Lambda function            | `payalert-transaction-processor-dev`             |
| CloudWatch log group       | `/aws/lambda/payalert-transaction-processor-dev` |
| CloudFormation stack       | `payalert-stack`                                 |
| S3 artifacts bucket        | `payalert-artifacts-{account-id}`                |
| EC2 IAM role               | `LabRole` (or `PayAlertEC2Role`)                 |

### SSH cheat sheet

All SSH commands use the EIC Endpoint tunnel — replace `<INSTANCE_ID>` with `i-xxxxxxxxxxxxxxxxx`.

```bash
# SSH into any private EC2 instance
ssh -i ~/Downloads/payalert-key.pem \
  -o ProxyCommand="aws ec2-instance-connect open-tunnel --instance-id %h --region us-east-1" \
  ubuntu@<INSTANCE_ID>

# Copy a file to the instance
scp -i ~/Downloads/payalert-key.pem \
  -o ProxyCommand="aws ec2-instance-connect open-tunnel --instance-id %h --region us-east-1" \
  ./local-file ubuntu@<INSTANCE_ID>:/remote/path/

# Sync a directory to the instance (macOS/Linux/Git Bash)
rsync -avz --exclude='node_modules' --exclude='.next' \
  -e "ssh -i ~/Downloads/payalert-key.pem -o 'ProxyCommand=aws ec2-instance-connect open-tunnel --instance-id %h --region us-east-1'" \
  ./local-dir/ ubuntu@<INSTANCE_ID>:/remote/path/
```

> **AWS CLI credentials must be valid.** If the Learner Lab session was restarted, re-paste the credentials from the Academy portal into `~/.aws/credentials`.

### Console navigation cheat sheet

| Task                    | Console path                                                               |
| ----------------------- | -------------------------------------------------------------------------- |
| View Lambda logs        | CloudWatch → Log groups → `/aws/lambda/payalert-transaction-processor-dev` |
| Check CloudWatch alarms | CloudWatch → Alarms → search `payalert`                                    |
| Browse DynamoDB items   | DynamoDB → Tables → `payalert-transactions` → Explore table items          |
| Check SQS queue depth   | SQS → `payalert-transactions-queue-dev` → Details pane                     |
| Check DLQ depth         | SQS → `payalert-transactions-dlq-dev` → Details pane                       |
| Send a test message     | SQS → `payalert-transactions-queue-dev` → Send and receive messages        |
| Invoke Lambda directly  | Lambda → `payalert-transaction-processor-dev` → Test tab                   |
| Update stack            | CloudFormation → `payalert-stack` → Update                                 |
| View stack outputs      | CloudFormation → `payalert-stack` → Outputs tab                            |
| Check ALB health        | EC2 → Target Groups → `payalert-audit-tg` → Targets tab                   |
| Check ASG activity      | EC2 → Auto Scaling Groups → `payalert-portal-asg` → Activity tab          |

### EC2 service management (on the instance)

```bash
# View live logs
sudo journalctl -u payalert-generator -f
sudo journalctl -u payalert-portal -f
sudo journalctl -u payalert-audit-portal -f

# Restart services
sudo systemctl restart payalert-generator payalert-portal payalert-audit-portal

# Check status
sudo systemctl status payalert-generator payalert-portal payalert-audit-portal
```

### Updating after a code change

**Lambda code change:**

1. Re-zip: `cd lambda/transaction-processor/ && zip function.zip handler.py`
2. Re-upload to S3: S3 Console → `payalert-artifacts-{account-id}` → Upload → `function.zip`.
3. Update Lambda: **Lambda** → `payalert-transaction-processor-dev` → **Code** tab → **Upload from** → **Amazon S3 location** → enter `s3://payalert-artifacts-{account-id}/function.zip` → **Save**.

**Template / infrastructure change:**

1. **CloudFormation** → `payalert-stack` → **Update** → **Replace current template** → upload the modified `template.yaml`.
2. Re-enter `LambdaRoleArn` (`arn:aws:iam::<account-id>:role/LabRole`) — CloudFormation does not remember it between updates in Learner Labs.

**EC2 application change:**

```bash
# Generator / web UI — rsync to the EC2 generator instance
rsync -avz --exclude='.venv' --exclude='__pycache__' \
  -e "ssh -i ~/Downloads/payalert-key.pem -o 'ProxyCommand=aws ec2-instance-connect open-tunnel --instance-id %h --region us-east-1'" \
  ./transaction-generator/ ubuntu@<INSTANCE_ID>:/opt/payalert/transaction-generator/

ssh -i ~/Downloads/payalert-key.pem \
  -o ProxyCommand="aws ec2-instance-connect open-tunnel --instance-id %h --region us-east-1" \
  ubuntu@<INSTANCE_ID> "sudo systemctl restart payalert-generator payalert-portal"

# Audit portal — rebuild, rsync, restart, then create new AMI and refresh ASG
rsync -avz --exclude='node_modules' --exclude='.next' \
  -e "ssh -i ~/Downloads/payalert-key.pem -o 'ProxyCommand=aws ec2-instance-connect open-tunnel --instance-id %h --region us-east-1'" \
  ./audit-portal-v2/ ubuntu@<INSTANCE_ID>:/opt/payalert/audit-portal-v2/

ssh -i ~/Downloads/payalert-key.pem \
  -o ProxyCommand="aws ec2-instance-connect open-tunnel --instance-id %h --region us-east-1" \
  ubuntu@<INSTANCE_ID> \
  "cd /opt/payalert/audit-portal-v2 && npm install && npm run build && sudo systemctl restart payalert-audit-portal"

# After rebuilding, create a new AMI (Step 9.1) and update the Launch Template version
# so new ASG instances get the latest build
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
ec2:CreateVpc, ec2:CreateSubnet, ec2:CreateInternetGateway, ec2:CreateRouteTable,
  ec2:CreateSecurityGroup, ec2:RunInstances, ec2:CreateImage, ec2:CreateLaunchTemplate,
  ec2:CreateNatGateway, ec2:AllocateAddress, ec2:CreateInstanceConnectEndpoint
elasticloadbalancing:CreateLoadBalancer, elasticloadbalancing:CreateTargetGroup,
  elasticloadbalancing:CreateListener, elasticloadbalancing:RegisterTargets
autoscaling:CreateAutoScalingGroup, autoscaling:CreateLaunchConfiguration
```
