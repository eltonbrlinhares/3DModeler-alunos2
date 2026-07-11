"""Dimensionamento PRELIMINAR de fundações rasas (sapata) e blocos sobre
estacas (método rígido / bielas simplificado, base NBR 6122).

Estas funções produzem uma ESTIMATIVA inicial de geometria a partir da carga
e da capacidade do solo/estaca — não substituem a verificação completa
(punção, flexão, bielas e tirantes — NBR 6118, capítulos 19 e 22) nem o
memorial assinado por um profissional habilitado antes da execução. Cada
resultado carrega essa ressalva em `notes`.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field


# ---------------------------------------------------------------- sapata --


@dataclass
class PadFootingSuggestion:
    width: float          # m (direção X, alinhada à largura do pilar)
    length: float         # m (direção Y, alinhada à profundidade do pilar)
    height: float         # m
    area: float            # m²
    cantilever: float      # m (balanço (L-a)/2 = (B-b)/2)
    rigid: bool             # h >= balanço -> sapata rígida (bielas)
    notes: list[str] = field(default_factory=list)


def suggest_pad_footing(
    axial_load_kn: float,
    column_width: float,
    column_depth: float,
    soil_bearing_kpa: float,
    self_weight_ratio: float = 0.05,
    min_height: float = 0.30,
    height_step: float = 0.05,
) -> PadFootingSuggestion:
    """Sapata retangular com balanços iguais nas duas direções:
    (largura - largura_pilar)/2 = (comprimento - profundidade_pilar)/2.

    `axial_load_kn`: carga de serviço (não majorada) do pilar, em kN.
    `soil_bearing_kpa`: tensão admissível do solo (sigma_adm), em kPa.
    """
    if axial_load_kn <= 0 or soil_bearing_kpa <= 0:
        raise ValueError("carga e tensão admissível do solo devem ser positivas")
    if column_width <= 0 or column_depth <= 0:
        raise ValueError("dimensões do pilar devem ser positivas")

    notes: list[str] = []

    # 1a estimativa de área, já incluindo peso próprio + reaterro (margem)
    n_design = axial_load_kn * (1.0 + self_weight_ratio)
    area_req = n_design / soil_bearing_kpa

    a, b = column_width, column_depth
    # (a+2c)(b+2c) = area_req  =>  4c^2 + 2(a+b)c + (ab - area_req) = 0
    coef_a, coef_b, coef_c = 4.0, 2.0 * (a + b), (a * b - area_req)
    disc = coef_b * coef_b - 4 * coef_a * coef_c
    if disc < 0:
        c = 0.0
        notes.append(
            "área exigida pelo solo é menor que a seção do pilar - usando "
            "balanço mínimo construtivo."
        )
    else:
        c = (-coef_b + math.sqrt(disc)) / (2 * coef_a)
    c = max(c, 0.15)  # balanço mínimo construtivo (cobrimento + ancoragem)

    width = a + 2 * c
    length = b + 2 * c
    area = width * length

    h_trial = max(min_height, c)
    self_weight_kn = 25.0 * width * length * h_trial  # concreto ~25 kN/m3
    if self_weight_kn > axial_load_kn * self_weight_ratio * 1.5:
        notes.append(
            f"peso próprio estimado ({self_weight_kn:.1f} kN) supera a margem "
            f"de {self_weight_ratio * 100:.0f}% assumida - revalide a área "
            "para cargas/solo de baixa capacidade."
        )

    height = math.ceil(h_trial / height_step) * height_step
    rigid = height >= c
    if not rigid:
        notes.append(
            "sapata flexível (altura menor que o balanço) - dimensionar por "
            "flexão, não pelo método das bielas; considere aumentar a altura."
        )
    notes.append(
        "estimativa preliminar (método rígido/bielas simplificado, NBR 6122); "
        "não substitui verificação de punção (NBR 6118, 19.5) nem memorial "
        "assinado por profissional habilitado."
    )

    return PadFootingSuggestion(
        width=round(width, 2),
        length=round(length, 2),
        height=round(height, 2),
        area=round(area, 2),
        cantilever=round(c, 2),
        rigid=rigid,
        notes=notes,
    )


# --------------------------------------------------------- bloco/estacas --

# arranjos padrão: n de estacas -> offsets (x,y) em unidades de espaçamento
PILE_ARRANGEMENTS: dict[int, list[tuple[float, float]]] = {
    1: [(0.0, 0.0)],
    2: [(-0.5, 0.0), (0.5, 0.0)],
    3: [(-0.5, -0.2887), (0.5, -0.2887), (0.0, 0.5774)],  # triangular equilátero
    4: [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)],
    5: [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5), (0.0, 0.0)],
    6: [(-0.5, -1.0), (0.5, -1.0), (-0.5, 0.0), (0.5, 0.0), (-0.5, 1.0), (0.5, 1.0)],
}


@dataclass
class PileCapSuggestion:
    pile_count: int
    width: float
    length: float
    height: float
    pile_spacing: float
    edge_distance: float
    arrangement: list[tuple[float, float]]  # posições (m), a partir do centro
    notes: list[str] = field(default_factory=list)


def suggest_pile_cap(
    axial_load_kn: float,
    pile_capacity_kn: float,
    pile_diameter: float,
    spacing_factor: float = 2.5,
    edge_factor: float = 1.0,
    height_step: float = 0.05,
) -> PileCapSuggestion:
    """Escolhe n de estacas (arredondado pra cima) num arranjo padrão
    (`PILE_ARRANGEMENTS`), espaçamento `spacing_factor` x diâmetro entre
    eixos e distância de borda `edge_factor` x diâmetro.
    """
    if axial_load_kn <= 0 or pile_capacity_kn <= 0 or pile_diameter <= 0:
        raise ValueError(
            "carga, capacidade da estaca e diâmetro devem ser positivos"
        )

    notes: list[str] = []
    n = max(1, math.ceil(axial_load_kn / pile_capacity_kn))
    if n not in PILE_ARRANGEMENTS:
        available = sorted(PILE_ARRANGEMENTS)
        n_orig = n
        n = min((k for k in available if k >= n), default=max(available))
        notes.append(
            f"nº de estacas calculado ({n_orig}) não tem arranjo padrão "
            f"cadastrado; usando o próximo disponível ({n}) - revisar "
            "manualmente para grupos maiores/arranjos especiais."
        )

    spacing = spacing_factor * pile_diameter
    edge = edge_factor * pile_diameter
    offsets = PILE_ARRANGEMENTS[n]
    positions = [(dx * spacing, dy * spacing) for dx, dy in offsets]

    xs = [p[0] for p in positions]
    ys = [p[1] for p in positions]
    half_pile = pile_diameter / 2
    width = (max(xs) - min(xs)) + 2 * (half_pile + edge)
    length = (max(ys) - min(ys)) + 2 * (half_pile + edge)

    # altura pelo método de bielas: liga a face do pilar ao eixo da estaca
    # mais afastada, mantendo um ângulo ~45-55° (fator 1.2 sobre a distância)
    max_dist = max((math.hypot(x, y) for x, y in positions), default=0.0)
    height = max(0.4, math.ceil((max_dist * 1.2) / height_step) * height_step)

    notes.append(
        "estimativa preliminar (arranjo padrão + bielas simplificado); "
        "verificar tirante, punção (pilar e estacas) e ancoragem conforme "
        "NBR 6118 (22) e NBR 6122 antes da execução."
    )

    return PileCapSuggestion(
        pile_count=n,
        width=round(width, 2),
        length=round(length, 2),
        height=round(height, 2),
        pile_spacing=round(spacing, 2),
        edge_distance=round(edge, 2),
        arrangement=[(round(x, 3), round(y, 3)) for x, y in positions],
        notes=notes,
    )
