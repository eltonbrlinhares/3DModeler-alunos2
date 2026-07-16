/**
 * src/ifc/DimensionManager.js
 *
 * Desenha as cotas manuais ponto-a-ponto (linha + marcas de extremidade +
 * rótulo de texto) na cena. Independente do `IfcSceneManager` (produtos
 * IFC) e do `IfcDatumManager` (níveis/grid) — mesmo padrão de
 * auto-registro na cena que o `IfcDatumManager` já usa, então não precisa
 * mexer no `ThreeCanvas.jsx` pra existir.
 *
 * Uso:
 *   const dims = new DimensionManager(scene);
 *   dims.set(guid, p0Vector3, p1Vector3, "5.00");   // cria/atualiza
 *   dims.remove(guid);                              // remove uma
 *   dims.setPreview(p0Vector3, p1Vector3, "5.00");  // linha "de arrasto" enquanto mira o 2º ponto
 *   dims.clearPreview();
 *   dims.pick(raycaster);                           // -> guid | null (seleção por clique)
 *   dims.setSelected(guid);                         // destaca (ou null pra limpar)
 *   dims.dispose();
 */
import * as THREE from "three";

const NEVER_RAYCAST = () => {}; // rótulo/prévia não devem ser "clicáveis"
const COLOR = 0xf59e0b; // âmbar — bem diferente das cores de produto/datum já usadas
const COLOR_SELECTED = 0xef4444; // vermelho — mesmo padrão de destaque de seleção do resto do app
const TICK = 0.15;
const LABEL_OFFSET = 0.25;
// espessura "de acerto" da linha invisível usada só pra raycast — bem mais
// generosa que o traço visível (1px), pra não exigir acerto de pixel.
const HIT_RADIUS = 0.12;

export class DimensionManager {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "ifc-dimensions";
    scene.add(this.group);

    this.items = new Map(); // guid -> { group, hitMesh, lines }
    this._preview = null; // THREE.Group | null
    this._selectedGuid = null;
  }

  _label(text) {
    const pad = 10;
    const fontPx = 40;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
    const tw = Math.ceil(ctx.measureText(text).width);
    canvas.width = tw + pad * 2;
    canvas.height = fontPx + pad;

    const c = canvas.getContext("2d");
    c.fillStyle = "rgba(245,158,11,0.9)";
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = "#1c1917";
    c.font = `bold ${fontPx}px system-ui, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, canvas.width / 2, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    const aspect = canvas.width / canvas.height;
    const scale = 0.4;
    sprite.scale.set(scale * aspect, scale, 1);
    sprite.renderOrder = 999;
    sprite.raycast = NEVER_RAYCAST;
    return sprite;
  }

  _line(points, dashed, color) {
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.15, gapSize: 0.1, depthTest: false })
      : new THREE.LineBasicMaterial({ color, depthTest: false });
    const line = new THREE.Line(geom, mat);
    if (dashed) line.computeLineDistances();
    line.renderOrder = 998;
    line.raycast = NEVER_RAYCAST; // quem responde ao clique é o `hitMesh` (cilindro invisível), não o traço fino
    return line;
  }

  /** Cilindro fino e invisível ao longo de p0-p1 — só pra dar uma área de
   * acerto generosa ao raycast (uma `THREE.Line` de 1px é frustrante de
   * clicar). Guarda `guid` no userData pra `pick()` identificar a cota. */
  _hitMesh(p0, p1, guid) {
    const dir = new THREE.Vector3().subVectors(p1, p0);
    const length = dir.length();
    if (length < 1e-6) return null;
    const geom = new THREE.CylinderGeometry(HIT_RADIUS, HIT_RADIUS, length, 6, 1, true);
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const mesh = new THREE.Mesh(geom, mat);
    // CylinderGeometry nasce alinhado ao eixo Y local — rotaciona pra alinhar com p0->p1
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    mesh.position.copy(mid);
    const axis = dir.clone().normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    mesh.userData.dimensionGuid = guid;
    return mesh;
  }

  /** Monta o grupo visual (linha principal + 2 marcas + rótulo + hit-mesh) entre p0/p1. */
  _build(p0, p1, label, { dashed = false, guid = null, selected = false } = {}) {
    const g = new THREE.Group();
    const dir = new THREE.Vector3().subVectors(p1, p0);
    if (dir.lengthSq() < 1e-9) return { group: g, hitMesh: null };
    dir.normalize();
    // perpendicular simples (prioriza o plano XY; cai pra outro eixo se a
    // cota for quase vertical) -- só precisa "parecer" uma marca de
    // extremidade, não representar o plano exato da vista
    let perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1));
    if (perp.lengthSq() < 1e-6) perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(1, 0, 0));
    perp.normalize().multiplyScalar(TICK);

    const color = selected ? COLOR_SELECTED : COLOR;
    g.add(this._line([p0, p1], dashed, color));
    g.add(this._line([p0.clone().sub(perp), p0.clone().add(perp)], dashed, color));
    g.add(this._line([p1.clone().sub(perp), p1.clone().add(perp)], dashed, color));

    if (label) {
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      mid.addScaledVector(perp.clone().normalize(), LABEL_OFFSET);
      const sprite = this._label(label);
      sprite.position.copy(mid);
      g.add(sprite);
    }

    let hitMesh = null;
    if (guid) {
      hitMesh = this._hitMesh(p0, p1, guid);
      if (hitMesh) g.add(hitMesh);
    }
    return { group: g, hitMesh };
  }

  /** Cria (ou substitui) a cota `guid`, entre p0/p1 (THREE.Vector3, mundo). */
  set(guid, p0, p1, label) {
    const wasSelected = this._selectedGuid === guid;
    this.remove(guid);
    const { group, hitMesh } = this._build(p0, p1, label, { guid, selected: wasSelected });
    this.items.set(guid, { group, hitMesh, p0: p0.clone(), p1: p1.clone(), label });
    this.group.add(group);
  }

  remove(guid) {
    const item = this.items.get(guid);
    if (!item) return;
    this.group.remove(item.group);
    item.group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.map?.dispose?.();
      o.material?.dispose?.();
    });
    this.items.delete(guid);
    if (this._selectedGuid === guid) this._selectedGuid = null;
  }

  /** Resolve a primeira interseção de um raycaster para um guid de cota (ou
   * null) — mesmo padrão de `IfcSceneManager.pick`. */
  pick(raycaster) {
    const meshes = [...this.items.values()].map((i) => i.hitMesh).filter(Boolean);
    if (!meshes.length) return null;
    const hits = raycaster.intersectObjects(meshes, false);
    return hits.length ? hits[0].object.userData.dimensionGuid : null;
  }

  /** Destaca a cota `guid` (ou limpa o destaque se `null`) — redesenha só
   * a cota afetada (anterior e nova), sem recriar as outras. */
  setSelected(guid) {
    const prev = this._selectedGuid;
    if (prev === guid) return;
    this._selectedGuid = guid;
    for (const g of [prev, guid]) {
      if (!g) continue;
      const item = this.items.get(g);
      if (item) this.set(g, item.p0, item.p1, item.label);
    }
  }

  /** Linha tracejada "de mira" enquanto o usuário aponta o 2º ponto — nunca
   * persistida, só feedback visual da ferramenta ativa. */
  setPreview(p0, p1, label) {
    this.clearPreview();
    const { group } = this._build(p0, p1, label, { dashed: true });
    this._preview = group;
    this.group.add(this._preview);
  }

  clearPreview() {
    if (!this._preview) return;
    this.group.remove(this._preview);
    this._preview.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.map?.dispose?.();
      o.material?.dispose?.();
    });
    this._preview = null;
  }

  setVisible(v) {
    this.group.visible = v;
  }

  dispose() {
    this.clearPreview();
    [...this.items.keys()].forEach((guid) => this.remove(guid));
    this.scene.remove(this.group);
  }
}
