locals {
  required_apis = [
    "run.googleapis.com",
    "firestore.googleapis.com",
    "bigquery.googleapis.com",
    "storage.googleapis.com",
    "cloudscheduler.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "identitytoolkit.googleapis.com",
    "iam.googleapis.com",
    "compute.googleapis.com",
    "secretmanager.googleapis.com",
  ]
}

resource "google_project_service" "required" {
  for_each           = toset(local.required_apis)
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
