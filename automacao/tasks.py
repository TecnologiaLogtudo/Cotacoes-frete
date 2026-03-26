from __future__ import annotations

import traceback
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
from pathlib import Path

from celery import current_task

from automacao.celery_app import celery_app
from automacao.job_io import task_log_path
from automacao.steps.passo2_cotacoes import executar_passo_2_lote


@celery_app.task(name="automacao.processar_cotacoes_lote")
def processar_cotacoes_lote(
    usuario: str,
    senha: str,
    planilha_path: str,
    validade: str,
    data_referencia: str,
    max_rows_to_scan: int = 100,
    job_id: str | None = None,
) -> dict:
    task_id = current_task.request.id if current_task else "unknown"
    log_file = task_log_path(task_id)

    arquivo = Path(planilha_path)
    if not arquivo.exists():
        raise FileNotFoundError(f"Planilha nao encontrada: {planilha_path}")

    start_ts = datetime.now().isoformat(timespec="seconds")

    with log_file.open("a", encoding="utf-8", buffering=1) as log:
        print(f"[{start_ts}] Job iniciado | task_id={task_id} | job_id={job_id}", file=log)
        print(f"Planilha recebida: {arquivo}", file=log)
        print(f"Data referência: {data_referencia} | Validade: {validade}", file=log)

        try:
            with redirect_stdout(log), redirect_stderr(log):
                executar_passo_2_lote(
                    usuario=usuario,
                    senha=senha,
                    planilha_path=str(arquivo),
                    validade=validade,
                    data_referencia=data_referencia,
                    max_rows_to_scan=max_rows_to_scan,
                )

            end_ts = datetime.now().isoformat(timespec="seconds")
            print(f"[{end_ts}] Job concluído com sucesso.", file=log)

            return {
                "status": "completed",
                "task_id": task_id,
                "job_id": job_id,
                "planilha": str(arquivo),
                "validade": validade,
                "data_referencia": data_referencia,
                "log_file": str(log_file),
                "finished_at": end_ts,
            }
        except Exception as exc:
            end_ts = datetime.now().isoformat(timespec="seconds")
            print(f"[{end_ts}] ERRO no job: {exc}", file=log)
            print(traceback.format_exc(), file=log)
            raise
