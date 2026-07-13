"""Estrutura espacial IFC: Site -> Building -> Storey + containment (Fase 3).

Todo produto deve cair num `IfcBuildingStorey` (via
`IfcRelContainedInSpatialStructure`), senão muitos visualizadores não o exibem.
A hierarquia espacial usa agregação (`IfcRelAggregates`).
"""
from __future__ import annotations

import json
from typing import Any

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.util.placement

from app.services import connectivity_service as conn
from app.services import geometry_service as geo
from app.services import history_service as hist
from app.services.geometry_service import matrix_from
from app.services.ifc_service import ModelEntry


def _aggregate(f, parent, child):
    ifcopenshell.api.run(
        "aggregate.assign_object", f, products=[child], relating_object=parent
    )


def bootstrap(
    entry: ModelEntry,
    site_name: str = "Site",
    building_name: str = "Building",
    storeys: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Cria Site->Building->Storey(s) mínimos sob o IfcProject.

    `storeys` é uma lista de `{"name": str, "elevation": float}`. Se omitida,
    cria um único pavimento "Level 0" em elevação 0.
    """
    if storeys is None:
        storeys = [{"name": "Level 0", "elevation": 0.0}]

    f = entry.file
    with entry.lock:
        project = f.by_type("IfcProject")
        if not project:
            raise RuntimeError("modelo sem IfcProject")
        hist.snapshot(entry)
        project = project[0]

        site = ifcopenshell.api.run(
            "root.create_entity", f, ifc_class="IfcSite", name=site_name
        )
        building = ifcopenshell.api.run(
            "root.create_entity", f, ifc_class="IfcBuilding", name=building_name
        )
        _aggregate(f, project, site)
        _aggregate(f, site, building)

        created_storeys = []
        for s in storeys:
            elevation = float(s.get("elevation", 0.0))
            storey = ifcopenshell.api.run(
                "root.create_entity",
                f,
                ifc_class="IfcBuildingStorey",
                name=s.get("name", "Level"),
            )
            _aggregate(f, building, storey)
            ifcopenshell.api.run(
                "attribute.edit_attributes",
                f,
                product=storey,
                attributes={"Elevation": elevation},
            )
            ifcopenshell.api.run(
                "geometry.edit_object_placement",
                f,
                product=storey,
                matrix=matrix_from((0.0, 0.0, elevation)),
            )
            created_storeys.append(
                {
                    "guid": storey.GlobalId,
                    "name": storey.Name,
                    "elevation": elevation,
                }
            )

        entry.dirty = True
        return {
            "site": {"guid": site.GlobalId, "name": site.Name},
            "building": {"guid": building.GlobalId, "name": building.Name},
            "storeys": created_storeys,
        }


def _building(f):
    b = f.by_type("IfcBuilding")
    return b[0] if b else None


# ----- níveis (IfcBuildingStorey como datum editável) -----


def list_levels(entry: ModelEntry) -> list[dict[str, Any]]:
    """Lista os storeys do modelo ordenados por cota (Elevation, em metros)."""
    f = entry.file
    with entry.lock:
        out = [
            {
                "guid": s.GlobalId,
                "name": s.Name,
                "elevation": float(s.Elevation or 0.0),
            }
            for s in f.by_type("IfcBuildingStorey")
        ]
        out.sort(key=lambda d: d["elevation"])
        return out


def create_level(
    entry: ModelEntry, name: str = "Level", elevation: float = 0.0
) -> dict[str, Any]:
    """Cria um novo `IfcBuildingStorey` agregado ao building, na cota dada."""
    f = entry.file
    with entry.lock:
        building = _building(f)
        if building is None:
            raise RuntimeError("modelo sem IfcBuilding; rode /spatial/bootstrap antes")
        hist.snapshot(entry)
        elevation = float(elevation)
        storey = ifcopenshell.api.run(
            "root.create_entity", f, ifc_class="IfcBuildingStorey", name=name
        )
        _aggregate(f, building, storey)
        ifcopenshell.api.run(
            "attribute.edit_attributes",
            f,
            product=storey,
            attributes={"Elevation": elevation},
        )
        ifcopenshell.api.run(
            "geometry.edit_object_placement",
            f,
            product=storey,
            matrix=matrix_from((0.0, 0.0, elevation)),
        )
        entry.dirty = True
        return {"guid": storey.GlobalId, "name": storey.Name, "elevation": elevation}


def _parametric_params(product) -> dict[str, Any]:
    """Lê o JSON do Pset_ParametricSource, quando existir."""
    for rel in getattr(product, "IsDefinedBy", None) or ():
        if not rel.is_a("IfcRelDefinesByProperties"):
            continue
        pset = rel.RelatingPropertyDefinition
        if not pset.is_a("IfcPropertySet") or pset.Name != geo.PARAMS_PSET_NAME:
            continue
        for prop in getattr(pset, "HasProperties", None) or ():
            if getattr(prop, "Name", None) != "ParamsJSON":
                continue
            wrapped = getattr(getattr(prop, "NominalValue", None), "wrappedValue", None)
            if not wrapped:
                return {}
            try:
                parsed = json.loads(str(wrapped))
                return parsed if isinstance(parsed, dict) else {}
            except (TypeError, ValueError, json.JSONDecodeError):
                return {}
    return {}


def _contained_storey_guid(product) -> str | None:
    for rel in getattr(product, "ContainedInStructure", None) or ():
        structure = rel.RelatingStructure
        if structure and structure.is_a("IfcBuildingStorey"):
            return structure.GlobalId
    return None


def _level_elevation(f, guid: str | None) -> float | None:
    if not guid:
        return None
    try:
        level = f.by_guid(guid)
    except RuntimeError:
        return None
    if not level or not level.is_a("IfcBuildingStorey"):
        return None
    return float(level.Elevation or 0.0)


def _regenerate_level_constrained_elements(f, changed_level_guid: str) -> list:
    """Recalcula paredes/pilares vinculados entre nível-base e nível-topo.

    Os vínculos ficam no Pset_ParametricSource. O placement da base é tratado
    separadamente em ``edit_level``; aqui alteramos apenas a altura da
    representação quando a base ou o topo envolvidos mudou. Devolve os
    produtos regenerados, para o chamador re-sincronizar a conectividade
    física deles (uma mudança de altura do pilar pode mudar a face onde uma
    viga encaixa nele — ver ``connectivity_service``).
    """
    changed: list = []
    products = [*f.by_type("IfcWall"), *f.by_type("IfcColumn")]
    for product in products:
        params = _parametric_params(product)
        if not params:
            continue
        base_guid = params.get("base_level_guid") or _contained_storey_guid(product)
        top_guid = params.get("top_level_guid")
        if not top_guid or changed_level_guid not in {base_guid, top_guid}:
            continue
        base_elevation = _level_elevation(f, base_guid)
        top_elevation = _level_elevation(f, top_guid)
        if base_elevation is None or top_elevation is None:
            continue
        base_offset = float(params.get("base_offset") or 0.0)
        top_offset = float(params.get("top_offset") or 0.0)
        height = top_elevation + top_offset - (base_elevation + base_offset)
        if height <= 1e-4:
            continue

        body = geo.get_body_context(f)
        if product.is_a("IfcColumn"):
            width = float(params.get("width") or 0.4)
            depth = float(params.get("depth") or 0.4)
            profile_entity = geo._profile_entity_for(
                f,
                width,
                depth,
                params.get("profile"),
                params.get("shape"),
                params.get("h"),
                params.get("b"),
                params.get("tw"),
                params.get("tf"),
            )
            rep = ifcopenshell.api.run(
                "geometry.add_profile_representation",
                f,
                context=body,
                profile=profile_entity,
                depth=height,
            )
        else:
            rep = ifcopenshell.api.run(
                "geometry.add_wall_representation",
                f,
                context=body,
                length=float(params.get("length") or 5.0),
                height=height,
                thickness=float(params.get("thickness") or 0.2),
            )
        geo._replace_body_representation(f, product, rep)
        geo.write_params(f, product, {"height": height})
        changed.append(product)
    return changed


def edit_level(
    entry: ModelEntry,
    guid: str,
    name: str | None = None,
    elevation: float | None = None,
) -> dict[str, Any]:
    """Renomeia e/ou move um nível (atualiza Elevation e o placement em Z)."""
    f = entry.file
    with entry.lock:
        hist.snapshot(entry)
        storey = f.by_guid(guid)
        old_elevation = float(storey.Elevation or 0.0)

        # Os elementos deste editor são posicionados em coordenadas globais e
        # apenas associados ao storey por containment. Portanto, mover somente
        # o IfcBuildingStorey não deslocaria visualmente os produtos. Guardamos
        # as matrizes mundiais antes da mudança e aplicamos o mesmo delta em Z,
        # reproduzindo o comportamento de elementos hospedados em um nível.
        contained = [
            elem
            for rel in (storey.ContainsElements or [])
            for elem in rel.RelatedElements
            if getattr(elem, "ObjectPlacement", None) is not None
        ]
        world_matrices = {
            elem.id(): ifcopenshell.util.placement.get_local_placement(elem.ObjectPlacement)
            for elem in contained
        }

        attrs: dict[str, Any] = {}
        if name is not None:
            attrs["Name"] = name
        if elevation is not None:
            attrs["Elevation"] = float(elevation)
        if attrs:
            ifcopenshell.api.run(
                "attribute.edit_attributes", f, product=storey, attributes=attrs
            )
        if elevation is not None:
            new_elevation = float(elevation)
            delta = new_elevation - old_elevation
            ifcopenshell.api.run(
                "geometry.edit_object_placement",
                f,
                product=storey,
                matrix=matrix_from((0.0, 0.0, new_elevation)),
            )
            if abs(delta) > 1e-12:
                for elem in contained:
                    matrix = world_matrices[elem.id()].copy()
                    matrix[2, 3] += delta
                    ifcopenshell.api.run(
                        "geometry.edit_object_placement",
                        f,
                        product=elem,
                        matrix=matrix,
                    )
            regenerated = _regenerate_level_constrained_elements(f, guid)
            # qualquer elemento que se moveu OU teve a altura recalculada
            # pode ter mudado quem toca em quem (e, pra viga, a face de
            # encaixe) — resincroniza a conectividade de todos eles.
            touched_guids = {elem.GlobalId for elem in contained} | {
                p.GlobalId for p in regenerated
            }
            for touched_guid in touched_guids:
                conn._resync_connections(f, touched_guid)
        entry.dirty = True
        return {
            "guid": storey.GlobalId,
            "name": storey.Name,
            "elevation": float(storey.Elevation or 0.0),
        }


def delete_level(entry: ModelEntry, guid: str, force: bool = False) -> None:
    """Remove um nível. Rejeita se contiver elementos, salvo `force=True`."""
    f = entry.file
    with entry.lock:
        storey = f.by_guid(guid)
        contained = [
            elem
            for rel in (storey.ContainsElements or [])
            for elem in rel.RelatedElements
        ]
        if contained and not force:
            raise ValueError(
                f"nível contém {len(contained)} elemento(s); use force=true"
            )
        hist.snapshot(entry)
        ifcopenshell.api.run("root.remove_product", f, product=storey)
        entry.dirty = True


def assign_container(entry: ModelEntry, guid: str, container_guid: str) -> None:
    """Move um produto para dentro de um container espacial (ex.: storey)."""
    f = entry.file
    with entry.lock:
        hist.snapshot(entry)
        product = f.by_guid(guid)
        container = f.by_guid(container_guid)
        ifcopenshell.api.run(
            "spatial.assign_container",
            f,
            products=[product],
            relating_structure=container,
        )
        entry.dirty = True


def _node(inst) -> dict[str, Any]:
    children: list[dict[str, Any]] = []
    # agregação (espacial: site/building/storey)
    for rel in getattr(inst, "IsDecomposedBy", None) or []:
        for child in rel.RelatedObjects:
            children.append(_node(child))
    # containment (produtos dentro de um storey)
    for rel in getattr(inst, "ContainsElements", None) or []:
        for elem in rel.RelatedElements:
            children.append(
                {
                    "guid": getattr(elem, "GlobalId", None),
                    "type": elem.is_a(),
                    "name": getattr(elem, "Name", None),
                    "children": [],
                }
            )
    return {
        "guid": getattr(inst, "GlobalId", None),
        "type": inst.is_a(),
        "name": getattr(inst, "Name", None),
        "children": children,
    }


def tree(entry: ModelEntry) -> dict[str, Any]:
    """Devolve a árvore espacial aninhada a partir do IfcProject."""
    f = entry.file
    with entry.lock:
        project = f.by_type("IfcProject")
        if not project:
            raise RuntimeError("modelo sem IfcProject")
        return _node(project[0])
