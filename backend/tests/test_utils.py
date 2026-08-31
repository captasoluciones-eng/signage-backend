"""
Pure unit tests that need no GCP credentials/emulators -- exercise the
stateless helpers (ETag hashing, vigencia window evaluation).
Run with: pytest backend/tests
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.utils import compute_etag, is_item_vigente  # noqa: E402


def test_etag_is_deterministic():
    payload = {"a": 1, "b": [1, 2, 3]}
    assert compute_etag(payload) == compute_etag(dict(b=[1, 2, 3], a=1))


def test_etag_changes_when_payload_changes():
    assert compute_etag({"a": 1}) != compute_etag({"a": 2})


def test_vigencia_open_ended_is_always_true():
    assert is_item_vigente(None, None) is True


def test_vigencia_future_start_excludes_item():
    assert is_item_vigente("2999-01-01", None) is False


def test_vigencia_past_end_excludes_item():
    assert is_item_vigente(None, "2000-01-01") is False


def test_vigencia_within_window_includes_item():
    assert is_item_vigente("2000-01-01", "2999-01-01") is True
