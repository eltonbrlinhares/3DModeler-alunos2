"""Vistas formalizadas como `IfcAnnotation` — só tradução HTTP, a lógica
está em `app.services.view_annotation_service`.
"""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_entry
from app.services import view_annotation_service as va
from app.services.ifc_service import ModelEntry

router = APIRouter(prefix="/ifc/models/{model_id}/view-annotations", tags=["view-annotations"])


class UpsertViewAnnotationRequest(BaseModel):
    view_id: str
    name: str
    origin: tuple[float, float, float] = (0.0, 0.0, 0.0)
    params: dict[str, Any] = {}


@router.get("")
def list_view_annotations(entry: ModelEntry = Depends(get_entry)):
    return {"views": va.list_view_annotations(entry)}


@router.post("")
def upsert_view_annotation(req: UpsertViewAnnotationRequest, entry: ModelEntry = Depends(get_entry)):
    guid = va.upsert_view_annotation(entry, req.view_id, req.name, req.origin, req.params)
    return {"ok": True, "guid": guid}


@router.delete("/{view_id}")
def delete_view_annotation(view_id: str, entry: ModelEntry = Depends(get_entry)):
    found = va.delete_view_annotation(entry, view_id)
    if not found:
        raise HTTPException(404, f"view_id não encontrado: {view_id}")
    return {"ok": True, "view_id": view_id}
