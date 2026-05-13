"""
PayAlert Transaction Generator – Web UI

Flask control panel that wraps generator.py, letting you start/stop
the transaction stream through a browser instead of the CLI.
Streams live logs and stats to the browser via Server-Sent Events.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import random
import threading
from datetime import datetime

from flask import Flask, Response, jsonify, render_template, request

from generator import (
    ACCOUNTS,
    AWS_REGION as DEFAULT_REGION,
    BURST_MAX,
    BURST_MIN,
    GENERATOR_VERSION,
    MAX_INTERVAL,
    MIN_INTERVAL,
    SQS_QUEUE_URL,
    build_sqs_client,
    generate_transaction,
    send_batch,
)

app = Flask(__name__)

ENVIRONMENT = os.getenv("ENVIRONMENT", "dev")

# ── SSE pub-sub ───────────────────────────────────────────────────────────────

_subscribers: list[queue.Queue] = []
_sub_lock = threading.Lock()


def _broadcast(payload: dict) -> None:
    with _sub_lock:
        dead = []
        for q in _subscribers:
            try:
                q.put_nowait(payload)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _subscribers.remove(q)


# ── Logging handler that forwards to SSE ──────────────────────────────────────

class _SSEHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        _broadcast({
            "type":  "log",
            "level": record.levelname,
            "msg":   self.format(record),
            "ts":    datetime.now().strftime("%H:%M:%S"),
        })


_gen_logger = logging.getLogger("payalert.generator")
if not any(isinstance(h, _SSEHandler) for h in _gen_logger.handlers):
    _handler = _SSEHandler()
    _handler.setFormatter(logging.Formatter("%(message)s"))
    _gen_logger.addHandler(_handler)
    _gen_logger.setLevel(logging.INFO)

log = logging.getLogger("payalert.generator")

# ── Generator state ───────────────────────────────────────────────────────────

_stop_event = threading.Event()
_gen_thread: threading.Thread | None = None
_stats_lock = threading.Lock()
_stats: dict = {"sent": 0, "failed": 0, "generated": 0, "start_ts": None}


def _running() -> bool:
    return _gen_thread is not None and _gen_thread.is_alive()


def _get_stats() -> dict:
    with _stats_lock:
        s = dict(_stats)
    elapsed = 0
    if s.get("start_ts"):
        elapsed = int((datetime.now() - s["start_ts"]).total_seconds())
    return {
        "running":   _running(),
        "sent":      s["sent"],
        "failed":    s["failed"],
        "generated": s["generated"],
        "elapsed":   elapsed,
    }


# ── Generator thread workers ──────────────────────────────────────────────────

def _stream_worker(cfg: dict) -> None:
    sqs = None
    if not cfg["dry_run"]:
        try:
            sqs = build_sqs_client(cfg["region"])
            log.info("SQS client ready | region=%s", cfg["region"])
        except Exception as exc:
            log.error("SQS init failed: %s", exc)
            _broadcast({"type": "stopped", **_get_stats()})
            return

    log.info(
        "Stream started | interval=[%.1fs–%.1fs] burst=[%d–%d] fraud=%s dry_run=%s",
        cfg["min_interval"], cfg["max_interval"],
        cfg["burst_min"], cfg["burst_max"],
        cfg["fraud_mode"], cfg["dry_run"],
    )

    target = cfg.get("target_account")
    fraud  = cfg["fraud_mode"]

    while not _stop_event.is_set():
        burst = random.randint(cfg["burst_min"], cfg["burst_max"])
        msgs  = [generate_transaction(target, fraud) for _ in range(burst)]

        if cfg["dry_run"]:
            log.info("[DRY-RUN] Generated %d tx | IDs: %s",
                     burst, [m["transactionId"][:8] for m in msgs])
            with _stats_lock:
                _stats["generated"] += burst
        else:
            for start in range(0, len(msgs), 10):
                chunk = msgs[start:start + 10]
                sent, fail = send_batch(sqs, cfg["queue_url"], chunk)
                with _stats_lock:
                    _stats["sent"]      += sent
                    _stats["generated"] += len(chunk)
                    _stats["failed"]    += fail
                if sent:
                    ids = [m["transactionId"][:8] for m in chunk[:sent]]
                    log.info("Sent %d tx | %s | total=%d", sent, ids, _stats["sent"])

        _broadcast({"type": "stats", **_get_stats()})
        _stop_event.wait(random.uniform(cfg["min_interval"], cfg["max_interval"]))

    log.info("Stream stopped.")
    _broadcast({"type": "stopped", **_get_stats()})


def _batch_worker(cfg: dict) -> None:
    sqs = None
    if not cfg["dry_run"]:
        try:
            sqs = build_sqs_client(cfg["region"])
        except Exception as exc:
            log.error("SQS init failed: %s", exc)
            _broadcast({"type": "stopped", **_get_stats()})
            return

    count  = cfg["count"]
    target = cfg.get("target_account")
    fraud  = cfg["fraud_mode"]

    log.info("Batch started | count=%d fraud=%s dry_run=%s", count, fraud, cfg["dry_run"])
    msgs = [generate_transaction(target, fraud) for _ in range(count)]

    for start in range(0, len(msgs), 10):
        if _stop_event.is_set():
            break
        chunk = msgs[start:start + 10]

        if cfg["dry_run"]:
            log.info("[DRY-RUN] Chunk %d/%d", start + len(chunk), count)
            with _stats_lock:
                _stats["generated"] += len(chunk)
        else:
            sent, fail = send_batch(sqs, cfg["queue_url"], chunk)
            with _stats_lock:
                _stats["sent"]      += sent
                _stats["generated"] += len(chunk)
                _stats["failed"]    += fail
            log.info("Chunk %d/%d | sent=%d fail=%d", start + len(chunk), count, sent, fail)

        _broadcast({"type": "stats", **_get_stats()})

    with _stats_lock:
        s = _stats.copy()
    log.info("Batch complete | sent=%d generated=%d failed=%d",
             s["sent"], s["generated"], s["failed"])
    _broadcast({"type": "stopped", **_get_stats()})


# ── Routes ────────────────────────────────────────────────────────────────────

@app.context_processor
def _inject_globals():
    return {"environment": ENVIRONMENT}


@app.route("/")
def index():
    return render_template(
        "index.html",
        accounts=ACCOUNTS,
        version=GENERATOR_VERSION,
        default_queue=SQS_QUEUE_URL,
        default_region=DEFAULT_REGION,
    )


@app.route("/start", methods=["POST"])
def start():
    global _gen_thread, _stop_event

    if _running():
        return jsonify({"ok": False, "error": "Generator is already running"}), 409

    data    = request.get_json(force=True)
    acct_id = (data.get("account") or "").strip()
    target  = next((a for a in ACCOUNTS if a["accountId"] == acct_id), None)

    cfg = {
        "mode":           data.get("mode", "stream"),
        "queue_url":      (data.get("queue_url") or SQS_QUEUE_URL or "").strip(),
        "region":         (data.get("region")    or DEFAULT_REGION).strip(),
        "dry_run":        bool(data.get("dry_run",    False)),
        "fraud_mode":     bool(data.get("fraud_mode", False)),
        "target_account": target,
        "min_interval":   max(0.1, float(data.get("min_interval", MIN_INTERVAL))),
        "max_interval":   max(0.1, float(data.get("max_interval", MAX_INTERVAL))),
        "burst_min":      max(1,   int(data.get("burst_min", BURST_MIN))),
        "burst_max":      max(1,   int(data.get("burst_max", BURST_MAX))),
        "count":          max(1,   int(data.get("count", 20))),
    }

    if not cfg["dry_run"] and not cfg["queue_url"]:
        return jsonify({"ok": False, "error": "Queue URL is required (or enable Dry Run)"}), 400

    with _stats_lock:
        _stats.update(sent=0, failed=0, generated=0, start_ts=datetime.now())

    _stop_event = threading.Event()
    worker = _stream_worker if cfg["mode"] == "stream" else _batch_worker
    _gen_thread = threading.Thread(target=worker, args=(cfg,), daemon=True, name="generator")
    _gen_thread.start()

    _broadcast({"type": "started"})
    return jsonify({"ok": True})


@app.route("/stop", methods=["POST"])
def stop():
    if not _running():
        return jsonify({"ok": False, "error": "Generator is not running"}), 409
    log.info("Stop requested — finishing current burst…")
    _stop_event.set()
    return jsonify({"ok": True})


@app.route("/status")
def status():
    return jsonify(_get_stats())


@app.route("/stream")
def stream():
    def generate():
        q: queue.Queue = queue.Queue(maxsize=300)
        with _sub_lock:
            _subscribers.append(q)
        try:
            yield f"data: {json.dumps({'type': 'status', **_get_stats()})}\n\n"
            while True:
                try:
                    msg = q.get(timeout=20)
                    yield f"data: {json.dumps(msg)}\n\n"
                except queue.Empty:
                    yield 'data: {"type":"ping"}\n\n'
        finally:
            with _sub_lock:
                if q in _subscribers:
                    _subscribers.remove(q)

    resp = Response(generate(), mimetype="text/event-stream")
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["X-Accel-Buffering"] = "no"
    return resp


if __name__ == "__main__":
    port  = int(os.getenv("PORT", "5001"))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug, threaded=True)
