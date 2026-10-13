import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRTextureTransform, EXTTextureWebP, KHRMaterialsVariants } from '@gltf-transform/extensions';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { getBounds } from '@gltf-transform/core';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(`public/assets/models/${f}.glb`);
  console.log('==', f);
  const walk = (n, d) => { const b = n.getMesh() ? getBounds(n) : null; console.log(' '.repeat(d*2) + n.getName(), n.getMesh() ? `mesh tris~${n.getMesh().listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()||0)/3,0)|0} mats=${n.getMesh().listPrimitives().map(p=>p.getMaterial()?.getName()).join(',')} min=${b.min.map(v=>v.toFixed(2))} max=${b.max.map(v=>v.toFixed(2))}` : '', 't=' + n.getTranslation().map(v=>v.toFixed(2)), 'r=' + n.getRotation().map(v=>v.toFixed(2))); n.listChildren().forEach(c => walk(c, d+1)); };
  doc.getRoot().getDefaultScene().listChildren().forEach(n => walk(n, 1));
}
