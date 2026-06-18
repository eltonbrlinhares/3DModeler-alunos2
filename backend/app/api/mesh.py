from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_entry
from app.services.ifc_service import ModelEntry
from app.services.mesh_service import tessellate, tessellate_product

router = APIRouter(prefix="/ifc/models/{model_id}/mesh", tags=["mesh"])


@router.get("")
def get_mesh(entry: ModelEntry = Depends(get_entry)):
    with entry.lock:
        return tessellate(entry.file)


@router.get("/{guid}")
def get_product_mesh(guid: str, entry: ModelEntry = Depends(get_entry)):
    """Retessella um único produto (incremental, após edição)."""
    with entry.lock:
        try:
            return tessellate_product(entry.file, guid)
        except RuntimeError as e:
            raise HTTPException(404, f"guid não encontrado: {e}")
