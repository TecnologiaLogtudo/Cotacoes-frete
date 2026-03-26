from __future__ import annotations

import uuid
from pathlib import Path

from celery.result import AsyncResult
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from automacao.celery_app import celery_app
from automacao.job_io import parse_progress_from_log, read_log_incremental, uploads_dir
from automacao.tasks import processar_cotacoes_lote


app = FastAPI(title="Logtudo Cotacoes API", version="1.0.0")

WEB_DIST = Path(__file__).resolve().parent.parent / "web_dist"
MANUAL_HTML = Path(__file__).resolve().parent / "manual_de_uso.html"


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
    usuario: str = Form(...),
    senha: str = Form(...),
    data_referencia: str = Form(...),
    validade: str = Form(...),
    planilha: UploadFile = File(...),
) -> dict:
    if not planilha.filename:
        raise HTTPException(status_code=400, detail="Arquivo de planilha não informado.")

    suffix = Path(planilha.filename).suffix.lower()
    if suffix != ".xlsx":
        raise HTTPException(status_code=400, detail="Apenas arquivos .xlsx são permitidos.")

    job_id = uuid.uuid4().hex
    safe_name = Path(planilha.filename).name
    target = uploads_dir() / f"{job_id}_{safe_name}"

    content = await planilha.read()
    if not content:
        raise HTTPException(status_code=400, detail="Arquivo enviado está vazio.")

    target.write_bytes(content)

    task = processar_cotacoes_lote.delay(
        usuario=usuario,
        senha=senha,
        planilha_path=str(target),
        validade=validade,
        data_referencia=data_referencia,
        max_rows_to_scan=100,
        job_id=job_id,
    )

    return {
        "task_id": task.id,
        "job_id": job_id,
        "filename": safe_name,
        "status": "PENDING",
    }


@app.get("/api/jobs/{task_id}")
def get_job_status(task_id: str) -> dict:
    result = AsyncResult(task_id, app=celery_app)
    progress = parse_progress_from_log(task_id)

    payload: dict = {
        "task_id": task_id,
        "status": result.status,
        "processed_lines": progress["processed_lines"],
        "total_lines": progress["total_lines"],
    }

    if result.ready():
        if result.successful():
            payload["result"] = result.result
        else:
            payload["error"] = str(result.result)

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


@app.get("/", include_in_schema=False)
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
