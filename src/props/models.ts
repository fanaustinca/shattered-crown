// GLB model cache (Poly Haven assets, meshopt-compressed) with per-instance cloning.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ASSET } from '../render/textures';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<THREE.Group>>();
const ready = new Map<string, THREE.Group>();
let prep: ((o: THREE.Object3D) => void) | null = null;
export function setModelPrep(fn: (o: THREE.Object3D) => void) { prep = fn; }

export function loadModel(name: string): Promise<THREE.Group> {
  let p = cache.get(name);
  if (!p) {
    p = loader.loadAsync(ASSET(`models/${name}.glb`)).then((g) => {
      const root = g.scene;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true; m.receiveShadow = true;
          const mat = m.material as THREE.MeshStandardMaterial;
          if (mat.map) mat.map.anisotropy = 8;
        }
      });
      prep?.(root);
      ready.set(name, root);
      return root;
    });
    cache.set(name, p);
  }
  return p;
}
export function modelReady(name: string) { return ready.get(name) ?? null; }
/** Clone sharing geometry and materials. */
export function instanceModel(name: string): THREE.Object3D | null {
  const src = ready.get(name);
  if (!src) return null;
  return src.clone(true);
}
export async function preload(names: string[]) { await Promise.all(names.map(loadModel)); }

/** Collect (decimated) vertex positions of a model in its local frame for convex hulls. */
export function hullPoints(obj: THREE.Object3D, max = 200): Float32Array {
  const pts: number[] = [];
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const v = new THREE.Vector3();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const p = m.geometry.getAttribute('position');
    const step = Math.max(1, Math.floor(p.count / max));
    const mm = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    for (let i = 0; i < p.count; i += step) { v.fromBufferAttribute(p, i).applyMatrix4(mm); pts.push(v.x, v.y, v.z); }
  });
  return new Float32Array(pts);
}
