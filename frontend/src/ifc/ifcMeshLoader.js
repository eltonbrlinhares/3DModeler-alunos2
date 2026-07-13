/**
 * src/ifc/ifcMeshLoader.js
 *
 * Converte um "produto" do JSON de mesh do backend numa THREE.Mesh pronta
 * para a cena. O viewport é Z-up (igual ao IFC), então os vértices são usados
 * sem conversão de eixos. Normais são calculadas no cliente.
 */

import * as THREE from "three";

// Cores por tipo IFC (hex). Tipos não listados caem no default.
const TYPE_COLORS = {
  IfcWall: 0x9ca3af, // cinza
  IfcWallStandardCase: 0x9ca3af,
  IfcSlab: 0x60a5fa, // azul
  IfcColumn: 0xf59e0b, // âmbar
  IfcBeam: 0xf97316, // laranja
  IfcWindow: 0x38bdf8, // ciano
  IfcDoor: 0xa78bfa, // roxo
  IfcRoof: 0xef4444, // vermelho
};
const DEFAULT_COLOR = 0xd1d5db;

export function colorForType(type) {
  return TYPE_COLORS[type] ?? DEFAULT_COLOR;
}

/**
 * Constrói uma THREE.Mesh a partir de um produto do backend.
 * @param {{guid:string,id:number,type:string,vertices:number[],indices:number[]}} product
 * @returns {THREE.Mesh|null} null se o produto não tiver geometria.
 */
export function meshFromProduct(product) {
  const { vertices, indices } = product;
  if (!vertices?.length || !indices?.length) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(vertices), 3)
  );
  geo.setIndex(
    vertices.length / 3 > 65535
      ? new THREE.Uint32BufferAttribute(indices, 1)
      : new THREE.Uint16BufferAttribute(indices, 1)
  );
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const center = new THREE.Vector3();
  geo.boundingBox.getCenter(center);
  geo.translate(-center.x, -center.y, -center.z);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    color: colorForType(product.type),
    metalness: 0.0,
    roughness: 0.85,
    side: THREE.DoubleSide,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(center);
  mesh.name = `ifc:${product.guid}`;
  mesh.userData.ifc = {
    guid: product.guid,
    id: product.id,
    type: product.type,
  };
  return mesh;
}

/** Edge overlay (wireframe sutil) para dar legibilidade às formas. */
export function edgesForMesh(mesh, color = 0x374151) {
  const edges = new THREE.EdgesGeometry(mesh.geometry, 30);
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color })
  );
  line.position.copy(mesh.position);
  line.rotation.copy(mesh.rotation);
  line.scale.copy(mesh.scale);
  line.name = `${mesh.name}:edges`;
  line.userData.ifc = { ...(mesh.userData.ifc ?? {}) };
  return line;
}
