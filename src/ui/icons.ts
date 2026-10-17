// Item icons: each item's own 3D model rendered once, three-quarter view, soft studio light, onto a small
// transparent image — what the inventory, containers and the item guide show instead of a name in a box.
// A separate little WebGL context with plain copies of the materials, so the game's renderer and its
// shadow-mapped materials are never disturbed.
import * as THREE from 'three';
import { ITEMS, buildItemMesh } from '../props/items';
import { instanceModel } from '../props/models';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const SIZE = 128;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene, cam: THREE.OrthographicCamera;
const cache = new Map<string, string>();

function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  scene = new THREE.Scene();
  // a soft studio environment so metal (blades, iron, brass) reflects something instead of rendering black
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.8;
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x403830, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(2, 3, 2.5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xc8d8ff, 1.0); rim.position.set(-2, 1, -3); scene.add(rim);
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
}

/** A plain copy of a game material (no shadow-cascade shader hooks), keeping its look. */
function plain(m: THREE.Material): THREE.Material {
  const s = m as THREE.MeshStandardMaterial;
  const p = new THREE.MeshStandardMaterial({
    color: s.color?.clone() ?? new THREE.Color(0xffffff), map: s.map ?? null, normalMap: s.normalMap ?? null,
    roughness: s.roughness ?? 0.7, metalness: s.metalness ?? 0, emissive: s.emissive?.clone() ?? new THREE.Color(0), emissiveMap: s.emissiveMap ?? null,
    transparent: s.transparent, opacity: s.opacity ?? 1, side: THREE.DoubleSide, vertexColors: !!s.vertexColors,
    roughnessMap: s.roughnessMap ?? null, metalnessMap: s.metalnessMap ?? null, aoMap: s.aoMap ?? null,
  });
  for (const k of ['roughnessMap', 'metalnessMap', 'aoMap'] as const) if (p[k] && (p[k] as unknown as THREE.DataArrayTexture).isDataArrayTexture) p[k] = null;
  // a metal with no metalness map would come out black against an empty background: keep some diffuse
  if (!p.metalnessMap && p.metalness > 0.6) p.metalness = 0.6;
  if (s.map && (s.map as THREE.DataArrayTexture).isDataArrayTexture) p.map = null;     // array textures need the game shader
  if (s.normalMap && (s.normalMap as THREE.DataArrayTexture).isDataArrayTexture) p.normalMap = null;
  return p;
}

/** Data-URL image of an item (cached). */
export function itemIcon(id: string): string {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const d = ITEMS[id];
  let url = '';
  try {
    const obj = d ? (d.glb ? instanceModel(d.glb) : buildItemMesh(d)) : null;
    if (obj) {
      if (!renderer) setup();
      const temp: THREE.Material[] = [];
      obj.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { const mm = mesh.material; mesh.material = Array.isArray(mm) ? mm.map((x) => { const q = plain(x); temp.push(q); return q; }) : (temp.push(plain(mm)), temp[temp.length - 1]); } });
      // long things (swords, muskets, bows) stand upright to fill their tall slot; the rest sit at three-quarters
      const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const holder = new THREE.Group(); holder.add(obj); obj.position.sub(c);
      if (size.y > Math.max(size.x, size.z) * 2.2) holder.rotation.set(0.1, 0.7, -0.08);
      else holder.rotation.set(0.35, -0.65, 0);
      scene.add(holder);
      holder.updateMatrixWorld(true);
      const b2 = new THREE.Box3().setFromObject(holder), s2 = b2.getSize(new THREE.Vector3()), c2 = b2.getCenter(new THREE.Vector3());
      const r = Math.max(s2.x, s2.y) * 0.56 + 1e-3;
      cam.left = c2.x - r; cam.right = c2.x + r; cam.top = c2.y + r; cam.bottom = c2.y - r;
      cam.position.set(c2.x, c2.y, c2.z + 10); cam.lookAt(c2); cam.updateProjectionMatrix();
      renderer!.setClearColor(0x000000, 0);
      renderer!.render(scene, cam);
      url = renderer!.domElement.toDataURL('image/png');
      scene.remove(holder);
      for (const m of temp) m.dispose();
    }
  } catch { url = ''; }
  cache.set(id, url);
  return url;
}
