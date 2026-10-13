// Material-keyed BatchedMesh pools: thousands of static meshes (building shells, far props) drawn with one
// multi-draw call per material, with per-instance frustum culling in every pass (including each shadow cascade).
import * as THREE from 'three';

export interface BatchHandle { parts: { bm: THREE.BatchedMesh; g: number; i: number }[]; visible: boolean }

interface Internals { _nextVertexStart: number; _nextIndexStart: number; _maxVertexCount: number; _maxIndexCount: number; _maxInstanceCount: number; _instanceInfo: unknown[]; _availableInstanceIds: number[]; _availableGeometryIds: number[] }

export class BatchPool {
  group = new THREE.Group();
  private batches = new Map<string, THREE.BatchedMesh>();
  private wasted = new Map<THREE.BatchedMesh, number>();
  constructor(private matFor: (k: string) => THREE.Material, private setup: (bm: THREE.BatchedMesh, key: string) => void = () => {}) {
    this.group.name = 'batches';
    this.group.matrixAutoUpdate = false;
  }

  private batch(k: string, nv: number, ni: number) {
    let bm = this.batches.get(k);
    if (!bm) {
      bm = new THREE.BatchedMesh(64, Math.max(16384, nv * 4), Math.max(32768, ni * 4), this.matFor(k));
      bm.sortObjects = false;           // opaque: the depth prepass order doesn't matter, skip the per-frame sort
      // per-instance culling re-uploads the indirect texture for every pass (main + each cascade), which costs far
      // more CPU than the GPU spends drawing a few hundred off-screen shells; the indirect list then only changes
      // when a building is added, removed or swaps to its far box
      bm.perObjectFrustumCulled = false;
      bm.frustumCulled = false;
      bm.matrixAutoUpdate = false;
      bm.castShadow = true; bm.receiveShadow = true;
      this.setup(bm, k);
      this.batches.set(k, bm);
      this.group.add(bm);
    }
    const a = bm as unknown as Internals;
    if (a._nextVertexStart + nv > a._maxVertexCount || a._nextIndexStart + ni > a._maxIndexCount) {
      // reclaim the space of removed geometry first, then grow
      if ((this.wasted.get(bm) ?? 0) > 0) { bm.optimize(); this.wasted.set(bm, 0); }
      if (a._nextVertexStart + nv > a._maxVertexCount || a._nextIndexStart + ni > a._maxIndexCount) {
        bm.setGeometrySize(Math.max(a._maxVertexCount * 2, a._nextVertexStart + nv * 2), Math.max(a._maxIndexCount * 2, a._nextIndexStart + ni * 2));
      }
    }
    if (a._instanceInfo.length >= a._maxInstanceCount && a._availableInstanceIds.length === 0) bm.setInstanceCount(a._maxInstanceCount * 2);
    return bm;
  }

  add(geos: Map<string, THREE.BufferGeometry>, matrix: THREE.Matrix4, visible = true): BatchHandle {
    const h: BatchHandle = { parts: [], visible };
    for (const [k, geo] of geos) {
      const nv = geo.getAttribute('position').count, ni = geo.index?.count ?? 0;
      const bm = this.batch(k, nv, ni);
      const g = bm.addGeometry(geo);
      const i = bm.addInstance(g);
      bm.setMatrixAt(i, matrix);
      if (!visible) bm.setVisibleAt(i, false);
      h.parts.push({ bm, g, i });
    }
    return h;
  }
  remove(h: BatchHandle) {
    for (const p of h.parts) {
      p.bm.deleteGeometry(p.g);
      this.wasted.set(p.bm, (this.wasted.get(p.bm) ?? 0) + 1);
    }
    h.parts.length = 0;
  }
  setVisible(h: BatchHandle, v: boolean) {
    if (h.visible === v) return;
    h.visible = v;
    for (const p of h.parts) p.bm.setVisibleAt(p.i, v);
  }
  get drawCount() { return this.batches.size; }
}
