"""CLI entrypoint for Garmin Health → Supabase sync."""

import argparse
import logging
import sys

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

    if args.today:
        results = sync.sync_today(garmin, sb, data_types)
        _print_summary({"_": {"success": 1, "records": sum(
            r["records"] for r in results.values()
        )}}) if results else None

    elif args.date:
        results = sync.sync_date(garmin, sb, args.date, data_types)
        for dtype, r in results.items():
            status = "ok" if r["status"] == "success" else f"ERROR: {r['error']}"
            print(f"  {dtype}: {status} ({r['records']} records)")

    elif args.range:
        start, end = args.range
        agg = sync.sync_date_range(garmin, sb, start, end, data_types)
        _print_summary(agg)

    else:
        print("Specify --today, --date, or --range")
        sys.exit(1)


def cmd_backfill(args: argparse.Namespace) -> None:
    """Backfill the last N days, skipping already-synced date/type pairs."""
    garmin = garmin_client.get_client()
    sb = supabase_client.get_client()
    data_types = _parse_types(args.types)

    agg = sync.backfill(garmin, sb, days=args.days, data_types=data_types)
    _print_summary(agg)


def cmd_status(args: argparse.Namespace) -> None:
    """Query sync_log and display the most recent successful sync per data type."""
    sb = supabase_client.get_client()

    result = (
        sb.table("sync_log")
        .select("data_type, sync_date, status, records_synced, completed_at")
        .eq("status", "success")
        .order("completed_at", desc=True)
        .limit(50)
        .execute()
    )

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
  python main.py sync --today
  python main.py sync --date 2025-03-01
  python main.py sync --range 2025-01-01 2025-03-01
  python main.py sync --today --types sleep,hrv
  python main.py backfill --days 90
  python main.py status""",
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

    # backfill
    bp = subparsers.add_parser("backfill", help="Backfill historical data")
    bp.add_argument("--days", type=int, default=30,
                    help="Number of days to backfill (default: 30)")
    bp.add_argument("--types", type=str, metavar="TYPE,TYPE,...",
                    help="Comma-separated data types (default: all)")

    # status
    subparsers.add_parser("status", help="Show last sync status per data type")

    args = parser.parse_args()

    if args.command in ("sync", "backfill", "status"):
        config.validate()

    if args.command == "sync":
        cmd_sync(args)
    elif args.command == "backfill":
        cmd_backfill(args)
    elif args.command == "status":
        cmd_status(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
