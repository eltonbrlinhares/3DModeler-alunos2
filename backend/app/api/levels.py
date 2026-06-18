"""Níveis (IfcBuildingStorey como datum): listar, criar, editar, apagar."""
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_entry
from app.models.schemas import LevelPatch, LevelRequest
from app.services import spatial_service as sp
from app.services.ifc_service import ModelEntry

router = APIRouter(prefix="/ifc/models/{model_id}/levels", tags=["levels"])


@router.get("")
def list_levels(entry: ModelEntry = Depends(get_entry)):
    return sp.list_levels(entry)


@router.post("")
def create_level(req: LevelRequest, entry: ModelEntry = Depends(get_entry)):
    try:
        return sp.create_level(entry, req.name, req.elevation)
    except RuntimeError as e:
        raise HTTPException(400, str(e))


@router.patch("/{guid}")
def edit_level(guid: str, req: LevelPatch, entry: ModelEntry = Depends(get_entry)):
    try:
        return sp.edit_level(entry, guid, req.name, req.elevation)
    except RuntimeError as e:
        raise HTTPException(404, f"guid não encontrado: {e}")


@router.delete("/{guid}")
def delete_level(guid: str, force: bool = False, entry: ModelEntry = Depends(get_entry)):
    try:
        sp.delete_level(entry, guid, force)
    except ValueError as e:
        raise HTTPException(409, str(e))
    except RuntimeError as e:
        raise HTTPException(404, f"guid não encontrado: {e}")
    return {"ok": True, "guid": guid}
