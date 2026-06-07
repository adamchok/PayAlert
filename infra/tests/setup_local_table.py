"""
Create the payalert-transactions table in a local DynamoDB instance.
Run once per DynamoDB Local session (data is lost when the container stops).

Usage:
    python3 tests/setup_local_table.py
"""

import boto3
from botocore.exceptions import ClientError

client = boto3.client(
    "dynamodb",
    endpoint_url="http://localhost:8000",
    region_name="ap-southeast-1",
    aws_access_key_id="local",
    aws_secret_access_key="local",
)

try:
    client.create_table(
        TableName="payalert-transactions",
        AttributeDefinitions=[
            {"AttributeName": "transactionId", "AttributeType": "S"},
            {"AttributeName": "accountId",     "AttributeType": "S"},
            {"AttributeName": "timestamp",     "AttributeType": "S"},
            {"AttributeName": "riskLevel",     "AttributeType": "S"},
            {"AttributeName": "datePartition", "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "transactionId", "KeyType": "HASH"},
        ],
        BillingMode="PAY_PER_REQUEST",
        GlobalSecondaryIndexes=[
            {
                "IndexName": "AccountTransactionsIndex",
                "KeySchema": [
                    {"AttributeName": "accountId", "KeyType": "HASH"},
                    {"AttributeName": "timestamp", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            },
            {
                "IndexName": "RiskLevelIndex",
                "KeySchema": [
                    {"AttributeName": "riskLevel", "KeyType": "HASH"},
                    {"AttributeName": "timestamp", "KeyType": "RANGE"},
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
    print("Table created: payalert-transactions")
except ClientError as e:
    if e.response["Error"]["Code"] == "ResourceInUseException":
        print("Table already exists — skipping creation.")
    else:
        raise
