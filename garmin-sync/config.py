"""Configuration loaded from environment variables.

Values default to empty strings so that imports succeed during testing.
Runtime code should call validate() at startup to ensure required vars
are set before making API calls.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY: str = os.getenv("SUPABASE_SERVICE_KEY", "")
GARMIN_EMAIL: str = os.getenv("GARMIN_EMAIL", "")
GARMIN_PASSWORD: str = os.getenv("GARMIN_PASSWORD", "")
GARMIN_TOKEN_DIR: str = os.getenv("GARMIN_TOKEN_DIR", str(Path.home() / ".garmin_tokens"))
FETCH_DELAY: float = float(os.getenv("FETCH_DELAY", "1.0"))

_REQUIRED = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "GARMIN_EMAIL",
    "GARMIN_PASSWORD",
]


def validate() -> None:
    """Raise RuntimeError if any required env var is missing."""
    missing = [k for k in _REQUIRED if not os.getenv(k)]
    if missing:
        raise RuntimeError(
            f"Missing required environment variables: {', '.join(missing)}\n"
            "Copy .env.example to .env and fill in the values."
        )
