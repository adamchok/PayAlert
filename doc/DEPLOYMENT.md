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
     └─► SSM ───────┼─────────────────────────────────────────│                │
       (HTTPS)      │  ┌──────────────────────┐  ┌────────────┴──────────────┐ │
                    │  │  EC2 — payalert-ec2  │  │  EC2 — payalert-audit-ec2 │ │
                    │  │  Generator + Web UI  │  │  Audit portal (Next.js)   │ │
                    │  │  private-1 · :5001   │  │  private-2 · :3000 → ASG  │ │
                    │  └──────────────────────┘  └───────────────────────────┘ │
                    └──────────────────────────────────────────────────────────┘
                                        │ outbound via NAT Gateway
                                        ▼
                                  AWS Lambda ◄─── SQS
                                 ┌────┴────┐
                              DynamoDB   SNS (email)
```

**SSM** = AWS Systems Manager Session Manager. Provides browser and CLI shell access to private EC2 instances over HTTPS — no SSH port, no bastion, no EIC Endpoint required.

**Components deployed:**

| Component                     | Where                               | What it does                                          |
| ----------------------------- | ----------------------------------- | ----------------------------------------------------- |
| Lambda + SQS + DynamoDB + SNS | AWS (via CloudFormation Console)    | Processes and stores transactions, sends fraud alerts |
| Custom VPC                    | AWS                                 | Isolates all EC2 resources from the default VPC       |
| NAT Gateway                   | Public Subnet (payalert-public-1)   | Outbound internet access for private subnet instances |
| Transaction Generator         | EC2 (Private Subnet)                | Streams synthetic transactions to SQS                 |
| Generator Web UI              | EC2 (Private Subnet, via ALB :5001) | Browser control panel — protected by login            |
| Audit Portal                  | EC2 `payalert-audit-ec2` + ASG behind ALB (port 80) | Live fraud dashboard reading DynamoDB (golden image from dedicated instance) |

---

## Prerequisites

### On your workstation

| Requirement      | Notes                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| Web browser      | For the AWS Management Console                                                                     |
| AWS CLI v2       | Required for SSM Session Manager CLI access. [Install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) |
| Session Manager plugin | Required for `aws ssm start-session` CLI access. [Install guide](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) |
| Python 3.11+     | For packaging the Lambda function (only needed on your workstation for Step 1)                     |

**AWS CLI credentials for Learner Labs:** In the Academy portal, click **AWS Details** → **Show** next to AWS CLI → copy the block and paste it into `~/.aws/credentials` (create the file if it doesn't exist). Repeat whenever the session restarts.

> No Docker or SAM CLI required.

### AWS account

You need an AWS account with permissions to create CloudFormation stacks, Lambda functions, SQS queues, DynamoDB tables, SNS topics, S3 buckets, VPCs, load balancers, and VPC endpoints.

---

## CloudFormation stacks overview

The infrastructure is split across three CloudFormation templates in `lambda/`:

| Template | Stack name | Deploys | When |
|---|---|---|---|
| `template.yaml` | `payalert-stack` | Lambda, SQS, DynamoDB, SNS, CloudWatch alarms | Step 1 |
| `network-stack.yaml` | `payalert-network-stack` | VPC, subnets, NAT, security groups, EC2 instances, ALB, target groups | Step 3 |
| `asg-stack.yaml` | `payalert-asg-stack` | Launch Template, ASG, scaling policy | Step 9 (after AMI is built) |

**Parameters required for `network-stack.yaml`:**

| Parameter | Value |
|---|---|
| `Environment` | `dev` |
| `WorkstationCidr` | Your public IP + `/32` — find it at [whatismyip.com](https://www.whatismyip.com) |
| `KeyPairName` | `payalert-key` (create in Step 4.1 first) |
| `UbuntuAmiId` | Ubuntu Server 26.04 LTS AMI ID for us-east-1 — find in EC2 → AMIs → Public images |
| `InstanceProfileName` | `LabInstanceProfile` (Learner Labs default) |

**Parameters required for `asg-stack.yaml`:**

| Parameter | Value |
|---|---|
| `Environment` | `dev` |
| `AmiId` | AMI ID of `payalert-portal-ami` — built in Step 9.1 |
| `KeyPairName` | `payalert-key` |
| `InstanceProfileName` | `LabInstanceProfile` |

> The network stack exports VPC, subnet, security group, and target group values that the ASG stack imports automatically — no manual copy-paste between stacks.

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
| `EnableForceFail`    | `false`                                       |

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
| `TransactionsTableName` | `payalert-transactions-dev`                                                        |
| `AlertTopicArn`         | `arn:aws:sns:us-east-1:123456789012:payalert-alerts-dev`                           |

### 1.7 Confirm the SNS email subscription

AWS sends a confirmation email to `AlertEmail` immediately after deployment. Open the email from `no-reply@sns.amazonaws.com` and click **Confirm subscription**.

---

## Step 2 — Create the EC2 IAM role

> **AWS Academy Learner Labs:** You cannot create IAM roles. Skip this step — the network stack's `InstanceProfileName` parameter defaults to `LabInstanceProfile`, which attaches `LabRole` automatically to all EC2 instances (Step 3).

The EC2 instances need permission to write to SQS (generator) and read from DynamoDB (audit portal). One role covers both.

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

## Step 3 — Deploy the network stack

> **Before you begin:** The network stack requires a key pair named `payalert-key`. Complete **Step 4.1** to create it before deploying this stack.

All network infrastructure — VPC, subnets, NAT gateway, route tables, security groups, both EC2 instances, ALB, target groups, and listeners — is provisioned by `lambda/network-stack.yaml` in a single CloudFormation deployment.

### 3.1 Find the Ubuntu AMI ID

1. **[EC2 Console](https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#AMICatalog:)** → **AMIs** → **Public images**.
2. Search for `ubuntu/images/hvm-ssd` and filter by **Ubuntu Server 26.04 LTS**, **64-bit (x86)**.
3. Copy the **AMI ID** (format: `ami-xxxxxxxxxxxxxxxxx`).

### 3.2 Find your workstation public IP

Port 5001 (generator UI) on the ALB is restricted to your IP only.

1. Open [whatismyip.com](https://www.whatismyip.com) and copy your IPv4 address.
2. Append `/32` — e.g. `203.0.113.5/32`.

### 3.3 Deploy the network stack

1. Open the **[CloudFormation Console](https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1)** → **Create stack** → **With new resources (standard)**.
2. **Template source:** Upload a template file → **Choose file** → select `lambda/network-stack.yaml` → **Next**.
3. **Stack name:** `payalert-network-stack`
4. Fill in the parameters:

| Parameter | Value |
|---|---|
| `Environment` | `dev` |
| `WorkstationCidr` | Your IP + `/32` from step 3.2, e.g. `203.0.113.5/32` |
| `KeyPairName` | `payalert-key` (created in Step 4.1) |
| `UbuntuAmiId` | AMI ID from step 3.1 |
| `InstanceProfileName` | `LabInstanceProfile` |

5. **Next** → **Next** → **Submit**.

Wait for status **CREATE_COMPLETE** (~3–5 minutes). This creates 33 AWS resources.

### 3.4 Save the stack outputs

1. **CloudFormation** → **Stacks** → `payalert-network-stack` → **Outputs** tab.
2. Copy these values — you will need them in later steps:

| Output key | Used in |
|---|---|
| `GeneratorInstanceId` | Step 4.3 — connect to the generator EC2 |
| `AuditInstanceId` | Step 7.2 — connect to the audit portal EC2 |
| `AlbDnsName` | Steps 10.3–10.4 — access the applications |

---

## Step 4 — Set up the key pair and connect to the generator EC2

### 4.1 Create a key pair

1. **[EC2 Console](https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#KeyPairs:)** → **Key Pairs** → **Create key pair**.
2. **Name:** `payalert-key`, **Type:** RSA, **Format:** `.pem`.
3. Download and save the `.pem` file.

On macOS/Linux, set correct permissions:

```bash
chmod 400 ~/Downloads/payalert-key.pem
```

### 4.2 Get the generator instance ID

`payalert-ec2` was launched by the network stack in Step 3. Get its instance ID from the stack outputs:

1. **CloudFormation** → **Stacks** → `payalert-network-stack` → **Outputs** tab.
2. Copy the value for **`GeneratorInstanceId`** — this is the instance ID for `payalert-ec2`.

### 4.3 Connect via SSM Session Manager

Wait ~60 seconds for the instance to enter the **Running** state and pass both status checks.

**Browser (no plugin required):**

EC2 → **Instances** → select `payalert-ec2` → **Connect** → **Session Manager** tab → **Connect**

**AWS CLI:**

```bash
aws ssm start-session --target <INSTANCE_ID> --region us-east-1
```

Replace `<INSTANCE_ID>` with the `GeneratorInstanceId` from **CloudFormation** → `payalert-network-stack` → **Outputs** (format: `i-xxxxxxxxxxxxxxxxx`).

**After connecting, immediately run:**

```bash
bash
```

SSM drops you into a restricted shell by default. Running `bash` gives you a full shell where `cd`, `source`, and all other built-ins work correctly.

> SSM connects outbound via the NAT Gateway over HTTPS — no SSH port, no key pair, and no EIC Endpoint required. Ensure your AWS CLI credentials are up-to-date if you restarted your Learner Lab session.

---

## Step 5 — Set up the transaction generator

All commands in this section run **on the EC2 instance** unless noted otherwise.

### 5.1 Verify system packages

Python 3, pip, venv, and git were already installed by the `UserData` script in the network stack CloudFormation template. Verify:

```bash
python3 --version
git --version
```

If either command is missing, install them:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-pip python3-venv git
```

### 5.2 Clone the repository to the instance

Run these commands **on the EC2 instance** via SSM Session Manager (Step 4.3).

**Set up SSH for GitHub (first time only):**

```bash
ssh-keygen -t ed25519 -C "your@email.com"
cat ~/.ssh/id_ed25519.pub
```

Copy the output, then add it to GitHub: **Settings** → **SSH and GPG keys** → **New SSH key** → paste → **Add SSH key**.

**Accept GitHub's host key (required before first clone):**

```bash
ssh -T git@github.com
```

Type `yes` when prompted to accept the fingerprint. You will see `Hi <username>! You've successfully authenticated` — this is expected even if access is denied for the repo itself.

**Clone and set up the application directory:**

```bash
sudo mkdir -p /opt/payalert-repo /opt/payalert
sudo chown $(whoami):$(whoami) /opt/payalert-repo /opt/payalert
git clone git@github.com:<your-username>/PayAlert.git /opt/payalert-repo
sudo cp -r /opt/payalert-repo/transaction-generator /opt/payalert/transaction-generator
sudo chown -R $(whoami):$(whoami) /opt/payalert
```

> Do **not** use `sudo git clone` — root does not have the SSH key and will get `Permission denied (publickey)`.

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

Run the setup script from the cloned repository:

```bash
bash /opt/payalert-repo/scripts/setup-generator-service.sh
```

The script writes `/etc/systemd/system/payalert-portal.service` using the current user, then enables and starts the service.

---

## Step 7 — Set up the audit portal

The audit portal is a Next.js 16 app that reads from DynamoDB and gives fraud analysts a live dashboard. It runs on a **dedicated** EC2 instance (`payalert-audit-ec2`) so the heavier Node.js workload does not compete with the transaction generator on `payalert-ec2`.

All commands in this section run **on `payalert-audit-ec2`** unless noted otherwise.

### 7.1 Get the audit instance ID

`payalert-audit-ec2` was launched by the network stack in Step 3. Get its instance ID from the stack outputs:

1. **CloudFormation** → **Stacks** → `payalert-network-stack` → **Outputs** tab.
2. Copy the value for **`AuditInstanceId`** — this is the instance ID for `payalert-audit-ec2`.

Wait until the instance is **Running** and **Status checks** have passed before connecting (~60 seconds after stack completion).

### 7.2 Connect to `payalert-audit-ec2`

Use **SSM Session Manager** the same way as Step 4.3, but select **`payalert-audit-ec2`**:

**Browser:** EC2 → **Instances** → select `payalert-audit-ec2` → **Connect** → **Session Manager** → **Connect**

**CLI:** `aws ssm start-session --target <AUDIT_INSTANCE_ID> --region us-east-1`

Replace `<AUDIT_INSTANCE_ID>` with the `AuditInstanceId` from **CloudFormation** → `payalert-network-stack` → **Outputs**.

After connecting, run `bash` for a full shell (see Step 4.3).

### 7.3 Verify system packages

Git, curl, and Node.js 20 were already installed by the `UserData` script in the network stack CloudFormation template. Verify:

```bash
git --version
node --version   # should print v20.x.x
```

If either command is missing (e.g. on a manually launched instance), install them:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 7.4 Clone the repository on the audit instance

Set up **GitHub over SSH** on this instance if you have not already — same flow as **Step 5.2** (`ssh-keygen`, add `~/.ssh/id_ed25519.pub` to GitHub, then `ssh -T git@github.com` to accept the host key).

Then:

```bash
sudo mkdir -p /opt/payalert-repo /opt/payalert
sudo chown $(whoami):$(whoami) /opt/payalert-repo /opt/payalert
git clone git@github.com:<your-username>/PayAlert.git /opt/payalert-repo
```

You only need the repo on this machine to copy `audit-portal-v2`; you do not need the transaction generator here.

### 7.5 Copy the audit portal into `/opt/payalert`

```bash
sudo cp -r /opt/payalert-repo/audit-portal-v2 /opt/payalert/audit-portal-v2
sudo chown -R $(whoami):$(whoami) /opt/payalert/audit-portal-v2
```

### 7.6 Create the environment file

```bash
cat > /opt/payalert/audit-portal-v2/.env.local <<'EOF'
DYNAMODB_TABLE=payalert-transactions-dev
AWS_REGION=us-east-1
NEXT_PUBLIC_ENVIRONMENT=prod
DLQ_URL=https://sqs.us-east-1.amazonaws.com/ACCOUNT_ID/payalert-transactions-dlq-dev
MAIN_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/ACCOUNT_ID/payalert-transactions-queue-dev
AUTH_SECRET=replace-with-openssl-rand-base64-32-output
PORTAL_USERNAME=admin
PORTAL_PASSWORD=ChangeMe123!
EOF
```

> Replace `ACCOUNT_ID` with your 12-digit AWS account ID. `DLQ_URL` and `MAIN_QUEUE_URL` are in the CloudFormation stack Outputs tab (Step 1.6).

### 7.7 Install dependencies and build

```bash
cd /opt/payalert/audit-portal-v2
npm install
npm run build
```

The build takes 1–5 minutes. You should see a `✓ Compiled successfully` message at the end.

### 7.8 Quick test

```bash
cd /opt/payalert/audit-portal-v2
npm start
```

From a **second SSM session** on **`payalert-audit-ec2`**: `curl -s http://localhost:3000 | head -5` — you should see HTML. Press `Ctrl+C` to stop the first session.

### 7.9 Create the systemd service

Run the setup script from the cloned repository:

```bash
bash /opt/payalert-repo/scripts/setup-audit-portal-service.sh
```

The script writes `/etc/systemd/system/payalert-audit-portal.service` using the current user, then enables and starts the service.

---

## Step 8 — Verify the ALB and target groups

The ALB (`payalert-alb`), both target groups (`payalert-audit-tg` on port 3000 and `payalert-generator-tg` on port 5001), and both listeners (port 80 → audit portal, port 5001 → generator UI) were all created by the network stack in Step 3.

### 8.1 Get the ALB DNS name

1. **CloudFormation** → **Stacks** → `payalert-network-stack` → **Outputs** tab.
2. Copy **`AlbDnsName`** — this is the base URL for both applications (e.g. `payalert-alb-123456789.us-east-1.elb.amazonaws.com`).

### 8.2 Check target group health

After the EC2 services are running (Steps 5–7), verify that both instances are registered and healthy:

1. **[EC2 Console](https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#TargetGroups:)** → **Target Groups**.
2. Select `payalert-audit-tg` → **Targets** tab → wait for **Healthy** status.
3. Select `payalert-generator-tg` → **Targets** tab → wait for **Healthy** status.

Target registration and health checks can take 1–3 minutes after the applications start.

---

## Step 9 — Create the Launch Template and Auto Scaling Group

The ASG ensures the audit portal remains available and can scale. The Launch Template is created from an AMI snapshot of **`payalert-audit-ec2`** so scaled instances only run the audit portal (the transaction generator stays on `payalert-ec2`).

### 9.1 Create an AMI from the audit portal instance

1. **EC2** → **Instances** → select **`payalert-audit-ec2`** → **Actions** → **Image and templates** → **Create image**.

| Setting         | Value                 |
| --------------- | --------------------- |
| **Image name**  | `payalert-portal-ami` |
| **Description** | PayAlert audit portal |
| **No reboot**   | ☑ Enable              |

2. **Create image**. Wait for the AMI status to become **Available** (~2–5 minutes): **EC2** → **AMIs**.

`payalert-ec2` (generator + web UI) is **not** rebooted or modified by this step.

### 9.2 Deploy the ASG stack

With the AMI ID from step 9.1, deploy `lambda/asg-stack.yaml`:

1. Open the **[CloudFormation Console](https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1)** → **Create stack** → **With new resources (standard)**.
2. **Template source:** Upload a template file → **Choose file** → select `lambda/asg-stack.yaml` → **Next**.
3. **Stack name:** `payalert-asg-stack`
4. Fill in the parameters:

| Parameter | Value |
|---|---|
| `Environment` | `dev` |
| `AmiId` | AMI ID from step 9.1, e.g. `ami-xxxxxxxxxxxxxxxxx` |
| `KeyPairName` | `payalert-key` |
| `InstanceProfileName` | `LabInstanceProfile` |

5. **Next** → **Next** → **Submit**.

Wait for status **CREATE_COMPLETE** (~2 minutes).

This creates:
- **Launch Template** `payalert-portal-lt` — `t3.large`, your AMI, imports security group from the network stack
- **Auto Scaling Group** `payalert-portal-asg` — min 1, max 2, desired 1; attached to `payalert-audit-tg`; ELB health checks, 300 s grace period
- **Scaling policy** `payalert-cpu-target-tracking` — target 60% average CPU utilization, 120 s instance warmup

**Why 60% CPU:**
The Next.js portal does server-side rendering and DynamoDB reads on every request. Targeting 60% leaves a 40% buffer so a new instance (which takes ~2 minutes to boot and pass health checks) can become ready before the existing instance reaches 100%. Scale-out fires as soon as the 3-datapoint breach threshold is crossed (~3 minutes of sustained load); scale-in has a built-in 15-minute cooldown to prevent flapping.

With `min=1` and `max=2`, this policy adds a second instance under sustained load and removes it once traffic subsides.

### 9.3 Verify the target group health

1. **EC2** → **Target Groups** → `payalert-audit-tg` → **Targets** tab.
2. Wait until **all registered targets** show **Healthy** (~2–3 minutes).
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
# Connect to the generator EC2 via SSM Session Manager
# Browser: EC2 → Instances → payalert-ec2 → Connect → Session Manager → Connect
# CLI: aws ssm start-session --target <INSTANCE_ID> --region us-east-1

sudo systemctl stop payalert-portal

cd /opt/payalert/transaction-generator
source .venv/bin/activate
export $(cat /opt/payalert/generator.env | xargs)

# Sends ~30% fraud-scenario transactions continuously
python3 generator.py --fraud-mode --verbose
```

Press `Ctrl+C` when done, then restart the service:

```bash
deactivate
sudo systemctl start payalert-portal
```

---

## Cleanup / Teardown

### Stop the EC2 services

Connect via SSM and stop services on **each** instance:

**On `payalert-ec2` (generator):**

```bash
sudo systemctl stop payalert-portal
sudo systemctl disable payalert-portal
```

**On `payalert-audit-ec2` (audit portal):**

```bash
sudo systemctl stop payalert-audit-portal
sudo systemctl disable payalert-audit-portal
```

### Delete the ASG stack

1. **CloudFormation** → **Stacks** → select `payalert-asg-stack` → **Delete** → **Delete stack**.
2. Wait for **DELETE_COMPLETE** (~2 minutes). This removes the ASG, Launch Template, and scaling policy.
3. **EC2** → **AMIs** → select `payalert-portal-ami` → **Actions** → **Deregister AMI** → confirm.
   (The AMI is not managed by CloudFormation — deregister it manually.)

### Delete the Lambda stack

1. **[CloudFormation Console](https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1)** → **Stacks** → select `payalert-stack` → **Delete** → **Delete stack**.

> The DynamoDB table has `DeletionPolicy: Retain` and will **not** be deleted with the stack.

To also delete the retained table: **DynamoDB** → `payalert-transactions` → **Delete**.

To clean up S3: **S3** → `payalert-artifacts-{account-id}` → **Empty** → confirm, then **Delete**.

### Delete the network stack

Ensure the ASG stack is deleted first (above) so no ASG instances remain registered to the ALB target group.

1. **CloudFormation** → **Stacks** → select `payalert-network-stack` → **Delete** → **Delete stack**.
2. Wait for **DELETE_COMPLETE** (~5–10 minutes). This removes the ALB, EC2 instances, NAT Gateway, Elastic IP, security groups, subnets, route tables, Internet Gateway, and VPC in the correct order.

> If deletion gets stuck on the NAT Gateway, wait a minute and retry — NAT Gateways occasionally take longer to release the Elastic IP association.

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
| CloudFormation stack (Lambda)  | `payalert-stack`                             |
| CloudFormation stack (Network) | `payalert-network-stack`                     |
| CloudFormation stack (ASG)     | `payalert-asg-stack`                         |
| S3 artifacts bucket        | `payalert-artifacts-{account-id}`                |
| EC2 IAM role               | `LabRole` (or `PayAlertEC2Role`)                 |
| Generator EC2              | `payalert-ec2` (`t3.micro`, `payalert-private-1`) |
| Audit portal EC2           | `payalert-audit-ec2` (`t3.large`, `payalert-private-2`) |

### SSM Session Manager cheat sheet

Replace `<INSTANCE_ID>` with `i-xxxxxxxxxxxxxxxxx`.

```bash
# Connect to any private EC2 instance (requires Session Manager plugin)
aws ssm start-session --target <INSTANCE_ID> --region us-east-1

# Or use the browser — no plugin required:
# EC2 → Instances → select instance → Connect → Session Manager → Connect
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
| Update Lambda stack     | CloudFormation → `payalert-stack` → Update                                 |
| View Lambda stack outputs | CloudFormation → `payalert-stack` → Outputs tab                          |
| View network stack outputs | CloudFormation → `payalert-network-stack` → Outputs tab                 |
| Check ALB health        | EC2 → Target Groups → `payalert-audit-tg` → Targets tab                   |
| Check ASG activity      | EC2 → Auto Scaling Groups → `payalert-portal-asg` → Activity tab          |

### EC2 service management (on the instance)

```bash
# View live logs (payalert-portal = generator web UI on payalert-ec2)
sudo journalctl -u payalert-portal -f
sudo journalctl -u payalert-audit-portal -f

# Restart services
sudo systemctl restart payalert-portal            # on payalert-ec2
sudo systemctl restart payalert-audit-portal      # on payalert-audit-ec2

# Check status
sudo systemctl status payalert-portal
sudo systemctl status payalert-audit-portal
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

Connect via SSM on the instance you need (**`payalert-ec2`** for generator and web UI; **`payalert-audit-ec2`** for the audit portal), then:

```bash
# Generator / web UI
cd /opt/payalert-repo && git pull
sudo cp -r transaction-generator/* /opt/payalert/transaction-generator/
sudo systemctl restart payalert-portal

# Audit portal — pull, rebuild, restart
cd /opt/payalert-repo && git pull
sudo cp -r audit-portal-v2/* /opt/payalert/audit-portal-v2/
cd /opt/payalert/audit-portal-v2 && npm install && npm run build
sudo systemctl restart payalert-audit-portal

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
