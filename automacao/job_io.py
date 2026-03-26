from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Tuple


def jobs_dir() -> Path:
    path = Path('/app/data/jobs')
    path.mkdir(parents=True, exist_ok=True)
    return path


def uploads_dir() -> Path:
    path = Path('/app/data/uploads')
    path.mkdir(parents=True, exist_ok=True)
    return path


def task_log_path(task_id: str) -> Path:
    return jobs_dir() / f"{task_id}.log"


def read_log_incremental(task_id: str, cursor: int) -> Tuple[List[str], int]:
    log_file = task_log_path(task_id)
    if not log_file.exists():
        return [], cursor

    if cursor < 0:
        cursor = 0

    with log_file.open('r', encoding='utf-8', errors='replace') as f:
        lines = f.readlines()

    total = len(lines)
    if cursor >= total:
        return [], total

    chunk = [line.rstrip('\n') for line in lines[cursor:]]
    return chunk, total


def parse_progress_from_log(task_id: str) -> Dict[str, int | None]:
    """Extrai progresso básico dos logs via mensagens existentes no fluxo."""
    log_file = task_log_path(task_id)
    if not log_file.exists():
        return {"processed_lines": 0, "total_lines": None}

    processed = 0
    total = None

    with log_file.open('r', encoding='utf-8', errors='replace') as f:
        for raw in f:
            line = raw.strip()
            if 'Processando linha ' in line:
                processed += 1
            if 'Total de linhas elegíveis para automação:' in line:
                try:
                    total = int(line.split(':')[-1].strip())
                except Exception:
                    pass

    return {"processed_lines": processed, "total_lines": total}
