/**
 * src/ifc/insertion/PreviewLayer.js
 *
 * Camada de pré-visualização (a malha translúcida que segue o mouse durante a
 * inserção). Encapsula criação/descarte do grupo Three.js para que as
 * ferramentas não precisem mexer na cena diretamente — elas só chamam
 * `preview.begin().solid(...).line(...)`.
 */
import * as THREE from "three";

const noRaycast = () => {}; // o preview nunca deve ser clicável

export class PreviewLayer {
  constructor(scene) {
    this.scene = scene;
    this.group = null;
  }

  /** Remove o preview atual e libera a memória de GPU. */
  clear() {
    if (!this.group || !this.scene) return;
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose?.());
    });
    this.group = null;
  }

  /** Começa um preview novo (substitui o anterior). Encadeável. */
  begin(name = "ifc-construction-preview") {
    this.clear();
    if (!this.scene) return this;
    this.group = new THREE.Group();
    this.group.name = name;
    this.scene.add(this.group);
    return this;
  }

  /** Malha translúcida + arestas, a partir de uma BufferGeometry. Encadeável. */
  solid(geometry, { fill = 0x22d3ee, edge = 0xe0f2fe, opacity = 0.42 } = {}) {
    if (!this.group || !geometry) return this;
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: fill,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: edge, transparent: true, opacity: 0.9 })
    );
    mesh.raycast = noRaycast;
    edges.raycast = noRaycast;
    this.group.add(mesh, edges);
    return this;
  }

  /** Linha (eixo da viga, contorno da laje). Encadeável. */
  line(points, { color = 0xffffff, opacity = 1, depthTest = false } = {}) {
    if (!this.group || !points || points.length < 2) return this;
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest })
    );
    line.raycast = noRaycast;
    this.group.add(line);
    return this;
  }
}
