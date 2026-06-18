from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.api.deps import get_entry
from app.models.schemas import CreateModelRequest, ModelInfo
from app.services import export_service, validate_service
from app.services.ifc_service import ModelEntry, registry

router = APIRouter(prefix="/ifc", tags=["ifc"])


@router.get("/models", response_model=list[ModelInfo])
def list_models():
    return registry.list_models()


@router.post("/models", response_model=ModelInfo)
def create_model(req: CreateModelRequest):
    entry = registry.create_blank(req.name)
    return ModelInfo(model_id=entry.model_id, name=entry.name, dirty=entry.dirty)


@router.post("/models/upload", response_model=ModelInfo)
async def upload_model(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".ifc"):
        raise HTTPException(400, "esperado arquivo .ifc")
    data = await file.read()
    entry = registry.load_bytes(data, file.filename)
    return ModelInfo(model_id=entry.model_id, name=entry.name, dirty=entry.dirty)


@router.get("/models/{model_id}/summary")
def summary(model_id: str):
    try:
        return registry.summary(model_id)
    except KeyError as e:
        raise HTTPException(404, str(e))


@router.get("/models/{model_id}/entities")
def list_entities(model_id: str, type: str = "IfcProduct"):
    try:
        return registry.list_entities(model_id, type)
    except KeyError as e:
        raise HTTPException(404, str(e))


@router.get("/models/{model_id}/entity/{guid}")
def entity_detail(model_id: str, guid: str):
    try:
        return registry.entity_detail(model_id, guid)
    except KeyError as e:
        raise HTTPException(404, str(e))


@router.post("/models/{model_id}/save")
def save_model(entry: ModelEntry = Depends(get_entry)):
    issues = validate_service.validate(entry)  # warnings não bloqueiam
    path = registry.save(entry.model_id)
    return {"path": path, "valid": len(issues) == 0, "issues": issues}


@router.get("/models/{model_id}/download")
def download_model(entry: ModelEntry = Depends(get_entry)):
    registry.save(entry.model_id)
    return FileResponse(
        entry.path, media_type="application/x-step", filename=f"{entry.name}.ifc"
    )


@router.get("/models/{model_id}/export/glb")
def export_glb(entry: ModelEntry = Depends(get_entry)):
    path = export_service.export_glb(entry)
    return FileResponse(
        path, media_type="model/gltf-binary", filename=f"{entry.name}.glb"
    )


@router.delete("/models/{model_id}")
def close_model(model_id: str):
    registry.close(model_id)
    return {"ok": True}
