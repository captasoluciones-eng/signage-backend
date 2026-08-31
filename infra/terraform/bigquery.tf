resource "google_bigquery_dataset" "signage" {
  dataset_id                 = "signage"
  project                    = var.project_id
  location                   = var.bq_location
  description                = "Historical analytics for the digital signage fleet."
  delete_contents_on_destroy = false

  depends_on = [google_project_service.required]
}

resource "google_bigquery_table" "heartbeats" {
  dataset_id          = google_bigquery_dataset.signage.dataset_id
  table_id            = "heartbeats"
  project             = var.project_id
  deletion_protection = false

  time_partitioning {
    type          = "DAY"
    field         = "ts"
    expiration_ms = 34560000000 # 400 days
  }
  clustering = ["deviceId"]

  schema = jsonencode([
    { name = "ts", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "deviceId", type = "STRING", mode = "REQUIRED" },
    { name = "groupId", type = "STRING", mode = "NULLABLE" },
    { name = "itemActual", type = "STRING", mode = "NULLABLE" },
    { name = "appVersion", type = "STRING", mode = "NULLABLE" },
    { name = "uptimeSec", type = "FLOAT", mode = "NULLABLE" },
    { name = "ultimoError", type = "STRING", mode = "NULLABLE" },
    { name = "online", type = "BOOLEAN", mode = "NULLABLE" },
  ])
}

resource "google_bigquery_table" "device_snapshots" {
  dataset_id          = google_bigquery_dataset.signage.dataset_id
  table_id            = "device_snapshots"
  project             = var.project_id
  deletion_protection = false

  time_partitioning {
    type  = "DAY"
    field = "fecha"
  }
  clustering = ["deviceId"]

  schema = jsonencode([
    { name = "fecha", type = "DATE", mode = "REQUIRED" },
    { name = "deviceId", type = "STRING", mode = "REQUIRED" },
    { name = "nombre", type = "STRING", mode = "NULLABLE" },
    { name = "groupId", type = "STRING", mode = "NULLABLE" },
    { name = "estado", type = "STRING", mode = "NULLABLE" },
    { name = "lastSeen", type = "STRING", mode = "NULLABLE" },
    { name = "appVersion", type = "STRING", mode = "NULLABLE" },
  ])
}

resource "google_bigquery_table" "play_events" {
  dataset_id          = google_bigquery_dataset.signage.dataset_id
  table_id            = "play_events"
  project             = var.project_id
  deletion_protection = false

  time_partitioning {
    type  = "DAY"
    field = "ts"
  }
  clustering = ["deviceId", "itemId"]

  schema = jsonencode([
    { name = "ts", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "deviceId", type = "STRING", mode = "REQUIRED" },
    { name = "itemId", type = "STRING", mode = "REQUIRED" },
    { name = "tipo", type = "STRING", mode = "NULLABLE" },
    { name = "url", type = "STRING", mode = "NULLABLE" },
    { name = "durationSec", type = "INTEGER", mode = "NULLABLE" },
    { name = "resultado", type = "STRING", mode = "NULLABLE" },
  ])
}

// Views: the query text is kept identical in meaning to infra/bigquery/views.sql
// (that file remains the human-readable source of truth / manual-apply path;
// these resources are the Terraform-managed equivalent -- pick one path per
// environment to avoid drift, as noted in README.md).

resource "google_bigquery_table" "v_uptime_diario_por_dispositivo" {
  dataset_id          = google_bigquery_dataset.signage.dataset_id
  table_id            = "v_uptime_diario_por_dispositivo"
  project             = var.project_id
  deletion_protection = false

  view {
    use_legacy_sql = false
    query          = <<-SQL
      WITH per_device_day AS (
        SELECT DATE(ts) AS fecha, deviceId, ANY_VALUE(groupId) AS groupId, COUNT(*) AS heartbeats_recibidos
        FROM `${var.project_id}.signage.heartbeats`
        GROUP BY fecha, deviceId
      ),
      expected AS (
        SELECT fecha, deviceId, groupId, heartbeats_recibidos, SAFE_DIVIDE(24 * 60, 5) AS heartbeats_esperados
        FROM per_device_day
      )
      SELECT
        fecha, deviceId, ANY_VALUE(ds.nombre) AS nombre, groupId,
        ROUND(LEAST(1.0, SAFE_DIVIDE(heartbeats_recibidos, heartbeats_esperados)) * 100, 2) AS uptimePct
      FROM expected e
      LEFT JOIN `${var.project_id}.signage.device_snapshots` ds
        ON ds.deviceId = e.deviceId AND ds.fecha = e.fecha
      GROUP BY fecha, deviceId, groupId, heartbeats_recibidos, heartbeats_esperados
    SQL
  }

  depends_on = [google_bigquery_table.heartbeats, google_bigquery_table.device_snapshots]
}

resource "google_bigquery_table" "v_disponibilidad_por_grupo" {
  dataset_id          = google_bigquery_dataset.signage.dataset_id
  table_id            = "v_disponibilidad_por_grupo"
  project             = var.project_id
  deletion_protection = false

  view {
    use_legacy_sql = false
    query          = <<-SQL
      SELECT
        groupId, fecha,
        COUNT(DISTINCT deviceId) AS dispositivosTotal,
        COUNT(DISTINCT IF(estado = 'activo' AND lastSeen IS NOT NULL
          AND TIMESTAMP(lastSeen) >= TIMESTAMP_SUB(TIMESTAMP(fecha), INTERVAL 15 MINUTE), deviceId, NULL)) AS dispositivosOnline,
        ROUND(SAFE_DIVIDE(
          COUNT(DISTINCT IF(estado = 'activo' AND lastSeen IS NOT NULL
            AND TIMESTAMP(lastSeen) >= TIMESTAMP_SUB(TIMESTAMP(fecha), INTERVAL 15 MINUTE), deviceId, NULL)),
          NULLIF(COUNT(DISTINCT deviceId), 0)) * 100, 2) AS disponibilidadPct
      FROM `${var.project_id}.signage.device_snapshots`
      WHERE groupId IS NOT NULL
      GROUP BY groupId, fecha
    SQL
  }

  depends_on = [google_bigquery_table.device_snapshots]
}

resource "google_bigquery_table" "v_items_con_mas_errores" {
  dataset_id          = google_bigquery_dataset.signage.dataset_id
  table_id            = "v_items_con_mas_errores"
  project             = var.project_id
  deletion_protection = false

  view {
    use_legacy_sql = false
    query          = <<-SQL
      SELECT itemId, ANY_VALUE(url) AS url, ANY_VALUE(tipo) AS tipo, COUNTIF(resultado = 'error') AS errores, 24 AS ventanaHoras
      FROM `${var.project_id}.signage.play_events`
      WHERE ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
      GROUP BY itemId
      UNION ALL
      SELECT itemId, ANY_VALUE(url) AS url, ANY_VALUE(tipo) AS tipo, COUNTIF(resultado = 'error') AS errores, 168 AS ventanaHoras
      FROM `${var.project_id}.signage.play_events`
      WHERE ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 168 HOUR)
      GROUP BY itemId
    SQL
  }

  depends_on = [google_bigquery_table.play_events]
}

resource "google_bigquery_table" "v_proof_of_play" {
  dataset_id          = google_bigquery_dataset.signage.dataset_id
  table_id            = "v_proof_of_play"
  project             = var.project_id
  deletion_protection = false

  view {
    use_legacy_sql = false
    query          = <<-SQL
      SELECT ts, deviceId, itemId, tipo, url, durationSec, resultado
      FROM `${var.project_id}.signage.play_events`
    SQL
  }

  depends_on = [google_bigquery_table.play_events]
}
