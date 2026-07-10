import BaseElement from './BaseElement';
import * as THREE from 'three';

export default class Wall extends BaseElement {
  constructor(id, params = {}) {
    super(id);
    this.bimType = 'Wall';
    this._params = {
      startPoint: new THREE.Vector3(0, 0, 0),
      endPoint: new THREE.Vector3(1, 0, 0),
      thickness: 0.2,
      // reference levels by id
      baseLevelId: null,
      topLevelId: null,
      material: { color: 0x999999 },
      type: 'generic',
      ...params,
    };

    this._mesh = null;
    this.on('paramChanged', (evt) => this._onParamChanged(evt));
  }

  _rebuildGeometry() {
    // Notify manager/renderer to rebuild geometry
    this.invalidateGeometry();
  }

  _onParamChanged(evt) {
    // react to length edits: when user changes 'length', update endPoint along current direction
    const { key, value } = evt || {};
    if (key === 'length') {
      const p0 = this._params.startPoint;
      const p1 = this._params.endPoint;
      const dir = new THREE.Vector3().subVectors(p1, p0);
      if (dir.length() < 1e-6) {
        // no direction yet; ignore
        this._rebuildGeometry();
        return;
      }
      dir.normalize();
      const newEnd = p0.clone().add(dir.multiplyScalar(Number(value)));
      // set internally without emitting paramChanged again
      this._params.endPoint = newEnd;
      this._rebuildGeometry();
      return;
    }

    // when startPoint or endPoint change, update computed length silently
    if (key === 'startPoint' || key === 'endPoint') {
      const p0 = this._params.startPoint;
      const p1 = this._params.endPoint;
      if (p0 && p1) {
        const len = p0.distanceTo(p1);
        // store computed length without triggering another paramChanged
        this._params.length = len;
      }
    }

    this._rebuildGeometry();
  }

  geometryFactory(sceneHelpers = {}) {
    // build a simple extruded wall geometry from params
    const p0 = this._params.startPoint;
    const p1 = this._params.endPoint;
    const thickness = Number(this._params.thickness) || 0.2;
    // determine elevations from level manager when available
    let baseElev = 0;
    let topElev = null;
    const lm = sceneHelpers.levelManager;
    if (lm) {
      if (this._params.baseLevelId) {
        const be = lm.getElevation(this._params.baseLevelId);
        if (be !== null) baseElev = be;
      }
      if (this._params.topLevelId) {
        const te = lm.getElevation(this._params.topLevelId);
        if (te !== null) topElev = te;
      }
    }
    // fallback to numeric topLevel param if present
    if (topElev === null && typeof this._params.topLevel === 'number') topElev = this._params.topLevel;
    if (topElev === null) topElev = baseElev + 3.0;
    const height = Math.max(0.0, Number(topElev) - Number(baseElev));

    const dir = new THREE.Vector3().subVectors(p1, p0);
    const length = dir.length();
    if (length < 1e-6) return new THREE.Object3D();
    dir.normalize();
    const up = new THREE.Vector3(0, 0, 1);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();

    // Create a box geometry aligned along X (length) and Z (height)
    const geom = new THREE.BoxGeometry(length, thickness, height);
    const mat = new THREE.MeshStandardMaterial(this._params.material || { color: 0x999999 });
    const mesh = new THREE.Mesh(geom, mat);

    // position: center between p0 and p1, Y offset by thickness/2, Z by height/2
    const center = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
    const offset = right.clone().multiplyScalar(thickness / 2);
    mesh.position.copy(center);
    mesh.position.add(offset);
    mesh.position.z = height / 2 + baseElev;

    // rotate to align with direction
    const angle = Math.atan2(dir.y, dir.x);
    mesh.rotation.z = angle;

    // userData holds reference to element id and params
    mesh.userData.bim = { id: this.id, params: this.params };
    return mesh;
  }

  // Return a 2D-plan representation group: two parallel lines and a dimension sprite
  planRepresentation() {
    const group = new THREE.Group();
    const p0 = this._params.startPoint;
    const p1 = this._params.endPoint;
    const thickness = Number(this._params.thickness) || 0.2;
    const dir = new THREE.Vector3().subVectors(p1, p0);
    const length = dir.length();
    if (length < 1e-6) return group;
    dir.normalize();
    const up = new THREE.Vector3(0, 0, 1);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();

    // two parallel lines along direction, separated by thickness
    const half = thickness / 2;
    const a0 = p0.clone().add(right.clone().multiplyScalar(half));
    const a1 = p1.clone().add(right.clone().multiplyScalar(half));
    const b0 = p0.clone().add(right.clone().multiplyScalar(-half));
    const b1 = p1.clone().add(right.clone().multiplyScalar(-half));

    const geomA = new THREE.BufferGeometry().setFromPoints([a0, a1]);
    const geomB = new THREE.BufferGeometry().setFromPoints([b0, b1]);
    const mat = new THREE.LineBasicMaterial({ color: 0x333333 });
    const lineA = new THREE.Line(geomA, mat);
    const lineB = new THREE.Line(geomB, mat);
    group.add(lineA, lineB);

    // dimension: sprite with length text centered
    const text = `${(length).toFixed(2)} m`;
    const sprite = Wall._makeTextSprite(text);
    const center = p0.clone().add(p1).multiplyScalar(0.5);
    sprite.position.copy(center);
    // offset slightly upward in Z so it renders above plan
    sprite.position.z += 0.01;
    group.add(sprite);

    group.userData = { elementId: this.id };
    return group;
  }

  static _makeTextSprite(text) {
    const canvas = document.createElement('canvas');
    const size = 256;
    canvas.width = size;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black';
    ctx.font = '28px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 8);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.5, 0.4, 1);
    return sprite;
  }
}
