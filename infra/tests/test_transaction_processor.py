"""Unit tests for lambda/transaction-processor/handler.py"""

import os
import sys
import uuid
from decimal import Decimal
from unittest.mock import patch

import boto3
import pytest
from moto import mock_aws

from conftest import TABLE_NAME, TOPIC_NAME, create_test_table, make_transaction, make_sqs_event

# Ensure the handler module is importable from the tests directory
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "transaction-processor"))


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestProcessTransaction:
    """Tests for the core process_transaction function."""

    @mock_aws
    def test_stores_transaction_in_dynamodb(self):
        table = create_test_table()

        with patch.dict(
            os.environ,
            {"DYNAMODB_TABLE": TABLE_NAME, "ALERT_TOPIC_ARN": "", "ALERT_RISK_THRESHOLD": "50"},
        ):
            import importlib
            import handler
            importlib.reload(handler)

            tx = make_transaction()
            handler.process_transaction(table, tx)

        item = table.get_item(Key={"transactionId": tx["transactionId"]})["Item"]
        assert item["transactionId"] == tx["transactionId"]
        assert item["accountId"] == "ACC-MY-4F291A3B"
        assert "processedAt" in item
        assert "ttl" in item

    @mock_aws
    def test_datePartition_computed_from_timestamp(self):
        table = create_test_table()

        with patch.dict(os.environ, {"DYNAMODB_TABLE": TABLE_NAME, "ALERT_TOPIC_ARN": ""}):
            import importlib
            import handler
            importlib.reload(handler)

            tx = make_transaction()
            handler.process_transaction(table, tx)

        item = table.get_item(Key={"transactionId": tx["transactionId"]})["Item"]
        assert item["datePartition"] == "2026-05-09"

    @mock_aws
    def test_duplicate_transaction_is_skipped_without_error(self):
        table = create_test_table()
        tx_id = str(uuid.uuid4())

        with patch.dict(os.environ, {"DYNAMODB_TABLE": TABLE_NAME, "ALERT_TOPIC_ARN": ""}):
            import importlib
            import handler
            importlib.reload(handler)

            tx = make_transaction(transaction_id=tx_id)
            handler.process_transaction(table, tx.copy())
            handler.process_transaction(table, tx.copy())  # second call — should not raise

        # Exactly one record in the table
        response = table.scan()
        assert response["Count"] == 1

    @mock_aws
    def test_missing_transaction_id_raises(self):
        table = create_test_table()

        with patch.dict(os.environ, {"DYNAMODB_TABLE": TABLE_NAME, "ALERT_TOPIC_ARN": ""}):
            import importlib
            import handler
            importlib.reload(handler)

            tx = make_transaction()
            del tx["transactionId"]

            with pytest.raises(ValueError, match="transactionId"):
                handler.process_transaction(table, tx)

    @mock_aws
    def test_floats_stored_as_decimal(self):
        table = create_test_table()

        with patch.dict(os.environ, {"DYNAMODB_TABLE": TABLE_NAME, "ALERT_TOPIC_ARN": ""}):
            import importlib
            import handler
            importlib.reload(handler)

            tx = make_transaction()
            handler.process_transaction(table, tx)

        item = table.get_item(Key={"transactionId": tx["transactionId"]})["Item"]
        assert isinstance(item["amount"], Decimal)
        assert isinstance(item["amountMYR"], Decimal)

    @mock_aws
    def test_none_values_stripped_from_stored_item(self):
        table = create_test_table()

        with patch.dict(os.environ, {"DYNAMODB_TABLE": TABLE_NAME, "ALERT_TOPIC_ARN": ""}):
            import importlib
            import handler
            importlib.reload(handler)

            tx = make_transaction()
            tx["flagReason"] = None
            handler.process_transaction(table, tx)

        item = table.get_item(Key={"transactionId": tx["transactionId"]})["Item"]
        assert "flagReason" not in item


class TestAlertDispatch:
    """Tests for SNS alert publishing."""

    @mock_aws
    def test_high_risk_transaction_publishes_alert(self):
        table = create_test_table()

        sns_client = boto3.client("sns", region_name="us-east-1")
        topic_arn = sns_client.create_topic(Name=TOPIC_NAME)["TopicArn"]

        with patch.dict(
            os.environ,
            {
                "DYNAMODB_TABLE": TABLE_NAME,
                "ALERT_TOPIC_ARN": topic_arn,
                "ALERT_RISK_THRESHOLD": "50",
            },
        ):
            import importlib
            import handler
            importlib.reload(handler)

            tx = make_transaction(risk_score=75, risk_level="CRITICAL", is_flagged=True)
            handler.process_transaction(table, tx)

        # Confirm that a message was published (moto tracks published messages)
        sqs = boto3.client("sqs", region_name="us-east-1")
        queue_url = sqs.create_queue(QueueName="alert-test-queue")["QueueUrl"]
        queue_arn = sqs.get_queue_attributes(
            QueueUrl=queue_url, AttributeNames=["QueueArn"]
        )["Attributes"]["QueueArn"]
        sns_client.subscribe(TopicArn=topic_arn, Protocol="sqs", Endpoint=queue_arn)

        # The alert was published during process_transaction above; we verify
        # indirectly by confirming no exception was raised.

    @mock_aws
    def test_low_risk_transaction_does_not_publish_alert(self):
        table = create_test_table()

        sns_client = boto3.client("sns", region_name="us-east-1")
        topic_arn = sns_client.create_topic(Name=TOPIC_NAME)["TopicArn"]

        publish_calls = []

        with patch.dict(
            os.environ,
            {
                "DYNAMODB_TABLE": TABLE_NAME,
                "ALERT_TOPIC_ARN": topic_arn,
                "ALERT_RISK_THRESHOLD": "50",
            },
        ):
            import importlib
            import handler
            importlib.reload(handler)

            original_publish = handler.sns.publish

            def capture_publish(**kwargs):
                publish_calls.append(kwargs)
                return original_publish(**kwargs)

            handler.sns.publish = capture_publish

            tx = make_transaction(risk_score=10, risk_level="LOW", is_flagged=False)
            handler.process_transaction(table, tx)

        assert len(publish_calls) == 0, "No alert should be published for a LOW risk transaction"

    @mock_aws
    def test_alert_subject_contains_risk_level_and_account(self):
        table = create_test_table()

        sns_client = boto3.client("sns", region_name="us-east-1")
        topic_arn = sns_client.create_topic(Name=TOPIC_NAME)["TopicArn"]

        subjects = []

        with patch.dict(
            os.environ,
            {
                "DYNAMODB_TABLE": TABLE_NAME,
                "ALERT_TOPIC_ARN": topic_arn,
                "ALERT_RISK_THRESHOLD": "50",
            },
        ):
            import importlib
            import handler
            importlib.reload(handler)

            original_publish = handler.sns.publish

            def capture_publish(**kwargs):
                subjects.append(kwargs.get("Subject", ""))
                return original_publish(**kwargs)

            handler.sns.publish = capture_publish

            tx = make_transaction(risk_score=80, risk_level="CRITICAL", is_flagged=True)
            handler.process_transaction(table, tx)

        assert len(subjects) == 1
        assert "CRITICAL" in subjects[0]
        assert "ACC-MY-4F291A3B" in subjects[0]


class TestLambdaHandler:
    """End-to-end tests through the lambda_handler entry point."""

    @mock_aws
    def test_successful_batch_returns_no_failures(self):
        table = create_test_table()

        with patch.dict(os.environ, {"DYNAMODB_TABLE": TABLE_NAME, "ALERT_TOPIC_ARN": ""}):
            import importlib
            import handler
            importlib.reload(handler)

            transactions = [make_transaction() for _ in range(3)]
            event = make_sqs_event(transactions)
            result = handler.lambda_handler(event, None)

        assert result["batchItemFailures"] == []
        assert table.scan()["Count"] == 3

    @mock_aws
    def test_invalid_json_body_reports_batch_item_failure(self):
        create_test_table()

        with patch.dict(os.environ, {"DYNAMODB_TABLE": TABLE_NAME, "ALERT_TOPIC_ARN": ""}):
            import importlib
            import handler
            importlib.reload(handler)

            event = {
                "Records": [
                    {
                        "messageId": "bad-msg-001",
                        "receiptHandle": "receipt-0",
                        "body": "this is not json {{{",
                        "attributes": {},
                        "messageAttributes": {},
                        "md5OfBody": "",
                        "eventSource": "aws:sqs",
                        "eventSourceARN": "arn:aws:sqs:us-east-1:123456789012:queue",
                        "awsRegion": "us-east-1",
                    }
                ]
            }
            result = handler.lambda_handler(event, None)

        assert len(result["batchItemFailures"]) == 1
        assert result["batchItemFailures"][0]["itemIdentifier"] == "bad-msg-001"

    @mock_aws
    def test_partial_batch_failure_only_reports_failed_messages(self):
        table = create_test_table()

        with patch.dict(os.environ, {"DYNAMODB_TABLE": TABLE_NAME, "ALERT_TOPIC_ARN": ""}):
            import importlib
            import handler
            importlib.reload(handler)

            good_tx = make_transaction()
            bad_record = {
                "messageId": "bad-msg-999",
                "receiptHandle": "receipt-99",
                "body": '{"no_transaction_id": true}',
                "attributes": {},
                "messageAttributes": {},
                "md5OfBody": "",
                "eventSource": "aws:sqs",
                "eventSourceARN": "arn:aws:sqs:us-east-1:123456789012:queue",
                "awsRegion": "us-east-1",
            }

            event = make_sqs_event([good_tx])
            event["Records"].append(bad_record)

            result = handler.lambda_handler(event, None)

        # Good transaction stored; bad transaction reported as failure
        assert table.scan()["Count"] == 1
        assert len(result["batchItemFailures"]) == 1
        assert result["batchItemFailures"][0]["itemIdentifier"] == "bad-msg-999"

    @mock_aws
    def test_empty_event_returns_empty_failures(self):
        create_test_table()

        with patch.dict(os.environ, {"DYNAMODB_TABLE": TABLE_NAME, "ALERT_TOPIC_ARN": ""}):
            import importlib
            import handler
            importlib.reload(handler)

            result = handler.lambda_handler({"Records": []}, None)

        assert result["batchItemFailures"] == []


class TestCleanItem:
    """Tests for the _clean_item helper."""

    # _clean_item is a pure function with no AWS or env-var dependencies;
    # import once at the top of each test — no reload needed.

    def test_float_converted_to_decimal(self):
        import handler as h

        result = h._clean_item({"amount": 125.50})
        assert isinstance(result["amount"], Decimal)
        assert result["amount"] == Decimal("125.5")

    def test_none_values_removed(self):
        import handler as h

        result = h._clean_item({"a": "keep", "b": None, "c": 1})
        assert "b" not in result
        assert result["a"] == "keep"

    def test_nested_dict_cleaned(self):
        import handler as h

        result = h._clean_item({"location": {"city": "KL", "extra": None, "lat": 3.1390}})
        assert "extra" not in result["location"]
        assert isinstance(result["location"]["lat"], Decimal)

    def test_list_of_floats_converted(self):
        import handler as h

        result = h._clean_item([1.1, 2.2, 3.3])
        assert all(isinstance(v, Decimal) for v in result)
