-- BigQuery DDL for the `signage` dataset.
-- Apply with: bq query --use_legacy_sql=false < infra/bigquery/tables.sql
-- (dataset itself is created by Terraform / infra/deploy.sh before this runs)

CREATE TABLE IF NOT EXISTS `signage.heartbeats` (
  ts          TIMESTAMP    NOT NULL OPTIONS(description="Heartbeat timestamp, UTC"),
  deviceId    STRING       NOT NULL,
  groupId     STRING,
  itemActual  STRING,
  appVersion  STRING,
  uptimeSec   FLOAT64,
  ultimoError STRING,
  online      BOOL
)
PARTITION BY DATE(ts)
CLUSTER BY deviceId
OPTIONS (
  description = "Raw heartbeat stream from Android TV players, streamed in batches of up to 500 rows every 15s.",
  partition_expiration_days = 400
);

CREATE TABLE IF NOT EXISTS `signage.device_snapshots` (
  fecha      DATE   NOT NULL,
  deviceId   STRING NOT NULL,
  nombre     STRING,
  groupId    STRING,
  estado     STRING,
  lastSeen   STRING,
  appVersion STRING
)
PARTITION BY fecha
CLUSTER BY deviceId
OPTIONS (
  description = "Hourly snapshot of the Firestore devices collection, for historical fleet composition/estado trends."
);

CREATE TABLE IF NOT EXISTS `signage.play_events` (
  ts          TIMESTAMP NOT NULL,
  deviceId    STRING    NOT NULL,
  itemId      STRING    NOT NULL,
  tipo        STRING,
  url         STRING,
  durationSec INT64,
  resultado   STRING  -- ok | error | skipped
)
PARTITION BY DATE(ts)
CLUSTER BY deviceId, itemId
OPTIONS (
  description = "Proof-of-play log: one row per playlist item playback attempt reported by a player."
);
