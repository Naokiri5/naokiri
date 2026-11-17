#!/usr/bin/env python3
"""Exercise the real paper execution API in an isolated, offline temporary instance.

Run from the repository root with Python 3 and the repository's Node dependencies installed:
    python3 scripts/verify-ditas-execution.py
The fixture database and owner session are disposable and never touch an existing account.
"""

import http.client
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent


def request(port, path, method="GET", payload=None, cookie=None):
    headers = {}
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload)
    if cookie:
        headers["Cookie"] = cookie
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        connection.request(method, path, body, headers)
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), json.loads(response.read())
    finally:
        connection.close()


def main():
    if not __debug__:
        raise RuntimeError("Run this verification without Python optimization so checks are enabled")
    with tempfile.TemporaryDirectory(prefix="mia-execution-check-") as directory:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        env = os.environ.copy()
        for key in ("ANTHROPIC_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "MIA_EVIDENCE_KEY"):
            env.pop(key, None)
        env.update(MIA_DATA_DIR=directory, MIA_HOST="127.0.0.1", MIA_PORT=str(port), MIA_OFFLINE="1")
        with tempfile.TemporaryFile(mode="w+") as log:
            server = subprocess.Popen(["node", "--import", "tsx", "server/src/main.ts"], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    log.seek(0)
                    if "MIA 4.1 is running" in log.read():
                        break
                    if server.poll() is not None:
                        raise RuntimeError("isolated server exited before it was ready")
                    time.sleep(0.1)
                else:
                    raise RuntimeError("isolated server did not start within 30 seconds")

                status, _, _ = request(port, "/api/ditas/execution")
                assert status == 401, f"unauthenticated request returned {status}, expected 401"
                status, headers, _ = request(port, "/api/auth/setup", "POST", {"password": secrets.token_urlsafe(32)})
                assert status == 200, f"isolated owner setup failed: {status}"
                cookie = headers["set-cookie"].split(";", 1)[0]
                status, _, _ = request(port, "/api/ditas/execution?limit=0", cookie=cookie)
                assert status == 400, f"invalid limit returned {status}, expected 400"

                db = sqlite3.connect(Path(directory) / "mia.db", timeout=5)
                try:
                    for order_id, account in (("paper", "paper-bot"), ("other", "external")):
                        db.execute("INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                                   (order_id, order_id, account, "binance-paper", "BTCUSDT", "BUY", "MARKET", 2, "PARTIAL", "ENTRY", 100, 100))
                    db.executemany("INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)",
                                   [("fill-a", "paper", 1, 100, 0.1, "TAKER", 110), ("fill-b", "paper", 1, 102, 0.1, "TAKER", 120)])
                    db.commit()
                finally:
                    db.close()
                status, _, result = request(port, "/api/ditas/execution?limit=100", cookie=cookie)
                assert status == 200 and result["label"] == "PAPER", "paper execution response unavailable"
                assert len(result["orders"]) == 1 and result["orders"][0]["orderId"] == "paper", "account isolation failed"
                order = result["orders"][0]
                assert order["averageFillPrice"] == 101 and order["filledQty"] == 2 and abs(order["fees"] - 0.2) < 1e-9, "fill aggregation failed"
                assert order["expectedPrice"] is None and order["adverseSlippageBps"] is None, "missing reference must stay unknown"
                assert order["firstFillDelayMs"] == 10 and order["lastRecordedFillDelayMs"] == 20, "recording delays incorrect"
                print("PASS: offline HTTP authentication, limits, paper isolation and fill projection")
            finally:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == "__main__":
    main()
