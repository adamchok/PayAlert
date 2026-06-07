"""
PayAlert DLQ Processor Lambda

Reads failed messages from TransactionDLQ and writes them to DynamoDB
with processingStatus="failed" so the audit portal can display and
redrive them without the SQS visibility-timeout race condition.

Never returns batch item failures — failures are logged and swallowed
so messages are always deleted from the DLQ (no infinite retry loop).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.exceptions import ClientError
from utils import clean_item as _clean_item

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_region = os.environ.get("AWS_REGION", "us-east-1")
dynamodb = boto3.resource("dynamodb", region_name=_region)
TABLE_NAME = os.environ["DYNAMODB_TABLE"]
TTL_SECONDS = int(os.environ.get("TTL_DAYS", "90")) * 86400


def lambda_handler(event: dict, context: Any) -> dict:
    table = dynamodb.Table(TABLE_NAME)
    for record in event.get("Records", []):
        try:
            _process_dlq_record(table, record)
        except Exception as exc:
            logger.error(
                "Unhandled error processing DLQ record %s: %s",
                record.get("messageId"),
                exc,
                exc_info=True,
            )
    return {"batchItemFailures": []}


def _process_dlq_record(table: Any, record: dict) -> None:
    message_id = record.get("messageId", "unknown")
    raw_body = record.get("body", "")
    attrs = record.get("attributes", {})
    receive_count = int(attrs.get("ApproximateReceiveCount", 1))

    body: dict = {}
    try:
        body = json.loads(raw_body)
    except (json.JSONDecodeError, TypeError):
        logger.warning("DLQ record %s has non-JSON body", message_id)

    transaction_id: str = body.get("transactionId") or f"dlq-{message_id}"
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    raw_ts: str = body.get("timestamp", now_iso)

    item: dict = {
        **_clean_item(body),
        "transactionId": transaction_id,
        "processingStatus": "failed",
        "failedAt": now_iso,
        "receiveCount": receive_count,
        "ttl": int(now.timestamp()) + TTL_SECONDS,
        "datePartition": raw_ts[:10],
    }
    if not body:
        item["rawBody"] = raw_body

    try:
        table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(transactionId)",
        )
        logger.info("DLQ record written: transactionId=%s receiveCount=%d", transaction_id, receive_count)
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            # Record already exists (main processor wrote it before failing post-write).
            # Add processingStatus fields without overwriting the existing data.
            table.update_item(
                Key={"transactionId": transaction_id},
                UpdateExpression="SET processingStatus = :s, failedAt = :t, receiveCount = :r",
                ExpressionAttributeValues={
                    ":s": "failed",
                    ":t": now_iso,
                    ":r": receive_count,
                },
            )
            logger.info("DLQ record updated (existed): transactionId=%s", transaction_id)
        else:
            raise


