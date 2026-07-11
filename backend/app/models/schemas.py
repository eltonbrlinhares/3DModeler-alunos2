from typing import Any

from pydantic import BaseModel, Field


class CreateModelRequest(BaseModel):
    name: str = Field(default="untitled")


class ModelInfo(BaseModel):
    model_id: str
    name: str
    dirty: bool = False


class EditAttributesRequest(BaseModel):
    guid: str
    attributes: dict[str, Any]


class EditPsetRequest(BaseModel):
    guid: str
    pset_name: str
    properties: dict[str, Any]


class CreateWallRequest(BaseModel):
    name: str | None = None
    length: float = 5.0
    height: float = 3.0
    thickness: float = 0.2
    # ponto inicial (m)
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


class DeleteEntityRequest(BaseModel):
    guid: str


# ----- geometria 3D (coordenadas IFC: Z-up, metros) -----


class CreateWallGeomRequest(BaseModel):
    name: str | None = None
    length: float = Field(default=5.0, gt=0)
    height: float = Field(default=3.0, gt=0)
    thickness: float = Field(default=0.2, gt=0)
    position: list[float] = Field(default=[0.0, 0.0, 0.0], min_length=3, max_length=3)
    rotation_z: float = 0.0  # radianos, em torno de Z
    storey_guid: str | None = None


class EditPlacementRequest(BaseModel):
    guid: str
    # absoluto: matrix[16] OU position(+rotation_z). relativo (gizmo): translate
    # e/ou rotate_z (delta em radianos). Tudo em metros / radianos.
    matrix: list[float] | None = Field(default=None, min_length=16, max_length=16)
    position: list[float] | None = Field(default=None, min_length=3, max_length=3)
    rotation_z: float | None = None
    translate: list[float] | None = Field(default=None, min_length=3, max_length=3)
    rotate_z: float | None = None
    rotation_matrix: list[float] | None = Field(default=None, min_length=9, max_length=9)
    rotation_center: list[float] | None = Field(default=None, min_length=3, max_length=3)


class EditDimensionsRequest(BaseModel):
    guid: str
    length: float = Field(gt=0)
    height: float = Field(gt=0)
    thickness: float = Field(gt=0)


class CreateSlabRequest(BaseModel):
    name: str | None = None
    length: float = Field(default=4.0, gt=0)
    width: float = Field(default=3.0, gt=0)
    thickness: float = Field(default=0.25, gt=0)
    polyline: list[list[float]] | None = Field(default=None, min_length=3)
    position: list[float] = Field(default=[0.0, 0.0, 0.0], min_length=3, max_length=3)
    rotation_z: float = 0.0
    storey_guid: str | None = None
    # None/"FLOOR" = laje comum; "BASESLAB" = radier (laje de fundacao)
    predefined_type: str | None = None


class CreateFootingRequest(BaseModel):
    name: str | None = None
    # "PAD_FOOTING" = sapata isolada; "PILE_CAP" = bloco sobre estacas
    predefined_type: str = Field(default="PAD_FOOTING")
    base_width: float = Field(default=1.5, gt=0)
    base_length: float = Field(default=1.5, gt=0)
    height: float = Field(default=0.5, gt=0)
    # None = igual a base (caixa reta, usado pelo bloco); menor que a base
    # nas duas direcoes -> tronco de piramide (sapata)
    top_width: float | None = Field(default=None, gt=0)
    top_length: float | None = Field(default=None, gt=0)
    # "rodape" reto opcional antes do afunilamento (0 = sem rodape, tronco
    # comeca direto do chao)
    base_height: float = Field(default=0.0, ge=0)
    # pedestal opcional (prisma reto em cima do tronco/caixa)
    pedestal_width: float | None = Field(default=None, gt=0)
    pedestal_length: float | None = Field(default=None, gt=0)
    pedestal_height: float = Field(default=0.0, ge=0)
    position: list[float] = Field(default=[0.0, 0.0, 0.0], min_length=3, max_length=3)
    rotation_z: float = 0.0
    storey_guid: str | None = None
    # metadados informativos do bloco (nao alteram a geometria; ficam num Pset)
    pile_count: int | None = Field(default=None, gt=0)
    pile_diameter: float | None = Field(default=None, gt=0)


class CreateColumnRequest(BaseModel):
    name: str | None = None
    profile: str | None = None
    shape: str | None = None
    h: float | None = Field(default=None, gt=0)
    b: float | None = Field(default=None, gt=0)
    tw: float | None = Field(default=None, gt=0)
    tf: float | None = Field(default=None, gt=0)
    width: float = Field(default=0.4, gt=0)
    depth: float = Field(default=0.4, gt=0)
    height: float = Field(default=3.0, gt=0)
    position: list[float] = Field(default=[0.0, 0.0, 0.0], min_length=3, max_length=3)
    rotation_z: float = 0.0
    storey_guid: str | None = None


class CreateBeamRequest(BaseModel):
    name: str | None = None
    profile: str | None = None
    shape: str | None = None
    h: float | None = Field(default=None, gt=0)
    b: float | None = Field(default=None, gt=0)
    tw: float | None = Field(default=None, gt=0)
    tf: float | None = Field(default=None, gt=0)
    width: float = Field(default=0.2, gt=0)
    depth: float = Field(default=0.3, gt=0)
    length: float = Field(default=5.0, gt=0)
    position: list[float] = Field(default=[0.0, 0.0, 0.0], min_length=3, max_length=3)
    rotation_z: float = 0.0
    storey_guid: str | None = None


# ----- estrutura espacial -----


class StoreySpec(BaseModel):
    name: str = "Level"
    elevation: float = 0.0


class SpatialBootstrapRequest(BaseModel):
    site_name: str = "Site"
    building_name: str = "Building"
    storeys: list[StoreySpec] | None = None


class AssignContainerRequest(BaseModel):
    guid: str
    container_guid: str


# ----- níveis (IfcBuildingStorey como datum) -----


class LevelRequest(BaseModel):
    name: str = "Level"
    elevation: float = 0.0  # cota Z em metros


class LevelPatch(BaseModel):
    name: str | None = None
    elevation: float | None = None


# ----- grids (IfcGrid + IfcGridAxis) -----


class GridAxisU(BaseModel):
    tag: str
    x: float  # posição do eixo U ao longo de X (m)


class GridAxisV(BaseModel):
    tag: str
    y: float  # posição do eixo V ao longo de Y (m)


class GridRequest(BaseModel):
    name: str | None = None
    u: list[GridAxisU] = Field(default_factory=list)
    v: list[GridAxisV] = Field(default_factory=list)
    extent: float | None = None  # meia-largura das linhas (m); auto se None


# ----- dimensionamento preliminar de fundação (estimativa, não substitui NBR) -----


class SuggestPadFootingRequest(BaseModel):
    axial_load_kn: float = Field(gt=0)
    column_width: float = Field(gt=0)
    column_depth: float = Field(gt=0)
    soil_bearing_kpa: float = Field(gt=0)
    self_weight_ratio: float = Field(default=0.05, ge=0)
    min_height: float = Field(default=0.30, gt=0)


class SuggestPileCapRequest(BaseModel):
    axial_load_kn: float = Field(gt=0)
    pile_capacity_kn: float = Field(gt=0)
    pile_diameter: float = Field(gt=0)
    spacing_factor: float = Field(default=2.5, gt=0)
    edge_factor: float = Field(default=1.0, gt=0)
