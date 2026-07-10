import BaseElement from './BaseElement';
import * as THREE from 'three';

export default class Slab extends BaseElement {
  constructor(id, params = {}) {
    super(id);
    this.bimType = 'Slab';
    this._params = {
      contour: params.contour || [], // array of THREE.Vector3 in XY
      thickness: params.thickness || 0.2,
      baseLevelId: params.baseLevelId || null,
      material: params.material || { color: 0xaaaaaa },
      type: params.type || 'generic',
      ...params,
    };

    this.on('paramChanged', () => this.invalidateGeometry());
  }

  // Return area in square meters (project XY)
  computeArea() {
    const pts = this._params.contour || [];
    if (!pts || pts.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area) / 2;
  }

  geometryFactory(sceneHelpers = {}) {
    const contour = this._params.contour || [];
    if (contour.length < 3) return new THREE.Object3D();

    const thickness = Number(this._params.thickness) || 0.2;
    const lm = sceneHelpers.levelManager;
    let baseElev = 0;
    if (lm && this._params.baseLevelId) baseElev = lm.getElevation(this._params.baseLevelId) ?? 0;

    // Build shape in XY
    const shape = new THREE.Shape();
    shape.moveTo(contour[0].x, contour[0].y);
    for (let i = 1; i < contour.length; i++) shape.lineTo(contour[i].x, contour[i].y);
    shape.closePath();

    const extrudeSettings = { depth: thickness, bevelEnabled: false, steps: 1 };
    const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    const mat = new THREE.MeshStandardMaterial(this._params.material || { color: 0xaaaaaa });
    const mesh = new THREE.Mesh(geom, mat);

    // Position: extrude starts at z=0; move it to base elevation
    mesh.position.z = baseElev;
    mesh.userData = { id: this.id, params: this.params };
    return mesh;
  }

  planRepresentation() {
    const group = new THREE.Group();
    const contour = this._params.contour || [];
    if (contour.length < 2) return group;
    const pts = contour.map((p) => p.clone());
    // ensure closed
    if (!pts[0].equals(pts[pts.length - 1])) pts.push(pts[0].clone());
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x333333 });
    const line = new THREE.Line(geom, mat);
    group.add(line);

    // area label
    const area = this.computeArea();
    const text = `${area.toFixed(2)} m²`;
    const sprite = Slab._makeTextSprite(text);
    // center
    let cx = 0,
      cy = 0;
    for (const p of contour) {
      cx += p.x;
      cy += p.y;
    }
    cx /= contour.length;
    cy /= contour.length;
    sprite.position.set(cx, cy, 0.02);
    group.add(sprite);
    group.userData = { elementId: this.id };
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
    ctx.font = '22px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 8);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.6, 0.45, 1);
    return sprite;
  }
}
