// Item definitions: physical props with real mass, inventory footprint, value, food spoilage,
// breakability, containers. Models are Poly Haven GLBs or small procedural meshes.
import * as THREE from 'three';
import { GeoBuilder } from '../build/geom';
import { meshesFrom } from './palette';

export type ItemKind = 'food' | 'drink' | 'tool' | 'weapon' | 'shield' | 'container' | 'material' | 'valuable' | 'misc' | 'ammo' | 'key' | 'light' | 'medical';
export interface ItemDef {
  id: string; name: string; kind: ItemKind;
  glb?: string; build?: (g: GeoBuilder) => void;
  mass: number;              // kg
  inv: [number, number];     // grid cells (w, h)
  value: number;             // silver pennies
  food?: { nutrition: number; spoilDays: number; raw?: boolean };
  breakable?: { threshold: number; shards: number; color: number; spill?: 'wine' | 'water' | 'milk' };
  container?: { w: number; h: number; open: boolean };   // open containers hold things physically too
  shape?: 'ball' | 'box' | 'cyl' | 'hull';
  weapon?: { damage: number; reach: number; speed: number; type: 'blade' | 'blunt' | 'axe' | 'pierce' };
  hold?: 'one' | 'two';
  stack?: number;
  desc: string;
  scale?: number;
  material?: string;         // sound/surface hint
}

const B = (fn: (g: GeoBuilder) => void) => fn;

export const ITEMS: Record<string, ItemDef> = {};
const def = (d: ItemDef) => { ITEMS[d.id] = d; };

// ---- food ----
def({ id: 'apple', name: 'Apple', kind: 'food', glb: 'food_apple_01', mass: 0.18, inv: [1, 1], value: 1, food: { nutrition: 8, spoilDays: 12 }, shape: 'ball', desc: 'A crisp orchard apple.', stack: 10 });
def({ id: 'pear', name: 'Pear', kind: 'food', glb: 'food_pears_asian_01', mass: 0.25, inv: [1, 1], value: 1, food: { nutrition: 9, spoilDays: 8 }, shape: 'ball', desc: 'A ripe pear.', stack: 10 });
def({ id: 'onion', name: 'Onion', kind: 'food', glb: 'yellow_onion', mass: 0.15, inv: [1, 1], value: 1, food: { nutrition: 3, spoilDays: 40, raw: true }, shape: 'ball', desc: 'Keeps for weeks in a cool place.', stack: 10 });
def({ id: 'turnip', name: 'Sweet root', kind: 'food', glb: 'sweet_potato', mass: 0.3, inv: [1, 1], value: 1, food: { nutrition: 7, spoilDays: 30, raw: true }, shape: 'hull', desc: 'Better roasted than raw.', stack: 10 });
def({ id: 'lemon', name: 'Lemon', kind: 'food', glb: 'lemon', mass: 0.12, inv: [1, 1], value: 3, food: { nutrition: 2, spoilDays: 20 }, shape: 'ball', desc: 'Traded up the river from the isles.', stack: 10 });
def({ id: 'pastry', name: 'Butter pastry', kind: 'food', glb: 'croissant', mass: 0.1, inv: [1, 1], value: 3, food: { nutrition: 14, spoilDays: 3 }, shape: 'hull', desc: 'Flaky and rich. Goes stale fast.' });
def({ id: 'bread', name: 'Loaf of bread', kind: 'food', mass: 0.5, inv: [2, 1], value: 2, food: { nutrition: 25, spoilDays: 4 }, shape: 'hull', desc: 'A brown loaf. Stale in days, mouldy soon after.', build: B((g) => { g.ellipsoid('mat:flour|tint:a06a38', 0, 0.06, 0, 0.13, 0.065, 0.08, 14, 0.8); for (let i = 0; i < 3; i++) g.box('mat:flour|tint:e8d0a0', -0.06 + i * 0.06, 0.12, 0, 0.012, 0.004, 0.09, 4); }) });
def({ id: 'cheese', name: 'Cheese wheel', kind: 'food', mass: 1.5, inv: [2, 2], value: 8, food: { nutrition: 60, spoilDays: 45 }, shape: 'cyl', desc: 'A waxed wheel; keeps a long while, longer in a cellar.', build: B((g) => { g.cyl('wax|c:d8a030', 0, 0, 0, 0.11, 0.11, 0.08, 20); }) });
def({ id: 'cheese_box', name: 'Boxed cheese', kind: 'food', glb: 'CheeseBox_01', mass: 0.4, inv: [2, 1], value: 4, food: { nutrition: 20, spoilDays: 30 }, shape: 'box', desc: 'Soft cheese in a pinewood box.' });
def({ id: 'meat', name: 'Raw meat', kind: 'food', mass: 1.0, inv: [2, 1], value: 4, food: { nutrition: 30, spoilDays: 2, raw: true }, shape: 'hull', desc: 'Spoils in two days unless salted, smoked or kept cold.', build: B((g) => { g.ellipsoid('color:8a2a22|r:0.45', 0, 0.05, 0, 0.12, 0.05, 0.08, 12, 0.7); g.ellipsoid('color:e8d8c0|r:0.5', 0.08, 0.05, 0, 0.03, 0.035, 0.05, 8); }) });
def({ id: 'salted_meat', name: 'Salted meat', kind: 'food', mass: 0.9, inv: [2, 1], value: 6, food: { nutrition: 28, spoilDays: 60 }, shape: 'hull', desc: 'Salt-cured; keeps for months.', build: B((g) => { g.ellipsoid('color:9a4a3a|r:0.8', 0, 0.05, 0, 0.12, 0.05, 0.08, 12, 0.7); }) });
def({ id: 'smoked_fish', name: 'Smoked fish', kind: 'food', mass: 0.4, inv: [2, 1], value: 4, food: { nutrition: 18, spoilDays: 40 }, shape: 'hull', desc: 'Golden and dry from the smokehouse.', build: B((g) => { g.ellipsoid('color:a07030|r:0.5', 0, 0.03, 0, 0.16, 0.03, 0.045, 12); g.push().translate(-0.17, 0.03, 0).rotateY(Math.PI / 4); g.box('color:a07030|r:0.5', 0, 0, 0, 0.05, 0.03, 0.05); g.pop(); }) });
def({ id: 'fish', name: 'Fresh fish', kind: 'food', mass: 0.6, inv: [2, 1], value: 2, food: { nutrition: 16, spoilDays: 1.5, raw: true }, shape: 'hull', desc: 'Fresh from the river. Eat or smoke it today.', build: B((g) => { g.ellipsoid('silver', 0, 0.035, 0, 0.17, 0.035, 0.05, 12); g.push().translate(-0.18, 0.035, 0).rotateY(Math.PI / 4); g.box('silver', 0, 0, 0, 0.06, 0.04, 0.06); g.pop(); }) });
def({ id: 'jug', name: 'Clay jug of water', kind: 'drink', glb: 'jug_01', mass: 1.6, inv: [2, 2], value: 3, breakable: { threshold: 3.5, shards: 9, color: 0x9a6040, spill: 'water' }, shape: 'hull', desc: 'Fragile. Drop it on stone and it shatters.' });
def({ id: 'wine_jug', name: 'Jug of wine', kind: 'drink', glb: 'metal_jug', mass: 1.4, inv: [2, 2], value: 12, shape: 'hull', desc: 'Pewter jug of red wine.' });
def({ id: 'vase', name: 'Ceramic vase', kind: 'valuable', glb: 'antique_ceramic_vase_01', mass: 1.2, inv: [2, 3], value: 25, breakable: { threshold: 3, shards: 12, color: 0x6a8aa0 }, shape: 'hull', desc: 'Painted and fragile.' });
def({ id: 'cup', name: 'Clay cup', kind: 'misc', mass: 0.2, inv: [1, 1], value: 1, breakable: { threshold: 4, shards: 5, color: 0xa86a48 }, shape: 'cyl', desc: 'Breaks if dropped hard.', build: B((g) => { g.cyl('ceramic|c:a86a48|glaze:1', 0, 0, 0, 0.035, 0.045, 0.09, 14); }) });
def({ id: 'tankard', name: 'Wooden tankard', kind: 'misc', mass: 0.4, inv: [1, 1], value: 2, shape: 'cyl', desc: 'Iron-banded tankard.', build: B((g) => { g.cyl('wood:planks|stain:honey|fin:oiled', 0, 0, 0, 0.05, 0.055, 0.15, 14); g.cyl('iron', 0, 0.02, 0, 0.056, 0.056, 0.015, 14, false); g.cyl('iron', 0, 0.12, 0, 0.051, 0.051, 0.015, 14, false); g.push().translate(0.07, 0.075, 0); g.box('wood:planks|stain:honey|fin:oiled', 0, 0, 0, 0.02, 0.09, 0.02); g.pop(); }) });
def({ id: 'goblet', name: 'Brass goblet', kind: 'valuable', mass: 0.3, inv: [1, 1], value: 15, shape: 'cyl', desc: 'Fine brasswork.', build: B((g) => { g.cyl('brass', 0, 0, 0, 0.04, 0.04, 0.01, 14); g.cyl('brass', 0, 0.01, 0, 0.008, 0.008, 0.08, 8); g.cyl('brass', 0, 0.09, 0, 0.02, 0.045, 0.07, 14, false); }) });
def({ id: 'plate', name: 'Plate', kind: 'misc', mass: 0.4, inv: [2, 2], value: 1, breakable: { threshold: 4, shards: 6, color: 0xe8e0d0 }, shape: 'cyl', desc: 'Glazed earthenware.', build: B((g) => { g.cyl('ceramic|c:e8e0d0|glaze:1', 0, 0, 0, 0.11, 0.12, 0.018, 20); }) });
def({ id: 'bowl', name: 'Wooden bowl', kind: 'container', glb: 'wooden_bowl_01', mass: 0.3, inv: [2, 1], value: 1, container: { w: 2, h: 1, open: true }, shape: 'hull', desc: 'Holds a little.' });

// ---- containers ----
def({ id: 'basket', name: 'Wicker basket', kind: 'container', glb: 'wicker_basket_01', mass: 0.6, inv: [3, 2], value: 3, container: { w: 4, h: 3, open: true }, shape: 'box', desc: 'Drop fruit in it — it carries what is inside.' });
def({ id: 'lidded_basket', name: 'Lidded basket', kind: 'container', glb: 'wicker_basket_02', mass: 0.7, inv: [2, 3], value: 4, container: { w: 3, h: 3, open: true }, shape: 'box', desc: 'A basket with a lid.' });
def({ id: 'crate', name: 'Wooden crate', kind: 'container', glb: 'wooden_crate_01', mass: 8, inv: [4, 3], value: 4, container: { w: 6, h: 4, open: true }, shape: 'box', desc: 'Heavy when full. Load it onto a cart.', hold: 'two' });
def({ id: 'big_crate', name: 'Large crate', kind: 'container', glb: 'wooden_crate_02', mass: 14, inv: [5, 4], value: 6, container: { w: 8, h: 5, open: true }, shape: 'box', desc: 'Needs both arms.', hold: 'two' });
def({ id: 'barrel', name: 'Barrel', kind: 'container', glb: 'Barrel_01', mass: 30, inv: [4, 4], value: 8, container: { w: 6, h: 6, open: false }, shape: 'cyl', desc: 'Rolls when tipped over.', hold: 'two' });
def({ id: 'wine_barrel', name: 'Wine cask', kind: 'container', glb: 'wine_barrel_01', mass: 60, inv: [5, 5], value: 30, container: { w: 2, h: 2, open: false }, shape: 'cyl', desc: 'Full of wine. Far too heavy to carry.', hold: 'two' });
def({ id: 'bucket', name: 'Bucket', kind: 'container', glb: 'wooden_bucket_01', mass: 1.5, inv: [2, 3], value: 2, container: { w: 3, h: 3, open: true }, shape: 'cyl', desc: 'Fill it at a well or the river.' });
def({ id: 'sack', name: 'Sack of flour', kind: 'container', mass: 20, inv: [3, 4], value: 6, container: { w: 4, h: 4, open: false }, shape: 'hull', hold: 'two', desc: 'Can be strapped to a donkey as a saddlebag.', build: B((g) => { g.ellipsoid('cloth:hessian|dye:undyed', 0, 0.28, 0, 0.22, 0.3, 0.17, 14, 0.75); g.cyl('cloth:hessian|dye:walnut', 0, 0.55, 0, 0.06, 0.03, 0.08, 10); }) });
def({ id: 'saddlebag', name: 'Leather saddlebag', kind: 'container', mass: 2, inv: [3, 3], value: 12, container: { w: 6, h: 5, open: false }, shape: 'box', desc: 'Hold it near a horse or donkey and press E to strap it on.', build: B((g) => { g.box('cloth:leather|dye:walnut', 0, 0.18, 0, 0.36, 0.34, 0.16); g.box('cloth:leather|dye:walnut', 0, 0.36, 0.06, 0.38, 0.05, 0.06); g.box('brass', 0, 0.28, 0.085, 0.04, 0.04, 0.01); }) });
def({ id: 'treasure_chest', name: 'Iron-bound chest', kind: 'container', glb: 'treasure_chest', mass: 25, inv: [5, 4], value: 40, container: { w: 8, h: 6, open: false }, shape: 'box', hold: 'two', desc: 'Lockable.' });

// ---- weapons, tools ----
def({ id: 'sword', name: 'Longsword', kind: 'weapon', glb: 'antique_estoc', mass: 1.4, inv: [1, 6], value: 60, weapon: { damage: 32, reach: 1.25, speed: 1.0, type: 'blade' }, shape: 'hull', desc: 'Left-click to swing; drag the mouse to choose the direction.' });
def({ id: 'mace', name: 'Flanged mace', kind: 'weapon', glb: 'ornate_medieval_mace', mass: 1.8, inv: [1, 3], value: 45, weapon: { damage: 36, reach: 0.9, speed: 0.85, type: 'blunt' }, shape: 'hull', desc: 'Crushes armour.' });
def({ id: 'axe', name: 'Woodsman axe', kind: 'tool', glb: 'wooden_axe', mass: 2.0, inv: [2, 4], value: 18, weapon: { damage: 30, reach: 1.0, speed: 0.8, type: 'axe' }, shape: 'hull', desc: 'Fells trees and enemies alike.' });
def({ id: 'hatchet', name: 'Hatchet', kind: 'tool', glb: 'hatchet', mass: 0.9, inv: [1, 2], value: 8, weapon: { damage: 18, reach: 0.7, speed: 1.3, type: 'axe' }, shape: 'hull', desc: 'Light and quick.' });
def({ id: 'shield', name: 'Kite shield', kind: 'shield', glb: 'kite_shield', mass: 4.5, inv: [3, 4], value: 35, shape: 'hull', desc: 'Right-click to block. Time it to parry.' });
def({ id: 'spade', name: 'Spade', kind: 'tool', glb: 'rusted_spade_01', mass: 2.0, inv: [1, 5], value: 5, weapon: { damage: 14, reach: 1.1, speed: 0.8, type: 'blunt' }, shape: 'hull', desc: 'For digging.' });
def({ id: 'broom', name: 'Broom', kind: 'tool', glb: 'wooden_broom', mass: 1.0, inv: [1, 6], value: 1, shape: 'hull', desc: 'Sweeps.' });
def({ id: 'pitchfork', name: 'Pitchfork', kind: 'tool', mass: 2.0, inv: [1, 6], value: 4, weapon: { damage: 20, reach: 1.6, speed: 0.75, type: 'pierce' }, shape: 'hull', desc: 'For hay — or a peasant uprising.', build: B((g) => { g.cyl('wood:planks|stain:honey|fin:raw', 0, 0, 0, 0.018, 0.018, 1.4, 8); g.box('iron', 0, 1.42, 0, 0.18, 0.025, 0.02); for (const x of [-0.08, 0, 0.08]) g.cyl('iron', x, 1.42, 0, 0.006, 0.002, 0.3, 6); }) });
def({ id: 'bow', name: 'Hunting bow', kind: 'weapon', mass: 0.8, inv: [1, 5], value: 30, weapon: { damage: 40, reach: 60, speed: 1, type: 'pierce' }, shape: 'hull', desc: 'Hold right-click to draw (arm injuries weaken the draw), left-click to loose.', build: B((g) => { for (let i = 0; i < 10; i++) { const t = i / 9 - 0.5; g.box('wood:dark|stain:chestnut|fin:waxed', Math.cos(t * 2.4) * 0.12 - 0.12, t * 1.4, 0, 0.025, 0.16, 0.02); } g.box('color:e8e0c8', 0.0, 0, 0, 0.003, 1.35, 0.003); }) });
def({ id: 'arrow', name: 'Arrow', kind: 'ammo', mass: 0.03, inv: [1, 3], value: 1, stack: 20, shape: 'hull', desc: 'Fletched with goose feathers.', build: B((g) => { g.cyl('wood:planks|stain:honey|fin:raw', 0, 0, 0, 0.004, 0.004, 0.75, 6); g.cyl('iron', 0, 0.75, 0, 0.008, 0.0, 0.04, 6); g.box('color:e0e0d8', 0, 0.05, 0, 0.002, 0.08, 0.02); }) });
def({ id: 'cannonball', name: 'Cannonball', kind: 'ammo', mass: 6, inv: [2, 2], value: 2, shape: 'ball', desc: 'Iron shot. Load it into a cannon.', build: B((g) => { g.ellipsoid('iron', 0, 0.06, 0, 0.06, 0.06, 0.06, 14); }) });
def({ id: 'powder', name: 'Powder keg', kind: 'material', mass: 10, inv: [3, 3], value: 20, shape: 'cyl', desc: 'Black powder. Keep away from flames.', build: B((g) => { g.cyl('mat:wooden_barrel', 0, 0, 0, 0.16, 0.16, 0.32, 14); g.cyl('iron', 0, 0.04, 0, 0.165, 0.165, 0.02, 14, false); g.cyl('iron', 0, 0.26, 0, 0.165, 0.165, 0.02, 14, false); }) });
// ---- misc ----
def({ id: 'candle', name: 'Tallow candle', kind: 'light', mass: 0.1, inv: [1, 2], value: 1, shape: 'cyl', desc: 'Place it and press E to light it. It burns down over the night.', build: B((g) => { g.cyl('wax|c:f2e8d0', 0, 0, 0, 0.014, 0.013, 0.2, 10); }) });
def({ id: 'lantern', name: 'Lantern', kind: 'light', glb: 'Lantern_01', mass: 1.2, inv: [2, 2], value: 12, shape: 'hull', desc: 'Carry light at night.' });
def({ id: 'cloth', name: 'Bolt of cloth', kind: 'material', mass: 2, inv: [2, 4], value: 10, shape: 'cyl', desc: 'Dyed woollen cloth.', build: B((g) => { g.push().rotateZ(Math.PI / 2); g.cyl('cloth:wool|dye:woad', 0, -0.25, 0, 0.07, 0.07, 0.5, 14); g.pop(); }) });
def({ id: 'hay', name: 'Hay bundle', kind: 'material', mass: 3, inv: [3, 2], value: 1, shape: 'hull', desc: 'Fodder for horses and donkeys.', build: B((g) => { g.ellipsoid('straw', 0, 0.12, 0, 0.3, 0.12, 0.18, 12, 0.6); }) });
def({ id: 'salt', name: 'Salt crock', kind: 'material', mass: 1, inv: [1, 2], value: 6, shape: 'cyl', desc: 'Salt raw meat to keep it for months (use it on meat in your pack).', build: B((g) => { g.cyl('ceramic|c:6a5040', 0, 0, 0, 0.06, 0.05, 0.12, 12); }) });
def({ id: 'bandage', name: 'Linen bandage', kind: 'medical', mass: 0.05, inv: [1, 1], value: 2, stack: 5, shape: 'box', desc: 'Stops bleeding.', build: B((g) => { g.push().rotateZ(Math.PI / 2); g.cyl('cloth:linen|dye:cream', 0, -0.04, 0, 0.03, 0.03, 0.08, 10); g.pop(); }) });
def({ id: 'key', name: 'Iron key', kind: 'key', mass: 0.05, inv: [1, 1], value: 2, shape: 'box', desc: 'Opens a particular lock.', build: B((g) => { g.cyl('iron', 0, 0, 0, 0.012, 0.012, 0.004, 10); g.box('iron', 0.05, 0.002, 0, 0.08, 0.004, 0.005); g.box('iron', 0.085, 0.002, 0.008, 0.01, 0.004, 0.012); }) });
def({ id: 'lockpick', name: 'Lockpick', kind: 'tool', mass: 0.02, inv: [1, 1], value: 5, stack: 10, shape: 'box', desc: 'For doors that are not yours.', build: B((g) => { g.box('iron', 0, 0, 0, 0.1, 0.003, 0.004); }) });
def({ id: 'coin_purse', name: 'Coin purse', kind: 'valuable', mass: 0.3, inv: [1, 1], value: 30, shape: 'ball', desc: 'Jingles.', build: B((g) => { g.ellipsoid('cloth:leather|dye:walnut', 0, 0.04, 0, 0.05, 0.045, 0.05, 10); }) });
def({ id: 'book', name: 'Book', kind: 'valuable', mass: 0.8, inv: [2, 2], value: 20, shape: 'box', desc: 'Hand-copied.', build: B((g) => { g.box('cloth:leather|dye:madder', 0, 0.025, 0, 0.2, 0.05, 0.26); g.box('paper', 0.005, 0.025, 0, 0.19, 0.042, 0.25); }) });
def({ id: 'rope', name: 'Coil of rope', kind: 'tool', mass: 2, inv: [2, 2], value: 3, shape: 'cyl', desc: 'Lead an animal with it.', build: B((g) => { for (let i = 0; i < 4; i++) { g.push().translate(0, 0.012 + i * 0.022, 0).rotateX(Math.PI / 2); g.cyl('cloth:hessian|dye:walnut', 0, -0.01, 0, 0.12, 0.12, 0.02, 16, false); g.pop(); } }) });
def({ id: 'wood_log', name: 'Firewood', kind: 'material', mass: 3, inv: [1, 3], value: 1, shape: 'cyl', desc: 'Split oak.', build: B((g) => { g.push().rotateZ(Math.PI / 2); g.cyl('mat:bark_brown_02', 0, -0.25, 0, 0.07, 0.07, 0.5, 8); g.pop(); }) });
def({ id: 'lantern_wood', name: 'Wooden lantern', kind: 'light', glb: 'wooden_lantern_01', mass: 1.5, inv: [2, 3], value: 8, shape: 'hull', desc: 'A rustic lantern.' });

export function buildItemMesh(d: ItemDef): THREE.Object3D | null {
  if (!d.build) return null;
  const g = new GeoBuilder();
  d.build(g);
  const grp = new THREE.Group();
  for (const m of meshesFrom(g.build())) grp.add(m);
  return grp;
}
export const ITEM_COUNT = () => Object.keys(ITEMS).length;
