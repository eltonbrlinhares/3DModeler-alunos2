"""Vistas formalizadas como `IfcAnnotation` — Fase 2, item 3.

Cada vista do sistema de vistas do frontend (planta/corte/elevação/3D — ver
`frontend/src/view/viewModel.js`) pode ser espelhada aqui como um
`IfcAnnotation`, com um marcador geométrico simples (um "tripé" de 3 linhas
+ o nome como texto) na origem da vista, e os parâmetros de câmera (tipo,
direção, up, crop/view range) guardados como JSON num Pset — mesmo padrão
do `Pset_ParametricSource`.

Ressalva importante (documentada, não escondida): isso NÃO faz nenhum
visualizador "ativar" a câmera ao abrir o arquivo — o IFC não tem uma
entidade nativa pra "estado de câmera ativa" (isso é mais escopo do BCF).
O que ganhamos é mais modesto e ainda assim real: a vista passa a EXISTIR
no arquivo (sobrevive a save/reload, aparece como marcador anotado pra
qualquer visualizador que entenda `IfcAnnotation`) — ao contrário de hoje,
em que ela só existe no `localStorage` do navegador.

Upsert por `view_id` (o id do frontend, tipo "view-plan-xyz") — permite
sincronizar sem duplicar toda vez que o usuário edita a vista.
"""
from __future__ import annotations

import json

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.util.representation

from app.services._mutation import mutate
from app.services.geometry_service import matrix_from
from app.services.ifc_service import ModelEntry

OBJECT_TYPE = "BIM_VIEW"
PSET_NAME = "Pset_ViewSource"
_TRIPOD = 0.4  # metros -- tamanho do marcador de vista


def _annotation_context(f: ifcopenshell.file):
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


def _pt(f, x: float, y: float, z: float):
    return f.create_entity("IfcCartesianPoint", Coordinates=[float(x), float(y), float(z)])


def _polyline(f, pts):
    return f.create_entity("IfcPolyline", Points=[_pt(f, *p) for p in pts])


def _text(f, label: str, x: float, y: float, z: float):
    placement = f.create_entity(
        "IfcAxis2Placement3D",
        Location=_pt(f, x, y, z),
        Axis=f.create_entity("IfcDirection", DirectionRatios=[0.0, 0.0, 1.0]),
        RefDirection=f.create_entity("IfcDirection", DirectionRatios=[1.0, 0.0, 0.0]),
    )
    return f.create_entity("IfcTextLiteral", Literal=label, Placement=placement, Path="RIGHT")


def _marker_items(f, name: str):
    """Um "tripé" de 3 linhas ortogonais + o nome como texto — só pra dar um
    marcador visível e válido no arquivo, não é uma representação real de
    câmera/frustum (fora de escopo)."""
    s = _TRIPOD
    return [
        _polyline(f, [(-s, 0, 0), (s, 0, 0)]),
        _polyline(f, [(0, -s, 0), (0, s, 0)]),
        _polyline(f, [(0, 0, -s), (0, 0, s)]),
        _text(f, name, s * 1.1, s * 1.1, 0.0),
    ]


def _find_pset(product, name: str):
    for rel in getattr(product, "IsDefinedBy", None) or ():
        if rel.is_a("IfcRelDefinesByProperties"):
            pdef = rel.RelatingPropertyDefinition
            if pdef.is_a("IfcPropertySet") and pdef.Name == name:
                return pdef
    return None


def _find_view_annotation(f: ifcopenshell.file, view_id: str):
    for ann in f.by_type("IfcAnnotation"):
        if ann.ObjectType != OBJECT_TYPE:
            continue
        pset = _find_pset(ann, PSET_NAME)
        if pset is None:
            continue
        for prop in pset.HasProperties:
            if prop.Name == "ViewId" and prop.NominalValue and prop.NominalValue.wrappedValue == view_id:
                return ann
    return None


def upsert_view_annotation(
    entry: ModelEntry, view_id: str, name: str, origin: tuple[float, float, float], params: dict
) -> str:
    """Cria (ou atualiza, se `view_id` já existir) o `IfcAnnotation` daquela
    vista. `params` é gravado como está (tipo, direção, up, crop/view range
    — o que o frontend já tiver) num Pset, sem validar o conteúdo — é o
    frontend que sabe o formato de cada tipo de vista."""
    with mutate(entry) as f:
        ann = _find_view_annotation(f, view_id)
        if ann is None:
            ctx = _annotation_context(f)
            items = _marker_items(f, name)
            rep = f.create_entity(
                "IfcShapeRepresentation", ContextOfItems=ctx,
                RepresentationIdentifier="Annotation", RepresentationType="Annotation2D",
                Items=items,
            )
            ann = ifcopenshell.api.run(
                "root.create_entity", f, ifc_class="IfcAnnotation", name=name
            )
            ann.ObjectType = OBJECT_TYPE
            ifcopenshell.api.run("geometry.assign_representation", f, product=ann, representation=rep)
        else:
            ann.Name = name
        ifcopenshell.api.run(
            "geometry.edit_object_placement", f, product=ann, matrix=matrix_from(tuple(origin))
        )
        pset = _find_pset(ann, PSET_NAME)
        if pset is None:
            pset = ifcopenshell.api.run("pset.add_pset", f, product=ann, name=PSET_NAME)
        ifcopenshell.api.run(
            "pset.edit_pset", f, pset=pset,
            properties={"ViewId": view_id, "ParamsJSON": json.dumps(params)},
        )
        return ann.GlobalId


def delete_view_annotation(entry: ModelEntry, view_id: str) -> bool:
    with mutate(entry) as f:
        ann = _find_view_annotation(f, view_id)
        if ann is None:
            return False
        ifcopenshell.api.run("root.remove_product", f, product=ann)
        return True


def list_view_annotations(entry: ModelEntry) -> list[dict]:
    f = entry.file
    out = []
    for ann in f.by_type("IfcAnnotation"):
        if ann.ObjectType != OBJECT_TYPE:
            continue
        pset = _find_pset(ann, PSET_NAME)
        if pset is None:
            continue
        props = {p.Name: p.NominalValue.wrappedValue for p in pset.HasProperties if p.NominalValue}
        params = {}
        if props.get("ParamsJSON"):
            try:
                params = json.loads(props["ParamsJSON"])
            except (TypeError, ValueError):
                params = {}
        out.append(
            {
                "guid": ann.GlobalId,
                "view_id": props.get("ViewId"),
                "name": ann.Name,
                "params": params,
            }
        )
    return out
