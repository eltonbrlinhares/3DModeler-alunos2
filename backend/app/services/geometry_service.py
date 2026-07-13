"""Criação e edição de geometria paramétrica IFC (Fase 1+2).

Toda manipulação de forma e posição passa por `ifcopenshell.api` para preservar
inverses e manter o arquivo válido. Coordenadas são sempre IFC (Z-up, metros).

Toda função que muta o modelo usa `with mutate(entry) as f:` (lock + snapshot de
undo + dirty). Para adicionar uma geometria nova, copie `create_column` e ajuste
a representação — ver estrutura_pedagogica_backend.md.
"""
from __future__ import annotations

import json
import math

import numpy as np
import ifcopenshell
import ifcopenshell.api
import ifcopenshell.util.placement
import ifcopenshell.util.representation
import ifcopenshell.util.unit

from app.services._mutation import mutate
from app.services.ifc_service import ModelEntry


def get_body_context(f: ifcopenshell.file):
    """Get-or-create o contexto geométrico Model/Body/MODEL_VIEW.

    Modelos carregados de disco já costumam ter um; modelos criados em branco
    (`create_blank`) não. Esta função cobre os dois casos.
    """
    body = ifcopenshell.util.representation.get_context(
        f, "Model", "Body", "MODEL_VIEW"
    )
    if body is not None:
        return body
    parent = ifcopenshell.util.representation.get_context(f, "Model")
    if parent is None:
        parent = ifcopenshell.api.run(
            "context.add_context", f, context_type="Model"
        )
    return ifcopenshell.api.run(
        "context.add_context",
        f,
        context_type="Model",
        context_identifier="Body",
        target_view="MODEL_VIEW",
        parent=parent,
    )


def matrix_from(position=(0.0, 0.0, 0.0), rotation_z: float = 0.0) -> np.ndarray:
    """Monta uma matriz 4x4 (rotação em torno de Z + translação), em radianos."""
    c, s = math.cos(rotation_z), math.sin(rotation_z)
    m = np.eye(4)
    m[0, 0], m[0, 1] = c, -s
    m[1, 0], m[1, 1] = s, c
    m[0, 3], m[1, 3], m[2, 3] = position
    return m


def _assign_storey(f, product, storey_guid: str | None):
    if not storey_guid:
        return
    storey = f.by_guid(storey_guid)
    ifcopenshell.api.run(
        "spatial.assign_container",
        f,
        products=[product],
        relating_structure=storey,
    )


def place_product(f, product, matrix, storey_guid: str | None = None) -> None:
    """Aplica o placement (matriz 4x4, metros) e associa ao storey, se houver.

    Centraliza os dois últimos passos comuns a toda geometria criada.
    """
    ifcopenshell.api.run(
        "geometry.edit_object_placement", f, product=product, matrix=matrix
    )
    _assign_storey(f, product, storey_guid)


PARAMS_PSET_NAME = "Pset_ParametricSource"


def _find_pset(product, name: str):
    """Procura um IfcPropertySet já associado ao produto pelo nome."""
    for rel in getattr(product, "IsDefinedBy", None) or ():
        if rel.is_a("IfcRelDefinesByProperties"):
            pdef = rel.RelatingPropertyDefinition
            if pdef.is_a("IfcPropertySet") and pdef.Name == name:
                return pdef
    return None


def write_params(f: ifcopenshell.file, product, params: dict) -> None:
    """Grava parâmetros de criação/edição em um Pset próprio.

    Quando o Pset já existe, preserva campos que não fazem parte da edição
    atual (por exemplo os vínculos ``base_level_guid``/``top_level_guid``).
    """
    pset = _find_pset(product, PARAMS_PSET_NAME)
    existing: dict = {}
    if pset is not None:
        for prop in getattr(pset, "HasProperties", None) or ():
            if getattr(prop, "Name", None) != "ParamsJSON":
                continue
            wrapped = getattr(getattr(prop, "NominalValue", None), "wrappedValue", None)
            if wrapped:
                try:
                    value = json.loads(str(wrapped))
                    if isinstance(value, dict):
                        existing = value
                except (TypeError, ValueError, json.JSONDecodeError):
                    existing = {}
            break
    else:
        pset = ifcopenshell.api.run(
            "pset.add_pset", f, product=product, name=PARAMS_PSET_NAME
        )
    merged = {**existing, **params}
    ifcopenshell.api.run(
        "pset.edit_pset", f, pset=pset, properties={"ParamsJSON": json.dumps(merged)}
    )


def get_params_f(f: ifcopenshell.file, guid: str) -> dict | None:
    """Versão de `get_params` que recebe o `ifcopenshell.file` diretamente —
    para uso de dentro de um `with mutate(entry) as f:` já aberto (ex.: o
    serviço de conectividade), sem precisar de um `ModelEntry`."""
    inst = f.by_guid(guid)
    pset = _find_pset(inst, PARAMS_PSET_NAME)
    if pset is None:
        return None
    for prop in getattr(pset, "HasProperties", None) or ():
        if prop.Name == "ParamsJSON" and prop.is_a("IfcPropertySingleValue"):
            raw = prop.NominalValue.wrappedValue if prop.NominalValue else None
            if raw:
                try:
                    return json.loads(raw)
                except (TypeError, ValueError):
                    return None
    return None


def get_params(entry: ModelEntry, guid: str) -> dict | None:
    """Lê de volta os parâmetros gravados por `write_params` (ou None se o
    elemento não tiver o Pset — ex.: modelo criado antes desta funcionalidade,
    ou upload de um IFC externo)."""
    return get_params_f(entry.file, guid)


def rect_profile(f, width: float, depth: float):
    """IfcRectangleProfileDef nas unidades do arquivo (converte metros→unidade)."""
    scale = ifcopenshell.util.unit.calculate_unit_scale(f)  # file unit -> m
    return f.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=width / scale,
        YDim=depth / scale,
    )


def create_wall(
    entry: ModelEntry,
    name: str | None,
    length: float,
    height: float,
    thickness: float,
    position=(0.0, 0.0, 0.0),
    rotation_z: float = 0.0,
    storey_guid: str | None = None,
    top_level_guid: str | None = None,
    base_offset: float = 0.0,
    top_offset: float = 0.0,
) -> ifcopenshell.entity_instance:
    """Cria um IfcWall com representação extrudada e placement."""
    with mutate(entry) as f:
        body = get_body_context(f)
        wall = ifcopenshell.api.run(
            "root.create_entity", f, ifc_class="IfcWall", name=name
        )
        rep = ifcopenshell.api.run(
            "geometry.add_wall_representation",
            f,
            context=body,
            length=length,
            height=height,
            thickness=thickness,
        )
        ifcopenshell.api.run(
            "geometry.assign_representation", f, product=wall, representation=rep
        )
        place_product(f, wall, matrix_from(position, rotation_z), storey_guid)
        write_params(
            f,
            wall,
            {
                "length": length,
                "height": height,
                "thickness": thickness,
                "base_level_guid": storey_guid,
                "top_level_guid": top_level_guid,
                "base_offset": float(base_offset),
                "top_offset": float(top_offset),
            },
        )
    return wall


def create_slab(
    entry: ModelEntry,
    name: str | None,
    length: float,
    width: float,
    thickness: float,
    polyline: list[list[float]] | None = None,
    position=(0.0, 0.0, 0.0),
    rotation_z: float = 0.0,
    storey_guid: str | None = None,
    predefined_type: str | None = None,
) -> ifcopenshell.entity_instance:
    """Cria um IfcSlab extrudado a partir do placement local.

    Se `polyline` for informada, ela define o contorno 2D local da laje.
    Caso contrario, usa o retangulo parametrico `length` x `width`.

    `predefined_type`: None/"FLOOR" para laje comum, "BASESLAB" para radier
    (laje de fundação) - mesma geometria, so muda a semantica IFC.
    """
    with mutate(entry) as f:
        body = get_body_context(f)
        slab = ifcopenshell.api.run(
            "root.create_entity",
            f,
            ifc_class="IfcSlab",
            name=name,
            **({"predefined_type": predefined_type} if predefined_type else {}),
        )
        if polyline is None:
            slab_polyline = [(0.0, 0.0), (length, 0.0), (length, width), (0.0, width)]
        else:
            if len(polyline) < 3:
                raise ValueError("polyline da laje precisa de ao menos 3 pontos")
            slab_polyline = []
            for point in polyline:
                if len(point) < 2:
                    raise ValueError("cada ponto da polyline precisa ter x e y")
                slab_polyline.append((float(point[0]), float(point[1])))
        rep = ifcopenshell.api.run(
            "geometry.add_slab_representation",
            f,
            context=body,
            depth=thickness,
            polyline=slab_polyline,
        )
        ifcopenshell.api.run(
            "geometry.assign_representation", f, product=slab, representation=rep
        )
        place_product(f, slab, matrix_from(position, rotation_z), storey_guid)
        write_params(
            f,
            slab,
            {
                "thickness": thickness,
                "polyline": [list(p) for p in slab_polyline],
                "predefined_type": predefined_type,
            },
        )
    return slab


def create_ih_profile(
    f: ifcopenshell.file,
    h: float,
    b: float,
    tw: float,
    tf: float,
    name: str | None = None,
):
    """Dimensões recebidas em metros; convertidas para as unidades do arquivo
    (mesma convenção de `rect_profile`)."""
    scale = ifcopenshell.util.unit.calculate_unit_scale(f)  # file unit -> m
    return f.create_entity(
        "IfcIShapeProfileDef",
        ProfileType="AREA",
        ProfileName=name,
        OverallWidth=b / scale,
        OverallDepth=h / scale,
        WebThickness=tw / scale,
        FlangeThickness=tf / scale,
    )


def create_lh_profile(
    f: ifcopenshell.file,
    h: float,
    b: float,
    tw: float,
    tf: float,
    name: str | None = None,
):
    scale = ifcopenshell.util.unit.calculate_unit_scale(f)  # file unit -> m
    return f.create_entity(
        "IfcLShapeProfileDef",
        ProfileType="AREA",
        ProfileName=name,
        Depth=h / scale,
        Width=b / scale,
        Thickness=tw / scale,
        FilletRadius=0.0,
    )


def create_u_profile(
    f: ifcopenshell.file,
    h: float,
    b: float,
    tw: float,
    tf: float,
    name: str | None = None,
):
    scale = ifcopenshell.util.unit.calculate_unit_scale(f)  # file unit -> m
    return f.create_entity(
        "IfcUShapeProfileDef",
        ProfileType="AREA",
        ProfileName=name,
        Depth=h / scale,
        FlangeWidth=b / scale,
        WebThickness=tw / scale,
        FlangeThickness=tf / scale,
        FlangeSlope=0.0,
    )


def create_circular_profile(
    f: ifcopenshell.file,
    d: float,
    name: str | None = None,
):
    scale = ifcopenshell.util.unit.calculate_unit_scale(f)  # file unit -> m
    radius = (d / 2.0) / scale
    return f.create_entity(
        "IfcCircleProfileDef",
        ProfileType="AREA",
        ProfileName=name,
        Radius=radius,
        Position=f.create_entity(
            "IfcAxis2Placement2D",
            Location=f.create_entity("IfcCartesianPoint", Coordinates=[0.0, 0.0]),
        ),
    )


def create_rectangle_hollow_profile(
    f: ifcopenshell.file,
    b: float,
    h: float,
    tw: float,
    tf: float,
    name: str | None = None,
):
    scale = ifcopenshell.util.unit.calculate_unit_scale(f)  # file unit -> m
    return f.create_entity(
        "IfcRectangleHollowProfileDef",
        ProfileType="AREA",
        ProfileName=name,
        XDim=b / scale,
        YDim=h / scale,
        WallThickness=tw / scale,
        InnerFilletRadius=0.0,
    )


def _profile_entity_for(
    f,
    width: float,
    depth: float,
    profile: str | None,
    shape: str | None,
    h: float | None,
    b: float | None,
    tw: float | None,
    tf: float | None,
):
    """Escolhe/gera o IfcProfileDef de acordo com `shape` (perfil real de
    catálogo/personalizado) ou cai para um retângulo simples (concreto) se
    `shape`/`h`/`b`/`tw`/`tf` não vierem completos. Usado por `create_column`,
    `create_beam` e as respectivas `edit_*_dimensions`, para garantir que
    criação e edição gerem exatamente o mesmo perfil a partir dos mesmos
    parâmetros.
    """
    if shape and h and b and tw and tf:
        if shape == "I" or shape == "H":
            return create_ih_profile(f, h, b, tw, tf, name=profile)
        if shape == "U":
            return create_u_profile(f, h, b, tw, tf, name=profile)
        if shape == "L":
            return create_lh_profile(f, h, b, tw, tf, name=profile)
        if shape == "Tubular Circ.":
            return create_circular_profile(f, h, name=profile)
        if shape == "Tubular Ret.":
            return create_rectangle_hollow_profile(f, b, h, tw, tf, name=profile)
    return rect_profile(f, width, depth)


def create_column(
    entry: ModelEntry,
    name: str | None,
    width: float,
    depth: float,
    height: float,
    position=(0.0, 0.0, 0.0),
    rotation_z: float = 0.0,
    storey_guid: str | None = None,
    profile: str | None = None,
    shape: str | None = None,
    h: float | None = None,
    b: float | None = None,
    tw: float | None = None,
    tf: float | None = None,
    top_level_guid: str | None = None,
    base_offset: float = 0.0,
    top_offset: float = 0.0,
) -> ifcopenshell.entity_instance:
    """Cria um IfcColumn com perfil real de acordo com os parâmetros recebidos."""
    with mutate(entry) as f:
        body = get_body_context(f)
        column = ifcopenshell.api.run(
            "root.create_entity", f, ifc_class="IfcColumn", name=name
        )
        profile_entity = _profile_entity_for(f, width, depth, profile, shape, h, b, tw, tf)
        rep = ifcopenshell.api.run(
            "geometry.add_profile_representation",
            f,
            context=body,
            profile=profile_entity,
            depth=height,
        )
        ifcopenshell.api.run(
            "geometry.assign_representation", f, product=column, representation=rep
        )
        place_product(f, column, matrix_from(position, rotation_z), storey_guid)
        write_params(
            f,
            column,
            {
                "width": width, "depth": depth, "height": height,
                "profile": profile, "shape": shape,
                "h": h, "b": b, "tw": tw, "tf": tf,
                "base_level_guid": storey_guid,
                "top_level_guid": top_level_guid,
                "base_offset": float(base_offset),
                "top_offset": float(top_offset),
            },
        )
    return column


def create_beam(
    entry: ModelEntry,
    name: str | None,
    width: float,
    depth: float,
    length: float,
    position=(0.0, 0.0, 0.0),
    rotation_z: float = 0.0,
    storey_guid: str | None = None,
    profile: str | None = None,
    shape: str | None = None,
    h: float | None = None,
    b: float | None = None,
    tw: float | None = None,
    tf: float | None = None,
) -> ifcopenshell.entity_instance:
    """Cria um IfcBeam extrudado na horizontal (eixo X), com perfil real de
    acordo com os parâmetros recebidos (mesma lógica de `create_column`).

    O perfil é extrudado ao longo do +Z local; o placement aplica Ry(90°) para
    deitar a viga (eixo local +Z -> +X do mundo), depois Rz(rotation_z) e a
    translação.
    """
    with mutate(entry) as f:
        body = get_body_context(f)
        beam = ifcopenshell.api.run(
            "root.create_entity", f, ifc_class="IfcBeam", name=name
        )
        profile_entity = _profile_entity_for(f, width, depth, profile, shape, h, b, tw, tf)
        rep = ifcopenshell.api.run(
            "geometry.add_profile_representation",
            f,
            context=body,
            profile=profile_entity,
            depth=length,
        )
        ifcopenshell.api.run(
            "geometry.assign_representation", f, product=beam, representation=rep
        )
        # Orienta a viga: rotação cíclica dos eixos locais para o mundo —
        # X(width)->Y, Y(depth)->Z (altura), Z(extrusão=length)->X (eixo).
        # As colunas são as imagens de x,y,z locais no mundo.
        orient = np.array(
            [[0.0, 0.0, 1.0, 0.0],
             [1.0, 0.0, 0.0, 0.0],
             [0.0, 1.0, 0.0, 0.0],
             [0.0, 0.0, 0.0, 1.0]]
        )
        matrix = matrix_from(position, rotation_z) @ orient
        place_product(f, beam, matrix, storey_guid)
        write_params(
            f,
            beam,
            {
                "width": width, "depth": depth, "length": length,
                "profile": profile, "shape": shape,
                "h": h, "b": b, "tw": tw, "tf": tf,
            },
        )
    return beam


def _rect(width: float, length: float, z: float) -> list[tuple[float, float, float]]:
    """4 cantos de um retangulo centrado em (0,0), no plano `z`, em ordem CCW
    vista de +Z (usado como bloco de montagem da malha da fundacao)."""
    hw, hl = width / 2.0, length / 2.0
    return [(-hw, -hl, z), (hw, -hl, z), (hw, hl, z), (-hw, hl, z)]


def _footing_mesh(
    base_width: float,
    base_length: float,
    top_width: float,
    top_length: float,
    height: float,
    pedestal_width: float | None,
    pedestal_length: float | None,
    pedestal_height: float,
    base_height: float = 0.0,
) -> tuple[list[tuple[float, float, float]], list[list[int]]]:
    """Malha local (base em z=0, centrada em X/Y) em ate 3 estagios
    empilhados:

    1. "rodape" reto opcional (`base_height` > 0): caixa base_width x
       base_length, paredes verticais - a base retangular vista na planta
       antes do afunilamento comecar (o "degrau" na base do desenho).
    2. TRONCO DE PIRAMIDE: base_width x base_length -> top_width x
       top_length, com `height` de altura. Se base == top, degenera numa
       caixa reta (usado pelo bloco).
    3. PEDESTAL opcional (prisma reto) em cima. Se pedestal_width/length
       forem None (ou iguais ao topo do tronco), solda direto, sem aba;
       caso contrario sobra uma aba horizontal (moldura).

    Retorna (vertices, faces) prontos para `geometry.add_mesh_representation`
    (uma unica IfcRepresentationItem).
    """
    has_base_lip = bool(base_height and base_height > 0)
    has_pedestal = bool(pedestal_height and pedestal_height > 0)
    pw = pedestal_width if (has_pedestal and pedestal_width) else top_width
    pl = pedestal_length if (has_pedestal and pedestal_length) else top_length

    z_frustum_bottom = base_height if has_base_lip else 0.0
    z_frustum_top = z_frustum_bottom + height

    bottom = _rect(base_width, base_length, 0.0)
    verts: list[tuple[float, float, float]] = list(bottom)
    faces: list[list[int]] = [[0, 3, 2, 1]]  # base (normal para baixo)

    frustum_bottom_idx = 0
    if has_base_lip:
        lip_top = _rect(base_width, base_length, z_frustum_bottom)
        frustum_bottom_idx = len(verts)
        verts += lip_top
        for i in range(4):  # laterais RETAS do rodape
            j = (i + 1) % 4
            faces.append([i, j, frustum_bottom_idx + j, frustum_bottom_idx + i])

    top = _rect(top_width, top_length, z_frustum_top)
    top_idx = len(verts)
    verts += top
    for i in range(4):  # laterais do tronco (afunilando)
        j = (i + 1) % 4
        faces.append(
            [frustum_bottom_idx + i, frustum_bottom_idx + j, top_idx + j, top_idx + i]
        )

    if not has_pedestal:
        faces.append([top_idx, top_idx + 1, top_idx + 2, top_idx + 3])  # topo
        return verts, faces

    pb = _rect(pw, pl, z_frustum_top)                      # base do pedestal
    pt = _rect(pw, pl, z_frustum_top + pedestal_height)     # topo do pedestal
    i_pb, i_pt = len(verts), len(verts) + 4
    verts += pb + pt

    same_footprint = abs(pw - top_width) < 1e-6 and abs(pl - top_length) < 1e-6
    if not same_footprint:
        # aba horizontal (moldura) entre o topo do tronco e a base do pedestal
        for i in range(4):
            j = (i + 1) % 4
            faces.append([top_idx + i, top_idx + j, i_pb + j, i_pb + i])

    for i in range(4):  # laterais do pedestal
        j = (i + 1) % 4
        faces.append([i_pb + i, i_pb + j, i_pt + j, i_pt + i])
    faces.append([i_pt, i_pt + 1, i_pt + 2, i_pt + 3])  # topo do pedestal

    return verts, faces


def create_footing(
    entry: ModelEntry,
    name: str | None,
    base_width: float,
    base_length: float,
    height: float,
    top_width: float | None = None,
    top_length: float | None = None,
    base_height: float = 0.0,
    pedestal_width: float | None = None,
    pedestal_length: float | None = None,
    pedestal_height: float = 0.0,
    position=(0.0, 0.0, 0.0),
    rotation_z: float = 0.0,
    storey_guid: str | None = None,
    predefined_type: str = "PAD_FOOTING",
    pile_count: int | None = None,
    pile_diameter: float | None = None,
) -> ifcopenshell.entity_instance:
    """Cria um IfcFooting como malha (`geometry.add_mesh_representation`):

    - rodape reto opcional (`base_height`) antes do afunilamento
    - sapata: `top_width`/`top_length` menores que a base -> tronco de piramide
    - bloco: `top_width`/`top_length` == base (padrao) -> caixa reta
    - pedestal opcional em cima (prisma reto), com aba se for mais estreito
      que o topo do tronco/caixa

    `predefined_type`: "PAD_FOOTING" (sapata) ou "PILE_CAP" (bloco).
    `position` e a face INFERIOR (base do rodape, ou do tronco se
    base_height=0), centrada em planta - mesma convencao das demais
    geometrias (coluna, laje).
    """
    top_width = top_width if top_width is not None else base_width
    top_length = top_length if top_length is not None else base_length
    with mutate(entry) as f:
        body = get_body_context(f)
        footing = ifcopenshell.api.run(
            "root.create_entity",
            f,
            ifc_class="IfcFooting",
            name=name,
            predefined_type=predefined_type,
        )
        verts, faces = _footing_mesh(
            base_width,
            base_length,
            top_width,
            top_length,
            height,
            pedestal_width,
            pedestal_length,
            pedestal_height,
            base_height,
        )
        rep = ifcopenshell.api.run(
            "geometry.add_mesh_representation",
            f,
            context=body,
            vertices=[verts],
            faces=[faces],
        )
        ifcopenshell.api.run(
            "geometry.assign_representation", f, product=footing, representation=rep
        )
        place_product(f, footing, matrix_from(position, rotation_z), storey_guid)
        if pile_count:
            try:
                pile_pset = ifcopenshell.api.run(
                    "pset.add_pset", f, product=footing, name="Pset_FoundationCommon"
                )
                ifcopenshell.api.run(
                    "pset.edit_pset",
                    f,
                    pset=pile_pset,
                    properties={
                        "PileCount": pile_count,
                        **({"PileDiameter": pile_diameter} if pile_diameter else {}),
                    },
                )
            except Exception:
                pass  # metadados informativos; nao bloqueiam a criacao da geometria
        write_params(
            f,
            footing,
            {
                "predefined_type": predefined_type,
                "base_width": base_width, "base_length": base_length,
                "height": height,
                "top_width": top_width, "top_length": top_length,
                "base_height": base_height,
                "pedestal_width": pedestal_width, "pedestal_length": pedestal_length,
                "pedestal_height": pedestal_height,
                "pile_count": pile_count, "pile_diameter": pile_diameter,
            },
        )
    return footing


def edit_placement(entry: ModelEntry, guid: str, matrix) -> None:
    """Atualiza o ObjectPlacement de um produto a partir de uma matriz 4x4.

    A matriz é absoluta e em metros (a `geometry.edit_object_placement`
    converte para as unidades do arquivo ao gravar).
    """
    m = np.array(matrix, dtype=float).reshape(4, 4)
    with mutate(entry) as f:
        inst = f.by_guid(guid)
        ifcopenshell.api.run(
            "geometry.edit_object_placement", f, product=inst, matrix=m
        )


def transform_product(
    entry: ModelEntry,
    guid: str,
    translate=None,
    rotate_z: float | None = None,
    rotation_matrix=None,
    rotation_center=None,
) -> None:
    """Compõe translação e/ou rotação Z **relativas** sobre o placement atual.

    Composição feita no servidor — onde o placement corrente é conhecido — para
    que o frontend só precise enviar o delta do gizmo. O placement bruto vem nas
    unidades do arquivo (ex.: mm); convertemos para metros antes de compor e a
    API reconverte ao gravar. A rotação é em torno da origem do objeto (eixos do
    mundo), em radianos, ou de `rotation_center` quando informado.
    """
    with mutate(entry) as f:
        scale = ifcopenshell.util.unit.calculate_unit_scale(f)  # file unit -> m
        inst = f.by_guid(guid)
        m = np.array(
            ifcopenshell.util.placement.get_local_placement(inst.ObjectPlacement),
            dtype=float,
        )
        m[:3, 3] *= scale  # unidades do arquivo -> metros
        rot = None
        if rotation_matrix is not None:
            rot = np.array(rotation_matrix, dtype=float).reshape(3, 3)
        elif rotate_z:
            c, s = math.cos(rotate_z), math.sin(rotate_z)
            rot = np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])
        if rot is not None:
            if rotation_center is not None:
                center = np.array(rotation_center, dtype=float)
                m[:3, 3] = center + rot @ (m[:3, 3] - center)
            m[:3, :3] = rot @ m[:3, :3]
        if translate is not None:
            m[:3, 3] += np.array(translate, dtype=float)
        ifcopenshell.api.run(
            "geometry.edit_object_placement", f, product=inst, matrix=m
        )


def translate_product(entry: ModelEntry, guid: str, delta) -> None:
    """Atalho: translação relativa (metros). Ver `transform_product`."""
    transform_product(entry, guid, translate=delta)


def _replace_body_representation(f, product, new_rep) -> None:
    """Troca a representação Body de um produto por outra já pronta
    (`new_rep`), preservando GlobalId e ObjectPlacement.

    Padrão comum a toda edição de dimensões "em vivo" (sem apagar/refazer o
    elemento): remove a representação Body anterior (se houver) e associa a
    nova. Usado por todas as `edit_*_dimensions` abaixo.
    """
    old = ifcopenshell.util.representation.get_representation(
        product, "Model", "Body", "MODEL_VIEW"
    )
    if old is not None:
        ifcopenshell.api.run(
            "geometry.unassign_representation",
            f,
            product=product,
            representation=old,
        )
        ifcopenshell.api.run("geometry.remove_representation", f, representation=old)
    ifcopenshell.api.run(
        "geometry.assign_representation", f, product=product, representation=new_rep
    )


def edit_wall_dimensions(
    entry: ModelEntry,
    guid: str,
    length: float,
    height: float,
    thickness: float,
) -> None:
    """Regenera a representação de uma parede com novas dimensões.

    Remove a representação Body anterior e cria outra; o placement é preservado.
    """
    with mutate(entry) as f:
        wall = f.by_guid(guid)
        body = get_body_context(f)
        rep = ifcopenshell.api.run(
            "geometry.add_wall_representation",
            f,
            context=body,
            length=length,
            height=height,
            thickness=thickness,
        )
        _replace_body_representation(f, wall, rep)


def edit_column_dimensions(
    entry: ModelEntry,
    guid: str,
    width: float,
    depth: float,
    height: float,
    profile: str | None = None,
    shape: str | None = None,
    h: float | None = None,
    b: float | None = None,
    tw: float | None = None,
    tf: float | None = None,
) -> None:
    """Regenera a seção/altura de um pilar já existente (mesma lógica de
    `create_column`), sem apagar o elemento — placement preservado."""
    with mutate(entry) as f:
        column = f.by_guid(guid)
        body = get_body_context(f)
        profile_entity = _profile_entity_for(f, width, depth, profile, shape, h, b, tw, tf)
        rep = ifcopenshell.api.run(
            "geometry.add_profile_representation",
            f,
            context=body,
            profile=profile_entity,
            depth=height,
        )
        _replace_body_representation(f, column, rep)
        write_params(
            f,
            column,
            {
                "width": width, "depth": depth, "height": height,
                "profile": profile, "shape": shape,
                "h": h, "b": b, "tw": tw, "tf": tf,
            },
        )


def _beam_profile_representation(f, body, profile_entity, length: float, trim_start: float = 0.0, trim_end: float = 0.0):
    """`add_profile_representation` com recorte real nas pontas (IfcBooleanClippingResult
    de um IfcHalfSpaceSolid) — usado pra "encaixar pela face" em vez de ir até
    o eixo do apoio (ver `connectivity_service.beam_end_trims`). Convenção
    verificada empiricamente: `normal=(0,0,-1)` em `location=(0,0,trim_start)`
    remove o trecho z<trim_start; `normal=(0,0,1)` em `location=(0,0,length-trim_end)`
    remove o trecho z>length-trim_end.
    """
    clippings = []
    if trim_start > 1e-6:
        clippings.append({"location": (0.0, 0.0, trim_start), "normal": (0.0, 0.0, -1.0)})
    if trim_end > 1e-6:
        clippings.append({"location": (0.0, 0.0, length - trim_end), "normal": (0.0, 0.0, 1.0)})
    return ifcopenshell.api.run(
        "geometry.add_profile_representation",
        f, context=body, profile=profile_entity, depth=length, clippings=clippings,
    )


def _set_beam_end_trims_f(f: ifcopenshell.file, guid: str, trim_start: float, trim_end: float) -> None:
    """Regenera a Representation da viga com o recorte de ponta atual (ou
    remove o recorte, se `trim_start`/`trim_end` forem 0) — sem tocar em
    `Pset_ParametricSource` (o comprimento lógico ali continua eixo-a-eixo;
    o recorte é só da geometria exportada). Versão "pura" (recebe `f`
    diretamente) para ser chamada de dentro de um `with mutate(entry) as f:`
    já aberto — ver `connectivity_service._resync_connections`."""
    beam = f.by_guid(guid)
    body = get_body_context(f)
    params = get_params_f(f, guid) or {}
    width = float(params.get("width") or 0.0)
    depth = float(params.get("depth") or 0.0)
    length = float(params.get("length") or 0.0)
    if length <= 0:
        return
    profile_entity = _profile_entity_for(
        f, width, depth, params.get("profile"), params.get("shape"),
        params.get("h"), params.get("b"), params.get("tw"), params.get("tf"),
    )
    rep = _beam_profile_representation(f, body, profile_entity, length, trim_start, trim_end)
    _replace_body_representation(f, beam, rep)


def edit_beam_dimensions(
    entry: ModelEntry,
    guid: str,
    width: float,
    depth: float,
    length: float,
    profile: str | None = None,
    shape: str | None = None,
    h: float | None = None,
    b: float | None = None,
    tw: float | None = None,
    tf: float | None = None,
) -> None:
    """Regenera a seção/comprimento de uma viga já existente (mesma lógica de
    `create_beam`), sem apagar o elemento — placement/orientação preservados.

    `length` altera o comprimento da extrusão ao longo do eixo local já
    definido no placement (não move a viga nem reposiciona suas pontas).
    """
    with mutate(entry) as f:
        beam = f.by_guid(guid)
        body = get_body_context(f)
        profile_entity = _profile_entity_for(f, width, depth, profile, shape, h, b, tw, tf)
        rep = ifcopenshell.api.run(
            "geometry.add_profile_representation",
            f,
            context=body,
            profile=profile_entity,
            depth=length,
        )
        _replace_body_representation(f, beam, rep)
        write_params(
            f,
            beam,
            {
                "width": width, "depth": depth, "length": length,
                "profile": profile, "shape": shape,
                "h": h, "b": b, "tw": tw, "tf": tf,
            },
        )


def edit_footing_dimensions(
    entry: ModelEntry,
    guid: str,
    base_width: float,
    base_length: float,
    height: float,
    top_width: float | None = None,
    top_length: float | None = None,
    base_height: float = 0.0,
    pedestal_width: float | None = None,
    pedestal_length: float | None = None,
    pedestal_height: float = 0.0,
    pile_count: int | None = None,
    pile_diameter: float | None = None,
) -> None:
    """Regenera a malha de uma fundação já existente (mesma lógica de
    `create_footing`), sem apagar o elemento — placement e `predefined_type`
    (sapata/bloco) preservados.
    """
    top_width = top_width if top_width is not None else base_width
    top_length = top_length if top_length is not None else base_length
    with mutate(entry) as f:
        footing = f.by_guid(guid)
        body = get_body_context(f)
        verts, faces = _footing_mesh(
            base_width, base_length, top_width, top_length, height,
            pedestal_width, pedestal_length, pedestal_height, base_height,
        )
        rep = ifcopenshell.api.run(
            "geometry.add_mesh_representation",
            f, context=body, vertices=[verts], faces=[faces],
        )
        _replace_body_representation(f, footing, rep)
        if pile_count:
            try:
                pile_pset = ifcopenshell.api.run(
                    "pset.add_pset", f, product=footing, name="Pset_FoundationCommon"
                )
                ifcopenshell.api.run(
                    "pset.edit_pset",
                    f,
                    pset=pile_pset,
                    properties={
                        "PileCount": pile_count,
                        **({"PileDiameter": pile_diameter} if pile_diameter else {}),
                    },
                )
            except Exception:
                pass
        write_params(
            f,
            footing,
            {
                "predefined_type": footing.PredefinedType,
                "base_width": base_width, "base_length": base_length,
                "height": height,
                "top_width": top_width, "top_length": top_length,
                "base_height": base_height,
                "pedestal_width": pedestal_width, "pedestal_length": pedestal_length,
                "pedestal_height": pedestal_height,
                "pile_count": pile_count, "pile_diameter": pile_diameter,
            },
        )


def edit_slab_dimensions(
    entry: ModelEntry,
    guid: str,
    thickness: float,
) -> None:
    """Regenera a espessura de uma laje/radier já existente, mantendo o
    contorno (polyline) original — o formulário de edição não permite mudar a
    planta, só a espessura (a planta continua editável recriando o elemento a
    partir do esboço 2D).
    """
    with mutate(entry) as f:
        slab = f.by_guid(guid)
        body = get_body_context(f)
        params = get_params(entry, guid) or {}
        polyline = [tuple(p) for p in params.get("polyline", [])]
        if len(polyline) < 3:
            raise RuntimeError(
                "laje sem parâmetros de origem gravados; recrie-a para habilitar a edição"
            )
        rep = ifcopenshell.api.run(
            "geometry.add_slab_representation",
            f, context=body, depth=thickness, polyline=polyline,
        )
        _replace_body_representation(f, slab, rep)
        write_params(f, slab, {**params, "thickness": thickness})
