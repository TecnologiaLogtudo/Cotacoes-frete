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
