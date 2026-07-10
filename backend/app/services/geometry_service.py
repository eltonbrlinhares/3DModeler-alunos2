"""Criação e edição de geometria paramétrica IFC (Fase 1+2).

Toda manipulação de forma e posição passa por `ifcopenshell.api` para preservar
inverses e manter o arquivo válido. Coordenadas são sempre IFC (Z-up, metros).

Toda função que muta o modelo usa `with mutate(entry) as f:` (lock + snapshot de
undo + dirty). Para adicionar uma geometria nova, copie `create_column` e ajuste
a representação — ver estrutura_pedagogica_backend.md.
"""
from __future__ import annotations

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
) -> ifcopenshell.entity_instance:
    """Cria um IfcSlab extrudado a partir do placement local.

    Se `polyline` for informada, ela define o contorno 2D local da laje.
    Caso contrario, usa o retangulo parametrico `length` x `width`.
    """
    with mutate(entry) as f:
        body = get_body_context(f)
        slab = ifcopenshell.api.run(
            "root.create_entity", f, ifc_class="IfcSlab", name=name
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
    return slab


def create_ih_profile(
    f: ifcopenshell.file,
    h: float,
    b: float,
    tw: float,
    tf: float,
    name: str | None = None,
):
    return f.create_entity(
        "IfcIShapeProfileDef",
        ProfileType="AREA",
        ProfileName=name,
        OverallHeight=h,
        OverallWidth=b,
        WebThickness=tw,
        FlangeThickness=tf,
    )


def create_lh_profile(
    f: ifcopenshell.file,
    h: float,
    b: float,
    tw: float,
    tf: float,
    name: str | None = None,
):
    return f.create_entity(
        "IfcLShapeProfileDef",
        ProfileType="AREA",
        ProfileName=name,
        OverallHeight=h,
        OverallWidth=b,
        Thickness=tw,
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
    return f.create_entity(
        "IfcUShapeProfileDef",
        ProfileType="AREA",
        ProfileName=name,
        OverallHeight=h,
        OverallWidth=b,
        WebThickness=tw,
        FlangeThickness=tf,
        FlangeSlope=0.0,
    )


def create_circular_profile(
    f: ifcopenshell.file,
    d: float,
    name: str | None = None,
):
    radius = d / 2.0
    outer_curve = f.create_entity("IfcCircle", Radius=radius)
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
    return f.create_entity(
        "IfcRectangleHollowProfileDef",
        ProfileType="AREA",
        ProfileName=name,
        OverallWidth=b,
        OverallHeight=h,
        WallThickness=tw,
        InnerFilletRadius=0.0,
    )


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
) -> ifcopenshell.entity_instance:
    """Cria um IfcColumn com perfil real de acordo com os parâmetros recebidos."""
    with mutate(entry) as f:
        body = get_body_context(f)
        column = ifcopenshell.api.run(
            "root.create_entity", f, ifc_class="IfcColumn", name=name
        )
        if shape and h and b and tw and tf:
            if shape == "I" or shape == "H":
                profile_entity = create_ih_profile(f, h, b, tw, tf, name=profile)
            elif shape == "U":
                profile_entity = create_u_profile(f, h, b, tw, tf, name=profile)
            elif shape == "L":
                profile_entity = create_lh_profile(f, h, b, tw, tf, name=profile)
            elif shape == "Tubular Circ.":
                profile_entity = create_circular_profile(f, h, name=profile)
            elif shape == "Tubular Ret.":
                profile_entity = create_rectangle_hollow_profile(f, b, h, tw, tf, name=profile)
            else:
                profile_entity = rect_profile(f, width, depth)
        else:
            profile_entity = rect_profile(f, width, depth)

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
) -> ifcopenshell.entity_instance:
    """Cria um IfcBeam de seção retangular extrudada na horizontal (eixo X).

    O perfil é extrudado ao longo do +Z local; o placement aplica Ry(90°) para
    deitar a viga (eixo local +Z -> +X do mundo), depois Rz(rotation_z) e a
    translação.
    """
    with mutate(entry) as f:
        body = get_body_context(f)
        beam = ifcopenshell.api.run(
            "root.create_entity", f, ifc_class="IfcBeam", name=name
        )
        profile = rect_profile(f, width, depth)
        rep = ifcopenshell.api.run(
            "geometry.add_profile_representation",
            f,
            context=body,
            profile=profile,
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
    return beam


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
        old = ifcopenshell.util.representation.get_representation(
            wall, "Model", "Body", "MODEL_VIEW"
        )
        if old is not None:
            ifcopenshell.api.run(
                "geometry.unassign_representation",
                f,
                product=wall,
                representation=old,
            )
            ifcopenshell.api.run(
                "geometry.remove_representation", f, representation=old
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
