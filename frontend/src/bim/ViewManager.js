import * as THREE from 'three';

export const ViewType = Object.freeze({ PLAN: 'plan', THREE_D: '3d', ELEVATION: 'elevation', SECTION: 'section' });

export default class ViewManager {
  constructor() {
    this.current = ViewType.PLAN;
    // cut plane elevation for plan/section views (world Z)
    this.cutElevation = 1.4; // default floor cut height
    // elevation view plane (X or Y) could be extended
  }

  setView(view) {
    this.current = view;
    this._emitChange();
  }

  setCutElevation(z) {
    this.cutElevation = Number(z);
    this._emitChange();
  }

  // simple event hooks
  onChange(cb) {
    (this._listeners ||= []).push(cb);
  }
  _emitChange() {
    if (!this._listeners) return;
    for (const cb of this._listeners.slice()) cb(this.current);
  }

  // Build objects for rendering based on view type.
  // Returns { plan: Group, scene3D: Group, elevation: Group, section: Group }
  buildViewGroups(elementManager, sceneHelpers = {}) {
    const planGroup = new THREE.Group();
    const scene3DGroup = new THREE.Group();
    const elevationGroup = new THREE.Group();
    const sectionGroup = new THREE.Group();

    const lm = sceneHelpers.levelManager;

    const elements = elementManager.getAllElements();
    for (const el of elements) {
      try {
        const type = el.bimType || el.params.type || 'generic';
        // PLAN: walls -> planRepresentation(), pillars -> planRepresentation (if exist)
        if (this.current === ViewType.PLAN || true) {
          if (typeof el.planRepresentation === 'function') {
            const repr = el.planRepresentation(sceneHelpers);
            if (repr) planGroup.add(repr);
          }
        }

        // 3D: always include geometryFactory output (representation of data)
        if (typeof el.geometryFactory === 'function') {
          const geom = el.geometryFactory(sceneHelpers);
          if (geom) scene3DGroup.add(geom);
        }

        // ELEVATION: include geometry but maybe clipped by plane; we'll add full geometry for now
        if (typeof el.geometryFactory === 'function') {
          const geom = el.geometryFactory(sceneHelpers);
          if (geom) elevationGroup.add(geom);
        }

        // SECTION/CORTE: include geometries intersecting cut plane
        if (typeof el.geometryFactory === 'function') {
          // decide whether element intersects cutElevation
          let includeInSection = true;
          if (lm) {
            const baseId = el.params.baseLevelId;
            const topId = el.params.topLevelId;
            let baseElev = 0;
            let topElev = null;
            if (baseId) baseElev = lm.getElevation(baseId) ?? 0;
            if (topId) topElev = lm.getElevation(topId) ?? null;
            if (topElev === null) topElev = baseElev + 3.0;
            // If the whole element is above the cut plane and cut plane is for plan, exclude
            if (baseElev > this.cutElevation) includeInSection = false;
            // If element entirely below cut plane, include? For section we include
          }
          if (includeInSection) {
            const geom = el.geometryFactory(sceneHelpers);
            if (geom) sectionGroup.add(geom);
          }
        }
      } catch (e) {
        // ignore element build failures
      }
    }

    // dimensions are independent objects
    if (elementManager.getAllDimensions) {
      const dims = elementManager.getAllDimensions();
      for (const d of dims) {
        try {
          if (typeof d.planRepresentation === 'function') {
            const repr = d.planRepresentation();
            if (repr) planGroup.add(repr);
          }
        } catch (e) {}
      }
    }

    return { plan: planGroup, scene3D: scene3DGroup, elevation: elevationGroup, section: sectionGroup };
  }
}
