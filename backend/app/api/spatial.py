"""Estrutura espacial: bootstrap Site/Building/Storey, containment e árvore."""
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_entry
from app.models.schemas import AssignContainerRequest, SpatialBootstrapRequest
from app.services import spatial_service as sp
from app.services.ifc_service import ModelEntry

router = APIRouter(prefix="/ifc/models/{model_id}/spatial", tags=["spatial"])


@router.post("/bootstrap")
def bootstrap(req: SpatialBootstrapRequest, entry: ModelEntry = Depends(get_entry)):
    storeys = [s.model_dump() for s in req.storeys] if req.storeys else None
    try:
        return sp.bootstrap(entry, req.site_name, req.building_name, storeys)
    except RuntimeError as e:
        raise HTTPException(400, str(e))


@router.post("/assign")
def assign(req: AssignContainerRequest, entry: ModelEntry = Depends(get_entry)):
    try:
        sp.assign_container(entry, req.guid, req.container_guid)
    except RuntimeError as e:
        raise HTTPException(404, f"guid não encontrado: {e}")
    return {"ok": True, "guid": req.guid, "container_guid": req.container_guid}


@router.get("/tree")
def tree(entry: ModelEntry = Depends(get_entry)):
    try:
        return sp.tree(entry)
    except RuntimeError as e:
        raise HTTPException(400, str(e))
