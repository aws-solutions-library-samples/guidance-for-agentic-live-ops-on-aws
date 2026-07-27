# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Unit tests for KB re-indexing with retry logic and hydration state update (task 7.2)."""

import sys
from unittest.mock import MagicMock, patch, call
import datetime
import os

# Mock heavy AWS dependencies before importing the module under test
sys.modules.setdefault("boto3", MagicMock())
sys.modules.setdefault("aws_lambda_powertools", MagicMock())

# Set required env vars before import
os.environ.setdefault("DOCS_BUCKET", "test-docs-bucket")
os.environ.setdefault("SCHEMA_KB_ID", "kb-test-123")
os.environ.setdefault("HYDRATION_TABLE", "test-hydration-table")

import index as mod  # noqa: E402


# ---------------------------------------------------------------------------
# _start_ingestion_job
# ---------------------------------------------------------------------------


class TestStartIngestionJob:
    def setup_method(self):
        self.mock_bedrock = MagicMock()
        mod.bedrock_agent = self.mock_bedrock

    def test_success_on_first_attempt(self):
        self.mock_bedrock.list_data_sources.return_value = {
            "dataSourceSummaries": [{"dataSourceId": "ds-001"}]
        }
        self.mock_bedrock.start_ingestion_job.return_value = {
            "ingestionJob": {"ingestionJobId": "job-abc"}
        }

        result = mod._start_ingestion_job()

        assert result == "job-abc"
        self.mock_bedrock.start_ingestion_job.assert_called_once_with(
            knowledgeBaseId="kb-test-123",
            dataSourceId="ds-001",
        )

    def test_no_data_sources_returns_none(self):
        self.mock_bedrock.list_data_sources.return_value = {"dataSourceSummaries": []}

        result = mod._start_ingestion_job()

        assert result is None
        self.mock_bedrock.start_ingestion_job.assert_not_called()

    def test_list_data_sources_exception_returns_none(self):
        self.mock_bedrock.list_data_sources.side_effect = Exception("access denied")

        result = mod._start_ingestion_job()

        assert result is None

    @patch("index.time")
    def test_retries_on_failure_then_succeeds(self, mock_time):
        self.mock_bedrock.list_data_sources.return_value = {
            "dataSourceSummaries": [{"dataSourceId": "ds-001"}]
        }
        # Fail first attempt, succeed on second
        self.mock_bedrock.start_ingestion_job.side_effect = [
            Exception("throttled"),
            {"ingestionJob": {"ingestionJobId": "job-retry"}},
        ]

        result = mod._start_ingestion_job()

        assert result == "job-retry"
        assert self.mock_bedrock.start_ingestion_job.call_count == 2
        mock_time.sleep.assert_called_once_with(1)  # 1s delay after first failure

    @patch("index.time")
    def test_all_retries_fail_returns_none(self, mock_time):
        self.mock_bedrock.list_data_sources.return_value = {
            "dataSourceSummaries": [{"dataSourceId": "ds-001"}]
        }
        self.mock_bedrock.start_ingestion_job.side_effect = Exception(
            "persistent error"
        )

        result = mod._start_ingestion_job()

        assert result is None
        assert self.mock_bedrock.start_ingestion_job.call_count == 3
        # Exponential backoff: sleep(1) after attempt 1, sleep(2) after attempt 2
        # No sleep after attempt 3 (last attempt)
        mock_time.sleep.assert_has_calls([call(1), call(2)])
        assert mock_time.sleep.call_count == 2

    @patch("index.time")
    def test_succeeds_on_third_attempt(self, mock_time):
        self.mock_bedrock.list_data_sources.return_value = {
            "dataSourceSummaries": [{"dataSourceId": "ds-001"}]
        }
        self.mock_bedrock.start_ingestion_job.side_effect = [
            Exception("fail 1"),
            Exception("fail 2"),
            {"ingestionJob": {"ingestionJobId": "job-third"}},
        ]

        result = mod._start_ingestion_job()

        assert result == "job-third"
        assert self.mock_bedrock.start_ingestion_job.call_count == 3
        mock_time.sleep.assert_has_calls([call(1), call(2)])


# ---------------------------------------------------------------------------
# _update_hydration_state
# ---------------------------------------------------------------------------


class TestUpdateHydrationState:
    def setup_method(self):
        self.mock_dynamodb = MagicMock()
        self.mock_table = MagicMock()
        self.mock_dynamodb.Table.return_value = self.mock_table
        mod.dynamodb = self.mock_dynamodb

    def test_puts_correct_item(self):
        mod._update_hydration_state(doc_count=42, ingestion_job_id="job-xyz")

        self.mock_dynamodb.Table.assert_called_with("test-hydration-table")
        put_call = self.mock_table.put_item.call_args
        item = put_call[1]["Item"]

        assert item["pk"] == "hydration-state"
        assert item["last_doc_count"] == 42
        assert item["last_ingestion_job_id"] == "job-xyz"
        # Timestamp should be a valid ISO format UTC string
        ts = datetime.datetime.fromisoformat(item["last_hydration_timestamp"])
        assert ts.tzinfo is not None


# ---------------------------------------------------------------------------
# check_and_hydrate integration (ingestion path)
# ---------------------------------------------------------------------------


class TestCheckAndHydrateIngestion:
    """Test the ingestion + state update path in check_and_hydrate."""

    def setup_method(self):
        self.mock_s3 = MagicMock()
        self.mock_dynamodb = MagicMock()
        self.mock_bedrock = MagicMock()
        self.mock_table = MagicMock()
        self.mock_dynamodb.Table.return_value = self.mock_table
        mod.s3 = self.mock_s3
        mod.dynamodb = self.mock_dynamodb
        mod.bedrock_agent = self.mock_bedrock

    def _setup_with_updates(self):
        """Configure mocks so that updates are detected."""
        # Hydration state: old timestamp
        self.mock_table.get_item.return_value = {
            "Item": {
                "pk": "hydration-state",
                "last_hydration_timestamp": "2020-01-01T00:00:00+00:00",
                "last_doc_count": 0,
                "last_ingestion_job_id": "",
            }
        }
        # S3 docs: one doc newer than the timestamp
        paginator = MagicMock()
        paginator.paginate.return_value = [
            {
                "Contents": [
                    {
                        "Key": "store_a/orders.md",
                        "LastModified": datetime.datetime(
                            2025, 6, 1, tzinfo=datetime.timezone.utc
                        ),
                    }
                ]
            }
        ]
        self.mock_s3.get_paginator.return_value = paginator

    def test_success_path_returns_job_id(self):
        self._setup_with_updates()
        self.mock_bedrock.list_data_sources.return_value = {
            "dataSourceSummaries": [{"dataSourceId": "ds-001"}]
        }
        self.mock_bedrock.start_ingestion_job.return_value = {
            "ingestionJob": {"ingestionJobId": "job-success"}
        }

        result = mod.check_and_hydrate({})

        assert result["skipped"] is False
        assert result["ingestion_job_id"] == "job-success"
        assert result["updated_docs"] == 1
        assert result["total_docs"] == 1
        assert "error" not in result
        # Hydration state should have been updated
        self.mock_table.put_item.assert_called_once()

    @patch("index.time")
    def test_failure_path_returns_error(self, mock_time):
        self._setup_with_updates()
        self.mock_bedrock.list_data_sources.return_value = {
            "dataSourceSummaries": [{"dataSourceId": "ds-001"}]
        }
        self.mock_bedrock.start_ingestion_job.side_effect = Exception("boom")

        result = mod.check_and_hydrate({})

        assert result["skipped"] is False
        assert "error" in result
        assert "3 attempts" in result["error"]
        assert "ingestion_job_id" not in result
        # Hydration state should NOT have been updated
        self.mock_table.put_item.assert_not_called()
