// Grid inventories: items occupy w×h cells; weight slows the carrier. Used for the pack, chests,
// drawers, saddlebags, cart beds and shop stock.
import { ITEMS } from '../props/items';

export interface InvItem { uid: number; id: string; n: number; x: number; y: number; rot: boolean; age: number; salted?: boolean; smoked?: boolean; owner: string | null; contents?: Grid }
let UID = 1;

export class Grid {
  items: InvItem[] = [];
  constructor(public w: number, public h: number, public name = 'Pack', public owner: string | null = null) {}
  size(it: { id: string; rot: boolean }) { const d = ITEMS[it.id]; const [a, b] = d?.inv ?? [1, 1]; return it.rot ? [b, a] : [a, b]; }
  fits(id: string, x: number, y: number, rot: boolean, ignore?: InvItem) {
    const [w, h] = this.size({ id, rot });
    if (x < 0 || y < 0 || x + w > this.w || y + h > this.h) return false;
    for (const o of this.items) {
      if (o === ignore) continue;
      const [ow, oh] = this.size(o);
      if (x < o.x + ow && x + w > o.x && y < o.y + oh && y + h > o.y) return false;
    }
    return true;
  }
  /** Add with automatic placement (tries both orientations); stacks where possible. */
  add(id: string, n = 1, extra: Partial<InvItem> = {}): InvItem | null {
    const d = ITEMS[id];
    if (!d) return null;
    if (d.stack) {
      const same = this.items.find((o) => o.id === id && o.n < d.stack! && !o.contents && Math.abs(o.age - (extra.age ?? 0)) < 24);
      if (same) { same.n += n; return same; }
    }
    for (const rot of [false, true]) for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.fits(id, x, y, rot)) {
        const it: InvItem = { uid: UID++, id, n, x, y, rot, age: 0, owner: null, ...extra };
        this.items.push(it);
        return it;
      }
    }
    return null;
  }
  remove(it: InvItem, n = it.n) {
    if (n >= it.n) this.items.splice(this.items.indexOf(it), 1);
    else it.n -= n;
  }
  get weight(): number { return this.items.reduce((s, it) => s + (ITEMS[it.id]?.mass ?? 0) * it.n + (it.contents?.weight ?? 0), 0); }
  get value(): number { return this.items.reduce((s, it) => s + (ITEMS[it.id]?.value ?? 0) * it.n, 0); }
  count(id: string) { return this.items.filter((i) => i.id === id).reduce((s, i) => s + i.n, 0); }
  find(id: string) { return this.items.find((i) => i.id === id) ?? null; }
  /** Age all food (game hours); cold storage passes a smaller factor. */
  age(hours: number, factor = 1) { for (const it of this.items) { if (ITEMS[it.id]?.food) it.age += hours * factor; it.contents?.age(hours, factor); } }
}
export function freshness(it: { id: string; age: number; salted?: boolean; smoked?: boolean }) {
  const f = ITEMS[it.id]?.food;
  if (!f) return 1;
  return Math.max(0, 1 - it.age / 24 / (f.spoilDays * (it.salted ? 15 : it.smoked ? 10 : 1)));
}
export function freshLabel(v: number) { return v > 0.8 ? 'fresh' : v > 0.5 ? 'good' : v > 0.25 ? 'stale' : v > 0.05 ? 'spoiling' : 'rotten'; }
