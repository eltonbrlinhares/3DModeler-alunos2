import BaseElement from './BaseElement';
import * as THREE from 'three';

export default class Dimension extends BaseElement {
  constructor(id, params = {}) {
    super(id);
    this.bimType = 'Dimension';
    this._params = {
      ownerId: params.ownerId || null,
      startPoint: params.startPoint || new THREE.Vector3(0, 0, 0),
      endPoint: params.endPoint || new THREE.Vector3(1, 0, 0),
      label: params.label || null,
      // visibility in plan/3d
      showInPlan: true,
      showIn3D: false,
      ...params,
    };
  }

  // compute linear distance in meters
  valueMeters() {
    const p0 = this._params.startPoint;
    const p1 = this._params.endPoint;
    if (!p0 || !p1) return 0;
    return p0.distanceTo(p1);
  }

  // Accept user input; if the number is large (>1000) treat as millimeters
  setValueFromInput(numeric) {
    let v = Number(numeric);
    if (Number.isNaN(v)) return;
    let meters = v;
    if (v > 1000) meters = v / 1000.0;
    this._params.manualValue = meters;
    this._emitter.emit('paramChanged', { id: this.id, key: 'manualValue', value: meters, old: undefined });
    this._emitter.emit('changed', { id: this.id });
  }

  // when manualValue exists, effective value is manualValue, else computed
  effectiveValueMeters() {
    if (typeof this._params.manualValue === 'number') return this._params.manualValue;
    return this.valueMeters();
  }

  // Visual representation for plan: line + dimension sprite
  planRepresentation() {
    const p0 = this._params.startPoint;
    const p1 = this._params.endPoint;
    const group = new THREE.Group();
    if (!p0 || !p1) return group;
    const points = [p0.clone(), p1.clone()];
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0x000000 });
    const line = new THREE.Line(geom, mat);
    group.add(line);

    // center label as sprite
    const center = p0.clone().add(p1).multiplyScalar(0.5);
    const val = this.effectiveValueMeters();
    const text = `${(val).toFixed(2)} m`;
    const sprite = Dimension._makeTextSprite(text);
    sprite.position.copy(center);
    sprite.position.z += 0.02;
    group.add(sprite);

    group.userData = { dimensionId: this.id, ownerId: this._params.ownerId };
    return group;
  }

  static _makeTextSprite(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black';
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 8);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.6, 0.45, 1);
    return sprite;
  }
}
