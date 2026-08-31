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
    """6-digit numeric pairing code, human-typeable on a TV remote."""
    return f"{secrets.randbelow(1_000_000):06d}"


def generate_device_key() -> str:
    """Opaque per-device API key issued at pairing time."""
    alphabet = string.ascii_letters + string.digits
    return "dk_" + "".join(secrets.choice(alphabet) for _ in range(40))


def now_utc_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _parse_flexible(dt_str: str) -> datetime:
    """Parses an ISO date ("2026-08-01") or datetime, returning a tz-aware
    datetime in BUSINESS_TZ. Bare dates are treated as midnight local time.
    """
    dt_str = dt_str.strip()
    if len(dt_str) == 10:  # YYYY-MM-DD
        dt = datetime.strptime(dt_str, "%Y-%m-%d")
        return dt.replace(tzinfo=BUSINESS_TZ)
    # Accept trailing "Z"
    normalized = dt_str.replace("Z", "+00:00")
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=BUSINESS_TZ)
    return dt.astimezone(BUSINESS_TZ)


def is_item_vigente(vigencia_desde: str | None, vigencia_hasta: str | None) -> bool:
    """True if "now" (evaluated in America/Mazatlan) falls within
    [vigenciaDesde, vigenciaHasta]. Either bound may be absent/open-ended.
    """
    now = datetime.now(BUSINESS_TZ)
    if vigencia_desde:
        try:
            if now < _parse_flexible(vigencia_desde):
                return False
        except ValueError:
            pass
    if vigencia_hasta:
        try:
            if now > _parse_flexible(vigencia_hasta):
                return False
        except ValueError:
            pass
    return True
