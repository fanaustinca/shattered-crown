// Developer commands for the browser console (F12): spawn ships, armies, items, carts and animals,
// change the weather and time, teleport. Type help() to list them.
import * as THREE from 'three';
import type { Game } from './game';
import { Ship } from './vehicles/ship';
import { Cart } from './vehicles/cart';
import { ITEMS } from './props/items';
import { SITES } from './world/layout';
import type { WeatherKind } from './render/weather';

type Side = 'vanguardia' | 'ironreach';

export function installDevConsole(game: Game) {
  const g = game;
  /** a point in front of the player, on the ground */
  const ahead = (d = 4, side = 0) => {
    const p = g.player.pos, yaw = g.player.yaw;
    const x = p.x - Math.sin(yaw) * d + Math.cos(yaw) * side, z = p.z - Math.cos(yaw) * d - Math.sin(yaw) * side;
    return new THREE.Vector3(x, g.groundAt(x, z, p.y + 2), z);
  };
  /** nearest open water (sea or river) to the player, searching outward */
  const water = (need = 2.5) => {
    const p = g.player.pos;
    for (let r = 8; r < 4000; r += 8) for (let a = 0; a < 24; a++) {
      const x = p.x + Math.cos((a / 24) * Math.PI * 2) * r, z = p.z + Math.sin((a / 24) * Math.PI * 2) * r;
      const wl = g.world.waterLevelAt(x, z), h = g.world.heightAt(x, z);
      // room all round for the hull, not just under the keel
      let ok = wl - h > need;
      for (let k = 0; ok && k < 8; k++) { const xx = x + Math.cos(k * 0.785) * need * 4, zz = z + Math.sin(k * 0.785) * need * 4; ok = g.world.waterLevelAt(xx, zz) - g.world.heightAt(xx, zz) > need * 0.8; }
      if (ok) return new THREE.Vector3(x, wl, z);
    }
    return null;
  };
  const say = (m: string) => { console.log('%c' + m, 'color:#c9a04a'); g.hud.toast(m); return m; };
  const animal = (species: 'horse' | 'donkey' | 'cow' | 'pig', n = 1) => {
    for (let i = 0; i < n; i++) {
      const p = ahead(4 + i * 2.5, (i % 2 ? 1 : -1) * 1.5);
      g.spawnAnimal(species, p);
    }
    return say(`Spawned ${n} ${species}${n > 1 ? 's' : ''}.`);
  };

  const spawn = {
    horse: (n = 1) => animal('horse', n),
    donkey: (n = 1) => animal('donkey', n),
    cow: (n = 1) => animal('cow', n),
    pig: (n = 1) => animal('pig', n),
    cart: () => {
      const p = ahead(6);
      p.y += 0.6;
      g.carts.push(new Cart(g, p, g.player.yaw + Math.PI / 2, Math.floor(Math.random() * 10)));
      return say('A cart rolls up. Hitch a horse or donkey to it (E at the shafts).');
    },
    /** a field gun in front of you, pointing where you look (E to man it, click to fire, R to reload) */
    cannon: () => { const p = ahead(4); g.war.addCannon(p, g.player.yaw + Math.PI, (g.war.enlisted ?? 'vanguardia') as Side); return say('A loaded field gun. E to man it, click to fire, R to reload. Try it on a castle wall.'); },
    /** powder kegs (E to light the fuse; shoot or drop them and they go up at once) */
    powder: (n = 1) => spawn.item('powder', n),
    /** start the battle at the nearest front now */
    battle: () => {
      const F = g.war.fronts;
      const f = [...F.fronts].sort((a, b) => F.posAt(a, a.line).p.distanceTo(g.player.pos) - F.posAt(b, b.line).p.distanceTo(g.player.pos))[0];
      if (!f || f.live) return say('A battle is already being fought there.');
      F.begin(f);
      return say(`Battle at ${f.name}! Type tp(${Math.round(F.posAt(f, f.line).p.x)}, ${Math.round(F.posAt(f, f.line).p.z)}) to go there.`);
    },
    /** cavalry: n mounted soldiers in front of you */
    cavalry: (side: Side = 'vanguardia', n = 4) => { for (let i = 0; i < n; i++) g.war.spawnCavalry(side, ahead(10 + i * 3, (i % 2 ? 2 : -2))); return say(`${n} ${side} horsemen.`); },
    /** two squadrons engaging offshore, nearest the coast you're on */
    fleet: () => { const c = g.naval.startBattle(); return say(`The fleets meet about ${Math.round(c.distanceTo(g.player.pos))} m out to sea.`); },
    /** a wagon with a team of n horses already in harness */
    team: (n = 2, species: 'horse' | 'donkey' = 'horse') => {
      const p = ahead(9);
      p.y += 0.6;
      const c = new Cart(g, p, g.player.yaw + Math.PI, Math.floor(Math.random() * 10));
      g.carts.push(c);
      for (let i = 0; i < Math.min(4, n); i++) c.hitch(g.spawnAnimal(species, ahead(12 + i * 2, (i % 2 ? 1 : -1))));
      return say(`A wagon with ${Math.min(4, n)} ${species}s in harness. E on the bench to drive.`);
    },
    /** spawn.ship('brigantine' | 'frigate' | 'manowar' | 'boat') */
    ship: (kind: 'brigantine' | 'frigate' | 'manowar' | 'boat' | 'ship' = 'brigantine') => {
      const cls = kind === 'ship' ? 'brigantine' : kind;
      const draft = cls === 'manowar' ? 7.5 : cls === 'frigate' ? 5.2 : cls === 'brigantine' ? 3.4 : 1;
      const w = water(draft);
      if (!w) return say(`No water deep enough nearby (a ${cls} needs ${draft} m).`);
      const s = new Ship(g, w, Math.random() * Math.PI * 2, cls, cls === 'boat' ? 'Skiff' : ({ brigantine: 'The Summoned', frigate: 'HMS Resolute', manowar: 'Sovereign of the River' } as Record<string, string>)[cls]);
      g.ships.push(s);
      return say(`A ${cls === 'manowar' ? "man-o'-war" : cls} is waiting at ${Math.round(w.distanceTo(g.player.pos))} m.`);
    },
    boat: () => spawn.ship('boat'),
    /** an enemy army marching on the nearest town gate */
    siege: (n = 16) => {
      const P = g.player.pos;
      const gt = g.gates.gates.filter((x) => x.side).sort((a, b) => a.pos.distanceTo(P) - b.pos.distanceTo(P))[0];
      if (!gt) return say('No walled town near.');
      const foe = gt.side === 'vanguardia' ? 'ironreach' : 'vanguardia';
      const out = gt.inward.clone().negate();
      const across = new THREE.Vector3(-out.z, 0, out.x);
      for (let i = 0; i < n; i++) {
        const p = gt.pos.clone().addScaledVector(out, 120 + (i >> 2) * 3).addScaledVector(across, ((i % 4) - 1.5) * 2.5);
        p.y = g.world.heightAt(p.x, p.z);
        const s = g.war.spawnSoldier(foe, p);
        s.marching = true; s.sprint = false;
        s.path = [gt.pos.clone().addScaledVector(out, 4).addScaledVector(across, ((i % 4) - 1.5) * 1.2), gt.pos.clone().addScaledVector(gt.inward, 30)];
      }
      return say(`${n} ${foe} soldiers march on the gate of ${g.towns.plans.find((p) => p.site.id === gt.site)?.site.name}.`);
    },
    brigantine: () => spawn.ship('brigantine'),
    frigate: () => spawn.ship('frigate'),
    manowar: () => spawn.ship('manowar'),
    /** soldiers in a block in front of you */
    army: (side: Side = 'ironreach', n = 12) => {
      const made = [];
      for (let i = 0; i < n; i++) {
        const p = ahead(12 + Math.floor(i / 4) * 2, ((i % 4) - 1.5) * 1.6);
        made.push(g.war.spawnSoldier(side, p));
      }
      return say(`${n} ${side} soldiers form up ahead.`);
    },
    /** a marching column on the nearest road to the front */
    column: (side?: Side, n = 18) => say(`A column of ${g.war.spawnColumn(side, n)} soldiers marches to war.`),
    /** a squad that follows your orders (2 follow, 3 hold, 4 charge, 5 line) */
    squad: (n = 4) => {
      const side = (g.war.enlisted ?? 'vanguardia') as Side;
      g.war.enlisted = side;
      for (let i = 0; i < n; i++) { const s = g.war.spawnSoldier(side, ahead(3, (i - n / 2) * 1.4)); s.squad = true; s.order = 'follow'; }
      return say(`${n} soldiers of ${side} fall in behind you.`);
    },
    item: (id: string, n = 1) => {
      if (!ITEMS[id]) return say(`No item "${id}". Try spawn.items() for the list.`);
      for (let i = 0; i < n; i++) g.props.spawn(id, ahead(1.6, (i % 5 - 2) * 0.35).add(new THREE.Vector3(0, 0.6 + Math.floor(i / 5) * 0.4, 0)));
      return say(`Spawned ${n} × ${ITEMS[id].name ?? id}.`);
    },
    items: () => { const ids = Object.keys(ITEMS).sort(); console.log(ids.join(', ')); return `${ids.length} items`; },
  };

  const api = {
    spawn,
    weather: (kind: WeatherKind) => { g.weather.set(kind, true); return say(`Weather: ${kind}.`); },
    time: (h: number) => { g.hours = ((h % 24) + 24) % 24; return say(`Time: ${Math.floor(g.hours)}:${String(Math.floor((g.hours % 1) * 60)).padStart(2, '0')}.`); },
    tp: (where: string | number, z?: number) => {
      if (typeof where === 'number' && z !== undefined) { g.player.spawn(where, z); return say(`Teleported to ${where}, ${z}.`); }
      const s = SITES.find((x) => x.id === where || x.name.toLowerCase().includes(String(where).toLowerCase()));
      if (!s) return say('Places: ' + SITES.map((x) => x.id).join(', '));
      g.player.spawn(s.x + 8, s.z + 10);
      return say(`Teleported to ${s.name}.`);
    },
    money: (n = 500) => { g.interaction.money += n; return say(`+${n} pennies.`); },
    heal: () => { for (const l of Object.keys(g.player.health)) (g.player.health as Record<string, number>)[l] = 100; g.player.bleeding = 0; return say('Healed.'); },
    god: () => { g.player.god = !g.player.god; return say(`God mode ${g.player.god ? 'on' : 'off'}.`); },
    cloth: (on?: boolean) => { g.setCloth(on ?? !g.clothOn); return say(`Cloth simulation ${g.clothOn ? 'on' : 'off'}.`); },
    music: (on?: boolean) => { g.music.enabled = on ?? !g.music.enabled; return say(`Music ${g.music.enabled ? 'on' : 'off'}.`); },
    clearBounty: () => { g.law.clear(); return say('Your crimes are forgotten.'); },
    help: () => {
      const rows: [string, string][] = [
        ['spawn.horse(n) / donkey / cow / pig', 'animals in front of you'],
        ['spawn.cart()', 'a wagon (lead a horse to it and press X to hitch; up to 4)'],
        ['spawn.team(n)', 'a wagon with a team of 1–4 horses in harness'],
        ["spawn.ship('brigantine' | 'frigate' | 'manowar')", 'a warship on the nearest water deep enough for her'],
        ['spawn.siege(n)', 'an enemy army marching on the nearest town gate'],
        ['spawn.boat()', 'a rowing boat'],
        ['spawn.fleet(side)', 'two opposing squadrons for a sea battle nearby'],
        ['spawn.army(side, n)', "soldiers ('vanguardia' | 'ironreach') formed up ahead"],
        ['spawn.column(side, n)', 'a column marching down the nearest road to the front'],
        ['spawn.battle()', 'start the pitched battle at the nearest front now'],
        ['spawn.cannon() · spawn.powder(n)', 'a field gun to man · powder kegs (E lights the fuse)'],
        ['spawn.cavalry(side, n)', 'mounted soldiers'],
        ['spawn.squad(n)', 'soldiers who follow your orders (2/3/4/5)'],
        ['spawn.item(id, n) · spawn.items()', 'any item, e.g. spawn.item("apple", 10)'],
        ['weather(kind)', 'clear | cloudy | overcast | rain | storm | fog | snow'],
        ['time(h)', 'set the hour (0-24)'],
        ['tp(place) · tp(x, z)', 'teleport, e.g. tp("ironspire")'],
        ['money(n) · heal() · god() · clearBounty()', 'cheats'],
        ['cloth(on) · music(on)', 'toggle cloth simulation / ambient music'],
      ];
      console.log('%cShattered Crown dev commands', 'font-weight:bold;font-size:14px;color:#c9a04a');
      console.table(Object.fromEntries(rows.map(([a, b]) => [a, b])));
      return 'Type a command, e.g. spawn.horse(2)';
    },
  };
  Object.assign(window, api);
  console.log('%cShattered Crown — type help() for dev commands (spawn ships, armies, items, carts, horses…)', 'color:#c9a04a');
  return api;
}
