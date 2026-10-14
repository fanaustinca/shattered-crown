// HUD, title/pause/death screens, settings, map, the full Help (controls for everything),
// inventory with containers (drag & drop), dialogue and trade.
import * as THREE from 'three';
import type { Game } from '../game';
import { VERSION } from '../version';
import { CHANGELOG } from '../changelog';
import { settings, saveSettings, QUALITY, type QualityName } from '../core/settings';
import { ITEMS } from '../props/items';
import { Grid, freshness, freshLabel, type InvItem } from '../player/inventory';
import { LIMBS, type Limb } from '../player/player';
import type { NPC } from '../npc/npc';
import type { DNode } from '../npc/talk';
import { kingdomAt, nearestSite, HALF } from '../world/layout';
import { DESIGN_COUNT, enumerateCatalog } from '../props/furniture';

const $ = <T extends HTMLElement = HTMLElement>(html: string): T => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild as T; };

export const HELP: { title: string; rows: [string, string][] }[] = [
  { title: 'Moving', rows: [['W A S D', 'Walk'], ['Shift', 'Sprint (uses stamina)'], ['Space', 'Jump · swim up'], ['C / Ctrl', 'Crouch (quieter, harder to see) · dive when swimming'], ['Mouse', 'Look around'], ['V', 'Switch first / third person'], ['Mouse wheel', 'Third person: zoom']] },
  { title: 'Picking things up & carrying', rows: [['E', 'Pick up the thing you look at into your hands (heavy things are dragged)'], ['E (holding)', 'Put the held thing into the container you look at'], ['G', 'Put the held thing down gently'], ['Left click (holding)', 'Throw it — ceramics shatter on hard ground, apples roll down hills'], ['R + mouse', 'Rotate what you hold'], ['Mouse wheel', 'Hold closer / further'], ['F', 'Put it in your pack (if it fits — weight slows you)'], ['Drop into a basket/crate', 'Things that land inside a container stay in it and travel with it'], ['Tip a basket over', 'Its contents spill out']] },
  { title: 'Containers, doors & furniture', rows: [['E on a door', 'Open / close · pick the lock (needs a lockpick)'], ['X on a door', 'Knock'], ['E on a drawer / cupboard / chest lid', 'Open or close it — then F to search inside'], ['X (holding something)', 'Put it inside the open drawer'], ['E on a candle', 'Light / snuff it — candles burn down and melt over the night'], ['E on a bed', 'Sleep until morning — but if it is somebody\'s bed, they may come home'], ['E on a chair / bench', 'Sit · E again to stand']] },
  { title: 'Food, health & survival', rows: [['Q', 'Eat what you hold, or the freshest food in your pack'], ['Hunger', 'Eat regularly — starving drains your health and stamina recovery'], ['Food spoils', 'Fresh food rots in days; cellars, salt and smoke keep it far longer'], ['B', 'Bandage — stops bleeding'], ['Injuries', 'Hits land on head, torso, arms or legs. Hurt legs make you limp; hurt arms spoil your aim and bow draw'], ['Breath', 'Underwater you have about 30 seconds']] },
  { title: 'Animals', rows: [['E on a horse / donkey', 'Mount (W/S: change gait walk → trot → canter → gallop, Shift+W gallop, A/D turn, Space jump, E dismount)'], ['X on an animal', 'Lead it with a rope (needs rope) · X again to let go'], ['E holding a sack/saddlebag near a donkey or horse', 'Strap it on as a saddlebag'], ['F on an animal with bags', 'Open its saddlebags'], ['X holding food', 'Feed an animal (calms it)'], ['Note', 'Riding off on someone\'s horse is horse theft']] },
  { title: 'Carts', rows: [['X near a cart while leading a horse/donkey', 'Hitch it to the cart — up to four: one between the shafts, a pair on the pole, then leaders in front'], ['X on the cart (team hitched)', 'Unhitch the last animal'], ['E on the driver\'s bench', 'Drive: W/S reins (faster/slower), A/D steer, Space brake, E get down. More horses pull harder and run faster'], ['Climb or jump on', 'You can ride in the bed of a moving cart'], ['Load it', 'Put crates, sacks and baskets in the bed — they ride along'], ['F on the shafts (no animal)', 'Pull the cart by hand']] },
  { title: 'Ships & boats', rows: [['Three warships', 'Brigantine (one deck, 10 guns), frigate (a gun deck below, ~40 guns), man-o\'-war (three gun decks, ~100 guns — too deep a draught for the river)'], ['E at the ship\'s wheel', 'Take the helm: A/D spin the wheel, W/S raise / lower sail, Z/C trim the yards, X anchor, E leave'], ['Q / R at the helm', 'Fire a broadside: Q larboard (left), R starboard (right). Each side reloads in about 25 s'], ['Below decks', 'Go down the hatches and ladders: gun decks, the orlop and hold, hammocks, and the captain\'s great cabin aft (E on its door)'], ['Wind', 'The pennant on the HUD shows the wind. Sails pull hardest with the wind on the quarter; you can\'t sail straight into it'], ['Sea battles', 'Squadrons of both kingdoms meet offshore now and then; shot holes the hull and she settles and sinks'], ['E in a rowing boat', 'Row: W/S, A/D turn']] },
  { title: 'Fighting', rows: [['1', 'Draw / sheathe your best weapon'], ['Left click', 'Swing. Move the mouse as you click to choose the direction: left, right, up (overhead) or thrust'], ['Right click', 'Block (with a shield or blade). Block just as a blow lands to parry'], ['Bow', 'Hold right click to draw, left click to loose'], ['Axe on a tree', 'Chop it down'], ['Cannons', 'E to man one: mouse aims, left click fires (smoke and recoil!), R reloads']] },
  { title: 'War & command', rows: [['The fronts', 'Each bridge is a front. Every few minutes the armies meet there in a pitched battle: they form up in ranks with cavalry on the wings, advance, then charge. The winner pushes the front over the river toward the enemy\'s towns'], ['Journal (Esc → Journal)', 'Where each front stands and who is winning'], ['Join a side', 'Ask a guard to enlist; you get a squad of your own'], ['2', 'Squad: follow me'], ['3', 'Squad: hold this position'], ['4', 'Squad: charge!'], ['5', 'Squad: form a line'], ['Cannons', 'E to man one: mouse aims, left click fires, R reloads. Shot cracks castle walls and enough of it brings a section down into rubble'], ['Powder kegs', 'X lights the fuse — run. A keg also goes up if it\'s shot or dropped hard']] },
  { title: 'Law & people', rows: [['E on a person', 'Talk: pick a topic with the mouse or 1–9; every answer opens follow-up questions. People remember you, gossip, give directions, and may ask for help with an errand'], ['Errands', 'Bring what they asked for and talk to them again to be paid'], ['Overhearing', 'Townsfolk stop to chat with each other; walk close to hear what they say'], ['Stealing', 'If someone sees or hears you take what is not yours, you gain a bounty in that kingdom'], ['Wanted', 'Guards will try to arrest you; posters go up at the town gates. Pay your fine with F on a guard'], ['Trespass', 'People go home at night and lock up. Don\'t be found in their house — or their bed']] },
  { title: 'Menus', rows: [['Tab / I', 'Inventory (drag items between your pack and containers; right-click an item for actions)'], ['M', 'Map'], ['H', 'This help'], ['Esc', 'Pause menu / close windows'], ['F5 / F9', 'Quick save / quick load'], ['Fast travel', 'Talk to the stablemaster at a town\'s stable yard (outside the gates on the main road) for a horse and guide, or the ferryman at a harbour for a boat. You arrive at the destination\'s stable yard; time passes on the road'], ['Buy a horse', 'Stablemasters sell horses (60 pennies)']] },
  { title: 'World & settings', rows: [['Weather', 'Fronts roll through: clear, cloud, rain, thunderstorms, fog, and snow in the high mountains. Wind drives the waves — ships pitch and roll harder in a storm'], ['Music', 'Quiet pieces play now and then; set the music volume (or 0 to turn it off) in Settings'], ['Cloth physics', 'Dresses, cloaks and banners are simulated cloth near you; toggle it in Settings'], ['War', 'Columns of soldiers march along the roads to the river front; skirmishes break out at the bridges']] },
  { title: 'Developer console (F12)', rows: [['help()', 'List every dev command'], ['spawn.horse(n) · spawn.team(n) · spawn.cart()', 'Spawn animals, a wagon with n horses, an empty wagon'], ["spawn.ship('brigantine' | 'frigate' | 'manowar')", 'A warship on the nearest deep enough water'], ['spawn.fleet() · spawn.battle()', 'A sea battle offshore · the battle at the nearest front'], ['spawn.cavalry(side, n) · spawn.cannon() · spawn.powder(n)', 'Horsemen · a field gun · powder kegs'], ['spawn.army(side, n) · spawn.column(side)', 'Spawn soldiers, or a column marching to war'], ['spawn.item(id, n)', 'Spawn any item (spawn.items() lists them)'], ['weather(kind) · time(h) · tp(place)', 'Change the weather, the hour, or teleport']] },
];

export class Hud {
  root: HTMLElement;
  prompt: HTMLElement; target: HTMLElement; toastBox: HTMLElement; sub: HTMLElement; place: HTMLElement; bars: HTMLElement; limbs: Record<string, HTMLElement> = {};
  hurt: HTMLElement; money: HTMLElement; wind: HTMLElement; fps: HTMLElement;
  constructor(public game: Game) {
    const ui = document.getElementById('ui')!;
    this.root = $(`<div class="hud">
      <div class="cross"></div>
      <div class="target"></div>
      <div class="prompt"></div>
      <div class="place"></div>
      <div class="money"></div>
      <div class="wind" title="Wind"><div class="vane"></div></div>
      <div class="toasts"></div>
      <div class="subtitle"></div>
      <div class="vitals">
        <svg class="body" viewBox="0 0 40 80">
          <circle data-l="head" cx="20" cy="9" r="7"/><rect data-l="torso" x="12" y="17" width="16" height="25" rx="4"/>
          <rect data-l="larm" x="29" y="18" width="6" height="24" rx="3"/><rect data-l="rarm" x="5" y="18" width="6" height="24" rx="3"/>
          <rect data-l="lleg" x="21" y="43" width="7" height="33" rx="3"/><rect data-l="rleg" x="12" y="43" width="7" height="33" rx="3"/>
        </svg>
        <div class="bars"><div class="bar st"><i></i></div><div class="bar hu"><i></i></div><div class="bar br"><i></i></div><div class="bleed">Bleeding — press B</div></div>
      </div>
      <div class="ver">Shattered Crown v${VERSION}</div>
      <div class="fps"></div>
      <div class="hurt"></div>
    </div>`);
    ui.appendChild(this.root);
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.prompt = q('.prompt'); this.target = q('.target'); this.toastBox = q('.toasts'); this.sub = q('.subtitle'); this.place = q('.place'); this.bars = q('.bars'); this.hurt = q('.hurt'); this.money = q('.money'); this.wind = q('.vane'); this.fps = q('.fps');
    this.root.querySelectorAll('[data-l]').forEach((e) => { this.limbs[(e as HTMLElement).dataset.l!] = e as HTMLElement; });
  }
  toast(msg: string, kind = '') {
    const t = $(`<div class="toast ${kind}">${msg}</div>`);
    this.toastBox.appendChild(t);
    setTimeout(() => t.classList.add('out'), 3800);
    setTimeout(() => t.remove(), 4600);
    while (this.toastBox.children.length > 5) this.toastBox.firstElementChild!.remove();
  }
  subtitle(name: string, text: string, pos: THREE.Vector3) {
    if (pos.distanceTo(this.game.player.pos) > 30) return;
    this.sub.innerHTML = `<b>${name}:</b> ${text}`;
    this.sub.classList.add('show');
    clearTimeout((this.sub as HTMLElement & { _t?: number })._t);
    (this.sub as HTMLElement & { _t?: number })._t = window.setTimeout(() => this.sub.classList.remove('show'), 4500);
  }
  flashHurt(limb: Limb) { this.hurt.classList.remove('on'); void this.hurt.offsetWidth; this.hurt.classList.add('on'); this.limbs[limb]?.classList.add('flash'); setTimeout(() => this.limbs[limb]?.classList.remove('flash'), 400); }
  update() {
    const g = this.game, p = g.player, ia = g.interaction;
    this.root.style.display = g.freeCam || g.ui.screen === 'title' ? 'none' : '';
    const keys = ia.actions.slice(0, 4).map((a) => `<div><kbd>${a.key === 'LMB' ? '🖱' : a.key}</kbd> ${a.label}</div>`).join('');
    this.prompt.innerHTML = keys;
    this.target.textContent = ia.targetName;
    for (const l of LIMBS) {
      const h = p.health[l];
      this.limbs[l].style.fill = `hsl(${Math.max(0, h * 1.1)}, 55%, ${30 + h * 0.15}%)`;
    }
    (this.bars.querySelector('.st i') as HTMLElement).style.width = `${p.stamina / p.maxStamina * 100}%`;
    (this.bars.querySelector('.hu i') as HTMLElement).style.width = `${p.satiety}%`;
    const br = this.bars.querySelector('.br') as HTMLElement;
    br.style.display = p.breath < 29.5 ? '' : 'none';
    (br.querySelector('i') as HTMLElement).style.width = `${p.breath / 30 * 100}%`;
    (this.bars.querySelector('.bleed') as HTMLElement).style.display = p.bleeding > 0.01 ? '' : 'none';
    const s = nearestSite(p.pos.x, p.pos.z);
    const k = kingdomAt(p.pos.x, p.pos.z);
    const hh = Math.floor(g.hours), mm = Math.floor((g.hours % 1) * 60);
    const kName = { vanguardia: 'Vanguardia', ironreach: 'Ironreach', river: 'The River Front', isles: 'The Outer Isles' }[k];
    this.place.innerHTML = `<b>${s.d < s.site.r * 1.3 ? s.site.name : kName}</b><span>${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${g.weather.kind}${g.law.bountyIn(k) > 0 ? ` · <em>Wanted: ${g.law.bountyIn(k)}d</em>` : ''}</span>`;
    this.money.textContent = `${ia.money} pennies · ${ia.pack.weight.toFixed(1)} / ${p.maxCarry} kg`;
    const wd = g.weather.windDir - p.yaw;
    this.wind.style.transform = `rotate(${(-wd * 180) / Math.PI + 90}deg) scaleX(${0.6 + g.weather.cur.wind * 0.3})`;
    this.fps.style.display = settings.showFps ? '' : 'none';
    if (settings.showFps) this.fps.textContent = `${(1000 / Math.max(1, g.avgFrame)).toFixed(0)} fps · ${g.pipeline.stats.calls} draws`;
  }
}

export class UI {
  screen: 'title' | 'play' | 'pause' | 'inventory' | 'dialogue' | 'trade' | 'dead' | 'map' = 'title';
  panel: HTMLElement | null = null;
  /** the title's Begin action, kept so returning from Settings/Help to the title can still start the game */
  private onBegin: (() => void) | null = null;
  /** a pause panel opened from the title screen (Settings/Help before starting) */
  private fromTitle = false;
  private titleKey: ((e: KeyboardEvent) => void) | null = null;
  constructor(public game: Game) {
    window.addEventListener('keydown', (e) => {
      const g = this.game;
      if (!g.ready || (g.freeCam && !this.fromTitle)) return;
      if (e.code === 'Escape') { if (this.fromTitle && this.screen === 'pause') this.showTitle(); else if (this.screen === 'play') this.openPause(); else if (this.screen !== 'title' && this.screen !== 'dead') this.close(); }
      else if ((e.code === 'Tab' || e.code === 'KeyI') && (this.screen === 'play' || this.screen === 'inventory')) { if (this.screen === 'inventory') this.close(); else { g.interaction.openContainer = null; this.openInventory(); } }
      else if (e.code === 'KeyM' && (this.screen === 'play' || this.screen === 'map')) { if (this.screen === 'map') this.close(); else this.openPause('map'); }
      else if (e.code === 'KeyH' && (this.screen === 'play' || this.screen === 'pause')) this.openPause('help');
      else if (e.code === 'F5' && this.screen === 'play') { e.preventDefault(); g.save(); }
      else if (e.code === 'F9' && this.screen === 'play') { e.preventDefault(); g.load(); }
    });
  }
  private mount(html: string, cls: string) {
    this.panel?.remove();
    this.panel = $(`<div class="panel ${cls}">${html}</div>`);
    document.getElementById('ui')!.appendChild(this.panel);
    this.game.input.uiOpen = true;
    this.game.input.unlock();
    return this.panel;
  }
  close() {
    const oc = this.game.interaction.openContainer?.grid as (Grid & { onClose?: () => void }) | undefined;
    oc?.onClose?.();
    this.panel?.remove(); this.panel = null;
    this.screen = 'play';
    this.fromTitle = false;
    this.game.input.uiOpen = false;
    this.game.paused = false;
    this.game.input.lock();
  }

  showTitle(onBegin?: () => void) {
    if (onBegin) this.onBegin = onBegin;
    this.fromTitle = false;
    this.screen = 'title';
    const p = this.mount(`<div class="title">
      <div class="crest">♛</div><h1>Shattered Crown</h1><p class="tag">Two kingdoms. One river. Everything is real.</p>
      <div class="btns"><button class="go">Begin</button><button class="help">Controls & Help</button><button class="set">Settings</button></div>
      <div class="ver">v${VERSION} · ${DESIGN_COUNT} furniture designs · ${enumerateCatalog().length} variants · CC0 assets from Poly Haven</div>
    </div>`, 'titlepanel');
    // starting must never depend on audio or pointer lock succeeding
    let begun = false;
    const begin = () => {
      if (begun || this.screen !== 'title') return; begun = true;
      window.removeEventListener('keydown', onKey); this.titleKey = null;
      const fn = this.onBegin; this.onBegin = null;
      try { fn?.(); } catch (e) { console.error(e); }
      try { this.close(); } catch (e) { console.error(e); this.panel?.remove(); this.panel = null; this.screen = 'play'; this.game.paused = false; this.game.input.uiOpen = false; }
      try { this.game.audio.start(); } catch (e) { console.error(e); }
    };
    const onKey = (e: KeyboardEvent) => { if (this.screen === 'title' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); begin(); } };
    if (this.titleKey) window.removeEventListener('keydown', this.titleKey);
    this.titleKey = onKey;
    window.addEventListener('keydown', onKey);
    p.querySelector('.go')!.addEventListener('click', begin);
    p.querySelector('.help')!.addEventListener('click', () => this.openPause('help', true));
    p.querySelector('.set')!.addEventListener('click', () => this.openPause('settings', true));
  }

  openPause(tab: 'help' | 'settings' | 'map' | 'journal' | 'main' = 'main', fromTitle = false) {
    this.screen = tab === 'map' ? 'map' : 'pause';
    this.fromTitle = fromTitle;
    this.game.paused = true;
    const p = this.mount(`<div class="pause">
      <nav><button data-t="main">${fromTitle ? '‹ Title' : 'Game'}</button><button data-t="map">Map</button><button data-t="journal">Journal</button><button data-t="settings">Settings</button><button data-t="help">Help</button></nav>
      <section></section>
    </div>`, 'pausepanel');
    const sec = p.querySelector('section')!;
    const show = (t: string) => {
      p.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === t));
      if (t === 'main' && fromTitle) { this.showTitle(); return; }
      if (t === 'main') {
        sec.innerHTML = `<h2>Paused</h2><div class="btns"><button class="r">Resume</button><button class="s">Save</button><button class="l">Load</button></div><p class="dim">v${VERSION}</p>`;
        sec.querySelector('.r')!.addEventListener('click', () => this.close());
        sec.querySelector('.s')!.addEventListener('click', () => { this.game.save(); });
        sec.querySelector('.l')!.addEventListener('click', () => { this.game.load(); this.close(); });
      } else if (t === 'help') {
        sec.innerHTML = `<h2>Help</h2><div class="subtabs"><button data-h="controls" class="on">Controls</button><button data-h="new">What's new</button><button data-h="items">Items</button></div><div class="hbody"></div>`;
        const body = sec.querySelector('.hbody') as HTMLElement;
        const hshow = (h: string) => {
          sec.querySelectorAll('.subtabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.h === h));
          if (h === 'controls') body.innerHTML = `<div class="help">${HELP.map((x) => `<div class="hs"><h3>${x.title}</h3><table>${x.rows.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}</table></div>`).join('')}</div>`;
          else if (h === 'new') body.innerHTML = `<div class="news">${CHANGELOG.map((c) => `<h3>v${c.v} <small>${c.date}</small></h3><ul>${c.items.map((i) => `<li>${i}</li>`).join('')}</ul>`).join('')}</div>`;
          else {
            const KIND: Record<string, string> = { food: 'Food', drink: 'Drink', weapon: 'Weapons', shield: 'Shields', tool: 'Tools', container: 'Containers', material: 'Materials', valuable: 'Valuables', medical: 'Medicine', light: 'Lights', ammo: 'Ammunition', key: 'Keys', misc: 'Other' };
            const groups = new Map<string, typeof ITEMS[string][]>();
            for (const d of Object.values(ITEMS)) { const k = KIND[d.kind] ?? 'Other'; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(d); }
            const use = (d: typeof ITEMS[string]) => {
              const u: string[] = [];
              if (d.food) u.push(`Eat with Q: +${d.food.nutrition} food, ${d.food.raw ? 'better cooked, ' : ''}spoils in ~${d.food.spoilDays} days`);
              if (d.weapon) u.push(`Weapon: ${d.weapon.damage} damage, ${d.weapon.reach} m reach, ${d.weapon.type}${d.hold === 'two' ? ', two-handed' : ''}`);
              if (d.container) u.push(`Holds a ${d.container.w}×${d.container.h} grid${d.container.open ? '; things dropped in stay in' : ''}`);
              if (d.breakable) u.push('Breaks if thrown hard');
              if (d.kind === 'medical') u.push('B to bandage: stops bleeding');
              if (d.kind === 'light') u.push('E to light / put out');
              if (d.id === 'lockpick') u.push('Pick locks on doors and chests');
              if (d.id === 'rope') u.push('X on an animal to lead it');
              if (d.id === 'saddlebag' || d.id === 'sack') u.push('Strap onto a horse or donkey (E near it)');
              if (d.id === 'salt') u.push('Salt raw meat (right-click it) to keep it for months');
              return u.join(' · ');
            };
            body.innerHTML = `<input class="isearch" placeholder="Search items…"><div class="items">${[...groups.entries()].map(([k, list]) => `<div class="ig"><h3>${k}</h3><table>${list.sort((a, b) => a.name.localeCompare(b.name)).map((d) => `<tr data-n="${(d.name + ' ' + d.desc).toLowerCase()}"><td><b>${d.name}</b><br><span class="dim">${d.mass} kg · ${d.value}d · ${d.inv[0]}×${d.inv[1]}</span></td><td>${d.desc}${use(d) ? `<br><em>${use(d)}</em>` : ''}</td></tr>`).join('')}</table></div>`).join('')}</div>`;
            const inp = body.querySelector('.isearch') as HTMLInputElement;
            inp.addEventListener('input', () => { const q = inp.value.toLowerCase(); body.querySelectorAll('tr[data-n]').forEach((r) => { (r as HTMLElement).style.display = (r as HTMLElement).dataset.n!.includes(q) ? '' : 'none'; }); });
          }
        };
        sec.querySelectorAll('.subtabs button').forEach((b) => b.addEventListener('click', () => hshow((b as HTMLElement).dataset.h!)));
        hshow('controls');
      } else if (t === 'settings') {
        sec.innerHTML = `<h2>Settings</h2><div class="settings">
          <label>Graphics quality <select class="q">${(Object.keys(QUALITY) as QualityName[]).map((q) => `<option ${q === settings.quality ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
          <label>Field of view <input class="fov" type="range" min="55" max="100" value="${settings.fov}"><span>${settings.fov}°</span></label>
          <label>Mouse sensitivity <input class="sens" type="range" min="0.2" max="3" step="0.05" value="${settings.sensitivity}"></label>
          <label>Invert mouse Y <input class="inv" type="checkbox" ${settings.invertY ? 'checked' : ''}></label>
          <label>Simulation bubble (AI radius) <input class="bub" type="range" min="60" max="400" step="10" value="${settings.simRadius}"><span>${settings.simRadius} m</span></label>
          <label>Volume <input class="vol" type="range" min="0" max="1" step="0.05" value="${settings.volume}"></label>
          <label>Music <input class="mus" type="range" min="0" max="1" step="0.05" value="${settings.music}"></label>
          <label>Cloth physics (dresses, cloaks, banners) <input class="cloth" type="checkbox" ${settings.cloth ? 'checked' : ''}></label>
          <label>Third person by default <input class="tp" type="checkbox" ${settings.thirdPerson ? 'checked' : ''}></label>
          <label>Show FPS <input class="fps" type="checkbox" ${settings.showFps ? 'checked' : ''}></label>
          <p class="dim">Quality changes take effect after reloading the page. The simulation bubble sets how far around you people and animals are fully simulated; beyond it they follow their schedules cheaply.</p></div>`;
        const on = (sel: string, ev: string, fn: (el: HTMLInputElement) => void) => sec.querySelector(sel)!.addEventListener(ev, (e) => { fn(e.target as HTMLInputElement); saveSettings(); });
        on('.q', 'change', (el) => { settings.quality = el.value as QualityName; });
        on('.fov', 'input', (el) => { settings.fov = +el.value; (el.nextElementSibling as HTMLElement).textContent = el.value + '°'; });
        on('.sens', 'input', (el) => { settings.sensitivity = +el.value; });
        on('.mus', 'input', (el) => { settings.music = +el.value; });
        on('.cloth', 'change', (el) => { this.game.setCloth((el as HTMLInputElement).checked); });
        on('.inv', 'change', (el) => { settings.invertY = el.checked; });
        on('.bub', 'input', (el) => { settings.simRadius = +el.value; (el.nextElementSibling as HTMLElement).textContent = el.value + ' m'; });
        on('.vol', 'input', (el) => { settings.volume = +el.value; this.game.audio.setVolume(+el.value); });
        on('.tp', 'change', (el) => { settings.thirdPerson = el.checked; this.game.player.thirdPerson = el.checked; });
        on('.fps', 'change', (el) => { settings.showFps = el.checked; });
      } else if (t === 'map') {
        const img = this.game.mapImage();
        const pp = this.game.player.pos;
        const toMap = (x: number, z: number) => [((x + HALF) / (HALF * 2)) * 100, ((z + HALF) / (HALF * 2)) * 100];
        const [px, pz] = toMap(pp.x, pp.z);
        const labels = this.game.towns.plans.filter((pl) => !pl.minor).map((pl) => { const [x, z] = toMap(pl.site.x, pl.site.z); return `<div class="lbl ${pl.site.kind}" style="left:${x}%;top:${z}%">${pl.site.name}</div>`; }).join('');
        sec.innerHTML = `<h2>The Realm</h2><div class="map"><img src="${img}"/>${labels}<div class="me" style="left:${px}%;top:${pz}%;transform:translate(-50%,-50%) rotate(${-this.game.player.yaw}rad)">▲</div><div class="kl v">VANGUARDIA</div><div class="kl i">IRONREACH</div></div>`;
      } else if (t === 'journal') {
        const law = this.game.law;
        sec.innerHTML = `<h2>Journal</h2><h3>Bounties</h3><ul>${Object.entries(law.bounty).map(([k, v]) => `<li>${k}: ${Math.round(v)} pennies</li>`).join('')}</ul><h3>Crimes</h3><ul>${law.log.slice(-12).reverse().map((l) => `<li>${l.crime} in ${l.where}</li>`).join('') || '<li class="dim">None — so far.</li>'}</ul>
        <h3>The war</h3><p>${this.game.war.status()}</p>`;
      }
    };
    p.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => show((b as HTMLElement).dataset.t!)));
    show(tab);
  }

  // ---------------- inventory ----------------
  openInventory() {
    const g = this.game, ia = g.interaction;
    this.screen = 'inventory';
    const p = this.mount(`<div class="inv"><div class="col"><h2>Pack</h2><div class="grid pack"></div><div class="info"></div></div><div class="col cont"></div><div class="tip"></div></div>`, 'invpanel');
    const CELL = 46;
    const tip = p.querySelector('.tip') as HTMLElement;
    const render = () => {
      const draw = (grid: Grid, el: HTMLElement) => {
        el.innerHTML = '';
        el.style.width = `${grid.w * CELL}px`; el.style.height = `${grid.h * CELL}px`;
        for (const it of grid.items) {
          const [w, h] = grid.size(it);
          const d = ITEMS[it.id];
          const fr = d.food ? freshness(it) : 1;
          const e = $(`<div class="item ${d.kind} ${it.owner && it.owner !== 'player' ? 'stolen' : ''}" draggable="true" style="left:${it.x * CELL}px;top:${it.y * CELL}px;width:${w * CELL - 4}px;height:${h * CELL - 4}px">
            <span>${d.name}${it.n > 1 ? ` ×${it.n}` : ''}</span>${d.food ? `<em style="background:hsl(${fr * 110},60%,40%)">${freshLabel(fr)}</em>` : ''}${it.contents?.items.length ? `<em>${it.contents.items.length} inside</em>` : ''}</div>`);
          e.addEventListener('dragstart', (ev) => { (ev as DragEvent).dataTransfer!.setData('text', String(it.uid)); dragging = { it, from: grid }; });
          e.addEventListener('mouseenter', () => { tip.innerHTML = `<b>${d.name}</b><br>${d.desc}<br><span class="dim">${(d.mass * it.n).toFixed(1)} kg · worth ${d.value * it.n}d${d.food ? ` · ${freshLabel(fr)}` : ''}${it.owner && it.owner !== 'player' ? ' · <em>stolen</em>' : ''}</span>`; tip.style.display = 'block'; });
          e.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
          e.addEventListener('contextmenu', (ev) => { ev.preventDefault(); menu(it, grid, ev as MouseEvent); });
          e.addEventListener('dblclick', () => { if (grid === ia.pack && ia.openContainer) move(it, grid, ia.openContainer.grid); else if (grid !== ia.pack) move(it, grid, ia.pack); });
          el.appendChild(e);
        }
      };
      draw(ia.pack, p.querySelector('.pack') as HTMLElement);
      (p.querySelector('.info') as HTMLElement).innerHTML = `${ia.pack.weight.toFixed(1)} / ${g.player.maxCarry} kg · ${ia.money} pennies${ia.hands ? ` · in hand: ${ITEMS[ia.hands.id].name}` : ''}<br><span class="dim">Drag to move · double-click to transfer · right-click for actions</span>`;
      const cont = p.querySelector('.cont') as HTMLElement;
      if (ia.openContainer) {
        cont.innerHTML = `<h2>${ia.openContainer.title}</h2><div class="grid other"></div><div class="info"><button class="all">Take all</button>${ia.openContainer.owner && ia.openContainer.owner !== 'player' ? ' <em>Not yours</em>' : ''}</div>`;
        draw(ia.openContainer.grid, cont.querySelector('.other') as HTMLElement);
        cont.querySelector('.all')!.addEventListener('click', () => { for (const it of [...ia.openContainer!.grid.items]) move(it, ia.openContainer!.grid, ia.pack); });
        bindDrop(cont.querySelector('.other') as HTMLElement, ia.openContainer.grid);
      } else cont.innerHTML = `<h2>Ground</h2><div class="drop">Drag items here to drop them into your hands</div>`;
      bindDrop(p.querySelector('.pack') as HTMLElement, ia.pack);
      const ground = cont.querySelector('.drop') as HTMLElement | null;
      if (ground) { ground.addEventListener('dragover', (e) => e.preventDefault()); ground.addEventListener('drop', () => { if (dragging) { ia.dropFromPack(dragging.it, dragging.from); dragging = null; this.close(); } }); }
    };
    let dragging: { it: InvItem; from: Grid } | null = null;
    const move = (it: InvItem, from: Grid, to: Grid, x?: number, y?: number) => {
      if (from === to && x !== undefined) { if (to.fits(it.id, x, y!, it.rot, it)) { it.x = x; it.y = y!; } render(); return; }
      if (to === ia.pack && ia.pack.weight + (ITEMS[it.id].mass * it.n) > g.player.maxCarry * 1.3) { g.hud.toast('Too heavy to carry.'); return; }
      const placed = x !== undefined && to.fits(it.id, x, y!, it.rot) ? (to.items.push({ ...it, x, y: y! }), true) : !!to.add(it.id, it.n, { age: it.age, owner: it.owner, contents: it.contents, salted: it.salted, smoked: it.smoked });
      if (!placed) { g.hud.toast('No room.'); return; }
      from.remove(it);
      // taking from someone else's container in view of witnesses is theft
      if (to === ia.pack && it.owner && it.owner !== 'player') g.law.crime('theft', g.player.pos, it.owner, Math.min(1, ITEMS[it.id].value / 40), true);
      render();
    };
    const bindDrop = (el: HTMLElement, grid: Grid) => {
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!dragging) return;
        const r = el.getBoundingClientRect();
        const x = Math.floor(((e as DragEvent).clientX - r.left) / CELL), y = Math.floor(((e as DragEvent).clientY - r.top) / CELL);
        move(dragging.it, dragging.from, grid, x, y);
        dragging = null;
      });
    };
    const menu = (it: InvItem, grid: Grid, ev: MouseEvent) => {
      p.querySelector('.ctx')?.remove();
      const d = ITEMS[it.id];
      const opts: [string, () => void][] = [];
      if (d.food) opts.push(['Eat', () => { ia.consume(it.id, freshness(it)); grid.remove(it, 1); }]);
      if (d.food?.raw && it.id === 'meat' && ia.pack.count('salt')) opts.push(['Salt it (keeps for months)', () => { grid.remove(it, 1); ia.pack.add('salted_meat', 1, { age: 0 }); }]);
      if (d.weapon) opts.push(['Hold in hand', () => { ia.hands = it; g.combat.drawn = true; g.playerBody.setWeapon(d); }]);
      if (d.kind === 'medical') opts.push(['Use', () => ia.useBandage()]);
      if (it.contents) opts.push(['Open', () => { ia.openContainer = { grid: it.contents!, title: d.name, owner: null }; }]);
      opts.push(['Drop', () => { ia.dropFromPack(it, grid); }]);
      const m = $(`<div class="ctx" style="left:${ev.clientX}px;top:${ev.clientY}px">${opts.map(([l], i) => `<div data-i="${i}">${l}</div>`).join('')}</div>`);
      m.querySelectorAll('div').forEach((e) => e.addEventListener('click', () => { opts[+(e as HTMLElement).dataset.i!][1](); m.remove(); if (this.screen === 'inventory') render(); }));
      p.appendChild(m);
    };
    render();
  }

  // ---------------- dialogue & trade ----------------
  openDialogue(n: NPC) {
    const g = this.game;
    this.screen = 'dialogue';
    const pers = n.person;
    const p = this.mount(`<div class="dlg"><h2>${n.name} <small>${pers.role}</small></h2><div class="log"></div><div class="opts"></div><p class="dim">1–9 to choose · Esc to leave</p></div>`, 'dlgpanel');
    const log = p.querySelector('.log') as HTMLElement, opts = p.querySelector('.opts') as HTMLElement;
    const add = (who: string, text: string, me = false) => {
      log.insertAdjacentHTML('beforeend', `<div class="${me ? 'me' : 'them'}"><b>${who}:</b> ${text}</div>`);
      while (log.children.length > 14) log.firstElementChild!.remove();
      log.scrollTop = log.scrollHeight;
    };
    let node = g.talk.begin(n);
    const show = (d: DNode) => {
      node = d;
      add(n.name, d.line);
      g.talk.playerSpeakT = 1 + d.line.split(' ').length * 0.28;
      opts.innerHTML = d.options.map((o, i) => `<button data-i="${i}"><kbd>${i + 1}</kbd> ${o.label}</button>`).join('');
      opts.querySelectorAll('button').forEach((bt) => bt.addEventListener('click', () => choose(+(bt as HTMLElement).dataset.i!)));
    };
    const choose = (i: number) => {
      const o = node.options[i];
      if (!o) return;
      add('You', o.label, true);
      const next = o.go();
      if (this.screen !== 'dialogue') { window.removeEventListener('keydown', onKey); return; }   // went to trade, a fight…
      if (!next) { window.removeEventListener('keydown', onKey); g.talk.end(); this.close(); return; }
      show(next);
    };
    const onKey = (e: KeyboardEvent) => {
      if (this.screen !== 'dialogue') { window.removeEventListener('keydown', onKey); return; }
      const m = /^Digit([1-9])$/.exec(e.code);
      if (m) { e.preventDefault(); choose(+m[1] - 1); }
    };
    window.addEventListener('keydown', onKey);
    show(node);
  }
  openTrade(n: NPC) {
    const g = this.game, ia = g.interaction;
    this.screen = 'trade';
    const stock = g.economy.stockFor(n);
    const render = () => {
      const p = this.mount(`<div class="trade"><h2>Trading with ${n.name}</h2><div class="cols"><div><h3>Their goods</h3><div class="list them"></div></div><div><h3>Your pack</h3><div class="list you"></div></div></div><p class="dim">You have ${ia.money} pennies. Prices follow supply and demand along the war-torn trade routes.</p><button class="done">Done</button></div>`, 'tradepanel');
      const them = p.querySelector('.them')!, you = p.querySelector('.you')!;
      for (const it of stock.items) {
        const price = g.economy.price(it.id, n, 'buy');
        const e = $(`<div class="row"><span>${ITEMS[it.id].name}${it.n > 1 ? ` ×${it.n}` : ''}</span><button>${price}d</button></div>`);
        e.querySelector('button')!.addEventListener('click', () => { if (ia.money < price) { g.hud.toast('Not enough coin.'); return; } if (!ia.pack.add(it.id, 1, { age: it.age })) { g.hud.toast('No room.'); return; } ia.money -= price; stock.remove(it, 1); g.economy.traded(it.id, n, -1); g.sound?.('coins', g.player.pos, 0.4); render(); });
        them.appendChild(e);
      }
      for (const it of ia.pack.items) {
        const price = g.economy.price(it.id, n, 'sell') * (ITEMS[it.id].food ? Math.max(0.1, freshness(it)) : 1) | 0;
        const e = $(`<div class="row"><span>${ITEMS[it.id].name}${it.n > 1 ? ` ×${it.n}` : ''}${it.owner && it.owner !== 'player' ? ' <em>(stolen)</em>' : ''}</span><button>${price}d</button></div>`);
        e.querySelector('button')!.addEventListener('click', () => { if (it.owner === n.person.home) { g.hud.toast(`"That's mine, you thief!"`); g.law.crime('theft', g.player.pos, n.person.home, 0.4, false); return; } ia.money += price; ia.pack.remove(it, 1); stock.add(it.id, 1, { age: it.age }); g.economy.traded(it.id, n, 1); g.sound?.('coins', g.player.pos, 0.4); render(); });
        you.appendChild(e);
      }
      p.querySelector('.done')!.addEventListener('click', () => this.close());
    };
    render();
  }
  showDeath() {
    this.screen = 'dead';
    const p = this.mount(`<div class="death"><h1>You have died</h1><p>${this.game.deathCause}</p><button>Wake at the nearest town</button></div>`, 'deathpanel');
    p.querySelector('button')!.addEventListener('click', () => { this.game.respawn(); this.close(); });
  }
}

