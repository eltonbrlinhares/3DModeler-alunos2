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
import * as THREE from "three";

import ifcApi from "../services/ifcApi.js";
import { IfcSceneManager } from "../ifc/IfcSceneManager.js";
import { IfcDatumManager } from "../ifc/IfcDatumManager.js";
import { InsertionController } from "../ifc/insertion/InsertionController.js";
import { SelectionController } from "../ifc/insertion/SelectionController.js";
import { TransformController } from "../ifc/insertion/TransformController.js";
import { INSERTION_TOOLS } from "../ifc/tools/index.js";
import {
  STEEL_COLUMN_FAMILIES,
  STEEL_FAMILY_OPTIONS,
} from "../data/steelColumnProfiles.js";
import {
  STEEL_BEAM_FAMILIES,
  STEEL_BEAM_FAMILY_OPTIONS,
} from "../data/steelBeamProfiles.js";
import {
  WallSketchController,
  DEFAULT_WALL_THICKNESS,
  DEFAULT_WALL_HEIGHT,
} from "../ifc/planSketch/WallSketchController.js";
import { DimensionController } from "../ifc/planSketch/DimensionController.js";
import { miteredWallSegments, wallSegmentPlacement } from "../ifc/geometry/wallChainSegments.js";
import TopToolbar from "./TopToolbar.jsx";

// O seletor de tipo, os campos do formulário e o botão "+ Elemento" são
// dirigidos pelo registro de ferramentas (cada uma carrega label/fields/defaults).
const ELEMENT_FORMS = INSERTION_TOOLS;

// Aba "Coluna metálica": famílias de catálogo (HP/W/CVS/CS) + opção de perfil
// personalizado. As famílias vêm de src/data/steelColumnProfiles.js, geradas a
// partir das tabelas de fabricante (Gerdau HP/W, ArcelorMittal CVS/CS).
const STEEL_FAMILY_SELECT_OPTIONS = [
  ...STEEL_FAMILY_OPTIONS,
  { value: "custom", label: "Personalizado..." },
];
const DEFAULT_STEEL_FAMILY = STEEL_FAMILY_OPTIONS[0]?.value ?? "custom";

// Aba "Viga metálica": famílias de catálogo (HP/W/CVS/VS) + personalizado.
// Vêm de src/data/steelBeamProfiles.js (Gerdau HP/W, ArcelorMittal CVS/VS).
const STEEL_BEAM_FAMILY_SELECT_OPTIONS = [
  ...STEEL_BEAM_FAMILY_OPTIONS,
  { value: "custom", label: "Personalizado..." },
];
const DEFAULT_STEEL_BEAM_FAMILY = STEEL_BEAM_FAMILY_OPTIONS[0]?.value ?? "custom";

export default function IfcPanel({
  canvasRef,
  onClose,
  translationSnap = 0,
  rotationSnap = 0,
  workPlaneControls = true,
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
  // aba da coluna: "concrete" (dimensões livres) ou "steel" (catálogo de perfis)
  const [columnKind, setColumnKind] = useState("concrete");
  const [steelFamily, setSteelFamily] = useState(DEFAULT_STEEL_FAMILY);
  const [steelProfileValue, setSteelProfileValue] = useState(
    STEEL_COLUMN_FAMILIES[DEFAULT_STEEL_FAMILY]?.profiles?.[0]?.value ?? ""
  );
  const [columnProfileCustom, setColumnProfileCustom] = useState({
    h: 300,
    b: 150,
    tw: 6.3,
    tf: 9.5,
    shape: "I",
  });
  // aba da viga: "concrete" (dimensões livres) ou "steel" (catálogo de perfis)
  const [beamKind, setBeamKind] = useState("concrete");
  const [beamSteelFamily, setBeamSteelFamily] = useState(DEFAULT_STEEL_BEAM_FAMILY);
  const [beamSteelProfileValue, setBeamSteelProfileValue] = useState(
    STEEL_BEAM_FAMILIES[DEFAULT_STEEL_BEAM_FAMILY]?.profiles?.[0]?.value ?? ""
  );
  const [beamProfileCustom, setBeamProfileCustom] = useState({
    h: 300,
    b: 150,
    tw: 6.3,
    tf: 9.5,
    shape: "I",
  });
  // qual referência vertical o eixo clicado (linha de grid) representa na
  // viga: topo, centro (centroide) ou base da seção
  const [beamAxisRef, setBeamAxisRef] = useState("top");
  // coluna: o eixo vertical sempre sobe do ponto clicado (sem ambiguidade de
  // Z); o que muda é por qual ponto da SEÇÃO em planta esse eixo passa
  const [columnRefX, setColumnRefX] = useState("center");
  const [columnRefY, setColumnRefY] = useState("center");
  // idem para a laje: o que o contorno clicado representa na espessura
  const [slabAxisRef, setSlabAxisRef] = useState("top");
  // ── níveis & grids (datums) ──
  const [levels, setLevels] = useState([]);
  const [activeLevelGuid, setActiveLevelGuid] = useState(null);
  const [grids, setGrids] = useState([]);
  const [levelsVisible, setLevelsVisible] = useState(true);
  const [gridsVisible, setGridsVisible] = useState(true);
  const [newLevel, setNewLevel] = useState({ name: "Level", elevation: 3 });
  const [gridForm, setGridForm] = useState({ nu: 3, nv: 3, spacing: 5 });

  // ── ferramenta Parede/3D/Cota (toolbar superior) ──
  const [sketchTool, setSketchTool] = useState(null); // null | "wall" | "dimension"
  const [wallThickness, setWallThickness] = useState(DEFAULT_WALL_THICKNESS);
  const [wallHeight, setWallHeight] = useState(DEFAULT_WALL_HEIGHT);
  const [, setChainsVersion] = useState(0); // bump para reagir a mudanças nas chains (fora do React state)

  const mgrRef = useRef(null);
  const datumRef = useRef(null);
  const transformRef = useRef(null);
  const selectionRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const orbitRef = useRef(null);
  const domRef = useRef(null);
  const insertionRef = useRef(null);
  const wallSketchRef = useRef(null);
  const dimensionRef = useRef(null);
  const modelIdRef = useRef(null);
  const selectedRef = useRef(null);
  const formRef = useRef(form);
  const elementsRef = useRef(elements);
  const levelsRef = useRef(levels);
  const gridsRef = useRef(grids);
  const activeLevelGuidRef = useRef(activeLevelGuid);
  const sketchToolRef = useRef(sketchTool);
  modelIdRef.current = modelId;
  selectedRef.current = selected;
  formRef.current = form;
  elementsRef.current = elements;
  levelsRef.current = levels;
  gridsRef.current = grids;
  activeLevelGuidRef.current = activeLevelGuid;
  sketchToolRef.current = sketchTool;

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
    transform.setEnabled(workPlaneControls);
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

    // ferramenta "Parede" (planta 2D, linhas duplas) — toolbar superior
    const wallSketch = new WallSketchController({
      getScene: () => scene,
      getCamera: () => camera,
      getDom: () => dom,
      getOrbit: () => orbit,
      getGrids: () => gridsRef.current,
      getDatumManager: () => datumRef.current,
    });
    wallSketch.onStatus = setStatus;
    wallSketch.onChainsChanged = () => setChainsVersion((v) => v + 1);
    wallSketch.mount();
    wallSketch.attach();
    wallSketchRef.current = wallSketch;

    // ferramenta "Cota" — mede/edita paramétricamente um trecho de parede
    const dimension = new DimensionController({
      getScene: () => scene,
      getCamera: () => camera,
      getDom: () => dom,
      getOrbit: () => orbit,
      getWallSketch: () => wallSketchRef.current,
      getIfcManager: () => mgrRef.current,
      getModelId: () => modelIdRef.current,
      api: ifcApi,
      onGeometryChanged: async (id) => {
        await refreshMesh(id);
        await refreshLists(id);
      },
      setStatus,
      onError: fail,
    });
    dimension.mount();
    dimension.attach();
    dimensionRef.current = dimension;

    // seleção por clique (raycast). Inerte durante inserção, arraste de gizmo
    // ou enquanto a ferramenta Parede/Cota estiver ativa.
    const selection = new SelectionController({
      camera,
      dom,
      getManager: () => mgrRef.current,
      onPick: (guid) => selectGuid(guid),
      isInserting: () => insertion.active || Boolean(sketchToolRef.current),
      isTransforming: () => transform.dragging,
    });
    selection.attach();
    selectionRef.current = selection;

    return () => {
      selection.dispose();
      insertion.dispose();
      dimension.dispose();
      wallSketch.dispose();
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
      wallSketchRef.current = null;
      dimensionRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      orbitRef.current = null;
      domRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ativa/desativa a ferramenta de planta conforme o botão selecionado na
  // TopToolbar (mutuamente exclusiva com a inserção via dropdown do IfcPanel)
  useEffect(() => {
    wallSketchRef.current?.setActive(sketchTool === "wall", activeInsertionLevel());
    dimensionRef.current?.setActive(sketchTool === "dimension");
  }, [sketchTool]);

  useEffect(() => {
    wallSketchRef.current?.setThickness(wallThickness);
  }, [wallThickness]);

  // Esc cancela a ferramenta de planta ativa (Parede/Cota)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && sketchToolRef.current) setSketchTool(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    transformRef.current?.setTranslationSnap(translationSnap);
  }, [translationSnap]);

  useEffect(() => {
    transformRef.current?.setRotationSnap(rotationSnap);
  }, [rotationSnap]);

  useEffect(() => {
    transformRef.current?.setEnabled(workPlaneControls);
  }, [workPlaneControls]);

  // ao trocar o tipo, recarrega os valores padrão daquele elemento
  useEffect(() => {
    setForm({ ...ELEMENT_FORMS[elemType].defaults });
  }, [elemType]);

  useEffect(() => {
    if (elemType !== "column") return;

    // Aba "Concreto": seção retangular livre, sem perfil de catálogo. Os
    // campos width/depth (m) são editados diretamente pelo usuário no
    // formulário genérico — aqui só limpamos os campos de perfil metálico.
    if (columnKind === "concrete") {
      setForm((f) => ({
        ...f,
        profile: null,
        shape: null,
        h: null,
        b: null,
        tw: null,
        tf: null,
      }));
      return;
    }

    // Aba "Metálica": perfil personalizado (dimensões em mm digitadas à mão)
    if (steelFamily === "custom") {
      setForm((f) => ({
        ...f,
        width: columnProfileCustom.b / 1000,
        depth: columnProfileCustom.h / 1000,
        profile: "custom",
        shape: columnProfileCustom.shape,
        h: columnProfileCustom.h / 1000,
        b: columnProfileCustom.b / 1000,
        tw: columnProfileCustom.tw / 1000,
        tf: columnProfileCustom.tf / 1000,
      }));
      return;
    }

    // Aba "Metálica": perfil de catálogo (HP/W/CVS/CS), dimensões já em metros
    const family = STEEL_COLUMN_FAMILIES[steelFamily];
    const item =
      family?.profiles.find((p) => p.value === steelProfileValue) ??
      family?.profiles[0];
    if (!item) return;
    setForm((f) => ({
      ...f,
      width: item.b,
      depth: item.h,
      profile: item.value,
      shape: family.shape,
      h: item.h,
      b: item.b,
      tw: item.tw,
      tf: item.tf,
    }));
  }, [
    elemType,
    columnKind,
    steelFamily,
    steelProfileValue,
    columnProfileCustom.b,
    columnProfileCustom.h,
    columnProfileCustom.tw,
    columnProfileCustom.tf,
    columnProfileCustom.shape,
  ]);

  // ao trocar de família de perfil metálico, seleciona o primeiro perfil dela
  useEffect(() => {
    if (steelFamily === "custom") return;
    const profiles = STEEL_COLUMN_FAMILIES[steelFamily]?.profiles ?? [];
    if (!profiles.some((p) => p.value === steelProfileValue)) {
      setSteelProfileValue(profiles[0]?.value ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steelFamily]);

  useEffect(() => {
    if (elemType !== "beam") return;

    // Aba "Concreto": seção retangular livre, sem perfil de catálogo.
    if (beamKind === "concrete") {
      setForm((f) => ({
        ...f,
        profile: null,
        shape: null,
        h: null,
        b: null,
        tw: null,
        tf: null,
      }));
      return;
    }

    // Aba "Metálica": perfil personalizado (dimensões em mm digitadas à mão)
    if (beamSteelFamily === "custom") {
      setForm((f) => ({
        ...f,
        width: beamProfileCustom.b / 1000,
        depth: beamProfileCustom.h / 1000,
        profile: "custom",
        shape: beamProfileCustom.shape,
        h: beamProfileCustom.h / 1000,
        b: beamProfileCustom.b / 1000,
        tw: beamProfileCustom.tw / 1000,
        tf: beamProfileCustom.tf / 1000,
      }));
      return;
    }

    // Aba "Metálica": perfil de catálogo (HP/W/CVS/VS), dimensões já em metros
    const family = STEEL_BEAM_FAMILIES[beamSteelFamily];
    const item =
      family?.profiles.find((p) => p.value === beamSteelProfileValue) ??
      family?.profiles[0];
    if (!item) return;
    setForm((f) => ({
      ...f,
      width: item.b,
      depth: item.h,
      profile: item.value,
      shape: family.shape,
      h: item.h,
      b: item.b,
      tw: item.tw,
      tf: item.tf,
    }));
  }, [
    elemType,
    beamKind,
    beamSteelFamily,
    beamSteelProfileValue,
    beamProfileCustom.b,
    beamProfileCustom.h,
    beamProfileCustom.tw,
    beamProfileCustom.tf,
    beamProfileCustom.shape,
  ]);

  // ao trocar de família de perfil metálico da viga, seleciona o primeiro perfil dela
  useEffect(() => {
    if (beamSteelFamily === "custom") return;
    const profiles = STEEL_BEAM_FAMILIES[beamSteelFamily]?.profiles ?? [];
    if (!profiles.some((p) => p.value === beamSteelProfileValue)) {
      setBeamSteelProfileValue(profiles[0]?.value ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beamSteelFamily]);

  // referência do eixo (topo/centro/base) que o clique na linha de grid
  // representa na seção da viga — repassada ao form para o beamTool.js usar
  useEffect(() => {
    if (elemType !== "beam") return;
    setForm((f) => ({ ...f, axisRef: beamAxisRef }));
  }, [elemType, beamAxisRef]);

  // idem para a coluna: por qual ponto da seção em planta o eixo vertical passa
  useEffect(() => {
    if (elemType !== "column") return;
    setForm((f) => ({ ...f, refX: columnRefX, refY: columnRefY }));
  }, [elemType, columnRefX, columnRefY]);

  // idem para a laje (o que o contorno clicado representa na espessura)
  useEffect(() => {
    if (elemType !== "slab") return;
    setForm((f) => ({ ...f, axisRef: slabAxisRef }));
  }, [elemType, slabAxisRef]);

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

  // ── toolbar superior: Parede / Cota (mutuamente exclusivas com o dropdown) ─
  const selectSketchTool = (tool) => {
    if (tool) {
      insertionRef.current?.cancel();
      transformRef.current?.detach();
      setSelected(null);
      setDetail(null);
    }
    setSketchTool(tool);
  };

  // ── toolbar superior: 3D — alterna entre planta 2D e extrusão 3D ───────────
  const convertPendingChainsTo3D = async (pending) => {
    const wallSketch = wallSketchRef.current;
    setStatus("Gerando paredes 3D…");
    const height = Number(wallHeight) || DEFAULT_WALL_HEIGHT;
    let seq = elementsRef.current.length + 1;
    for (const chain of pending) {
      const segments = miteredWallSegments(chain.points, chain.thickness, chain.closed);
      const guids = [];
      for (const seg of segments) {
        const { length, rotation_z, position } = wallSegmentPlacement(seg.p0, seg.p1, chain.thickness);
        if (length < 0.02) {
          guids.push(null);
          continue;
        }
        const storey_guid = chain.levelGuid ?? (await firstStorey(modelId));
        const { guid } = await ifcApi.createWall(modelId, {
          name: `W${seq++}`,
          length,
          height,
          thickness: chain.thickness,
          position,
          rotation_z,
          storey_guid,
        });
        guids.push(guid);
      }
      wallSketch.markChainConverted(chain.id, guids, height);
    }
    setStatus("Paredes 3D geradas a partir da planta.");
  };

  const revertConvertedChainsTo2D = async (converted) => {
    const wallSketch = wallSketchRef.current;
    setStatus("Voltando para a planta 2D…");
    for (const chain of converted) {
      for (const guid of chain.wallGuids) {
        if (guid) await ifcApi.deleteEntity(modelId, guid);
      }
      wallSketch.revertChainTo2D(chain.id);
    }
    setStatus("De volta à planta 2D.");
  };

  const toggle3D = async () => {
    const wallSketch = wallSketchRef.current;
    if (!modelId || !wallSketch) return;
    const chains = wallSketch.getChains();
    const converted = chains.filter((c) => c.wallGuids);
    const pending = chains.filter((c) => !c.wallGuids);
    if (!converted.length && !pending.length) {
      setStatus("Nenhuma parede em planta para converter.");
      return;
    }
    try {
      setBusy(true);
      // se já existe algo em 3D, o clique alterna de volta para a planta;
      // caso contrário, converte o que ainda está só em planta.
      if (converted.length) await revertConvertedChainsTo2D(converted);
      else await convertPendingChainsTo3D(pending);
      await refreshLists(modelId);
      await refreshMesh(modelId);
      setBusy(false);
    } catch (e) {
      fail(e);
    }
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

  // sugestao preliminar de dimensoes da fundacao (sapata/bloco) — SOMENTE
  // EXIBIDA como texto; nao altera os campos do formulario (o usuario decide
  // o que digitar em base/topo/pedestal a partir da sugestao).
  const [footingSuggestion, setFootingSuggestion] = useState(null);

  const suggestFootingDimensions = async () => {
    try {
      setBusy(true);
      if (form.predefinedType === "PILE_CAP") {
        const r = await ifcApi.suggestPileCap({
          axial_load_kn: Number(form.axialLoad) || 0,
          pile_capacity_kn: Number(form.pileCapacity) || 0,
          pile_diameter: Number(form.pileDiameter) || 0,
        });
        setFootingSuggestion(
          `Sugestão (bloco): ${r.pile_count} estacas · base ${r.width}×${r.length} m · altura ${r.height} m. ${r.notes[0] ?? ""}`
        );
      } else {
        const r = await ifcApi.suggestPadFooting({
          axial_load_kn: Number(form.axialLoad) || 0,
          column_width: Number(form.columnWidth) || 0,
          column_depth: Number(form.columnDepth) || 0,
          soil_bearing_kpa: Number(form.soilBearing) || 0,
        });
        setFootingSuggestion(
          `Sugestão (sapata): base ${r.width}×${r.length} m · altura ${r.height} m · balanço ${r.cantilever} m (${r.rigid ? "rígida" : "flexível"}).`
        );
      }
      setBusy(false);
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
  const sketchChains = wallSketchRef.current?.getChains() ?? [];
  const canConvert = sketchChains.some((c) => !c.wallGuids);
  const is3DActive = sketchChains.some((c) => c.wallGuids);

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <>
      <TopToolbar
        sketchTool={sketchTool}
        onSelectTool={selectSketchTool}
        wallThickness={wallThickness}
        onThicknessChange={setWallThickness}
        wallHeight={wallHeight}
        onHeightChange={setWallHeight}
        onConvert3D={toggle3D}
        canConvert={canConvert || is3DActive}
        is3DActive={is3DActive}
        busy={busy}
        disabled={!modelId}
      />
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
          elemType === "column" ||
          elemType === "footing") && (
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
        {elemType === "column" && (
          <>
            {/* por qual ponto da seção (em planta) passa o eixo vertical da coluna */}
            <div style={{ ...S.fieldWide, marginBottom: 6 }}>
              Referência da seção (planta)
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 22px)",
                  gridTemplateRows: "repeat(3, 22px)",
                  gap: 2,
                  marginTop: 3,
                }}
              >
                {["end", "center", "start"].flatMap((y) =>
                  ["start", "center", "end"].map((x) => {
                    const active = columnRefX === x && columnRefY === y;
                    return (
                      <button
                        key={`${x}-${y}`}
                        type="button"
                        title={`x=${x}, y=${y}`}
                        disabled={Boolean(insertMode)}
                        onClick={() => {
                          setColumnRefX(x);
                          setColumnRefY(y);
                        }}
                        style={{
                          width: 22,
                          height: 22,
                          padding: 0,
                          background: active ? "#0e7490" : "#1f2937",
                          border: active
                            ? "1px solid #06b6d4"
                            : "1px solid #4b5563",
                          borderRadius: 3,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: "50%",
                            background: active ? "#e5e7eb" : "#6b7280",
                          }}
                        />
                      </button>
                    );
                  })
                )}
              </div>
              <span style={{ color: "#9ca3af", marginTop: 3 }}>
                canto/face/centro por onde passa o eixo vertical
              </span>
            </div>

            {/* abas: coluna de concreto (dimensões livres) x coluna metálica (catálogo) */}
            <div style={{ ...S.row, marginBottom: 4 }}>
              <button
                type="button"
                style={{
                  ...S.btn,
                  background: columnKind === "concrete" ? "#0e7490" : S.btn.background,
                  border:
                    columnKind === "concrete" ? "1px solid #06b6d4" : S.btn.border,
                }}
                disabled={Boolean(insertMode)}
                onClick={() => setColumnKind("concrete")}
              >
                Concreto
              </button>
              <button
                type="button"
                style={{
                  ...S.btn,
                  background: columnKind === "steel" ? "#0e7490" : S.btn.background,
                  border: columnKind === "steel" ? "1px solid #06b6d4" : S.btn.border,
                }}
                disabled={Boolean(insertMode)}
                onClick={() => setColumnKind("steel")}
              >
                Metálica
              </button>
            </div>

            {columnKind === "steel" && (
              <>
                <label style={S.fieldWide}>
                  Família do perfil
                  <select
                    style={S.select}
                    value={steelFamily}
                    disabled={Boolean(insertMode)}
                    onChange={(e) => setSteelFamily(e.target.value)}
                  >
                    {STEEL_FAMILY_SELECT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                {steelFamily !== "custom" && (
                  <label style={S.fieldWide}>
                    Perfil
                    <select
                      style={S.select}
                      value={steelProfileValue}
                      disabled={Boolean(insertMode)}
                      onChange={(e) => setSteelProfileValue(e.target.value)}
                    >
                      {(STEEL_COLUMN_FAMILIES[steelFamily]?.profiles ?? []).map(
                        (p) => (
                          <option key={p.value} value={p.value}>
                            {p.value} · {p.weight} kgf/m
                          </option>
                        )
                      )}
                    </select>
                  </label>
                )}

                {steelFamily === "custom" && (
                  <div style={{ ...S.fs, marginTop: 4 }}>
                    <div style={{ fontSize: 11, marginBottom: 4, color: "#93c5fd" }}>
                      Perfil Personalizado
                    </div>
                    <div style={S.row}>
                      <label style={S.field}>
                        Altura (h, mm)
                        <input
                          style={S.num}
                          type="number"
                          step="1"
                          value={columnProfileCustom.h}
                          disabled={Boolean(insertMode)}
                          onChange={(e) =>
                            setColumnProfileCustom((current) => ({
                              ...current,
                              h: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label style={S.field}>
                        Largura (b, mm)
                        <input
                          style={S.num}
                          type="number"
                          step="1"
                          value={columnProfileCustom.b}
                          disabled={Boolean(insertMode)}
                          onChange={(e) =>
                            setColumnProfileCustom((current) => ({
                              ...current,
                              b: e.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div style={S.row}>
                      <label style={S.field}>
                        Alma (tw, mm)
                        <input
                          style={S.num}
                          type="number"
                          step="0.1"
                          value={columnProfileCustom.tw}
                          disabled={Boolean(insertMode)}
                          onChange={(e) =>
                            setColumnProfileCustom((current) => ({
                              ...current,
                              tw: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label style={S.field}>
                        Mesa (tf, mm)
                        <input
                          style={S.num}
                          type="number"
                          step="0.1"
                          value={columnProfileCustom.tf}
                          disabled={Boolean(insertMode)}
                          onChange={(e) =>
                            setColumnProfileCustom((current) => ({
                              ...current,
                              tf: e.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div style={{ ...S.fieldWide, marginTop: 2 }}>
                      Tipo
                      <div
                        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 3 }}
                      >
                        {["I", "H", "U", "L", "Tubular Ret.", "Tubular Circ."].map(
                          (shape) => (
                            <label
                              key={shape}
                              style={{
                                fontSize: 10,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <input
                                type="radio"
                                name="column-shape"
                                value={shape}
                                checked={columnProfileCustom.shape === shape}
                                disabled={Boolean(insertMode)}
                                onChange={(e) =>
                                  setColumnProfileCustom((current) => ({
                                    ...current,
                                    shape: e.target.value,
                                  }))
                                }
                              />
                              {shape}
                            </label>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
        {elemType === "beam" && (
          <>
            {/* referência do eixo clicado na linha de grid: o que ele representa na seção */}
            <div style={{ ...S.fieldWide, marginBottom: 6 }}>
              Eixo de referência
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 3 }}>
                {[
                  { value: "top", label: "Superior" },
                  { value: "center", label: "Central" },
                  { value: "bottom", label: "Inferior" },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    style={{
                      fontSize: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <input
                      type="radio"
                      name="beam-axis-ref"
                      value={opt.value}
                      checked={beamAxisRef === opt.value}
                      disabled={Boolean(insertMode)}
                      onChange={(e) => setBeamAxisRef(e.target.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {/* abas: viga de concreto (dimensões livres) x viga metálica (catálogo) */}
            <div style={{ ...S.row, marginBottom: 4 }}>
              <button
                type="button"
                style={{
                  ...S.btn,
                  background: beamKind === "concrete" ? "#0e7490" : S.btn.background,
                  border:
                    beamKind === "concrete" ? "1px solid #06b6d4" : S.btn.border,
                }}
                disabled={Boolean(insertMode)}
                onClick={() => setBeamKind("concrete")}
              >
                Concreto
              </button>
              <button
                type="button"
                style={{
                  ...S.btn,
                  background: beamKind === "steel" ? "#0e7490" : S.btn.background,
                  border: beamKind === "steel" ? "1px solid #06b6d4" : S.btn.border,
                }}
                disabled={Boolean(insertMode)}
                onClick={() => setBeamKind("steel")}
              >
                Metálica
              </button>
            </div>

            {beamKind === "steel" && (
              <>
                <label style={S.fieldWide}>
                  Família do perfil
                  <select
                    style={S.select}
                    value={beamSteelFamily}
                    disabled={Boolean(insertMode)}
                    onChange={(e) => setBeamSteelFamily(e.target.value)}
                  >
                    {STEEL_BEAM_FAMILY_SELECT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                {beamSteelFamily !== "custom" && (
                  <label style={S.fieldWide}>
                    Perfil
                    <select
                      style={S.select}
                      value={beamSteelProfileValue}
                      disabled={Boolean(insertMode)}
                      onChange={(e) => setBeamSteelProfileValue(e.target.value)}
                    >
                      {(STEEL_BEAM_FAMILIES[beamSteelFamily]?.profiles ?? []).map(
                        (p) => (
                          <option key={p.value} value={p.value}>
                            {p.value} · {p.weight} kgf/m
                          </option>
                        )
                      )}
                    </select>
                  </label>
                )}

                {beamSteelFamily === "custom" && (
                  <div style={{ ...S.fs, marginTop: 4 }}>
                    <div style={{ fontSize: 11, marginBottom: 4, color: "#93c5fd" }}>
                      Perfil Personalizado
                    </div>
                    <div style={S.row}>
                      <label style={S.field}>
                        Altura (h, mm)
                        <input
                          style={S.num}
                          type="number"
                          step="1"
                          value={beamProfileCustom.h}
                          disabled={Boolean(insertMode)}
                          onChange={(e) =>
                            setBeamProfileCustom((current) => ({
                              ...current,
                              h: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label style={S.field}>
                        Largura (b, mm)
                        <input
                          style={S.num}
                          type="number"
                          step="1"
                          value={beamProfileCustom.b}
                          disabled={Boolean(insertMode)}
                          onChange={(e) =>
                            setBeamProfileCustom((current) => ({
                              ...current,
                              b: e.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div style={S.row}>
                      <label style={S.field}>
                        Alma (tw, mm)
                        <input
                          style={S.num}
                          type="number"
                          step="0.1"
                          value={beamProfileCustom.tw}
                          disabled={Boolean(insertMode)}
                          onChange={(e) =>
                            setBeamProfileCustom((current) => ({
                              ...current,
                              tw: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label style={S.field}>
                        Mesa (tf, mm)
                        <input
                          style={S.num}
                          type="number"
                          step="0.1"
                          value={beamProfileCustom.tf}
                          disabled={Boolean(insertMode)}
                          onChange={(e) =>
                            setBeamProfileCustom((current) => ({
                              ...current,
                              tf: e.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div style={{ ...S.fieldWide, marginTop: 2 }}>
                      Tipo
                      <div
                        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 3 }}
                      >
                        {["I", "H", "U", "L", "Tubular Ret.", "Tubular Circ."].map(
                          (shape) => (
                            <label
                              key={shape}
                              style={{
                                fontSize: 10,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <input
                                type="radio"
                                name="beam-shape"
                                value={shape}
                                checked={beamProfileCustom.shape === shape}
                                disabled={Boolean(insertMode)}
                                onChange={(e) =>
                                  setBeamProfileCustom((current) => ({
                                    ...current,
                                    shape: e.target.value,
                                  }))
                                }
                              />
                              {shape}
                            </label>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
        {elemType === "slab" && (
          <div style={{ ...S.fieldWide, marginBottom: 6 }}>
            Eixo de referência
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 3 }}>
              {[
                { value: "top", label: "Superior" },
                { value: "center", label: "Central" },
                { value: "bottom", label: "Inferior" },
              ].map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    fontSize: 10,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <input
                    type="radio"
                    name="slab-axis-ref"
                    value={opt.value}
                    checked={slabAxisRef === opt.value}
                    disabled={Boolean(insertMode)}
                    onChange={(e) => setSlabAxisRef(e.target.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        )}
        {elemType === "slab" && (
          <div style={{ ...S.fieldWide, marginBottom: 6 }}>
            Tipo
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 3 }}>
              {[
                { value: null, label: "Laje" },
                { value: "BASESLAB", label: "Radier" },
              ].map((opt) => (
                <label
                  key={opt.label}
                  style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}
                >
                  <input
                    type="radio"
                    name="slab-predefined-type"
                    checked={(form.predefinedType ?? null) === opt.value}
                    disabled={Boolean(insertMode)}
                    onChange={() =>
                      setForm((f) => ({ ...f, predefinedType: opt.value }))
                    }
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        )}
        {elemType === "footing" && (
          <>
            <div style={{ ...S.fieldWide, marginBottom: 6 }}>
              Tipo
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 3 }}>
                {[
                  { value: "PAD_FOOTING", label: "Sapata" },
                  { value: "PILE_CAP", label: "Bloco (estacas)" },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <input
                      type="radio"
                      name="footing-predefined-type"
                      checked={(form.predefinedType ?? "PAD_FOOTING") === opt.value}
                      disabled={Boolean(insertMode)}
                      onChange={() =>
                        setForm((f) => ({ ...f, predefinedType: opt.value }))
                      }
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {/* geometria: rodapé reto (opcional) + base + topo (só sapata) + altura */}
            <div style={S.row}>
              <label style={S.field}>
                base largura
                <input
                  style={S.num}
                  type="number"
                  step="0.05"
                  value={form.baseWidth ?? ""}
                  disabled={Boolean(insertMode)}
                  onChange={(e) => setForm((f) => ({ ...f, baseWidth: e.target.value }))}
                />
              </label>
              <label style={S.field}>
                base compr.
                <input
                  style={S.num}
                  type="number"
                  step="0.05"
                  value={form.baseLength ?? ""}
                  disabled={Boolean(insertMode)}
                  onChange={(e) => setForm((f) => ({ ...f, baseLength: e.target.value }))}
                />
              </label>
              <label style={S.field}>
                rodapé (h)
                <input
                  style={S.num}
                  type="number"
                  step="0.05"
                  min="0"
                  value={form.baseHeight ?? ""}
                  disabled={Boolean(insertMode)}
                  onChange={(e) => setForm((f) => ({ ...f, baseHeight: e.target.value }))}
                />
              </label>
            </div>
            <div style={S.row}>
              <label style={S.field}>
                altura tronco
                <input
                  style={S.num}
                  type="number"
                  step="0.05"
                  value={form.height ?? ""}
                  disabled={Boolean(insertMode)}
                  onChange={(e) => setForm((f) => ({ ...f, height: e.target.value }))}
                />
              </label>
            </div>
            {form.predefinedType !== "PILE_CAP" && (
              <div style={S.row}>
                <label style={S.field}>
                  topo largura
                  <input
                    style={S.num}
                    type="number"
                    step="0.05"
                    value={form.topWidth ?? ""}
                    disabled={Boolean(insertMode)}
                    onChange={(e) => setForm((f) => ({ ...f, topWidth: e.target.value }))}
                  />
                </label>
                <label style={S.field}>
                  topo compr.
                  <input
                    style={S.num}
                    type="number"
                    step="0.05"
                    value={form.topLength ?? ""}
                    disabled={Boolean(insertMode)}
                    onChange={(e) => setForm((f) => ({ ...f, topLength: e.target.value }))}
                  />
                </label>
              </div>
            )}

            {form.predefinedType === "PILE_CAP" && (
              <div style={S.row}>
                <label style={S.field}>
                  nº estacas
                  <input
                    style={S.num}
                    type="number"
                    step="1"
                    min="1"
                    value={form.pileCount ?? ""}
                    disabled={Boolean(insertMode)}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, pileCount: e.target.value }))
                    }
                  />
                </label>
                <label style={S.field}>
                  Ø estaca
                  <input
                    style={S.num}
                    type="number"
                    step="0.05"
                    value={form.pileDiameter ?? ""}
                    disabled={Boolean(insertMode)}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, pileDiameter: e.target.value }))
                    }
                  />
                </label>
              </div>
            )}

            {/* pedestal opcional */}
            <label
              style={{
                ...S.fieldWide,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                marginBottom: 4,
              }}
            >
              <input
                type="checkbox"
                checked={Boolean(form.usePedestal)}
                disabled={Boolean(insertMode)}
                onChange={(e) =>
                  setForm((f) => ({ ...f, usePedestal: e.target.checked }))
                }
              />
              Pedestal
            </label>
            {form.usePedestal && (
              <div style={S.row}>
                <label style={S.field}>
                  ped. largura
                  <input
                    style={S.num}
                    type="number"
                    step="0.05"
                    value={form.pedestalWidth ?? ""}
                    disabled={Boolean(insertMode)}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, pedestalWidth: e.target.value }))
                    }
                  />
                </label>
                <label style={S.field}>
                  ped. compr.
                  <input
                    style={S.num}
                    type="number"
                    step="0.05"
                    value={form.pedestalLength ?? ""}
                    disabled={Boolean(insertMode)}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, pedestalLength: e.target.value }))
                    }
                  />
                </label>
                <label style={S.field}>
                  ped. altura
                  <input
                    style={S.num}
                    type="number"
                    step="0.05"
                    value={form.pedestalHeight ?? ""}
                    disabled={Boolean(insertMode)}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, pedestalHeight: e.target.value }))
                    }
                  />
                </label>
              </div>
            )}

            {/* dimensionamento: SÓ sugestão em texto, não altera os campos */}
            <fieldset style={{ ...S.fs, marginTop: 6 }} disabled={Boolean(insertMode)}>
              <legend>Sugestão de dimensionamento (não aplica)</legend>
              <div style={S.row}>
                <label style={S.field}>
                  N (kN)
                  <input
                    style={S.num}
                    type="number"
                    step="10"
                    value={form.axialLoad ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, axialLoad: e.target.value }))
                    }
                  />
                </label>
                {form.predefinedType === "PILE_CAP" ? (
                  <label style={S.field}>
                    cap. estaca (kN)
                    <input
                      style={S.num}
                      type="number"
                      step="10"
                      value={form.pileCapacity ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, pileCapacity: e.target.value }))
                      }
                    />
                  </label>
                ) : (
                  <label style={S.field}>
                    σadm solo (kPa)
                    <input
                      style={S.num}
                      type="number"
                      step="10"
                      value={form.soilBearing ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, soilBearing: e.target.value }))
                      }
                    />
                  </label>
                )}
              </div>
              {form.predefinedType !== "PILE_CAP" && (
                <div style={S.row}>
                  <label style={S.field}>
                    pilar largura
                    <input
                      style={S.num}
                      type="number"
                      step="0.05"
                      value={form.columnWidth ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, columnWidth: e.target.value }))
                      }
                    />
                  </label>
                  <label style={S.field}>
                    pilar profund.
                    <input
                      style={S.num}
                      type="number"
                      step="0.05"
                      value={form.columnDepth ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, columnDepth: e.target.value }))
                      }
                    />
                  </label>
                </div>
              )}
              <button
                style={{ ...S.btn, width: "100%" }}
                disabled={busy}
                onClick={suggestFootingDimensions}
              >
                Calcular sugestão
              </button>
              {footingSuggestion && (
                <div style={{ ...S.hint, marginTop: 4 }}>{footingSuggestion}</div>
              )}
            </fieldset>
          </>
        )}
        {!(
          (elemType === "column" && columnKind === "steel") ||
          (elemType === "beam" && beamKind === "steel") ||
          elemType === "footing"
        ) && (
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
        )}
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
    </>
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
