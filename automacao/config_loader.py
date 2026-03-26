import json
from pathlib import Path
from typing import Any, Dict


def carregar_mapeamento() -> Dict[str, Any]:
    """Carrega o mapeamento de seletores e URLs em JSON."""
    base_dir = Path(__file__).resolve().parent
    arquivo = base_dir / "config" / "selectors.json"

    with arquivo.open("r", encoding="utf-8") as f:
        return json.load(f)
