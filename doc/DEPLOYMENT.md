# PayAlert — AWS Deployment Guide

Step-by-step instructions for deploying and running the full PayAlert architecture from scratch: Lambda pipeline, custom VPC, EC2 transaction generator, audit portal, ALB, and ASG.

> **Platform:** EC2 steps target **Ubuntu Server 26.04 LTS**. All deployment is performed through the **AWS Management Console** — no SAM CLI or Docker required.

---

## Architecture

```
                    ┌──────────────────────────────────────────────────────────────┐
                    │  Custom VPC (10.0.0.0/16)                                    │
                    │                                                              │
                    │  Public Subnets — 10.0.1.0/24  ·  10.0.2.0/24                │
  Internet          │  ┌─────────────────┐   ┌─────────────────────────────────┐   │
     │              │  │  NAT Gateway    │   │  Application Load Balancer      │   │
     └─► ALB ───────┼──┤  (Elastic IP)   │   │  :80  → Audit Portal            │   │
       :80 / :5001  │  └────────┬────────┘   │  :5001 → Generator UI           │   │
                    │           │            └──────────────────┬──────────────┘   │
  Developer         │           │                               │                  │
     │              │  Private Subnets — 10.0.3.0/24 · 10.0.4.0/24                 │
     └─► SSM ───────┼───────────────────────────────────────────│                  │
       (Browser)    │  ┌────────────────────────────┐  ┌────────┴─────────────────┐│
                    │  │  EC2 — payalert-producer-  │  │  EC2 — payalert-portal-  ││
                    │  │  ec2 · Generator + Web UI  │  │  ec2 · Audit portal ASG  ││
                    │  │  private-1 · :5001         │  │  private-2 · :3000       ││
                    │  └────────────────────────────┘  └──────────────────────────┘│
                    │                                                              │
                    │  VPC Endpoints: ssm · ssmmessages · ec2messages              │
                    └──────────────────────────────────────────────────────────────┘
                                        │ outbound via NAT Gateway
                                        ▼
                                  AWS Lambda ◄─── SQS
                                 ┌────┴────┐
                              DynamoDB   SNS (email)
```

**SSM** = AWS Systems Manager Session Manager. Provides browser shell access to private EC2 instances via the AWS Console — no SSH, no key pair, no bastion required. VPC Interface Endpoints for `ssm`, `ssmmessages`, and `ec2messages` are provisioned by the network stack, keeping SSM traffic inside the VPC and off the NAT Gateway.

**Components deployed:**

| Component | Where | What it does |
|---|---|---|
| Lambda + SQS + DynamoDB + SNS | AWS (via CloudFormation Console) | Processes and stores transactions, sends fraud alerts |
| Custom VPC | AWS | Isolates all EC2 resources from the default VPC |
| NAT Gateway | Public Subnet (payalert-public-1) | Outbound internet access for private subnet instances |
| SSM VPC Endpoints | Private Subnets | SSM traffic stays inside VPC — no NAT egress cost |
| Transaction Generator | EC2 `payalert-producer-ec2` (Private Subnet) | Streams synthetic transactions to SQS |
| Generator Web UI | EC2 `payalert-producer-ec2` (via ALB :5001) | Browser control panel — protected by login |
| Audit Portal | EC2 `payalert-portal-ec2` + ASG behind ALB (port 80) | Live fraud dashboard reading DynamoDB |

---

## Prerequisites

### On your workstation

| Requirement | Notes |
|---|---|
| Web browser | For the AWS Management Console and SSM Session Manager browser access |
| AWS CLI v2 | Required only if you prefer CLI access. [Install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) |

> **No SSH client, no key pair, no Session Manager plugin required.** EC2 access is entirely browser-based via the AWS Console (EC2 → Instances → Connect → Session Manager tab).

**AWS CLI credentials for Learner Labs:** In the Academy portal, click **AWS Details** → **Show** next to AWS CLI → copy the block and paste it into `~/.aws/credentials`. Repeat whenever the session restarts.

> No Docker or SAM CLI required.

### AWS account

You need an AWS account with permissions to create CloudFormation stacks, Lambda functions, SQS queues, DynamoDB tables, SNS topics, S3 buckets, VPCs, load balancers, and EC2 instances.

---

## CloudFormation stacks overview

The infrastructure is split across three CloudFormation templates in `infra/`:

| Template | Stack name | Deploys | When |
|---|---|---|---|
| `template.yaml` | `payalert-stack` | Lambda, SQS, DynamoDB, SNS, CloudWatch alarms | Step 1 |
| `network-stack.yaml` | `payalert-network-stack` | VPC, subnets, NAT, SSM endpoints, security groups, EC2 instances, ALB, target groups | Step 3 |
| `asg-stack.yaml` | `payalert-asg-stack` | Launch Templates, ASGs (portal + producer), scaling policy | Step 9 (after AMIs are built) |

All resources are tagged `Project: Capstone`, `Group: 4`, `Scenario: PayAlert`, and `Environment: dev`.

**Parameters required for `network-stack.yaml`:**

| Parameter | Value |
|---|---|
| `Environment` | `dev` |
| `WorkstationCidr` | Your public IP + `/32` — find it at [whatismyip.com](https://www.whatismyip.com) |
| `UbuntuAmiId` | Ubuntu Server 26.04 LTS AMI ID for us-east-1 — find in EC2 → AMIs → Public images |
| `InstanceProfileName` | `LabInstanceProfile` (Learner Labs default) |

**Parameters required for `asg-stack.yaml`:**

| Parameter | Value |
|---|---|
| `Environment` | `dev` |
| `AmiId` | AMI ID of `payalert-portal-ami` — built in Step 9.1 from `payalert-portal-ec2` |
| `ProducerAmiId` | AMI ID of `payalert-producer-ami` — built in Step 9.1 from `payalert-producer-ec2` |
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

Run from the `infra/transaction-processor/` directory on your workstation:

**Ubuntu / macOS / Git Bash:**

```bash
cd infra/transaction-processor/
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

Open `infra/template.yaml` and replace the `CodeUri` line under `TransactionProcessorFunction`:

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
3. **Template source:** Upload a template file → **Choose file** → select the modified `infra/template.yaml` → **Next**.
4. Fill in the stack details:
   - **Stack name:** `payalert-stack`
5. Fill in the parameters:

| Parameter | Value |
|---|---|
| `Environment` | `dev` |
| `AlertEmail` | your real email address |
| `AlertRiskThreshold` | `50` |
| `TransactionTTLDays` | `90` |
| `LambdaRoleArn` | `arn:aws:iam::<your-account-id>:role/LabRole` |
| `EnableForceFail` | `false` |

> **Resource tagging:** All resources in this stack are tagged `Project: Capstone`, `Group: 4`, and `Scenario: PayAlert`. These tags are applied automatically — no manual action needed.

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

| Key | Example value |
|---|---|
| `TransactionQueueUrl` | `https://sqs.us-east-1.amazonaws.com/123456789012/payalert-transactions-queue-dev` |
| `DLQUrl` | `https://sqs.us-east-1.amazonaws.com/123456789012/payalert-transactions-dlq-dev` |
| `TransactionsTableName` | `payalert-transactions-dev` |
| `AlertTopicArn` | `arn:aws:sns:us-east-1:123456789012:payalert-alerts-dev` |

### 1.7 Confirm the SNS email subscription

AWS sends a confirmation email to `AlertEmail` immediately after deployment. Open the email from `no-reply@sns.amazonaws.com` and click **Confirm subscription**.

---

## Step 2 — Create the EC2 IAM role

> **AWS Academy Learner Labs:** You cannot create IAM roles. Skip this step — the network stack's `InstanceProfileName` parameter defaults to `LabInstanceProfile`, which attaches `LabRole` automatically to all EC2 instances (Step 3). `LabRole` includes `AmazonSSMManagedInstanceCore`, which is required for SSM Session Manager access.

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
    },
    {
      "Sid": "SSMAccess",
      "Effect": "Allow",
      "Action": [
        "ssm:UpdateInstanceInformation",
        "ssmmessages:CreateControlChannel",
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:OpenDataChannel",
        "ec2messages:AcknowledgeMessage",
        "ec2messages:DeleteMessage",
        "ec2messages:FailMessage",
        "ec2messages:GetEndpoint",
        "ec2messages:GetMessages",
        "ec2messages:SendReply"
      ],
      "Resource": "*"
    }
  ]
}
```

3. **Policy name:** `PayAlertEC2Policy` → **Create policy**.

### 2.2 Create the IAM role

1. **[IAM Console](https://console.aws.amazon.com/iam/home#/roles)** → **Roles** → **Create role**.
2. **Trusted entity type:** AWS service → **EC2** → **Next**.
3. Search for and select `PayAlertEC2Policy` and `AmazonSSMManagedInstanceCore` → **Next**.
4. **Role name:** `PayAlertEC2Role` → **Create role**.
5. Create an **Instance Profile** with this role and use its name in the `InstanceProfileName` parameter.

---

## Step 3 — Deploy the network stack

All network infrastructure — VPC, subnets, NAT gateway, route tables, security groups, SSM VPC endpoints, both EC2 instances, ALB, target groups, and listeners — is provisioned by `infra/network-stack.yaml` in a single CloudFormation deployment.

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
2. **Template source:** Upload a template file → **Choose file** → select `infra/network-stack.yaml` → **Next**.
3. **Stack name:** `payalert-network-stack`
4. Fill in the parameters:

| Parameter | Value |
|---|---|
| `Environment` | `dev` |
| `WorkstationCidr` | Your IP + `/32` from step 3.2, e.g. `203.0.113.5/32` |
| `UbuntuAmiId` | AMI ID from step 3.1 |
| `InstanceProfileName` | `LabInstanceProfile` |

5. **Next** → **Next** → **Submit**.

Wait for status **CREATE_COMPLETE** (~3–5 minutes). This creates the VPC, subnets, NAT gateway, SSM VPC endpoints, security groups, both EC2 instances, ALB, and target groups.

### 3.4 Save the stack outputs

1. **CloudFormation** → **Stacks** → `payalert-network-stack` → **Outputs** tab.
2. Copy these values — you will need them in later steps:

| Output key | Used in |
|---|---|
| `ProducerInstanceId` | Step 4.2 — connect to the producer EC2 |
| `PortalInstanceId` | Step 7.1 — connect to the audit portal EC2 |
| `AlbDnsName` | Steps 10.3–10.4 — access the applications |

---

## Step 4 — Connect to the producer EC2

### 4.1 Get the producer instance ID

`payalert-producer-ec2` was launched by the network stack in Step 3.

1. **CloudFormation** → **Stacks** → `payalert-network-stack` → **Outputs** tab.
2. Copy the value for **`ProducerInstanceId`**.

### 4.2 Connect via SSM Session Manager (browser)

Wait ~2 minutes for the instance to enter **Running** state, pass status checks, and for the SSM agent to register.

**EC2** → **Instances** → select `payalert-producer-ec2` → **Connect** → **Session Manager** tab → **Connect**

> If the Session Manager tab is greyed out, wait another minute — the SSM agent is still starting. Refresh the page.

**After connecting, immediately run:**

```bash
bash
```

SSM drops you into a restricted shell by default. Running `bash` gives you a full shell where `cd`, `source`, and all other built-ins work correctly.

> SSM connects through the VPC Interface Endpoints provisioned by the network stack — traffic never leaves the VPC. No SSH port, no key pair, and no internet access is needed for console connectivity.

---

## Step 5 — Set up the transaction generator

All commands in this section run **on the EC2 instance** (via the SSM Session Manager browser session) unless noted otherwise.

### 5.1 Set up SSH for GitHub (first time only)

**1. Fork the repository**

If you have not already, fork PayAlert to your own GitHub account: open the repo → **Fork** → **Create fork**.

**2. Generate an SSH key on the EC2 instance**

```bash
ssh-keygen -t ed25519 -C "your@email.com"
cat ~/.ssh/id_ed25519.pub
```

Copy the output.

**3. Add the key as a Deploy Key on your fork**

In your forked repo on GitHub: **Settings** → **Security and quality** → **Deploy keys** → **Add deploy key**

| Field | Value |
|---|---|
| Title | `payalert-producer-ec2` |
| Key | paste the `id_ed25519.pub` output |
| Allow write access | ☐ leave unchecked (read-only is sufficient) |

Click **Add key**.

**4. Accept GitHub's host key**

```bash
ssh -T git@github.com
```

Type `yes` when prompted. You will see `Hi <username>! You've successfully authenticated`.

> Do **not** use `sudo git clone` — root does not have the SSH key and will get `Permission denied (publickey)`.

### 5.2 Run the setup script

Replace the values below with your own, then run:

```bash
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/ACCOUNT_ID/payalert-transactions-queue-dev \
UI_USERNAME=payalert \
UI_PASSWORD=YourStrongPassword \
GITHUB_USERNAME=your-github-username \
bash <(curl -fsSL https://raw.githubusercontent.com/<your-username>/PayAlert/master/scripts/setup-generator-ec2.sh)
```

Or, if you have already cloned the repo manually:

```bash
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/ACCOUNT_ID/payalert-transactions-queue-dev \
UI_USERNAME=payalert \
UI_PASSWORD=YourStrongPassword \
GITHUB_USERNAME=your-github-username \
bash /opt/payalert-repo/scripts/setup-generator-ec2.sh
```

The script:
1. Verifies/installs python3, venv, git
2. Clones the repo to `/opt/payalert-repo`
3. Deploys `transaction-generator` to `/opt/payalert/transaction-generator`
4. Creates the Python virtualenv and installs dependencies
5. Writes `/opt/payalert/generator.env`
6. Installs and starts the `payalert-portal` systemd service

`SQS_QUEUE_URL` is `TransactionQueueUrl` from the Step 1.6 CloudFormation outputs. Add `FORCE_ENV=1` to overwrite an existing `generator.env`. `AWS_REGION` defaults to `us-east-1` — set it if deploying to a different region.

### 5.3 Verify the service and run a quick test

```bash
sudo systemctl status payalert-portal

# Send 5 test transactions
cd /opt/payalert/transaction-generator
source .venv/bin/activate
export $(cat /opt/payalert/generator.env | xargs)
python3 generator.py --mode batch --count 5 --verbose
deactivate
```

You should see 5 transactions sent successfully. If you get `AccessDenied`, verify the IAM role is attached: **EC2** → **Instances** → select instance → **Security** tab → **IAM Role**.

---

## Step 6 — Verify the generator web UI

The web UI is already running as part of the `payalert-portal` service started in Step 5.2.

```bash
sudo journalctl -u payalert-portal -f
```

You should see `* Running on http://0.0.0.0:5001`. The UI will be accessible through the ALB after Step 8.

---

## Step 7 — Set up the audit portal

The audit portal is a Next.js 16 app that reads from DynamoDB and gives fraud analysts a live dashboard. It runs on a **dedicated** EC2 instance (`payalert-portal-ec2`) so the heavier Node.js workload does not compete with the transaction generator on `payalert-producer-ec2`.

All commands in this section run **on `payalert-portal-ec2`** (via SSM Session Manager) unless noted otherwise.

### 7.1 Connect to `payalert-portal-ec2`

1. **CloudFormation** → **Stacks** → `payalert-network-stack` → **Outputs** tab.
2. Copy the value for **`PortalInstanceId`**.
3. Wait until the instance is **Running** and **Status checks** have passed before connecting (~2 minutes after stack completion).

**EC2** → **Instances** → select `payalert-portal-ec2` → **Connect** → **Session Manager** tab → **Connect**

After connecting, run `bash` for a full shell.

### 7.2 Set up SSH for GitHub (first time only)

Same flow as Step 5.1, but use a different key title so GitHub can distinguish the two instances.

```bash
ssh-keygen -t ed25519 -C "your@email.com"
cat ~/.ssh/id_ed25519.pub
```

Add the output as a Deploy Key on your fork: **Settings** → **Security and quality** → **Deploy keys** → **Add deploy key** (title: `payalert-portal-ec2`, write access unchecked).

```bash
ssh -T git@github.com   # type yes to accept fingerprint
```

### 7.3 Run the setup script

Replace the values below with your own, then run:

```bash
ACCOUNT_ID=123456789012 \
PORTAL_USERNAME=admin \
PORTAL_PASSWORD=YourStrongPassword \
DYNAMODB_TABLE=payalert-transactions-dev \
GITHUB_USERNAME=your-github-username \
bash <(curl -fsSL https://raw.githubusercontent.com/<your-username>/PayAlert/master/scripts/setup-audit-portal-ec2.sh)
```

Or, if you have already cloned the repo manually:

```bash
ACCOUNT_ID=123456789012 \
PORTAL_USERNAME=admin \
PORTAL_PASSWORD=YourStrongPassword \
DYNAMODB_TABLE=payalert-transactions-dev \
GITHUB_USERNAME=your-github-username \
bash /opt/payalert-repo/scripts/setup-audit-portal-ec2.sh
```

The script:
1. Verifies/installs Node.js 20, git
2. Clones the repo to `/opt/payalert-repo`
3. Deploys `audit-portal-v2` to `/opt/payalert/audit-portal-v2`
4. Writes `.env.local` (auto-generates `AUTH_SECRET` if not supplied)
5. Runs `npm ci && npm run build` (1–5 minutes)
6. Installs and starts the `payalert-audit-portal` systemd service

`ACCOUNT_ID` is your 12-digit AWS account ID. Add `FORCE_ENV=1` to overwrite an existing `.env.local`. `AWS_REGION` defaults to `us-east-1`.

> **ASG note:** If you plan to use multiple instances behind the ASG, generate `AUTH_SECRET` once with `openssl rand -base64 32` and pass the same value to all instances so sessions stay valid across targets.

### 7.4 Verify the service

```bash
sudo systemctl status payalert-audit-portal
sudo journalctl -u payalert-audit-portal -f

# Quick smoke test (from a second SSM session)
curl -s http://localhost:3000 | head -5
```

You should see HTML. The portal will be accessible through the ALB after Step 8.

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

## Step 9 — Create the Launch Templates and Auto Scaling Groups

The ASG stack provisions **two** ASGs: one for the audit portal and one for the transaction producer. Both are deployed from AMI snapshots of their respective configured instances — ensuring ASG instances start ready-to-run without any manual setup.

> **Important:** Do **not** manually create Launch Templates or Auto Scaling groups through the EC2 Console. The CloudFormation stack in Step 9.2 creates them automatically.

### 9.1 Create AMIs from both instances

**Portal AMI** (from `payalert-portal-ec2`):

1. **EC2** → **Instances** → select **`payalert-portal-ec2`** → **Actions** → **Image and templates** → **Create image**.

| Setting | Value |
|---|---|
| **Image name** | `payalert-portal-ami` |
| **Description** | PayAlert audit portal |
| **No reboot** | ☑ Enable |

2. **Create image**. Wait for the AMI status to become **Available** (~2–5 minutes): **EC2** → **AMIs**.

**Producer AMI** (from `payalert-producer-ec2`):

1. **EC2** → **Instances** → select **`payalert-producer-ec2`** → **Actions** → **Image and templates** → **Create image**.

| Setting | Value |
|---|---|
| **Image name** | `payalert-producer-ami` |
| **Description** | PayAlert transaction producer |
| **No reboot** | ☑ Enable |

2. Wait for **Available** status.

### 9.2 Deploy the ASG stack

With both AMI IDs from step 9.1, deploy `infra/asg-stack.yaml`:

1. Open the **[CloudFormation Console](https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1)** → **Create stack** → **With new resources (standard)**.
2. **Template source:** Upload a template file → **Choose file** → select `infra/asg-stack.yaml` → **Next**.
3. **Stack name:** `payalert-asg-stack`
4. Fill in the parameters:

| Parameter | Value |
|---|---|
| `Environment` | `dev` |
| `AmiId` | Portal AMI ID from step 9.1, e.g. `ami-xxxxxxxxxxxxxxxxx` |
| `ProducerAmiId` | Producer AMI ID from step 9.1, e.g. `ami-xxxxxxxxxxxxxxxxx` |
| `InstanceProfileName` | `LabInstanceProfile` |

5. **Next** → **Next** → **Submit**.

Wait for status **CREATE_COMPLETE** (~2 minutes).

This creates:
- **Launch Template** `payalert-portal-lt` — `t3.large`, portal AMI, SSM agent start on boot
- **Auto Scaling Group** `payalert-portal-asg` — min 1, max 2, desired 1; attached to `payalert-audit-tg`
- **Launch Template** `payalert-producer-lt` — `t3.micro`, producer AMI, SSM agent start on boot
- **Auto Scaling Group** `payalert-producer-asg` — min 1, max 1, desired 1; attached to `payalert-generator-tg`
- **Scaling policy** `payalert-portal-request-count-tracking` — ALB request count per target, 100 req/min threshold for portal ASG
- **CloudWatch alarm** `payalert-portal-cpu-high` — observational only (CPU > 80%), does not drive scaling

**Why request count, not CPU?** The audit portal is I/O-bound: Next.js pages wait on DynamoDB queries, so CPU stays low even under real user load. ALB request count per target is the direct signal — each analyst generates ~12 requests/minute from the Live Audit 5-second polling loop plus additional page navigation. At 100 req/min per target, the portal can serve ~5 analysts comfortably on a single instance before scale-out triggers.

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

- The browser prompts for a username and password — enter the `UI_USERNAME` and `UI_PASSWORD` from Step 5.2.
- Click **Start** to begin streaming transactions; live logs appear in the browser.

### 10.4 Check the audit portal via ALB

Open `http://<ALB_DNS_NAME>` in a browser.

- The **Dashboard** shows today's transaction count and the HIGH / CRITICAL breakdown.
- Click **Live Audit** in the navbar to see the last 20 transactions refreshing every 5 seconds.
- Click **Transactions** to see the full filtered list.
- Click **Dead Letter Queue** to see failed messages with Redrive / Delete actions.

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

---

## Step 11 — Run in fraud mode

To generate a higher volume of flagged transactions for audit portal demonstrations:

```bash
# Connect to payalert-producer-ec2 via SSM Session Manager
# EC2 → Instances → payalert-producer-ec2 → Connect → Session Manager → Connect

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

Connect via SSM Session Manager and stop services on **each** instance:

**On `payalert-producer-ec2` (generator):**

```bash
sudo systemctl stop payalert-portal
sudo systemctl disable payalert-portal
```

**On `payalert-portal-ec2` (audit portal):**

```bash
sudo systemctl stop payalert-audit-portal
sudo systemctl disable payalert-audit-portal
```

### Delete the ASG stack

1. **CloudFormation** → **Stacks** → select `payalert-asg-stack` → **Delete** → **Delete stack**.
2. Wait for **DELETE_COMPLETE** (~2 minutes). This removes both ASGs, both Launch Templates, and the scaling policy.
3. **EC2** → **AMIs** → deregister `payalert-portal-ami` and `payalert-producer-ami` manually.

### Delete the Lambda stack

1. **[CloudFormation Console](https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1)** → **Stacks** → select `payalert-stack` → **Delete** → **Delete stack**.

> The DynamoDB table has `DeletionPolicy: Retain` and will **not** be deleted with the stack.

To also delete the retained table: **DynamoDB** → `payalert-transactions` → **Delete**.

To clean up S3: **S3** → `payalert-artifacts-{account-id}` → **Empty** → confirm, then **Delete**.

### Delete the network stack

Ensure the ASG stack is deleted first (above) so no ASG instances remain registered to the ALB target groups.

1. **CloudFormation** → **Stacks** → select `payalert-network-stack` → **Delete** → **Delete stack**.
2. Wait for **DELETE_COMPLETE** (~5–10 minutes).

---

## Quick Reference

### Resource names

| Resource | Name / Value |
|---|---|
| VPC | `payalert-vpc` (10.0.0.0/16) |
| Public subnets | `payalert-public-1`, `payalert-public-2` |
| Private subnets | `payalert-private-1`, `payalert-private-2` |
| Internet Gateway | `payalert-igw` |
| Elastic IP | `payalert-eip` |
| NAT Gateway | `payalert-nat-gw` |
| Public route table | `payalert-public-rt` |
| Private route table | `payalert-private-rt` |
| ALB security group | `PayAlertALBSG` |
| EC2 security group | `PayAlertEC2SG` |
| SSM endpoint security group | `PayAlertSSMEndpointSG` |
| VPC endpoints | `ssm`, `ssmmessages`, `ec2messages` (Interface type) |
| Load balancer | `payalert-alb` |
| Audit portal target group | `payalert-audit-tg` (port 3000) |
| Generator target group | `payalert-generator-tg` (port 5001) |
| Portal Launch Template | `payalert-portal-lt` |
| Producer Launch Template | `payalert-producer-lt` |
| Portal Auto Scaling Group | `payalert-portal-asg` (min 1, max 2) |
| Producer Auto Scaling Group | `payalert-producer-asg` (min 1, max 1) |
| SQS queue | `payalert-transactions-queue-dev` |
| SQS DLQ | `payalert-transactions-dlq-dev` |
| DynamoDB table | `payalert-transactions` |
| SNS topic | `payalert-alerts-dev` |
| Lambda function | `payalert-transaction-processor-dev` |
| CloudWatch log group | `/aws/lambda/payalert-transaction-processor-dev` |
| CloudFormation stack (Lambda) | `payalert-stack` |
| CloudFormation stack (Network) | `payalert-network-stack` |
| CloudFormation stack (ASG) | `payalert-asg-stack` |
| S3 artifacts bucket | `payalert-artifacts-{account-id}` |
| EC2 IAM role | `LabRole` (or `PayAlertEC2Role`) |
| Producer EC2 (setup instance) | `payalert-producer-ec2` (`t3.micro`, `payalert-private-1`) |
| Portal EC2 (setup instance) | `payalert-portal-ec2` (`t3.large`, `payalert-private-2`) |

### Resource tags (applied to all taggable resources)

| Key | Value |
|---|---|
| `Project` | `Capstone` |
| `Group` | `4` |
| `Scenario` | `PayAlert` |
| `Environment` | `dev` |

### SSM Session Manager — browser access

No plugin or CLI required. All access is through the AWS Console:

1. **EC2** → **Instances** → select the instance → **Connect**
2. Click the **Session Manager** tab → **Connect**
3. Run `bash` immediately after the shell opens

| Instance | Purpose | Connect path |
|---|---|---|
| `payalert-producer-ec2` | Generator + web UI | EC2 → `payalert-producer-ec2` → Connect → Session Manager |
| `payalert-portal-ec2` | Audit portal setup | EC2 → `payalert-portal-ec2` → Connect → Session Manager |

> If the Session Manager tab is greyed out, the SSM agent is still starting. Wait 1–2 minutes and refresh.

### Console navigation cheat sheet

| Task | Console path |
|---|---|
| View Lambda logs | CloudWatch → Log groups → `/aws/lambda/payalert-transaction-processor-dev` |
| Check CloudWatch alarms | CloudWatch → Alarms → search `payalert` |
| Browse DynamoDB items | DynamoDB → Tables → `payalert-transactions` → Explore table items |
| Check SQS queue depth | SQS → `payalert-transactions-queue-dev` → Details pane |
| Check DLQ depth | SQS → `payalert-transactions-dlq-dev` → Details pane |
| Send a test message | SQS → `payalert-transactions-queue-dev` → Send and receive messages |
| Invoke Lambda directly | Lambda → `payalert-transaction-processor-dev` → Test tab |
| Update Lambda stack | CloudFormation → `payalert-stack` → Update |
| View network stack outputs | CloudFormation → `payalert-network-stack` → Outputs tab |
| Check ALB health | EC2 → Target Groups → `payalert-audit-tg` → Targets tab |
| Check portal ASG activity | EC2 → Auto Scaling Groups → `payalert-portal-asg` → Activity tab |
| Check producer ASG activity | EC2 → Auto Scaling Groups → `payalert-producer-asg` → Activity tab |

### EC2 service management (on the instance via SSM)

```bash
# View live logs
sudo journalctl -u payalert-portal -f          # on payalert-producer-ec2
sudo journalctl -u payalert-audit-portal -f    # on payalert-portal-ec2

# Restart services
sudo systemctl restart payalert-portal          # on payalert-producer-ec2
sudo systemctl restart payalert-audit-portal    # on payalert-portal-ec2

# Check status
sudo systemctl status payalert-portal
sudo systemctl status payalert-audit-portal
```

### Updating after a code change

**Lambda code change:**

1. Re-zip: `cd infra/transaction-processor/ && zip function.zip handler.py`
2. Re-upload to S3: S3 Console → `payalert-artifacts-{account-id}` → Upload → `function.zip`.
3. Update Lambda: **Lambda** → `payalert-transaction-processor-dev` → **Code** tab → **Upload from** → **Amazon S3 location** → enter `s3://payalert-artifacts-{account-id}/function.zip` → **Save**.

**Template / infrastructure change:**

1. **CloudFormation** → `payalert-stack` → **Update** → **Replace current template** → upload the modified `template.yaml`.
2. Re-enter `LambdaRoleArn` (`arn:aws:iam::<account-id>:role/LabRole`) — CloudFormation does not remember it between updates in Learner Labs.

**EC2 application change:**

Re-run the setup scripts via SSM Session Manager — they pull the latest commit, redeploy, rebuild, and restart the service:

```bash
# On payalert-producer-ec2 (generator + web UI)
SQS_QUEUE_URL=<from Step 1.6> UI_USERNAME=payalert UI_PASSWORD=<your password> GITHUB_USERNAME=<username> \
bash /opt/payalert-repo/scripts/setup-generator-ec2.sh

# On payalert-portal-ec2 (audit portal)
ACCOUNT_ID=<your 12-digit ID> PORTAL_USERNAME=admin PORTAL_PASSWORD=<your password> DYNAMODB_TABLE=payalert-transactions-dev GITHUB_USERNAME=<username> \
bash /opt/payalert-repo/scripts/setup-audit-portal-ec2.sh
```

After rebuilding the audit portal, create a new AMI from `payalert-portal-ec2` (Step 9.1) and update the `payalert-asg-stack` with the new `AmiId` so ASG instances get the latest build.
