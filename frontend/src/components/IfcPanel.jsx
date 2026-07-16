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
import { DimensionManager } from "../ifc/DimensionManager.js";
import { InsertionController } from "../ifc/insertion/InsertionController.js";
import { snapPointOnGridLevel } from "../ifc/insertion/snapping.js";
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
import { ColumnSketchController } from "../ifc/planSketch/ColumnSketchController.js";
import { BeamSketchController } from "../ifc/planSketch/BeamSketchController.js";
import { FootingSketchController } from "../ifc/planSketch/FootingSketchController.js";
import { SlabSketchController } from "../ifc/planSketch/SlabSketchController.js";
import { DimensionController } from "../ifc/planSketch/DimensionController.js";
import { miteredWallSegments, wallSegmentPlacement } from "../ifc/geometry/wallChainSegments.js";
import { localSlabPolyline } from "../ifc/geometry/slabPrism.js";
import TopToolbar from "./TopToolbar.jsx";
import ProjectBrowser from "./ProjectBrowser.jsx";
import {
  VIEW_TYPES,
  createSectionView,
  nextSectionName,
  reconcileViews,
} from "../view/viewModel.js";
import { loadViewState, saveViewState } from "../view/viewStorage.js";

const DEFAULT_COLUMN_HEIGHT = 3; // m — altura aplicada aos pilares ao converter a planta em 3D

// O seletor de tipo, os campos do formulário e o botão "+ Elemento" são
// dirigidos pelo registro de ferramentas (cada uma carrega label/fields/defaults).
const ELEMENT_FORMS = INSERTION_TOOLS;

// Aba "Coluna metálica": famílias de catálogo (HP/W/CVS/CS) + opção de perfil
// personalizado. As famílias vêm de src/data/steelColumnProfiles.js (séries
// laminadas HP/W e soldadas CVS/CS).
const STEEL_FAMILY_SELECT_OPTIONS = [
  ...STEEL_FAMILY_OPTIONS,
  { value: "custom", label: "Personalizado..." },
];
const DEFAULT_STEEL_FAMILY = STEEL_FAMILY_OPTIONS[0]?.value ?? "custom";

// Aba "Viga metálica": famílias de catálogo (HP/W/CVS/VS) + personalizado.
// Vêm de src/data/steelBeamProfiles.js (séries laminadas HP/W e soldadas CVS/VS).
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
  const [dimensionsList, setDimensionsList] = useState([]);
  const dimensionsListRef = useRef([]);
  const [selectedDimension, setSelectedDimension] = useState(null); // { guid, length } | null
  const [selected, setSelected] = useState(null); // { guid, type, name }
  const [detail, setDetail] = useState(null);
  const [connections, setConnections] = useState([]);
  const [status, setStatus] = useState("Sem modelo. Crie ou faça upload.");
  const [busy, setBusy] = useState(false);
  const [elemType, setElemType] = useState("wall");
  const [form, setForm] = useState({ ...ELEMENT_FORMS.wall.defaults });
  const [dims, setDims] = useState({ length: 5, height: 3, thickness: 0.2 });
  // ── edição "em vivo" de coluna/viga/fundação/laje já inseridas (sem
  // apagar/refazer) — formulário próprio, populado a partir do
  // Pset_ParametricSource gravado na criação. Ver selectGuid(). ──
  const [editForm, setEditForm] = useState({});
  const [editKind, setEditKind] = useState("concrete"); // "concrete" | "steel"
  const [editSteelFamily, setEditSteelFamily] = useState(DEFAULT_STEEL_FAMILY);
  const [editSteelProfileValue, setEditSteelProfileValue] = useState("");
  const [editProfileCustom, setEditProfileCustom] = useState({
    h: 300, b: 150, tw: 6.3, tf: 9.5, shape: "I",
  });
  const [editUsePedestal, setEditUsePedestal] = useState(false);
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
  // ── navegador do projeto / vistas BIM ──
  const [views, setViews] = useState([]);
  const [activeViewId, setActiveViewId] = useState(null);

  // ── ferramentas de planta 2D → 3D / Cota (toolbar superior) ──
  const [sketchTool, setSketchTool] = useState(null); // null | "wall" | "column" | "beam" | "footing" | "slab" | "dimension"
  const [wallThickness, setWallThickness] = useState(DEFAULT_WALL_THICKNESS);
  const [wallHeight, setWallHeight] = useState(DEFAULT_WALL_HEIGHT);
  const [columnHeight, setColumnHeight] = useState(DEFAULT_COLUMN_HEIGHT);
  const [, setChainsVersion] = useState(0); // bump para reagir a mudanças nas chains (fora do React state)

  // ── desfazer/refazer GLOBAL (toolbar superior) ──
  // Uma única pilha cobre tanto ações do backend (inserção via dropdown,
  // mover/girar, editar dimensões/nome, apagar) quanto ações só-planta da
  // Parede/Cota (que não tocam o backend até o "3D"). Cada registro sabe
  // quantas chamadas de backend desfazer (`ifcApi.undo`) precisa reaplicar e,
  // se mexeu na planta, um snapshot antes/depois para restaurar as cadeias.
  const historyRef = useRef({ past: [], future: [] });
  const [, setHistoryVersion] = useState(0); // bump para reagir à pilha (é um ref, não state)

  const mgrRef = useRef(null);
  const datumRef = useRef(null);
  const dimsRef = useRef(null);
  const measurePendingRef = useRef(null); // THREE.Vector3 do 1º ponto clicado (ferramenta "Medir"), ou null
  const transformRef = useRef(null);
  const selectionRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const orbitRef = useRef(null);
  const domRef = useRef(null);
  const insertionRef = useRef(null);
  const wallSketchRef = useRef(null);
  const columnSketchRef = useRef(null);
  const beamSketchRef = useRef(null);
  const footingSketchRef = useRef(null);
  const slabSketchRef = useRef(null);
  const dimensionRef = useRef(null);
  const modelIdRef = useRef(null);
  const selectedRef = useRef(null);
  const selectedDimensionRef = useRef(null);
  const formRef = useRef(form);
  const elementsRef = useRef(elements);
  const levelsRef = useRef(levels);
  const gridsRef = useRef(grids);
  const activeLevelGuidRef = useRef(activeLevelGuid);
  const viewsRef = useRef(views);
  const activeViewIdRef = useRef(activeViewId);
  const loadedViewsModelRef = useRef(null);
  const autoCreatingModelRef = useRef(false);
  const sketchToolRef = useRef(sketchTool);
  modelIdRef.current = modelId;
  selectedRef.current = selected;
  selectedDimensionRef.current = selectedDimension;
  dimensionsListRef.current = dimensionsList;
  formRef.current = form;
  elementsRef.current = elements;
  levelsRef.current = levels;
  gridsRef.current = grids;
  activeLevelGuidRef.current = activeLevelGuid;
  viewsRef.current = views;
  activeViewIdRef.current = activeViewId;
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

  // Reaplica clipping, visibilidade e câmera da vista ativa após mudanças
  // incrementais na cena (inserção, edição ou movimentação de um produto).
  const reapplyActiveView = useCallback(() => {
    const current = viewsRef.current.find(
      (view) => view.id === activeViewIdRef.current
    );
    if (!current) return false;
    const level = levelsRef.current.find(
      (item) => item.guid === current.levelId
    );
    return canvasRef.current?.applyView?.({
      ...current,
      ...(level ? { _levelElevation: Number(level.elevation ?? 0) } : {}),
    }) ?? false;
  }, [canvasRef]);

  // Retorna o nível superior quando a altura digitada coincide com uma cota
  // existente. Assim, elementos criados pela planta também ficam vinculados.
  const matchingTopLevelGuid = (baseLevelGuid, height, tolerance = 0.08) => {
    const base = levelsRef.current.find((level) => level.guid === baseLevelGuid);
    if (!base) return null;
    const target = Number(base.elevation ?? 0) + Number(height ?? 0);
    const candidate = [...levelsRef.current]
      .filter((level) => level.guid !== baseLevelGuid)
      .map((level) => ({
        guid: level.guid,
        delta: Math.abs(Number(level.elevation ?? 0) - target),
      }))
      .sort((a, b) => a.delta - b.delta)[0];
    return candidate && candidate.delta <= tolerance ? candidate.guid : null;
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

    const dims = new DimensionManager(scene);
    dimsRef.current = dims;

    // gizmo de mover/girar
    const transform = new TransformController({
      camera,
      dom,
      scene,
      orbit,
      getOrbit: () => canvasRef.current?.getOrbitControls?.() ?? orbitRef.current ?? orbit,
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
      getCamera: () => canvasRef.current?.getCamera?.() ?? cameraRef.current ?? camera,
      getDom: () => dom,
      getOrbit: () => canvasRef.current?.getOrbitControls?.() ?? orbitRef.current ?? orbit,
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
      onHistoryPush: (count) => pushHistory(count),
      onSceneChanged: reapplyActiveView,
    });
    insertion.attach();
    insertionRef.current = insertion;

    // ferramenta "Parede" (planta 2D, linhas duplas) — toolbar superior
    const wallSketch = new WallSketchController({
      getScene: () => scene,
      getCamera: () => canvasRef.current?.getCamera?.() ?? cameraRef.current ?? camera,
      getDom: () => dom,
      getOrbit: () => canvasRef.current?.getOrbitControls?.() ?? orbitRef.current ?? orbit,
      getGrids: () => gridsRef.current,
      getDatumManager: () => datumRef.current,
    });
    wallSketch.onStatus = setStatus;
    wallSketch.onChainsChanged = () => setChainsVersion((v) => v + 1);
    wallSketch.onHistoryPush = (before, after) => pushHistory(0, before, after);
    wallSketch.mount();
    wallSketch.attach();
    wallSketchRef.current = wallSketch;

    // ferramentas "Pilar" / "Viga" / "Fundação" / "Laje" (planta 2D) — mesmo
    // padrão da parede, cada uma lê o formulário lateral (a mesma aba que a
    // inserção direta em 3D já usa) no instante de cada clique.
    const sketchDeps = {
      getScene: () => scene,
      getCamera: () => canvasRef.current?.getCamera?.() ?? cameraRef.current ?? camera,
      getDom: () => dom,
      getOrbit: () => canvasRef.current?.getOrbitControls?.() ?? orbitRef.current ?? orbit,
      getGrids: () => gridsRef.current,
      getDatumManager: () => datumRef.current,
      getForm: () => formRef.current,
    };
    const columnSketch = new ColumnSketchController(sketchDeps);
    columnSketch.onStatus = setStatus;
    columnSketch.onChainsChanged = () => setChainsVersion((v) => v + 1);
    columnSketch.onHistoryPush = (before, after) => pushSketchHistory("column", before, after);
    columnSketch.mount();
    columnSketch.attach();
    columnSketchRef.current = columnSketch;

    const beamSketch = new BeamSketchController(sketchDeps);
    beamSketch.onStatus = setStatus;
    beamSketch.onChainsChanged = () => setChainsVersion((v) => v + 1);
    beamSketch.onHistoryPush = (before, after) => pushSketchHistory("beam", before, after);
    beamSketch.mount();
    beamSketch.attach();
    beamSketchRef.current = beamSketch;

    const footingSketch = new FootingSketchController(sketchDeps);
    footingSketch.onStatus = setStatus;
    footingSketch.onChainsChanged = () => setChainsVersion((v) => v + 1);
    footingSketch.onHistoryPush = (before, after) => pushSketchHistory("footing", before, after);
    footingSketch.mount();
    footingSketch.attach();
    footingSketchRef.current = footingSketch;

    const slabSketch = new SlabSketchController(sketchDeps);
    slabSketch.onStatus = setStatus;
    slabSketch.onChainsChanged = () => setChainsVersion((v) => v + 1);
    slabSketch.onHistoryPush = (before, after) => pushSketchHistory("slab", before, after);
    slabSketch.mount();
    slabSketch.attach();
    slabSketchRef.current = slabSketch;

    // ferramenta "Cota" — mede/edita paramétricamente um trecho de parede
    const dimension = new DimensionController({
      getScene: () => scene,
      getCamera: () => canvasRef.current?.getCamera?.() ?? cameraRef.current ?? camera,
      getDom: () => dom,
      getOrbit: () => canvasRef.current?.getOrbitControls?.() ?? orbitRef.current ?? orbit,
      getWallSketch: () => wallSketchRef.current,
      getIfcManager: () => mgrRef.current,
      getModelId: () => modelIdRef.current,
      api: ifcApi,
      onGeometryChanged: async (id) => {
        await refreshMesh(id);
        await refreshLists(id);
      },
      onHistoryPush: (before, after, backendCount) => pushHistory(backendCount, before, after),
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
      getCamera: () => canvasRef.current?.getCamera?.() ?? cameraRef.current ?? camera,
      dom,
      getManager: () => mgrRef.current,
      onPick: (guid) => selectGuid(guid),
      isInserting: () => insertion.active || Boolean(sketchToolRef.current),
      isTransforming: () => transform.dragging,
      isCotaActive: () => sketchToolRef.current === "measure",
      getDimensionManager: () => dimsRef.current,
      onPickDimension: (guid) => selectDimension(guid),
    });
    selection.attach();
    selectionRef.current = selection;

    // ferramenta "Medir": clique em dois pontos quaisquer (raycast contra a
    // malha real dos elementos) para criar uma cota livre — diferente da
    // ferramenta "Cota" (mede/edita parede). Não usa um Controller próprio
    // porque é só 2 cliques + preview, sem estado de cadeia/sketch.
    const measureRay = new THREE.Raycaster();
    const measureNdc = new THREE.Vector2();
    const measurePoint = (ev) => {
      const cam = canvasRef.current?.getCamera?.() ?? cameraRef.current ?? camera;
      if (!cam) return null;
      const rect = dom.getBoundingClientRect();
      measureNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      measureNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      measureRay.setFromCamera(measureNdc, cam);
      const hit = mgrRef.current?.pickPoint?.(measureRay);
      if (hit) return hit;
      // Raycast na malha exige acertar o elemento em cima — fácil numa
      // parede (linha comprida), difícil num pilar (seção pequena, ex.
      // 0,3m) visto de longe em planta. Reforço: encaixa na interseção de
      // grid mais próxima do clique, mesmo padrão que as outras
      // ferramentas de inserção já usam.
      const snap = snapPointOnGridLevel(ev, activeInsertionLevel(), {
        camera: cam, dom, grids: gridsRef.current, datumPoints: datumRef.current?.allPoints?.(),
      });
      return snap ? { guid: null, point: snap.point } : null;
    };
    const onMeasureDown = (ev) => {
      if (sketchToolRef.current !== "measure") return;
      const hit = measurePoint(ev);
      if (!hit) {
        setStatus("Medir: clique sobre um elemento do modelo.");
        return;
      }
      ev.preventDefault?.();
      ev.stopPropagation?.();
      if (!measurePendingRef.current) {
        measurePendingRef.current = hit.point.clone();
        setStatus("Medir: clique no segundo ponto.");
      } else {
        const p0 = measurePendingRef.current;
        const p1 = hit.point.clone();
        measurePendingRef.current = null;
        dimsRef.current?.clearPreview();
        createMeasureDimension(p0, p1);
      }
    };
    const onMeasureMove = (ev) => {
      if (sketchToolRef.current !== "measure" || !measurePendingRef.current) return;
      const hit = measurePoint(ev);
      if (!hit) return;
      const p0 = measurePendingRef.current;
      const len = p0.distanceTo(hit.point);
      dimsRef.current?.setPreview(p0, hit.point, len.toFixed(2));
    };
    dom.addEventListener("pointerdown", onMeasureDown);
    dom.addEventListener("pointermove", onMeasureMove);

    return () => {
      dom.removeEventListener("pointerdown", onMeasureDown);
      dom.removeEventListener("pointermove", onMeasureMove);
      dims.dispose();
      selection.dispose();
      insertion.dispose();
      dimension.dispose();
      wallSketch.dispose();
      columnSketch.dispose();
      beamSketch.dispose();
      footingSketch.dispose();
      slabSketch.dispose();
      transform.dispose();
      orbit.enabled = true;
      mgr.dispose();
      datum.dispose();
      if (domRef.current) domRef.current.style.cursor = "";
      mgrRef.current = null;
      datumRef.current = null;
      dimsRef.current = null;
      transformRef.current = null;
      selectionRef.current = null;
      insertionRef.current = null;
      wallSketchRef.current = null;
      columnSketchRef.current = null;
      beamSketchRef.current = null;
      footingSketchRef.current = null;
      slabSketchRef.current = null;
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
    const level = activeInsertionLevel();
    wallSketchRef.current?.setActive(sketchTool === "wall", level);
    columnSketchRef.current?.setActive(sketchTool === "column", level);
    beamSketchRef.current?.setActive(sketchTool === "beam", level);
    footingSketchRef.current?.setActive(sketchTool === "footing", level);
    slabSketchRef.current?.setActive(sketchTool === "slab", level);
    dimensionRef.current?.setActive(sketchTool === "dimension");
    canvasRef.current?.setActiveLevel?.(level);
    if (sketchTool !== "measure") {
      measurePendingRef.current = null;
      dimsRef.current?.clearPreview();
    }
    if (domRef.current) {
      domRef.current.style.cursor = sketchTool === "measure" ? "crosshair" : domRef.current.style.cursor;
    }
  }, [sketchTool, activeLevelGuid, canvasRef]);

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

  // ── formulário de EDIÇÃO (elemento já inserido, selecionado no canvas) ──
  // mesma lógica das abas Concreto/Metálica da inserção, mas escrevendo em
  // `editForm` em vez de `form`, e só quando o elemento selecionado é do
  // tipo compatível (coluna ou viga).
  useEffect(() => {
    if (!selected || (selected.type !== "IfcColumn" && selected.type !== "IfcBeam")) return;
    if (editKind === "concrete") {
      setEditForm((f) => ({ ...f, profile: null, shape: null, h: null, b: null, tw: null, tf: null }));
      return;
    }
    if (editSteelFamily === "custom") {
      setEditForm((f) => ({
        ...f,
        width: editProfileCustom.b / 1000,
        depth: editProfileCustom.h / 1000,
        profile: "custom",
        shape: editProfileCustom.shape,
        h: editProfileCustom.h / 1000,
        b: editProfileCustom.b / 1000,
        tw: editProfileCustom.tw / 1000,
        tf: editProfileCustom.tf / 1000,
      }));
      return;
    }
    const families = selected.type === "IfcBeam" ? STEEL_BEAM_FAMILIES : STEEL_COLUMN_FAMILIES;
    const family = families[editSteelFamily];
    const item =
      family?.profiles.find((p) => p.value === editSteelProfileValue) ?? family?.profiles[0];
    if (!item) return;
    setEditForm((f) => ({
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
    selected,
    editKind,
    editSteelFamily,
    editSteelProfileValue,
    editProfileCustom.b,
    editProfileCustom.h,
    editProfileCustom.tw,
    editProfileCustom.tf,
    editProfileCustom.shape,
  ]);

  // ao trocar de família de perfil metálico no formulário de EDIÇÃO,
  // seleciona o primeiro perfil dela (evita ficar com um valor inválido)
  useEffect(() => {
    if (editSteelFamily === "custom") return;
    const families = selected?.type === "IfcBeam" ? STEEL_BEAM_FAMILIES : STEEL_COLUMN_FAMILIES;
    const profiles = families[editSteelFamily]?.profiles ?? [];
    if (!profiles.some((p) => p.value === editSteelProfileValue)) {
      setEditSteelProfileValue(profiles[0]?.value ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSteelFamily]);

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

  // Reconcilia níveis IFC com as plantas e restaura as vistas salvas por modelo.
  useEffect(() => {
    if (!modelId) {
      loadedViewsModelRef.current = null;
      setViews([]);
      setActiveViewId(null);
      return;
    }
    if (loadedViewsModelRef.current !== modelId) {
      loadedViewsModelRef.current = modelId;
      const restored = loadViewState(modelId, levels);
      setViews(restored.views);
      setActiveViewId(restored.activeViewId);
      return;
    }
    setViews((current) => reconcileViews(current, levels));
  }, [modelId, levels]);

  useEffect(() => {
    if (!modelId || !views.length) return;
    saveViewState(modelId, { views, activeViewId });
  }, [modelId, views, activeViewId]);

  // Aplica a vista ativa no ThreeCanvas. A elevação absoluta do nível é
  // injetada apenas em runtime; o objeto persistido continua independente.
  useEffect(() => {
    const view = views.find((item) => item.id === activeViewId);
    if (!view) return;
    const level = levels.find((item) => item.guid === view.levelId);
    canvasRef.current?.applyView?.({
      ...view,
      ...(level ? { _levelElevation: Number(level.elevation ?? 0) } : {}),
    });
    const nextCamera = canvasRef.current?.getCamera?.();
    const nextOrbit = canvasRef.current?.getOrbitControls?.();
    cameraRef.current = nextCamera ?? cameraRef.current;
    orbitRef.current = nextOrbit ?? orbitRef.current;
    datumRef.current?.setCamera?.(nextCamera);
    transformRef.current?.setCamera?.(nextCamera);
    // Em vistas ortográficas, evita editar acidentalmente com gizmos 3D.
    transformRef.current?.setEnabled?.(view.type === VIEW_TYPES.THREE_D && workPlaneControls);
  }, [activeViewId, views, levels, workPlaneControls, canvasRef]);

  // ── dados ────────────────────────────────────────────────────────────────
  // carrega as cotas manuais ponto-a-ponto e desenha via DimensionManager —
  // chamada de dentro de `refreshMesh` (que já roda depois de toda
  // criação/edição/undo/redo), então nunca precisa de um ponto de chamada
  // próprio espalhado pelo código.
  const refreshDimensions = useCallback(async (id) => {
    const { dimensions: list } = await ifcApi.listDimensions(id);
    setDimensionsList(list);
    const dims = dimsRef.current;
    if (!dims) return;
    const seen = new Set();
    for (const d of list) {
      seen.add(d.guid);
      dims.set(
        d.guid,
        new THREE.Vector3(...d.p0),
        new THREE.Vector3(...d.p1),
        `${d.length.toFixed(2)}`
      );
    }
    for (const guid of [...dims.items.keys()]) {
      if (!seen.has(guid)) dims.remove(guid);
    }
  }, []);

  // determina o "plane" a mandar pro backend a partir da vista ativa (planta
  // -> "z"; elevação/corte -> eixo dominante da direção de visada) — só
  // afeta a orientação da marca de extremidade da cota, ver dimension_service.py
  const planeForActiveView = useCallback(() => {
    const view = viewsRef.current.find((v) => v.id === activeViewIdRef.current);
    if (!view || view.type === "plan" || view.type === "3d") return "z";
    const d = view.direction || [0, 1, 0];
    return Math.abs(d[0]) >= Math.abs(d[1]) ? "x" : "y";
  }, []);

  const refreshMesh = useCallback(async (id) => {
    const bbox = mgrRef.current?.loadModel(await ifcApi.mesh(id));
    datumRef.current?.setBBox(bbox); // dimensiona os planos de nível
    const current = viewsRef.current.find((view) => view.id === activeViewIdRef.current);
    if (current) {
      const level = levelsRef.current.find((item) => item.guid === current.levelId);
      canvasRef.current?.applyView?.({
        ...current,
        ...(level ? { _levelElevation: Number(level.elevation ?? 0) } : {}),
      });
    }
    await refreshDimensions(id);
  }, [canvasRef, refreshDimensions]);

  const createMeasureDimension = useCallback(
    async (p0, p1) => {
      const id = modelIdRef.current;
      if (!id) return;
      try {
        setBusy(true);
        const plane = planeForActiveView();
        const { guid, length } = await ifcApi.createDimension(
          id, [p0.x, p0.y, p0.z], [p1.x, p1.y, p1.z], plane
        );
        dimsRef.current?.set(guid, p0, p1, length.toFixed(2));
        setDimensionsList((list) => [
          ...list,
          { guid, p0: [p0.x, p0.y, p0.z], p1: [p1.x, p1.y, p1.z], plane, length },
        ]);
        setStatus(`Cota criada: ${length.toFixed(2)} m.`);
        setBusy(false);
        pushHistory(1);
      } catch (e) {
        fail(e);
      }
    },
    [planeForActiveView]
  );

  const deleteMeasureDimension = useCallback(async (guid) => {
    const id = modelIdRef.current;
    if (!id) return;
    try {
      setBusy(true);
      await ifcApi.deleteDimension(id, guid);
      dimsRef.current?.remove(guid);
      setDimensionsList((list) => list.filter((d) => d.guid !== guid));
      if (selectedDimensionRef.current?.guid === guid) setSelectedDimension(null);
      setStatus("Cota apagada.");
      setBusy(false);
      pushHistory(1);
    } catch (e) {
      fail(e);
    }
  }, []);

  // seleciona uma cota por clique (ver SelectionController.onPickDimension) —
  // mutuamente exclusivo com a seleção normal de elemento.
  const selectDimension = useCallback((guid) => {
    if (!guid) {
      dimsRef.current?.setSelected(null);
      setSelectedDimension(null);
      return;
    }
    mgrRef.current?.setSelected(null);
    transformRef.current?.detach();
    setSelected(null);
    setDetail(null);
    setConnections([]);
    dimsRef.current?.setSelected(guid);
    const found = dimensionsListRef.current.find((d) => d.guid === guid);
    setSelectedDimension({ guid, length: found?.length ?? null });
    setStatus(found ? `Cota selecionada: ${found.length.toFixed(2)} m. Delete para apagar.` : "Cota selecionada.");
  }, []);

  // carrega níveis + grids e os desenha na camada de datums
  const refreshDatums = useCallback(async (id) => {
    const [lvls, grds] = await Promise.all([ifcApi.levels(id), ifcApi.grids(id)]);
    setLevels(lvls);
    setGrids(grds);
    datumRef.current?.setLevels(lvls);
    datumRef.current?.setGrids(grds);
    return { levels: lvls, grids: grds };
  }, []);

  const refreshLists = useCallback(async (id) => {
    const [sum, els] = await Promise.all([
      ifcApi.summary(id),
      ifcApi.entities(id, "IfcBuildingElement"),
    ]);
    setSummary(sum);
    setElements(els);
  }, []);

  // Reconstrói o estado do formulário de EDIÇÃO a partir do
  // Pset_ParametricSource do elemento selecionado (gravado por `write_params`
  // no backend a cada criação/edição). Sem esse Pset — ex.: elemento de um
  // IFC externo, ou criado antes desta funcionalidade — a edição em vivo
  // simplesmente não fica disponível para aquele elemento específico.
  const applyEditParamsFromDetail = useCallback((d) => {
    const raw = d?.psets?.Pset_ParametricSource?.ParamsJSON;
    let params = null;
    if (raw) {
      try {
        params = JSON.parse(raw);
      } catch {
        params = null;
      }
    }
    setEditForm(params || {});
    setEditUsePedestal(Boolean(params?.pedestal_height));
    if (!params || !params.shape) {
      setEditKind("concrete");
      return;
    }
    if (params.profile === "custom") {
      setEditKind("steel");
      setEditSteelFamily("custom");
      setEditProfileCustom({
        h: (params.h ?? 0) * 1000,
        b: (params.b ?? 0) * 1000,
        tw: (params.tw ?? 0) * 1000,
        tf: (params.tf ?? 0) * 1000,
        shape: params.shape,
      });
      return;
    }
    const families = d.type === "IfcBeam" ? STEEL_BEAM_FAMILIES : STEEL_COLUMN_FAMILIES;
    const familyKey = Object.keys(families).find((k) =>
      families[k].profiles.some((p) => p.value === params.profile)
    );
    if (familyKey) {
      setEditKind("steel");
      setEditSteelFamily(familyKey);
      setEditSteelProfileValue(params.profile);
    } else {
      setEditKind("concrete");
    }
  }, []);

  const selectGuid = useCallback(async (guid) => {
    const mgr = mgrRef.current;
    mgr?.setSelected(guid);
    if (selectedDimensionRef.current) {
      dimsRef.current?.setSelected(null);
      setSelectedDimension(null);
    }
    if (!guid) {
      setSelected(null);
      setDetail(null);
      setEditForm({});
      setConnections([]);
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
      applyEditParamsFromDetail(d);
    } catch (e) {
      console.warn(e);
    }
    try {
      const c = await ifcApi.connections(modelIdRef.current, guid);
      setConnections(c.connections ?? []);
    } catch {
      setConnections([]); // tipo sem conectividade rastreada (parede, etc.) — normal
    }
  }, [applyEditParamsFromDetail]);

  const firstStorey = async (id) => {
    try {
      const tree = await ifcApi.spatialTree(id);
      return tree?.children?.[0]?.children?.[0]?.children?.[0]?.guid ?? null;
    } catch {
      return null;
    }
  };

  // ── ações de modelo ───────────────────────────────────────────────────────
  const initializeBlankModel = async ({ automatic = false } = {}) => {
    if (autoCreatingModelRef.current) return modelIdRef.current;
    autoCreatingModelRef.current = true;
    try {
      setBusy(true);
      setStatus(automatic ? "Preparando um modelo novo…" : "Criando modelo…");
      const { model_id } = await ifcApi.createModel("editor");
      await ifcApi.spatialBootstrap(model_id, {});
      setLevels([]);
      setViews([]);
      setActiveViewId(null);
      setModelId(model_id);
      await refreshLists(model_id);
      await refreshMesh(model_id);
      const datums = await refreshDatums(model_id);

      // Abre diretamente a planta do primeiro nível. As ferramentas estruturais
      // dependem de uma vista em planta para localizar corretamente os pontos de
      // grid, portanto deixar a vista 3D como inicial produzia cliques sem efeito.
      const initialViews = reconcileViews([], datums.levels);
      const firstLevel = datums.levels[0] ?? null;
      const initialPlan = firstLevel
        ? initialViews.find(
            (view) =>
              view.type === VIEW_TYPES.PLAN &&
              view.levelId === (firstLevel.guid ?? firstLevel.id)
          )
        : null;
      loadedViewsModelRef.current = model_id;
      setViews(initialViews);
      setActiveViewId(
        initialPlan?.id ??
          initialViews.find((view) => view.type === VIEW_TYPES.THREE_D)?.id ??
          null
      );
      if (firstLevel) setActiveLevelGuid(firstLevel.guid ?? firstLevel.id);

      setStatus(
        automatic
          ? `Modelo ${model_id.slice(0, 8)} criado automaticamente. Crie ou selecione um grid para começar.`
          : `Modelo ${model_id.slice(0, 8)} pronto.`
      );
      setBusy(false);
      autoCreatingModelRef.current = false;
      return model_id;
    } catch (e) {
      autoCreatingModelRef.current = false;
      fail(e);
      return null;
    }
  };

  const newModel = async () => initializeBlankModel({ automatic: false });

  // O editor IFC passa a abrir pronto para modelar. Antes, os botões de nível
  // e grid pareciam funcionar, mas retornavam silenciosamente enquanto nenhum
  // modelo havia sido criado pelo botão "Novo".
  useEffect(() => {
    if (!modelIdRef.current && !autoCreatingModelRef.current) {
      initializeBlankModel({ automatic: true });
    }
    // Executa apenas na abertura do painel IFC.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upload = async (file) => {
    if (!file) return;
    try {
      setBusy(true);
      setStatus(`Enviando ${file.name}…`);
      const { model_id } = await ifcApi.uploadModel(file);
      setLevels([]);
      setViews([]);
      setActiveViewId(null);
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

  // ── planta 2D de TODAS as ferramentas (Parede/Pilar/Viga/Fundação/Laje) ────
  // Mapa único usado pelo histórico global para não perder o estado de uma
  // ferramenta enquanto desfaz/refaz uma ação feita em outra.
  const planSketchRefs = () => ({
    wall: wallSketchRef.current,
    column: columnSketchRef.current,
    beam: beamSketchRef.current,
    footing: footingSketchRef.current,
    slab: slabSketchRef.current,
  });

  const snapshotPlanSketches = useCallback(() => {
    const snap = {};
    for (const [key, ctrl] of Object.entries(planSketchRefs())) {
      if (ctrl) snap[key] = ctrl.snapshotChains();
    }
    return snap;
  }, []);

  const restorePlanSketches = useCallback((snap) => {
    if (!snap) return;
    for (const [key, ctrl] of Object.entries(planSketchRefs())) {
      if (ctrl && snap[key]) ctrl.restoreChains(snap[key]);
    }
  }, []);

  // ── histórico global (desfazer/refazer) ───────────────────────────────────
  // Registro: { backendCount, sketchBefore, sketchAfter }. `backendCount` diz
  // quantas vezes chamar ifcApi.undo/redo em sequência (cada chamada de API
  // do backend é um snapshot próprio); `sketchBefore/After` são snapshots de
  // TODAS as plantas 2D (Parede/Pilar/Viga/Fundação/Laje — ver
  // snapshotPlanSketches acima), usados quando a ação mexeu só na planta
  // (ainda não convertida em 3D).
  const pushHistory = useCallback((backendCount, sketchBefore = null, sketchAfter = null) => {
    historyRef.current.past.push({ backendCount, sketchBefore, sketchAfter });
    historyRef.current.future = [];
    setHistoryVersion((v) => v + 1);
  }, []);

  // Chamado pelo onHistoryPush de cada controller de planta com o
  // before/after LOCAL daquela ferramenta (a única que mudou); combina com o
  // estado ATUAL das demais (que não mudou) para formar o snapshot global.
  const pushSketchHistory = useCallback(
    (toolKey, beforeLocal, afterLocal) => {
      const afterAll = { ...snapshotPlanSketches(), [toolKey]: afterLocal };
      const beforeAll = { ...afterAll, [toolKey]: beforeLocal };
      pushHistory(0, beforeAll, afterAll);
    },
    [snapshotPlanSketches, pushHistory]
  );

  const applyHistoryRecord = async (rec, direction) => {
    const backendStep = direction === "undo" ? ifcApi.undo : ifcApi.redo;
    for (let k = 0; k < (rec.backendCount ?? 0); k += 1) {
      await backendStep(modelId);
    }
    const sketchState = direction === "undo" ? rec.sketchBefore : rec.sketchAfter;
    if (sketchState) restorePlanSketches(sketchState);
    await reloadAll(modelId);
    dimensionRef.current?.refreshAll();
  };

  const globalUndo = async () => {
    const rec = historyRef.current.past[historyRef.current.past.length - 1];
    if (!rec || !modelId) return;
    try {
      setBusy(true);
      historyRef.current.past.pop();
      historyRef.current.future.push(rec);
      setHistoryVersion((v) => v + 1);
      await applyHistoryRecord(rec, "undo");
      setStatus("Desfeito.");
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  const globalRedo = async () => {
    const rec = historyRef.current.future[historyRef.current.future.length - 1];
    if (!rec || !modelId) return;
    try {
      setBusy(true);
      historyRef.current.future.pop();
      historyRef.current.past.push(rec);
      setHistoryVersion((v) => v + 1);
      await applyHistoryRecord(rec, "redo");
      setStatus("Refeito.");
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  // ── criar elemento: liga/desliga o modo de inserção da ferramenta atual ────
  const createElement = () => {
    const insertion = insertionRef.current;
    if (!modelIdRef.current || !insertion) {
      setStatus("O modelo ainda está sendo preparado.");
      return;
    }
    if (insertMode) insertion.cancel();
    else {
      const requiresGrid = new Set(["column", "beam", "footing"]);
      if (requiresGrid.has(elemType) && !(gridsRef.current?.length > 0)) {
        setStatus("Crie primeiro um grid U/V para inserir esse elemento.");
        return;
      }
      // Antes o editor trocava automaticamente para a planta do nível ativo.
      // Isso impedia inserir diretamente com a vista 3D aberta. A projeção do
      // clique no plano do nível já funciona em qualquer câmera, então basta
      // manter a vista atual e iniciar a inserção.
      insertion.begin(elemType);
    }
  };

  // ── toolbar superior: Parede/Pilar/Viga/Fundação/Laje/Cota (mutuamente
  // exclusivas com o dropdown "+ Elemento") ──
  const selectSketchTool = (tool) => {
    if (tool) {
      if (!modelIdRef.current) {
        setStatus("O modelo ainda está sendo preparado.");
        return;
      }

      const requiresGrid = new Set(["column", "beam", "footing", "slab"]);
      if (requiresGrid.has(tool) && !(gridsRef.current?.length > 0)) {
        setStatus(
          `${tool === "column" ? "Pilar" : tool === "beam" ? "Viga" : tool === "slab" ? "Laje" : "Fundação"}: crie primeiro um grid U/V no painel lateral.`
        );
        return;
      }

      insertionRef.current?.cancel();
      transformRef.current?.detach();
      setSelected(null);
      setDetail(null);
      // troca também o tipo do formulário lateral (mesmos campos que a
      // ferramenta de planta lê a cada clique), quando o id bate com um
      // elemType — não é o caso de "dimension".
      if (ELEMENT_FORMS[tool]) setElemType(tool);

      // Mantém a vista atual (inclusive 3D). O snap continua ocorrendo nas
      // interseções de grid/datum do nível ativo, mas agora o usuário pode
      // lançar os elementos sem sair da navegação em perspectiva.
    }
    setSketchTool(tool);
  };

  // ── toolbar superior: 3D — alterna entre planta 2D e extrusão 3D ───────────
  // Retorna quantos IfcWall foram criados (para o desfazer/refazer global).
  const convertPendingChainsTo3D = async (pending) => {
    const wallSketch = wallSketchRef.current;
    setStatus("Gerando paredes 3D…");
    const height = Number(wallHeight) || DEFAULT_WALL_HEIGHT;
    let seq = elementsRef.current.length + 1;
    let created = 0;
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
          top_level_guid: matchingTopLevelGuid(storey_guid, height),
          base_offset: 0,
          top_offset: 0,
        });
        guids.push(guid);
        created += 1;
      }
      wallSketch.markChainConverted(chain.id, guids, height);
    }
    setStatus("Paredes 3D geradas a partir da planta.");
    return created;
  };

  // Retorna quantos IfcWall foram apagados (para o desfazer/refazer global).
  const revertConvertedChainsTo2D = async (converted) => {
    const wallSketch = wallSketchRef.current;
    setStatus("Voltando para a planta 2D…");
    let deleted = 0;
    for (const chain of converted) {
      for (const guid of chain.wallGuids) {
        if (guid) {
          await ifcApi.deleteEntity(modelId, guid);
          deleted += 1;
        }
      }
      wallSketch.revertChainTo2D(chain.id);
    }
    setStatus("De volta à planta 2D.");
    return deleted;
  };

  // ── Pilar: converte cada marcador pendente num IfcColumn (altura vem do
  // campo "altura 3D" da TopToolbar, igual à parede). ──
  const convertPendingColumnsTo3D = async (pending) => {
    const columnSketch = columnSketchRef.current;
    setStatus("Gerando pilares 3D…");
    const height = Number(columnHeight) || DEFAULT_COLUMN_HEIGHT;
    let seq = elementsRef.current.length + 1;
    let created = 0;
    for (const marker of pending) {
      const { width, depth, refX, refY, profile, shape, h, b, tw, tf } = marker.form;
      const origin = marker.point.clone();
      origin.x += refX === "start" ? width / 2 : refX === "end" ? -width / 2 : 0;
      origin.y += refY === "start" ? depth / 2 : refY === "end" ? -depth / 2 : 0;
      const storey_guid = marker.levelGuid ?? (await firstStorey(modelId));
      const { guid } = await ifcApi.createColumn(modelId, {
        name: `C${seq++}`,
        width,
        depth,
        height,
        position: [origin.x, origin.y, origin.z],
        rotation_z: 0,
        storey_guid,
        top_level_guid: matchingTopLevelGuid(storey_guid, height),
        base_offset: 0,
        top_offset: 0,
        ...(profile && shape && h && b && tw && tf ? { profile, shape, h, b, tw, tf } : {}),
      });
      columnSketch.markConverted(marker.id, guid);
      created += 1;
    }
    setStatus("Pilares 3D gerados a partir da planta.");
    return created;
  };

  const revertConvertedColumnsTo2D = async (converted) => {
    const columnSketch = columnSketchRef.current;
    setStatus("Voltando pilares para a planta 2D…");
    let deleted = 0;
    for (const marker of converted) {
      await ifcApi.deleteEntity(modelId, marker.columnGuid);
      deleted += 1;
      columnSketch.revertToPlan(marker.id);
    }
    setStatus("De volta à planta 2D.");
    return deleted;
  };

  // ── Fundação: converte cada marcador pendente numa IfcFooting (sapata ou
  // bloco — todos os campos já vieram do formulário no clique). ──
  const convertPendingFootingsTo3D = async (pending) => {
    const footingSketch = footingSketchRef.current;
    setStatus("Gerando fundações 3D…");
    let seq = elementsRef.current.length + 1;
    let created = 0;
    for (const marker of pending) {
      const p = marker.form;
      const totalHeight = p.baseHeight + p.height + p.pedestalHeight;
      const origin = marker.point.clone();
      origin.z -= totalHeight;
      const storey_guid = marker.levelGuid ?? (await firstStorey(modelId));
      const { guid } = await ifcApi.createFooting(modelId, {
        name: `F${seq++}`,
        predefined_type: p.isPileCap ? "PILE_CAP" : "PAD_FOOTING",
        base_width: p.baseWidth,
        base_length: p.baseLength,
        top_width: p.topWidth,
        top_length: p.topLength,
        height: p.height,
        ...(p.baseHeight > 0 ? { base_height: p.baseHeight } : {}),
        ...(p.pedestalHeight > 0
          ? { pedestal_width: p.pedestalWidth, pedestal_length: p.pedestalLength, pedestal_height: p.pedestalHeight }
          : {}),
        position: [origin.x, origin.y, origin.z],
        rotation_z: 0,
        storey_guid,
        ...(p.isPileCap && p.pileCount
          ? { pile_count: Number(p.pileCount), ...(p.pileDiameter ? { pile_diameter: Number(p.pileDiameter) } : {}) }
          : {}),
      });
      footingSketch.markConverted(marker.id, guid);
      created += 1;
    }
    setStatus("Fundações 3D geradas a partir da planta.");
    return created;
  };

  const revertConvertedFootingsTo2D = async (converted) => {
    const footingSketch = footingSketchRef.current;
    setStatus("Voltando fundações para a planta 2D…");
    let deleted = 0;
    for (const marker of converted) {
      await ifcApi.deleteEntity(modelId, marker.footingGuid);
      deleted += 1;
      footingSketch.revertToPlan(marker.id);
    }
    setStatus("De volta à planta 2D.");
    return deleted;
  };

  // ── Viga: converte cada TRECHO de cada cadeia pendente numa IfcBeam
  // própria (sem miter — ver BeamSketchController). ──
  const convertPendingBeamsTo3D = async (pending) => {
    const beamSketch = beamSketchRef.current;
    setStatus("Gerando vigas 3D…");
    let seq = elementsRef.current.length + 1;
    let created = 0;
    for (const chain of pending) {
      const { width, depth, axisRef, profile, shape, h, b, tw, tf } = chain.form;
      const pts = chain.points;
      const segs = [];
      for (let i = 0; i < pts.length - 1; i += 1) segs.push([pts[i], pts[i + 1]]);
      if (chain.closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
      const guids = [];
      for (const [p0, p1] of segs) {
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const length = Math.hypot(dx, dy);
        if (length < 0.05) {
          guids.push(null);
          continue;
        }
        const rotation_z = Math.atan2(dy, dx);
        const origin = p0.clone();
        origin.z += axisRef === "bottom" ? depth / 2 : axisRef === "center" ? 0 : -depth / 2;
        const storey_guid = chain.levelGuid ?? (await firstStorey(modelId));
        const { guid } = await ifcApi.createBeam(modelId, {
          name: `B${seq++}`,
          width,
          depth,
          length,
          position: [origin.x, origin.y, origin.z],
          rotation_z,
          storey_guid,
          ...(profile && shape && h && b && tw && tf ? { profile, shape, h, b, tw, tf } : {}),
        });
        guids.push(guid);
        created += 1;
      }
      beamSketch.markChainConverted(chain.id, guids);
    }
    setStatus("Vigas 3D geradas a partir da planta.");
    return created;
  };

  const revertConvertedBeamsTo2D = async (converted) => {
    const beamSketch = beamSketchRef.current;
    setStatus("Voltando vigas para a planta 2D…");
    let deleted = 0;
    for (const chain of converted) {
      for (const guid of chain.beamGuids) {
        if (guid) {
          await ifcApi.deleteEntity(modelId, guid);
          deleted += 1;
        }
      }
      beamSketch.revertChainTo2D(chain.id);
    }
    setStatus("De volta à planta 2D.");
    return deleted;
  };

  // ── Laje/Radier: converte cada contorno fechado pendente numa ÚNICA
  // IfcSlab (o polígono inteiro — sem segmentar, diferente de parede/viga). ──
  const convertPendingSlabsTo3D = async (pending) => {
    const slabSketch = slabSketchRef.current;
    setStatus("Gerando lajes 3D…");
    let seq = elementsRef.current.length + 1;
    let created = 0;
    for (const chain of pending) {
      const { thickness, axisRef, predefinedType } = chain.form;
      const origin = chain.points[0].clone();
      origin.z += axisRef === "bottom" ? 0 : axisRef === "center" ? -thickness / 2 : -thickness;
      const storey_guid = chain.levelGuid ?? (await firstStorey(modelId));
      const isRaft = predefinedType === "BASESLAB";
      const { guid } = await ifcApi.createSlab(modelId, {
        name: `${isRaft ? "R" : "S"}${seq++}`,
        thickness,
        polyline: localSlabPolyline(chain.points),
        position: [origin.x, origin.y, origin.z],
        rotation_z: 0,
        storey_guid,
        ...(isRaft ? { predefined_type: "BASESLAB" } : {}),
      });
      slabSketch.markChainConverted(chain.id, guid);
      created += 1;
    }
    setStatus("Lajes 3D geradas a partir da planta.");
    return created;
  };

  const revertConvertedSlabsTo2D = async (converted) => {
    const slabSketch = slabSketchRef.current;
    setStatus("Voltando lajes para a planta 2D…");
    let deleted = 0;
    for (const chain of converted) {
      if (chain.slabGuid) {
        await ifcApi.deleteEntity(modelId, chain.slabGuid);
        deleted += 1;
      }
      slabSketch.revertChainTo2D(chain.id);
    }
    setStatus("De volta à planta 2D.");
    return deleted;
  };

  // ── toolbar superior: botão "3D" — converte TODOS os elementos desenhados
  // em planta (Parede/Pilar/Viga/Fundação/Laje juntos), não só o tipo da
  // ferramenta atualmente selecionada. Cada handler sabe, pelos seus
  // próprios itens, quais já foram convertidos. ──
  const SKETCH_3D_HANDLERS = {
    wall: {
      getChains: () => wallSketchRef.current?.getChains() ?? [],
      isConverted: (c) => Boolean(c.wallGuids),
      convert: convertPendingChainsTo3D,
      revert: revertConvertedChainsTo2D,
    },
    column: {
      getChains: () => columnSketchRef.current?.getChains() ?? [],
      isConverted: (c) => Boolean(c.columnGuid),
      convert: convertPendingColumnsTo3D,
      revert: revertConvertedColumnsTo2D,
    },
    beam: {
      getChains: () => beamSketchRef.current?.getChains() ?? [],
      isConverted: (c) => Boolean(c.beamGuids),
      convert: convertPendingBeamsTo3D,
      revert: revertConvertedBeamsTo2D,
    },
    footing: {
      getChains: () => footingSketchRef.current?.getChains() ?? [],
      isConverted: (c) => Boolean(c.footingGuid),
      convert: convertPendingFootingsTo3D,
      revert: revertConvertedFootingsTo2D,
    },
    slab: {
      getChains: () => slabSketchRef.current?.getChains() ?? [],
      isConverted: (c) => Boolean(c.slabGuid),
      convert: convertPendingSlabsTo3D,
      revert: revertConvertedSlabsTo2D,
    },
  };

  // Junta pendentes/convertidos de TODOS os tipos — usado tanto pelo clique
  // no botão quanto pelo estado (canConvert/is3DActive) que decide o rótulo.
  const gatherAllSketch3DState = () =>
    Object.values(SKETCH_3D_HANDLERS).map((handler) => {
      const chains = handler.getChains();
      return {
        handler,
        converted: chains.filter(handler.isConverted),
        pending: chains.filter((c) => !handler.isConverted(c)),
      };
    });

  const toggle3D = async () => {
    if (!modelId) return;
    const perTool = gatherAllSketch3DState();
    const totalConverted = perTool.reduce((n, t) => n + t.converted.length, 0);
    const totalPending = perTool.reduce((n, t) => n + t.pending.length, 0);
    if (!totalConverted && !totalPending) {
      setStatus("Nada desenhado em planta para converter.");
      return;
    }
    try {
      setBusy(true);
      const sketchBefore = snapshotPlanSketches();
      let backendCount = 0;
      if (totalPending === 0) {
        // tudo já está em 3D — o clique volta TUDO para a planta 2D.
        for (const { handler, converted } of perTool) {
          if (converted.length) backendCount += await handler.revert(converted);
        }
      } else {
        // converte tudo que ainda está só em planta, em qualquer tipo de
        // elemento — o que já é 3D permanece como está.
        for (const { handler, pending } of perTool) {
          if (pending.length) backendCount += await handler.convert(pending);
        }
      }
      await refreshLists(modelId);
      await refreshMesh(modelId);
      pushHistory(backendCount, sketchBefore, snapshotPlanSketches());
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
      reapplyActiveView();
      const fresh = mgrRef.current?.getMesh(guid);
      if (fresh) transformRef.current?.attach(fresh);
      if (selectedRef.current?.guid === guid) {
        try {
          const c = await ifcApi.connections(modelIdRef.current, guid);
          setConnections(c.connections ?? []);
        } catch {
          setConnections([]);
        }
      }
      setStatus("Posição salva.");
      pushHistory(1);
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
      reapplyActiveView();
      const fresh = mgrRef.current?.getMesh(guid);
      if (fresh) transformRef.current?.attach(fresh);
      setStatus("Dimensões atualizadas.");
      setBusy(false);
      pushHistory(1);
    } catch (e) {
      fail(e);
    }
  };

  // refaz a malha do produto editado e re-sincroniza o detail (psets) —
  // usado por todo applyXEdit abaixo
  const refreshAfterEdit = async (guid) => {
    mgrRef.current?.replaceProduct(await ifcApi.productMesh(modelId, guid));
    reapplyActiveView();
    const fresh = mgrRef.current?.getMesh(guid);
    if (fresh) transformRef.current?.attach(fresh);
    try {
      const d = await ifcApi.entity(modelId, guid);
      setDetail(d);
    } catch (e) {
      console.warn(e);
    }
    try {
      const c = await ifcApi.connections(modelId, guid);
      setConnections(c.connections ?? []);
    } catch {
      setConnections([]);
    }
    setBusy(false);
    pushHistory(1);
  };

  const applyColumnEdit = async () => {
    const guid = selectedRef.current?.guid;
    if (!guid) return;
    try {
      setBusy(true);
      const { width, depth, height, profile, shape, h, b, tw, tf } = editForm;
      await ifcApi.editColumn(modelId, guid, {
        width: Number(width),
        depth: Number(depth),
        height: Number(height),
        ...(profile && shape && h && b && tw && tf
          ? { profile, shape, h: Number(h), b: Number(b), tw: Number(tw), tf: Number(tf) }
          : {}),
      });
      setStatus("Pilar atualizado.");
      await refreshAfterEdit(guid);
    } catch (e) {
      fail(e);
    }
  };

  const applyBeamEdit = async () => {
    const guid = selectedRef.current?.guid;
    if (!guid) return;
    try {
      setBusy(true);
      const { width, depth, length, profile, shape, h, b, tw, tf } = editForm;
      await ifcApi.editBeam(modelId, guid, {
        width: Number(width),
        depth: Number(depth),
        length: Number(length),
        ...(profile && shape && h && b && tw && tf
          ? { profile, shape, h: Number(h), b: Number(b), tw: Number(tw), tf: Number(tf) }
          : {}),
      });
      setStatus("Viga atualizada.");
      await refreshAfterEdit(guid);
    } catch (e) {
      fail(e);
    }
  };

  const applyFootingEdit = async () => {
    const guid = selectedRef.current?.guid;
    if (!guid) return;
    try {
      setBusy(true);
      const baseWidth = Number(editForm.base_width);
      const baseLength = Number(editForm.base_length);
      await ifcApi.editFooting(modelId, guid, {
        base_width: baseWidth,
        base_length: baseLength,
        height: Number(editForm.height),
        top_width: Number(editForm.top_width) || baseWidth,
        top_length: Number(editForm.top_length) || baseLength,
        base_height: Number(editForm.base_height) || 0,
        ...(editUsePedestal
          ? {
              pedestal_width: Number(editForm.pedestal_width) || null,
              pedestal_length: Number(editForm.pedestal_length) || null,
              pedestal_height: Number(editForm.pedestal_height) || 0,
            }
          : { pedestal_height: 0 }),
        ...(editForm.pile_count
          ? {
              pile_count: Number(editForm.pile_count),
              ...(editForm.pile_diameter ? { pile_diameter: Number(editForm.pile_diameter) } : {}),
            }
          : {}),
      });
      setStatus("Fundação atualizada.");
      await refreshAfterEdit(guid);
    } catch (e) {
      fail(e);
    }
  };

  const applySlabEdit = async () => {
    const guid = selectedRef.current?.guid;
    if (!guid) return;
    try {
      setBusy(true);
      await ifcApi.editSlab(modelId, guid, { thickness: Number(editForm.thickness) });
      setStatus("Laje atualizada.");
      await refreshAfterEdit(guid);
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
      pushHistory(1);
    } catch (e) {
      fail(e);
    }
  };

  // rótulo pt-BR de cada papel de conexão — usado no aviso de apagar e no
  // painel de propriedades
  const ROLE_LABELS = {
    supports: "sustenta",
    supported_by: "apoiado em",
    crosses: "cruza com",
    bears_slab: "sustenta a laje",
    slab_bearing: "apoiado na laje",
  };

  const describeConnections = (list) =>
    list
      .map((c) => `${ROLE_LABELS[c.role] ?? c.role} ${c.name ?? c.type} (${c.guid.slice(0, 8)})`)
      .join("; ");

  const remove = async () => {
    const guid = selectedRef.current?.guid;
    if (!guid || !modelId) return;
    if (connections.length > 0) {
      const ok = window.confirm(
        `Este elemento tem ${connections.length} conexão(ões) física(s): ${describeConnections(connections)}. ` +
          `Apagar mesmo assim? (os elementos conectados não são apagados, só ficam sem essa conexão registrada)`
      );
      if (!ok) return;
    }
    try {
      setBusy(true);
      await ifcApi.deleteEntity(modelId, guid);
      transformRef.current?.detach();
      mgrRef.current?.removeProduct(guid);
      setSelected(null);
      setDetail(null);
      setConnections([]);
      await refreshLists(modelId);
      setStatus("Entidade removida.");
      setBusy(false);
      pushHistory(1);
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
    const id = modelIdRef.current;
    if (!id) {
      setStatus("O modelo ainda está sendo preparado. Tente novamente em instantes.");
      return;
    }
    try {
      setBusy(true);
      await ifcApi.createLevel(id, {
        name: newLevel.name || "Level",
        elevation: Number(newLevel.elevation),
      });
      await refreshDatums(id);
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
      await refreshMesh(modelId);
      await refreshLists(modelId);
      setStatus("Cota do nível e elementos vinculados atualizada.");
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
      await refreshMesh(modelId);
      await refreshLists(modelId);
      setStatus("Nível removido.");
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  const addGrid = async () => {
    const id = modelIdRef.current;
    if (!id) {
      setStatus("O modelo ainda está sendo preparado. Tente novamente em instantes.");
      return;
    }
    try {
      setBusy(true);
      const { nu, nv, spacing } = gridForm;
      const countU = Math.max(1, Math.floor(Number(nu) || 0));
      const countV = Math.max(1, Math.floor(Number(nv) || 0));
      const s = Number(spacing);
      if (!Number.isFinite(s) || s <= 0) {
        throw new Error("O espaçamento do grid deve ser maior que zero.");
      }
      const u = Array.from({ length: countU }, (_, i) => ({
        tag: String.fromCharCode(65 + i), // A, B, C…
        x: i * s,
      }));
      const v = Array.from({ length: countV }, (_, i) => ({
        tag: String(i + 1), // 1, 2, 3…
        y: i * s,
      }));
      await ifcApi.createGrid(id, { name: "Grid", u, v });
      await refreshDatums(id);
      datumRef.current?.setGridsVisible(true);
      setGridsVisible(true);
      canvasRef.current?.fitViewToModel?.();
      setStatus(`Grid ${countU}×${countV} criado. Selecione Pilar, Viga ou Laje e clique nas interseções.`);
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

  // ── ações do Navegador do Projeto ────────────────────────────────────────
  const storeCurrentCamera = () => {
    const state = canvasRef.current?.getActiveViewState?.();
    if (!state?.viewId || !state.camera) return;
    setViews((current) => current.map((view) =>
      view.id === state.viewId ? { ...view, camera: state.camera } : view
    ));
  };

  const openView = (viewId) => {
    if (!viewId || viewId === activeViewIdRef.current) return;
    storeCurrentCamera();
    const target = viewsRef.current.find((view) => view.id === viewId);
    if (target?.type !== VIEW_TYPES.PLAN && sketchToolRef.current) {
      setSketchTool(null);
      insertionRef.current?.cancel();
      setStatus("Ferramenta de modelagem encerrada ao sair da planta.");
    }
    if (target?.type === VIEW_TYPES.PLAN && target.levelId) {
      setActiveLevelGuid(target.levelId);
    }
    setActiveViewId(viewId);
    setStatus(`Vista “${target?.name ?? viewId}” aberta.`);
  };

  const setActiveLevelFromBrowser = (levelId) => {
    setActiveLevelGuid(levelId);
    const level = levelsRef.current.find((item) => item.guid === levelId);
    canvasRef.current?.setActiveLevel?.(level);
    setStatus(`Nível ativo: ${level?.name ?? levelId}.`);
  };

  const updateView = (viewId, patch) => {
    setViews((current) => current.map((view) =>
      view.id === viewId ? { ...view, ...patch } : view
    ));
  };

  const renameView = (viewId, name) => updateView(viewId, { name });

  const deleteView = (viewId) => {
    const target = viewsRef.current.find((view) => view.id === viewId);
    const isGenerated = target?.generated === true;
    if (isGenerated) {
      window.alert("Esta vista é gerada automaticamente. Duplique-a para criar uma versão editável.");
      return;
    }
    setViews((current) => {
      const remaining = current.filter((view) => view.id !== viewId);
      if (activeViewIdRef.current === viewId) {
        const fallback = remaining.find((view) => view.type === VIEW_TYPES.THREE_D) ?? remaining[0];
        setActiveViewId(fallback?.id ?? null);
      }
      return remaining;
    });
  };

  const duplicateView = (viewId) => {
    const source = viewsRef.current.find((view) => view.id === viewId);
    if (!source) return;
    const copy = {
      ...source,
      id: `${source.id}-copy-${Date.now().toString(36)}`,
      name: `${source.name} - Cópia`,
      generated: false,
      camera: source.camera ? { ...source.camera } : null,
      visibility: { ...(source.visibility ?? {}) },
      ...(source.viewRange ? { viewRange: { ...source.viewRange } } : {}),
      ...(source.cropBox ? { cropBox: { ...source.cropBox } } : {}),
    };
    setViews((current) => [...current, copy]);
    setActiveViewId(copy.id);
  };

  const createSection = () => {
    const name = window.prompt("Nome do corte:", nextSectionName(viewsRef.current));
    if (!name?.trim()) return;
    const axisInput = window.prompt(
      "Direção do corte: digite X para olhar no eixo X ou Y para olhar no eixo Y.",
      "X",
    );
    const axis = String(axisInput ?? "X").trim().toUpperCase() === "Y" ? "Y" : "X";
    const coord = Number(window.prompt(`Coordenada ${axis} do plano de corte (m):`, "0"));
    const depth = Math.max(0.1, Number(window.prompt("Profundidade do corte (m):", "30")) || 30);
    const activeLevelElevation = Number(activeInsertionLevel()?.elevation ?? 0);
    const origin = axis === "X"
      ? [Number.isFinite(coord) ? coord : 0, 0, activeLevelElevation]
      : [0, Number.isFinite(coord) ? coord : 0, activeLevelElevation];
    const direction = axis === "X" ? [1, 0, 0] : [0, 1, 0];
    const section = createSectionView({ name: name.trim(), origin, direction, farOffset: depth });
    setViews((current) => [...current, section]);
    setActiveViewId(section.id);
    setStatus(`Corte “${section.name}” criado.`);
  };

  // tecla Delete remove o selecionado (elemento ou cota)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Delete" || e.target.tagName === "INPUT") return;
      if (selectedDimensionRef.current) deleteMeasureDimension(selectedDimensionRef.current.guid);
      else if (selectedRef.current) remove();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  const isWall = selected?.type === "IfcWall";
  const isColumn = selected?.type === "IfcColumn";
  const isBeam = selected?.type === "IfcBeam";
  const isFooting = selected?.type === "IfcFooting";
  const isSlab = selected?.type === "IfcSlab";
  // true quando o Pset_ParametricSource existe (só então dá pra editar "em
  // vivo" — sem ele não há como reconstruir os parâmetros de criação)
  const hasEditParams = Boolean(detail?.psets?.Pset_ParametricSource);
  // estado do botão "3D": agora agregado de TODAS as ferramentas de planta
  // (Parede/Pilar/Viga/Fundação/Laje) — ver toggle3D acima.
  const all3DState = gatherAllSketch3DState();
  const anyPending = all3DState.some((t) => t.pending.length > 0);
  const anyConverted = all3DState.some((t) => t.converted.length > 0);
  const canConvert = anyPending || anyConverted;
  const is3DActive = anyConverted && !anyPending;
  // campo "altura 3D" da TopToolbar: parede usa wallHeight, pilar usa
  // columnHeight (as demais ferramentas já têm sua dimensão vertical no
  // formulário lateral — ver HEIGHT_FIELD_TOOLS em TopToolbar.jsx).
  const heightValue = sketchTool === "column" ? columnHeight : wallHeight;
  const onHeightChange = sketchTool === "column" ? setColumnHeight : setWallHeight;

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <>
      <TopToolbar
        sketchTool={sketchTool}
        onSelectTool={selectSketchTool}
        wallThickness={wallThickness}
        onThicknessChange={setWallThickness}
        heightValue={heightValue}
        onHeightChange={onHeightChange}
        onConvert3D={toggle3D}
        canConvert={canConvert || is3DActive}
        is3DActive={is3DActive}
        busy={busy}
        disabled={!modelId}
        onUndo={globalUndo}
        onRedo={globalRedo}
        canUndo={historyRef.current.past.length > 0}
        canRedo={historyRef.current.future.length > 0}
      />
      {dimensionsList.length > 0 && (
        <div
          style={{
            position: "fixed", top: 56, right: 12, zIndex: 20,
            background: "rgba(28,25,23,0.92)", color: "#fde68a",
            font: "12px monospace", padding: "8px 10px", borderRadius: 6,
            maxHeight: 220, overflowY: "auto", minWidth: 140,
          }}
        >
          <strong style={{ display: "block", marginBottom: 4 }}>Cotas ({dimensionsList.length})</strong>
          {dimensionsList.map((d) => (
            <div
              key={d.guid}
              onClick={() => selectDimension(d.guid)}
              style={{
                display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 4px",
                cursor: "pointer", borderRadius: 3,
                background: selectedDimension?.guid === d.guid ? "rgba(239,68,68,0.35)" : "transparent",
              }}
            >
              <span>{d.length.toFixed(2)} m</span>
              <button
                onClick={(ev) => {
                  ev.stopPropagation();
                  deleteMeasureDimension(d.guid);
                }}
                title="Apagar cota"
                style={{
                  background: "none", border: "none", color: "#fca5a5",
                  cursor: "pointer", font: "12px monospace", padding: 0,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <ProjectBrowser
        levels={levels}
        views={views}
        activeViewId={activeViewId}
        activeLevelId={activeLevelGuid}
        disabled={!modelId || busy}
        onOpenView={openView}
        onSetActiveLevel={setActiveLevelFromBrowser}
        onRenameView={renameView}
        onDeleteView={deleteView}
        onDuplicateView={duplicateView}
        onUpdateView={updateView}
        onCreateSection={createSection}
        onFitView={() => canvasRef.current?.fitViewToModel?.()}
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

          {/* pilar: seção (concreto ou catálogo de perfil metálico) + altura */}
          {isColumn && (
            <fieldset style={{ ...S.fs, marginTop: 6 }} disabled={busy}>
              <legend>Pilar — editar em vivo</legend>
              {!hasEditParams ? (
                <div style={S.hint}>
                  Elemento sem parâmetros de origem gravados (ex.: de um IFC
                  externo) — não é possível editar em vivo; recrie-o.
                </div>
              ) : (
                <>
                  <div style={S.row}>
                    <select
                      style={S.select}
                      value={editKind}
                      onChange={(e) => setEditKind(e.target.value)}
                    >
                      <option value="concrete">Concreto</option>
                      <option value="steel">Metálica</option>
                    </select>
                  </div>
                  {editKind === "concrete" ? (
                    <div style={S.row}>
                      {["width", "depth", "height"].map((k) => (
                        <label key={k} style={S.field}>
                          {k[0]}
                          <input
                            style={S.num}
                            type="number"
                            step="0.01"
                            value={editForm[k] ?? ""}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, [k]: e.target.value }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <>
                      <div style={S.row}>
                        <select
                          style={S.select}
                          value={editSteelFamily}
                          onChange={(e) => setEditSteelFamily(e.target.value)}
                        >
                          {STEEL_FAMILY_SELECT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {editSteelFamily === "custom" ? (
                        <div style={S.row}>
                          {["h", "b", "tw", "tf"].map((k) => (
                            <label key={k} style={S.field}>
                              {k}
                              <input
                                style={S.num}
                                type="number"
                                step="1"
                                value={editProfileCustom[k]}
                                onChange={(e) =>
                                  setEditProfileCustom((c) => ({ ...c, [k]: e.target.value }))
                                }
                              />
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div style={S.row}>
                          <select
                            style={S.select}
                            value={editSteelProfileValue}
                            onChange={(e) => setEditSteelProfileValue(e.target.value)}
                          >
                            {(STEEL_COLUMN_FAMILIES[editSteelFamily]?.profiles ?? []).map((p) => (
                              <option key={p.value} value={p.value}>
                                {p.value}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div style={S.row}>
                        <label style={S.field}>
                          h(m)
                          <input
                            style={S.num}
                            type="number"
                            step="0.1"
                            value={editForm.height ?? ""}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, height: e.target.value }))
                            }
                          />
                        </label>
                      </div>
                    </>
                  )}
                  <div style={S.row}>
                    <button style={S.btn} onClick={applyColumnEdit}>
                      Aplicar
                    </button>
                  </div>
                </>
              )}
            </fieldset>
          )}

          {/* viga: seção (concreto ou catálogo) + comprimento */}
          {isBeam && (
            <fieldset style={{ ...S.fs, marginTop: 6 }} disabled={busy}>
              <legend>Viga — editar em vivo</legend>
              {!hasEditParams ? (
                <div style={S.hint}>
                  Elemento sem parâmetros de origem gravados (ex.: de um IFC
                  externo) — não é possível editar em vivo; recrie-o.
                </div>
              ) : (
                <>
                  <div style={S.row}>
                    <select
                      style={S.select}
                      value={editKind}
                      onChange={(e) => setEditKind(e.target.value)}
                    >
                      <option value="concrete">Concreto</option>
                      <option value="steel">Metálica</option>
                    </select>
                  </div>
                  {editKind === "concrete" ? (
                    <div style={S.row}>
                      {["width", "depth", "length"].map((k) => (
                        <label key={k} style={S.field}>
                          {k[0]}
                          <input
                            style={S.num}
                            type="number"
                            step="0.01"
                            value={editForm[k] ?? ""}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, [k]: e.target.value }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <>
                      <div style={S.row}>
                        <select
                          style={S.select}
                          value={editSteelFamily}
                          onChange={(e) => setEditSteelFamily(e.target.value)}
                        >
                          {STEEL_BEAM_FAMILY_SELECT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {editSteelFamily === "custom" ? (
                        <div style={S.row}>
                          {["h", "b", "tw", "tf"].map((k) => (
                            <label key={k} style={S.field}>
                              {k}
                              <input
                                style={S.num}
                                type="number"
                                step="1"
                                value={editProfileCustom[k]}
                                onChange={(e) =>
                                  setEditProfileCustom((c) => ({ ...c, [k]: e.target.value }))
                                }
                              />
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div style={S.row}>
                          <select
                            style={S.select}
                            value={editSteelProfileValue}
                            onChange={(e) => setEditSteelProfileValue(e.target.value)}
                          >
                            {(STEEL_BEAM_FAMILIES[editSteelFamily]?.profiles ?? []).map((p) => (
                              <option key={p.value} value={p.value}>
                                {p.value}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div style={S.row}>
                        <label style={S.field}>
                          comp.(m)
                          <input
                            style={S.num}
                            type="number"
                            step="0.1"
                            value={editForm.length ?? ""}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, length: e.target.value }))
                            }
                          />
                        </label>
                      </div>
                    </>
                  )}
                  <div style={S.row}>
                    <button style={S.btn} onClick={applyBeamEdit}>
                      Aplicar
                    </button>
                  </div>
                </>
              )}
            </fieldset>
          )}

          {/* fundação: mesmos campos do formulário de inserção (base, topo,
              rodapé, pedestal, estacas); o tipo sapata/bloco não é editável
              aqui (fixo desde a criação) */}
          {isFooting && (
            <fieldset style={{ ...S.fs, marginTop: 6 }} disabled={busy}>
              <legend>Fundação — editar em vivo (m)</legend>
              {!hasEditParams ? (
                <div style={S.hint}>
                  Elemento sem parâmetros de origem gravados (ex.: de um IFC
                  externo) — não é possível editar em vivo; recrie-o.
                </div>
              ) : (
                <>
                  <div style={S.row}>
                    {["base_width", "base_length", "height"].map((k) => (
                      <label key={k} style={S.field}>
                        {k === "base_width" ? "bw" : k === "base_length" ? "bl" : "h"}
                        <input
                          style={S.num}
                          type="number"
                          step="0.05"
                          value={editForm[k] ?? ""}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, [k]: e.target.value }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <div style={S.row}>
                    {["top_width", "top_length", "base_height"].map((k) => (
                      <label key={k} style={S.field}>
                        {k === "top_width" ? "tw" : k === "top_length" ? "tl" : "rodapé"}
                        <input
                          style={S.num}
                          type="number"
                          step="0.05"
                          value={editForm[k] ?? ""}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, [k]: e.target.value }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <label style={S.fieldWide}>
                    <input
                      type="checkbox"
                      checked={editUsePedestal}
                      onChange={(e) => setEditUsePedestal(e.target.checked)}
                    />{" "}
                    pedestal
                  </label>
                  {editUsePedestal && (
                    <div style={S.row}>
                      {["pedestal_width", "pedestal_length", "pedestal_height"].map((k) => (
                        <label key={k} style={S.field}>
                          {k === "pedestal_width" ? "pw" : k === "pedestal_length" ? "pl" : "ph"}
                          <input
                            style={S.num}
                            type="number"
                            step="0.05"
                            value={editForm[k] ?? ""}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, [k]: e.target.value }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  {editForm.predefined_type === "PILE_CAP" && (
                    <div style={S.row}>
                      <label style={S.field}>
                        estacas
                        <input
                          style={S.num}
                          type="number"
                          step="1"
                          value={editForm.pile_count ?? ""}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, pile_count: e.target.value }))
                          }
                        />
                      </label>
                      <label style={S.field}>
                        Ø(m)
                        <input
                          style={S.num}
                          type="number"
                          step="0.05"
                          value={editForm.pile_diameter ?? ""}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, pile_diameter: e.target.value }))
                          }
                        />
                      </label>
                    </div>
                  )}
                  <div style={S.row}>
                    <button style={S.btn} onClick={applyFootingEdit}>
                      Aplicar
                    </button>
                  </div>
                </>
              )}
            </fieldset>
          )}

          {/* laje/radier: só a espessura é editável em vivo — o contorno em
              planta continua vindo do esboço 2D */}
          {isSlab && (
            <fieldset style={{ ...S.fs, marginTop: 6 }} disabled={busy}>
              <legend>Laje — editar espessura (m)</legend>
              {!hasEditParams ? (
                <div style={S.hint}>
                  Elemento sem parâmetros de origem gravados (ex.: de um IFC
                  externo) — não é possível editar em vivo; recrie-o.
                </div>
              ) : (
                <div style={S.row}>
                  <label style={S.field}>
                    e
                    <input
                      style={S.num}
                      type="number"
                      step="0.01"
                      value={editForm.thickness ?? ""}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, thickness: e.target.value }))
                      }
                    />
                  </label>
                  <button style={S.btn} onClick={applySlabEdit}>
                    Aplicar
                  </button>
                </div>
              )}
            </fieldset>
          )}

          <div style={S.hint}>
            Arraste o gizmo · Delete para apagar
          </div>
          {connections.length > 0 && (
            <div style={S.psets}>
              <strong>Conectividade física</strong>
              {connections.map((c) => (
                <div key={`${c.role}-${c.guid}`}>
                  · {ROLE_LABELS[c.role] ?? c.role}: {c.name ?? c.type} ({c.guid.slice(0, 8)})
                </div>
              ))}
            </div>
          )}
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
