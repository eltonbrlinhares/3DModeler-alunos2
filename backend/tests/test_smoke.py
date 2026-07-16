"""Smoke test: cria modelo em branco, adiciona muro, salva, recarrega."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200


def test_create_and_summary():
    r = client.post("/ifc/models", json={"name": "smoke"})
    assert r.status_code == 200
    mid = r.json()["model_id"]

    r = client.get(f"/ifc/models/{mid}/summary")
    assert r.status_code == 200
    body = r.json()
    assert body["schema"] == "IFC4"
    assert body["type_counts"].get("IfcProject", 0) == 1


def test_create_wall_and_save():
    mid = client.post("/ifc/models", json={"name": "walltest"}).json()["model_id"]
    r = client.post(f"/ifc/models/{mid}/edit/wall", json={"name": "W1"})
    assert r.status_code == 200
    guid = r.json()["guid"]

    r = client.get(f"/ifc/models/{mid}/entity/{guid}")
    assert r.status_code == 200
    assert r.json()["type"] == "IfcWall"

    r = client.post(f"/ifc/models/{mid}/save")
    assert r.status_code == 200


def _new_model(name="geo"):
    return client.post("/ifc/models", json={"name": name}).json()["model_id"]


def test_wall_has_geometry_in_mesh():
    """Fase 1: parede criada aparece no mesh com bbox não-nulo."""
    mid = _new_model()
    r = client.post(
        f"/ifc/models/{mid}/geometry/wall",
        json={"name": "W", "length": 5, "height": 3, "thickness": 0.2},
    )
    assert r.status_code == 200, r.text

    mesh = client.get(f"/ifc/models/{mid}/mesh").json()
    assert len(mesh["products"]) == 1
    prod = mesh["products"][0]
    assert prod["type"] == "IfcWall"
    assert len(prod["vertices"]) > 0
    assert len(prod["indices"]) > 0
    bb = mesh["bbox"]
    assert bb["max"][0] - bb["min"][0] > 0


def test_placement_moves_bbox():
    """Fase 2: editar placement desloca o bbox do produto."""
    mid = _new_model()
    guid = client.post(
        f"/ifc/models/{mid}/geometry/wall", json={"name": "W"}
    ).json()["guid"]

    before = client.get(f"/ifc/models/{mid}/mesh/{guid}").json()
    x0 = before["bbox"]["min"][0]

    r = client.post(
        f"/ifc/models/{mid}/geometry/placement",
        json={"guid": guid, "position": [10.0, 0.0, 0.0]},
    )
    assert r.status_code == 200, r.text

    after = client.get(f"/ifc/models/{mid}/mesh/{guid}").json()
    x1 = after["bbox"]["min"][0]
    assert abs((x1 - x0) - 10.0) < 1e-6


def test_relative_translate_is_cumulative():
    """Fase 5: translate relativo (gizmo) compõe sobre o placement atual."""
    mid = _new_model()
    guid = client.post(
        f"/ifc/models/{mid}/geometry/wall", json={"name": "W"}
    ).json()["guid"]
    x0 = client.get(f"/ifc/models/{mid}/mesh/{guid}").json()["bbox"]["min"][0]

    client.post(
        f"/ifc/models/{mid}/geometry/placement",
        json={"guid": guid, "translate": [3.0, 0.0, 0.0]},
    )
    client.post(
        f"/ifc/models/{mid}/geometry/placement",
        json={"guid": guid, "translate": [2.0, 0.0, 0.0]},
    )
    x1 = client.get(f"/ifc/models/{mid}/mesh/{guid}").json()["bbox"]["min"][0]
    assert abs((x1 - x0) - 5.0) < 1e-6


def _span(mesh):
    bb = mesh["bbox"]
    return [bb["max"][i] - bb["min"][i] for i in range(3)]


def test_create_slab():
    mid = _new_model()
    guid = client.post(
        f"/ifc/models/{mid}/geometry/slab",
        json={"name": "S", "length": 4, "width": 3, "thickness": 0.25},
    ).json()["guid"]
    sx, sy, sz = _span(client.get(f"/ifc/models/{mid}/mesh/{guid}").json())
    assert abs(sx - 4) < 1e-6 and abs(sy - 3) < 1e-6 and abs(sz - 0.25) < 1e-6


def test_create_polygon_slab_below_top_plane():
    mid = _new_model()
    guid = client.post(
        f"/ifc/models/{mid}/geometry/slab",
        json={
            "name": "S-poly",
            "thickness": 0.25,
            "position": [10, 5, 2.75],
            "polyline": [[0, 0], [4, 0], [4, 2], [2, 2], [2, 3], [0, 3]],
        },
    ).json()["guid"]
    mesh = client.get(f"/ifc/models/{mid}/mesh/{guid}").json()
    sx, sy, sz = _span(mesh)
    assert abs(sx - 4) < 1e-6 and abs(sy - 3) < 1e-6 and abs(sz - 0.25) < 1e-6
    assert abs(mesh["bbox"]["max"][2] - 3) < 1e-6
    assert abs(mesh["bbox"]["min"][2] - 2.75) < 1e-6


def test_create_column():
    mid = _new_model()
    guid = client.post(
        f"/ifc/models/{mid}/geometry/column",
        json={"name": "C", "width": 0.4, "depth": 0.4, "height": 3},
    ).json()["guid"]
    sx, sy, sz = _span(client.get(f"/ifc/models/{mid}/mesh/{guid}").json())
    assert abs(sx - 0.4) < 1e-6 and abs(sy - 0.4) < 1e-6 and abs(sz - 3) < 1e-6


def test_create_column_with_profile():
    mid = _new_model()
    guid = client.post(
        f"/ifc/models/{mid}/geometry/column",
        json={
            "name": "C-profile",
            "profile": "W200x15",
            "shape": "H",
            "h": 0.203,
            "b": 0.102,
            "tw": 0.0058,
            "tf": 0.0084,
            "height": 3,
        },
    ).json()["guid"]
    sx, sy, sz = _span(client.get(f"/ifc/models/{mid}/mesh/{guid}").json())
    assert abs(sx - 0.102) < 1e-5 and abs(sy - 0.203) < 1e-5 and abs(sz - 3) < 1e-5


def test_create_beam_horizontal():
    """Viga horizontal: comprimento ao longo de X, seção width×depth em Y/Z."""
    mid = _new_model()
    guid = client.post(
        f"/ifc/models/{mid}/geometry/beam",
        json={"name": "B", "width": 0.2, "depth": 0.3, "length": 5},
    ).json()["guid"]
    sx, sy, sz = _span(client.get(f"/ifc/models/{mid}/mesh/{guid}").json())
    assert abs(sx - 5) < 1e-5  # eixo da viga
    assert abs(sy - 0.2) < 1e-5 and abs(sz - 0.3) < 1e-5


def test_create_beam_with_profile():
    mid = _new_model()
    guid = client.post(
        f"/ifc/models/{mid}/geometry/beam",
        json={
            "name": "B-profile",
            "profile": "W310X23.8",
            "shape": "I",
            "h": 0.305,
            "b": 0.101,
            "tw": 0.00559,
            "tf": 0.00673,
            "length": 5,
        },
    ).json()["guid"]
    sx, sy, sz = _span(client.get(f"/ifc/models/{mid}/mesh/{guid}").json())
    assert abs(sx - 5) < 1e-5  # eixo da viga
    assert abs(sy - 0.101) < 1e-5 and abs(sz - 0.305) < 1e-5


def test_rotate_swaps_extent():
    """rotate_z=90° troca os eixos da extensão da parede (x<->y)."""
    import math

    mid = _new_model()
    guid = client.post(
        f"/ifc/models/{mid}/geometry/wall",
        json={"name": "W", "length": 5, "height": 3, "thickness": 0.2},
    ).json()["guid"]
    before = _span(client.get(f"/ifc/models/{mid}/mesh/{guid}").json())
    assert abs(before[0] - 5) < 1e-6  # comprimento ao longo de X

    r = client.post(
        f"/ifc/models/{mid}/geometry/placement",
        json={"guid": guid, "rotate_z": math.pi / 2},
    )
    assert r.status_code == 200, r.text
    after = _span(client.get(f"/ifc/models/{mid}/mesh/{guid}").json())
    assert abs(after[1] - 5) < 1e-6  # agora ao longo de Y
    assert abs(after[0] - 0.2) < 1e-6


def test_rotate_around_bbox_center_keeps_center():
    """rotation_center faz a rotacao relativa usar o centro visual do gizmo."""
    import math

    mid = _new_model()
    guid = client.post(
        f"/ifc/models/{mid}/geometry/wall",
        json={"name": "W", "length": 5, "height": 3, "thickness": 0.2},
    ).json()["guid"]
    before = client.get(f"/ifc/models/{mid}/mesh/{guid}").json()["bbox"]
    center = [(before["min"][i] + before["max"][i]) / 2 for i in range(3)]

    r = client.post(
        f"/ifc/models/{mid}/geometry/placement",
        json={"guid": guid, "rotate_z": math.pi / 2, "rotation_center": center},
    )
    assert r.status_code == 200, r.text
    after = client.get(f"/ifc/models/{mid}/mesh/{guid}").json()["bbox"]
    after_center = [(after["min"][i] + after["max"][i]) / 2 for i in range(3)]
    assert all(abs(after_center[i] - center[i]) < 1e-6 for i in range(3))


def test_rotation_matrix_swaps_extent():
    """rotation_matrix aceita a rotacao relativa enviada pelo gizmo local."""
    mid = _new_model()
    guid = client.post(
        f"/ifc/models/{mid}/geometry/wall",
        json={"name": "W", "length": 5, "height": 3, "thickness": 0.2},
    ).json()["guid"]
    before = client.get(f"/ifc/models/{mid}/mesh/{guid}").json()["bbox"]
    center = [(before["min"][i] + before["max"][i]) / 2 for i in range(3)]

    r = client.post(
        f"/ifc/models/{mid}/geometry/placement",
        json={
            "guid": guid,
            "rotation_center": center,
            "rotation_matrix": [
                0.0, -1.0, 0.0,
                1.0, 0.0, 0.0,
                0.0, 0.0, 1.0,
            ],
        },
    )
    assert r.status_code == 200, r.text
    after = _span(client.get(f"/ifc/models/{mid}/mesh/{guid}").json())
    assert abs(after[1] - 5) < 1e-6
    assert abs(after[0] - 0.2) < 1e-6


def test_undo_redo_restores_model():
    """Fase 6: undo desfaz a criação de uma parede; redo refaz."""
    mid = _new_model()
    base = len(client.get(f"/ifc/models/{mid}/entities?type=IfcWall").json())

    client.post(f"/ifc/models/{mid}/geometry/wall", json={"name": "W"})
    assert len(client.get(f"/ifc/models/{mid}/entities?type=IfcWall").json()) == base + 1

    r = client.post(f"/ifc/models/{mid}/history/undo")
    assert r.status_code == 200 and r.json()["ok"] is True
    assert len(client.get(f"/ifc/models/{mid}/entities?type=IfcWall").json()) == base

    r = client.post(f"/ifc/models/{mid}/history/redo")
    assert r.status_code == 200 and r.json()["ok"] is True
    assert len(client.get(f"/ifc/models/{mid}/entities?type=IfcWall").json()) == base + 1

    # undo sem histórico → ok=False
    client.post(f"/ifc/models/{mid}/history/undo")
    assert client.post(f"/ifc/models/{mid}/history/undo").json()["ok"] is False


def test_validate_and_save_reports_issues():
    """Fase 6: validate retorna estrutura; save inclui o relatório."""
    mid = _new_model()
    client.post(f"/ifc/models/{mid}/geometry/wall", json={"name": "W"})

    v = client.get(f"/ifc/models/{mid}/validate").json()
    assert "valid" in v and "issues" in v and isinstance(v["issues"], list)

    s = client.post(f"/ifc/models/{mid}/save").json()
    assert "valid" in s and "issues" in s and "path" in s


def test_export_glb():
    """Fase 7: exporta glTF binário com magic 'glTF'."""
    mid = _new_model()
    client.post(f"/ifc/models/{mid}/geometry/wall", json={"name": "W"})
    r = client.get(f"/ifc/models/{mid}/export/glb")
    assert r.status_code == 200
    assert r.headers["content-type"] == "model/gltf-binary"
    assert r.content[:4] == b"glTF"  # magic do glb
    assert len(r.content) > 100


def test_edit_dimensions():
    """Fase 1: alterar dimensões regenera a representação."""
    mid = _new_model()
    guid = client.post(
        f"/ifc/models/{mid}/geometry/wall",
        json={"name": "W", "length": 4, "height": 3, "thickness": 0.2},
    ).json()["guid"]

    before = client.get(f"/ifc/models/{mid}/mesh/{guid}").json()["bbox"]
    len_before = before["max"][0] - before["min"][0]

    r = client.post(
        f"/ifc/models/{mid}/geometry/dimensions",
        json={"guid": guid, "length": 8, "height": 3, "thickness": 0.2},
    )
    assert r.status_code == 200, r.text

    after = client.get(f"/ifc/models/{mid}/mesh/{guid}").json()["bbox"]
    len_after = after["max"][0] - after["min"][0]
    assert len_after > len_before
    assert abs(len_after - 8.0) < 1e-6


def test_spatial_bootstrap_and_assign():
    """Fase 3: Site->Building->Storey e parede contida no storey."""
    mid = _new_model()
    r = client.post(
        f"/ifc/models/{mid}/spatial/bootstrap",
        json={"storeys": [{"name": "L0", "elevation": 0.0},
                          {"name": "L1", "elevation": 3.0}]},
    )
    assert r.status_code == 200, r.text
    storey0 = r.json()["storeys"][0]["guid"]

    guid = client.post(
        f"/ifc/models/{mid}/geometry/wall", json={"name": "W"}
    ).json()["guid"]
    r = client.post(
        f"/ifc/models/{mid}/spatial/assign",
        json={"guid": guid, "container_guid": storey0},
    )
    assert r.status_code == 200, r.text

    tree = client.get(f"/ifc/models/{mid}/spatial/tree").json()
    assert tree["type"] == "IfcProject"
    site = tree["children"][0]
    assert site["type"] == "IfcSite"
    building = site["children"][0]
    assert building["type"] == "IfcBuilding"
    storeys = {s["name"]: s for s in building["children"]}
    assert set(storeys) == {"L0", "L1"}
    # parede está contida no L0
    wall_guids = [c["guid"] for c in storeys["L0"]["children"]]
    assert guid in wall_guids


def test_levels_crud():
    """Fase 8: listar/criar/editar/apagar níveis (storeys como datum)."""
    mid = _new_model()
    client.post(f"/ifc/models/{mid}/spatial/bootstrap", json={})

    levels = client.get(f"/ifc/models/{mid}/levels").json()
    assert len(levels) == 1 and levels[0]["elevation"] == 0.0

    r = client.post(f"/ifc/models/{mid}/levels", json={"name": "L1", "elevation": 3.0})
    assert r.status_code == 200, r.text
    l1 = r.json()["guid"]

    levels = client.get(f"/ifc/models/{mid}/levels").json()
    assert [l["elevation"] for l in levels] == [0.0, 3.0]  # ordenado por cota

    r = client.patch(f"/ifc/models/{mid}/levels/{l1}", json={"elevation": 6.0})
    assert r.status_code == 200 and r.json()["elevation"] == 6.0

    r = client.delete(f"/ifc/models/{mid}/levels/{l1}")
    assert r.status_code == 200
    assert len(client.get(f"/ifc/models/{mid}/levels").json()) == 1


def test_delete_level_with_elements_rejected():
    """Apagar nível que contém elementos exige force=true."""
    mid = _new_model()
    storey = client.post(
        f"/ifc/models/{mid}/spatial/bootstrap", json={}
    ).json()["storeys"][0]["guid"]
    client.post(
        f"/ifc/models/{mid}/geometry/wall", json={"name": "W", "storey_guid": storey}
    )
    assert client.delete(f"/ifc/models/{mid}/levels/{storey}").status_code == 409
    assert client.delete(
        f"/ifc/models/{mid}/levels/{storey}?force=true"
    ).status_code == 200


def test_grid_create_and_list():
    """Fase 8: criar grid 2×2 e ler de volta a geometria dos eixos (metros)."""
    mid = _new_model()
    r = client.post(
        f"/ifc/models/{mid}/grids",
        json={
            "name": "G",
            "u": [{"tag": "A", "x": 0.0}, {"tag": "B", "x": 5.0}],
            "v": [{"tag": "1", "y": 0.0}, {"tag": "2", "y": 4.0}],
        },
    )
    assert r.status_code == 200, r.text
    guid = r.json()["guid"]

    grids = client.get(f"/ifc/models/{mid}/grids").json()
    assert len(grids) == 1
    g = grids[0]
    assert [a["tag"] for a in g["u_axes"]] == ["A", "B"]
    assert [a["tag"] for a in g["v_axes"]] == ["1", "2"]
    # eixo U "B" fica em x=5 (linha paralela a Y): ambos os pontos têm x≈5
    b = next(a for a in g["u_axes"] if a["tag"] == "B")
    assert abs(b["p0"][0] - 5.0) < 1e-6 and abs(b["p1"][0] - 5.0) < 1e-6

    assert client.delete(f"/ifc/models/{mid}/grids/{guid}").status_code == 200
    assert client.get(f"/ifc/models/{mid}/grids").json() == []


def test_grid_extent_covers_positive_axis_range():
    """Grid em coordenadas positivas deve cobrir todos os cruzamentos de eixos."""
    mid = _new_model()
    r = client.post(
        f"/ifc/models/{mid}/grids",
        json={
            "name": "G",
            "u": [
                {"tag": "A", "x": 0.0},
                {"tag": "B", "x": 5.0},
                {"tag": "C", "x": 10.0},
            ],
            "v": [
                {"tag": "1", "y": 0.0},
                {"tag": "2", "y": 5.0},
                {"tag": "3", "y": 10.0},
            ],
        },
    )
    assert r.status_code == 200, r.text

    grid = client.get(f"/ifc/models/{mid}/grids").json()[0]
    c_axis = next(a for a in grid["u_axes"] if a["tag"] == "C")
    axis_3 = next(a for a in grid["v_axes"] if a["tag"] == "3")

    c_y = sorted([c_axis["p0"][1], c_axis["p1"][1]])
    axis_3_x = sorted([axis_3["p0"][0], axis_3["p1"][0]])
    assert c_y[0] < 0.0 and c_y[1] > 10.0
    assert axis_3_x[0] < 0.0 and axis_3_x[1] > 10.0


def test_wall_created_in_storey():
    """Fase 3: criar parede já dentro de um storey via storey_guid."""
    mid = _new_model()
    storey = client.post(
        f"/ifc/models/{mid}/spatial/bootstrap", json={}
    ).json()["storeys"][0]["guid"]
    guid = client.post(
        f"/ifc/models/{mid}/geometry/wall",
        json={"name": "W", "storey_guid": storey},
    ).json()["guid"]

    tree = client.get(f"/ifc/models/{mid}/spatial/tree").json()
    storey_node = tree["children"][0]["children"][0]["children"][0]
    assert guid in [c["guid"] for c in storey_node["children"]]


def test_edit_attributes_renames_and_undo_restores():
    """edit/attributes muda o Name; undo restaura (snapshot via mutate)."""
    mid = _new_model()
    guid = client.post(
        f"/ifc/models/{mid}/geometry/wall", json={"name": "W"}
    ).json()["guid"]

    r = client.post(
        f"/ifc/models/{mid}/edit/attributes",
        json={"guid": guid, "attributes": {"Name": "Parede-A"}},
    )
    assert r.status_code == 200, r.text
    assert client.get(f"/ifc/models/{mid}/entity/{guid}").json()[
        "attributes"
    ]["Name"] == "Parede-A"

    assert client.post(f"/ifc/models/{mid}/history/undo").json()["ok"] is True
    assert client.get(f"/ifc/models/{mid}/entity/{guid}").json()[
        "attributes"
    ]["Name"] == "W"


def test_edit_pset_adds_properties():
    """edit/pset cria um property set lido de volta no detalhe da entidade."""
    mid = _new_model()
    guid = client.post(
        f"/ifc/models/{mid}/geometry/wall", json={"name": "W"}
    ).json()["guid"]

    r = client.post(
        f"/ifc/models/{mid}/edit/pset",
        json={
            "guid": guid,
            "pset_name": "Pset_Custom",
            "properties": {"FireRating": "REI60"},
        },
    )
    assert r.status_code == 200, r.text
    psets = client.get(f"/ifc/models/{mid}/entity/{guid}").json()["psets"]
    assert psets["Pset_Custom"]["FireRating"] == "REI60"


def test_delete_entity_removes_and_undo_restores():
    """edit/delete remove o produto; undo o traz de volta."""
    mid = _new_model()
    guid = client.post(
        f"/ifc/models/{mid}/geometry/wall", json={"name": "W"}
    ).json()["guid"]
    assert len(client.get(f"/ifc/models/{mid}/entities?type=IfcWall").json()) == 1

    r = client.post(f"/ifc/models/{mid}/edit/delete", json={"guid": guid})
    assert r.status_code == 200, r.text
    assert len(client.get(f"/ifc/models/{mid}/entities?type=IfcWall").json()) == 0

    assert client.post(f"/ifc/models/{mid}/history/undo").json()["ok"] is True
    assert len(client.get(f"/ifc/models/{mid}/entities?type=IfcWall").json()) == 1


def test_edit_unknown_guid_returns_404():
    """guid inexistente em edit/attributes → 404 (by_guid → RuntimeError)."""
    mid = _new_model()
    r = client.post(
        f"/ifc/models/{mid}/edit/attributes",
        json={"guid": "0" * 22, "attributes": {"Name": "x"}},
    )
    assert r.status_code == 404


def test_unknown_model_returns_404():
    """model_id inexistente → 404 pela dependência get_entry."""
    assert client.get("/ifc/models/nao-existe/mesh").status_code == 404
    assert client.get("/ifc/models/nao-existe/levels").status_code == 404


def test_level_constrained_wall_and_column_follow_elevations():
    """Paredes/pilares entre níveis acompanham base e topo parametricamente."""
    mid = _new_model("level-bindings")
    storeys = client.post(
        f"/ifc/models/{mid}/spatial/bootstrap",
        json={
            "storeys": [
                {"name": "Térreo", "elevation": 0.0},
                {"name": "Cobertura", "elevation": 3.0},
            ]
        },
    ).json()["storeys"]
    base_guid = storeys[0]["guid"]
    top_guid = storeys[1]["guid"]

    wall_guid = client.post(
        f"/ifc/models/{mid}/geometry/wall",
        json={
            "name": "W-Níveis",
            "length": 4.0,
            "height": 3.0,
            "thickness": 0.2,
            "position": [0.0, 0.0, 0.0],
            "storey_guid": base_guid,
            "top_level_guid": top_guid,
        },
    ).json()["guid"]
    column_guid = client.post(
        f"/ifc/models/{mid}/geometry/column",
        json={
            "name": "C-Níveis",
            "width": 0.4,
            "depth": 0.4,
            "height": 3.0,
            "position": [5.0, 0.0, 0.0],
            "storey_guid": base_guid,
            "top_level_guid": top_guid,
        },
    ).json()["guid"]

    # Elevar a cobertura alonga os dois elementos sem mover a base.
    r = client.patch(
        f"/ifc/models/{mid}/levels/{top_guid}", json={"elevation": 4.0}
    )
    assert r.status_code == 200, r.text
    for guid in (wall_guid, column_guid):
        bbox = client.get(f"/ifc/models/{mid}/mesh/{guid}").json()["bbox"]
        assert abs(bbox["min"][2] - 0.0) < 1e-5
        assert abs(bbox["max"][2] - 4.0) < 1e-5

    # Elevar a base reposiciona a origem e reduz a altura até o topo fixo.
    r = client.patch(
        f"/ifc/models/{mid}/levels/{base_guid}", json={"elevation": 1.0}
    )
    assert r.status_code == 200, r.text
    for guid in (wall_guid, column_guid):
        bbox = client.get(f"/ifc/models/{mid}/mesh/{guid}").json()["bbox"]
        assert abs(bbox["min"][2] - 1.0) < 1e-5
        assert abs(bbox["max"][2] - 4.0) < 1e-5


def test_face_fit_top_referenced_beam_between_columns():
    """Viga desenhada pelo topo deve parar nas faces, não nos eixos."""
    mid = _new_model("face-fit-columns")
    columns = []
    for x in (0.0, 4.0):
        columns.append(
            client.post(
                f"/ifc/models/{mid}/geometry/column",
                json={
                    "name": f"C-{x}",
                    "width": 0.30,
                    "depth": 0.30,
                    "height": 3.0,
                    "position": [x, 0.0, 0.0],
                },
            ).json()["guid"]
        )
    beam = client.post(
        f"/ifc/models/{mid}/geometry/beam",
        json={
            "name": "B-face",
            "width": 0.20,
            "depth": 0.30,
            "length": 4.0,
            "position": [0.0, 0.0, 2.85],
        },
    ).json()["guid"]

    bbox = client.get(f"/ifc/models/{mid}/mesh/{beam}").json()["bbox"]
    assert abs(bbox["min"][0] - 0.15) < 1e-6
    assert abs(bbox["max"][0] - 3.85) < 1e-6

    connections = client.get(
        f"/ifc/models/{mid}/connectivity/{beam}"
    ).json()["connections"]
    assert {c["guid"] for c in connections} == set(columns)
    assert all(c["role"] == "supported_by" for c in connections)


def test_face_fit_uses_real_steel_profile_envelope():
    """O recorte deve usar b/h do perfil metálico, não os defaults 0,4×0,4."""
    mid = _new_model("face-fit-steel")
    client.post(
        f"/ifc/models/{mid}/geometry/column",
        json={
            "name": "W200",
            "profile": "W200x15",
            "shape": "H",
            "h": 0.203,
            "b": 0.102,
            "tw": 0.0058,
            "tf": 0.0084,
            "height": 3.0,
            "position": [0.0, 0.0, 0.0],
        },
    )
    beam = client.post(
        f"/ifc/models/{mid}/geometry/beam",
        json={
            "name": "B",
            "width": 0.20,
            "depth": 0.30,
            "length": 4.0,
            "position": [0.0, 0.0, 2.85],
        },
    ).json()["guid"]
    bbox = client.get(f"/ifc/models/{mid}/mesh/{beam}").json()["bbox"]
    assert abs(bbox["min"][0] - 0.051) < 1e-5


def test_face_fit_rotated_column_uses_oblique_face_plane():
    """Pilar girado deve gerar corte na própria face inclinada."""
    import math

    mid = _new_model("face-fit-rotated")
    client.post(
        f"/ifc/models/{mid}/geometry/column",
        json={
            "name": "C45",
            "width": 0.40,
            "depth": 0.20,
            "height": 3.0,
            "position": [0.0, 0.0, 0.0],
            "rotation_z": math.pi / 4.0,
        },
    )
    beam = client.post(
        f"/ifc/models/{mid}/geometry/beam",
        json={
            "name": "B",
            "width": 0.10,
            "depth": 0.30,
            "length": 4.0,
            "position": [0.0, 0.0, 2.85],
        },
    ).json()["guid"]
    product = client.get(f"/ifc/models/{mid}/mesh/{beam}").json()["products"][0]
    vertices = product["vertices"]
    start_vertices = [
        vertices[i : i + 3]
        for i in range(0, len(vertices), 3)
        if vertices[i] < 0.5
    ]
    assert len(start_vertices) == 4
    c = math.cos(math.pi / 4.0)
    s = math.sin(math.pi / 4.0)
    for x, y, _ in start_vertices:
        v = -s * x + c * y
        assert abs(v + 0.10) < 1e-6


def test_face_fit_t_junction_with_different_beam_depths():
    """Vigas alinhadas pelo topo conectam mesmo com eixos em cotas distintas."""
    import math

    mid = _new_model("face-fit-t")
    main = client.post(
        f"/ifc/models/{mid}/geometry/beam",
        json={
            "name": "Principal",
            "width": 0.30,
            "depth": 0.50,
            "length": 4.0,
            "position": [0.0, 0.0, 2.75],
        },
    ).json()["guid"]
    secondary = client.post(
        f"/ifc/models/{mid}/geometry/beam",
        json={
            "name": "Secundária",
            "width": 0.20,
            "depth": 0.30,
            "length": 2.0,
            "position": [2.0, 0.0, 2.85],
            "rotation_z": math.pi / 2.0,
        },
    ).json()["guid"]

    main_bbox = client.get(f"/ifc/models/{mid}/mesh/{main}").json()["bbox"]
    secondary_bbox = client.get(
        f"/ifc/models/{mid}/mesh/{secondary}"
    ).json()["bbox"]
    assert abs(main_bbox["min"][0] - 0.0) < 1e-6
    assert abs(main_bbox["max"][0] - 4.0) < 1e-6
    assert abs(secondary_bbox["min"][1] - 0.15) < 1e-6

    connections = client.get(
        f"/ifc/models/{mid}/connectivity/{secondary}"
    ).json()["connections"]
    assert len(connections) == 1
    assert connections[0]["guid"] == main
    assert connections[0]["role"] == "crosses"


def test_face_fit_right_angle_beams_share_corner_without_gap_even_on_column():
    """Num canto 90° com pilar no nó, as duas vigas não devem ficar separadas."""
    import math

    mid = _new_model("face-fit-corner")
    client.post(
        f"/ifc/models/{mid}/geometry/column",
        json={
            "name": "Canto",
            "width": 0.30,
            "depth": 0.30,
            "height": 3.0,
            "position": [0.0, 0.0, 0.0],
        },
    )
    beam_x = client.post(
        f"/ifc/models/{mid}/geometry/beam",
        json={
            "name": "VX",
            "width": 0.20,
            "depth": 0.30,
            "length": 2.0,
            "position": [0.0, 0.0, 2.85],
        },
    ).json()["guid"]
    beam_y = client.post(
        f"/ifc/models/{mid}/geometry/beam",
        json={
            "name": "VY",
            "width": 0.20,
            "depth": 0.30,
            "length": 2.0,
            "position": [0.0, 0.0, 2.85],
            "rotation_z": math.pi / 2.0,
        },
    ).json()["guid"]

    bbox_x = client.get(f"/ifc/models/{mid}/mesh/{beam_x}").json()["bbox"]
    bbox_y = client.get(f"/ifc/models/{mid}/mesh/{beam_y}").json()["bbox"]

    # Sem a priorização do encontro viga↔viga, o recorte parava em 0,15 m
    # (face do pilar). O ajuste correto encosta as vigas pelo menos na face da
    # outra viga: 0,10 m para largura 0,20 m.
    assert abs(bbox_x["min"][0] - 0.10) < 1e-6
    assert abs(bbox_y["min"][1] - 0.10) < 1e-6


def test_deleting_support_restores_previous_beam_cut():
    """Ao apagar o receptor, a viga restante volta ao comprimento lógico."""
    import math

    mid = _new_model("face-fit-delete")
    main = client.post(
        f"/ifc/models/{mid}/geometry/beam",
        json={
            "name": "Principal",
            "width": 0.30,
            "depth": 0.50,
            "length": 4.0,
            "position": [0.0, 0.0, 2.75],
        },
    ).json()["guid"]
    secondary = client.post(
        f"/ifc/models/{mid}/geometry/beam",
        json={
            "name": "Secundária",
            "width": 0.20,
            "depth": 0.30,
            "length": 2.0,
            "position": [2.0, 0.0, 2.85],
            "rotation_z": math.pi / 2.0,
        },
    ).json()["guid"]
    before = client.get(f"/ifc/models/{mid}/mesh/{secondary}").json()["bbox"]
    assert abs(before["min"][1] - 0.15) < 1e-6

    r = client.post(f"/ifc/models/{mid}/edit/delete", json={"guid": main})
    assert r.status_code == 200, r.text
    after = client.get(f"/ifc/models/{mid}/mesh/{secondary}").json()["bbox"]
    assert abs(after["min"][1] - 0.0) < 1e-6
    assert abs(after["max"][1] - 2.0) < 1e-6
