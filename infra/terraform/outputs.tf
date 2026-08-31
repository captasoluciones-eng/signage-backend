output "scheduler_service_account_email" {
  value = google_service_account.scheduler.email
}

output "backend_service_account_email" {
  value = google_service_account.backend.email
}

output "bigquery_dataset" {
  value = google_bigquery_dataset.signage.dataset_id
}

output "android_playlist_base_url" {
  value       = "${google_cloud_run_v2_service.backend.uri}/playlist"
  description = "Exact base URL format to configure in the Android TV APK (append ?deviceId=<id>)."
}
