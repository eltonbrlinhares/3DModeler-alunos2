"""Geometria 3D: criação paramétrica e edição de placement/dimensões.

Coordenadas no corpo das requisições são IFC (Z-up, metros).
"""
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_entry
from app.models.schemas import (
    CreateBeamRequest,
    CreateColumnRequest,
    CreateFootingRequest,
    CreateSlabRequest,
    CreateWallGeomRequest,
    EditBeamRequest,
    EditColumnRequest,
    EditDimensionsRequest,
    EditFootingRequest,
    EditPlacementRequest,
    EditSlabRequest,
)
from app.services import connectivity_service as conn
from app.services import geometry_service as geo
from app.services import semantics_service as sem
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
            top_level_guid=req.top_level_guid,
            base_offset=req.base_offset,
            top_offset=req.top_offset,
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
            predefined_type=req.predefined_type,
        )
    except (RuntimeError, ValueError) as e:
        raise HTTPException(400, f"falha ao criar laje: {e}")
    conn.resync_connections(entry, slab.GlobalId)
    sem.apply_semantics(entry, slab.GlobalId)
    return {"ok": True, "guid": slab.GlobalId, "id": slab.id()}


@router.post("/footing")
def create_footing(req: CreateFootingRequest, entry: ModelEntry = Depends(get_entry)):
    """Cria uma fundacao rasa (IfcFooting): sapata isolada (PAD_FOOTING) ou
    bloco sobre estacas (PILE_CAP), conforme `req.predefined_type`."""
    try:
        footing = geo.create_footing(
            entry,
            name=req.name,
            base_width=req.base_width,
            base_length=req.base_length,
            height=req.height,
            top_width=req.top_width,
            top_length=req.top_length,
            base_height=req.base_height,
            pedestal_width=req.pedestal_width,
            pedestal_length=req.pedestal_length,
            pedestal_height=req.pedestal_height,
            position=tuple(req.position),
            rotation_z=req.rotation_z,
            storey_guid=req.storey_guid,
            predefined_type=req.predefined_type,
            pile_count=req.pile_count,
            pile_diameter=req.pile_diameter,
        )
    except RuntimeError as e:
        raise HTTPException(400, f"falha ao criar fundação: {e}")
    conn.resync_connections(entry, footing.GlobalId)
    sem.apply_semantics(entry, footing.GlobalId)
    return {"ok": True, "guid": footing.GlobalId, "id": footing.id()}


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
            top_level_guid=req.top_level_guid,
            base_offset=req.base_offset,
            top_offset=req.top_offset,
        )
    except RuntimeError as e:
        raise HTTPException(400, f"falha ao criar coluna: {e}")
    conn.resync_connections(entry, column.GlobalId)
    sem.apply_semantics(entry, column.GlobalId)
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
            profile=req.profile,
            shape=req.shape,
            h=req.h,
            b=req.b,
            tw=req.tw,
            tf=req.tf,
        )
    except RuntimeError as e:
        raise HTTPException(400, f"falha ao criar viga: {e}")
    conn.resync_connections(entry, beam.GlobalId)
    sem.apply_semantics(entry, beam.GlobalId)
    return {"ok": True, "guid": beam.GlobalId, "id": beam.id()}


@router.patch("/column/{guid}")
def edit_column(guid: str, req: EditColumnRequest, entry: ModelEntry = Depends(get_entry)):
    """Regenera a seção/altura de um pilar já inserido, sem apagar/recriar."""
    try:
        geo.edit_column_dimensions(
            entry, guid,
            width=req.width, depth=req.depth, height=req.height,
            profile=req.profile, shape=req.shape,
            h=req.h, b=req.b, tw=req.tw, tf=req.tf,
        )
    except RuntimeError as e:
        raise HTTPException(404, f"guid não encontrado: {e}")
    conn.resync_connections(entry, guid)
    sem.apply_semantics(entry, guid)
    return {"ok": True, "guid": guid}


@router.patch("/beam/{guid}")
def edit_beam(guid: str, req: EditBeamRequest, entry: ModelEntry = Depends(get_entry)):
    """Regenera a seção/comprimento de uma viga já inserida, sem apagar/recriar."""
    try:
        geo.edit_beam_dimensions(
            entry, guid,
            width=req.width, depth=req.depth, length=req.length,
            profile=req.profile, shape=req.shape,
            h=req.h, b=req.b, tw=req.tw, tf=req.tf,
        )
    except RuntimeError as e:
        raise HTTPException(404, f"guid não encontrado: {e}")
    conn.resync_connections(entry, guid)
    sem.apply_semantics(entry, guid)
    return {"ok": True, "guid": guid}


@router.patch("/footing/{guid}")
def edit_footing(guid: str, req: EditFootingRequest, entry: ModelEntry = Depends(get_entry)):
    """Regenera a malha de uma fundação (sapata/bloco) já inserida, sem
    apagar/recriar. O tipo (sapata/bloco) não muda nesta edição."""
    try:
        geo.edit_footing_dimensions(
            entry, guid,
            base_width=req.base_width, base_length=req.base_length, height=req.height,
            top_width=req.top_width, top_length=req.top_length,
            base_height=req.base_height,
            pedestal_width=req.pedestal_width, pedestal_length=req.pedestal_length,
            pedestal_height=req.pedestal_height,
            pile_count=req.pile_count, pile_diameter=req.pile_diameter,
        )
    except RuntimeError as e:
        raise HTTPException(404, f"guid não encontrado: {e}")
    conn.resync_connections(entry, guid)
    sem.apply_semantics(entry, guid)
    return {"ok": True, "guid": guid}


@router.patch("/slab/{guid}")
def edit_slab(guid: str, req: EditSlabRequest, entry: ModelEntry = Depends(get_entry)):
    """Regenera a espessura de uma laje/radier já inserida (o contorno em
    planta é preservado — não é editável por aqui)."""
    try:
        geo.edit_slab_dimensions(entry, guid, thickness=req.thickness)
    except RuntimeError as e:
        raise HTTPException(404, f"guid não encontrado: {e}")
    conn.resync_connections(entry, guid)
    sem.apply_semantics(entry, guid)
    return {"ok": True, "guid": guid}


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
    conn.resync_connections(entry, req.guid)
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
