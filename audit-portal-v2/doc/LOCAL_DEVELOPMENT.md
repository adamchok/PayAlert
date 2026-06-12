# Running Locally with Real DynamoDB

This guide gets the Next.js audit portal running on your local machine against the real `payalert-transactions` DynamoDB table in AWS.

---

## Prerequisites

- Node.js 20.9+ installed (`node -v` to check)
- An AWS account with the `payalert-transactions` DynamoDB table already populated
- AWS credentials that have read access to that table (see [IAM permissions](#iam-permissions) below)

---

## 1. Configure AWS Credentials

The AWS SDK v3 reads credentials from the standard credential chain. The easiest local approach is to use a named profile.

### Option A — AWS credentials file (recommended)

If you have the AWS CLI installed, run:

```bash
aws configure
```

Or create the files manually:

**`~/.aws/credentials`**
```ini
[default]
aws_access_key_id     = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

**`~/.aws/config`**
```ini
[default]
region = us-east-1
```

The SDK will pick these up automatically — no changes to `.env.local` needed.

### Option B — Environment variables in `.env.local`

Add credentials directly to `.env.local` (never commit this file):

```bash
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_SESSION_TOKEN=AQoXnyc4lcK4w...   # only if using temporary/assumed-role credentials
```

> **Note:** `AWS_REGION` is already set in `.env.local` to `us-east-1`. Only add `AWS_SESSION_TOKEN` if your credentials are temporary (STS/assume-role).

---

## 2. Verify `.env.local`

Your `.env.local` at the project root should look like this:

```bash
DYNAMODB_TABLE=payalert-transactions
AWS_REGION=us-east-1
NEXT_PUBLIC_ENVIRONMENT=dev
```

Change `NEXT_PUBLIC_ENVIRONMENT` to control the badge color in the header:
- `dev` → green
- `staging` → amber
- `prod` → red

---

## 3. Install dependencies

```bash
cd audit-portal-v2
npm install
```

---

## 4. Start the dev server

```bash
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

Next.js 16 uses **Turbopack** by default in development — first compilation is fast, subsequent hot-reloads are near-instant.

---

## 5. Verify the connection

1. Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard)
2. The dashboard loads data for today (MYT = UTC+8). If today has no data, append `?date=YYYY-MM-DD` with a date that has transactions.
3. If you see an error or empty state, check the terminal for DynamoDB errors — the most common causes are:
   - Wrong region in `.env.local`
   - Credentials not found or expired
   - Table name mismatch (check `DYNAMODB_TABLE` matches the actual table)

---

## IAM Permissions

The credentials you use locally need the following DynamoDB permissions on the `payalert-transactions` table and its GSIs:

```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:GetItem",
    "dynamodb:Query"
  ],
  "Resource": [
    "arn:aws:dynamodb:us-east-1:*:table/payalert-transactions",
    "arn:aws:dynamodb:us-east-1:*:table/payalert-transactions/index/*"
  ]
}
```

The app only ever reads — it never writes to DynamoDB. You can scope the IAM policy tightly to `GetItem` and `Query`.

---

## Tips

- **Hot reload:** All server-side data (DynamoDB queries) re-runs on each page navigation in dev mode. No server restart needed when you change query logic.
- **TypeScript errors:** Run `npx next typegen` after `npm run dev` starts to generate `RouteContext` type helpers. The build will pass without it, but the API route types will be looser.
- **Empty charts:** The 7-day volume bar chart calls DynamoDB 7 times in parallel. If your table has sparse data, bars will simply show 0 — not an error.
- **Map not loading:** The geo map uses OpenStreetMap tiles over the internet. Ensure your machine has outbound internet access on port 443. Tile loading failures are silent (the map just shows a grey background).
