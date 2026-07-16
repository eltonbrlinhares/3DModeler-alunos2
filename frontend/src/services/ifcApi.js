/**
 * src/services/ifcApi.js
 *
 * Cliente REST do backend IFC (FastAPI em :8000). Todas as coordenadas
 * trocadas com o backend são IFC (Z-up, metros) — o viewport deste app
 * também é Z-up (camera.up = (0,0,1)), então não há conversão de eixos.
 *
 * Base configurável via VITE_IFC_API; default http://localhost:8000.
 */

const BASE = import.meta.env?.VITE_IFC_API ?? "http://localhost:8000";

async function req(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* corpo não-JSON */
    }
    throw new Error(`${method} ${path} → ${res.status}: ${detail}`);
  }
  return res.status === 204 ? null : res.json();
}

export const ifcApi = {
  // ---------- modelos ----------
  listModels: () => req("GET", "/ifc/models"),
  createModel: (name = "untitled") => req("POST", "/ifc/models", { name }),
  async uploadModel(file) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${BASE}/ifc/models/upload`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) throw new Error(`upload → ${res.status}`);
    return res.json();
  },
  summary: (id) => req("GET", `/ifc/models/${id}/summary`),
  entities: (id, type = "IfcProduct") =>
    req("GET", `/ifc/models/${id}/entities?type=${encodeURIComponent(type)}`),
  entity: (id, guid) => req("GET", `/ifc/models/${id}/entity/${guid}`),
  save: (id) => req("POST", `/ifc/models/${id}/save`),
  downloadUrl: (id) => `${BASE}/ifc/models/${id}/download`,
  glbUrl: (id) => `${BASE}/ifc/models/${id}/export/glb`,
  close: (id) => req("DELETE", `/ifc/models/${id}`),

  // ---------- mesh ----------
  mesh: (id) => req("GET", `/ifc/models/${id}/mesh`),
  productMesh: (id, guid) => req("GET", `/ifc/models/${id}/mesh/${guid}`),

  // ---------- geometria ----------
  createWall: (id, params) =>
    req("POST", `/ifc/models/${id}/geometry/wall`, params),
  createSlab: (id, params) =>
    req("POST", `/ifc/models/${id}/geometry/slab`, params),
  createColumn: (id, params) =>
    req("POST", `/ifc/models/${id}/geometry/column`, params),
  createBeam: (id, params) =>
    req("POST", `/ifc/models/${id}/geometry/beam`, params),
  createFooting: (id, params) =>
    req("POST", `/ifc/models/${id}/geometry/footing`, params),
  editPlacement: (id, params) =>
    req("POST", `/ifc/models/${id}/geometry/placement`, params),
  editDimensions: (id, params) =>
    req("POST", `/ifc/models/${id}/geometry/dimensions`, params),
  editColumn: (id, guid, params) =>
    req("PATCH", `/ifc/models/${id}/geometry/column/${guid}`, params),
  editBeam: (id, guid, params) =>
    req("PATCH", `/ifc/models/${id}/geometry/beam/${guid}`, params),
  editFooting: (id, guid, params) =>
    req("PATCH", `/ifc/models/${id}/geometry/footing/${guid}`, params),
  editSlab: (id, guid, params) =>
    req("PATCH", `/ifc/models/${id}/geometry/slab/${guid}`, params),

  // ---------- conectividade física (apoio/cruzamento entre elementos) ----------
  connections: (id, guid) => req("GET", `/ifc/models/${id}/connectivity/${guid}`),
  resyncConnections: (id, guid) =>
    req("POST", `/ifc/models/${id}/connectivity/${guid}/resync`),

  // ---------- cotas manuais ponto-a-ponto (IfcAnnotation) ----------
  listDimensions: (id) => req("GET", `/ifc/models/${id}/dimensions`),
  createDimension: (id, p0, p1, plane) =>
    req("POST", `/ifc/models/${id}/dimensions`, { p0, p1, plane }),
  deleteDimension: (id, guid) => req("DELETE", `/ifc/models/${id}/dimensions/${guid}`),


  // ---------- dimensionamento preliminar (fundação) ----------
  // stateless: sem model_id, so calcula uma sugestao de geometria
  suggestPadFooting: (params) =>
    req("POST", `/design/foundation/pad-footing`, params),
  suggestPileCap: (params) =>
    req("POST", `/design/foundation/pile-cap`, params),

  // ---------- dados ----------
  editAttributes: (id, guid, attributes) =>
    req("POST", `/ifc/models/${id}/edit/attributes`, { guid, attributes }),
  editPset: (id, guid, pset_name, properties) =>
    req("POST", `/ifc/models/${id}/edit/pset`, { guid, pset_name, properties }),
  deleteEntity: (id, guid) =>
    req("POST", `/ifc/models/${id}/edit/delete`, { guid }),

  // ---------- espacial ----------
  spatialBootstrap: (id, params = {}) =>
    req("POST", `/ifc/models/${id}/spatial/bootstrap`, params),
  spatialAssign: (id, guid, container_guid) =>
    req("POST", `/ifc/models/${id}/spatial/assign`, { guid, container_guid }),
  spatialTree: (id) => req("GET", `/ifc/models/${id}/spatial/tree`),

  // ---------- níveis ----------
  levels: (id) => req("GET", `/ifc/models/${id}/levels`),
  createLevel: (id, params) => req("POST", `/ifc/models/${id}/levels`, params),
  editLevel: (id, guid, params) =>
    req("PATCH", `/ifc/models/${id}/levels/${guid}`, params),
  deleteLevel: (id, guid, force = false) =>
    req("DELETE", `/ifc/models/${id}/levels/${guid}?force=${force}`),

  // ---------- grids ----------
  grids: (id) => req("GET", `/ifc/models/${id}/grids`),
  createGrid: (id, params) => req("POST", `/ifc/models/${id}/grids`, params),
  deleteGrid: (id, guid) => req("DELETE", `/ifc/models/${id}/grids/${guid}`),

  // ---------- histórico / validação ----------
  undo: (id) => req("POST", `/ifc/models/${id}/history/undo`),
  redo: (id) => req("POST", `/ifc/models/${id}/history/redo`),
  validate: (id) => req("GET", `/ifc/models/${id}/validate`),
};

export default ifcApi;
