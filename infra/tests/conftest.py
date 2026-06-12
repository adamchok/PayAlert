"""Shared fixtures and helpers for PayAlert Lambda unit tests."""

import os
import uuid

import boto3
import pytest
from moto import mock_aws

# Configure fake AWS credentials before any imports touch boto3
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_SECURITY_TOKEN", "testing")
os.environ.setdefault("AWS_SESSION_TOKEN", "testing")

TABLE_NAME = "payalert-transactions-test"
TOPIC_NAME = "payalert-alerts-test"


def create_test_table(region: str = "us-east-1"):
    """Create the DynamoDB test table (call inside an active mock_aws context)."""
    client = boto3.client("dynamodb", region_name=region)
    client.create_table(
        TableName=TABLE_NAME,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": "transactionId", "AttributeType": "S"},
            {"AttributeName": "accountId",     "AttributeType": "S"},
            {"AttributeName": "timestamp",     "AttributeType": "S"},
            {"AttributeName": "riskLevel",     "AttributeType": "S"},
            {"AttributeName": "datePartition", "AttributeType": "S"},
        ],
        KeySchema=[{"AttributeName": "transactionId", "KeyType": "HASH"}],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "AccountTransactionsIndex",
                "KeySchema": [
                    {"AttributeName": "accountId",  "KeyType": "HASH"},
                    {"AttributeName": "timestamp",  "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            },
            {
                "IndexName": "RiskLevelIndex",
                "KeySchema": [
                    {"AttributeName": "riskLevel",  "KeyType": "HASH"},
                    {"AttributeName": "timestamp",  "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            },
            {
                "IndexName": "DatePartitionIndex",
                "KeySchema": [
                    {"AttributeName": "datePartition", "KeyType": "HASH"},
                    {"AttributeName": "timestamp",     "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            },
        ],
    )
    return boto3.resource("dynamodb", region_name=region).Table(TABLE_NAME)


@pytest.fixture
def aws_credentials():
    """Ensure moto uses fake credentials."""
    os.environ["AWS_ACCESS_KEY_ID"] = "testing"
    os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
    os.environ["AWS_SECURITY_TOKEN"] = "testing"
    os.environ["AWS_SESSION_TOKEN"] = "testing"
    os.environ["AWS_DEFAULT_REGION"] = "us-east-1"


@pytest.fixture
def dynamodb_table(aws_credentials):
    with mock_aws():
        yield create_test_table()


def make_transaction(
    *,
    transaction_id: str | None = None,
    account_id: str = "ACC-MY-4F291A3B",
    risk_score: int = 5,
    risk_level: str = "LOW",
    is_flagged: bool = False,
    amount: float = 125.50,
    currency: str = "MYR",
    amount_myr: float = 125.50,
    timestamp: str = "2026-05-09T14:30:22+0800",
) -> dict:
    return {
        "transactionId": transaction_id or str(uuid.uuid4()),
        "accountId": account_id,
        "amount": amount,
        "currency": currency,
        "timestamp": timestamp,
        "merchantId": "MER-LSS-0001",
        "transactionType": "PURCHASE",
        "referenceId": "PAY-20260509-8F3A2B1C",
        "description": "Contactless payment at Lotus's Supermarket",
        "channel": "CONTACTLESS",
        "merchantName": "Lotus's Supermarket",
        "merchantCategory": "GROCERY",
        "merchantCity": "Kuala Lumpur",
        "merchantState": "Wilayah Persekutuan",
        "merchantCountry": "MY",
        "customerId": "CUST-4F291A3B",
        "customerName": "Ahmad Farid bin Ismail",
        "customerTier": "GOLD",
        "cardLast4": "4821",
        "cardType": "VISA_DEBIT",
        "location": {"city": "Kuala Lumpur", "state": "Wilayah Persekutuan", "country": "MY"},
        "exchangeRate": 1.0,
        "amountMYR": amount_myr,
        "riskScore": risk_score,
        "riskLevel": risk_level,
        "riskFlags": [],
        "isFlagged": is_flagged,
        "flagReason": None,
        "generatorVersion": "2.0.0",
    }


def make_sqs_event(transactions: list[dict]) -> dict:
    import json

    return {
        "Records": [
            {
                "messageId": f"msg-{i:04d}",
                "receiptHandle": f"receipt-{i}",
                "body": json.dumps(tx),
                "attributes": {},
                "messageAttributes": {},
                "md5OfBody": "",
                "eventSource": "aws:sqs",
                "eventSourceARN": "arn:aws:sqs:us-east-1:123456789012:payalert-test",
                "awsRegion": "us-east-1",
            }
            for i, tx in enumerate(transactions)
        ]
    }
