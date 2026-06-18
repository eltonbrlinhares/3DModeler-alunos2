"""Grids de referência (IfcGrid + IfcGridAxis) — Fase 8.

Um grid é um conjunto de eixos de referência em duas direções:
  - eixos **U**: linhas paralelas a Y, uma em cada `x` (rótulos típicos A, B, C…);
  - eixos **V**: linhas paralelas a X, uma em cada `y` (rótulos típicos 1, 2, 3…).

`IfcGrid` **não** é um `IfcBuildingElement` e não passa pela tessellation
(`/mesh`). A geometria dos eixos (segmentos 2D + tag) é devolvida por
`list_grids` e desenhada no frontend como linhas, não como malha.

Coordenadas trocadas com o cliente são IFC (Z-up, metros). Os pontos das
curvas (`IfcCartesianPoint`) são gravados nas unidades do arquivo (ex.: mm),
então convertemos metros -> unidades na escrita e de volta na leitura.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import ifcopenshell
import ifcopenshell.api
import ifcopenshell.util.placement
import ifcopenshell.util.unit

from app.services import history_service as hist
from app.services.geometry_service import matrix_from
from app.services.ifc_service import ModelEntry


def _axis(f, tag: str, p0, p1, scale: float):
    """Cria um IfcGridAxis com curva polyline reta de p0 a p1 (metros -> unidades)."""
    a = f.create_entity("IfcCartesianPoint", Coordinates=[p0[0] / scale, p0[1] / scale])
    b = f.create_entity("IfcCartesianPoint", Coordinates=[p1[0] / scale, p1[1] / scale])
    curve = f.create_entity("IfcPolyline", Points=[a, b])
    return f.create_entity("IfcGridAxis", AxisTag=tag, AxisCurve=curve, SameSense=True)


def create_grid(
    entry: ModelEntry,
    name: str | None = None,
    u: list[dict[str, Any]] | None = None,
    v: list[dict[str, Any]] | None = None,
    extent: float | None = None,
) -> dict[str, Any]:
    """Cria um IfcGrid retangular a partir das posições dos eixos U/V (metros)."""
    u = u or []
    v = v or []
    if not u and not v:
        raise ValueError("informe ao menos um eixo em 'u' ou 'v'")

    f = entry.file
    with entry.lock:
        hist.snapshot(entry)
        scale = ifcopenshell.util.unit.calculate_unit_scale(f)  # file unit -> m

        xs = [float(a["x"]) for a in u]
        ys = [float(a["y"]) for a in v]
        if extent is None:
            spread = max(
                (max(xs) - min(xs)) if xs else 0.0,
                (max(ys) - min(ys)) if ys else 0.0,
                1.0,
            )
            margin = max(2.0, spread * 0.2)
            x0 = (min(xs) - margin) if xs else -margin
            x1 = (max(xs) + margin) if xs else margin
            y0 = (min(ys) - margin) if ys else -margin
            y1 = (max(ys) + margin) if ys else margin
        else:
            # Extent explicito preserva o contrato original: meia-largura em torno da origem.
            extent = float(extent)
            x0, x1 = -extent, extent
            y0, y1 = -extent, extent

        # eixos U: paralelos a Y, em cada x; eixos V: paralelos a X, em cada y.
        # Os limites usam a faixa real da direcao oposta, para grids positivos
        # (ex.: 0, 5, 10) nao ficarem truncados em torno da origem.
        u_axes = [_axis(f, str(a["tag"]), (x, y0), (x, y1), scale)
                  for a, x in zip(u, xs)]
        v_axes = [_axis(f, str(a["tag"]), (x0, y), (x1, y), scale)
                  for a, y in zip(v, ys)]

        grid = ifcopenshell.api.run(
            "root.create_entity", f, ifc_class="IfcGrid", name=name
        )
        grid.UAxes = u_axes or None
        grid.VAxes = v_axes or None
        ifcopenshell.api.run(
            "geometry.edit_object_placement", f, product=grid, matrix=matrix_from()
        )
        entry.dirty = True
        return {"guid": grid.GlobalId, "name": grid.Name}


def _seg(axis, M: np.ndarray, scale: float) -> dict[str, Any]:
    """Extrai o segmento (p0,p1) de um eixo em coordenadas de mundo (metros, XY)."""
    pts = axis.AxisCurve.Points
    a, b = pts[0].Coordinates, pts[-1].Coordinates

    def to_world(c):
        local = np.array([c[0], c[1], 0.0, 1.0])  # unidades do arquivo
        w = M @ local
        return [float(w[0] * scale), float(w[1] * scale)]  # metros

    return {"tag": axis.AxisTag, "p0": to_world(a), "p1": to_world(b)}


def list_grids(entry: ModelEntry) -> list[dict[str, Any]]:
    """Lista grids com a geometria dos eixos (segmentos em metros, plano XY)."""
    f = entry.file
    with entry.lock:
        scale = ifcopenshell.util.unit.calculate_unit_scale(f)  # file unit -> m
        out = []
        for grid in f.by_type("IfcGrid"):
            M = np.array(
                ifcopenshell.util.placement.get_local_placement(grid.ObjectPlacement),
                dtype=float,
            )
            out.append(
                {
                    "guid": grid.GlobalId,
                    "name": grid.Name,
                    "u_axes": [_seg(ax, M, scale) for ax in (grid.UAxes or [])],
                    "v_axes": [_seg(ax, M, scale) for ax in (grid.VAxes or [])],
                }
            )
        return out


def delete_grid(entry: ModelEntry, guid: str) -> None:
    """Remove um IfcGrid (eixos e curvas saem em cascata via remove_product)."""
    f = entry.file
    with entry.lock:
        hist.snapshot(entry)
        grid = f.by_guid(guid)
        ifcopenshell.api.run("root.remove_product", f, product=grid)
        entry.dirty = True
