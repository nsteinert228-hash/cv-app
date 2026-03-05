"""CLI entrypoint for Garmin Health → Supabase sync."""

import argparse
import json
import logging
import sys
import time

import config
import garmin_client
import supabase_client
import sync

log = logging.getLogger(__name__)


def _parse_types(types_str: str | None) -> list[str] | None:
    """Parse comma-separated data types. Returns None (= all) if not specified."""
    if not types_str:
        return None
    types = [t.strip() for t in types_str.split(",")]
    for t in types:
        if t not in sync.ALL_DATA_TYPES:
            print(f"Error: unknown data type '{t}'")
            print(f"Valid types: {', '.join(sync.ALL_DATA_TYPES)}")
            sys.exit(1)
    return types


def _print_summary(agg: dict) -> None:
    """Print a summary table from an aggregate result dict."""
    if not agg:
        print("No data synced.")
        return
    print(f"\n{'Type':<20} {'OK':>5} {'Err':>5} {'Skip':>5} {'Records':>8}")
    print("-" * 47)
    for dtype, counts in sorted(agg.items()):
        ok = counts.get("success", 0)
        err = counts.get("error", 0)
        skip = counts.get("skipped", 0)
        recs = counts.get("records", 0)
        print(f"{dtype:<20} {ok:>5} {err:>5} {skip:>5} {recs:>8}")


def cmd_sync(args: argparse.Namespace) -> None:
    """Run a sync for --today, --date, or --range."""
    garmin = garmin_client.get_client()
    sb = supabase_client.get_client()
    data_types = _parse_types(args.types)
    user_id = args.user_id

    if args.today:
        results = sync.sync_today(garmin, sb, user_id, data_types)
        _print_summary({"_": {"success": 1, "records": sum(
            r["records"] for r in results.values()
        )}}) if results else None

    elif args.date:
        results = sync.sync_date(garmin, sb, args.date, user_id, data_types)
        for dtype, r in results.items():
            status = "ok" if r["status"] == "success" else f"ERROR: {r['error']}"
            print(f"  {dtype}: {status} ({r['records']} records)")

    elif args.range:
        start, end = args.range
        agg = sync.sync_date_range(garmin, sb, start, end, user_id, data_types)
        _print_summary(agg)

    else:
        print("Specify --today, --date, or --range")
        sys.exit(1)


def cmd_backfill(args: argparse.Namespace) -> None:
    """Backfill the last N days, skipping already-synced date/type pairs."""
    garmin = garmin_client.get_client()
    sb = supabase_client.get_client()
    data_types = _parse_types(args.types)

    agg = sync.backfill(garmin, sb, args.user_id, days=args.days, data_types=data_types)
    _print_summary(agg)


def cmd_sync_all(args: argparse.Namespace) -> None:
    """Sync all connected Garmin users (multi-user mode)."""
    config.validate(multi_user=True)

    sb = supabase_client.get_client()
    encryption_key = config.GARMIN_ENCRYPTION_KEY

    # Fetch all connections that need processing
    result = (
        sb.table("garmin_connections")
        .select("user_id, status")
        .in_("status", ["pending", "active", "sync_requested"])
        .execute()
    )

    connections = result.data or []
    if not connections:
        print("No Garmin connections to process.")
        return

    print(f"Processing {len(connections)} connection(s)...")

    for conn in connections:
        uid = conn["user_id"]
        status = conn["status"]
        log.info("Processing user %s (status: %s)", uid, status)

        try:
            # Get decrypted credentials
            creds_result = sb.rpc("get_garmin_credentials", {
                "p_user_id": uid,
                "p_key": encryption_key,
            }).execute()

            if not creds_result.data:
                log.error("No credentials found for user %s", uid)
                continue

            creds = creds_result.data[0]

            if status == "pending":
                # Initial auth — authenticate with credentials and store tokens
                garmin = garmin_client.get_client_for_user(
                    creds["garmin_email"], creds["garmin_password"]
                )
                # Save garth tokens back to DB
                tokens_json = json.dumps(garmin.garth.dumps())
                sb.table("garmin_connections").update({
                    "encrypted_tokens": {
                        "password": (
                            sb.rpc("store_garmin_credentials", {
                                "p_user_id": uid,
                                "p_email": creds["garmin_email"],
                                "p_password": creds["garmin_password"],
                                "p_key": encryption_key,
                            })
                        ),
                        "garth_tokens": tokens_json,
                    },
                    "status": "active",
                    "error_message": None,
                }).eq("user_id", uid).execute()
                log.info("Activated user %s, running initial sync", uid)

            else:
                # Active/sync_requested — create client from credentials
                garmin = garmin_client.get_client_for_user(
                    creds["garmin_email"], creds["garmin_password"]
                )

            # Run today's sync
            sync.sync_today(garmin, sb, uid)

            # Update last_sync_at and reset status
            sb.table("garmin_connections").update({
                "last_sync_at": supabase_client._now_iso(),
                "status": "active",
                "error_message": None,
            }).eq("user_id", uid).execute()

            log.info("Sync complete for user %s", uid)

        except Exception as exc:
            log.error("Sync failed for user %s: %s", uid, exc)
            try:
                sb.table("garmin_connections").update({
                    "status": "error",
                    "error_message": str(exc)[:500],
                }).eq("user_id", uid).execute()
            except Exception:
                log.error("Failed to update error status for user %s", uid)

    print("sync-all complete.")


def cmd_sync_all_watch(args: argparse.Namespace) -> None:
    """Run sync-all in a loop, polling every --interval seconds."""
    interval = args.interval
    print(f"Watching for sync requests every {interval}s  (Ctrl+C to stop)")
    try:
        while True:
            cmd_sync_all(args)
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\nStopped.")


def cmd_status(args: argparse.Namespace) -> None:
    """Query sync_log and display the most recent successful sync per data type."""
    sb = supabase_client.get_client()

    query = (
        sb.table("sync_log")
        .select("data_type, sync_date, status, records_synced, completed_at")
        .eq("status", "success")
        .order("completed_at", desc=True)
        .limit(50)
    )

    if hasattr(args, "user_id") and args.user_id:
        query = query.eq("user_id", args.user_id)

    result = query.execute()

    if not result.data:
        print("No sync history found.")
        return

    # Group by data_type, show most recent sync per type
    latest: dict[str, dict] = {}
    for row in result.data:
        dtype = row["data_type"]
        if dtype not in latest:
            latest[dtype] = row

    print(f"\n{'Data Type':<20} {'Last Synced Date':<18} {'Records':>8}  {'Completed At'}")
    print("-" * 75)
    for dtype in sorted(latest):
        row = latest[dtype]
        print(f"{dtype:<20} {row['sync_date']:<18} {row['records_synced'] or 0:>8}  {row['completed_at']}")


def main() -> None:
    """Parse CLI args and dispatch to the appropriate subcommand."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-5s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    parser = argparse.ArgumentParser(
        description="Garmin Health → Supabase Sync",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""examples:
  python main.py sync --today --user-id <uuid>
  python main.py sync --date 2025-03-01 --user-id <uuid>
  python main.py sync --range 2025-01-01 2025-03-01 --user-id <uuid>
  python main.py sync --today --user-id <uuid> --types sleep,hrv
  python main.py backfill --days 90 --user-id <uuid>
  python main.py sync-all
  python main.py status --user-id <uuid>""",
    )
    subparsers = parser.add_subparsers(dest="command")

    # sync
    sp = subparsers.add_parser("sync", help="Sync Garmin data to Supabase")
    sp.add_argument("--today", action="store_true", help="Sync today's data")
    sp.add_argument("--date", type=str, metavar="YYYY-MM-DD",
                    help="Sync a specific date")
    sp.add_argument("--range", nargs=2, metavar=("START", "END"),
                    help="Sync a date range (inclusive)")
    sp.add_argument("--types", type=str, metavar="TYPE,TYPE,...",
                    help=f"Comma-separated data types (default: all). "
                         f"Options: {', '.join(sync.ALL_DATA_TYPES)}")
    sp.add_argument("--user-id", type=str, required=True,
                    help="UUID of the user to sync data for")

    # backfill
    bp = subparsers.add_parser("backfill", help="Backfill historical data")
    bp.add_argument("--days", type=int, default=30,
                    help="Number of days to backfill (default: 30)")
    bp.add_argument("--types", type=str, metavar="TYPE,TYPE,...",
                    help="Comma-separated data types (default: all)")
    bp.add_argument("--user-id", type=str, required=True,
                    help="UUID of the user to backfill data for")

    # sync-all
    sa = subparsers.add_parser("sync-all",
                               help="Sync all connected Garmin users (multi-user cron)")
    sa.add_argument("--watch", action="store_true",
                    help="Poll continuously for sync requests")
    sa.add_argument("--interval", type=int, default=10,
                    help="Seconds between polls in watch mode (default: 10)")

    # status
    stp = subparsers.add_parser("status", help="Show last sync status per data type")
    stp.add_argument("--user-id", type=str, default=None,
                     help="Filter status to a specific user UUID")

    args = parser.parse_args()

    if args.command in ("sync", "backfill", "status"):
        config.validate()
    elif args.command == "sync-all":
        config.validate(multi_user=True)

    if args.command == "sync":
        cmd_sync(args)
    elif args.command == "backfill":
        cmd_backfill(args)
    elif args.command == "sync-all":
        if args.watch:
            cmd_sync_all_watch(args)
        else:
            cmd_sync_all(args)
    elif args.command == "status":
        cmd_status(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
