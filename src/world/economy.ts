// Supply and demand: each town has a supply level per item that drifts back to normal; buying
// depletes it, selling floods it. Kingdoms produce different things (grain and cloth in Vanguardia,
// iron and timber in Ironreach), and the war front starves the river towns.
import type { Game } from '../game';
import type { NPC } from '../npc/npc';
import { ITEMS } from '../props/items';
import { Grid } from '../player/inventory';
import { mulberry32 } from '../core/noise';

const PRODUCE: Record<string, string[]> = {
  vanguardia: ['bread', 'apple', 'pear', 'cheese', 'cheese_box', 'cloth', 'onion', 'turnip', 'pastry', 'wine_jug', 'candle', 'salt'],
  ironreach: ['sword', 'mace', 'axe', 'hatchet', 'shield', 'spade', 'wood_log', 'salted_meat', 'smoked_fish', 'arrow', 'lockpick', 'powder', 'musket', 'lead_shot'],
  isles: ['fish', 'smoked_fish', 'lemon', 'rope', 'salt'],
  river: [],
};
const STOCK: Record<string, string[]> = {
  merchant: ['apple', 'pear', 'bread', 'cheese_box', 'onion', 'turnip', 'cloth', 'candle', 'basket', 'bucket', 'rope', 'saddlebag', 'salt', 'bandage', 'lantern', 'lockpick', 'cup', 'plate', 'jug'],
  innkeeper: ['bread', 'pastry', 'cheese', 'wine_jug', 'tankard', 'meat', 'smoked_fish', 'apple'],
  blacksmith: ['sword', 'mace', 'axe', 'hatchet', 'shield', 'spade', 'pitchfork', 'arrow', 'bow', 'musket', 'lead_shot', 'key', 'lockpick'],
};

export class Economy {
  supply = new Map<string, number>();      // `${site}:${item}` -> 0.3..2
  stocks = new Map<string, Grid>();
  lastDay = -1;
  constructor(public game: Game) {}
  private site(n: NPC) { return this.game.towns.byBuilding.get(n.person.home)?.site ?? 'aurelhold'; }
  private s(site: string, id: string) { return this.supply.get(site + ':' + id) ?? 1; }
  price(id: string, n: NPC, mode: 'buy' | 'sell') {
    const site = this.site(n);
    const plan = this.game.towns.plans.find((p) => p.site.id === site)!;
    const k = plan.site.kingdom;
    let base = ITEMS[id].value;
    if (PRODUCE[k]?.includes(id)) base *= 0.75;
    else if (k !== 'isles') base *= 1.2;
    // the war: everything is dearer near the river, weapons most of all
    const front = Math.max(0, 1 - Math.abs(plan.site.x - 150) / 900);
    base *= 1 + front * (ITEMS[id].weapon ? 0.8 : 0.35);
    const p = base / Math.sqrt(this.s(site, id));
    return Math.max(1, Math.round(mode === 'buy' ? p * 1.15 : p * 0.6));
  }
  traded(id: string, n: NPC, dir: number) {
    const key = this.site(n) + ':' + id;
    this.supply.set(key, Math.min(2, Math.max(0.3, (this.supply.get(key) ?? 1) + dir * 0.08)));
  }
  stockFor(n: NPC): Grid {
    let g = this.stocks.get(n.person.id);
    if (!g) {
      g = new Grid(8, 8, n.name, n.person.home);
      const r = mulberry32(n.person.cloth1 + 77);
      const list = STOCK[n.person.role] ?? STOCK.merchant;
      for (let i = 0; i < 14; i++) g.add(list[Math.floor(r() * list.length)], 1, { age: 0, owner: n.person.home });
      this.stocks.set(n.person.id, g);
    }
    return g;
  }
  update() {
    // once a day supply drifts back to normal and shops restock
    const day = Math.floor(this.game.dayCount);
    if (day === this.lastDay) return;
    this.lastDay = day;
    for (const [k, v] of this.supply) this.supply.set(k, v + (1 - v) * 0.4);
    this.stocks.clear();
  }
}
