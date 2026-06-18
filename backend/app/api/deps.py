"""Dependências compartilhadas das rotas.

`get_entry` resolve o `ModelEntry` a partir do `model_id` da rota e responde 404
quando o modelo não existe. Usado em todos os routers como dependência do
FastAPI, eliminando o helper `_entry` antes copiado em cada módulo.
"""
from fastapi import HTTPException

from app.services.ifc_service import ModelEntry, registry


def get_entry(model_id: str) -> ModelEntry:
    """Resolve o modelo da rota ou levanta 404.

    Uso: `def rota(entry: ModelEntry = Depends(get_entry)): ...`
    """
    try:
        return registry.get(model_id)
    except KeyError as e:
        raise HTTPException(404, str(e)) from e
