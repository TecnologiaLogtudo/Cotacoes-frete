from __future__ import annotations

import logging
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from automacao.job_io import parse_progress_from_log, read_log_incremental, uploads_dir
from automacao.observabilidade import (
    actions_for_job,
    artifact_file_path,
    artifacts_for_job,
    browser_logs_for_job,
    list_jobs,
    next_job_id,
    register_job_enqueued,
    register_job_ip,
    reset_logs,
    steps_for_job,
    summary,
)
from automacao.queue import enqueue_cotacao_job, fetch_job, serialize_job_result


app = FastAPI(title="Logtudo Cotacoes API", version="1.0.0")
logger = logging.getLogger(__name__)

WEB_DIST = Path(__file__).resolve().parent.parent / "web_dist"
MANUAL_HTML = Path(__file__).resolve().parent / "manual_de_uso.html"
UPLOAD_CHUNK_SIZE = 1024 * 1024  # 1 MB
MAX_XLSX_SIZE_BYTES = 20 * 1024 * 1024  # 20 MB


class ResetLogsPayload(BaseModel):
    password: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/manual-de-uso", include_in_schema=False)
def manual_de_uso() -> FileResponse:
    if not MANUAL_HTML.exists():
        raise HTTPException(status_code=404, detail="Manual não encontrado")
    return FileResponse(MANUAL_HTML)


@app.post("/api/jobs/cotacoes")
async def create_cotacao_job(
    request: Request,
    usuario: str = Form(...),
    senha: str = Form(...),
    data_referencia: str = Form(...),
    validade: str = Form(...),
    planilha: UploadFile = File(...),
) -> dict:
    started_at = time.perf_counter()
    if not planilha.filename:
        raise HTTPException(status_code=400, detail="Arquivo de planilha não informado.")

    suffix = Path(planilha.filename).suffix.lower()
    if suffix != ".xlsx":
        raise HTTPException(status_code=400, detail="Apenas arquivos .xlsx são permitidos.")

    job_id = next_job_id()
    safe_name = Path(planilha.filename).name
    target = uploads_dir() / f"{job_id}_{safe_name}"
    bytes_written = 0
    chunk_count = 0
    logger.info("Iniciando upload em chunks | job_id=%s | arquivo=%s", job_id, safe_name)

    try:
        with target.open("wb") as output:
            while True:
                chunk = await planilha.read(UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break

                bytes_written += len(chunk)
                if bytes_written > MAX_XLSX_SIZE_BYTES:
                    output.close()
                    target.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail="Arquivo excede o limite permitido de 20 MB.",
                    )

                output.write(chunk)
                chunk_count += 1
    finally:
        await planilha.close()

    if bytes_written == 0:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Arquivo enviado está vazio.")

    upload_elapsed = time.perf_counter() - started_at
    logger.info(
        "Upload concluido | job_id=%s | arquivo=%s | bytes=%d | chunks=%d | tempo_upload_s=%.3f",
        job_id,
        safe_name,
        bytes_written,
        chunk_count,
        upload_elapsed,
    )

    task = enqueue_cotacao_job(
        usuario=usuario,
        senha=senha,
        planilha_path=str(target),
        validade=validade,
        data_referencia=data_referencia,
        max_rows_to_scan=100,
        job_id=job_id,
        client_ip=request.client.host if request.client else None,
    )
    register_job_enqueued(
        task.id,
        job_id=job_id,
        username=usuario,
        ip=request.client.host if request.client else None,
    )
    try:
        task.meta["client_ip"] = request.client.host if request.client else None
        task.save_meta()
        register_job_ip(task.id, request.client.host if request.client else None)
    except Exception:
        logger.warning("Nao foi possivel salvar metadado de IP no job %s", task.id)

    logger.info(
        "Job enfileirado | job_id=%s | task_id=%s | arquivo=%s | bytes=%d",
        job_id,
        task.id,
        safe_name,
        bytes_written,
    )

    return {
        "task_id": task.id,
        "job_id": job_id,
        "filename": safe_name,
        "status": "PENDING",
    }


@app.get("/api/jobs/{task_id}")
def get_job_status(task_id: str) -> dict:
    job = fetch_job(task_id)
    progress = parse_progress_from_log(task_id)
    serialized = serialize_job_result(job)

    payload: dict = {
        "task_id": task_id,
        "status": serialized["status"],
        "processed_lines": progress["processed_lines"],
        "total_lines": progress["total_lines"],
    }

    if "result" in serialized:
        payload["result"] = serialized["result"]
    if "error" in serialized:
        payload["error"] = serialized["error"]

    return payload


@app.get("/api/jobs/{task_id}/logs")
def get_job_logs(task_id: str, cursor: int = 0) -> dict:
    lines, next_cursor = read_log_incremental(task_id=task_id, cursor=cursor)
    return {
        "task_id": task_id,
        "cursor": cursor,
        "next_cursor": next_cursor,
        "lines": lines,
    }


@app.get("/api/admin/summary")
def get_admin_summary() -> dict:
    return summary()


@app.get("/api/admin/jobs")
def get_admin_jobs(status: str | None = None) -> dict:
    return {"items": list_jobs(status=status)}


@app.get("/api/admin/jobs/{job_id}/actions")
def get_admin_job_actions(job_id: str) -> dict:
    return {"items": actions_for_job(job_id)}


@app.get("/api/admin/jobs/{job_id}/steps")
def get_admin_job_steps(job_id: str) -> dict:
    return {"items": steps_for_job(job_id)}


@app.get("/api/admin/jobs/{job_id}/artifacts")
def get_admin_job_artifacts(job_id: str) -> dict:
    return {"items": artifacts_for_job(job_id)}


@app.get("/api/admin/jobs/{job_id}/browser-logs")
def get_admin_job_browser_logs(job_id: str) -> dict:
    return {"items": browser_logs_for_job(job_id)}


@app.get("/api/admin/artifacts/{artifact_id}/file")
def get_admin_artifact_file(artifact_id: str) -> FileResponse:
    file_path = artifact_file_path(artifact_id)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail="Arquivo de artefato não encontrado.")
    return FileResponse(file_path)


@app.post("/api/admin/reset-logs")
def post_admin_reset_logs(payload: ResetLogsPayload) -> dict:
    try:
        reset_logs(payload.password)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    return {"ok": True}


@app.get("/", include_in_schema=False, response_model=None)
def index() -> JSONResponse | FileResponse:
    index_file = WEB_DIST / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return JSONResponse(
        status_code=200,
        content={
            "message": "Frontend não buildado ainda. Rode o build do Vite no Docker image."
        },
    )


@app.get("/{full_path:path}", include_in_schema=False)
def spa_or_asset(full_path: str):
    if full_path.startswith("api") or full_path in {"health", "manual-de-uso"}:
        raise HTTPException(status_code=404, detail="Not found")

    file_path = WEB_DIST / full_path
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)

    index_file = WEB_DIST / "index.html"
    if index_file.exists():
        return FileResponse(index_file)

    raise HTTPException(status_code=404, detail="Frontend não encontrado")
