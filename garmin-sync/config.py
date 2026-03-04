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
GARMIN_ENCRYPTION_KEY: str = os.getenv("GARMIN_ENCRYPTION_KEY", "")
FETCH_DELAY: float = float(os.getenv("FETCH_DELAY", "1.0"))

_REQUIRED_SINGLE_USER = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "GARMIN_EMAIL",
    "GARMIN_PASSWORD",
]

_REQUIRED_MULTI_USER = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "GARMIN_ENCRYPTION_KEY",
]


def validate(multi_user: bool = False) -> None:
    """Raise RuntimeError if any required env var is missing."""
    required = _REQUIRED_MULTI_USER if multi_user else _REQUIRED_SINGLE_USER
    missing = [k for k in required if not os.getenv(k)]
    if missing:
        raise RuntimeError(
            f"Missing required environment variables: {', '.join(missing)}\n"
            "Copy .env.example to .env and fill in the values."
        )
