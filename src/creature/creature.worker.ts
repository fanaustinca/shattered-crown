// Builds creature meshes off the main thread, then simplifies them (meshoptimizer) to a game budget.
import { buildMesh, type MeshData } from './sdf';
import type { Anatomy } from './species';
import { MeshoptSimplifier } from 'meshoptimizer';

const BUDGET: Record<string, number> = { horse: 16000, cow: 15000, donkey: 12000, pig: 10000, bunny: 4000, sparrow: 1800, crow: 2200, pigeon: 2000, chicken: 3000 };

function simplify(m: MeshData, targetTris: number): MeshData {
  const tris = m.indices.length / 3;
  if (tris <= targetTris) return m;
  const [idx] = MeshoptSimplifier.simplify(m.indices, m.positions, 3, targetTris * 3, 0.02, []);
  // compact to the vertices still referenced
  const remap = new Int32Array(m.positions.length / 3).fill(-1);
  let n = 0;
  for (const i of idx) if (remap[i] < 0) remap[i] = n++;
  const out: MeshData = {
    positions: new Float32Array(n * 3), normals: new Float32Array(n * 3), skinIndex: new Uint16Array(n * 4), skinWeight: new Float32Array(n * 4),
    regions: new Float32Array(n), indices: new Uint32Array(idx.length),
  };
  for (let v = 0; v < remap.length; v++) {
    const k = remap[v];
    if (k < 0) continue;
    out.positions.set(m.positions.subarray(v * 3, v * 3 + 3), k * 3);
    out.normals.set(m.normals.subarray(v * 3, v * 3 + 3), k * 3);
    out.skinIndex.set(m.skinIndex.subarray(v * 4, v * 4 + 4), k * 4);
    out.skinWeight.set(m.skinWeight.subarray(v * 4, v * 4 + 4), k * 4);
    out.regions[k] = m.regions[v];
  }
  for (let i = 0; i < idx.length; i++) out.indices[i] = remap[idx[i]];
  return out;
}

self.onmessage = async (e: MessageEvent<{ id: number; anatomy: Anatomy }>) => {
  const { id, anatomy } = e.data;
  await MeshoptSimplifier.ready;
  const full = buildMesh(anatomy.prims, anatomy.cell, anatomy.bones.length);
  const m = simplify(full, BUDGET[anatomy.id] ?? (anatomy.kind === 'biped' ? 9000 : 8000));
  (self as unknown as Worker).postMessage({ id, mesh: m }, [m.positions.buffer, m.normals.buffer, m.skinIndex.buffer, m.skinWeight.buffer, m.regions.buffer, m.indices.buffer]);
};
