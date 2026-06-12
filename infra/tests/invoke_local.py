"""
Invoke the Lambda handler directly against DynamoDB Local — no Docker or SAM CLI required.
Environment variables are set before the handler module is imported so that boto3
picks up the local endpoint at client-creation time.

Usage (from the lambda/ directory):
    python3 tests/invoke_local.py                          # uses tests/sample_event.json
    python3 tests/invoke_local.py tests/local-batch-event.json
"""

import json
import os
import sys

# Must be set before importing handler so that the module-level boto3 clients
# are created with the local endpoint.
os.environ.setdefault("DYNAMODB_TABLE",            "payalert-transactions")
os.environ.setdefault("ALERT_TOPIC_ARN",           "")
os.environ.setdefault("ALERT_RISK_THRESHOLD",      "50")
os.environ.setdefault("TTL_DAYS",                  "90")
os.environ.setdefault("AWS_ENDPOINT_URL_DYNAMODB", "http://localhost:8000")
os.environ.setdefault("AWS_ACCESS_KEY_ID",         "local")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY",     "local")
os.environ.setdefault("AWS_DEFAULT_REGION",        "us-east-1")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "transaction-processor"))
import handler  # noqa: E402 — env vars must be set before this import

event_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(__file__), "sample_event.json"
)

with open(event_path) as f:
    event = json.load(f)

result = handler.lambda_handler(event, None)
print(json.dumps(result, indent=2))
