"""
PayAlert Transaction Processor Lambda

SQS → DynamoDB writer with idempotent puts and SNS alert dispatch for
transactions that cross the isFlagged threshold (riskScore >= 50).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_region = os.environ.get("AWS_REGION", "ap-southeast-1")

dynamodb = boto3.resource("dynamodb", region_name=_region)
sns = boto3.client("sns", region_name=_region)

TABLE_NAME = os.environ["DYNAMODB_TABLE"]
ALERT_TOPIC_ARN = os.environ.get("ALERT_TOPIC_ARN", "")
ALERT_RISK_THRESHOLD = int(os.environ.get("ALERT_RISK_THRESHOLD", "50"))
# TTL: 90 days from processing time
TTL_SECONDS = int(os.environ.get("TTL_DAYS", "90")) * 86400


# ── Entry point ───────────────────────────────────────────────────────────────

def lambda_handler(event: dict, context: Any) -> dict:
    table = dynamodb.Table(TABLE_NAME)
    batch_item_failures: list[dict] = []

    for record in event.get("Records", []):
        message_id = record["messageId"]
        try:
            body = json.loads(record["body"])
            process_transaction(table, body)
        except Exception as exc:
            logger.error("Failed to process message %s: %s", message_id, exc, exc_info=True)
            batch_item_failures.append({"itemIdentifier": message_id})

    if batch_item_failures:
        logger.warning(
            "Returning %d batch item failure(s) out of %d",
            len(batch_item_failures),
            len(event.get("Records", [])),
        )

    return {"batchItemFailures": batch_item_failures}


# ── Core processing ───────────────────────────────────────────────────────────

def process_transaction(table: Any, transaction: dict) -> None:
    transaction_id = transaction.get("transactionId")
    if not transaction_id:
        raise ValueError("Missing required field: transactionId")

    if os.environ.get("ENABLE_FORCE_FAIL") == "true" and transaction.get("_forceFail"):
        raise ValueError("Forced failure for DLQ demo (transactionId=%s)" % transaction_id)

    now_utc = datetime.now(timezone.utc)
    raw_ts: str = transaction.get("timestamp", now_utc.isoformat())
    enriched: dict = {
        **transaction,
        "processedAt": now_utc.isoformat(),
        "ttl": int(now_utc.timestamp()) + TTL_SECONDS,
        # datePartition enables efficient GSI range scans by calendar day.
        # The generator emits ISO-8601 timestamps starting with "YYYY-MM-DD".
        "datePartition": raw_ts[:10],
    }

    item = _clean_item(enriched)

    try:
        table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(transactionId)",
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            logger.info("Duplicate transaction %s — skipped", transaction_id)
            return
        raise

    risk_score: int = enriched.get("riskScore", 0)
    risk_level: str = enriched.get("riskLevel", "UNKNOWN")
    logger.info(
        "Stored transaction=%s account=%s riskScore=%d riskLevel=%s isFlagged=%s",
        transaction_id,
        enriched.get("accountId"),
        risk_score,
        risk_level,
        enriched.get("isFlagged"),
    )

    if ALERT_TOPIC_ARN and risk_score >= ALERT_RISK_THRESHOLD:
        _publish_alert(enriched)


# ── SNS alert ─────────────────────────────────────────────────────────────────

def _publish_alert(transaction: dict) -> None:
    transaction_id = transaction.get("transactionId", "UNKNOWN")
    risk_level = transaction.get("riskLevel", "UNKNOWN")
    risk_score = transaction.get("riskScore", 0)
    account_id = transaction.get("accountId", "UNKNOWN")
    customer_name = transaction.get("customerName", "Unknown Customer")
    amount_myr = transaction.get("amountMYR", transaction.get("amount", 0))
    merchant_name = transaction.get("merchantName", "Unknown Merchant")
    merchant_country = transaction.get("merchantCountry", "?")
    raw_flags: list = transaction.get("riskFlags", [])
    timestamp = transaction.get("timestamp", "")
    channel = transaction.get("channel", "")
    tx_type = transaction.get("transactionType", "")

    if isinstance(amount_myr, Decimal):
        amount_myr = float(amount_myr)

    try:
        dt = datetime.fromisoformat(timestamp)
        formatted_ts = dt.strftime("%d %b %Y, %I:%M %p %Z").strip()
    except (ValueError, TypeError):
        formatted_ts = timestamp

    formatted_flags = [f.replace("_", " ").title() for f in raw_flags] if raw_flags else ["None"]

    subject = f"[PayAlert] {risk_level} Risk | {customer_name} | Score {risk_score}/100"

    message = (
        f"PayAlert Fraud Detection Alert\n\n"
        f"RISK ASSESSMENT\n"
        f"  Level  : {risk_level}\n"
        f"  Score  : {risk_score}/100\n"
        f"  Flags  : {', '.join(formatted_flags)}\n\n"
        f"CUSTOMER\n"
        f"  Name   : {customer_name}\n"
        f"  Account: {account_id}\n\n"
        f"TRANSACTION\n"
        f"  ID     : {transaction_id}\n"
        f"  Type   : {tx_type.replace('_', ' ').title()} ({channel})\n"
        f"  Amount : MYR {amount_myr:,.2f}\n"
        f"  Time   : {formatted_ts}\n\n"
        f"MERCHANT\n"
        f"  Name   : {merchant_name}\n"
        f"  Country: {merchant_country}\n\n"
        f"Log in to the PayAlert Audit Portal to investigate.\n"
    )

    try:
        sns.publish(
            TopicArn=ALERT_TOPIC_ARN,
            Subject=subject[:100],
            Message=message,
            MessageAttributes={
                "riskLevel": {"DataType": "String", "StringValue": risk_level},
                "accountId": {"DataType": "String", "StringValue": account_id},
            },
        )
        logger.info(
            "Alert dispatched for transaction=%s riskScore=%d",
            transaction_id,
            risk_score,
        )
    except ClientError as exc:
        # Alert failure must not roll back the DynamoDB write
        logger.error("SNS publish failed for transaction=%s: %s", transaction_id, exc)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _clean_item(obj: Any) -> Any:
    """Recursively strip None values and convert floats to Decimal for DynamoDB."""
    if isinstance(obj, dict):
        return {k: _clean_item(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_clean_item(v) for v in obj]
    if isinstance(obj, float):
        return Decimal(str(obj))
    return obj
