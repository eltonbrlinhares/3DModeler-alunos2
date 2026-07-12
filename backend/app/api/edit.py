"""Edição de atributos, property sets, parede legada e remoção.

As rotas só traduzem HTTP; a manipulação IFC fica em `edit_service` /
`geometry_service`. `RuntimeError` (guid inexistente) vira 404.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_entry
from app.models.schemas import (
    CreateWallRequest,
    DeleteEntityRequest,
    EditAttributesRequest,
    EditPsetRequest,
)
from app.services import connectivity_service as conn
from app.services import edit_service
from app.services import geometry_service as geo
from app.services.ifc_service import ModelEntry

router = APIRouter(prefix="/ifc/models/{model_id}/edit", tags=["edit"])


@router.post("/attributes")
def edit_attributes(req: EditAttributesRequest, entry: ModelEntry = Depends(get_entry)):
    try:
        edit_service.edit_attributes(entry, req.guid, req.attributes)
    except RuntimeError as e:
        raise HTTPException(404, f"guid não encontrado: {e}")
    return {"ok": True, "guid": req.guid}


@router.post("/pset")
def edit_pset(req: EditPsetRequest, entry: ModelEntry = Depends(get_entry)):
    try:
        edit_service.edit_pset(entry, req.guid, req.pset_name, req.properties)
    except RuntimeError as e:
        raise HTTPException(404, f"guid não encontrado: {e}")
    return {"ok": True}


@router.post("/wall")
def create_wall(req: CreateWallRequest, entry: ModelEntry = Depends(get_entry)):
    """Cria IfcWall com geometria paramétrica real (delega a geometry_service).

    Mantido por compatibilidade; novos clientes devem usar POST /geometry/wall.
    """
    wall = geo.create_wall(
        entry,
        name=req.name,
        length=req.length,
        height=req.height,
        thickness=req.thickness,
        position=(req.x, req.y, req.z),
    )
    return {"ok": True, "guid": wall.GlobalId, "id": wall.id()}


@router.post("/delete")
def delete_entity(req: DeleteEntityRequest, entry: ModelEntry = Depends(get_entry)):
    try:
        conn.remove_connections_for(entry, req.guid)
        edit_service.delete_product(entry, req.guid)
    except RuntimeError as e:
        raise HTTPException(404, f"guid não encontrado: {e}")
    return {"ok": True}
