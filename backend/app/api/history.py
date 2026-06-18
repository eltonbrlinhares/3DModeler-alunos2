"""Undo/redo e validação do modelo."""
from fastapi import APIRouter, Depends

from app.api.deps import get_entry
from app.services import history_service as hist
from app.services import validate_service
from app.services.ifc_service import ModelEntry

router = APIRouter(prefix="/ifc/models/{model_id}", tags=["history"])


@router.post("/history/undo")
def undo(entry: ModelEntry = Depends(get_entry)):
    ok = hist.undo(entry)
    return {"ok": ok, **hist.depths(entry)}


@router.post("/history/redo")
def redo(entry: ModelEntry = Depends(get_entry)):
    ok = hist.redo(entry)
    return {"ok": ok, **hist.depths(entry)}


@router.get("/history")
def history(entry: ModelEntry = Depends(get_entry)):
    return hist.depths(entry)


@router.get("/validate")
def validate(entry: ModelEntry = Depends(get_entry)):
    issues = validate_service.validate(entry)
    return {"valid": len(issues) == 0, "issues": issues}
