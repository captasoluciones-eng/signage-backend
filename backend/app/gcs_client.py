"""
Cloud Storage helper: issues V4 signed URLs so the admin panel can upload
assets directly to GCS (bypassing the API server for the bytes themselves),
and builds the public/CDN URL an asset is served from.
"""
from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Optional

import google.auth
from google.auth import compute_engine, impersonated_credentials
from google.api_core.exceptions import NotFound
from google.cloud import storage

from app.config import get_settings

settings = get_settings()


def _build_signing_credentials():
    """Cloud Run's default credentials are a bare access token with no
    private key, so `generate_signed_url` (V4) can't sign locally -- it raises
    "you need a private key to sign credentials". The fix is to route signing
    through the IAM signBlob API via self-impersonation (the runtime service
    account already holds roles/iam.serviceAccountTokenCreator on itself).
    A key-based credential (local dev with a downloaded SA key) already signs
    fine on its own, so it's left untouched."""
    source_credentials, _ = google.auth.default()
    if not isinstance(source_credentials, compute_engine.Credentials):
        return None
    return impersonated_credentials.Credentials(
        source_credentials=source_credentials,
        target_principal=f"signage-backend@{settings.gcp_project}.iam.gserviceaccount.com",
        target_scopes=["https://www.googleapis.com/auth/cloud-platform"],
        lifetime=settings.gcs_signed_url_expiration_seconds,
    )


class GcsClient:
    def __init__(self, client: Optional[storage.Client] = None):
        self._client = client or storage.Client(project=settings.gcp_project)
        self._bucket_name = settings.gcs_assets_bucket
        self._signing_credentials = _build_signing_credentials()

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
            credentials=self._signing_credentials,
        )
        gcs_path = f"gs://{self._bucket_name}/{object_name}"
        # Served directly from the bucket's public URL (see infra/terraform/
        # storage.tf) -- no Cloud CDN / load balancer in front of it, which
        # would add a fixed monthly cost not worth it at this scale. If that
        # changes later, this is the only line that needs to point at a CDN
        # domain instead.
        cdn_url = f"https://storage.googleapis.com/{self._bucket_name}/{object_name}"
        return upload_url, gcs_path, cdn_url

    def delete_object(self, gcs_path: str) -> None:
        """Deletes the object behind a `gs://bucket/object` path. A missing
        object (already deleted, or the doc predates this field) is not an
        error -- the goal is the Firestore record being gone either way."""
        prefix = f"gs://{self._bucket_name}/"
        if not gcs_path.startswith(prefix):
            return
        object_name = gcs_path[len(prefix):]
        blob = self._client.bucket(self._bucket_name).blob(object_name)
        try:
            blob.delete()
        except NotFound:
            pass


_gcs_singleton: Optional[GcsClient] = None


def get_gcs_client() -> GcsClient:
    global _gcs_singleton
    if _gcs_singleton is None:
        _gcs_singleton = GcsClient()
    return _gcs_singleton
