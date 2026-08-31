resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.required]
}

// Composite indexes mirrored from infra/firestore.indexes.json. Terraform
// manages the canonical definition here; `firebase deploy --only
// firestore:indexes` (using infra/firestore.indexes.json) is the alternative
// path if you provision via the Firebase CLI instead of Terraform -- pick one
// to avoid drift.
resource "google_firestore_index" "devices_group_estado" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "devices"

  fields {
    field_path = "groupId"
    order      = "ASCENDING"
  }
  fields {
    field_path = "estado"
    order      = "ASCENDING"
  }
}

resource "google_firestore_index" "devices_pairingcode_estado" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "devices"

  fields {
    field_path = "pairingCode"
    order      = "ASCENDING"
  }
  fields {
    field_path = "estado"
    order      = "ASCENDING"
  }
}

resource "google_firestore_index" "devices_estado_lastseen" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "devices"

  fields {
    field_path = "estado"
    order      = "ASCENDING"
  }
  fields {
    field_path = "lastSeen"
    order      = "ASCENDING"
  }
}
