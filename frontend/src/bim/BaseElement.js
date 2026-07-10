// Lightweight EventEmitter suitable for browser
class SimpleEmitter {
  constructor() {
    this._listeners = Object.create(null);
  }

  on(evt, cb) {
    (this._listeners[evt] ||= []).push(cb);
  }

  off(evt, cb) {
    const arr = this._listeners[evt];
    if (!arr) return;
    const i = arr.indexOf(cb);
    if (i >= 0) arr.splice(i, 1);
  }

  emit(evt, payload) {
    const arr = this._listeners[evt];
    if (!arr) return;
    for (const cb of arr.slice()) cb(payload);
  }
}

// Base class for all BIM elements. Stores parameters and emits change events.
export default class BaseElement {
  constructor(id) {
    this.id = id;
    this._params = {};
    this._emitter = new SimpleEmitter();
  }

  get params() {
    // Return shallow copy to avoid direct mutation
    return { ...this._params };
  }

  setParam(key, value) {
    const old = this._params[key];
    if (old === value) return;
    this._params[key] = value;
    this._emitter.emit('paramChanged', { id: this.id, key, value, old });
    this._emitter.emit('changed', { id: this.id });
  }

  setParams(obj) {
    let changed = false;
    for (const k in obj) {
      const old = this._params[k];
      if (obj[k] !== old) {
        this._params[k] = obj[k];
        changed = true;
        this._emitter.emit('paramChanged', { id: this.id, key: k, value: obj[k], old });
      }
    }
    if (changed) this._emitter.emit('changed', { id: this.id });
  }

  on(evt, cb) {
    this._emitter.on(evt, cb);
  }

  off(evt, cb) {
    this._emitter.off(evt, cb);
  }

  onChanged(cb) {
    this.on('changed', cb);
  }

  // Invalidate geometry and notify listeners
  invalidateGeometry() {
    this._emitter.emit('geometryInvalidated', { id: this.id });
  }

  // Each subclass must implement geometryFactory(sceneHelpers) that returns a three.js Object3D
  geometryFactory(sceneHelpers) {
    throw new Error('geometryFactory must be implemented by subclasses');
  }
}
