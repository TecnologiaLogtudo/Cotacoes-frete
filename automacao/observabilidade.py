from __future__ import annotations

import hashlib
import os
import re
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
from automacao.queue import get_queue, get_redis_connection


VIDEO_EXTENSIONS = {".webm", ".mp4", ".mov", ".mkv"}
_ARTIFACT_PATH_BY_ID: dict[str, Path] = {}


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


def _collect_known_task_ids() -> list[str]:
    task_ids: set[str] = set()

    for file in jobs_dir().glob("*.log"):
        task_ids.add(file.stem)

    queue = get_queue()
    connection = get_redis_connection()
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
    try:
        job = Job.fetch(task_id, connection=get_redis_connection())
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

    return {
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
            items.append(
                {
                    "action_type": msg,
                    "actor": job_item.get("username"),
                    "ip": job_item.get("ip"),
                    "timestamp": _to_iso(line.timestamp),
                }
            )
    return items


def steps_for_job(task_id: str) -> list[dict[str, Any]]:
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
            items.append(
                {
                    "name": stage,
                    "status": status,
                    "started_at": _to_iso(line.timestamp or last_timestamp),
                    "ended_at": _to_iso(line.timestamp or last_timestamp) if status == "completed" else None,
                    "metadata": None,
                }
            )
            continue

        proc_match = re.search(r"Processando linha\s+(\d+)/(\d+).+Número\s+(.+)\)$", msg, flags=re.IGNORECASE)
        if proc_match:
            items.append(
                {
                    "name": "processamento_linha_planilha",
                    "status": "running",
                    "started_at": _to_iso(line.timestamp or last_timestamp),
                    "ended_at": None,
                    "metadata": {
                        "linha_atual": int(proc_match.group(1)),
                        "total_linhas": int(proc_match.group(2)),
                        "numero": proc_match.group(3),
                    },
                }
            )

    return items


def browser_logs_for_job(task_id: str) -> list[dict[str, Any]]:
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
            if file.suffix.lower() not in VIDEO_EXTENSIONS:
                continue
            if task_id not in file.name and task_id not in str(file.parent):
                continue

            stat = file.stat()
            artifact_id = _artifact_id(file)
            _ARTIFACT_PATH_BY_ID[artifact_id] = file
            items.append(
                {
                    "id": artifact_id,
                    "type": "video",
                    "file_path": str(file),
                    "available": True,
                    "created_at": _to_iso(datetime.fromtimestamp(stat.st_mtime)),
                }
            )

    items.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return items


def artifact_file_path(artifact_id: str) -> Path | None:
    cached = _ARTIFACT_PATH_BY_ID.get(artifact_id)
    if cached and cached.exists():
        return cached

    for source in _artifact_sources():
        for file in source.rglob("*"):
            if not file.is_file() or file.suffix.lower() not in VIDEO_EXTENSIONS:
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

    # limpa arquivos de logs e vídeos ligados à observabilidade
    for path in jobs_dir().glob("*.log"):
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass

    for source in _artifact_sources():
        for file in source.rglob("*"):
            if file.is_file() and file.suffix.lower() in VIDEO_EXTENSIONS:
                try:
                    file.unlink(missing_ok=True)
                except Exception:
                    pass

    # remove metadados de jobs do RQ para limpar histórico
    connection = get_redis_connection()
    queue = get_queue()
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
