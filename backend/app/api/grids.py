"""Grids de referência (IfcGrid): listar, criar, apagar."""
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_entry
from app.models.schemas import GridRequest
from app.services import grid_service as gs
from app.services.ifc_service import ModelEntry

router = APIRouter(prefix="/ifc/models/{model_id}/grids", tags=["grids"])


@router.get("")
def list_grids(entry: ModelEntry = Depends(get_entry)):
    return gs.list_grids(entry)


@router.post("")
def create_grid(req: GridRequest, entry: ModelEntry = Depends(get_entry)):
    try:
        return gs.create_grid(
            entry,
            name=req.name,
            u=[a.model_dump() for a in req.u],
            v=[a.model_dump() for a in req.v],
            extent=req.extent,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/{guid}")
def delete_grid(guid: str, entry: ModelEntry = Depends(get_entry)):
    try:
        gs.delete_grid(entry, guid)
    except RuntimeError as e:
        raise HTTPException(404, f"guid não encontrado: {e}")
    return {"ok": True, "guid": guid}
