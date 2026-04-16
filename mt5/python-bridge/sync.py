"""
TRDR MT5 Bridge — Syncs closed trades from MetaTrader 5 to TRDR journal.

How it works:
1. Connects to your running MT5 terminal via the MetaTrader5 Python package
2. Reads closed trade history
3. Tracks which trades have already been synced (local state file)
4. Sends new trades to your TRDR API via the /api/mt5 webhook
5. Runs on a configurable interval (default: every 30 seconds)

Requirements:
- Windows (MT5 Python package only works on Windows)
- MT5 terminal must be running
- pip install -r requirements.txt

Usage:
  python sync.py           # Run once
  python sync.py --watch   # Run continuously (every N seconds)
  python sync.py --history # Sync all history (past N days)
"""

import os
import sys
import json
import time
import argparse
from datetime import datetime, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv

# Load environment
load_dotenv()

API_URL = os.getenv("TRDR_API_URL", "")
WEBHOOK_SECRET = os.getenv("TRDR_WEBHOOK_SECRET", "")
USER_ID = os.getenv("TRDR_USER_ID", "")
SYNC_INTERVAL = int(os.getenv("SYNC_INTERVAL_SECONDS", "30"))
LOOKBACK_DAYS = int(os.getenv("LOOKBACK_DAYS", "7"))

# State file to track synced deals
STATE_FILE = Path(__file__).parent / ".synced_deals.json"


def load_synced_deals() -> set:
    """Load set of already-synced deal tickets."""
    if STATE_FILE.exists():
        data = json.loads(STATE_FILE.read_text())
        return set(data.get("synced", []))
    return set()


def save_synced_deals(deals: set) -> None:
    """Persist synced deal tickets to disk."""
    STATE_FILE.write_text(json.dumps({
        "synced": list(deals),
        "last_sync": datetime.now().isoformat(),
    }, indent=2))


def connect_mt5() -> bool:
    """Initialize connection to MT5 terminal."""
    try:
        import MetaTrader5 as mt5
    except ImportError:
        print("ERROR: MetaTrader5 package not installed.")
        print("Run: pip install MetaTrader5")
        print("NOTE: This only works on Windows with MT5 installed.")
        sys.exit(1)

    mt5_path = os.getenv("MT5_PATH")
    login = os.getenv("MT5_LOGIN")
    password = os.getenv("MT5_PASSWORD")
    server = os.getenv("MT5_SERVER")

    kwargs = {}
    if mt5_path:
        kwargs["path"] = mt5_path
    if login:
        kwargs["login"] = int(login)
    if password:
        kwargs["password"] = password
    if server:
        kwargs["server"] = server

    if not mt5.initialize(**kwargs):
        print(f"MT5 initialization failed: {mt5.last_error()}")
        return False

    info = mt5.account_info()
    if info is None:
        print("Failed to get account info")
        mt5.shutdown()
        return False

    print(f"Connected to MT5: {info.name} (#{info.login}) on {info.server}")
    print(f"Balance: {info.balance} {info.currency}")
    return True


def fetch_closed_deals(days_back: int = None) -> list:
    """Fetch closed deals from MT5 history."""
    import MetaTrader5 as mt5

    lookback = days_back or LOOKBACK_DAYS
    from_date = datetime.now() - timedelta(days=lookback)
    to_date = datetime.now()

    deals = mt5.history_deals_get(from_date, to_date)
    if deals is None:
        print(f"No deals found or error: {mt5.last_error()}")
        return []

    closed_trades = []

    for deal in deals:
        # Only exit deals (closing a position)
        if deal.entry != mt5.DEAL_ENTRY_OUT:
            continue

        # Skip balance/credit/commission-only deals
        if deal.type not in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL):
            continue

        # Find the matching entry deal
        position_deals = mt5.history_deals_get(position=deal.position_id)
        if position_deals is None:
            continue

        entry_deal = None
        for d in position_deals:
            if d.entry == mt5.DEAL_ENTRY_IN:
                entry_deal = d
                break

        if entry_deal is None:
            continue

        # Determine direction (based on entry deal)
        direction = "buy" if entry_deal.type == mt5.DEAL_TYPE_BUY else "sell"

        closed_trades.append({
            "ticket": deal.ticket,
            "position_id": deal.position_id,
            "instrument": deal.symbol,
            "type": direction,
            "open_price": round(entry_deal.price, 5),
            "close_price": round(deal.price, 5),
            "open_time": datetime.fromtimestamp(entry_deal.time).strftime("%Y-%m-%d %H:%M:%S"),
            "close_time": datetime.fromtimestamp(deal.time).strftime("%Y-%m-%d %H:%M:%S"),
            "volume": round(deal.volume, 2),
            "commission": round(entry_deal.commission + deal.commission, 2),
            "swap": round(deal.swap, 2),
            "profit": round(deal.profit, 2),
        })

    return closed_trades


def send_to_trdr(trades: list) -> dict:
    """Send trades to TRDR API webhook."""
    if not trades:
        return {"imported": 0}

    # Send in batches of 10
    total_imported = 0
    errors = []

    for i in range(0, len(trades), 10):
        batch = trades[i:i + 10]

        # Remove internal fields before sending
        payload_trades = [
            {k: v for k, v in t.items() if k not in ("ticket", "position_id")}
            for t in batch
        ]

        payload = {"trades": payload_trades}

        try:
            resp = requests.post(
                API_URL,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {WEBHOOK_SECRET}",
                    "x-user-id": USER_ID,
                },
                timeout=30,
            )

            if resp.status_code in (200, 201):
                data = resp.json()
                imported = data.get("data", {}).get("imported", len(batch))
                total_imported += imported
                print(f"  Batch {i // 10 + 1}: {imported} trades imported")
            else:
                error_msg = f"HTTP {resp.status_code}: {resp.text[:200]}"
                errors.append(error_msg)
                print(f"  Batch {i // 10 + 1} FAILED: {error_msg}")

        except requests.exceptions.RequestException as e:
            error_msg = str(e)
            errors.append(error_msg)
            print(f"  Batch {i // 10 + 1} ERROR: {error_msg}")

    return {"imported": total_imported, "errors": errors}


def sync_once(days_back: int = None) -> None:
    """Run a single sync cycle."""
    synced = load_synced_deals()
    deals = fetch_closed_deals(days_back)

    # Filter out already-synced deals
    new_deals = [d for d in deals if d["ticket"] not in synced]

    if not new_deals:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] No new trades to sync ({len(deals)} total, {len(synced)} already synced)")
        return

    print(f"[{datetime.now().strftime('%H:%M:%S')}] Found {len(new_deals)} new trades to sync")

    result = send_to_trdr(new_deals)

    if result["imported"] > 0:
        # Mark as synced
        new_tickets = {d["ticket"] for d in new_deals}
        save_synced_deals(synced | new_tickets)
        print(f"  Synced {result['imported']} trades successfully")

    if result.get("errors"):
        print(f"  {len(result['errors'])} batch(es) had errors")


def watch_mode() -> None:
    """Continuously sync on an interval."""
    print(f"\nStarting watch mode (syncing every {SYNC_INTERVAL}s)")
    print("Press Ctrl+C to stop\n")

    while True:
        try:
            sync_once()
            time.sleep(SYNC_INTERVAL)
        except KeyboardInterrupt:
            print("\nStopping...")
            break


def validate_config() -> bool:
    """Validate required configuration."""
    errors = []
    if not API_URL:
        errors.append("TRDR_API_URL is not set")
    if not WEBHOOK_SECRET:
        errors.append("TRDR_WEBHOOK_SECRET is not set")
    if not USER_ID:
        errors.append("TRDR_USER_ID is not set")

    if errors:
        print("Configuration errors:")
        for e in errors:
            print(f"  - {e}")
        print("\nCopy .env.example to .env and fill in the values.")
        return False

    return True


def main():
    parser = argparse.ArgumentParser(description="TRDR MT5 Trade Sync Bridge")
    parser.add_argument("--watch", action="store_true", help="Run continuously")
    parser.add_argument("--history", action="store_true", help="Sync full history")
    parser.add_argument("--days", type=int, default=None, help="Days of history to sync")
    parser.add_argument("--dry-run", action="store_true", help="Show trades without sending")
    args = parser.parse_args()

    print("=" * 50)
    print("  TRDR MT5 Bridge")
    print("=" * 50)

    if not validate_config():
        sys.exit(1)

    if not connect_mt5():
        sys.exit(1)

    days = args.days or (30 if args.history else LOOKBACK_DAYS)

    if args.dry_run:
        deals = fetch_closed_deals(days)
        print(f"\nFound {len(deals)} closed trades:")
        for d in deals:
            print(f"  {d['close_time']} | {d['instrument']:8s} | {d['type']:4s} | "
                  f"Open: {d['open_price']:>10.5f} | Close: {d['close_price']:>10.5f} | "
                  f"P&L: {d['profit']:>8.2f}")
        return

    if args.watch:
        sync_once(days)  # Initial sync
        watch_mode()
    else:
        sync_once(days)

    import MetaTrader5 as mt5
    mt5.shutdown()
    print("\nDone.")


if __name__ == "__main__":
    main()
