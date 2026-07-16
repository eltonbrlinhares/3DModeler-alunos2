"""Semântica IFC complementar: material, Psets padrão certificados, e
quantitativos (Fase 9).

O `Pset_ParametricSource` (ver `geometry_service.write_params`) é ótimo pra
edição em vivo, mas é um Pset NOSSO — um visualizador de terceiro (Solibri,
BIMcollab, ou até outro app BIM) não sabe interpretar aquele JSON. Este
módulo grava, em paralelo, o vocabulário OFICIAL do IFC pros mesmos dados:

  - `IfcMaterial` (concreto ou aço, via `IfcRelAssociatesMaterial`)
  - Psets certificados (`Pset_ColumnCommon`, `Pset_BeamCommon`, etc.)
  - `IfcElementQuantity` (volume, comprimento/área, peso)

Chamado das ROTAS (`app/api/geometry.py`), nunca de dentro de
`geometry_service.py` — mesmo motivo do `connectivity_service`: evita
importação circular e mantém cada serviço com uma responsabilidade só.
"""
from __future__ import annotations

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.geom
import ifcopenshell.util.shape

from app.services import geometry_service as geo
from app.services._mutation import mutate
from app.services.ifc_service import ModelEntry

# ── material ─────────────────────────────────────────────────────────────
# Nomes genéricos de material (classe de concreto / grau de aço), não
# vinculados a nenhum fabricante — só a valores de referência comuns na
# prática brasileira (NBR 6118 pro concreto, ASTM A572 Gr.50 pro aço
# estrutural laminado, o grau mais usual pra perfis W/HP).
CONCRETE_MATERIAL = "Concreto C25"
STEEL_MATERIAL = "Aço A572 Gr. 50"

# densidades usadas SÓ pra estimar peso (constante interna — não gravada
# como propriedade formal do IfcMaterial, que exigiria um mecanismo de
# propriedades de material à parte; ver nota em `_apply_quantities`)
CONCRETE_DENSITY = 2500.0  # kgf/m3 -- peso próprio do concreto armado (NBR 6118)
STEEL_DENSITY = 7850.0  # kgf/m3 -- aço estrutural

_GEOM_SETTINGS = ifcopenshell.geom.settings()

_QTO_NAME = {
    "IfcColumn": "Qto_ColumnBaseQuantities",
    "IfcBeam": "Qto_BeamBaseQuantities",
    "IfcSlab": "Qto_SlabBaseQuantities",
    "IfcFooting": "Qto_FootingBaseQuantities",
}

_PSET_NAME = {
    "IfcColumn": "Pset_ColumnCommon",
    "IfcBeam": "Pset_BeamCommon",
    "IfcSlab": "Pset_SlabCommon",
    "IfcFooting": "Pset_FootingCommon",
}

_SEMANTIC_TYPES = ("IfcColumn", "IfcBeam", "IfcFooting", "IfcSlab")


def _is_steel(params: dict) -> bool:
    return bool(params.get("profile") and params.get("shape"))


def _find_material(f: ifcopenshell.file, name: str):
    for mat in f.by_type("IfcMaterial"):
        if mat.Name == name:
            return mat
    return None


def _assign_material(f: ifcopenshell.file, product, params: dict) -> None:
    """Atribui concreto ou aço, decidido a partir dos mesmos parâmetros já
    usados pra escolher o perfil (`profile`/`shape` presentes = perfil
    metálico). `material.assign_material` da API já desfaz a associação
    anterior sozinho — trocar de concreto pra aço num `edit_*_dimensions`
    não deixa material duplicado."""
    is_steel = _is_steel(params)
    name = STEEL_MATERIAL if is_steel else CONCRETE_MATERIAL
    mat = _find_material(f, name)
    if mat is None:
        mat = ifcopenshell.api.run(
            "material.add_material", f, name=name,
            category="steel" if is_steel else "concrete",
        )
    ifcopenshell.api.run("material.assign_material", f, products=[product], material=mat)


def _find_pset(product, name: str):
    for rel in getattr(product, "IsDefinedBy", None) or ():
        if rel.is_a("IfcRelDefinesByProperties"):
            pdef = rel.RelatingPropertyDefinition
            if pdef.is_a("IfcPropertySet") and pdef.Name == name:
                return pdef
    return None


def _apply_standard_pset(f: ifcopenshell.file, product) -> None:
    """Grava um Pset certificado do IFC (`Pset_ColumnCommon` etc.) com as
    propriedades mais básicas e universais (`LoadBearing`) — o objetivo aqui
    não é ser exaustivo, é fazer o elemento ser reconhecido como estrutural
    por QUALQUER ferramenta IFC, não só a nossa."""
    name = _PSET_NAME.get(product.is_a())
    if not name:
        return
    pset = _find_pset(product, name)
    if pset is None:
        pset = ifcopenshell.api.run("pset.add_pset", f, product=product, name=name)
    ifcopenshell.api.run(
        "pset.edit_pset", f, pset=pset, properties={"LoadBearing": True, "IsExternal": False}
    )


def _find_qto(product, name: str):
    for rel in getattr(product, "IsDefinedBy", None) or ():
        if rel.is_a("IfcRelDefinesByProperties"):
            pdef = rel.RelatingPropertyDefinition
            if pdef.is_a("IfcElementQuantity") and pdef.Name == name:
                return pdef
    return None


def _mesh_volume(product) -> float:
    """Volume REAL (não uma fórmula de prisma) — usa a malha já tessellada,
    então reflete o recorte de viga na face do pilar e a forma não-prismática
    da sapata (tronco + rodapé + pedestal) automaticamente."""
    shape = ifcopenshell.geom.create_shape(_GEOM_SETTINGS, product)
    return ifcopenshell.util.shape.get_volume(shape.geometry)


def _polygon_area(polyline) -> float:
    """Área de um polígono simples (fórmula do shoelace) — usada pra
    GrossArea/NetArea da laje a partir do contorno persistido em
    Pset_ParametricSource (`polyline`)."""
    n = len(polyline)
    if n < 3:
        return 0.0
    area = 0.0
    for i in range(n):
        x1, y1 = float(polyline[i][0]), float(polyline[i][1])
        x2, y2 = float(polyline[(i + 1) % n][0]), float(polyline[(i + 1) % n][1])
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def _apply_quantities(f: ifcopenshell.file, product, params: dict) -> None:
    """Grava `IfcElementQuantity` a partir da geometria real + parâmetros
    lógicos. Peso = volume real × densidade (constante interna, não gravada
    como propriedade do material — ver docstring do módulo): pro aço, isso
    substitui o "peso nominal" do catálogo por uma conta a partir da seção
    de verdade, o que funciona igual pra perfil de catálogo e personalizado.
    """
    itype = product.is_a()
    qto_name = _QTO_NAME.get(itype)
    if not qto_name:
        return
    volume = _mesh_volume(product)
    density = STEEL_DENSITY if _is_steel(params) else CONCRETE_DENSITY
    weight = volume * density

    properties: dict = {"GrossVolume": volume, "NetVolume": volume, "GrossWeight": weight, "NetWeight": weight}
    if itype == "IfcColumn" and params.get("height"):
        properties["Length"] = float(params["height"])
    elif itype == "IfcBeam" and params.get("length"):
        properties["Length"] = float(params["length"])
    elif itype == "IfcSlab":
        if params.get("thickness"):
            properties["Width"] = float(params["thickness"])
        polyline = params.get("polyline")
        if polyline:
            area = _polygon_area(polyline)
            properties["GrossArea"] = area
            properties["NetArea"] = area

    qto = _find_qto(product, qto_name)
    if qto is None:
        qto = ifcopenshell.api.run("pset.add_qto", f, product=product, name=qto_name)
    ifcopenshell.api.run("pset.edit_qto", f, qto=qto, properties=properties)


def apply_semantics(entry: ModelEntry, guid: str) -> None:
    """Ponto de entrada único: material + Pset padrão + quantitativos, pro
    elemento `guid`. Chamar depois de toda criação/edição de coluna, viga,
    fundação ou laje (mesmo padrão de `connectivity_service.resync_connections`
    — transação própria, chamada das rotas)."""
    with mutate(entry) as f:
        product = f.by_guid(guid)
        if product.is_a() not in _SEMANTIC_TYPES:
            return
        params = geo.get_params_f(f, guid) or {}
        _assign_material(f, product, params)
        _apply_standard_pset(f, product)
        _apply_quantities(f, product, params)
