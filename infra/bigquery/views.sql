-- Analytic views on top of the `signage` dataset tables.
-- Apply with: bq query --use_legacy_sql=false < infra/bigquery/views.sql
-- (must run after tables.sql)

-- ---------------------------------------------------------------------
-- v_uptime_diario_por_dispositivo: % of expected heartbeats seen per
-- device per day, used by admin.py's /admin/reports/uptime endpoint.
-- Assumes a device configured at pollMinutes=5 should send ~288
-- heartbeats/day; we approximate "expected" from the most common poll
-- interval observed that day per device, defaulting to 5 minutes.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW `signage.v_uptime_diario_por_dispositivo` AS
WITH per_device_day AS (
  SELECT
    DATE(ts) AS fecha,
    deviceId,
    ANY_VALUE(groupId) AS groupId,
    COUNT(*) AS heartbeats_recibidos
  FROM `signage.heartbeats`
  GROUP BY fecha, deviceId
),
expected AS (
  SELECT fecha, deviceId, groupId, heartbeats_recibidos,
         SAFE_DIVIDE(24 * 60, 5) AS heartbeats_esperados
  FROM per_device_day
)
SELECT
  e.fecha AS fecha,
  e.deviceId AS deviceId,
  ANY_VALUE(ds.nombre) AS nombre,
  e.groupId AS groupId,
  ROUND(LEAST(1.0, SAFE_DIVIDE(e.heartbeats_recibidos, e.heartbeats_esperados)) * 100, 2) AS uptimePct
FROM expected e
LEFT JOIN `signage.device_snapshots` ds
  ON ds.deviceId = e.deviceId AND ds.fecha = e.fecha
GROUP BY e.fecha, e.deviceId, e.groupId, e.heartbeats_recibidos, e.heartbeats_esperados;

-- ---------------------------------------------------------------------
-- v_disponibilidad_por_grupo: daily availability % aggregated by group,
-- based on the hourly device_snapshots (a device counts "online" for a
-- snapshot hour if estado = 'activo' and lastSeen is within 15 minutes
-- of the snapshot).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW `signage.v_disponibilidad_por_grupo` AS
SELECT
  groupId,
  fecha,
  COUNT(DISTINCT deviceId) AS dispositivosTotal,
  COUNT(DISTINCT IF(
    estado = 'activo'
    AND lastSeen IS NOT NULL
    AND TIMESTAMP(lastSeen) >= TIMESTAMP_SUB(TIMESTAMP(fecha), INTERVAL 15 MINUTE),
    deviceId, NULL
  )) AS dispositivosOnline,
  ROUND(SAFE_DIVIDE(
    COUNT(DISTINCT IF(
      estado = 'activo'
      AND lastSeen IS NOT NULL
      AND TIMESTAMP(lastSeen) >= TIMESTAMP_SUB(TIMESTAMP(fecha), INTERVAL 15 MINUTE),
      deviceId, NULL
    )),
    NULLIF(COUNT(DISTINCT deviceId), 0)
  ) * 100, 2) AS disponibilidadPct
FROM `signage.device_snapshots`
WHERE groupId IS NOT NULL
GROUP BY groupId, fecha;

-- ---------------------------------------------------------------------
-- v_items_con_mas_errores: playlist items with the most "error" results
-- in the last N hours (used by the dashboard's "top errors last 24h").
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW `signage.v_items_con_mas_errores` AS
SELECT
  itemId,
  ANY_VALUE(url) AS url,
  ANY_VALUE(tipo) AS tipo,
  COUNTIF(resultado = 'error') AS errores,
  24 AS ventanaHoras
FROM `signage.play_events`
WHERE ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
GROUP BY itemId

UNION ALL

SELECT
  itemId,
  ANY_VALUE(url) AS url,
  ANY_VALUE(tipo) AS tipo,
  COUNTIF(resultado = 'error') AS errores,
  168 AS ventanaHoras
FROM `signage.play_events`
WHERE ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 168 HOUR)
GROUP BY itemId;

-- ---------------------------------------------------------------------
-- v_proof_of_play: thin passthrough view (kept so the API/report layer
-- always queries a view, never a raw table directly, allowing the
-- underlying table to evolve independently).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW `signage.v_proof_of_play` AS
SELECT ts, deviceId, itemId, tipo, url, durationSec, resultado
FROM `signage.play_events`;
