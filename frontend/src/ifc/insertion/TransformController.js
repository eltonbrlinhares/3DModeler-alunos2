/**
 * src/ifc/insertion/TransformController.js
 *
 * Gizmo de edicao IFC. Usa dois TransformControls no mesmo elemento, como o
 * plano de trabalho: translacao e rotacao ficam visiveis juntas e operam no
 * espaco local do elemento selecionado.
 */
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

export class TransformController {
  constructor({ camera, dom, scene, orbit, getManager, onCommit }) {
    this.scene = scene;
    this._dragStart = null;
    this._activeKind = null;

    this.translate = new TransformControls(camera, dom);
    this.translate.setMode("translate");
    this.translate.setSpace("local");
    this.translate.enabled = false;
    scene.add(this.translate.getHelper());

    this.rotate = new TransformControls(camera, dom);
    this.rotate.setMode("rotate");
    this.rotate.setSpace("local");
    this.rotate.enabled = false;
    scene.add(this.rotate.getHelper());

    this._onTranslateDraggingChanged = (e) =>
      this._handleDraggingChanged("translate", e, orbit, onCommit);
    this._onRotateDraggingChanged = (e) =>
      this._handleDraggingChanged("rotate", e, orbit, onCommit);
    this.translate.addEventListener(
      "dragging-changed",
      this._onTranslateDraggingChanged
    );
    this.rotate.addEventListener("dragging-changed", this._onRotateDraggingChanged);

    this._onObjectChange = () => this._syncEdges(getManager);
    this.translate.addEventListener("objectChange", this._onObjectChange);
    this.rotate.addEventListener("objectChange", this._onObjectChange);
  }

  get dragging() {
    return this.translate.dragging || this.rotate.dragging;
  }

  get object() {
    return this.translate.object ?? this.rotate.object;
  }

  // Mantido para chamadas antigas; os dois controles ficam sempre ativos juntos.
  setMode() {
    this.translate.setSpace("local");
    this.rotate.setSpace("local");
  }

  setTranslationSnap(value) {
    this.translate.setTranslationSnap(value > 0 ? value : null);
  }

  setRotationSnap(degrees) {
    this.rotate.setRotationSnap(
      degrees > 0 ? THREE.MathUtils.degToRad(degrees) : null
    );
  }

  attach(mesh) {
    this.translate.attach(mesh);
    this.rotate.attach(mesh);
    this.translate.enabled = true;
    this.rotate.enabled = true;
  }

  detach() {
    this.translate.detach();
    this.rotate.detach();
    this.translate.enabled = false;
    this.rotate.enabled = false;
    this._dragStart = null;
    this._activeKind = null;
  }

  dispose() {
    this.translate.removeEventListener(
      "dragging-changed",
      this._onTranslateDraggingChanged
    );
    this.rotate.removeEventListener(
      "dragging-changed",
      this._onRotateDraggingChanged
    );
    this.translate.removeEventListener("objectChange", this._onObjectChange);
    this.rotate.removeEventListener("objectChange", this._onObjectChange);
    this.detach();
    this.scene.remove(this.translate.getHelper());
    this.scene.remove(this.rotate.getHelper());
    this.translate.dispose();
    this.rotate.dispose();
  }

  _handleDraggingChanged(kind, e, orbit, onCommit) {
    const active = kind === "translate" ? this.translate : this.rotate;
    const other = kind === "translate" ? this.rotate : this.translate;
    const mesh = active.object;
    if (!mesh) return;

    if (e.value) {
      orbit.enabled = false;
      other.enabled = false;
      this._activeKind = kind;
      this._dragStart = {
        pos: mesh.position.clone(),
        quaternion: mesh.quaternion.clone(),
      };
      return;
    }

    orbit.enabled = true;
    other.enabled = Boolean(active.object);

    const start = this._dragStart;
    if (!start || this._activeKind !== kind) return;

    if (kind === "translate") {
      const delta = mesh.position.clone().sub(start.pos);
      if (delta.lengthSq() > 1e-12) {
        onCommit(mesh, { translate: [delta.x, delta.y, delta.z] });
      }
    } else {
      const deltaQuat = mesh.quaternion
        .clone()
        .multiply(start.quaternion.clone().invert())
        .normalize();
      const angle = 2 * Math.acos(Math.min(1, Math.abs(deltaQuat.w)));
      if (angle > 1e-5) {
        onCommit(mesh, {
          rotation_matrix: rotationMatrixRows(deltaQuat),
          rotation_center: [start.pos.x, start.pos.y, start.pos.z],
        });
      }
    }

    this._dragStart = null;
    this._activeKind = null;
  }

  _syncEdges(getManager) {
    const mesh = this.object;
    const item = mesh && getManager()?.items.get(mesh.userData.ifc?.guid);
    if (!item) return;
    item.edges.position.copy(mesh.position);
    item.edges.rotation.copy(mesh.rotation);
    item.edges.scale.copy(mesh.scale);
  }
}

function rotationMatrixRows(quaternion) {
  const e = new THREE.Matrix4().makeRotationFromQuaternion(quaternion).elements;
  return [
    e[0],
    e[4],
    e[8],
    e[1],
    e[5],
    e[9],
    e[2],
    e[6],
    e[10],
  ];
}
