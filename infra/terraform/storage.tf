// Assets bucket: video/image files uploaded by the admin panel via signed
// URLs (see app/gcs_client.py), served publicly to Android TV players
// through Cloud CDN fronting an HTTP(S) load balancer.

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

// --- Cloud CDN in front of the assets bucket -------------------------------

resource "google_compute_backend_bucket" "assets_cdn" {
  name        = "signage-assets-cdn-backend"
  project     = var.project_id
  bucket_name = google_storage_bucket.assets.name
  enable_cdn  = true

  cdn_policy {
    cache_mode        = "CACHE_ALL_STATIC"
    default_ttl       = 3600
    max_ttl           = 86400
    client_ttl        = 3600
    negative_caching  = true
    serve_while_stale = 86400
  }
}

resource "google_compute_url_map" "assets_cdn" {
  name            = "signage-assets-cdn-urlmap"
  project         = var.project_id
  default_service = google_compute_backend_bucket.assets_cdn.id
}

resource "google_compute_managed_ssl_certificate" "assets_cdn" {
  name    = "signage-assets-cdn-cert"
  project = var.project_id

  managed {
    domains = [var.cdn_domain]
  }
}

resource "google_compute_target_https_proxy" "assets_cdn" {
  name             = "signage-assets-cdn-https-proxy"
  project          = var.project_id
  url_map          = google_compute_url_map.assets_cdn.id
  ssl_certificates = [google_compute_managed_ssl_certificate.assets_cdn.id]
}

resource "google_compute_global_address" "assets_cdn" {
  name    = "signage-assets-cdn-ip"
  project = var.project_id
}

resource "google_compute_global_forwarding_rule" "assets_cdn_https" {
  name                  = "signage-assets-cdn-fwd-rule"
  project               = var.project_id
  ip_address            = google_compute_global_address.assets_cdn.address
  ip_protocol           = "TCP"
  port_range            = "443"
  target                = google_compute_target_https_proxy.assets_cdn.id
  load_balancing_scheme = "EXTERNAL"
}

output "cdn_ip_address" {
  value       = google_compute_global_address.assets_cdn.address
  description = "Point var.cdn_domain's DNS A record at this IP to finish CDN setup."
}

output "assets_bucket" {
  value = google_storage_bucket.assets.name
}
