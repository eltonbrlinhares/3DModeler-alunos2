/**
 * src/ifc/insertion/InsertionController.js
 *
 * Dono dos EVENTOS de inserção. É o único lugar que escuta pointer/teclado para
 * criar geometria; ele roteia cada evento para a FERRAMENTA ativa (src/ifc/tools)
 * através de um CONTEXTO (ver types.js). Também garante que o viewport (orbit +
 * cursor) sempre seja devolvido ao concluir, cancelar ou falhar.
 *
 * O aluno normalmente NÃO mexe aqui — ele escreve uma ferramenta nova em
 * src/ifc/tools/ e a registra. Este arquivo é o "motor".
 *
 * Dependências (injetadas pelo IfcPanel, todas como getters para ler sempre o
 * valor atual dos refs do React):
 *   api, getScene, getCamera, getDom, getOrbit, getGrids, getLevels,
 *   getActiveLevel, getForm, getModelId, getElementsCount, getManager,
 *   firstStorey, refreshLists, setStatus, setBusy, setInsertMode, onError,
 *   onHistoryPush (opcional — notifica o desfazer/refazer global após um commit)
 */
import { PreviewLayer } from "./PreviewLayer.js";
import { WALL_HEIGHT_PIXEL_SCALE } from "./constants.js";
import {
  lockedLevelCopy,
  snapPointOnGridLevel,
  eventPointOnLevel,
  snappedWallHeight,
  gridLevelIntersections,
} from "./snapping.js";
import { INSERTION_TOOLS } from "../tools/index.js";

export class InsertionController {
  constructor(deps) {
    this.deps = deps;
    this.preview = new PreviewLayer(deps.getScene());
    this.ctx = null;
    this.active = false;
    this.submitting = false;
  }

  // ── ciclo de vida dos listeners ───────────────────────────────────────────
  attach() {
    const dom = this.deps.getDom();
    this._onDown = (ev) => this.handlePointerDown(ev);
    this._onMove = (ev) => this.handlePointerMove(ev);
    this._onDbl = (ev) => this.handleDoubleClick(ev);
    this._onKey = (ev) => this.handleKey(ev);
    dom.addEventListener("pointerdown", this._onDown);
    dom.addEventListener("pointermove", this._onMove);
    dom.addEventListener("dblclick", this._onDbl);
    window.addEventListener("keydown", this._onKey);
  }

  detach() {
    const dom = this.deps.getDom();
    if (dom) {
      dom.removeEventListener("pointerdown", this._onDown);
      dom.removeEventListener("pointermove", this._onMove);
      dom.removeEventListener("dblclick", this._onDbl);
    }
    window.removeEventListener("keydown", this._onKey);
  }

  dispose() {
    this.detach();
    this.end();
  }

  // ── começar / cancelar ────────────────────────────────────────────────────
  begin(toolId) {
    if (!this.deps.getModelId()) return;
    const tool = INSERTION_TOOLS[toolId];
    if (!tool) return;
    this.end(); // limpa qualquer inserção anterior
    const level = lockedLevelCopy(this.deps.getActiveLevel());
    const need = tool.minIntersections ?? 0;
    if (need > 0) {
      const count = this._snapPointsOnLevel(level).length;
      if (count < need) {
        this.deps.setStatus(
          `${tool.label}: crie níveis e grid U/V para usar as interseções de planos como snap.`
        );
        return;
      }
    }
    this.ctx = this._makeContext(tool, level);
    this.active = true;
    const orbit = this.deps.getOrbit();
    if (orbit) orbit.enabled = false;
    const dom = this.deps.getDom();
    if (dom) dom.style.cursor = "crosshair";
    this.deps.setInsertMode(toolId);
    const msg = tool.start?.(this.ctx);
    if (msg) this.deps.setStatus(msg);
  }

  cancel(message = "Inserção cancelada.") {
    this.end();
    this.deps.setStatus(message);
  }

  /** Limpa preview/estado e DEVOLVE o viewport (nunca deixa o mouse travado). */
  end() {
    this.preview.clear();
    this.ctx = null;
    this.active = false;
    this.submitting = false;
    const orbit = this.deps.getOrbit();
    if (orbit) orbit.enabled = true;
    const dom = this.deps.getDom();
    if (dom) dom.style.cursor = "";
    this.deps.setInsertMode(null);
  }

  // ── roteamento de eventos para a ferramenta ───────────────────────────────
  handlePointerDown(ev) {
    if (!this.active || !this.ctx) return;
    ev.preventDefault?.();
    ev.stopPropagation?.();
    this.ctx.form = this.deps.getForm();
    this.ctx.tool.onPointerDown?.(this.ctx, ev);
  }

  handlePointerMove(ev) {
    if (!this.active || !this.ctx) return;
    this.ctx.form = this.deps.getForm();
    this.ctx.tool.onPointerMove?.(this.ctx, ev);
  }

  handleKey(ev) {
    if (!this.active || !this.ctx) return;
    if (ev.key === "Escape") {
      this.cancel();
      return;
    }
    this.ctx.form = this.deps.getForm();
    this.ctx.tool.onKey?.(this.ctx, ev.key, ev);
  }

  handleDoubleClick(ev) {
    if (!this.active || !this.ctx) return;
    this.ctx.form = this.deps.getForm();
    this.ctx.tool.onDoubleClick?.(this.ctx, ev);
  }

  // ── criação no backend (centralizada) ─────────────────────────────────────
  async commit(apiFn, payload, label) {
    if (this.submitting) return;
    this.submitting = true;
    const d = this.deps;
    try {
      d.setBusy(true);
      d.setStatus(`Criando ${label.toLowerCase()}…`);
      const id = d.getModelId();
      const storey = payload.storey_guid ?? (await d.firstStorey(id));
      const { guid } = await apiFn(id, { ...payload, storey_guid: storey });
      d.getManager()?.replaceProduct(await d.api.productMesh(id, guid));
      d.onSceneChanged?.();
      await d.refreshLists(id);
      this.end();
      d.setStatus(`${label} ${guid.slice(0, 8)} criado(a).`);
      d.setBusy(false);
      d.onHistoryPush?.(1);
    } catch (e) {
      this.end(); // mesmo em erro, devolve o viewport
      d.onError(e);
    }
  }

  // ── contexto entregue à ferramenta ────────────────────────────────────────
  _makeContext(tool, level) {
    const d = this.deps;
    const ctx = {
      tool,
      level,
      phase: null,
      api: d.api,
      preview: this.preview,
      form: d.getForm(),
      setStatus: (m) => d.setStatus(m),
      cancel: (m) => this.cancel(m),
      nextName: () => `${tool.prefix}${d.getElementsCount() + 1}`,
      snapToGrid: (ev) =>
        snapPointOnGridLevel(ev, level, {
          camera: d.getCamera(),
          dom: d.getDom(),
          grids: d.getGrids(),
          datumPoints: this._snapPointsOnLevel(level),
        }),
      pointOnLevel: (ev) =>
        eventPointOnLevel(ev, level.elevation ?? 0, {
          camera: d.getCamera(),
          dom: d.getDom(),
        }),
      snapHeight: (raw) => snappedWallHeight(d.getLevels(), level, raw),
      commit: (apiFn, payload, label) => this.commit(apiFn, payload, label),
    };
    // altura corrente a partir do arraste vertical (parede/pilar)
    ctx.dragHeight = (ev) =>
      (Number(ctx.form?.height) || 3) +
      (ctx.heightStartY - ev.clientY) * WALL_HEIGHT_PIXEL_SCALE;
    return ctx;
  }

  _snapPointsOnLevel(level) {
    const datumPoints = this.deps
      .getDatumManager?.()
      ?.getIntersectionPoints?.({ level });
    return datumPoints?.length
      ? datumPoints
      : gridLevelIntersections(this.deps.getGrids(), level);
  }
}
