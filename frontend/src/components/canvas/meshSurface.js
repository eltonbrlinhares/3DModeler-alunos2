/**
 * canvas/meshSurface.js
 *
 * Fábrica para a função meshSurface (geração de malha FEM estruturada).
 * Suporta malha 2D em superfície única e malha 3D (template hexaédrico)
 * em múltiplas superfícies selecionadas.
 */

import * as THREE from "three";
import { meshModule } from "../../mesh/MeshModule.js";
import { femWireframeGeometry } from "./femUtils.js";

/**
 * Cria a função meshSurface injetando dependências.
 *
 * @param {{
 *   scene: THREE.Scene,
 *   getSelectedSurfaces: () => THREE.Mesh[],
 *   computeSubdivTs: function,
 * }} deps
 * @returns {(algo: string, params: object) => Promise<{ok, n_nodes, n_elements} | {error}>}
 */
export function createMeshSurface({ scene, getSelectedSurfaces, computeSubdivTs }) {
  return async function meshSurface(algo, params) {
    const selectedSurfaces = getSelectedSurfaces();

    // ── Malha 3D por template hexaédrico (múltiplas superfícies) ─────────────
    if (algo === '3d_template') {
      if (selectedSurfaces.length < 2) {
        return { error: 'Selecione 2 ou mais superfícies com malha gerada para usar o Template 3D.' };
      }

      const surfaces = [];
      for (const surf of selectedSurfaces) {
        const data = surf.userData.femMeshData;
        if (!data) {
          return { error: 'Uma ou mais superfícies não têm malha gerada. Gere a malha 2D de cada superfície primeiro.' };
        }
        surfaces.push(data);
      }

      let result;
      try {
        result = await meshModule.msh3d.template({ surfaces });
      } catch (e) {
        console.error('[FEMMesh] msh3d.template WASM falhou:', e);
        return { error: e.message };
      }

      console.log('[FEMMesh3D] template resultado:'
        + ` n_nodes=${result.n_nodes} n_elements=${result.n_elements}`);

      // Remove wireframe 3D anterior (associado ao primeiro surface)
      const host = selectedSurfaces[0];
      if (host.userData.fem3DWireframe) {
        scene.remove(host.userData.fem3DWireframe);
        host.userData.fem3DWireframe.geometry.dispose();
        host.userData.fem3DWireframe.material.dispose();
        host.userData.fem3DWireframe = null;
      }

      const wireGeo = femWireframeGeometry(result);
      const wireMat = new THREE.LineBasicMaterial({ color: 0xfbbf24 }); // amarelo
      const wireframe = new THREE.LineSegments(wireGeo, wireMat);
      scene.add(wireframe);
      host.userData.fem3DWireframe = wireframe;

      return { ok: true, n_nodes: result.n_nodes, n_elements: result.n_elements };
    }

    // ── Malha 2D em superfície única ──────────────────────────────────────────
    const selectedSurface = selectedSurfaces[0] ?? null;
    if (!selectedSurface) return { error: 'Nenhuma superfície selecionada.' };
    if (selectedSurfaces.length > 1) {
      return { error: 'Para malha 2D selecione apenas uma superfície. Para malha 3D use Template 3D.' };
    }

    const src = selectedSurface.userData.sourceCurves;
    if (!src) return { error: 'Superfície não tem dados de curva (regere a superfície).' };
    if (src.type !== 'loop' || src.curves.length < 3) {
      return { error: 'Este algoritmo requer um loop fechado de 3 ou 4 curvas.' };
    }

    const N = src.curves.length;
    const { elem_type } = params;

    const live = src.curves.map((c) => ({
      subdivisions: c.line?.userData?.subdivisions ?? c.subdivisions ?? 10,
      ratio:        c.line?.userData?.ratio        ?? c.ratio        ?? 1.0,
    }));

    let result;

    if (algo === 'template') {
      const subdivision = live.map(l => l.subdivisions);
      const boundary = [];
      src.curves.forEach((c, k) => {
        const d = subdivision[k];
        const ts = computeSubdivTs(d, live[k].ratio);
        if (c.reversed) {
          for (let i = d; i >= 1; i--) { const p = c.nurbs.getPoint(ts[i]); boundary.push(p.x, p.y, p.z); }
        } else {
          for (let i = 0; i < d; i++)  { const p = c.nurbs.getPoint(ts[i]); boundary.push(p.x, p.y, p.z); }
        }
      });
      console.log(`[FEMMesh] template n_sides=${N} subdivision:`, subdivision,
        '| boundary pts:', boundary.length / 3);
      try {
        result = await meshModule.mshsurf.template({ n_sides: N, subdivision, boundary });
      } catch (e) {
        console.error('[FEMMesh] template WASM falhou:', e);
        return { error: e.message };
      }
    } else if (N === 3) {
      const m = live[0].subdivisions + 1;
      const n = live[1].subdivisions + 1;
      const sideSegs = (algo === 'trilinear')
        ? [m - 1, m - 1, m - 1]
        : [m - 1, n - 1, m - 1];

      const boundary = [];
      src.curves.forEach((c, k) => {
        const d = sideSegs[k];
        const ts = computeSubdivTs(d, live[k].ratio);
        if (c.reversed) {
          for (let i = d; i >= 1; i--) { const p = c.nurbs.getPoint(ts[i]); boundary.push(p.x, p.y, p.z); }
        } else {
          for (let i = 0; i < d; i++)  { const p = c.nurbs.getPoint(ts[i]); boundary.push(p.x, p.y, p.z); }
        }
      });
      const effectiveAlgo = algo === 'bilinear' ? 'collbilinear' : algo;
      console.log(`[FEMMesh] ${effectiveAlgo} (3 curvas) m=${m} n=${n} elem_type=${elem_type}`
        + ` | boundary pts:`, boundary.length / 3);
      try {
        if (effectiveAlgo === 'trilinear') {
          result = await meshModule.mshsurf.trilinear({ boundary, m, elem_type });
        } else {
          result = await meshModule.mshsurf[effectiveAlgo]({ boundary, m, n, elem_type });
        }
      } catch (e) {
        console.error(`[FEMMesh] ${effectiveAlgo} WASM falhou:`, e);
        return { error: e.message };
      }
    } else {
      const m = live[0].subdivisions + 1;
      const n = live[1].subdivisions + 1;
      const sideSegs = [m - 1, n - 1, m - 1, n - 1];

      const boundary = [];
      src.curves.forEach((c, k) => {
        const d = sideSegs[k];
        const ts = computeSubdivTs(d, live[k].ratio);
        if (c.reversed) {
          for (let i = d; i >= 1; i--) { const p = c.nurbs.getPoint(ts[i]); boundary.push(p.x, p.y, p.z); }
        } else {
          for (let i = 0; i < d; i++)  { const p = c.nurbs.getPoint(ts[i]); boundary.push(p.x, p.y, p.z); }
        }
      });
      console.log(`[FEMMesh] ${algo} m=${m} n=${n} elem_type=${elem_type}`
        + ` | boundary pts:`, boundary.length / 3);
      try {
        if (algo === 'trilinear') {
          result = await meshModule.mshsurf.trilinear({ boundary, m, elem_type });
        } else {
          result = await meshModule.mshsurf[algo]({ boundary, m, n, elem_type });
        }
      } catch (e) {
        console.error(`[FEMMesh] ${algo} WASM falhou:`, e);
        return { error: e.message };
      }
    }

    console.log('[FEMMesh] resultado WASM:'
      + ` n_nodes=${result.n_nodes} n_elements=${result.n_elements} elem_size=${result.elem_size}`);

    // Remove malha FEM anterior
    if (selectedSurface.userData.femMesh) {
      scene.remove(selectedSurface.userData.femMesh);
      selectedSurface.userData.femMesh.geometry.dispose();
      selectedSurface.userData.femMesh.material.dispose();
    }
    if (selectedSurface.userData.femWireframe) {
      scene.remove(selectedSurface.userData.femWireframe);
      selectedSurface.userData.femWireframe.geometry.dispose();
      selectedSurface.userData.femWireframe.material.dispose();
    }

    // Guarda dados brutos para uso posterior no Template 3D
    selectedSurface.userData.femMeshData = {
      nodes:     Array.from(result.positions),
      index:     Array.from(result.index),
      elem_size: result.elem_size,
    };

    const wireGeo = femWireframeGeometry(result);
    const wireMat = new THREE.LineBasicMaterial({ color: 0x4ade80 });
    const wireframe = new THREE.LineSegments(wireGeo, wireMat);
    scene.add(wireframe);

    selectedSurface.userData.femMesh = null;
    selectedSurface.userData.femWireframe = wireframe;

    console.info(`[FEMMesh] ${algo} → ${result.n_nodes} nós, ${result.n_elements} elementos`);
    return { ok: true, n_nodes: result.n_nodes, n_elements: result.n_elements };
  };
}
