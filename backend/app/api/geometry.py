"""Geometria 3D: criação paramétrica e edição de placement/dimensões.

Coordenadas no corpo das requisições são IFC (Z-up, metros).
"""
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_entry
from app.models.schemas import (
    CreateBeamRequest,
    CreateColumnRequest,
    CreateSlabRequest,
    CreateWallGeomRequest,
    EditDimensionsRequest,
    EditPlacementRequest,
)
from app.services import geometry_service as geo
from app.services.ifc_service import ModelEntry

router = APIRouter(prefix="/ifc/models/{model_id}/geometry", tags=["geometry"])


@router.post("/wall")
def create_wall(req: CreateWallGeomRequest, entry: ModelEntry = Depends(get_entry)):
    try:
        wall = geo.create_wall(
            entry,
            name=req.name,
            length=req.length,
            height=req.height,
            thickness=req.thickness,
            position=tuple(req.position),
            rotation_z=req.rotation_z,
            storey_guid=req.storey_guid,
        )
    except RuntimeError as e:
        raise HTTPException(400, f"falha ao criar parede: {e}")
    return {"ok": True, "guid": wall.GlobalId, "id": wall.id()}


@router.post("/slab")
def create_slab(req: CreateSlabRequest, entry: ModelEntry = Depends(get_entry)):
    try:
        slab = geo.create_slab(
            entry,
            name=req.name,
            length=req.length,
            width=req.width,
            thickness=req.thickness,
            polyline=req.polyline,
            position=tuple(req.position),
            rotation_z=req.rotation_z,
            storey_guid=req.storey_guid,
        )
    except (RuntimeError, ValueError) as e:
        raise HTTPException(400, f"falha ao criar laje: {e}")
    return {"ok": True, "guid": slab.GlobalId, "id": slab.id()}


@router.post("/column")
def create_column(req: CreateColumnRequest, entry: ModelEntry = Depends(get_entry)):
    try:
        column = geo.create_column(
            entry,
            name=req.name,
            width=req.width,
            depth=req.depth,
            height=req.height,
            position=tuple(req.position),
            rotation_z=req.rotation_z,
            storey_guid=req.storey_guid,
            profile=req.profile,
            shape=req.shape,
            h=req.h,
            b=req.b,
            tw=req.tw,
            tf=req.tf,
        )
    except RuntimeError as e:
        raise HTTPException(400, f"falha ao criar coluna: {e}")
    return {"ok": True, "guid": column.GlobalId, "id": column.id()}


@router.post("/beam")
def create_beam(req: CreateBeamRequest, entry: ModelEntry = Depends(get_entry)):
    try:
        beam = geo.create_beam(
            entry,
            name=req.name,
            width=req.width,
            depth=req.depth,
            length=req.length,
            position=tuple(req.position),
            rotation_z=req.rotation_z,
            storey_guid=req.storey_guid,
        )
    except RuntimeError as e:
        raise HTTPException(400, f"falha ao criar viga: {e}")
    return {"ok": True, "guid": beam.GlobalId, "id": beam.id()}


@router.post("/placement")
def edit_placement(req: EditPlacementRequest, entry: ModelEntry = Depends(get_entry)):
    try:
        if (
            req.translate is not None
            or req.rotate_z is not None
            or req.rotation_matrix is not None
        ):
            geo.transform_product(
                entry,
                req.guid,
                translate=req.translate,
                rotate_z=req.rotate_z,
                rotation_matrix=req.rotation_matrix,
                rotation_center=req.rotation_center,
            )
        elif req.matrix is not None:
            geo.edit_placement(entry, req.guid, req.matrix)
        elif req.position is not None:
            matrix = geo.matrix_from(
                tuple(req.position), req.rotation_z or 0.0
            ).flatten().tolist()
            geo.edit_placement(entry, req.guid, matrix)
        else:
            raise HTTPException(
                400, "informe 'matrix', 'position', 'translate' ou 'rotate_z'"
            )
    except RuntimeError as e:
        raise HTTPException(404, f"guid não encontrado: {e}")
    return {"ok": True, "guid": req.guid}


@router.post("/dimensions")
def edit_dimensions(req: EditDimensionsRequest, entry: ModelEntry = Depends(get_entry)):
    try:
        geo.edit_wall_dimensions(
            entry, req.guid, req.length, req.height, req.thickness
        )
    except RuntimeError as e:
        raise HTTPException(404, f"guid não encontrado: {e}")
    return {"ok": True, "guid": req.guid}
