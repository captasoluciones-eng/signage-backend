"""
Cloud Storage helper: issues V4 signed URLs so the admin panel can upload
assets directly to GCS (bypassing the API server for the bytes themselves),
and builds the public/CDN URL an asset is served from.
"""
from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Optional

from google.cloud import storage

from app.config import get_settings

settings = get_settings()


class GcsClient:
    def __init__(self, client: Optional[storage.Client] = None):
        self._client = client or storage.Client(project=settings.gcp_project)
        self._bucket_name = settings.gcs_assets_bucket

    def build_signed_upload_url(self, filename: str, content_type: str) -> tuple[str, str, str]:
        """Returns (upload_url, gcs_path, cdn_url)."""
        ext = filename.rsplit(".", 1)[-1] if "." in filename else "bin"
        object_name = f"assets/{uuid.uuid4().hex}.{ext}"
        bucket = self._client.bucket(self._bucket_name)
        blob = bucket.blob(object_name)
        upload_url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(seconds=settings.gcs_signed_url_expiration_seconds),
            method="PUT",
            content_type=content_type,
        )
        gcs_path = f"gs://{self._bucket_name}/{object_name}"
        # Served via Cloud CDN fronting an HTTP(S) load balancer backed by this
        # bucket (see infra/terraform/storage.tf) -- the CDN host is a stable
        # custom/media domain mapped to that load balancer.
        cdn_url = f"https://cdn.signage.example.com/{object_name}"
        return upload_url, gcs_path, cdn_url


_gcs_singleton: Optional[GcsClient] = None


def get_gcs_client() -> GcsClient:
    global _gcs_singleton
    if _gcs_singleton is None:
        _gcs_singleton = GcsClient()
    return _gcs_singleton
