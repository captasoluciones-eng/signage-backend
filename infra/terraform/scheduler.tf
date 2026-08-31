// Three Cloud Scheduler jobs calling the /jobs/* endpoints on the backend,
// authenticated via an OIDC token minted for google_service_account.scheduler
// (verified server-side in app/deps.py::verify_scheduler_request).

resource "google_cloud_scheduler_job" "mark_offline_devices" {
  name             = "signage-mark-offline-devices"
  project          = var.project_id
  region           = var.region
  description      = "Flags devices with no heartbeat in 15 minutes as offline and fires the alert hook."
  schedule         = "*/5 * * * *"
  time_zone        = "America/Mazatlan"
  attempt_deadline = "30s"

  retry_config {
    retry_count = 2
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.backend.uri}/jobs/mark-offline-devices"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience               = "${google_cloud_run_v2_service.backend.uri}/jobs/mark-offline-devices"
    }
  }

  depends_on = [google_cloud_run_v2_service_iam_member.scheduler_invoker]
}

resource "google_cloud_scheduler_job" "snapshot_devices" {
  name             = "signage-snapshot-devices"
  project          = var.project_id
  region           = var.region
  description      = "Hourly snapshot of the Firestore devices collection into BigQuery.device_snapshots."
  schedule         = "0 * * * *"
  time_zone        = "America/Mazatlan"
  attempt_deadline = "60s"

  retry_config {
    retry_count = 2
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.backend.uri}/jobs/snapshot-devices"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience               = "${google_cloud_run_v2_service.backend.uri}/jobs/snapshot-devices"
    }
  }

  depends_on = [google_cloud_run_v2_service_iam_member.scheduler_invoker]
}

resource "google_cloud_scheduler_job" "flush_heartbeats" {
  name             = "signage-flush-heartbeats"
  project          = var.project_id
  region           = var.region
  description      = "Safety-net flush of the in-memory heartbeat buffer, bounding staleness while Cloud Run is scaled to zero between device polls."
  schedule         = "* * * * *"
  time_zone        = "America/Mazatlan"
  attempt_deadline = "30s"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.backend.uri}/jobs/flush-heartbeats"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience               = "${google_cloud_run_v2_service.backend.uri}/jobs/flush-heartbeats"
    }
  }

  depends_on = [google_cloud_run_v2_service_iam_member.scheduler_invoker]
}

resource "google_cloud_scheduler_job" "purge_old_heartbeats" {
  name             = "signage-purge-old-heartbeats"
  project          = var.project_id
  region           = var.region
  description      = "Daily purge of Firestore heartbeat history docs older than 7 days."
  schedule         = "0 3 * * *"
  time_zone        = "America/Mazatlan"
  attempt_deadline = "300s"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.backend.uri}/jobs/purge-old-heartbeats"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience               = "${google_cloud_run_v2_service.backend.uri}/jobs/purge-old-heartbeats"
    }
  }

  depends_on = [google_cloud_run_v2_service_iam_member.scheduler_invoker]
}
