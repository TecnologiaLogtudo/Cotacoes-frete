from __future__ import annotations

import logging
import os
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from automacao.job_io import parse_progress_from_log, read_log_incremental, uploads_dir
from automacao.operacoes import listar_operacoes_disponiveis
from automacao.planilha import (
    _extrair_partes_data,
    _mapear_headers,
    _normalizar,
    _texto_celula,
    carregar_linhas_para_automacao,
)
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


@app.middleware("http")
async def rewrite_cotacoes_prefix(request: Request, call_next):
    path = request.scope.get("path", "")
    if path.startswith("/cotacoes/api/") or path == "/cotacoes/api":
        request.scope["path"] = path[len("/cotacoes") :]
    elif path.startswith("/cotacoes/health") or path == "/cotacoes/health":
        request.scope["path"] = path[len("/cotacoes") :]
    elif path.startswith("/cotacoes/manual-de-uso") or path == "/cotacoes/manual-de-uso":
        request.scope["path"] = path[len("/cotacoes") :]
    return await call_next(request)

WEB_DIST = Path(__file__).resolve().parent.parent / "web_dist"
if not WEB_DIST.exists():
    _local_dist = Path(__file__).resolve().parent.parent / "web" / "dist"
    if _local_dist.exists():
        WEB_DIST = _local_dist
MANUAL_HTML = Path(__file__).resolve().parent / "manual_de_uso.html"
UPLOAD_CHUNK_SIZE = 1024 * 1024  # 1 MB
MAX_XLSX_SIZE_BYTES = int(os.getenv("MAX_XLSX_SIZE_BYTES", str(100 * 1024 * 1024)))  # 100 MB


class ResetLogsPayload(BaseModel):
    password: str


class StartJobPayload(BaseModel):
    usuario: str
    senha: str
    data_referencia: str
    validade: str | None = None
    tipo_operacao: str = "D2D"
    headless: bool = True
    throttle_seconds: float = 2.5


def validar_planilha_previa(
    caminho: Path,
    data_referencia: str | None = None,
    tipo_operacao: str = "D2D",
) -> dict:
    from openpyxl import load_workbook

    wb = load_workbook(filename=str(caminho), data_only=True, read_only=True)
    ws = wb.active
    try:
        headers = _mapear_headers(ws, header_row=3)
        col_numero = headers.get(_normalizar("Número")) or headers.get(_normalizar("Numero"))
        col_nome = headers.get(_normalizar("Nome"), 1)
        col_placa = headers.get(_normalizar("Placa"), 2)
        col_perfil = headers.get(_normalizar("Perfil"))
        col_base = headers.get(_normalizar("Base"))

        row_errors: list[str] = []
        if not col_numero:
            row_errors.append("Coluna 'Número' não encontrada na linha 3.")
        if not col_perfil:
            row_errors.append("Coluna 'Perfil' não encontrada na linha 3.")
        if not col_base:
            row_errors.append("Coluna 'Base' não encontrada na linha 3.")

        available_dates: list[str] = []
        for col in range(1, ws.max_column + 1):
            val = ws.cell(row=3, column=col).value
            txt = _texto_celula(val)
            if txt and (_extrair_partes_data(val) or _extrair_partes_data(txt)):
                available_dates.append(txt)

        preview: list[dict] = []
        valid_rows_count = 0
        total_rows = 0

        if data_referencia and not row_errors:
            try:
                linhas = carregar_linhas_para_automacao(
                    str(caminho),
                    data_referencia=data_referencia,
                    max_rows_to_scan=100,
                    header_row=3,
                    tipo_operacao=tipo_operacao,
                )
                valid_rows_count = len(linhas)
                total_rows = len(linhas)
                for i, l in enumerate(linhas):
                    preview.append(
                        {
                            "id": f"item-{i+1}",
                            "row": l.excel_row,
                            "reference": l.numero,
                            "nome": l.nome_motorista,
                            "placa": l.placa,
                            "perfil": l.perfil,
                            "base": l.base,
                            "operacao": l.operacao,
                            "frete_negociado": l.frete_negociado,
                            "frete_valor": l.frete_valor,
                            "status": "PENDING",
                            "message": "Validado com sucesso",
                        }
                    )
            except Exception as exc:
                row_errors.append(str(exc))
        else:
            for row in ws.iter_rows(min_row=4, max_row=104, values_only=True):
                if row and any(row):
                    total_rows += 1
                    if len(preview) < 10 and col_numero and len(row) >= col_numero and row[col_numero - 1]:
                        num = _texto_celula(row[col_numero - 1])
                        nome = _texto_celula(row[col_nome - 1]) if col_nome and len(row) >= col_nome else ""
                        placa = _texto_celula(row[col_placa - 1]) if col_placa and len(row) >= col_placa else ""
                        preview.append(
                            {
                                "id": f"item-{len(preview)+1}",
                                "reference": num,
                                "nome": nome,
                                "placa": placa,
                                "status": "PENDING",
                                "message": "Linha detectada na planilha",
                            }
                        )
            valid_rows_count = total_rows if not row_errors else 0

        is_valid = len(row_errors) == 0 and total_rows > 0

        return {
            "is_valid": is_valid,
            "total_rows": total_rows,
            "valid_rows_count": valid_rows_count,
            "invalid_rows_count": 0 if is_valid else total_rows,
            "row_errors": row_errors,
            "preview": preview,
            "available_dates": available_dates,
        }
    finally:
        wb.close()


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/health/ready")
def health_ready() -> dict:
    return {"status": "ready"}


@app.get("/manual-de-uso", include_in_schema=False)
def manual_de_uso() -> FileResponse:
    if not MANUAL_HTML.exists():
        raise HTTPException(status_code=404, detail="Manual não encontrado")
    return FileResponse(MANUAL_HTML)


@app.get("/api/operacoes")
def get_operacoes() -> dict:
    return {"items": listar_operacoes_disponiveis()}


@app.post("/api/jobs/cotacoes")
async def create_cotacao_job(
    request: Request,
    usuario: str = Form(...),
    senha: str = Form(...),
    data_referencia: str = Form(...),
    validade: str = Form(...),
    tipo_operacao: str = Form("D2D"),
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
                        detail="Arquivo excede o limite permitido de 100 MB.",
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
        tipo_operacao=tipo_operacao,
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
        "Job enfileirado | job_id=%s | task_id=%s | operacao=%s | arquivo=%s | bytes=%d",
        job_id,
        task.id,
        tipo_operacao,
        safe_name,
        bytes_written,
    )

    return {
        "task_id": task.id,
        "job_id": job_id,
        "filename": safe_name,
        "tipo_operacao": tipo_operacao,
        "status": "PENDING",
    }


@app.post("/api/jobs/upload-and-validate")
async def upload_and_validate_job(
    request: Request,
    file: UploadFile | None = File(None),
    planilha: UploadFile | None = File(None),
    data_referencia: str | None = Form(None),
    tipo_operacao: str = Form("D2D"),
) -> dict:
    uploaded = file or planilha
    if not uploaded or not uploaded.filename:
        raise HTTPException(status_code=400, detail="Arquivo de planilha não informado.")

    suffix = Path(uploaded.filename).suffix.lower()
    if suffix != ".xlsx":
        raise HTTPException(status_code=400, detail="Apenas arquivos .xlsx são permitidos.")

    job_id = next_job_id()
    safe_name = Path(uploaded.filename).name
    target = uploads_dir() / f"{job_id}_{safe_name}"

    bytes_written = 0
    try:
        with target.open("wb") as output:
            while True:
                chunk = await uploaded.read(UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > MAX_XLSX_SIZE_BYTES:
                    output.close()
                    target.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail="Arquivo excede o limite permitido de 100 MB.",
                    )
                output.write(chunk)
    finally:
        await uploaded.close()

    if bytes_written == 0:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Arquivo enviado está vazio.")

    val_res = validar_planilha_previa(target, data_referencia=data_referencia, tipo_operacao=tipo_operacao)

    return {
        "job_id": job_id,
        "filename": safe_name,
        "is_valid": val_res["is_valid"],
        "total_rows": val_res["total_rows"],
        "valid_rows_count": val_res["valid_rows_count"],
        "invalid_rows_count": val_res["invalid_rows_count"],
        "row_errors": val_res["row_errors"],
        "preview": val_res["preview"],
        "available_dates": val_res.get("available_dates", []),
    }


@app.post("/api/jobs/{job_id}/start")
def start_uploaded_job(
    job_id: str,
    payload: StartJobPayload,
    request: Request,
) -> dict:
    matching = list(uploads_dir().glob(f"{job_id}_*"))
    if not matching:
        raise HTTPException(status_code=404, detail=f"Arquivo para o lote '{job_id}' não encontrado.")

    target = matching[0]
    safe_name = target.name.replace(f"{job_id}_", "", 1)

    task = enqueue_cotacao_job(
        usuario=payload.usuario,
        senha=payload.senha,
        planilha_path=str(target),
        validade=payload.validade or payload.data_referencia,
        data_referencia=payload.data_referencia,
        max_rows_to_scan=100,
        job_id=job_id,
        client_ip=request.client.host if request.client else None,
        tipo_operacao=payload.tipo_operacao,
    )
    register_job_enqueued(
        task.id,
        job_id=job_id,
        username=payload.usuario,
        ip=request.client.host if request.client else None,
    )
    try:
        task.meta["client_ip"] = request.client.host if request.client else None
        task.save_meta()
        register_job_ip(task.id, request.client.host if request.client else None)
    except Exception:
        logger.warning("Nao foi possivel salvar metadado de IP no job %s", task.id)

    return {
        "task_id": task.id,
        "job_id": job_id,
        "filename": safe_name,
        "tipo_operacao": payload.tipo_operacao,
        "status": "RUNNING",
    }


@app.get("/api/jobs")
def get_jobs_list(limit: int = 100, status: str | None = None) -> dict:
    items = list_jobs(status=status)
    if limit and len(items) > limit:
        items = items[:limit]
    return {"jobs": items}


@app.get("/api/jobs/{task_id}")
def get_job_status(task_id: str) -> dict:
    job = fetch_job(task_id)
    real_task_id = task_id
    if job is None:
        all_jobs = list_jobs()
        for j in all_jobs:
            if j.get("job_id") == task_id or j.get("id") == task_id:
                candidate = j.get("task_id") or j.get("id")
                if candidate:
                    real_task_id = candidate
                    job = fetch_job(candidate)
                    break

    progress = parse_progress_from_log(real_task_id)
    serialized = serialize_job_result(job)

    payload: dict = {
        "task_id": real_task_id,
        "job_id": task_id,
        "status": serialized["status"],
        "processed_lines": progress["processed_lines"],
        "total_lines": progress["total_lines"],
    }
    if progress["total_lines"] and progress["total_lines"] > 0:
        payload["percent"] = round(progress["processed_lines"] / progress["total_lines"], 2)
    else:
        payload["percent"] = 1.0 if serialized["status"] in ("SUCCESS", "COMPLETED") else 0.0

    if "result" in serialized:
        payload["result"] = serialized["result"]
    if "error" in serialized:
        payload["error"] = serialized["error"]

    return payload


@app.get("/api/jobs/{task_id}/logs")
def get_job_logs(task_id: str, cursor: int = 0) -> dict:
    real_task_id = task_id
    lines, next_cursor = read_log_incremental(task_id=real_task_id, cursor=cursor)
    if not lines:
        all_jobs = list_jobs()
        for j in all_jobs:
            if j.get("job_id") == task_id or j.get("id") == task_id:
                candidate = j.get("task_id") or j.get("id")
                if candidate and candidate != task_id:
                    lines, next_cursor = read_log_incremental(task_id=candidate, cursor=cursor)
                    real_task_id = candidate
                    break

    return {
        "task_id": real_task_id,
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

    # Suporte a requisições com prefixo /cotacoes/ em desenvolvimento local
    if full_path.startswith("cotacoes/"):
        stripped = full_path[len("cotacoes/"):]
        stripped_file = WEB_DIST / stripped
        if stripped_file.exists() and stripped_file.is_file():
            return FileResponse(stripped_file)

    index_file = WEB_DIST / "index.html"
    if index_file.exists():
        return FileResponse(index_file)

    raise HTTPException(status_code=404, detail="Frontend não encontrado")
