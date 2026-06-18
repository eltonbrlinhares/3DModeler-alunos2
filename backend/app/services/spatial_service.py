"""Estrutura espacial IFC: Site -> Building -> Storey + containment (Fase 3).

Todo produto deve cair num `IfcBuildingStorey` (via
`IfcRelContainedInSpatialStructure`), senão muitos visualizadores não o exibem.
A hierarquia espacial usa agregação (`IfcRelAggregates`).
"""
from __future__ import annotations

from typing import Any

import ifcopenshell
import ifcopenshell.api

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
            ifcopenshell.api.run(
                "geometry.edit_object_placement",
                f,
                product=storey,
                matrix=matrix_from((0.0, 0.0, float(elevation))),
            )
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
