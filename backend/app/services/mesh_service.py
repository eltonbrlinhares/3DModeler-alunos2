"""Tessellation: IFC -> mesh JSON para o frontend (Three.js).

Usa ifcopenshell.geom com OCC para gerar triângulos por produto. Coordenadas
saem em IFC (Z-up, metros); a conversão para Y-up acontece no frontend.
"""
from __future__ import annotations

import multiprocessing
from typing import Any

import ifcopenshell
import ifcopenshell.geom


def _settings() -> ifcopenshell.geom.settings:
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)
    return settings


def _accumulate_bbox(verts: list[float], bb_min: list[float], bb_max: list[float]):
    for i in range(0, len(verts), 3):
        for axis in range(3):
            v = verts[i + axis]
            if v < bb_min[axis]:
                bb_min[axis] = v
            if v > bb_max[axis]:
                bb_max[axis] = v


def _product_dict(f: ifcopenshell.file, guid: str, ent_id: int, verts, faces) -> dict:
    return {
        "guid": guid,
        "id": ent_id,
        "type": f.by_id(ent_id).is_a(),
        "vertices": verts,
        "indices": faces,
    }


def tessellate(f: ifcopenshell.file) -> dict[str, Any]:
    """Tessella o modelo inteiro (multi-thread)."""
    products: list[dict[str, Any]] = []
    iterator = ifcopenshell.geom.iterator(
        _settings(), f, multiprocessing.cpu_count()
    )
    if not iterator.initialize():
        return {"products": [], "bbox": None}

    bb_min = [float("inf")] * 3
    bb_max = [float("-inf")] * 3

    while True:
        shape = iterator.get()
        verts = list(shape.geometry.verts)
        faces = list(shape.geometry.faces)
        _accumulate_bbox(verts, bb_min, bb_max)
        products.append(_product_dict(f, shape.guid, shape.id, verts, faces))
        if not iterator.next():
            break

    bbox = None
    if bb_min[0] != float("inf"):
        bbox = {"min": bb_min, "max": bb_max}
    return {"products": products, "bbox": bbox}


def tessellate_product(f: ifcopenshell.file, guid: str) -> dict[str, Any]:
    """Tessella um único produto (retessellação incremental pós-edição).

    Devolve o mesmo formato de `tessellate`, com 0 ou 1 produto. Produtos sem
    representação geométrica retornam lista vazia em vez de erro.
    """
    inst = f.by_guid(guid)
    try:
        shape = ifcopenshell.geom.create_shape(_settings(), inst)
    except RuntimeError:
        return {"products": [], "bbox": None}

    verts = list(shape.geometry.verts)
    faces = list(shape.geometry.faces)
    if not verts:
        return {"products": [], "bbox": None}

    bb_min = [float("inf")] * 3
    bb_max = [float("-inf")] * 3
    _accumulate_bbox(verts, bb_min, bb_max)
    return {
        "products": [_product_dict(f, guid, inst.id(), verts, faces)],
        "bbox": {"min": bb_min, "max": bb_max},
    }
