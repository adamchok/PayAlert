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
from utils import clean_item as _clean_item

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_region = os.environ.get("AWS_REGION", "us-east-1")

dynamodb = boto3.resource("dynamodb", region_name=_region)
sns = boto3.client("sns", region_name=_region)

TABLE_NAME = os.environ["DYNAMODB_TABLE"]
ALERT_TOPIC_ARN = os.environ.get("ALERT_TOPIC_ARN", "")
ALERT_RISK_THRESHOLD = int(os.environ.get("ALERT_RISK_THRESHOLD", "50"))
CUSTOMER_RECEIPT_TOPIC_ARN = os.environ.get("CUSTOMER_RECEIPT_TOPIC_ARN", "")
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
            # Allow overwriting records that carry processingStatus (i.e. previously
            # failed transactions being redriven). Normal duplicates are still blocked.
            ConditionExpression="attribute_not_exists(transactionId) OR attribute_exists(processingStatus)",
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

    if CUSTOMER_RECEIPT_TOPIC_ARN:
        _publish_receipt(enriched)

    if ALERT_TOPIC_ARN and risk_score >= ALERT_RISK_THRESHOLD:
        _publish_alert(enriched)


# ── SNS receipt ───────────────────────────────────────────────────────────────

_CHANNEL_LABELS: dict[str, str] = {
    "POS":         "Point of Sale",
    "CONTACTLESS": "Contactless Tap",
    "ONLINE":      "Online",
    "MOBILE_APP":  "Mobile App",
    "ATM":         "ATM",
}

_TX_TYPE_LABELS: dict[str, str] = {
    "PURCHASE":   "Purchase",
    "PAYMENT":    "Bill Payment",
    "TRANSFER":   "Fund Transfer",
    "WITHDRAWAL": "Cash Withdrawal",
    "REFUND":     "Refund",
    "TOPUP":      "Wallet Top-Up",
}


def _publish_receipt(transaction: dict) -> None:
    transaction_id = transaction.get("transactionId", "UNKNOWN")
    customer_name = transaction.get("customerName", "Valued Customer")
    customer_email = transaction.get("customerEmail", "")
    account_id = transaction.get("accountId", "UNKNOWN")
    card_last4 = transaction.get("cardLast4", "****")
    card_type = transaction.get("cardType", "CARD")
    amount = transaction.get("amount", 0)
    currency = transaction.get("currency", "MYR")
    amount_myr = transaction.get("amountMYR", amount)
    merchant_name = transaction.get("merchantName", "Unknown Merchant")
    merchant_city = transaction.get("merchantCity", "")
    merchant_country = transaction.get("merchantCountry", "")
    tx_type = transaction.get("transactionType", "PURCHASE")
    channel = transaction.get("channel", "")
    ref_id = transaction.get("referenceId", transaction_id)
    timestamp = transaction.get("timestamp", "")
    recipient_name = transaction.get("recipientName", "")
    recipient_account = transaction.get("recipientAccountId", "")

    if isinstance(amount_myr, Decimal):
        amount_myr = float(amount_myr)
    if isinstance(amount, Decimal):
        amount = float(amount)

    try:
        dt = datetime.fromisoformat(timestamp)
        formatted_ts = dt.strftime("%d %b %Y  %I:%M %p %Z").strip()
    except (ValueError, TypeError):
        formatted_ts = timestamp

    tx_label = _TX_TYPE_LABELS.get(tx_type, tx_type.replace("_", " ").title())
    channel_label = _CHANNEL_LABELS.get(channel, channel)
    card_network = card_type.split("_")[0].title()  # VISA_DEBIT → Visa
    card_kind = "Credit" if "CREDIT" in card_type else "Debit"
    card_display = f"{card_network} {card_kind}  ••••{card_last4}"

    if currency != "MYR":
        amount_line = f"{currency} {amount:,.2f}   (MYR {amount_myr:,.2f})"
    else:
        amount_line = f"MYR {amount_myr:,.2f}"

    merchant_location = f"{merchant_city}, {merchant_country}" if merchant_city else merchant_country

    divider = "─" * 42

    if tx_type == "TRANSFER" and recipient_name:
        payee_block = (
            f"  TO\n"
            f"  {recipient_name}\n"
            f"  {recipient_account}\n"
        )
    else:
        payee_block = (
            f"  AT\n"
            f"  {merchant_name}\n"
            f"  {merchant_location}\n"
        )

    subject = f"Receipt: {amount_line} – {merchant_name if tx_type != 'TRANSFER' else recipient_name}"

    message = (
        f"PAYALERT DIGITAL BANK\n"
        f"Transaction Receipt\n"
        f"{divider}\n\n"
        f"Dear {customer_name},\n\n"
        f"Your {tx_label.lower()} was successful.\n\n"
        f"  AMOUNT      {amount_line}\n"
        f"  STATUS      APPROVED\n"
        f"  DATE        {formatted_ts}\n"
        f"  TYPE        {tx_label}  ({channel_label})\n\n"
        f"{divider}\n"
        f"{payee_block}"
        f"\n"
        f"  PAID WITH   {card_display}\n"
        f"  ACCOUNT     {account_id}\n"
        f"{divider}\n\n"
        f"  Reference   {ref_id}\n"
        f"  Txn ID      {transaction_id}\n"
        f"  Sent to     {customer_email}\n\n"
        f"{divider}\n"
        f"Did not make this transaction?\n"
        f"Call us immediately: 1-800-88-ALERT\n"
        f"Email: support@payalert.my\n\n"
        f"PayAlert Digital Bank  |  payalert.my\n"
        f"Your Security. Our Priority.\n"
    )

    try:
        sns.publish(
            TopicArn=CUSTOMER_RECEIPT_TOPIC_ARN,
            Subject=subject[:100],
            Message=message,
            MessageAttributes={
                "transactionType": {"DataType": "String", "StringValue": tx_type},
                "accountId": {"DataType": "String", "StringValue": account_id},
            },
        )
        logger.info("Receipt dispatched for transaction=%s", transaction_id)
    except ClientError as exc:
        logger.error("SNS receipt publish failed for transaction=%s: %s", transaction_id, exc)


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

