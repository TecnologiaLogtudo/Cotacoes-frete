from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List
import unicodedata

from openpyxl import load_workbook


@dataclass
class LinhaAutomacao:
    numero: str
    nome_motorista: str
    placa: str
    perfil: str
    base: str
    frete_negociado: str
    excel_row: int


def _normalizar(texto: str) -> str:
    sem_acentos = unicodedata.normalize("NFKD", texto).encode("ASCII", "ignore").decode("ASCII")
    return sem_acentos.strip().upper()


def _texto_celula(valor: Any) -> str:
    if valor is None:
        return ""
    if isinstance(valor, (datetime, date)):
        return valor.strftime("%d/%m/%Y")
    return str(valor).strip()


def _formatar_moeda(valor: Any) -> str:
    if valor is None:
        return ""
    if isinstance(valor, (int, float)):
        return f"{valor:.2f}".replace(".", ",")

    texto = str(valor).strip()
    if not texto:
        return ""

    return texto


def _mapear_headers(ws, header_row: int) -> Dict[str, int]:
    headers: Dict[str, int] = {}
    for col in range(1, ws.max_column + 1):
        nome = _texto_celula(ws.cell(row=header_row, column=col).value)
        if nome:
            headers[_normalizar(nome)] = col
    return headers


def _encontrar_coluna_data(ws, header_row: int, data_referencia: str) -> int:
    data_norm = _normalizar(data_referencia)
    for col in range(1, ws.max_column + 1):
        cabecalho = _texto_celula(ws.cell(row=header_row, column=col).value)
        if cabecalho and _normalizar(cabecalho) == data_norm:
            return col

    raise ValueError(
        f"Nao foi encontrada coluna de data '{data_referencia}' na linha de cabecalho {header_row}."
    )


def _encontrar_coluna_numero(ws, header_row: int) -> int:
    headers = _mapear_headers(ws, header_row=header_row)
    col_numero = headers.get(_normalizar("Número")) or headers.get(_normalizar("Numero"))
    if not col_numero:
        raise ValueError("Cabecalho 'Número' nao encontrado na linha 3.")
    return col_numero


def tratar_planilha_removendo_linhas_sem_numero(
    planilha_path: str,
    header_row: int = 3,
    max_rows_to_scan: int = 100,
) -> str:
    """
    Gera uma cópia tratada da planilha removendo linhas sem 'Número'
    no intervalo de varredura (primeiras 100 linhas de dados).
    """
    arquivo = Path(planilha_path)
    if not arquivo.exists():
        raise FileNotFoundError(f"Planilha nao encontrada: {planilha_path}")

    wb = load_workbook(filename=str(arquivo), data_only=False, read_only=False)
    ws = wb.active

    col_numero = _encontrar_coluna_numero(ws, header_row=header_row)

    inicio = header_row + 1
    fim = min(inicio + max_rows_to_scan - 1, ws.max_row)

    linhas_para_excluir: List[int] = []
    for row in range(inicio, fim + 1):
        numero = _texto_celula(ws.cell(row=row, column=col_numero).value)
        if not numero:
            linhas_para_excluir.append(row)

    for row in reversed(linhas_para_excluir):
        ws.delete_rows(row, 1)

    destino = arquivo.with_name(f"{arquivo.stem}_tratada{arquivo.suffix}")
    wb.save(destino)
    wb.close()

    print(
        f"Tratamento da planilha concluído: {len(linhas_para_excluir)} linha(s) sem Número removida(s). "
        f"Arquivo tratado: {destino}"
    )

    return str(destino)


def carregar_linhas_para_automacao(
    planilha_path: str,
    data_referencia: str,
    header_row: int = 3,
    max_rows_to_scan: int = 100,
) -> List[LinhaAutomacao]:
    arquivo = Path(planilha_path)
    if not arquivo.exists():
        raise FileNotFoundError(f"Planilha nao encontrada: {planilha_path}")

    wb = load_workbook(filename=str(arquivo), data_only=True, read_only=True)
    ws = wb.active

    headers = _mapear_headers(ws, header_row=header_row)
    col_numero = headers.get(_normalizar("Número")) or headers.get(_normalizar("Numero"))
    if not col_numero:
        raise ValueError("Cabecalho 'Número' nao encontrado na linha 3.")

    col_nome = headers.get(_normalizar("Nome"), 1)
    col_placa = headers.get(_normalizar("Placa"), 2)
    col_perfil = headers.get(_normalizar("Perfil"))
    col_base = headers.get(_normalizar("Base"))

    if not col_perfil:
        raise ValueError("Cabecalho 'Perfil' nao encontrado na linha 3.")
    if not col_base:
        raise ValueError("Cabecalho 'Base' nao encontrado na linha 3.")

    col_data = _encontrar_coluna_data(ws, header_row=header_row, data_referencia=data_referencia)

    inicio = header_row + 1
    fim = inicio + max_rows_to_scan - 1

    linhas: List[LinhaAutomacao] = []
    for row in range(inicio, fim + 1):
        numero = _texto_celula(ws.cell(row=row, column=col_numero).value)
        if not numero:
            continue

        nome = _texto_celula(ws.cell(row=row, column=col_nome).value)
        placa = _texto_celula(ws.cell(row=row, column=col_placa).value)
        perfil = _texto_celula(ws.cell(row=row, column=col_perfil).value)
        base = _texto_celula(ws.cell(row=row, column=col_base).value)
        frete = _formatar_moeda(ws.cell(row=row, column=col_data).value)

        linhas.append(
            LinhaAutomacao(
                numero=numero,
                nome_motorista=nome,
                placa=placa,
                perfil=perfil,
                base=base,
                frete_negociado=frete,
                excel_row=row,
            )
        )

    wb.close()
    return linhas
