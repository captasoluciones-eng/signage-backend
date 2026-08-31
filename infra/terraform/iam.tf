// Two service accounts, each with the minimum roles it needs:
//   1. signage-backend: the Cloud Run runtime identity (Firestore, BigQuery,
//      GCS signed-URL signing).
//   2. signage-scheduler: used only to mint OIDC tokens for Cloud Scheduler
//      -> Cloud Run job calls (verified in app/deps.py).

resource "google_service_account" "backend" {
  account_id   = "signage-backend"
  display_name = "Signage backend (Cloud Run runtime SA)"
  depends_on   = [google_project_service.required]
}

resource "google_service_account" "scheduler" {
  account_id   = "signage-scheduler"
  display_name = "Signage Cloud Scheduler invoker"
  depends_on   = [google_project_service.required]
}

resource "google_project_iam_member" "backend_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_project_iam_member" "backend_bigquery_data_editor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_project_iam_member" "backend_bigquery_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_project_iam_member" "backend_storage_object_admin" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

// Needed so the backend SA can mint V4 signed URLs (blob.generate_signed_url)
// without a downloaded key file, via IAM SignBlob. Scoped to the service
// account itself (self-impersonation), not project-wide, to keep this
// minimal.
resource "google_service_account_iam_member" "backend_self_token_creator" {
  service_account_id = google_service_account.backend.name
  role                = "roles/iam.serviceAccountTokenCreator"
  member              = "serviceAccount:${google_service_account.backend.email}"
}

// Allows the scheduler SA to invoke the (otherwise-public) Cloud Run service;
// app-level OIDC verification in app/deps.py additionally checks the caller
// is exactly this service account, as defense in depth.
resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

// The backend Cloud Run service itself is invoked publicly by devices/panel,
// but Cloud Run's default ingress+IAM still requires allUsers for anonymous
// calls (device-key / Firebase-ID-token auth happens at the app layer).
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
