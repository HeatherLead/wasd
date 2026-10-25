"""
backend/tests/test_client.py
Unit tests for Elexon client chunking, parameters, and error handling.
"""

from datetime import datetime, timezone, timedelta
import pytest
import httpx
from app.elexon.client import ElexonClient, ElexonAPIError


def test_client_init_and_config():
    client = ElexonClient(base_url="https://custom.api/v1", timeout=15.0, max_retries=2)
    assert client.base_url == "https://custom.api/v1"
    assert client.timeout == 15.0
    assert client.max_retries == 2


def test_format_datetime_converts_to_utc_iso():
    client = ElexonClient()
    dt = datetime(2026, 1, 1, 9, 30, tzinfo=timezone.utc)
    assert client._format_datetime(dt) == "2026-01-01T09:30:00Z"


def test_fetch_stream_chunked_validates_dates():
    client = ElexonClient()
    dt1 = datetime(2026, 1, 5, 0, 0, tzinfo=timezone.utc)
    dt2 = datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
    with pytest.raises(ValueError, match="strictly earlier"):
        client.fetch_stream_chunked("dummy", dt1, dt2)


def test_client_chunking_generates_correct_subranges(monkeypatch):
    client = ElexonClient()
    calls = []

    def mock_execute(endpoint, params):
        calls.append((endpoint, params["publishDateTimeFrom"], params["publishDateTimeTo"]))
        return [{"dummy": 1}]

    monkeypatch.setattr(client, "_execute_request_with_retry", mock_execute)

    start = datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 1, 15, 0, 0, tzinfo=timezone.utc)

    # Chunk days = 7: should produce 2 chunks (1-8 and 8-15)
    records = client.fetch_stream_chunked("test_stream", start, end, chunk_days=7)

    assert len(records) == 2
    assert len(calls) == 2
    assert calls[0] == ("test_stream", "2026-01-01T00:00:00Z", "2026-01-08T00:00:00Z")
    assert calls[1] == ("test_stream", "2026-01-08T00:00:00Z", "2026-01-15T00:00:00Z")
