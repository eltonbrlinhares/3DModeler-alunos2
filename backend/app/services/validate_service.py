"""Validação de modelos IFC via ifcopenshell.validate (Fase 6)."""
from __future__ import annotations

from typing import Any

import ifcopenshell.validate

from app.services.ifc_service import ModelEntry


def validate(entry: ModelEntry) -> list[dict[str, Any]]:
    """Roda a validação e devolve os problemas encontrados (lista, possivelmente
    vazia). Cada item tem ao menos `message`."""
    logger = ifcopenshell.validate.json_logger()
    with entry.lock:
        ifcopenshell.validate.validate(entry.file, logger)
    out: list[dict[str, Any]] = []
    for st in logger.statements:
        # json_logger guarda dicts com 'level' e 'message' (entre outros)
        out.append(
            {
                "level": str(st.get("level", "")),
                "message": str(st.get("message", st)),
            }
        )
    return out
