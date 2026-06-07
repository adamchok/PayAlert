"""
Print a summary of all items currently stored in the local DynamoDB table.

Usage (from the lambda/ directory):
    python3 tests/verify_local.py
"""

import boto3

client = boto3.client(
    "dynamodb",
    endpoint_url="http://localhost:8000",
    region_name="ap-southeast-1",
    aws_access_key_id="local",
    aws_secret_access_key="local",
)

response = client.scan(
    TableName="payalert-transactions",
    ProjectionExpression="transactionId, riskLevel, riskScore, accountId",
)

for item in response.get("Items", []):
    row = {k: list(v.values())[0] for k, v in item.items()}
    print(row)

print(f"\nTotal items: {response['Count']}")
