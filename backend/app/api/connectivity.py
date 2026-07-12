"""Conectividade física entre elementos estruturais.

Só tradução HTTP — a lógica está em `app.services.connectivity_service`.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_entry
from app.services import connectivity_service as conn
from app.services.ifc_service import ModelEntry

router = APIRouter(prefix="/ifc/models/{model_id}/connectivity", tags=["connectivity"])


@router.get("/{guid}")
def get_connections(guid: str, entry: ModelEntry = Depends(get_entry)):
    """Lista quem `guid` toca (apoia/é apoiado, cruza, sustenta laje) — usado
    tanto no painel de propriedades quanto para avisar antes de apagar."""
    try:
        return {"guid": guid, "connections": conn.list_connections(entry, guid)}
    except RuntimeError as e:
        raise HTTPException(404, f"guid não encontrado: {e}")


@router.post("/{guid}/resync")
def resync(guid: str, entry: ModelEntry = Depends(get_entry)):
    """Força um recálculo manual (fallback — normalmente a criação/edição já
    dispara isso sozinha)."""
    try:
        conn.resync_connections(entry, guid)
    except RuntimeError as e:
        raise HTTPException(404, f"guid não encontrado: {e}")
    return {"ok": True, "guid": guid, "connections": conn.list_connections(entry, guid)}
