// Builds creature meshes off the main thread.
import { buildMesh } from './sdf';
import type { Anatomy } from './species';

self.onmessage = (e: MessageEvent<{ id: number; anatomy: Anatomy }>) => {
  const { id, anatomy } = e.data;
  const m = buildMesh(anatomy.prims, anatomy.cell, anatomy.bones.length);
  (self as unknown as Worker).postMessage({ id, mesh: m }, [m.positions.buffer, m.normals.buffer, m.skinIndex.buffer, m.skinWeight.buffer, m.regions.buffer, m.indices.buffer]);
};
