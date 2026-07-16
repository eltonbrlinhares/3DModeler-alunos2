"""Cotas manuais ponto-a-ponto (`IfcAnnotation`) — Fase 2 (cotas).

O usuário clica em dois pontos (na planta, num corte, ou numa elevação) e
uma cota linear é criada entre eles: linha de cota + marca de extremidade em
cada ponta + o texto da distância real. Geometria 3D de verdade
(`IfcCartesianPoint` com x/y/z, não achatada em 2D) — funciona igual em
qualquer vista, porque os dois pontos clicados já vêm em coordenadas de
mundo (a vista só decide COMO o usuário aponta, não onde a cota mora).

Cada cota é o próprio `IfcAnnotation`, independente das outras (diferente da
versão anterior — cadeia automática ao longo do grid — que foi descartada:
o usuário prefere apontar manualmente). Isso significa: apagar uma cota é
`root.remove_product` direto no guid dela, sem precisar recalcular nada.

Escopo desta versão: a marca de extremidade (o "tick" perpendicular à linha
de cota) é calculada dentro do PLANO da vista em que os pontos foram
clicados — por isso o parâmetro `plane` ("z" = planta, olhando de cima;
"x"/"y" = corte/elevação, olhando ao longo de X ou Y). Cortes/elevações em
ângulo arbitrário (não alinhados aos eixos do mundo) não são cobertos ainda.
"""
from __future__ import annotations

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.util.representation
import numpy as np

from app.services._mutation import mutate
from app.services.geometry_service import matrix_from
from app.services.ifc_service import ModelEntry

TICK = 0.15  # metade do comprimento da marca de extremidade (m)
TEXT_OFFSET = 0.1  # afastamento do texto em relação à linha de cota (m)

_PLANE_NORMAL = {
    "z": np.array([0.0, 0.0, 1.0]),  # planta (visto de cima)
    "x": np.array([1.0, 0.0, 0.0]),  # corte/elevação olhando ao longo de X
    "y": np.array([0.0, 1.0, 0.0]),  # corte/elevação olhando ao longo de Y
}

OBJECT_TYPE = "COTA_PONTO_A_PONTO"


def _annotation_context(f: ifcopenshell.file):
    """Get-or-create o contexto Model/Annotation/MODEL_VIEW — 3D de verdade
    (ao contrário do contexto 2D achatado que a cota de grid usava), porque
    os dois pontos clicados podem estar em qualquer plano."""
    ctx = ifcopenshell.util.representation.get_context(f, "Model", "Annotation", "MODEL_VIEW")
    if ctx is not None:
        return ctx
    parent = ifcopenshell.util.representation.get_context(f, "Model")
    if parent is None:
        parent = ifcopenshell.api.run("context.add_context", f, context_type="Model")
    return ifcopenshell.api.run(
        "context.add_context", f, context_type="Model",
        context_identifier="Annotation", target_view="MODEL_VIEW", parent=parent,
    )


def _pt(f, p) -> ifcopenshell.entity_instance:
    return f.create_entity("IfcCartesianPoint", Coordinates=[float(p[0]), float(p[1]), float(p[2])])


def _polyline(f, pts):
    return f.create_entity("IfcPolyline", Points=[_pt(f, p) for p in pts])


def _text(f, label: str, location: np.ndarray, axis: np.ndarray, ref_direction: np.ndarray):
    placement = f.create_entity(
        "IfcAxis2Placement3D",
        Location=_pt(f, location),
        Axis=f.create_entity("IfcDirection", DirectionRatios=[float(x) for x in axis]),
        RefDirection=f.create_entity("IfcDirection", DirectionRatios=[float(x) for x in ref_direction]),
    )
    return f.create_entity("IfcTextLiteral", Literal=label, Placement=placement, Path="RIGHT")


def _dimension_items(f, p0: np.ndarray, p1: np.ndarray, plane: str) -> tuple[list, float]:
    """Monta a geometria (linha + 2 marcas + texto) e devolve junto a
    distância real (pra também gravar num Pset legível)."""
    normal = _PLANE_NORMAL.get(plane, _PLANE_NORMAL["z"])
    d = p1 - p0
    length = float(np.linalg.norm(d))
    if length < 1e-6:
        raise ValueError("os dois pontos da cota não podem coincidir")
    dirv = d / length
    perp = np.cross(dirv, normal)
    perp_norm = np.linalg.norm(perp)
    if perp_norm < 1e-6:
        # direção da cota é paralela à normal do plano (ex.: cota vertical
        # numa "planta") -- usa qualquer perpendicular válida como fallback
        fallback = np.array([1.0, 0.0, 0.0]) if abs(dirv[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
        perp = np.cross(dirv, fallback)
        perp_norm = np.linalg.norm(perp)
    perp = perp / perp_norm
    tick = perp * TICK

    mid = (p0 + p1) / 2.0 + perp * TEXT_OFFSET
    items = [
        _polyline(f, [p0, p1]),
        _polyline(f, [p0 - tick, p0 + tick]),
        _polyline(f, [p1 - tick, p1 + tick]),
        _text(f, f"{length:.2f}", mid, normal, dirv),
    ]
    return items, length


def create_point_dimension(
    entry: ModelEntry, p0: tuple[float, float, float], p1: tuple[float, float, float], plane: str = "z"
) -> dict:
    """Cria uma cota entre dois pontos de mundo (metros). `plane` indica em
    qual vista os pontos foram clicados ("z"=planta, "x"/"y"=corte ou
    elevação olhando ao longo desse eixo) — só afeta a orientação da marca
    de extremidade, não a posição da linha de cota em si."""
    with mutate(entry) as f:
        ctx = _annotation_context(f)
        items, length = _dimension_items(f, np.array(p0, dtype=float), np.array(p1, dtype=float), plane)
        rep = f.create_entity(
            "IfcShapeRepresentation", ContextOfItems=ctx,
            RepresentationIdentifier="Annotation", RepresentationType="Annotation2D",
            Items=items,
        )
        ann = ifcopenshell.api.run(
            "root.create_entity", f, ifc_class="IfcAnnotation", name=f"Cota {length:.2f}m"
        )
        ann.ObjectType = OBJECT_TYPE
        ifcopenshell.api.run("geometry.assign_representation", f, product=ann, representation=rep)
        ifcopenshell.api.run("geometry.edit_object_placement", f, product=ann, matrix=matrix_from())
        pset = ifcopenshell.api.run("pset.add_pset", f, product=ann, name="Pset_DimensionSource")
        ifcopenshell.api.run(
            "pset.edit_pset", f, pset=pset,
            properties={
                "P0X": float(p0[0]), "P0Y": float(p0[1]), "P0Z": float(p0[2]),
                "P1X": float(p1[0]), "P1Y": float(p1[1]), "P1Z": float(p1[2]),
                "Plane": plane, "Length": length,
            },
        )
        return {"guid": ann.GlobalId, "length": length}


def delete_dimension(entry: ModelEntry, guid: str) -> None:
    with mutate(entry) as f:
        ann = f.by_guid(guid)
        ifcopenshell.api.run("root.remove_product", f, product=ann)


def _find_pset(product, name: str):
    for rel in getattr(product, "IsDefinedBy", None) or ():
        if rel.is_a("IfcRelDefinesByProperties"):
            pdef = rel.RelatingPropertyDefinition
            if pdef.is_a("IfcPropertySet") and pdef.Name == name:
                return pdef
    return None


def list_dimensions(entry: ModelEntry) -> list[dict]:
    """Lista as cotas ponto-a-ponto — pontos, comprimento e plano, lidos de
    volta do `Pset_DimensionSource` (não recalculados a partir da geometria
    tessellada — mais direto, já que a cota não tem malha)."""
    f = entry.file
    out = []
    for ann in f.by_type("IfcAnnotation"):
        if ann.ObjectType != OBJECT_TYPE:
            continue
        pset = _find_pset(ann, "Pset_DimensionSource")
        if pset is None:
            continue
        props = {p.Name: p.NominalValue.wrappedValue for p in pset.HasProperties if p.NominalValue}
        out.append(
            {
                "guid": ann.GlobalId,
                "p0": [props.get("P0X", 0.0), props.get("P0Y", 0.0), props.get("P0Z", 0.0)],
                "p1": [props.get("P1X", 0.0), props.get("P1Y", 0.0), props.get("P1Z", 0.0)],
                "plane": props.get("Plane", "z"),
                "length": props.get("Length", 0.0),
            }
        )
    return out
