from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from rq.exceptions import NoSuchJobError
from rq.job import Job
from rq.registry import (
    DeferredJobRegistry,
    FailedJobRegistry,
    FinishedJobRegistry,
    ScheduledJobRegistry,
    StartedJobRegistry,
)

from automacao.job_io import jobs_dir, task_log_path, uploads_dir


ARTIFACT_TYPE_BY_EXTENSION = {
    ".webm": "video",
    ".mp4": "video",
    ".mov": "video",
    ".mkv": "video",
    ".png": "screenshot",
    ".jpg": "screenshot",
    ".jpeg": "screenshot",
}
_ARTIFACT_PATH_BY_ID: dict[str, Path] = {}
_DB_READY = False
logger = logging.getLogger(__name__)


@dataclass
class ParsedLogLine:
    timestamp: datetime | None
    message: str
    raw: str


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="seconds") if value else None


def _safe_duration_seconds(started_at: datetime | None, ended_at: datetime | None) -> int | None:
    if not started_at or not ended_at:
        return None
    diff = int((ended_at - started_at).total_seconds())
    return diff if diff >= 0 else 0


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _obs_db_path() -> Path:
    configured = os.getenv("OBS_DB_PATH", "").strip()
    path = Path(configured) if configured else Path("/app/data/observabilidade.sqlite3")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _db_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_obs_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_schema() -> None:
    global _DB_READY
    if _DB_READY:
        return

    schema = [
        """
        CREATE TABLE IF NOT EXISTS jobs (
            task_id TEXT PRIMARY KEY,
            job_id TEXT,
            username TEXT,
            ip TEXT,
            status TEXT,
            started_at TEXT,
            ended_at TEXT,
            duration_sec INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)",
        "CREATE INDEX IF NOT EXISTS idx_jobs_started_at ON jobs(started_at)",
        """
        CREATE TABLE IF NOT EXISTS log_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            event_key TEXT NOT NULL UNIQUE,
            timestamp TEXT,
            level TEXT,
            message TEXT,
            raw TEXT,
            created_at TEXT NOT NULL
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_log_events_task_ts ON log_events(task_id, timestamp)",
        """
        CREATE TABLE IF NOT EXISTS job_steps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            event_key TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT,
            ended_at TEXT,
            metadata_json TEXT,
            created_at TEXT NOT NULL
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_job_steps_task_ts ON job_steps(task_id, started_at)",
        """
        CREATE TABLE IF NOT EXISTS job_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            event_key TEXT NOT NULL UNIQUE,
            action_type TEXT NOT NULL,
            actor TEXT,
            ip TEXT,
            timestamp TEXT,
            created_at TEXT NOT NULL
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_job_actions_task_ts ON job_actions(task_id, timestamp)",
        """
        CREATE TABLE IF NOT EXISTS browser_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            event_key TEXT NOT NULL UNIQUE,
            level TEXT NOT NULL,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            url TEXT,
            timestamp TEXT,
            created_at TEXT NOT NULL
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_browser_logs_task_ts ON browser_logs(task_id, timestamp)",
        """
        CREATE TABLE IF NOT EXISTS artifacts (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            type TEXT NOT NULL,
            file_path TEXT NOT NULL,
            available INTEGER NOT NULL,
            created_at TEXT,
            updated_at TEXT NOT NULL
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_artifacts_task_created ON artifacts(task_id, created_at)",
        """
        CREATE TABLE IF NOT EXISTS job_id_sequence (
            date_key TEXT PRIMARY KEY,
            last_seq INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
    ]

    try:
        with _db_connect() as conn:
            for statement in schema:
                conn.execute(statement)
            conn.commit()
        _DB_READY = True
    except Exception:
        logger.exception("Falha ao inicializar schema SQLite de observabilidade")


def _event_key(*parts: Any) -> str:
    raw = "|".join(str(part or "") for part in parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _upsert_job(
    *,
    task_id: str,
    job_id: str | None = None,
    username: str | None = None,
    ip: str | None = None,
    status: str | None = None,
    started_at: str | None = None,
    ended_at: str | None = None,
    duration_sec: int | None = None,
) -> None:
    _ensure_schema()
    now = _now_iso()
    try:
        with _db_connect() as conn:
            conn.execute(
                """
                INSERT INTO jobs (
                    task_id, job_id, username, ip, status, started_at, ended_at, duration_sec, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    job_id=COALESCE(excluded.job_id, jobs.job_id),
                    username=COALESCE(excluded.username, jobs.username),
                    ip=COALESCE(excluded.ip, jobs.ip),
                    status=COALESCE(excluded.status, jobs.status),
                    started_at=COALESCE(excluded.started_at, jobs.started_at),
                    ended_at=COALESCE(excluded.ended_at, jobs.ended_at),
                    duration_sec=COALESCE(excluded.duration_sec, jobs.duration_sec),
                    updated_at=excluded.updated_at
                """,
                (
                    task_id,
                    job_id,
                    username,
                    ip,
                    status,
                    started_at,
                    ended_at,
                    duration_sec,
                    now,
                    now,
                ),
            )
            conn.commit()
    except Exception:
        logger.exception("Falha ao atualizar job no SQLite | task_id=%s", task_id)


def _get_job_field(task_id: str, field: str) -> str | None:
    _ensure_schema()
    if field not in {"job_id", "username", "ip", "status", "started_at", "ended_at"}:
        return None
    try:
        with _db_connect() as conn:
            row = conn.execute(f"SELECT {field} FROM jobs WHERE task_id = ?", (task_id,)).fetchone()
        return None if not row else row[field]
    except Exception:
        logger.exception("Falha ao ler campo de job no SQLite | task_id=%s", task_id)
        return None


def _insert_action(task_id: str, action_type: str, *, actor: str | None, ip: str | None, timestamp: str | None) -> None:
    _ensure_schema()
    ts = timestamp or _now_iso()
    key = _event_key(task_id, "action", ts, action_type)
    try:
        with _db_connect() as conn:
            conn.execute(
                """
                INSERT OR IGNORE INTO job_actions (task_id, event_key, action_type, actor, ip, timestamp, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (task_id, key, action_type, actor, ip, ts, _now_iso()),
            )
            conn.commit()
    except Exception:
        logger.exception("Falha ao inserir action no SQLite | task_id=%s", task_id)


def _insert_step(
    task_id: str,
    name: str,
    *,
    status: str,
    started_at: str | None,
    ended_at: str | None,
    metadata: dict[str, Any] | None = None,
) -> None:
    _ensure_schema()
    ts = started_at or ended_at or _now_iso()
    key = _event_key(task_id, "step", ts, name, status)
    metadata_json = json.dumps(metadata, ensure_ascii=False) if metadata else None
    try:
        with _db_connect() as conn:
            conn.execute(
                """
                INSERT OR IGNORE INTO job_steps (task_id, event_key, name, status, started_at, ended_at, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (task_id, key, name, status, started_at, ended_at, metadata_json, _now_iso()),
            )
            conn.commit()
    except Exception:
        logger.exception("Falha ao inserir step no SQLite | task_id=%s", task_id)


def _insert_browser_log(task_id: str, message: str, *, timestamp: str | None = None) -> None:
    norm = message.lower()
    if not any(key in norm for key in ["browser", "console", "request", "response", "pageerror", "network", "net::"]):
        return

    level = "info"
    if any(key in norm for key in ["error", "erro", "exception", "pageerror", "net::err"]):
        level = "error"
    elif any(key in norm for key in ["warn", "warning"]):
        level = "warning"

    extracted_url = None
    url_match = re.search(r"(https?://\S+)", message)
    if url_match:
        extracted_url = url_match.group(1).rstrip(".,;")

    _ensure_schema()
    ts = timestamp or _now_iso()
    key = _event_key(task_id, "browser", ts, message)
    try:
        with _db_connect() as conn:
            conn.execute(
                """
                INSERT OR IGNORE INTO browser_logs (task_id, event_key, level, type, message, url, timestamp, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (task_id, key, level, "browser", message, extracted_url, ts, _now_iso()),
            )
            conn.commit()
    except Exception:
        logger.exception("Falha ao inserir browser_log no SQLite | task_id=%s", task_id)


def register_job_enqueued(task_id: str, *, job_id: str | None, username: str | None, ip: str | None) -> None:
    _upsert_job(task_id=task_id, job_id=job_id, username=username, ip=ip, status="running", started_at=_now_iso())


def register_job_started(
    task_id: str,
    *,
    job_id: str | None,
    username: str | None,
    ip: str | None = None,
    started_at: str | None = None,
) -> None:
    ts = started_at or _now_iso()
    _upsert_job(task_id=task_id, job_id=job_id, username=username, ip=ip, status="running", started_at=ts)
    _insert_action(task_id, "Job iniciado", actor=username, ip=ip, timestamp=ts)


def register_job_stage(
    task_id: str,
    stage_name: str,
    *,
    timestamp: str | None = None,
    duration_s: float | None = None,
) -> None:
    ts = timestamp or _now_iso()
    status = "completed" if stage_name.startswith("fim_") or stage_name.endswith("_executado") else "running"
    metadata = {"duration_s": round(duration_s, 3)} if duration_s is not None else None
    _insert_step(
        task_id,
        stage_name,
        status=status,
        started_at=ts,
        ended_at=ts if status == "completed" else None,
        metadata=metadata,
    )


def register_job_message(
    task_id: str,
    message: str,
    *,
    timestamp: str | None = None,
    username: str | None = None,
    ip: str | None = None,
) -> None:
    _ensure_schema()
    ts = timestamp or _now_iso()
    key = _event_key(task_id, "log", ts, message)
    try:
        with _db_connect() as conn:
            conn.execute(
                """
                INSERT OR IGNORE INTO log_events (task_id, event_key, timestamp, level, message, raw, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (task_id, key, ts, "info", message, message, _now_iso()),
            )
            conn.commit()
    except Exception:
        logger.exception("Falha ao inserir log_event no SQLite | task_id=%s", task_id)

    norm = message.lower()
    if any(
        key in norm
        for key in [
            "job iniciado",
            "inicio_execucao_playwright",
            "fim_execucao_playwright",
            "job conclu",
            "erro no job",
            "[usuario]",
        ]
    ):
        _insert_action(task_id, message, actor=username, ip=ip, timestamp=ts)

    _insert_browser_log(task_id, message, timestamp=ts)


def register_job_completed(task_id: str, *, ended_at: str | None = None) -> None:
    ended = ended_at or _now_iso()
    started = _parse_dt(_get_job_field(task_id, "started_at"))
    duration = _safe_duration_seconds(started, _parse_dt(ended))
    _upsert_job(task_id=task_id, status="completed", ended_at=ended, duration_sec=duration)


def register_job_failed(task_id: str, *, ended_at: str | None = None, user_error: str | None = None) -> None:
    ended = ended_at or _now_iso()
    started = _parse_dt(_get_job_field(task_id, "started_at"))
    duration = _safe_duration_seconds(started, _parse_dt(ended))
    _upsert_job(task_id=task_id, status="error", ended_at=ended, duration_sec=duration)
    _insert_action(task_id, "ERRO no job.", actor=_get_job_field(task_id, "username"), ip=_get_job_field(task_id, "ip"), timestamp=ended)
    if user_error:
        _insert_action(
            task_id,
            f"[usuario] {user_error}",
            actor=_get_job_field(task_id, "username"),
            ip=_get_job_field(task_id, "ip"),
            timestamp=ended,
        )


def register_job_ip(task_id: str, ip: str | None) -> None:
    if ip:
        _upsert_job(task_id=task_id, ip=ip)


def _admin_status_from_job(job: Job | None, log_lines: list[ParsedLogLine]) -> str:
    if job:
        raw = job.get_status()
        if raw in {"finished"}:
            return "completed"
        if raw in {"failed"}:
            return "error"
        if raw in {"stopped", "canceled"}:
            return "stopped"
        if raw in {"queued", "deferred", "scheduled", "started"}:
            return "running"

    messages = [line.message.lower() for line in log_lines]
    if any("erro no job" in message for message in messages):
        return "error"
    if any("job concluído com sucesso" in message or "job concluido com sucesso" in message for message in messages):
        return "completed"
    if messages:
        return "running"
    return "running"


def _job_datetime_from_log(log_lines: list[ParsedLogLine]) -> tuple[datetime | None, datetime | None]:
    timestamps = [line.timestamp for line in log_lines if line.timestamp]
    if not timestamps:
        return None, None
    return timestamps[0], timestamps[-1]


def _parse_log_lines(task_id: str) -> list[ParsedLogLine]:
    path = task_log_path(task_id)
    if not path.exists():
        return []

    out: list[ParsedLogLine] = []
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for raw in handle:
            line = raw.rstrip("\n")
            m = re.match(r"^\[(?P<ts>[^\]]+)\]\s*(?P<msg>.*)$", line)
            if m:
                ts = _parse_dt(m.group("ts"))
                out.append(ParsedLogLine(timestamp=ts, message=m.group("msg").strip(), raw=line))
            else:
                out.append(ParsedLogLine(timestamp=None, message=line.strip(), raw=line))
    return out


def _queue_handles():
    # Import tardio para evitar ciclo: observabilidade -> queue -> tasks -> observabilidade
    from automacao.queue import get_queue, get_redis_connection

    return get_queue(), get_redis_connection()


def next_job_id() -> str:
    _ensure_schema()
    date_key = datetime.now().strftime("%d%m%Y")
    now = _now_iso()

    try:
        with _db_connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT last_seq FROM job_id_sequence WHERE date_key = ?",
                (date_key,),
            ).fetchone()
            next_seq = (int(row["last_seq"]) + 1) if row else 1
            conn.execute(
                """
                INSERT INTO job_id_sequence (date_key, last_seq, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(date_key) DO UPDATE SET
                    last_seq=excluded.last_seq,
                    updated_at=excluded.updated_at
                """,
                (date_key, next_seq, now),
            )
            conn.commit()
        return f"{date_key}-{next_seq:04d}"
    except Exception:
        logger.exception("Falha ao gerar job_id sequencial")
        return f"{date_key}-0000"


def _collect_known_task_ids() -> list[str]:
    task_ids: set[str] = set()

    _ensure_schema()
    try:
        with _db_connect() as conn:
            rows = conn.execute("SELECT task_id FROM jobs").fetchall()
        for row in rows:
            task_ids.add(str(row["task_id"]))
    except Exception:
        logger.exception("Falha ao coletar task_ids no SQLite")

    for file in jobs_dir().glob("*.log"):
        task_ids.add(file.stem)

    queue, connection = _queue_handles()
    registries = [
        queue,
        StartedJobRegistry(queue=queue),
        FinishedJobRegistry(queue=queue),
        FailedJobRegistry(queue=queue),
        DeferredJobRegistry(queue=queue),
        ScheduledJobRegistry(queue=queue),
    ]
    for registry in registries:
        try:
            ids = registry.get_job_ids()  # type: ignore[attr-defined]
        except Exception:
            ids = []
        for job_id in ids:
            task_ids.add(job_id)

    # fallback para jobs com metadados em redis fora das registries
    try:
        for key in connection.scan_iter(match="rq:job:*"):
            key_text = key.decode() if isinstance(key, bytes) else str(key)
            task_id = key_text.rsplit(":", 1)[-1]
            if task_id:
                task_ids.add(task_id)
    except Exception:
        pass

    return sorted(task_ids)


def _build_job_item(task_id: str) -> dict[str, Any]:
    _ensure_schema()
    try:
        with _db_connect() as conn:
            row = conn.execute(
                "SELECT task_id, job_id, status, username, ip, started_at, ended_at, duration_sec FROM jobs WHERE task_id = ?",
                (task_id,),
            ).fetchone()
        if row:
            return {
                "id": row["task_id"],
                "task_id": row["task_id"],
                "job_id": row["job_id"],
                "status": row["status"] or "running",
                "username": row["username"],
                "ip": row["ip"],
                "started_at": row["started_at"],
                "ended_at": row["ended_at"],
                "duration_sec": row["duration_sec"],
            }
    except Exception:
        logger.exception("Falha ao carregar job do SQLite | task_id=%s", task_id)

    try:
        _, connection = _queue_handles()
        job = Job.fetch(task_id, connection=connection)
    except NoSuchJobError:
        job = None

    log_lines = _parse_log_lines(task_id)
    log_started_at, log_ended_at = _job_datetime_from_log(log_lines)

    username = None
    ip = None
    started_at = None
    ended_at = None
    rq_job_id = None

    if job:
        username = job.kwargs.get("usuario")
        rq_job_id = job.kwargs.get("job_id")
        ip = job.meta.get("client_ip")
        started_at = _parse_dt(job.started_at) or _parse_dt(job.enqueued_at)
        ended_at = _parse_dt(job.ended_at)

    if not started_at:
        started_at = log_started_at
    if not ended_at:
        ended_at = log_ended_at

    duration_sec = _safe_duration_seconds(started_at, ended_at)
    status = _admin_status_from_job(job, log_lines)

    item = {
        "id": task_id,
        "task_id": task_id,
        "job_id": rq_job_id,
        "status": status,
        "username": username,
        "ip": ip,
        "started_at": _to_iso(started_at),
        "ended_at": _to_iso(ended_at),
        "duration_sec": duration_sec,
    }
    _upsert_job(
        task_id=task_id,
        job_id=rq_job_id,
        username=username,
        ip=ip,
        status=status,
        started_at=item["started_at"],
        ended_at=item["ended_at"],
        duration_sec=duration_sec,
    )
    return item


def list_jobs(status: str | None = None) -> list[dict[str, Any]]:
    items = [_build_job_item(task_id) for task_id in _collect_known_task_ids()]

    if status:
        normalized = status.strip().lower()
        items = [item for item in items if item.get("status") == normalized]

    def sort_key(item: dict[str, Any]) -> tuple[int, str]:
        started_at = item.get("started_at")
        if started_at:
            return (1, str(started_at))
        return (0, item["id"])

    items.sort(key=sort_key, reverse=True)
    return items


def summary() -> dict[str, int]:
    jobs = list_jobs()
    return {
        "total_jobs": len(jobs),
        "success_jobs": sum(1 for item in jobs if item.get("status") == "completed"),
        "error_jobs": sum(1 for item in jobs if item.get("status") == "error"),
        "running_jobs": sum(1 for item in jobs if item.get("status") == "running"),
    }


def actions_for_job(task_id: str) -> list[dict[str, Any]]:
    _ensure_schema()
    try:
        with _db_connect() as conn:
            rows = conn.execute(
                """
                SELECT action_type, actor, ip, timestamp
                FROM job_actions
                WHERE task_id = ?
                ORDER BY COALESCE(timestamp, created_at) ASC
                """,
                (task_id,),
            ).fetchall()
        if rows:
            return [
                {
                    "action_type": row["action_type"],
                    "actor": row["actor"],
                    "ip": row["ip"],
                    "timestamp": row["timestamp"],
                }
                for row in rows
            ]
    except Exception:
        logger.exception("Falha ao carregar actions do SQLite | task_id=%s", task_id)

    job_item = _build_job_item(task_id)
    lines = _parse_log_lines(task_id)
    items: list[dict[str, Any]] = []
    for line in lines:
        msg = line.message
        norm = msg.lower()
        if any(
            key in norm
            for key in [
                "job iniciado",
                "inicio_execucao_playwright",
                "fim_execucao_playwright",
                "job conclu",
                "erro no job",
                "[usuario]",
            ]
        ):
            ts = _to_iso(line.timestamp)
            _insert_action(task_id, msg, actor=job_item.get("username"), ip=job_item.get("ip"), timestamp=ts)
            items.append(
                {
                    "action_type": msg,
                    "actor": job_item.get("username"),
                    "ip": job_item.get("ip"),
                    "timestamp": ts,
                }
            )
    return items


def steps_for_job(task_id: str) -> list[dict[str, Any]]:
    _ensure_schema()
    try:
        with _db_connect() as conn:
            rows = conn.execute(
                """
                SELECT name, status, started_at, ended_at, metadata_json
                FROM job_steps
                WHERE task_id = ?
                ORDER BY COALESCE(started_at, created_at) ASC
                """,
                (task_id,),
            ).fetchall()
        if rows:
            items_from_db: list[dict[str, Any]] = []
            for row in rows:
                metadata = None
                if row["metadata_json"]:
                    try:
                        metadata = json.loads(row["metadata_json"])
                    except Exception:
                        metadata = None
                items_from_db.append(
                    {
                        "name": row["name"],
                        "status": row["status"],
                        "started_at": row["started_at"],
                        "ended_at": row["ended_at"],
                        "metadata": metadata,
                    }
                )
            return items_from_db
    except Exception:
        logger.exception("Falha ao carregar steps do SQLite | task_id=%s", task_id)

    lines = _parse_log_lines(task_id)
    items: list[dict[str, Any]] = []
    last_timestamp: datetime | None = None

    for line in lines:
        if line.timestamp:
            last_timestamp = line.timestamp

        msg = line.message
        stage_match = re.match(r"^\[stage\]\s*(.+)$", msg)
        if stage_match:
            stage = stage_match.group(1).strip()
            status = "completed" if stage.startswith("fim_") or stage.endswith("_executado") else "running"
            ts = _to_iso(line.timestamp or last_timestamp)
            _insert_step(task_id, stage, status=status, started_at=ts, ended_at=ts if status == "completed" else None)
            items.append(
                {
                    "name": stage,
                    "status": status,
                    "started_at": ts,
                    "ended_at": ts if status == "completed" else None,
                    "metadata": None,
                }
            )
            continue

        proc_match = re.search(r"Processando linha\s+(\d+)/(\d+).+Número\s+(.+)\)$", msg, flags=re.IGNORECASE)
        if proc_match:
            ts = _to_iso(line.timestamp or last_timestamp)
            metadata = {
                "linha_atual": int(proc_match.group(1)),
                "total_linhas": int(proc_match.group(2)),
                "numero": proc_match.group(3),
            }
            _insert_step(
                task_id,
                "processamento_linha_planilha",
                status="running",
                started_at=ts,
                ended_at=None,
                metadata=metadata,
            )
            items.append(
                {
                    "name": "processamento_linha_planilha",
                    "status": "running",
                    "started_at": ts,
                    "ended_at": None,
                    "metadata": metadata,
                }
            )

    return items


def browser_logs_for_job(task_id: str) -> list[dict[str, Any]]:
    _ensure_schema()
    try:
        with _db_connect() as conn:
            rows = conn.execute(
                """
                SELECT level, type, message, url, timestamp
                FROM browser_logs
                WHERE task_id = ?
                ORDER BY COALESCE(timestamp, created_at) ASC
                """,
                (task_id,),
            ).fetchall()
        if rows:
            return [
                {
                    "level": row["level"],
                    "type": row["type"],
                    "message": row["message"],
                    "url": row["url"],
                    "timestamp": row["timestamp"],
                }
                for row in rows
            ]
    except Exception:
        logger.exception("Falha ao carregar browser_logs do SQLite | task_id=%s", task_id)

    lines = _parse_log_lines(task_id)
    items: list[dict[str, Any]] = []
    for line in lines:
        msg = line.message
        norm = msg.lower()
        if not any(
            key in norm
            for key in ["browser", "console", "request", "response", "pageerror", "network", "net::"]
        ):
            continue

        level = "info"
        if any(key in norm for key in ["error", "erro", "exception", "pageerror", "net::err"]):
            level = "error"
        elif any(key in norm for key in ["warn", "warning"]):
            level = "warning"

        extracted_url = None
        url_match = re.search(r"(https?://\S+)", msg)
        if url_match:
            extracted_url = url_match.group(1).rstrip(".,;")

        _insert_browser_log(task_id, msg, timestamp=_to_iso(line.timestamp))
        items.append(
            {
                "level": level,
                "type": "browser",
                "message": msg,
                "url": extracted_url,
                "timestamp": _to_iso(line.timestamp),
            }
        )
    return items


def _artifact_sources() -> list[Path]:
    candidates = [
        jobs_dir(),
        jobs_dir() / "artifacts",
        uploads_dir(),
        Path("/app/data/artifacts"),
        Path("/app/data/videos"),
    ]
    return [path for path in candidates if path.exists() and path.is_dir()]


def _artifact_id(path: Path) -> str:
    digest = hashlib.sha1(str(path).encode("utf-8")).hexdigest()
    return digest[:16]


def artifacts_for_job(task_id: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    _ARTIFACT_PATH_BY_ID.clear()

    for source in _artifact_sources():
        for file in source.rglob("*"):
            if not file.is_file():
                continue
            artifact_type = ARTIFACT_TYPE_BY_EXTENSION.get(file.suffix.lower())
            if not artifact_type:
                continue
            if task_id not in file.name and task_id not in str(file.parent):
                continue

            stat = file.stat()
            artifact_id = _artifact_id(file)
            _ARTIFACT_PATH_BY_ID[artifact_id] = file
            _ensure_schema()
            try:
                with _db_connect() as conn:
                    conn.execute(
                        """
                        INSERT INTO artifacts (id, task_id, type, file_path, available, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            task_id=excluded.task_id,
                            type=excluded.type,
                            file_path=excluded.file_path,
                            available=excluded.available,
                            created_at=COALESCE(excluded.created_at, artifacts.created_at),
                            updated_at=excluded.updated_at
                        """,
                        (
                            artifact_id,
                            task_id,
                            artifact_type,
                            str(file),
                            1,
                            _to_iso(datetime.fromtimestamp(stat.st_mtime)),
                            _now_iso(),
                        ),
                    )
                    conn.commit()
            except Exception:
                logger.exception("Falha ao atualizar artifact no SQLite | artifact_id=%s", artifact_id)
            items.append(
                {
                    "id": artifact_id,
                    "type": artifact_type,
                    "file_path": str(file),
                    "available": True,
                    "created_at": _to_iso(datetime.fromtimestamp(stat.st_mtime)),
                }
            )

    _ensure_schema()
    try:
        with _db_connect() as conn:
            rows = conn.execute(
                """
                SELECT id, type, file_path, available, created_at
                FROM artifacts
                WHERE task_id = ?
                ORDER BY COALESCE(created_at, updated_at) DESC
                """,
                (task_id,),
            ).fetchall()
        if rows:
            return [
                {
                    "id": row["id"],
                    "type": row["type"],
                    "file_path": row["file_path"],
                    "available": bool(row["available"]),
                    "created_at": row["created_at"],
                }
                for row in rows
            ]
    except Exception:
        logger.exception("Falha ao carregar artifacts do SQLite | task_id=%s", task_id)

    items.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return items


def artifact_file_path(artifact_id: str) -> Path | None:
    cached = _ARTIFACT_PATH_BY_ID.get(artifact_id)
    if cached and cached.exists():
        return cached

    _ensure_schema()
    try:
        with _db_connect() as conn:
            row = conn.execute("SELECT file_path FROM artifacts WHERE id = ?", (artifact_id,)).fetchone()
        if row:
            path = Path(row["file_path"])
            if path.exists():
                _ARTIFACT_PATH_BY_ID[artifact_id] = path
                return path
    except Exception:
        logger.exception("Falha ao buscar artifact no SQLite | artifact_id=%s", artifact_id)

    for source in _artifact_sources():
        for file in source.rglob("*"):
            if not file.is_file() or file.suffix.lower() not in ARTIFACT_TYPE_BY_EXTENSION:
                continue
            if _artifact_id(file) == artifact_id:
                _ARTIFACT_PATH_BY_ID[artifact_id] = file
                return file
    return None


def reset_logs(password: str) -> None:
    expected = os.getenv("ADMIN_RESET_PASSWORD", "").strip()
    if not expected:
        raise PermissionError("Senha de reset não configurada no servidor (ADMIN_RESET_PASSWORD).")
    if password.strip() != expected:
        raise ValueError("Senha inválida para reset de logs.")

    _ensure_schema()
    try:
        with _db_connect() as conn:
            for table in ["jobs", "log_events", "job_steps", "job_actions", "browser_logs", "artifacts"]:
                conn.execute(f"DELETE FROM {table}")
            conn.commit()
    except Exception:
        logger.exception("Falha ao limpar tabelas SQLite de observabilidade")

    # limpa arquivos de logs e artefatos ligados à observabilidade
    for path in jobs_dir().glob("*.log"):
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass

    for source in _artifact_sources():
        for file in source.rglob("*"):
            if file.is_file() and file.suffix.lower() in ARTIFACT_TYPE_BY_EXTENSION:
                try:
                    file.unlink(missing_ok=True)
                except Exception:
                    pass

    # remove metadados de jobs do RQ para limpar histórico
    queue, connection = _queue_handles()
    registries = [
        queue,
        StartedJobRegistry(queue=queue),
        FinishedJobRegistry(queue=queue),
        FailedJobRegistry(queue=queue),
        DeferredJobRegistry(queue=queue),
        ScheduledJobRegistry(queue=queue),
    ]
    known_ids: set[str] = set()
    for registry in registries:
        try:
            ids = registry.get_job_ids()  # type: ignore[attr-defined]
        except Exception:
            ids = []
        for job_id in ids:
            known_ids.add(job_id)

    for key in connection.scan_iter(match="rq:job:*"):
        key_text = key.decode() if isinstance(key, bytes) else str(key)
        known_ids.add(key_text.rsplit(":", 1)[-1])

    for job_id in known_ids:
        try:
            job = Job.fetch(job_id, connection=connection)
        except NoSuchJobError:
            continue
        try:
            job.delete()
        except Exception:
            pass
