import Wall from './Wall';
import LevelManager from './LevelManager';
import Dimension from './Dimension';
import Column from './Column';
import Slab from './Slab';

let _idCounter = 1;
function _nextId() {
  return `elem-${Date.now().toString(36)}-${(_idCounter++).toString(36)}`;
}

export default class ElementManager {
  constructor(levelManager = null) {
    this.elements = new Map();
    this.listeners = [];
    this.levelManager = levelManager || new LevelManager();

    // Listen for level changes and invalidate elements that reference affected level
    this.levelManager.on('levelChanged', ({ id, old, elevation }) => this._onLevelChanged(id, elevation));
  }

  // Dimensions map
  _dimensions = new Map();

  createDimension(params = {}) {
    const id = _nextId();
    const dim = new Dimension(id, params);
    this._dimensions.set(id, dim);
    // when dimension changes, propagate to owner element (e.g., wall length)
    dim.on('changed', () => {
      try {
        const owner = this.getElement(dim.params.ownerId);
        if (owner && owner.bimType === 'Wall') {
          // set wall length in meters
          const meters = dim.effectiveValueMeters();
          owner.setParam('length', meters);
        }
        this._emit('dimensionChanged', { id: dim.id });
      } catch (e) {}
    });
    this._emit('dimensionAdded', { id, ownerId: params.ownerId });
    return dim;
  }

  getDimension(id) {
    return this._dimensions.get(id) || null;
  }

  getAllDimensions() {
    return Array.from(this._dimensions.values());
  }

  createWall(params = {}) {
    const id = _nextId();
    // ensure base/top level ids exist
    const defaults = this.levelManager.getDefaultLevelIds();
    const p = Object.assign({ baseLevelId: defaults.base, topLevelId: defaults.top }, params);
    const wall = new Wall(id, p);
    this.elements.set(id, wall);
    wall.on('geometryInvalidated', (e) => this._emit('geometryInvalidated', e));
    this._emit('elementAdded', { id, type: 'Wall' });
    // create an associated dimension object for the wall in plan
    try {
      const dim = this.createDimension({ ownerId: id, startPoint: wall.params.startPoint, endPoint: wall.params.endPoint });
      // keep a reference on the wall for convenience
      wall._dimensionId = dim.id;
    } catch (e) {}
    return wall;
  }

  createColumn(params = {}) {
    const id = _nextId();
    const defaults = this.levelManager.getDefaultLevelIds();
    const p = Object.assign({ baseLevelId: defaults.base, topLevelId: defaults.top }, params);
    const col = new Column(id, p);
    this.elements.set(id, col);
    col.on('geometryInvalidated', (e) => this._emit('geometryInvalidated', e));
    this._emit('elementAdded', { id, type: 'Column' });
    return col;
  }

  createSlab(params = {}) {
    const id = _nextId();
    const defaults = this.levelManager.getDefaultLevelIds();
    const p = Object.assign({ baseLevelId: defaults.base, thickness: 0.2 }, params);
    const slab = new Slab(id, p);
    this.elements.set(id, slab);
    slab.on('geometryInvalidated', (e) => this._emit('geometryInvalidated', e));
    this._emit('elementAdded', { id, type: 'Slab' });
    return slab;
  }

  getElement(id) {
    return this.elements.get(id);
  }

  getAllElements() {
    return Array.from(this.elements.values());
  }

  _onLevelChanged(levelId, elevation) {
    for (const elem of this.elements.values()) {
      const params = elem.params;
      if (!params) continue;
      if (params.baseLevelId === levelId || params.topLevelId === levelId) {
        // notify element to recompute geometry
        try { elem.invalidateGeometry(); } catch (e) { /* ignore */ }
        this._emit('elementUpdatedByLevel', { id: elem.id, levelId, elevation });
      }
    }
  }

  // Find closest element by center point within maxDist (in world units)
  findClosest(point, maxDist = 1.0) {
    let best = null;
    let bestD = Infinity;
    for (const elem of this.elements.values()) {
      try {
        const p = elem.params.startPoint && elem.params.endPoint
          ? elem.params.startPoint.clone().add(elem.params.endPoint).multiplyScalar(0.5)
          : null;
        if (!p) continue;
        const d = p.distanceTo(point);
        if (d < bestD && d <= maxDist) {
          bestD = d;
          best = elem;
        }
      } catch (e) {
        // ignore elements without geometry
      }
    }
    return best;
  }

  removeElement(id) {
    if (!this.elements.has(id)) return false;
    this.elements.delete(id);
    this._emit('elementRemoved', { id });
    return true;
  }

  on(evt, cb) {
    this.listeners.push({ evt, cb });
  }

  _emit(evt, payload) {
    for (const l of this.listeners) if (l.evt === evt) l.cb(payload);
  }
}
