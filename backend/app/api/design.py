"""Dimensionamento PRELIMINAR de fundações (sapata/bloco).

Rotas stateless — não recebem `model_id` nem tocam o arquivo IFC, apenas
calculam uma geometria sugerida a partir de carga/solo/estaca. O frontend usa
o resultado para pré-preencher o formulário de `footingTool`; a criação da
geometria em si continua passando por `POST /geometry/footing`.
"""
from fastapi import APIRouter, HTTPException

from app.models.schemas import SuggestPadFootingRequest, SuggestPileCapRequest
from app.services import foundation_design_service as design

router = APIRouter(prefix="/design/foundation", tags=["design"])


@router.post("/pad-footing")
def suggest_pad_footing(req: SuggestPadFootingRequest):
    try:
        result = design.suggest_pad_footing(
            axial_load_kn=req.axial_load_kn,
            column_width=req.column_width,
            column_depth=req.column_depth,
            soil_bearing_kpa=req.soil_bearing_kpa,
            self_weight_ratio=req.self_weight_ratio,
            min_height=req.min_height,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {
        "width": result.width,
        "length": result.length,
        "height": result.height,
        "area": result.area,
        "cantilever": result.cantilever,
        "rigid": result.rigid,
        "notes": result.notes,
    }


@router.post("/pile-cap")
def suggest_pile_cap(req: SuggestPileCapRequest):
    try:
        result = design.suggest_pile_cap(
            axial_load_kn=req.axial_load_kn,
            pile_capacity_kn=req.pile_capacity_kn,
            pile_diameter=req.pile_diameter,
            spacing_factor=req.spacing_factor,
            edge_factor=req.edge_factor,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {
        "pile_count": result.pile_count,
        "width": result.width,
        "length": result.length,
        "height": result.height,
        "pile_spacing": result.pile_spacing,
        "edge_distance": result.edge_distance,
        "arrangement": result.arrangement,
        "notes": result.notes,
    }
