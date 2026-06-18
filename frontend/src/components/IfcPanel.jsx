/**
 * src/components/IfcPanel.jsx
 *
 * Painel de edição de modelos IFC 3D. Conversa com o backend FastAPI via
 * `ifcApi` e injeta/edita a malha na cena do ThreeCanvas (Z-up, igual ao IFC).
 *
 * Responsabilidades deste arquivo: UI (formulários, listas, ações de modelo) e
 * fiação dos "controllers". A lógica de INSERÇÃO de geometria mora em:
 *   - src/ifc/insertion/InsertionController.js  (eventos)
 *   - src/ifc/tools/*                            (uma ferramenta por geometria)
 *   - src/ifc/geometry/*                         (geometria de preview, pura)
 * Ver estrutura_pedagogica.md na raiz do projeto.
 */

import { useEffect, useRef, useState, useCallback } from "react";

import ifcApi from "../services/ifcApi.js";
import { IfcSceneManager } from "../ifc/IfcSceneManager.js";
import { IfcDatumManager } from "../ifc/IfcDatumManager.js";
import { InsertionController } from "../ifc/insertion/InsertionController.js";
import { SelectionController } from "../ifc/insertion/SelectionController.js";
import { TransformController } from "../ifc/insertion/TransformController.js";
import { INSERTION_TOOLS } from "../ifc/tools/index.js";

// O seletor de tipo, os campos do formulário e o botão "+ Elemento" são
// dirigidos pelo registro de ferramentas (cada uma carrega label/fields/defaults).
const ELEMENT_FORMS = INSERTION_TOOLS;

export default function IfcPanel({
  canvasRef,
  onClose,
  translationSnap = 0,
  rotationSnap = 0,
}) {
  const [modelId, setModelId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [elements, setElements] = useState([]);
  const [selected, setSelected] = useState(null); // { guid, type, name }
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState("Sem modelo. Crie ou faça upload.");
  const [busy, setBusy] = useState(false);
  const [elemType, setElemType] = useState("wall");
  const [form, setForm] = useState({ ...ELEMENT_FORMS.wall.defaults });
  const [dims, setDims] = useState({ length: 5, height: 3, thickness: 0.2 });
  const [rename, setRename] = useState("");
  const [insertMode, setInsertMode] = useState(null);
  // ── níveis & grids (datums) ──
  const [levels, setLevels] = useState([]);
  const [activeLevelGuid, setActiveLevelGuid] = useState(null);
  const [grids, setGrids] = useState([]);
  const [levelsVisible, setLevelsVisible] = useState(true);
  const [gridsVisible, setGridsVisible] = useState(true);
  const [newLevel, setNewLevel] = useState({ name: "Level", elevation: 3 });
  const [gridForm, setGridForm] = useState({ nu: 3, nv: 3, spacing: 5 });

  const mgrRef = useRef(null);
  const datumRef = useRef(null);
  const transformRef = useRef(null);
  const selectionRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const orbitRef = useRef(null);
  const domRef = useRef(null);
  const insertionRef = useRef(null);
  const modelIdRef = useRef(null);
  const selectedRef = useRef(null);
  const formRef = useRef(form);
  const elementsRef = useRef(elements);
  const levelsRef = useRef(levels);
  const gridsRef = useRef(grids);
  const activeLevelGuidRef = useRef(activeLevelGuid);
  modelIdRef.current = modelId;
  selectedRef.current = selected;
  formRef.current = form;
  elementsRef.current = elements;
  levelsRef.current = levels;
  gridsRef.current = grids;
  activeLevelGuidRef.current = activeLevelGuid;

  const fail = useCallback((e) => {
    console.error("[IFC]", e);
    setStatus(`Erro: ${e.message ?? e}`);
    setBusy(false);
  }, []);

  // nível ativo (objeto bruto) para a inserção; o controller faz a cópia travada
  const activeInsertionLevel = () => {
    const lvls = levelsRef.current ?? [];
    return (
      lvls.find((level) => level.guid === activeLevelGuidRef.current) ??
      lvls[0] ??
      { guid: null, name: "Level 0", elevation: 0 }
    );
  };

  // ── setup three: manager + datums + gizmo + seleção + inserção ────────────
  useEffect(() => {
    const scene = canvasRef.current?.getScene?.();
    const camera = canvasRef.current?.getCamera?.();
    const orbit = canvasRef.current?.getOrbitControls?.();
    if (!scene || !camera || !orbit) {
      setStatus("Viewport não pronto — reabra o painel.");
      return;
    }
    const dom = orbit.domElement;
    sceneRef.current = scene;
    cameraRef.current = camera;
    orbitRef.current = orbit;
    domRef.current = dom;
    const mgr = new IfcSceneManager(scene);
    mgrRef.current = mgr;

    const datum = new IfcDatumManager(scene, camera, dom);
    datumRef.current = datum;

    // gizmo de mover/girar
    const transform = new TransformController({
      camera,
      dom,
      scene,
      orbit,
      getManager: () => mgrRef.current,
      onCommit: (mesh, params) => applyTransform(mesh, params),
    });
    transform.setTranslationSnap(translationSnap);
    transform.setRotationSnap(rotationSnap);
    transformRef.current = transform;

    // controller de inserção: dono dos eventos de criar geometria (tools)
    const insertion = new InsertionController({
      api: ifcApi,
      getScene: () => scene,
      getCamera: () => camera,
      getDom: () => dom,
      getOrbit: () => orbit,
      getGrids: () => gridsRef.current,
      getLevels: () => levelsRef.current,
      getDatumManager: () => datumRef.current,
      getActiveLevel: () => activeInsertionLevel(),
      getForm: () => formRef.current,
      getModelId: () => modelIdRef.current,
      getElementsCount: () => elementsRef.current.length,
      getManager: () => mgrRef.current,
      firstStorey,
      refreshLists,
      setStatus,
      setBusy,
      setInsertMode,
      onError: fail,
    });
    insertion.attach();
    insertionRef.current = insertion;

    // seleção por clique (raycast). Inerte durante inserção ou arraste de gizmo.
    const selection = new SelectionController({
      camera,
      dom,
      getManager: () => mgrRef.current,
      onPick: (guid) => selectGuid(guid),
      isInserting: () => insertion.active,
      isTransforming: () => transform.dragging,
    });
    selection.attach();
    selectionRef.current = selection;

    return () => {
      selection.dispose();
      insertion.dispose();
      transform.dispose();
      orbit.enabled = true;
      mgr.dispose();
      datum.dispose();
      if (domRef.current) domRef.current.style.cursor = "";
      mgrRef.current = null;
      datumRef.current = null;
      transformRef.current = null;
      selectionRef.current = null;
      insertionRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      orbitRef.current = null;
      domRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    transformRef.current?.setTranslationSnap(translationSnap);
  }, [translationSnap]);

  useEffect(() => {
    transformRef.current?.setRotationSnap(rotationSnap);
  }, [rotationSnap]);

  // ao trocar o tipo, recarrega os valores padrão daquele elemento
  useEffect(() => {
    setForm({ ...ELEMENT_FORMS[elemType].defaults });
  }, [elemType]);

  useEffect(() => {
    if (!levels.length) {
      setActiveLevelGuid(null);
      return;
    }
    setActiveLevelGuid((guid) =>
      levels.some((level) => level.guid === guid) ? guid : levels[0].guid
    );
  }, [levels]);

  // ── dados ────────────────────────────────────────────────────────────────
  const refreshMesh = useCallback(async (id) => {
    const bbox = mgrRef.current?.loadModel(await ifcApi.mesh(id));
    datumRef.current?.setBBox(bbox); // dimensiona os planos de nível
  }, []);

  // carrega níveis + grids e os desenha na camada de datums
  const refreshDatums = useCallback(async (id) => {
    const [lvls, grds] = await Promise.all([ifcApi.levels(id), ifcApi.grids(id)]);
    setLevels(lvls);
    setGrids(grds);
    datumRef.current?.setLevels(lvls);
    datumRef.current?.setGrids(grds);
  }, []);

  const refreshLists = useCallback(async (id) => {
    const [sum, els] = await Promise.all([
      ifcApi.summary(id),
      ifcApi.entities(id, "IfcBuildingElement"),
    ]);
    setSummary(sum);
    setElements(els);
  }, []);

  const selectGuid = useCallback(async (guid) => {
    const mgr = mgrRef.current;
    mgr?.setSelected(guid);
    if (!guid) {
      setSelected(null);
      setDetail(null);
      transformRef.current?.detach();
      return;
    }
    const mesh = mgr.getMesh(guid);
    if (mesh) transformRef.current?.attach(mesh);
    const info = mesh?.userData.ifc ?? { guid };
    setSelected(info);
    setRename(info.name ?? "");
    try {
      const d = await ifcApi.entity(modelIdRef.current, guid);
      setDetail(d);
      setRename(d.attributes?.Name ?? info.name ?? "");
    } catch (e) {
      console.warn(e);
    }
  }, []);

  const firstStorey = async (id) => {
    try {
      const tree = await ifcApi.spatialTree(id);
      return tree?.children?.[0]?.children?.[0]?.children?.[0]?.guid ?? null;
    } catch {
      return null;
    }
  };

  // ── ações de modelo ───────────────────────────────────────────────────────
  const newModel = async () => {
    try {
      setBusy(true);
      setStatus("Criando modelo…");
      const { model_id } = await ifcApi.createModel("editor");
      await ifcApi.spatialBootstrap(model_id, {});
      setModelId(model_id);
      await refreshLists(model_id);
      await refreshMesh(model_id);
      await refreshDatums(model_id);
      setStatus(`Modelo ${model_id.slice(0, 8)} pronto.`);
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  const upload = async (file) => {
    if (!file) return;
    try {
      setBusy(true);
      setStatus(`Enviando ${file.name}…`);
      const { model_id } = await ifcApi.uploadModel(file);
      setModelId(model_id);
      await refreshLists(model_id);
      await refreshMesh(model_id);
      await refreshDatums(model_id);
      setStatus(`Carregado ${file.name}.`);
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  const save = async () => {
    if (!modelId) return;
    try {
      setBusy(true);
      const r = await ifcApi.save(modelId);
      const n = r.issues?.length ?? 0;
      setStatus(n ? `Salvo — ${n} aviso(s) de validação.` : "Salvo. Modelo válido.");
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  // recarrega tudo do backend após undo/redo (a verdade mudou inteira)
  const reloadAll = useCallback(
    async (id) => {
      transformRef.current?.detach();
      setSelected(null);
      setDetail(null);
      await refreshLists(id);
      await refreshMesh(id);
      await refreshDatums(id);
    },
    [refreshLists, refreshMesh, refreshDatums]
  );

  const undo = async () => {
    if (!modelId) return;
    try {
      setBusy(true);
      const r = await ifcApi.undo(modelId);
      await reloadAll(modelId);
      setStatus(r.ok ? "Desfeito." : "Nada para desfazer.");
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  const redo = async () => {
    if (!modelId) return;
    try {
      setBusy(true);
      const r = await ifcApi.redo(modelId);
      await reloadAll(modelId);
      setStatus(r.ok ? "Refeito." : "Nada para refazer.");
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  // ── criar elemento: liga/desliga o modo de inserção da ferramenta atual ────
  const createElement = () => {
    const insertion = insertionRef.current;
    if (!modelId || !insertion) return;
    if (insertMode) insertion.cancel();
    else insertion.begin(elemType);
  };

  // ── edição do selecionado ─────────────────────────────────────────────────
  const applyTransform = async (mesh, params) => {
    const guid = mesh.userData.ifc.guid;
    try {
      setStatus(
        params.rotate_z || params.rotation_matrix ? "Rotacionando…" : "Movendo…"
      );
      await ifcApi.editPlacement(modelIdRef.current, { guid, ...params });
      const pj = await ifcApi.productMesh(modelIdRef.current, guid);
      mgrRef.current?.replaceProduct(pj);
      const fresh = mgrRef.current?.getMesh(guid);
      if (fresh) transformRef.current?.attach(fresh);
      setStatus("Posição salva.");
    } catch (e) {
      fail(e);
    }
  };

  const applyDims = async () => {
    const guid = selectedRef.current?.guid;
    if (!guid) return;
    try {
      setBusy(true);
      await ifcApi.editDimensions(modelId, {
        guid,
        length: Number(dims.length),
        height: Number(dims.height),
        thickness: Number(dims.thickness),
      });
      mgrRef.current?.replaceProduct(await ifcApi.productMesh(modelId, guid));
      const fresh = mgrRef.current?.getMesh(guid);
      if (fresh) transformRef.current?.attach(fresh);
      setStatus("Dimensões atualizadas.");
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  const applyRename = async () => {
    const guid = selectedRef.current?.guid;
    if (!guid) return;
    try {
      setBusy(true);
      await ifcApi.editAttributes(modelId, guid, { Name: rename });
      const mesh = mgrRef.current?.getMesh(guid);
      if (mesh) mesh.userData.ifc.name = rename;
      await refreshLists(modelId);
      setSelected((s) => (s ? { ...s, name: rename } : s));
      setStatus("Renomeado.");
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  const remove = async () => {
    const guid = selectedRef.current?.guid;
    if (!guid || !modelId) return;
    try {
      setBusy(true);
      await ifcApi.deleteEntity(modelId, guid);
      transformRef.current?.detach();
      mgrRef.current?.removeProduct(guid);
      setSelected(null);
      setDetail(null);
      await refreshLists(modelId);
      setStatus("Entidade removida.");
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  // ── níveis & grids (datums) ───────────────────────────────────────────────
  useEffect(() => {
    datumRef.current?.setLevelsVisible(levelsVisible);
  }, [levelsVisible]);
  useEffect(() => {
    datumRef.current?.setGridsVisible(gridsVisible);
  }, [gridsVisible]);

  const addLevel = async () => {
    if (!modelId) return;
    try {
      setBusy(true);
      await ifcApi.createLevel(modelId, {
        name: newLevel.name || "Level",
        elevation: Number(newLevel.elevation),
      });
      await refreshDatums(modelId);
      setStatus(`Nível "${newLevel.name}" criado.`);
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  const changeLevelElevation = async (guid, elevation) => {
    if (!modelId) return;
    try {
      await ifcApi.editLevel(modelId, guid, { elevation: Number(elevation) });
      await refreshDatums(modelId);
      setStatus("Cota do nível atualizada.");
    } catch (e) {
      fail(e);
    }
  };

  const removeLevel = async (guid) => {
    if (!modelId) return;
    try {
      setBusy(true);
      try {
        await ifcApi.deleteLevel(modelId, guid, false);
      } catch (e) {
        // 409: contém elementos — confirma exclusão forçada
        if (
          String(e.message).includes("409") &&
          window.confirm("Nível contém elementos. Apagar mesmo assim?")
        ) {
          await ifcApi.deleteLevel(modelId, guid, true);
        } else {
          throw e;
        }
      }
      await refreshDatums(modelId);
      setStatus("Nível removido.");
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  const addGrid = async () => {
    if (!modelId) return;
    try {
      setBusy(true);
      const { nu, nv, spacing } = gridForm;
      const s = Number(spacing);
      const u = Array.from({ length: Number(nu) }, (_, i) => ({
        tag: String.fromCharCode(65 + i), // A, B, C…
        x: i * s,
      }));
      const v = Array.from({ length: Number(nv) }, (_, i) => ({
        tag: String(i + 1), // 1, 2, 3…
        y: i * s,
      }));
      await ifcApi.createGrid(modelId, { name: "Grid", u, v });
      await refreshDatums(modelId);
      setStatus(`Grid ${nu}×${nv} criado.`);
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  const removeGrid = async (guid) => {
    if (!modelId) return;
    try {
      setBusy(true);
      await ifcApi.deleteGrid(modelId, guid);
      await refreshDatums(modelId);
      setStatus("Grid removido.");
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  // tecla Delete remove o selecionado
  useEffect(() => {
    const onKey = (e) => {
      if (
        e.key === "Delete" &&
        selectedRef.current &&
        e.target.tagName !== "INPUT"
      )
        remove();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  const isWall = selected?.type === "IfcWall";

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <div style={S.panel}>
      <div style={S.head}>
        <div style={S.brand}>
          <img src="/edifc-unb.svg" alt="" style={S.brandIcon} />
          <strong>edIFC-UnB</strong>
        </div>
        <button style={S.x} onClick={onClose} title="Fechar">
          ×
        </button>
      </div>

      <div style={S.row}>
        <button style={S.btn} disabled={busy} onClick={newModel}>
          Novo
        </button>
        <label style={{ ...S.btn, textAlign: "center" }}>
          Upload
          <input
            type="file"
            accept=".ifc"
            style={{ display: "none" }}
            onChange={(e) => upload(e.target.files?.[0])}
          />
        </label>
        <button style={S.btn} disabled={!modelId || busy} onClick={save}>
          Salvar
        </button>
        <a
          style={{
            ...S.btn,
            pointerEvents: modelId ? "auto" : "none",
            opacity: modelId ? 1 : 0.5,
            textDecoration: "none",
            textAlign: "center",
          }}
          href={modelId ? ifcApi.downloadUrl(modelId) : "#"}
        >
          .ifc
        </a>
        <a
          style={{
            ...S.btn,
            pointerEvents: modelId ? "auto" : "none",
            opacity: modelId ? 1 : 0.5,
            textDecoration: "none",
            textAlign: "center",
          }}
          href={modelId ? ifcApi.glbUrl(modelId) : "#"}
          title="Exportar glTF binário"
        >
          .glb
        </a>
      </div>

      <div style={S.row}>
        <button style={S.btn} disabled={!modelId || busy} onClick={undo}>
          ↶ Desfazer
        </button>
        <button style={S.btn} disabled={!modelId || busy} onClick={redo}>
          ↷ Refazer
        </button>
      </div>

      {summary && (
        <div style={S.meta}>
          schema {summary.schema} · {summary.total_entities} entidades ·{" "}
          {elements.length} elementos
        </div>
      )}

      {/* criar elemento */}
      <fieldset style={S.fs} disabled={!modelId || busy}>
        <legend>Novo elemento (m)</legend>
        <select
          style={S.select}
          value={elemType}
          disabled={Boolean(insertMode)}
          onChange={(e) => setElemType(e.target.value)}
        >
          {Object.entries(ELEMENT_FORMS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        {(elemType === "wall" ||
          elemType === "slab" ||
          elemType === "beam" ||
          elemType === "column") && (
          <label style={S.fieldWide}>
            nível
            <select
              style={S.select}
              value={activeLevelGuid ?? ""}
              disabled={Boolean(insertMode)}
              onChange={(e) => setActiveLevelGuid(e.target.value || null)}
            >
              {levels.length === 0 ? (
                <option value="">Level 0 · z=0.00</option>
              ) : (
                levels.map((level) => (
                  <option key={level.guid} value={level.guid}>
                    {level.name ?? "Level"} · z=
                    {Number(level.elevation ?? 0).toFixed(2)}
                  </option>
                ))
              )}
            </select>
          </label>
        )}
        <div style={S.row}>
          {ELEMENT_FORMS[elemType].fields.map((k) => (
            <label key={k} style={S.field}>
              {k}
              <input
                style={S.num}
                type="number"
                step="0.1"
                value={form[k] ?? ""}
                disabled={Boolean(insertMode)}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [k]: e.target.value }))
                }
              />
            </label>
          ))}
        </div>
        <button
          style={{
            ...S.btn,
            width: "100%",
            background: insertMode ? "#7f1d1d" : S.btn.background,
            border:
              insertMode ? "1px solid #991b1b" : S.btn.border,
          }}
          onClick={createElement}
        >
          {insertMode
            ? `Cancelar ${ELEMENT_FORMS[insertMode]?.label.toLowerCase() ?? "inserção"}`
            : `+ ${ELEMENT_FORMS[elemType].label}`}
        </button>
      </fieldset>

      {/* níveis & grids (datums) */}
      <fieldset style={S.fs} disabled={!modelId || busy}>
        <legend>Níveis & Grids</legend>

        <div style={{ ...S.row, marginBottom: 4 }}>
          <label style={S.chk}>
            <input
              type="checkbox"
              checked={levelsVisible}
              onChange={(e) => setLevelsVisible(e.target.checked)}
            />{" "}
            planos
          </label>
          <label style={S.chk}>
            <input
              type="checkbox"
              checked={gridsVisible}
              onChange={(e) => setGridsVisible(e.target.checked)}
            />{" "}
            grid
          </label>
        </div>

        {/* lista de níveis */}
        <div style={S.levelList}>
          {levels.map((l) => (
            <div key={l.guid} style={S.levelRow}>
              <span style={S.levelName}>{l.name ?? "Level"}</span>
              <input
                style={S.levelNum}
                type="number"
                step="0.1"
                defaultValue={l.elevation}
                onBlur={(e) =>
                  Number(e.target.value) !== l.elevation &&
                  changeLevelElevation(l.guid, e.target.value)
                }
                title="cota (m)"
              />
              <button
                style={S.levelDel}
                onClick={() => removeLevel(l.guid)}
                title="apagar nível"
              >
                ×
              </button>
            </div>
          ))}
          {modelId && levels.length === 0 && (
            <div style={S.empty}>Nenhum nível.</div>
          )}
        </div>

        {/* criar nível */}
        <div style={{ ...S.row, marginTop: 4 }}>
          <input
            style={{ ...S.num, flex: 2 }}
            value={newLevel.name}
            onChange={(e) =>
              setNewLevel((n) => ({ ...n, name: e.target.value }))
            }
            placeholder="nome"
          />
          <input
            style={{ ...S.num, flex: 1 }}
            type="number"
            step="0.1"
            value={newLevel.elevation}
            onChange={(e) =>
              setNewLevel((n) => ({ ...n, elevation: e.target.value }))
            }
            title="cota (m)"
          />
          <button style={S.btn} onClick={addLevel}>
            + Nível
          </button>
        </div>

        {/* criar grid */}
        <div style={{ ...S.row, marginTop: 6 }}>
          {[
            ["nu", "U"],
            ["nv", "V"],
            ["spacing", "m"],
          ].map(([k, lbl]) => (
            <label key={k} style={S.field}>
              {lbl}
              <input
                style={S.num}
                type="number"
                step={k === "spacing" ? "0.5" : "1"}
                value={gridForm[k]}
                onChange={(e) =>
                  setGridForm((g) => ({ ...g, [k]: e.target.value }))
                }
              />
            </label>
          ))}
          <button style={S.btn} onClick={addGrid}>
            + Grid
          </button>
        </div>
        {grids.length > 0 && (
          <div style={{ ...S.row, marginTop: 4 }}>
            {grids.map((g) => (
              <button
                key={g.guid}
                style={{ ...S.btn, flex: "none" }}
                onClick={() => removeGrid(g.guid)}
                title="apagar grid"
              >
                {g.name ?? "Grid"} ×
              </button>
            ))}
          </div>
        )}
      </fieldset>

      {/* lista de elementos */}
      <div style={S.list}>
        {elements.map((w) => (
          <div
            key={w.guid}
            style={{
              ...S.item,
              background:
                selected?.guid === w.guid ? "#0e7490" : "transparent",
            }}
            onClick={() => selectGuid(w.guid)}
          >
            <span style={S.tag}>{w.type.replace("Ifc", "")}</span>{" "}
            {w.name ?? "(sem nome)"}{" "}
            <span style={S.guid}>{w.guid.slice(0, 8)}</span>
          </div>
        ))}
        {modelId && elements.length === 0 && (
          <div style={S.empty}>Nenhum elemento ainda.</div>
        )}
      </div>

      {/* propriedades + ações do selecionado */}
      {selected && (
        <div style={S.sel}>
          <div>
            <strong>{selected.type}</strong> {selected.guid?.slice(0, 8)}
          </div>

          {/* renomear */}
          <div style={{ ...S.row, marginTop: 6 }}>
            <input
              style={{ ...S.num, flex: 2 }}
              value={rename}
              onChange={(e) => setRename(e.target.value)}
              placeholder="nome"
            />
            <button style={S.btn} disabled={busy} onClick={applyRename}>
              Renomear
            </button>
          </div>

          {/* dimensões (parede) */}
          {isWall && (
            <fieldset style={{ ...S.fs, marginTop: 6 }} disabled={busy}>
              <legend>Dimensões da parede (m)</legend>
              <div style={S.row}>
                {["length", "height", "thickness"].map((k) => (
                  <label key={k} style={S.field}>
                    {k[0]}
                    <input
                      style={S.num}
                      type="number"
                      step="0.1"
                      value={dims[k]}
                      onChange={(e) =>
                        setDims((d) => ({ ...d, [k]: e.target.value }))
                      }
                    />
                  </label>
                ))}
                <button style={S.btn} onClick={applyDims}>
                  Aplicar
                </button>
              </div>
            </fieldset>
          )}

          <div style={S.hint}>
            Arraste o gizmo · Delete para apagar
          </div>
          {detail?.psets && Object.keys(detail.psets).length > 0 && (
            <div style={S.psets}>
              {Object.keys(detail.psets).map((p) => (
                <div key={p}>· {p}</div>
              ))}
            </div>
          )}
          <button style={S.del} disabled={busy} onClick={remove}>
            Apagar
          </button>
        </div>
      )}

      <div style={S.status}>{status}</div>
    </div>
  );
}

const S = {
  panel: {
    position: "absolute",
    bottom: 12,
    right: 12,
    width: 300,
    maxHeight: "calc(100% - 24px)",
    overflowY: "auto",
    background: "rgba(17,24,39,0.95)",
    color: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
    font: "12px system-ui, sans-serif",
    boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
    zIndex: 20,
  },
  head: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  brand: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  brandIcon: {
    width: 24,
    height: 24,
    display: "block",
    flex: "0 0 auto",
  },
  x: {
    background: "transparent",
    border: "none",
    color: "#9ca3af",
    fontSize: 18,
    cursor: "pointer",
  },
  row: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 },
  btn: {
    flex: 1,
    minWidth: 56,
    padding: "6px 8px",
    background: "#374151",
    color: "#e5e7eb",
    border: "1px solid #4b5563",
    borderRadius: 6,
    cursor: "pointer",
  },
  select: {
    width: "100%",
    marginBottom: 6,
    padding: 4,
    background: "#1f2937",
    color: "#e5e7eb",
    border: "1px solid #4b5563",
    borderRadius: 6,
  },
  meta: { margin: "4px 0", color: "#9ca3af" },
  fs: { border: "1px solid #374151", borderRadius: 6, margin: "8px 0", padding: 6 },
  chk: { display: "flex", alignItems: "center", gap: 2, fontSize: 11, flex: 1 },
  levelList: {
    maxHeight: 96,
    overflowY: "auto",
    border: "1px solid #1f2937",
    borderRadius: 4,
  },
  levelRow: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 4px",
    borderBottom: "1px solid #1f2937",
  },
  levelName: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  levelNum: { width: 56 },
  levelDel: {
    background: "transparent",
    border: "none",
    color: "#f87171",
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1,
  },
  field: { display: "flex", flexDirection: "column", fontSize: 10, flex: 1 },
  fieldWide: {
    display: "flex",
    flexDirection: "column",
    fontSize: 10,
    marginBottom: 6,
  },
  num: { width: "100%", boxSizing: "border-box" },
  list: {
    maxHeight: 140,
    overflowY: "auto",
    border: "1px solid #374151",
    borderRadius: 6,
    margin: "4px 0",
  },
  item: { padding: "4px 8px", cursor: "pointer", borderBottom: "1px solid #1f2937" },
  tag: {
    display: "inline-block",
    fontSize: 9,
    padding: "1px 4px",
    background: "#1f2937",
    borderRadius: 4,
    color: "#93c5fd",
  },
  guid: { color: "#6b7280", fontFamily: "monospace" },
  empty: { padding: 8, color: "#6b7280" },
  sel: {
    border: "1px solid #0e7490",
    borderRadius: 6,
    padding: 8,
    margin: "4px 0",
  },
  hint: { color: "#9ca3af", fontSize: 10, margin: "4px 0" },
  psets: { color: "#9ca3af", fontSize: 10, margin: "4px 0" },
  del: {
    width: "100%",
    padding: "6px",
    background: "#7f1d1d",
    color: "#fecaca",
    border: "1px solid #991b1b",
    borderRadius: 6,
    cursor: "pointer",
  },
  status: { marginTop: 8, color: "#9ca3af", fontSize: 11, minHeight: 14 },
};
