"""
Small stateless helpers: ETag hashing, pairing code / device key generation,
and timezone-aware "vigencia" (validity window) evaluation.
"""
from __future__ import annotations

import hashlib
import secrets
import string
from datetime import datetime
from zoneinfo import ZoneInfo

import orjson

BUSINESS_TZ = ZoneInfo("America/Mazatlan")


def compute_etag(payload: dict) -> str:
    """Deterministic hash of a JSON-serializable payload, used as an ETag."""
    canonical = orjson.dumps(payload, option=orjson.OPT_SORT_KEYS)
    digest = hashlib.sha256(canonical).hexdigest()[:32]
    return f'"{digest}"'


def generate_pairing_code() -> str:
    """8-digit numeric pairing code, human-typeable on a TV remote."""
    return f"{secrets.randbelow(100_000_000):08d}"


def generate_device_key() -> str:
    """Opaque per-device API key issued at pairing time."""
    alphabet = string.ascii_letters + string.digits
    return "dk_" + "".join(secrets.choice(alphabet) for _ in range(40))


def now_utc_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _parse_flexible(dt_str: str, tz: ZoneInfo = BUSINESS_TZ, end_of_day: bool = False) -> datetime:
    """Parses an ISO date ("2026-08-01") or datetime, returning a tz-aware
    datetime in `tz`. Bare dates are treated as midnight local time, or as
    23:59:59 when `end_of_day` (so "hasta 2026-09-30" includes that whole day).
    """
    dt_str = dt_str.strip()
    if len(dt_str) == 10:  # YYYY-MM-DD
        dt = datetime.strptime(dt_str, "%Y-%m-%d")
        if end_of_day:
            dt = dt.replace(hour=23, minute=59, second=59)
        return dt.replace(tzinfo=tz)
    # Accept trailing "Z"
    normalized = dt_str.replace("Z", "+00:00")
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    return dt.astimezone(tz)


# "dias" values accepted on playlist items (as written by the Sheet sync).
DIAS_SEMANA = {
    "todos": set(range(7)),
    "lunes a viernes": {0, 1, 2, 3, 4},
    "fines de semana": {5, 6},
}


def resolve_tz(tz_name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name) if tz_name else BUSINESS_TZ
    except Exception:
        return BUSINESS_TZ


def is_item_vigente(
    vigencia_desde: str | None,
    vigencia_hasta: str | None,
    dias: str | None = None,
    hora_inicio: str | None = None,
    hora_fin: str | None = None,
    tz: ZoneInfo = BUSINESS_TZ,
    now: datetime | None = None,
) -> bool:
    """True if "now" (evaluated in `tz`, America/Mazatlan by default) falls
    within [vigenciaDesde, vigenciaHasta], on an allowed weekday, and inside
    the daily [horaInicio, horaFin) window. Every constraint is optional.
    A date-only vigenciaHasta includes that whole day.
    """
    now = (now or datetime.now(tz)).astimezone(tz)
    if vigencia_desde:
        try:
            if now < _parse_flexible(vigencia_desde, tz):
                return False
        except ValueError:
            pass
    if vigencia_hasta:
        try:
            if now > _parse_flexible(vigencia_hasta, tz, end_of_day=True):
                return False
        except ValueError:
            pass
    if dias:
        permitidos = DIAS_SEMANA.get(dias.strip().lower())
        if permitidos is not None and now.weekday() not in permitidos:
            return False
    ahora = now.strftime("%H:%M")
    if hora_inicio and ahora < hora_inicio.strip()[:5].zfill(5):
        return False
    if hora_fin and ahora >= hora_fin.strip()[:5].zfill(5):
        return False
    return True
