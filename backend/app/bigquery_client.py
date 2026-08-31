"""
Thin wrapper around google-cloud-bigquery for streaming inserts and analytic
queries against the `signage` dataset (see infra/bigquery/*.sql for DDL).
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from google.cloud import bigquery

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger("signage.bigquery")

MAX_BATCH = 500


class BigQueryClient:
    def __init__(self, client: Optional[bigquery.Client] = None):
        self._client = client or bigquery.Client(project=settings.gcp_project)
        self._dataset = settings.bq_dataset

    def _table_ref(self, table: str) -> str:
        return f"{settings.gcp_project}.{self._dataset}.{table}"

    def _insert_batched(self, table: str, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        table_ref = self._table_ref(table)
        for i in range(0, len(rows), MAX_BATCH):
            chunk = rows[i : i + MAX_BATCH]
            errors = self._client.insert_rows_json(table_ref, chunk)
            if errors:
                logger.error("BigQuery insert errors for %s: %s", table_ref, errors)

    def insert_heartbeats(self, rows: list[dict[str, Any]]) -> None:
        self._insert_batched("heartbeats", rows)

    def insert_play_events(self, rows: list[dict[str, Any]]) -> None:
        self._insert_batched("play_events", rows)

    def insert_device_snapshots(self, rows: list[dict[str, Any]]) -> None:
        self._insert_batched("device_snapshots", rows)

    def query(self, sql: str, params: Optional[list[bigquery.ScalarQueryParameter]] = None):
        job_config = bigquery.QueryJobConfig(query_parameters=params or [])
        job = self._client.query(sql, job_config=job_config, location=settings.bq_location)
        return [dict(row) for row in job.result()]


_bq_singleton: Optional[BigQueryClient] = None


def get_bigquery_client() -> BigQueryClient:
    global _bq_singleton
    if _bq_singleton is None:
        _bq_singleton = BigQueryClient()
    return _bq_singleton
