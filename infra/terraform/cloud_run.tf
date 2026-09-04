resource "google_cloud_run_v2_service" "backend" {
  name     = "signage-backend"
  location = var.region
  project  = var.project_id
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.backend.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    max_instance_request_concurrency = var.container_concurrency

    containers {
      image = var.backend_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true # default: CPU only allocated during request handling,
                         # required to scale to zero / stay within the Cloud Run
                         # free tier -- see app/heartbeat_buffer.py for how
                         # heartbeat flushing stays correct without an always-on
                         # background task
      }

      env {
        name  = "GCP_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GCP_REGION"
        value = var.region
      }
      env {
        name  = "BQ_DATASET"
        value = "signage"
      }
      env {
        name  = "BQ_LOCATION"
        value = var.bq_location
      }
      env {
        name  = "GCS_ASSETS_BUCKET"
        value = var.assets_bucket_name
      }
      env {
        name  = "FIREBASE_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "ADMIN_EMAIL_ALLOWLIST"
        value = var.admin_email_allowlist
      }
      env {
        name  = "SCHEDULER_SERVICE_ACCOUNT_EMAIL"
        value = google_service_account.scheduler.email
      }
      env {
        name  = "CORS_ALLOW_ORIGINS"
        value = var.cors_allow_origins
      }
      env {
        name  = "SCHEDULER_DEV_SHARED_SECRET"
        value = "" # never set in production; OIDC verification is used instead
      }

      startup_probe {
        http_get {
          path = "/_internal/health"
        }
        initial_delay_seconds = 5
        period_seconds         = 5
        failure_threshold      = 6
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [google_project_service.required]
}

output "backend_url" {
  value       = google_cloud_run_v2_service.backend.uri
  description = "Base URL for the Cloud Run backend. The Android APK's /playlist base URL is this + /playlist."
}
