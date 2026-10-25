"""
backend/app/elexon/client.py
Elexon BMRS API Client with chunking, retry with exponential backoff, timeouts, and structured error handling.
"""

from __future__ import annotations

import os
import time
import random
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
import httpx

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"
DEFAULT_TIMEOUT = 45.0
DEFAULT_MAX_RETRIES = 3
DEFAULT_CHUNK_DAYS = 7


class ElexonAPIError(Exception):
    """Raised when an Elexon BMRS API request fails after retries or returns an error."""
    def __init__(self, message: str, status_code: Optional[int] = None, endpoint: Optional[str] = None, details: Optional[str] = None):
        super().__init__(message)
        self.status_code = status_code
        self.endpoint = endpoint
        self.details = details


class ElexonClient:
    """
    HTTP client for querying Elexon BMRS datasets via their stream APIs.
    Supports request chunking, automatic retries with exponential backoff,
    and configurable base URL and timeouts.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        backoff_factor: float = 1.0,
    ):
        self.base_url = (base_url or os.environ.get("ELEXON_BASE_URL", DEFAULT_BASE_URL)).rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.backoff_factor = backoff_factor
        self._headers = {
            "User-Agent": "WindForecastAccuracyPortal/1.0",
            "Accept": "application/json"
        }

    def _format_datetime(self, dt: datetime) -> str:
        """Ensure datetime is UTC and formatted as ISO-8601 string."""
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    def _execute_request_with_retry(self, endpoint: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Executes a single HTTP GET request with exponential backoff on retryable status codes and network errors.
        """
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        
        for attempt in range(1, self.max_retries + 1):
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    response = client.get(url, params=params, headers=self._headers)
                    
                    if response.status_code == 200:
                        data = response.json()
                        if isinstance(data, list):
                            return data
                        elif isinstance(data, dict) and "data" in data:
                            return data["data"]
                        else:
                            raise ElexonAPIError(
                                f"Unexpected JSON response format from {endpoint}: expected list or dict with 'data' key.",
                                status_code=200,
                                endpoint=endpoint
                            )
                    
                    # Check retryable status codes: 429 (rate limit), 500, 502, 503, 504
                    if response.status_code in (429, 500, 502, 503, 504):
                        if attempt == self.max_retries:
                            raise ElexonAPIError(
                                f"Elexon API returned status {response.status_code} after {self.max_retries} attempts.",
                                status_code=response.status_code,
                                endpoint=endpoint,
                                details=response.text[:500]
                            )
                        # Backoff with jitter
                        delay = self.backoff_factor * (2 ** (attempt - 1)) + random.uniform(0.1, 0.5)
                        logger.warning(
                            f"Elexon API {endpoint} returned status {response.status_code}. Retrying in {delay:.2f}s (attempt {attempt}/{self.max_retries})..."
                        )
                        time.sleep(delay)
                        continue

                    # Non-retryable error (e.g. 400 Bad Request, 404)
                    raise ElexonAPIError(
                        f"Elexon API request to {endpoint} failed with HTTP {response.status_code}: {response.text[:500]}",
                        status_code=response.status_code,
                        endpoint=endpoint,
                        details=response.text[:500]
                    )

            except (httpx.TimeoutException, httpx.NetworkError) as err:
                if attempt == self.max_retries:
                    raise ElexonAPIError(
                        f"Elexon API request to {endpoint} failed due to network error after {self.max_retries} attempts: {err}",
                        endpoint=endpoint,
                        details=str(err)
                    ) from err
                delay = self.backoff_factor * (2 ** (attempt - 1)) + random.uniform(0.1, 0.5)
                logger.warning(
                    f"Elexon API {endpoint} network error: {err}. Retrying in {delay:.2f}s (attempt {attempt}/{self.max_retries})..."
                )
                time.sleep(delay)

        raise ElexonAPIError(f"Elexon API request to {endpoint} failed unexpectedly.")

    def fetch_stream_chunked(
        self,
        endpoint: str,
        from_dt: datetime,
        to_dt: datetime,
        chunk_days: int = DEFAULT_CHUNK_DAYS,
        extra_params: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Splits a wide date-time window into manageable chunk_days intervals to prevent server timeouts
        and ensure high reliability, then concatenates all returned records.
        """
        if from_dt.tzinfo is None:
            from_dt = from_dt.replace(tzinfo=timezone.utc)
        if to_dt.tzinfo is None:
            to_dt = to_dt.replace(tzinfo=timezone.utc)

        if from_dt >= to_dt:
            raise ValueError(f"from_dt ({from_dt}) must be strictly earlier than to_dt ({to_dt}).")

        all_records: List[Dict[str, Any]] = []
        chunk_delta = timedelta(days=chunk_days)
        current_start = from_dt

        while current_start < to_dt:
            current_end = min(current_start + chunk_delta, to_dt)
            params = {
                "publishDateTimeFrom": self._format_datetime(current_start),
                "publishDateTimeTo": self._format_datetime(current_end),
            }
            if extra_params:
                params.update(extra_params)

            logger.info(
                f"Fetching {endpoint} chunk: {params['publishDateTimeFrom']} -> {params['publishDateTimeTo']}"
            )
            chunk_records = self._execute_request_with_retry(endpoint, params)
            all_records.extend(chunk_records)
            current_start = current_end

        return all_records

    def fetch_fuelhh_stream(
        self,
        from_dt: datetime,
        to_dt: datetime,
        fuel_type: str = "WIND",
        chunk_days: int = DEFAULT_CHUNK_DAYS,
    ) -> List[Dict[str, Any]]:
        """
        Fetches half-hourly actual outturn from FUELHH/stream for the specified fuel type.
        """
        extra = {}
        if fuel_type:
            extra["fuelType"] = fuel_type
        return self.fetch_stream_chunked("datasets/FUELHH/stream", from_dt, to_dt, chunk_days=chunk_days, extra_params=extra)

    def fetch_windfor_stream(
        self,
        from_dt: datetime,
        to_dt: datetime,
        chunk_days: int = DEFAULT_CHUNK_DAYS,
    ) -> List[Dict[str, Any]]:
        """
        Fetches wind generation forecasts from WINDFOR/stream across the specified publish window.
        """
        return self.fetch_stream_chunked("datasets/WINDFOR/stream", from_dt, to_dt, chunk_days=chunk_days)
