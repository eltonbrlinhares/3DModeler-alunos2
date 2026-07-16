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

Além de REGISTRAR a conexão, também recortamos a geometria real da VIGA na
FACE de quem a sustenta — pilar (as duas pontas), ou outra viga num
cruzamento/T (a de menor seção é cortada na face da maior) — em vez de
deixá-la sobrepor até o eixo/centro. Como o "Join Geometry" do Revit ou o
"fitting" do Tekla. Ver `beam_end_trims` / `geometry_service._set_beam_end_trims_f`.
O comprimento LÓGICO da viga (o que aparece no formulário de edição, e o que
é usado pra detectar conexões) continua sendo eixo-a-eixo — só a
Representation exportada é encurtada.

Fundação→pilar e viga/pilar↔laje NÃO precisam desse recorte: do jeito que
este app posiciona esses pares (por coincidência de cota Z — um termina
exatamente onde o outro começa), eles já se tocam por um plano, sem entrar
um no volume do outro. O problema de sobreposição só existe onde um
elemento é desenhado eixo-a-eixo por dentro da seção de outro (viga↔pilar,
viga↔viga) — pilar e laje nunca são cortados, só a viga.

Todo `create_*`/`edit_*_dimensions`/edição de placement deve, em seguida,
chamar `resync_connections()` (ou, se já estiver dentro de um
`with mutate(entry) as f:`, `_resync_connections(f, guid)` diretamente, para
não abrir uma segunda transação de undo). Isso é feito nas ROTAS
(`app/api/geometry.py`), não dentro de `geometry_service`, para evitar
importação circular entre os dois serviços.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import ifcopenshell
import ifcopenshell.api
import ifcopenshell.guid
import ifcopenshell.util.placement
import ifcopenshell.util.unit

from app.services import geometry_service as geo
from app.services._mutation import mutate
from app.services.ifc_service import ModelEntry

TOLERANCE = 0.05  # metros — folga para pequenas imprecisões de posicionamento

_STRUCTURAL_TYPES = ("IfcColumn", "IfcBeam", "IfcFooting", "IfcSlab")


@dataclass
class _BeamEndFitting:
    """Recorte de uma ponta da viga.

    ``distance`` é medido sobre o eixo lógico da viga. ``normal_world`` é a
    normal do plano de corte apontando para o lado que deve ser REMOVIDO. A
    normal é convertida para o referencial local da viga antes de gerar o
    ``IfcHalfSpaceSolid``.
    """

    distance: float = 0.0
    normal_world: np.ndarray | None = None
    priority: int = 99
    target_guid: str = ""


def _section_dimensions(params: dict) -> tuple[float, float]:
    """Retorna (largura, altura) reais da envoltória da seção.

    Para perfis metálicos, ``width``/``depth`` podem manter os valores padrão
    do formulário, enquanto a geometria real vem de ``b``/``h``. Usar sempre
    a envoltória real evita cortar uma viga 20 cm dentro de um perfil W cuja
    mesa tem, por exemplo, apenas 10,2 cm.
    """

    shape = str(params.get("shape") or "")
    h = float(params.get("h") or 0.0)
    b = float(params.get("b") or 0.0)
    if shape == "Tubular Circ." and h > 0:
        return h, h
    if shape and h > 0 and b > 0:
        return b, h
    return (
        float(params.get("width") or 0.0),
        float(params.get("depth") or 0.0),
    )


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
        _, depth = _section_dimensions(params)  # altura real da seção (vertical)
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


def _beam_end_surface_points(
    f: ifcopenshell.file, beam, end_index: int
) -> list[np.ndarray]:
    """Centro, face inferior e face superior de uma ponta da viga.

    A função usa a altura REAL do perfil e o placement efetivo, portanto
    funciona tanto para concreto quanto para perfis I/H/U/L/tubulares e
    respeita a referência topo/centro/base gravada no placement.
    """

    params = geo.get_params_f(f, beam.GlobalId) or {}
    length = float(params.get("length") or 0.0)
    _, depth = _section_dimensions(params)
    m = _world_matrix(f, beam)
    z_local = 0.0 if end_index == 0 else length
    return [
        _apply(m, (0.0, 0.0, z_local)),
        _apply(m, (0.0, -depth / 2.0, z_local)),
        _apply(m, (0.0, depth / 2.0, z_local)),
    ]


def _beam_axis_data(f: ifcopenshell.file, beam):
    params = geo.get_params_f(f, beam.GlobalId) or {}
    width, depth = _section_dimensions(params)
    length = float(params.get("length") or 0.0)
    m = _world_matrix(f, beam)
    p0 = _apply(m, (0.0, 0.0, 0.0))
    p1 = _apply(m, (0.0, 0.0, length))
    return params, m, p0, p1, length, width, depth


def _normalized_xy(v: np.ndarray) -> np.ndarray | None:
    xy = np.array(v[:2], dtype=float)
    n = float(np.linalg.norm(xy))
    return None if n < 1e-9 else xy / n


def _rectangle_coordinates(
    point_xy: np.ndarray,
    center_xy: np.ndarray,
    axis_u: np.ndarray,
    axis_v: np.ndarray,
) -> tuple[float, float]:
    rel = point_xy - center_xy
    return float(np.dot(rel, axis_u)), float(np.dot(rel, axis_v))


def _inside_or_near_oriented_rectangle(
    point_xy: np.ndarray,
    center_xy: np.ndarray,
    axis_u: np.ndarray,
    axis_v: np.ndarray,
    half_u: float,
    half_v: float,
    tolerance: float = TOLERANCE,
) -> bool:
    q_u, q_v = _rectangle_coordinates(point_xy, center_xy, axis_u, axis_v)
    return abs(q_u) <= half_u + tolerance and abs(q_v) <= half_v + tolerance


def _ray_exit_oriented_rectangle(
    point_xy: np.ndarray,
    direction_xy: np.ndarray,
    center_xy: np.ndarray,
    axis_u: np.ndarray,
    axis_v: np.ndarray,
    half_u: float,
    half_v: float,
) -> tuple[float, np.ndarray] | None:
    """Saída de um raio que começa DENTRO de um retângulo orientado.

    Retorna ``(distância, normal externa da face atingida)``. Se o ponto já
    está na face ou ligeiramente fora, não há sobreposição a remover e a
    função retorna ``None``. O plano retornado é a própria face real do
    elemento receptor, permitindo corte oblíquo verdadeiramente face a face.
    """

    q_u, q_v = _rectangle_coordinates(point_xy, center_xy, axis_u, axis_v)
    eps = 1e-8
    if abs(q_u) > half_u + eps or abs(q_v) > half_v + eps:
        return None

    d_u = float(np.dot(direction_xy, axis_u))
    d_v = float(np.dot(direction_xy, axis_v))
    candidates: list[tuple[float, np.ndarray]] = []
    if d_u > eps:
        candidates.append(((half_u - q_u) / d_u, axis_u))
    elif d_u < -eps:
        candidates.append(((-half_u - q_u) / d_u, -axis_u))
    if d_v > eps:
        candidates.append(((half_v - q_v) / d_v, axis_v))
    elif d_v < -eps:
        candidates.append(((-half_v - q_v) / d_v, -axis_v))

    candidates = [(t, n) for t, n in candidates if t >= -eps]
    if not candidates:
        return None
    distance, outward = min(candidates, key=lambda item: item[0])
    if distance <= 1e-7:
        return None
    return float(distance), np.array(outward, dtype=float)


def _surface_levels_touch(points_a: list[np.ndarray], points_b: list[np.ndarray]) -> bool:
    return any(
        abs(float(a[2] - b[2])) <= TOLERANCE
        for a in points_a
        for b in points_b
    )


def _column_rectangle(f: ifcopenshell.file, column):
    params = geo.get_params_f(f, column.GlobalId) or {}
    width, depth = _section_dimensions(params)
    height = float(params.get("height") or 0.0)
    m = _world_matrix(f, column)
    center = _apply(m, (0.0, 0.0, 0.0))[:2]
    axis_u = _normalized_xy(m[:3, 0])
    axis_v = _normalized_xy(m[:3, 1])
    if axis_u is None or axis_v is None or width <= 0 or depth <= 0:
        return None
    return params, m, center, axis_u, axis_v, width / 2.0, depth / 2.0, height


def _beam_rectangle(f: ifcopenshell.file, beam):
    params, m, p0, p1, length, width, depth = _beam_axis_data(f, beam)
    axis_u = _normalized_xy(p1 - p0)
    axis_v = _normalized_xy(m[:3, 0])  # eixo local da largura da seção
    if axis_u is None or axis_v is None or length <= 0 or width <= 0:
        return None
    center = (p0[:2] + p1[:2]) / 2.0
    return params, m, p0, p1, center, axis_u, axis_v, length / 2.0, width / 2.0, depth


def _beam_column_contacts(f: ifcopenshell.file, beam, column) -> list[dict]:
    rect = _column_rectangle(f, column)
    if rect is None:
        return []
    _, cm, center, axis_u, axis_v, half_u, half_v, height = rect
    column_faces = [
        ("bottom", [_apply(cm, (0.0, 0.0, 0.0))]),
        ("top", [_apply(cm, (0.0, 0.0, height))]),
    ]
    _, _, p0, p1, *_ = _beam_axis_data(f, beam)
    contacts = []
    for end_index, endpoint in enumerate((p0, p1)):
        if not _inside_or_near_oriented_rectangle(
            endpoint[:2], center, axis_u, axis_v, half_u, half_v
        ):
            continue
        beam_faces = _beam_end_surface_points(f, beam, end_index)
        for column_end, face_points in column_faces:
            if _surface_levels_touch(beam_faces, face_points):
                contacts.append({"beam_end": end_index, "column_end": column_end})
    return contacts


def _beam_beam_contacts(f: ifcopenshell.file, source, target) -> list[dict]:
    """Pontas de ``source`` que tocam a envoltória de ``target``.

    A checagem é feita contra a largura e o comprimento da viga receptora e
    compara topo/centro/base de ambas. Isso corrige o caso comum em que vigas
    com alturas diferentes têm o topo alinhado: seus eixos centrais ficam em
    cotas diferentes, mas suas faces realmente se tocam.
    """

    rect = _beam_rectangle(f, target)
    if rect is None:
        return []
    _, tm, _, _, center, axis_u, axis_v, half_u, half_v, target_depth = rect
    _, _, s0, s1, *_ = _beam_axis_data(f, source)
    contacts = []
    target_length = half_u * 2.0
    for end_index, endpoint in enumerate((s0, s1)):
        if not _inside_or_near_oriented_rectangle(
            endpoint[:2], center, axis_u, axis_v, half_u, half_v
        ):
            continue
        q_u, _ = _rectangle_coordinates(endpoint[:2], center, axis_u, axis_v)
        t = 0.0 if target_length <= 1e-9 else (q_u + half_u) / target_length
        t = max(0.0, min(1.0, t))
        z_local = t * target_length
        target_faces = [
            _apply(tm, (0.0, 0.0, z_local)),
            _apply(tm, (0.0, -target_depth / 2.0, z_local)),
            _apply(tm, (0.0, target_depth / 2.0, z_local)),
        ]
        source_faces = _beam_end_surface_points(f, source, end_index)
        if _surface_levels_touch(source_faces, target_faces):
            contacts.append({"source_end": end_index, "target_t": t})
    return contacts


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

    # Viga ↔ pilar: usa envoltória orientada e faces verticais reais, em vez
    # de exigir que o centro da viga coincida em 3D com o eixo do pilar.
    # Isso é essencial para vigas inseridas pela referência de TOPO/BASE e
    # para pilares girados ou metálicos.
    if {a.is_a(), b.is_a()} == {"IfcBeam", "IfcColumn"}:
        beam, column = (a, b) if a.is_a() == "IfcBeam" else (b, a)
        contacts = _beam_column_contacts(f, beam, column)
        if contacts:
            # Pilar no topo sustenta a viga. Se a conexão ocorrer na base do
            # pilar (pilar nascendo sobre uma viga), o sentido é invertido.
            if any(c["column_end"] == "top" for c in contacts):
                _find_or_create_rel(f, column, beam, "apoio")
            else:
                _find_or_create_rel(f, beam, column, "apoio")
        return

    # Viga ↔ viga: ponta contra a envoltória completa (canto ou T), com
    # comparação entre faces superior/inferior. Não depende da coincidência
    # entre linhas de centro, portanto funciona com alturas diferentes.
    if a.is_a() == "IfcBeam" and b.is_a() == "IfcBeam":
        if _beam_beam_contacts(f, a, b) or _beam_beam_contacts(f, b, a):
            lo, hi = sorted((a, b), key=lambda x: x.GlobalId)
            _find_or_create_rel(f, lo, hi, "cruzamento")
        return

    a_points = _point_endpoints(f, a)
    b_points = _point_endpoints(f, b)
    for _, p in a_points:
        for _, q in b_points:
            if np.linalg.norm(p - q) <= TOLERANCE:
                # o de cota Z menor apoia (sustenta) o de cota Z maior
                lo, hi = (a, b) if p[2] <= q[2] else (b, a)
                _find_or_create_rel(f, lo, hi, "apoio")
                return


def _cross_section_area(params: dict) -> float:
    width, depth = _section_dimensions(params)
    return width * depth


def _is_secondary(this_params: dict, this_guid: str, other_params: dict, other_guid: str) -> bool:
    """Num encontro viga-viga (canto ou T), decide quem é "secundária" — a
    que é cortada, enquanto a "primária" segue reta. Regra: a de menor seção
    transversal é secundária (convenção usual: viga menor apoia na maior);
    empate desempatado por GlobalId, só pra ser determinístico."""
    a1, a2 = _cross_section_area(this_params), _cross_section_area(other_params)
    if abs(a1 - a2) > 1e-9:
        return a1 < a2
    return this_guid > other_guid


def _pick_fitting(candidates: list[_BeamEndFitting]) -> _BeamEndFitting:
    positive = [c for c in candidates if c.distance > 1e-7 and c.normal_world is not None]
    if not positive:
        return _BeamEndFitting()
    # Caso especial importante: num canto 90° viga↔viga apoiado no mesmo
    # pilar, o corte estrito na face do pilar deixava um vão visível entre as
    # duas vigas (cada uma encurtada até uma face diferente do pilar). Quando
    # houver, na mesma ponta, um candidato de pilar E um de viga, priorizamos
    # o encontro viga↔viga para manter o canto visualmente contínuo. O apoio no
    # pilar continua registrado normalmente; só o plano de recorte visível passa
    # a ser governado pela outra viga.
    beam_candidates = [c for c in positive if c.priority == 1]
    column_candidates = [c for c in positive if c.priority == 0]
    if beam_candidates and column_candidates:
        return min(beam_candidates, key=lambda c: (c.distance, c.target_guid))
    # Pilar tem prioridade sobre viga quando os dois ocupam o mesmo nó. Dentro
    # da mesma classe, usa a face mais próxima para não encurtar além do apoio.
    return min(positive, key=lambda c: (c.priority, c.distance, c.target_guid))


def beam_end_fittings(f: ifcopenshell.file, beam) -> tuple[_BeamEndFitting, _BeamEndFitting]:
    """Planos de encaixe das duas pontas de uma viga.

    O algoritmo trabalha com as ENVOLTÓRIAS orientadas dos elementos e com as
    superfícies topo/centro/base, não com coincidência entre eixos 3D. Assim:

    - viga referenciada pelo topo encaixa no topo do pilar;
    - pilares girados são cortados na face girada correta;
    - perfis metálicos usam ``b``/``h`` reais;
    - vigas de alturas diferentes conectam pelo topo ou pela base;
    - encontros oblíquos recebem um plano de corte alinhado à face receptora.
    """

    params, _, p0, p1, length, _, _ = _beam_axis_data(f, beam)
    if length <= 0:
        return _BeamEndFitting(), _BeamEndFitting()
    axis = _normalized_xy(p1 - p0)
    if axis is None:
        return _BeamEndFitting(), _BeamEndFitting()

    fittings: list[_BeamEndFitting] = []
    for end_index, endpoint in enumerate((p0, p1)):
        # Direção a partir do apoio para dentro do vão da própria viga.
        interior_dir = axis if end_index == 0 else -axis
        candidates: list[_BeamEndFitting] = []

        for column in f.by_type("IfcColumn"):
            contacts = _beam_column_contacts(f, beam, column)
            if not any(c["beam_end"] == end_index for c in contacts):
                continue
            rect = _column_rectangle(f, column)
            if rect is None:
                continue
            _, _, center, axis_u, axis_v, half_u, half_v, _ = rect
            hit = _ray_exit_oriented_rectangle(
                endpoint[:2], interior_dir, center, axis_u, axis_v, half_u, half_v
            )
            if hit is None:
                continue
            distance, outward = hit
            candidates.append(
                _BeamEndFitting(
                    distance=distance,
                    normal_world=np.array([-outward[0], -outward[1], 0.0]),
                    priority=0,
                    target_guid=column.GlobalId,
                )
            )

        for other in f.by_type("IfcBeam"):
            if other.GlobalId == beam.GlobalId:
                continue
            other_params = geo.get_params_f(f, other.GlobalId) or {}
            contacts = _beam_beam_contacts(f, beam, other)
            end_contacts = [c for c in contacts if c["source_end"] == end_index]
            if not end_contacts:
                continue
            # Encontro "normal" viga↔viga: só a secundária é cortada.
            # Exceção: quando a ponta desta viga encontra também uma PONTA da
            # outra (target_t ≈ 0 ou 1), trata-se de um canto/L e as duas vigas
            # podem ser ajustadas mutuamente para não abrir um vão visível.
            corner_joint = any(
                abs(float(c["target_t"])) <= 1e-6 or abs(float(c["target_t"]) - 1.0) <= 1e-6
                for c in end_contacts
            )
            if not corner_joint and not _is_secondary(
                params, beam.GlobalId, other_params, other.GlobalId
            ):
                continue
            rect = _beam_rectangle(f, other)
            if rect is None:
                continue
            _, _, _, _, center, axis_u, axis_v, half_u, half_v, _ = rect
            hit = _ray_exit_oriented_rectangle(
                endpoint[:2], interior_dir, center, axis_u, axis_v, half_u, half_v
            )
            if hit is None:
                continue
            distance, outward = hit
            candidates.append(
                _BeamEndFitting(
                    distance=distance,
                    normal_world=np.array([-outward[0], -outward[1], 0.0]),
                    priority=1,
                    target_guid=other.GlobalId,
                )
            )

        fittings.append(_pick_fitting(candidates))

    start_fit, end_fit = fittings
    total = start_fit.distance + end_fit.distance
    if total >= length * 0.9 and total > 0:
        scale = (length * 0.9) / total
        start_fit.distance *= scale
        end_fit.distance *= scale
    return start_fit, end_fit


def beam_end_trims(f: ifcopenshell.file, beam) -> tuple[float, float]:
    """Compatibilidade: retorna apenas as distâncias de recorte."""

    start_fit, end_fit = beam_end_fittings(f, beam)
    return start_fit.distance, end_fit.distance


def _world_normal_to_beam_local(beam_matrix: np.ndarray, normal_world: np.ndarray | None):
    if normal_world is None:
        return None
    rotation = np.array(beam_matrix[:3, :3], dtype=float)
    try:
        local = np.linalg.solve(rotation, normal_world)
    except np.linalg.LinAlgError:
        local = rotation.T @ normal_world
    norm = float(np.linalg.norm(local))
    if norm < 1e-9:
        return None
    return tuple(float(v) for v in local / norm)


def _apply_beam_trims(f: ifcopenshell.file, beam) -> None:
    start_fit, end_fit = beam_end_fittings(f, beam)
    beam_matrix = _world_matrix(f, beam)
    geo._set_beam_end_trims_f(
        f,
        beam.GlobalId,
        start_fit.distance,
        end_fit.distance,
        start_normal=_world_normal_to_beam_local(beam_matrix, start_fit.normal_world),
        end_normal=_world_normal_to_beam_local(beam_matrix, end_fit.normal_world),
    )


def _resync_connections(f: ifcopenshell.file, guid: str) -> None:
    """Recalcula do zero as conexões de `guid` com os demais elementos
    estruturais: remove as antigas e detecta de novo a partir da geometria
    atual. Chamar dentro de um `with mutate(entry) as f:` já aberto pelo
    criador/editor do elemento (mesmo passo de undo).

    Também reaplica o recorte de ponta de TODA viga do modelo sempre que
    `guid` for viga ou pilar — não dá pra olhar só quem está conectado
    AGORA: mover um pilar, ou mudar a seção de uma viga, pode fazer uma
    conexão sumir (a outra ponta precisa voltar a ter corte 0) ou trocar
    quem é "primária"/"secundária" num encontro viga-viga. Recalcular tudo
    é barato na escala deste projeto (casa térrea)."""
    inst = f.by_guid(guid)
    if inst.is_a() not in _STRUCTURAL_TYPES:
        return
    _remove_connections_for(f, inst)
    others = [o for t in _STRUCTURAL_TYPES for o in f.by_type(t) if o.GlobalId != guid]
    for other in others:
        _check_pair(f, inst, other)

    if inst.is_a() in ("IfcBeam", "IfcColumn"):
        for beam in f.by_type("IfcBeam"):
            _apply_beam_trims(f, beam)


def _resync_all_connections(f: ifcopenshell.file) -> None:
    """Reconstrói toda a topologia e todos os encaixes do modelo.

    Usado principalmente depois de apagar um elemento receptor. Sem este
    passo, uma viga secundária continuava visualmente cortada mesmo após a
    viga principal ou o pilar ser removido.
    """

    for rel in list(f.by_type("IfcRelConnectsElements")):
        f.remove(rel)
    products = [o for t in _STRUCTURAL_TYPES for o in f.by_type(t)]
    for i, product in enumerate(products):
        for other in products[i + 1 :]:
            _check_pair(f, product, other)
    for beam in f.by_type("IfcBeam"):
        _apply_beam_trims(f, beam)


def resync_connections(entry: ModelEntry, guid: str) -> None:
    """Wrapper com transação própria — usado pela rota de resync manual e
    pelas rotas de criação/edição (chamada logo após `geo.create_*`/
    `geo.edit_*`, como um segundo passo de undo)."""
    with mutate(entry) as f:
        _resync_connections(f, guid)


def resync_all_connections(entry: ModelEntry) -> None:
    with mutate(entry) as f:
        _resync_all_connections(f)


def delete_product_and_resync(entry: ModelEntry, guid: str) -> None:
    """Apaga o produto e refaz encaixes em UMA única transação de undo."""

    with mutate(entry) as f:
        inst = f.by_guid(guid)
        _remove_connections_for(f, inst)
        ifcopenshell.api.run("root.remove_product", f, product=inst)
        _resync_all_connections(f)


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
