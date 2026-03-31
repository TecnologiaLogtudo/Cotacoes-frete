from __future__ import annotations

import os
from typing import Any

from redis import Redis
from rq import Queue
from rq.exceptions import NoSuchJobError
from rq.job import Job

from automacao.tasks import processar_cotacoes_lote


QUEUE_NAME = os.getenv("RQ_QUEUE_NAME", "cotacoes")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
JOB_TIMEOUT_SECONDS = int(os.getenv("RQ_JOB_TIMEOUT_SECONDS", "7200"))
RESULT_TTL_SECONDS = int(os.getenv("RQ_RESULT_TTL_SECONDS", "86400"))


def get_redis_connection() -> Redis:
    return Redis.from_url(REDIS_URL)


def get_queue() -> Queue:
    return Queue(name=QUEUE_NAME, connection=get_redis_connection(), default_timeout=JOB_TIMEOUT_SECONDS)


def enqueue_cotacao_job(
    *,
    usuario: str,
    senha: str,
    planilha_path: str,
    validade: str,
    data_referencia: str,
    max_rows_to_scan: int = 100,
    job_id: str | None = None,
) -> Job:
    queue = get_queue()
    return queue.enqueue(
        processar_cotacoes_lote,
        usuario=usuario,
        senha=senha,
        planilha_path=planilha_path,
        validade=validade,
        data_referencia=data_referencia,
        max_rows_to_scan=max_rows_to_scan,
        job_id=job_id,
        job_timeout=JOB_TIMEOUT_SECONDS,
        result_ttl=RESULT_TTL_SECONDS,
    )


def fetch_job(task_id: str) -> Job | None:
    try:
        return Job.fetch(task_id, connection=get_redis_connection())
    except NoSuchJobError:
        return None


def map_rq_status(status: str | None) -> str:
    if status in {"queued", "deferred", "scheduled"}:
        return "PENDING"
    if status == "started":
        return "STARTED"
    if status == "finished":
        return "SUCCESS"
    if status in {"failed", "stopped", "canceled"}:
        return "FAILURE"
    return "PENDING"


def serialize_job_result(job: Job | None) -> dict[str, Any]:
    if not job:
        return {"status": "PENDING"}

    payload: dict[str, Any] = {"status": map_rq_status(job.get_status())}
    status = payload["status"]

    if status == "SUCCESS":
        payload["result"] = job.result
    elif status == "FAILURE":
        payload["error"] = job.exc_info or "Job finalizado com falha."

    return payload
