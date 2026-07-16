"""Cotas manuais ponto-a-ponto (`IfcAnnotation`) — só tradução HTTP, a
lógica está em `app.services.dimension_service`.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_entry
from app.services import dimension_service as dim
from app.services.ifc_service import ModelEntry

router = APIRouter(prefix="/ifc/models/{model_id}/dimensions", tags=["dimensions"])


class CreateDimensionRequest(BaseModel):
    p0: tuple[float, float, float]
    p1: tuple[float, float, float]
    plane: Literal["z", "x", "y"] = "z"


@router.get("")
def list_dimensions(entry: ModelEntry = Depends(get_entry)):
    return {"dimensions": dim.list_dimensions(entry)}


@router.post("")
def create_dimension(req: CreateDimensionRequest, entry: ModelEntry = Depends(get_entry)):
    try:
        result = dim.create_point_dimension(entry, req.p0, req.p1, req.plane)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, **result}


@router.delete("/{guid}")
def delete_dimension(guid: str, entry: ModelEntry = Depends(get_entry)):
    try:
        dim.delete_dimension(entry, guid)
    except RuntimeError as e:
        raise HTTPException(404, f"guid não encontrado: {e}")
    return {"ok": True, "guid": guid}
