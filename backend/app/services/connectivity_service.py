"""Conectividade FÍSICA entre elementos estruturais (`IfcRelConnectsElements`).

Isto não é um modelo de análise estrutural (sem esforços/reações/idealização
1D — ver `IfcStructuralConnection` no schema, que é outra coisa). É só
topologia: quais elementos se TOCAM de fato, detectado por coincidência
geométrica dos pontos de conexão de cada elemento — as extremidades da
extrusão (base/topo do pilar, pontas da viga, topo da fundação), ou, no caso
da laje, a área de apoio (planta x espessura).

Pares reconhecidos:
    fundação → pilar   ("apoio")
    pilar    → viga     ("apoio")
    viga     → viga     ("cruzamento")
    viga/pilar ↔ laje   ("apoio_laje")

Fonte da verdade da geometria: o `ObjectPlacement` já gravado no IFC (não
recalculamos a partir de nada "por fora") + as dimensões persistidas em
`Pset_ParametricSource` (ver `geometry_service.write_params`/`get_params_f`)
— por isso um elemento sem esse Pset (IFC externo, ou anterior à edição em
vivo) simplesmente não participa da detecção.

Todo `create_*`/`edit_*_dimensions`/edição de placement deve, em seguida,
chamar `resync_connections()` (ou, se já estiver dentro de um
`with mutate(entry) as f:`, `_resync_connections(f, guid)` diretamente, para
não abrir uma segunda transação de undo). Isso é feito nas ROTAS
(`app/api/geometry.py`), não dentro de `geometry_service`, para evitar
importação circular entre os dois serviços.
"""
from __future__ import annotations

import numpy as np
import ifcopenshell
import ifcopenshell.guid
import ifcopenshell.util.placement
import ifcopenshell.util.unit

from app.services import geometry_service as geo
from app.services._mutation import mutate
from app.services.ifc_service import ModelEntry

TOLERANCE = 0.05  # metros — folga para pequenas imprecisões de posicionamento

_STRUCTURAL_TYPES = ("IfcColumn", "IfcBeam", "IfcFooting", "IfcSlab")


def _world_matrix(f: ifcopenshell.file, inst) -> np.ndarray:
    m = np.array(
        ifcopenshell.util.placement.get_local_placement(inst.ObjectPlacement),
        dtype=float,
    )
    scale = ifcopenshell.util.unit.calculate_unit_scale(f)  # unidade do arquivo -> m
    m[:3, 3] *= scale
    return m


def _apply(m: np.ndarray, local_xyz) -> np.ndarray:
    """Transforma um ponto local (no referencial do próprio ObjectPlacement,
    mesmo referencial em que a Representation foi construída) para o mundo."""
    p = np.array([local_xyz[0], local_xyz[1], local_xyz[2], 1.0])
    return (m @ p)[:3]


def _point_endpoints(f: ifcopenshell.file, inst) -> list[tuple[str, np.ndarray]]:
    """Pontos de conexão "pontuais" — vazio para laje (tratada à parte, é
    área de apoio, não ponto)."""
    itype = inst.is_a()
    params = geo.get_params_f(f, inst.GlobalId) or {}
    m = _world_matrix(f, inst)
    if itype == "IfcColumn":
        height = float(params.get("height") or 0.0)
        return [
            ("bottom", _apply(m, (0.0, 0.0, 0.0))),
            ("top", _apply(m, (0.0, 0.0, height))),
        ]
    if itype == "IfcBeam":
        length = float(params.get("length") or 0.0)
        depth = float(params.get("depth") or 0.0)  # altura da seção (vertical)
        # a viga tem uma referência vertical (topo/centro/base — ver
        # beamAxisRef no frontend) que desloca a linha de centro da extrusão
        # em relação à SUPERFÍCIE que de fato encosta no pilar/laje. Sem
        # considerar isso, só a linha de centro bateria — e o caso mais comum
        # (base da viga apoiada no topo do pilar) ficaria sempre fora da
        # tolerância (offset de depth/2, tipicamente bem maior que
        # TOLERANCE). Por isso oferecemos 3 candidatos por ponta: centro,
        # face inferior e face superior.
        pts = []
        for end_name, z_local in (("start", 0.0), ("end", length)):
            pts.append((f"{end_name}_center", _apply(m, (0.0, 0.0, z_local))))
            pts.append((f"{end_name}_bottom", _apply(m, (0.0, -depth / 2, z_local))))
            pts.append((f"{end_name}_top", _apply(m, (0.0, depth / 2, z_local))))
        return pts
    if itype == "IfcFooting":
        total = (
            float(params.get("base_height") or 0.0)
            + float(params.get("height") or 0.0)
            + float(params.get("pedestal_height") or 0.0)
        )
        return [("top", _apply(m, (0.0, 0.0, total)))]
    return []


def _slab_bearing(f: ifcopenshell.file, inst):
    """(matrix, polígono local, z_local do fundo, z_local do topo) da laje,
    ou None se não tiver `polyline`/`thickness` gravados (Pset ausente)."""
    params = geo.get_params_f(f, inst.GlobalId) or {}
    polyline = params.get("polyline")
    thickness = float(params.get("thickness") or 0.0)
    if not polyline or len(polyline) < 3:
        return None
    m = _world_matrix(f, inst)
    polygon = [(float(p[0]), float(p[1])) for p in polyline]
    return m, polygon, 0.0, thickness


def _point_in_local_polygon(m: np.ndarray, polygon_local, world_point: np.ndarray) -> bool:
    """`world_point` -> referencial local da laje (inversa de `m`), depois
    inclusão em polígono 2D por ray casting."""
    inv = np.linalg.inv(m)
    local = inv @ np.array([world_point[0], world_point[1], world_point[2], 1.0])
    x, y = local[0], local[1]
    inside = False
    n = len(polygon_local)
    for i in range(n):
        x1, y1 = polygon_local[i]
        x2, y2 = polygon_local[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            x_int = (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1
            if x < x_int:
                inside = not inside
    return inside


def _find_or_create_rel(f: ifcopenshell.file, relating, related, kind: str):
    """Cria `IfcRelConnectsElements` entre os dois produtos se ainda não
    existir uma relação entre esse PAR (independente da ordem) — idempotente,
    não duplica ao rechamar `_resync_connections` várias vezes."""
    pair = {relating, related}
    for rel in f.by_type("IfcRelConnectsElements"):
        if {rel.RelatingElement, rel.RelatedElement} == pair:
            return rel
    return f.create_entity(
        "IfcRelConnectsElements",
        GlobalId=ifcopenshell.guid.new(),
        RelatingElement=relating,
        RelatedElement=related,
        Description=kind,
    )


def _remove_connections_for(f: ifcopenshell.file, product) -> int:
    """Remove toda `IfcRelConnectsElements` que envolva `product` (usado
    antes de apagar o elemento, e no início de todo resync)."""
    to_remove = [
        rel
        for rel in f.by_type("IfcRelConnectsElements")
        if rel.RelatingElement == product or rel.RelatedElement == product
    ]
    for rel in to_remove:
        f.remove(rel)
    return len(to_remove)


def _segment_endpoints(f: ifcopenshell.file, beam) -> tuple[np.ndarray, np.ndarray]:
    """Linha de centro (extremidade a extremidade) de uma viga, em mundo."""
    params = geo.get_params_f(f, beam.GlobalId) or {}
    length = float(params.get("length") or 0.0)
    m = _world_matrix(f, beam)
    return _apply(m, (0.0, 0.0, 0.0)), _apply(m, (0.0, 0.0, length))


def _point_segment_distance(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    """Distância de `p` ao segmento a-b, e o parâmetro `t` (0..1) do ponto
    mais próximo ao longo do segmento (usado para distinguir "no meio do
    vão" de "na ponta")."""
    ab = b - a
    denom = float(np.dot(ab, ab))
    t = 0.0 if denom < 1e-12 else float(np.dot(p - a, ab) / denom)
    t = max(0.0, min(1.0, t))
    closest = a + t * ab
    return float(np.linalg.norm(p - closest)), t


def _check_pair(f: ifcopenshell.file, a, b) -> None:
    """Testa o par (a, b) e cria a relação certa se algum ponto de conexão
    coincidir (dentro de `TOLERANCE`). Não assume qual dos dois disparou o
    resync — o sentido "apoiado em" é decidido pela cota Z do ponto que bateu,
    não pela ordem dos argumentos."""
    if a.is_a() == "IfcSlab" and b.is_a() == "IfcSlab":
        return
    if a.is_a() == "IfcSlab" or b.is_a() == "IfcSlab":
        slab, other = (a, b) if a.is_a() == "IfcSlab" else (b, a)
        if other.is_a() not in ("IfcColumn", "IfcBeam"):
            return
        bearing = _slab_bearing(f, slab)
        if bearing is None:
            return
        m, polygon, z_bottom_local, z_top_local = bearing
        z_bottom = _apply(m, (0.0, 0.0, z_bottom_local))[2]
        z_top = _apply(m, (0.0, 0.0, z_top_local))[2]
        for _, point in _point_endpoints(f, other):
            near_bottom = abs(point[2] - z_bottom) <= TOLERANCE
            near_top = abs(point[2] - z_top) <= TOLERANCE
            if (near_bottom or near_top) and _point_in_local_polygon(m, polygon, point):
                # ponto encosta por BAIXO da laje -> o elemento sustenta a laje;
                # por CIMA -> a laje sustenta o elemento (ex.: pilar nascendo dela)
                if near_bottom:
                    _find_or_create_rel(f, other, slab, "apoio_laje")
                else:
                    _find_or_create_rel(f, slab, other, "apoio_laje")
                return
        return

    a_points = _point_endpoints(f, a)
    b_points = _point_endpoints(f, b)
    for _, p in a_points:
        for _, q in b_points:
            if np.linalg.norm(p - q) <= TOLERANCE:
                if a.is_a() == "IfcBeam" and b.is_a() == "IfcBeam":
                    lo, hi = sorted((a, b), key=lambda x: x.GlobalId)
                    _find_or_create_rel(f, lo, hi, "cruzamento")
                else:
                    # o de cota Z menor apoia (sustenta) o de cota Z maior
                    lo, hi = (a, b) if p[2] <= q[2] else (b, a)
                    _find_or_create_rel(f, lo, hi, "apoio")
                return

    # viga-viga: além de ponta-com-ponta (canto, já tratado acima), também
    # reconhece "encontro em T" — a ponta de uma viga (secundária) encosta no
    # MEIO do vão da outra (principal), não na extremidade dela. Comum em
    # grelhas de vigas (secundária apoiando na lateral/topo da principal).
    if a.is_a() == "IfcBeam" and b.is_a() == "IfcBeam":
        a0, a1 = _segment_endpoints(f, a)
        b0, b1 = _segment_endpoints(f, b)
        for _, p in a_points:
            dist, t = _point_segment_distance(p, b0, b1)
            if dist <= TOLERANCE and 0.02 < t < 0.98:
                _find_or_create_rel(f, b, a, "cruzamento")
                return
        for _, q in b_points:
            dist, t = _point_segment_distance(q, a0, a1)
            if dist <= TOLERANCE and 0.02 < t < 0.98:
                _find_or_create_rel(f, a, b, "cruzamento")
                return


def _resync_connections(f: ifcopenshell.file, guid: str) -> None:
    """Recalcula do zero as conexões de `guid` com os demais elementos
    estruturais: remove as antigas e detecta de novo a partir da geometria
    atual. Chamar dentro de um `with mutate(entry) as f:` já aberto pelo
    criador/editor do elemento (mesmo passo de undo)."""
    inst = f.by_guid(guid)
    if inst.is_a() not in _STRUCTURAL_TYPES:
        return
    _remove_connections_for(f, inst)
    others = [o for t in _STRUCTURAL_TYPES for o in f.by_type(t) if o.GlobalId != guid]
    for other in others:
        _check_pair(f, inst, other)


def resync_connections(entry: ModelEntry, guid: str) -> None:
    """Wrapper com transação própria — usado pela rota de resync manual e
    pelas rotas de criação/edição (chamada logo após `geo.create_*`/
    `geo.edit_*`, como um segundo passo de undo)."""
    with mutate(entry) as f:
        _resync_connections(f, guid)


def remove_connections_for(entry: ModelEntry, guid: str) -> int:
    """Limpa as conexões de `guid` (chamar antes de apagar o produto)."""
    with mutate(entry) as f:
        inst = f.by_guid(guid)
        return _remove_connections_for(f, inst)


def list_connections(entry: ModelEntry, guid: str) -> list[dict]:
    """Lista as conexões físicas do elemento `guid`, já com o "papel" dele
    naquela relação (`role`) do ponto de vista de quem pergunta:
      - "apoio":       supports (eu sustento o outro) / supported_by (o outro me sustenta)
      - "cruzamento":  crosses (viga-viga, sem hierarquia)
      - "apoio_laje":  bears_slab (eu sustento a laje) / slab_bearing (a laje me sustenta)
    """
    f = entry.file
    inst = f.by_guid(guid)
    out = []
    for rel in f.by_type("IfcRelConnectsElements"):
        if rel.RelatingElement == inst:
            other, as_relating = rel.RelatedElement, True
        elif rel.RelatedElement == inst:
            other, as_relating = rel.RelatingElement, False
        else:
            continue
        kind = rel.Description or "apoio"
        if kind == "cruzamento":
            role = "crosses"
        elif kind == "apoio_laje":
            role = "bears_slab" if as_relating else "slab_bearing"
        else:
            role = "supports" if as_relating else "supported_by"
        out.append(
            {
                "guid": other.GlobalId,
                "type": other.is_a(),
                "name": getattr(other, "Name", None),
                "role": role,
                "kind": kind,
            }
        )
    return out
