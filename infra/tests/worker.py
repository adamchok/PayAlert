"""
Reads the transaction generator's --dry-run output from stdin (concatenated
pretty-printed JSON objects), wraps each transaction in a minimal SQS event,
and invokes the Lambda handler directly.

All configuration comes from environment variables injected by Docker:
    DYNAMODB_TABLE            payalert-transactions-dev
    AWS_ENDPOINT_URL_DYNAMODB http://payalert-dynamodb-local:8000
    ALERT_TOPIC_ARN           (empty — SNS disabled locally)
    ALERT_RISK_THRESHOLD      50
    TTL_DAYS                  90
    AWS_ACCESS_KEY_ID         local
    AWS_SECRET_ACCESS_KEY     local
    AWS_DEFAULT_REGION        us-east-1
"""

import json
import logging
import sys
import uuid

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("lambda-worker")

# handler.py evaluates DYNAMODB_TABLE at module level — env vars must already
# be set (via Docker -e flags) before this import.
sys.path.insert(0, "/app/transaction-processor")
import handler  # noqa: E402

_decoder = json.JSONDecoder()
processed = 0
failures = 0


def _invoke(tx: dict) -> None:
    global processed, failures
    event = {
        "Records": [{
            "messageId":         str(uuid.uuid4()),
            "receiptHandle":     "worker-local-receipt",
            "body":              json.dumps(tx),
            "attributes":        {},
            "messageAttributes": {},
            "md5OfBody":         "",
            "eventSource":       "aws:sqs",
            "eventSourceARN":    "arn:aws:sqs:us-east-1:000000000000:local",
            "awsRegion":         "us-east-1",
        }]
    }
    try:
        result = handler.lambda_handler(event, None)
        if result.get("batchItemFailures"):
            log.warning("Failure  tx=%s", tx.get("transactionId", "?")[:8])
            failures += 1
        else:
            processed += 1
            log.info(
                "Stored   tx=%s  account=%s  risk=%-8s  score=%s",
                tx.get("transactionId", "?")[:8],
                tx.get("accountId",     "?"),
                tx.get("riskLevel",     "?"),
                tx.get("riskScore",     "?"),
            )
    except Exception as exc:
        log.error("Handler error tx=%s: %s", tx.get("transactionId", "?")[:8], exc)
        failures += 1


def _drain(buf: str) -> str:
    """Parse and invoke as many complete JSON objects as possible from buf.
    Returns the unconsumed remainder."""
    while True:
        stripped = buf.lstrip()
        if not stripped:
            return ""
        try:
            tx, end = _decoder.raw_decode(stripped)
            buf = stripped[end:]
            _invoke(tx)
        except json.JSONDecodeError:
            return buf  # incomplete object — need more input


# Stream mode: process transactions as they arrive line by line.
# The generator outputs pretty-printed JSON (indent=2) so each transaction
# spans multiple lines; we accumulate lines and try to parse after each one.
buf = ""
for line in sys.stdin:
    buf += line
    buf = _drain(buf)

# Drain anything left after stdin closes
_drain(buf)

log.info("Pipeline complete — processed=%d  failures=%d", processed, failures)
sys.exit(1 if failures > 0 else 0)
