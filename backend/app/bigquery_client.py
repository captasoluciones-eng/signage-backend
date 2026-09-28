"""
Thin wrapper around google-cloud-bigquery for streaming inserts and analytic
queries against the `signage` dataset (see infra/bigquery/*.sql for DDL).
"""
from __future__ import annotations

import datetime
import logging
from decimal import Decimal
from typing import Any, Optional

from google.cloud import bigquery

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger("signage.bigquery")

MAX_BATCH = 500


def _json_safe(value: Any) -> Any:
    """Coerce BigQuery's native Python types into JSON/Pydantic-friendly ones.

    BigQuery returns DATE -> datetime.date, TIMESTAMP -> datetime, NUMERIC ->
    Decimal. The report response models declare these columns as str/float, so
    without this coercion FastAPI raises ResponseValidationError while
    serializing the response -- and because that happens after the CORS
    middleware, the resulting 500 carries no CORS header and the browser only
    sees "Failed to fetch". Dates/timestamps become ISO strings; Decimals become
    floats.
    """
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


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
        return [{k: _json_safe(v) for k, v in dict(row).items()} for row in job.result()]


_bq_singleton: Optional[BigQueryClient] = None


def get_bigquery_client() -> BigQueryClient:
    global _bq_singleton
    if _bq_singleton is None:
        _bq_singleton = BigQueryClient()
    return _bq_singleton
