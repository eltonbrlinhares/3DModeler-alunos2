// Simple LevelManager with events
export default class LevelManager {
  constructor() {
    this._levels = new Map();
    this._listeners = Object.create(null);
    // create two default levels
    const l0 = this.createLevel('Level 0', 0, 0x888888);
    const l1 = this.createLevel('Level 1', 3.0, 0x444444);
    this._default = { base: l0.id, top: l1.id };
  }

  _nextId() {
    return `lvl-${Date.now().toString(36)}-${Math.floor(Math.random()*10000).toString(36)}`;
  }

  createLevel(name = 'Level', elevation = 0, color = 0x666666) {
    const id = this._nextId();
    const level = { id, name, elevation: Number(elevation) || 0, color };
    this._levels.set(id, level);
    this._emit('levelAdded', { id, name, elevation: level.elevation });
    return level;
  }

  getLevel(id) {
    return this._levels.get(id) || null;
  }

  getDefaultLevelIds() {
    return { ...this._default };
  }

  getElevation(id) {
    const lv = this.getLevel(id);
    return lv ? Number(lv.elevation) : null;
  }

  setElevation(id, elevation) {
    const lv = this.getLevel(id);
    if (!lv) return false;
    const old = lv.elevation;
    if (old === elevation) return false;
    lv.elevation = Number(elevation);
    this._emit('levelChanged', { id, old, elevation: lv.elevation });
    return true;
  }

  on(evt, cb) {
    (this._listeners[evt] ||= []).push(cb);
  }

  _emit(evt, payload) {
    const arr = this._listeners[evt];
    if (!arr) return;
    for (const cb of arr.slice()) cb(payload);
  }

  allLevels() {
    return Array.from(this._levels.values());
  }
}
