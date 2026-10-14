import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
  const a = p.getAttribute('POSITION'); const arr = a.getArray(); let nan = 0;
  for (const v of arr) if (!Number.isFinite(v)) nan++;
  console.log(mesh.getName(), a.getCount(), arr.constructor.name, a.getNormalized(), 'nan', nan, a.getMin([]), a.getMax([]));
}
for (const n of doc.getRoot().listNodes()) { const t = n.getTranslation(), s = n.getScale(), r = n.getRotation(); if ([...t, ...s, ...r].some((v) => !Number.isFinite(v))) console.log('BAD NODE', n.getName(), t, s, r); }
