from __future__ import annotations

import io
from pathlib import Path
from fastapi.testclient import TestClient
import openpyxl
import pytest

from automacao.api import app


@pytest.fixture
def client():
    return TestClient(app)


def test_health_endpoints(client: TestClient):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}

    resp_ready = client.get("/health/ready")
    assert resp_ready.status_code == 200
    assert resp_ready.json() == {"status": "ready"}


def test_get_operacoes(client: TestClient):
    resp = client.get("/api/operacoes")
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert any(item["codigo"] == "D2D" for item in data["items"])
    assert any(item["codigo"] == "AMAZON" for item in data["items"])


def test_upload_validate_rejects_non_xlsx(client: TestClient):
    resp = client.post(
        "/api/jobs/upload-and-validate",
        files={"file": ("teste.txt", b"arquivo de texto", "text/plain")},
    )
    assert resp.status_code == 400
    assert "Apenas arquivos .xlsx são permitidos" in resp.json()["detail"]


def test_upload_validate_empty_file(client: TestClient):
    resp = client.post(
        "/api/jobs/upload-and-validate",
        files={"file": ("vazio.xlsx", b"", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert resp.status_code == 400
    assert "está vazio" in resp.json()["detail"]


def test_upload_validate_valid_workbook(client: TestClient, tmp_path: Path):
    # Cria uma planilha de teste em memória
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Plan1"
    # Linha 1 e 2 vazias / cabeçalho geral
    # Linha 3 cabeçalho
    ws.cell(row=3, column=1, value="Nome")
    ws.cell(row=3, column=2, value="Placa")
    ws.cell(row=3, column=3, value="Número")
    ws.cell(row=3, column=4, value="Perfil")
    ws.cell(row=3, column=5, value="Base")
    ws.cell(row=3, column=6, value="Operação")
    ws.cell(row=3, column=7, value="07/05/2026")
    ws.cell(row=3, column=8, value="07/05/2026")

    # Linha 4 dados
    ws.cell(row=4, column=1, value="Motorista Teste")
    ws.cell(row=4, column=2, value="ABC1234")
    ws.cell(row=4, column=3, value="1001")
    ws.cell(row=4, column=4, value="LATAM")
    ws.cell(row=4, column=5, value="SPO")
    ws.cell(row=4, column=6, value="D2D")
    ws.cell(row=4, column=7, value="150,00")
    ws.cell(row=4, column=8, value="1200,00")

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    resp = client.post(
        "/api/jobs/upload-and-validate",
        data={"data_referencia": "07/05/2026", "tipo_operacao": "D2D"},
        files={"file": ("teste_valid.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_valid"] is True
    assert data["total_rows"] >= 1
    assert data["valid_rows_count"] >= 1
    assert len(data["preview"]) >= 1
    assert data["preview"][0]["reference"] == "1001"
    assert data["preview"][0]["nome"] == "Motorista Teste"


def test_prefix_cotacoes_rewrite(client: TestClient):
    # Garante que chamadas com prefixo /cotacoes/api e /cotacoes/health são redirecionadas pelo middleware
    resp_health = client.get("/cotacoes/health")
    assert resp_health.status_code == 200
    assert resp_health.json() == {"status": "ok"}

    resp_ops = client.get("/cotacoes/api/operacoes")
    assert resp_ops.status_code == 200
    assert "items" in resp_ops.json()


def test_get_job_status_failed_job_observabilidade(client: TestClient):
    from automacao.observabilidade import register_job_failed, register_job_started
    task_id = "test-fail-task-001"
    register_job_started(task_id, job_id=task_id, username="test_user")
    register_job_failed(task_id, user_error="Nao foi encontrada opcao de remetente para a cidade/base: PORTO SEGURO")

    resp = client.get(f"/api/jobs/{task_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "FAILURE"
    assert "PORTO SEGURO" in data.get("error", "")
    assert data["current_phase"] == "F3"
    assert "items" in data


def test_admin_steps_and_actions_by_job_id(client: TestClient):
    from automacao.observabilidade import register_job_stage, register_job_started, register_job_message
    task_id = "task-admin-test-01"
    job_id = "admin-test-01"
    register_job_started(task_id, job_id=job_id, username="operador_teste", started_at="2026-11-10T11:00:00")
    register_job_stage(task_id, "inicio_execucao_playwright", timestamp="2026-11-10T11:00:01")
    register_job_stage(task_id, "fim_execucao_playwright", timestamp="2026-11-10T11:00:05", duration_s=4.0)
    register_job_message(task_id, "[stage] fim_execucao_playwright", timestamp="2026-11-10T11:00:05", username="operador_teste")

    # Busca steps usando o job_id sequencial
    resp_steps = client.get(f"/api/admin/jobs/{job_id}/steps")
    assert resp_steps.status_code == 200
    steps_data = resp_steps.json()
    assert "items" in steps_data
    assert len(steps_data["items"]) >= 2
    step1 = steps_data["items"][0]
    assert step1["name"] == "inicio_execucao_playwright"
    assert step1["step"] == "inicio_execucao_playwright"
    assert step1["message"] != ""
    assert step1["timestamp"] is not None

    # Busca actions usando o job_id sequencial
    resp_actions = client.get(f"/api/admin/jobs/{job_id}/actions")
    assert resp_actions.status_code == 200
    actions_data = resp_actions.json()
    assert "items" in actions_data
    assert len(actions_data["items"]) >= 1
    act1 = actions_data["items"][0]
    assert "action" in act1
    assert "actor" in act1
    assert act1["status"] in ("OK", "ERRO")
    assert act1["timestamp"] is not None

    # Valida campos enriquecidos na listagem de jobs
    resp_jobs = client.get("/api/jobs")
    assert resp_jobs.status_code == 200
    jobs = resp_jobs.json()["jobs"]
    matching = [j for j in jobs if j.get("job_id") == job_id or j.get("task_id") == task_id]
    assert len(matching) == 1
    j_item = matching[0]
    assert "filename" in j_item
    assert "total_items" in j_item
    assert "processed_lines" in j_item
    assert "percent" in j_item


def test_stop_job_endpoint(client: TestClient):
    from automacao.observabilidade import register_job_started
    task_id = "test-stop-task-001"
    register_job_started(task_id, job_id=task_id, username="operador_stop")

    # Para o job via POST /api/jobs/{task_id}/stop
    resp_stop = client.post(f"/api/jobs/{task_id}/stop")
    assert resp_stop.status_code == 200
    assert resp_stop.json()["status"] == "CANCELLED"

    # Verifica status retornado
    resp_status = client.get(f"/api/jobs/{task_id}")
    assert resp_status.status_code == 200
    assert resp_status.json()["status"] == "CANCELLED"


def test_unstarted_job_status_ready(client: TestClient):
    # Um ID desconhecido sem logs e sem RQ deve retornar READY e F1
    resp = client.get("/api/jobs/job-inexistente-12345")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "READY"
    assert data["current_phase"] == "F1"



