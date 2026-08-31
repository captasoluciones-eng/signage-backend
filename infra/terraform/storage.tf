// Assets bucket: video/image files uploaded by the admin panel via signed
// URLs (see app/gcs_client.py), served publicly to Android TV players
// directly via their storage.googleapis.com URL. No Cloud CDN / HTTP(S)
// load balancer in front of it -- that combo has a fixed ~$18-25/month
// cost (the global forwarding rule) regardless of traffic, which isn't
// worth it at this scale. Add it back later (a previous version of this
// file had it) if a custom CDN domain or edge caching becomes worth that
// fixed cost -- e.g. once per-screen bandwidth savings from caching
// outweigh it.

resource "google_storage_bucket" "assets" {
  name                        = var.assets_bucket_name
  project                     = var.project_id
  location                    = var.bq_location # reuse the US multi-region for simplicity
  uniform_bucket_level_access = true
  force_destroy               = false

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD", "PUT", "OPTIONS"]
    response_header = ["Content-Type", "ETag"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    condition {
      age = 730
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.required]
}

// Public read on the whole bucket -- assets are non-sensitive marketing
// content meant to be played on public-facing TVs. Uploads still require an
// authenticated admin session to obtain a signed PUT URL in the first place.
resource "google_storage_bucket_iam_member" "assets_public_read" {
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

output "assets_bucket" {
  value = google_storage_bucket.assets.name
}

output "assets_base_url" {
  value       = "https://storage.googleapis.com/${google_storage_bucket.assets.name}"
  description = "Public base URL assets are served from (see app/gcs_client.py)."
}
