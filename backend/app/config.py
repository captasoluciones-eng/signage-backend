"""
Central configuration, loaded from environment variables (12-factor style).
On Cloud Run these are set via `--set-env-vars` / `--set-secrets` in infra/deploy.sh
or the Terraform `google_cloud_run_v2_service` env blocks.
"""
from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # GCP project / region
    gcp_project: str = "signage-prod"
    gcp_region: str = "us-central1"

    # Firestore
    firestore_database: str = "(default)"

    # BigQuery
    bq_dataset: str = "signage"
    bq_location: str = "US"

    # Cloud Storage
    gcs_assets_bucket: str = "signage-prod-assets"
    gcs_signed_url_expiration_seconds: int = 900

    # Firebase Auth (admin panel)
    firebase_project_id: str = "signage-prod"
    admin_email_allowlist: str = "jesusbeltran@captasoluciones.com"

    # Cloud Scheduler -> Cloud Run job endpoints, authenticated via OIDC ID tokens.
    scheduler_service_account_email: str = (
        "signage-scheduler@signage-prod.iam.gserviceaccount.com"
    )
    # Fallback shared-secret auth for local/dev testing of job endpoints
    # (set to empty string in production; OIDC verification is preferred there).
    scheduler_dev_shared_secret: str = ""

    # Cache / heartbeat tuning
    playlist_cache_ttl_seconds: int = 60
    heartbeat_flush_interval_seconds: int = 15
    heartbeat_flush_max_batch: int = 500
    offline_threshold_minutes: int = 15
    heartbeat_retention_days: int = 7

    # Timezone used to evaluate playlist item vigencia windows
    business_timezone: str = "America/Mazatlan"

    # CORS (admin panel origins)
    cors_allow_origins: str = "*"

    @property
    def admin_email_allowlist_set(self) -> set[str]:
        return {
            e.strip().lower()
            for e in self.admin_email_allowlist.split(",")
            if e.strip()
        }

    @property
    def cors_allow_origins_list(self) -> List[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
