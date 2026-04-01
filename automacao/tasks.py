from __future__ import annotations

import gc
import re
import traceback
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
from pathlib import Path
from time import perf_counter

from rq import get_current_job

from automacao.job_io import task_log_path
from automacao.observabilidade import (
    register_job_completed,
    register_job_failed,
    register_job_message,
    register_job_stage,
    register_job_started,
)
from automacao.steps.passo2_cotacoes import executar_passo_2_lote


def _mensagem_erro_usuario(exc: Exception, data_referencia: str) -> str:
    mensagem = str(exc).strip() or "Falha inesperada durante a automacao."
    mensagem_norm = mensagem.lower()

    if re.search(r"cabecalho ['\"]base['\"] nao encontrado na linha 3", mensagem_norm):
        return (
            "Nao foi possivel ler a planilha: a coluna obrigatoria 'Base' nao foi encontrada "
            "na linha 3 (cabecalho). Ajuste a linha 3 e tente novamente."
        )

    if re.search(r"cabecalho ['\"]perfil['\"] nao encontrado na linha 3", mensagem_norm):
        return (
            "Nao foi possivel ler a planilha: a coluna obrigatoria 'Perfil' nao foi encontrada "
            "na linha 3 (cabecalho). Ajuste a linha 3 e tente novamente."
        )

    if re.search(r"cabecalho ['\"]numero['\"] nao encontrado na linha 3", mensagem_norm):
        return (
            "Nao foi possivel ler a planilha: a coluna obrigatoria 'Numero' nao foi encontrada "
            "na linha 3 (cabecalho). Ajuste a linha 3 e tente novamente."
        )

    if "nao foi encontrada coluna de data" in mensagem_norm:
        return (
            f"Nao foi possivel ler a planilha: nao encontramos a coluna da data '{data_referencia}' "
            "na linha 3. Formatos aceitos incluem '27-mar' e '27/03/2026'. "
            "Confira o titulo da coluna e tente novamente."
        )

    return mensagem


def processar_cotacoes_lote(
    usuario: str,
    senha: str,
    planilha_path: str,
    validade: str,
    data_referencia: str,
    max_rows_to_scan: int = 100,
    job_id: str | None = None,
    client_ip: str | None = None,
) -> dict:
    current_job = get_current_job()
    task_id = current_job.id if current_job else "unknown"
    log_file = task_log_path(task_id)

    arquivo = Path(planilha_path)
    if not arquivo.exists():
        raise FileNotFoundError(f"Planilha nao encontrada: {planilha_path}")

    start_ts = datetime.now().isoformat(timespec="seconds")

    with log_file.open("a", encoding="utf-8", buffering=1) as log:
        print(f"[{start_ts}] Job iniciado | task_id={task_id} | job_id={job_id}", file=log)
        print(f"Planilha recebida: {arquivo}", file=log)
        print(f"Data referência: {data_referencia} | Validade: {validade}", file=log)
        register_job_started(task_id, job_id=job_id, username=usuario, ip=client_ip, started_at=start_ts)
        register_job_message(task_id, f"Job iniciado | task_id={task_id} | job_id={job_id}", timestamp=start_ts, username=usuario, ip=client_ip)
        register_job_message(task_id, f"Planilha recebida: {arquivo}", username=usuario, ip=client_ip)
        register_job_message(task_id, f"Data referência: {data_referencia} | Validade: {validade}", username=usuario, ip=client_ip)

        try:
            stage_started = perf_counter()
            print("[stage] inicio_execucao_playwright", file=log)
            register_job_stage(task_id, "inicio_execucao_playwright")
            register_job_message(task_id, "[stage] inicio_execucao_playwright", username=usuario, ip=client_ip)
            with redirect_stdout(log), redirect_stderr(log):
                executar_passo_2_lote(
                    usuario=usuario,
                    senha=senha,
                    planilha_path=str(arquivo),
                    validade=validade,
                    data_referencia=data_referencia,
                    max_rows_to_scan=max_rows_to_scan,
                )
            print(
                f"[stage] fim_execucao_playwright | duracao_s={perf_counter() - stage_started:.3f}",
                file=log,
            )
            stage_duration = perf_counter() - stage_started
            register_job_stage(task_id, "fim_execucao_playwright", duration_s=stage_duration)
            register_job_message(
                task_id,
                f"[stage] fim_execucao_playwright | duracao_s={stage_duration:.3f}",
                username=usuario,
                ip=client_ip,
            )

            end_ts = datetime.now().isoformat(timespec="seconds")
            print(f"[{end_ts}] Job concluído com sucesso.", file=log)
            register_job_message(task_id, "Job concluído com sucesso.", timestamp=end_ts, username=usuario, ip=client_ip)
            register_job_completed(task_id, ended_at=end_ts)

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
            erro_usuario = _mensagem_erro_usuario(exc, data_referencia=data_referencia)
            print(f"[{end_ts}] ERRO no job.", file=log)
            print(f"[usuario] {erro_usuario}", file=log)
            print("[usuario] Verifique o layout da planilha (cabecalho na linha 3) e reenfileire o job.", file=log)
            print("[tecnico] Traceback completo:", file=log)
            print(traceback.format_exc(), file=log)
            register_job_message(task_id, "ERRO no job.", timestamp=end_ts, username=usuario, ip=client_ip)
            register_job_message(task_id, f"[usuario] {erro_usuario}", timestamp=end_ts, username=usuario, ip=client_ip)
            register_job_message(
                task_id,
                "[usuario] Verifique o layout da planilha (cabecalho na linha 3) e reenfileire o job.",
                timestamp=end_ts,
                username=usuario,
                ip=client_ip,
            )
            register_job_failed(task_id, ended_at=end_ts, user_error=erro_usuario)
            raise RuntimeError(erro_usuario) from exc
        finally:
            gc.collect()
            print("[stage] gc_collect_executado", file=log)
            register_job_stage(task_id, "gc_collect_executado")
            register_job_message(task_id, "[stage] gc_collect_executado", username=usuario, ip=client_ip)
