import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _require(key: str) -> str:
    """Get a required env var, raising only when actually accessed at runtime."""
    val = os.getenv(key, "")
    if not val:
        raise RuntimeError(f"Missing required environment variable: {key}")
    return val


SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY: str = os.getenv("SUPABASE_SERVICE_KEY", "")
GARMIN_EMAIL: str = os.getenv("GARMIN_EMAIL", "")
GARMIN_PASSWORD: str = os.getenv("GARMIN_PASSWORD", "")
GARMIN_TOKEN_DIR: str = os.getenv("GARMIN_TOKEN_DIR", str(Path.home() / ".garmin_tokens"))
GARMIN_USER_ID: str = os.getenv("GARMIN_USER_ID", "")
FETCH_DELAY: float = float(os.getenv("FETCH_DELAY", "1.0"))
