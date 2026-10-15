// Conversations. With the player: a branching tree where every answer opens follow-up questions and you can
// keep talking (or change the subject) until you say farewell. People remember you, warm to courtesy and cool
// at rudeness, gossip about their neighbours, give directions, talk about the war, the weather and prices, and
// sometimes ask for help with an errand. Between themselves: townsfolk who meet stop, face each other and chat
// (greeting, a topic or two, a farewell), gesturing as they speak; you overhear them when you are close.
import * as THREE from 'three';
import type { Game } from '../game';
import type { NPC } from './npc';
import { ITEMS } from '../props/items';
import { kingdomAt, nearestSite, type Kingdom } from '../world/layout';

export interface DOption { label: string; go: () => DNode | null }
export interface DNode { line: string; options: DOption[] }

interface Memory { met: number; liking: number; asked: Set<string>; errand?: { item: string; n: number; pay: number; done?: boolean } }

const pick = <T,>(a: T[], r = Math.random) => a[Math.floor(r() * a.length) % a.length];
const KNAME: Record<string, string> = { vanguardia: 'Vanguardia', ironreach: 'Ironreach', river: 'the river lands', isles: 'the Isles' };
const ENEMY: Record<string, string> = { vanguardia: 'Ironreach', ironreach: 'Vanguardia', river: 'both crowns', isles: 'the mainland lords' };
const BRIDGES = ['the North Span', 'Bridgewatch Bridge', "King's Crossing"];
const ERRAND_ITEMS = ['apple', 'bread', 'onion', 'cheese_box', 'wood_log', 'candle', 'rope', 'bandage', 'salt', 'smoked_fish'];

const WORK: Record<string, string[]> = {
  farmer: ['Up before the sun, in the furrows till dark. The soil here is good, mind — when the soldiers don\'t trample it.', 'Barley on the high field, turnips by the brook. If the rain holds off we\'ll eat this winter.'],
  merchant: ['Buy cheap, sell dear, and pray the roads stay open. The war makes some men rich and most men poor.', 'Cloth from the isles, salt from the coast, iron from the mountains — when the bridges let it through.'],
  innkeeper: ['Ale, stew and gossip. You\'d be amazed what a soldier tells you after his fourth tankard.', 'I keep the fire lit and the beds aired. The rest is listening.'],
  blacksmith: ['Horseshoes, nails, hinges — and swords, these days. Always swords.', 'Iron comes down from the Ironreach mines, war or no war. Smugglers have to eat too.'],
  guard: ['I walk the walls and keep the peace. Mostly the peace.', 'Thieves, drunks and spies. You\'re not one of those, are you?'],
  lord: ['I answer to the crown and the crown answers to no one. Remember that.', 'Holding this land is a burden you could not imagine.'],
  laborer: ['I carry what needs carrying. Sacks, stone, timber. My back\'s older than I am.', 'Building, mending, hauling. Pay\'s a penny a day and a crust.'],
  carpenter: ['Beams and boards. Every house on this street has a bit of my work in it.', 'Good oak is getting scarce — they cut it all for the war engines.'],
  child: ['Mam says I\'m not to talk to strangers.', 'I can climb the big tree by the well! Higher than anyone.'],
  spouse: ['I keep the house, mind the hearth and feed the lot of them. That\'s work enough.', 'Someone has to keep this family together while the world goes mad.'],
  priest: ['I tend the souls of this town. They need more tending than they used to.'],
};
const GOSSIP = [
  (n: string) => `${n} has been sneaking off to the tavern every night. Their spouse thinks it's prayer.`,
  (n: string) => `${n} owes half the town money. Don't lend them a penny.`,
  (n: string) => `I saw ${n} talking to a stranger by the gate at midnight. Spy, if you ask me.`,
  (n: string) => `${n} grew the biggest turnip I've ever seen. Won't stop talking about it.`,
  (n: string) => `${n}'s boy ran off to join the army. Broke his mother's heart.`,
  (n: string) => `${n} swears they saw a wolf the size of a horse up on the ridge.`,
  (n: string) => `${n} is courting the baker's daughter. Everyone knows but the baker.`,
  (n: string) => `${n} found a silver coin of the old kings in their garden. Now they dig every evening.`,
];

interface Follow { q: string; a: string[] | ((n: NPC, t: Talk) => string); next?: string; like?: number; when?: (n: NPC, t: Talk) => boolean }
const gruffy = (n: NPC) => n.person.temperament > 0.65;
/** Follow-up questions per subject, in the order a real conversation drifts. */
const FOLLOW: Record<string, Follow[]> = {
  war: [
    { q: 'Have you lost anyone to it?', a: (n) => gruffy(n) ? 'My brother. At the North Span. Don\'t ask me again.' : pick(['A cousin. Took an arrow at the bridge and never came home.', 'Not yet. Every knock at the door, I think: is this it?', 'My neighbour\'s two boys. Both of them, same day.']), next: 'grief' },
    { q: 'Is the town ready if they come?', a: ['The walls are thick, but walls need men on them. Half the garrison\'s at the river.', 'They\'d close the gates and man the walls. Archers up top, pikes at the gate. We\'ve drilled it.', 'Ready? The captain spends more time in the tavern than on the walls.'], next: 'defence' },
    { q: 'Do soldiers pass through here often?', a: ['Every few days a column marches down the road, drums and all. They eat everything and pay for half.', 'Often enough that the inn waters the ale twice over.'] },
    { q: 'What would peace look like?', a: ['Trade over the bridges again. Salt and iron from the mountains, wool and grain from us. Everyone fatter.', 'Peace? I\'ve forgotten. Quiet, I suppose. Sleeping through the night.'] },
    { q: 'Would you ever leave, to get away from it?', a: (n) => n.person.age > 50 ? 'At my age? I\'ll die where I was born.' : pick(['To the isles, maybe. If I had the passage money.', 'And go where? The war\'s everywhere.']) },
  ],
  defence: [
    { q: 'Where would they attack?', a: ['The gates. Always the gates. That\'s why they keep the portcullis greased.', 'Wherever the wall is weakest. The old stretch by the river, I\'d wager.'] },
    { q: 'Could cannon bring the walls down?', a: ['Ironreach guns can crack anything given time. I\'ve seen a tower come down at Blackcrag.', 'They say the walls were built before cannon. They weren\'t built for it.'] },
    { q: 'Would you fight?', a: (n) => gruffy(n) ? 'With my bare hands if I had to.' : 'I\'d carry water to the walls and pray. That\'s fighting enough for me.', like: 0.05 },
  ],
  grief: [
    { q: 'I\'m sorry for your loss.', a: ['…Thank you. Not many say it any more.', 'It\'s the same story in every house. But thank you.'], like: 0.15, next: 'warm' },
    { q: 'Do you blame the crown?', a: ['Who else? The lords want the river; we pay for it in sons.', 'I blame the other side. That\'s easier.'] },
  ],
  place: [
    { q: 'What\'s the best place to eat?', a: ['The tavern does a mutton stew that\'ll put hair on your chest.', 'My kitchen. But you\'re not invited.'] },
    { q: 'Is it safe on the roads?', a: ['By day, mostly. By night there are deserters in the woods, and worse.', 'Safe as the war lets anything be. Ride with company.'] },
    { q: 'How long have you lived here?', a: (n) => n.person.age > 50 ? 'Since before your mother was born.' : 'All my life. Never seen much else.', next: 'life' },
    { q: 'Who should I avoid?', a: (n, t) => { const town = t.game.towns.byBuilding.get(n.person.home)?.site; const q = t.game.towns.people.find((x) => g0(t).towns.byBuilding.get(x.home)?.site === town && x.temperament > 0.75 && x.id !== n.person.id); return q ? `${q.name.split(' ')[0]}. Short temper and a long memory.` : 'The tax collector. Everyone avoids the tax collector.'; } },
  ],
  life: [
    { q: 'Are you happy here?', a: (n) => n.person.temperament > 0.65 ? 'Happy? Nobody asked me if I wanted to be happy.' : pick(['Mostly. The bread\'s good and the neighbours mostly kind.', 'I was, before the war.']) },
    { q: 'What do you do when you\'re not working?', a: ['Dice at the tavern. I lose, mostly.', 'Sleep. What else is there?', 'I carve little animals out of offcuts. Silly, I know.', 'Walk by the river and watch the boats.'], next: 'warm' },
    { q: 'What do you dream of?', a: ['A house of my own, with a proper chimney.', 'Seeing the sea. Just once.', 'Peace. Plain old peace.'], like: 0.05 },
  ],
  gossip: [
    { q: 'How do you know all this?', a: ['I keep my ears open and my mouth… well, half shut.', 'Washing day at the well. Nothing stays secret at the well.'] },
    { q: 'Is anyone up to no good?', a: (n, t) => t.game.law.log.length ? 'There\'s a thief about. The watch has posters up at the gate.' : pick(['Smugglers bring iron over the river at night. Everyone knows, nobody says.', 'The miller\'s scales are light. Weigh your flour twice.']) },
    { q: 'What do people say about me?', a: (n, t) => t.mem(n).liking > 0.4 ? 'That you\'re all right. For a stranger.' : t.game.law.log.length ? 'That you\'ve light fingers. True?' : 'Nobody knows who you are. That\'s what they say.' },
  ],
  warm: [
    { q: 'Tell me about yourself.', a: (n) => `I\'m ${n.person.name.split(' ')[0]}. ${n.person.age > 50 ? 'Old and stubborn.' : 'Not much to tell, really.'}`, next: 'life' },
    { q: 'You must be well liked here.', a: ['Ha! Ask my neighbours. Actually, don\'t.', 'I try to be decent. Most days.'] },
    { q: 'Would you share a drink with me sometime?', a: (n, t) => t.mem(n).liking > 0.45 ? pick(['I\'d like that. The tavern, after dark?', 'Why not? You\'re buying.']) : 'Let\'s not get ahead of ourselves.', like: 0.05, when: (n) => n.person.role !== 'child' },
    { q: 'Any advice for a traveller?', a: ['Keep your purse inside your shirt and your blade where you can reach it.', 'Don\'t cross the river without papers. Or a very fast horse.', 'Eat when you can, sleep where you can, and never trust a ferryman who smiles.'] },
  ],
  banter: [
    { q: 'Heard any good jokes?', a: ['What\'s the difference between an Ironreach captain and a mule? The mule knows when to stop.', 'A knight, a priest and a pig walk into the tavern. Only the pig pays.'] },
    { q: 'To your health!', when: (n) => n.person.role !== 'child', a: ['And yours! May the war forget us both.', 'Health and full bellies!'], like: 0.05, next: 'warm' },
    { q: 'You\'re not so bad yourself.', a: ['Careful, I\'ll start thinking you mean it.'], like: 0.05, next: 'warm' },
  ],
};
const g0 = (t: Talk) => t.game;

export class Talk {
  memory = new Map<string, Memory>();
  /** live NPC-NPC chats */
  chats: { a: NPC; b: NPC; lines: { who: 0 | 1; text: string }[]; i: number; t: number }[] = [];
  private scanT = 0;
  /** who is in conversation with the player */
  player: NPC | null = null;
  playerSpeakT = 0;
  constructor(public game: Game) {}

  mem(n: NPC): Memory {
    let m = this.memory.get(n.person.id);
    if (!m) { m = { met: 0, liking: (n.person.temperament < 0.5 ? 0.2 : -0.1), asked: new Set() }; this.memory.set(n.person.id, m); }
    return m;
  }

  // ------------------------------------------------------------------ player dialogue
  /** The root of a conversation with the player. */
  begin(n: NPC): DNode {
    const g = this.game, m = this.mem(n), p = n.person;
    this.player = n;
    n.activity === 'dead' || (n.talkPartner = 'player');
    const k = kingdomAt(n.st.pos.x, n.st.pos.z);
    const night = g.hours > 21.5 || g.hours < 5.5;
    const wanted = g.law.bountyIn(k) > 0;
    const gruff = p.temperament > 0.65;
    let greet: string;
    if (n.hostile) greet = 'You! Back away!';
    else if (wanted && (p.role === 'guard' || m.liking < 0.3)) greet = p.role === 'guard' ? `You match the description on the posters. ${g.law.bountyIn(k)} pennies owed to the crown.` : 'I know your face from the gate posters. Say what you want and go.';
    else if (m.met > 0) greet = m.liking > 0.5 ? pick([`${this.playerName()}! Good to see you again.`, 'Back again, friend? Come, sit a while.']) : m.liking < -0.2 ? pick(['You again.', 'What now?']) : pick(['Hello again.', 'Ah — you were here before.']);
    else if (night) greet = gruff ? 'It\'s the middle of the night. What?' : 'It\'s late, stranger. What do you want?';
    else greet = this.firstGreeting(n);
    // they notice what you're doing: a drawn blade, blood, their own things in your hands, the weather
    const pl = g.player, held = g.interaction.held;
    if (!n.hostile) {
      if (g.combat.drawn) greet = (p.role === 'guard' ? 'Sheathe that blade in my town. Now. ' : gruff ? 'Put that steel away before you talk to me. ' : 'P-please, put the sword away… ') + greet;
      else if (pl.bleeding > 0.05) greet = pick(['Gods, you\'re bleeding! Bind that before you fall down. ', 'You\'re hurt — there\'s blood all down you. ']) + greet;
      else if (held?.owner && held.owner === p.home) greet = 'That\'s ours you\'re holding. ' + greet;
      else if (g.weather.cur.rain > 0.4 && !night) greet = pick(['Filthy weather. ', 'Wet enough for you? ']) + greet;
    }
    m.met++;
    return this.root(n, greet);
  }
  end() { if (this.player) this.player.talkPartner = null; this.player = null; }
  private playerName() { return 'traveller'; }

  private firstGreeting(n: NPC) {
    const p = n.person, gruff = p.temperament > 0.65;
    switch (p.role) {
      case 'guard': return `Move along, citizen… unless you've business with the watch.`;
      case 'innkeeper': return 'Welcome! Ale, a hot meal, or a bed for the night?';
      case 'merchant': return 'Fine goods, fair prices. Mostly fair.';
      case 'farmer': return 'Harvest won\'t bring itself in. Something you need?';
      case 'blacksmith': return 'Mind the sparks. What can I do for you?';
      case 'child': return 'Who are you? Are you a knight?';
      case 'lord': return 'You stand before a lord of the realm. Be brief.';
      default: return gruff ? 'Hm? What is it?' : pick(['Good day to you.', 'Well met, stranger.', 'Hello there. Not from round here, are you?']);
    }
  }

  /** Main topics; every answer comes back here (with fresh options) unless you leave. */
  root(n: NPC, line: string): DNode {
    const g = this.game, p = n.person, m = this.mem(n);
    const k = kingdomAt(n.st.pos.x, n.st.pos.z);
    const o: DOption[] = [];
    const back = (l: string) => this.root(n, l);
    if (!m.asked.has('who')) o.push({ label: 'Who are you?', go: () => this.who(n) });
    o.push({ label: 'What news of the war?', go: () => this.war(n) });
    o.push({ label: 'Tell me about this place.', go: () => this.place(n) });
    o.push({ label: 'Heard any gossip?', go: () => this.gossip(n) });
    o.push({ label: 'Where can I find…?', go: () => this.directions(n) });
    if (m.errand && !m.errand.done) {
      const e = m.errand, have = g.interaction.pack.count(e.item);
      o.push({ label: have >= e.n ? `Here are your ${ITEMS[e.item].name.toLowerCase()}s. (${e.n})` : `About that errand…`, go: () => {
        if (g.interaction.pack.count(e.item) >= e.n) {
          for (let i = 0; i < e.n; i++) { const it = g.interaction.pack.items.find((x) => x.id === e.item); if (it) g.interaction.pack.remove(it, 1); }
          g.interaction.money += e.pay; e.done = true; m.liking += 0.4;
          g.hud.toast(`+${e.pay} pennies`);
          return back(pick(['You\'re a lifesaver. Here — as promised.', 'Exactly what I needed. Thank you, truly.']) + ` (${e.pay} pennies)`);
        }
        return back(`Still need ${e.n} ${ITEMS[e.item].name.toLowerCase()}${e.n > 1 ? 's' : ''}. ${e.pay} pennies when you bring them.`);
      } });
    } else if (p.role !== 'guard' && p.role !== 'lord' && p.role !== 'child') o.push({ label: 'Is there anything I can help with?', go: () => this.errand(n) });
    if (p.role === 'stablemaster' || p.role === 'ferryman') o.push({ label: p.role === 'ferryman' ? 'I need passage by boat.' : 'Hire a horse and guide to another town.', go: () => this.travel(n) });
    if (p.role === 'ferryman') o.push({ label: 'I want a ship of my own.', go: () => this.shipwright(n) });
    if (p.role === 'stablemaster') o.push({ label: 'Buy a horse (60 pennies)', go: () => {
      if (g.interaction.money < 60) return back('Sixty pennies, friend. A good horse is worth every one.');
      g.interaction.money -= 60;
      const a = g.spawnAnimal('horse', n.st.pos.clone().add(new THREE.Vector3(2, 0, 2)));
      a.owner = 'player';
      return back('She\'s yours. Feed her, rest her, and she\'ll carry you to the end of the world.');
    } });
    if (p.role === 'innkeeper') o.push({ label: 'Rent a room (10 pennies)', go: () => { if (g.interaction.money >= 10) { g.interaction.money -= 10; g.rentedRoom = p.home; return back('Upstairs, second door. Sleep well.'); } return back('Come back when you have coin.'); } });
    if (p.role === 'merchant' || p.role === 'innkeeper' || p.role === 'blacksmith') o.push({ label: 'Let\'s trade.', go: () => { g.ui.openTrade(n); return null; } });
    if (p.role === 'guard' && g.law.bountyIn(k as Kingdom) > 0) o.push({ label: `Pay my fine (${g.law.bountyIn(k as Kingdom)} pennies)`, go: () => { g.law.payFine(n); return back(g.law.bountyIn(k as Kingdom) > 0 ? 'You can\'t cover it. Then you\'ll work it off in the cells — unless you run.' : 'Paid in full. Keep your nose clean.'); } });
    if (p.role === 'guard') o.push({ label: 'I want to fight for this kingdom.', go: () => { g.war.enlist(k as never); return back('Report to the sergeant at the bridge camp. Bring a blade, and say your prayers.'); } });
    o.push({ label: m.liking < 0 ? 'I meant no offence. (Apologise)' : 'You have a kind face. (Compliment)', go: () => this.compliment(n) });
    o.push({ label: 'Out of my way, peasant. (Insult)', go: () => this.insult(n) });
    o.push({ label: 'Farewell.', go: () => null });
    return { line, options: o };
  }

  /** The harbour's yard sells three classes of ship, moored off the dock and ready to sail. */
  private shipwright(n: NPC): DNode {
    const g = this.game;
    const back = (l: string) => this.root(n, l);
    const plan = g.towns.plans.find((pl) => pl.site.dock && Math.hypot(pl.site.x - n.st.pos.x, pl.site.z - n.st.pos.z) < 600);
    if (!plan) return back('No yard here to build one.');
    const NAMES = ['Fortune\'s Wake', 'The Wanderer', 'Grey Heron', 'Saltwind', 'Lady Margery', 'The Stubborn Oak', 'Kingfisher', 'Old Reliable'];
    const offer = [['brigantine', 900, 'A brigantine: two masts, ten guns, quick and handy in the river.'], ['frigate', 3200, 'A frigate: three masts, a covered gun deck, forty guns.'], ['manowar', 9000, 'A man-o\'-war: three gun decks, a hundred guns. Too deep for the river.']] as const;
    const opts: DOption[] = offer.map(([cls, price, desc]) => ({ label: `${cls === 'manowar' ? 'Man-o\'-war' : cls[0].toUpperCase() + cls.slice(1)} — ${price}d`, go: () => {
      if (g.interaction.money < price) return back(`${desc} She'll cost you ${price} pennies — more than you're carrying.`);
      const sh = g.buyShip(plan, cls, NAMES[Math.floor(Math.random() * NAMES.length)]);
      if (!sh) return back('There\'s nowhere to moor her.');
      g.interaction.money -= price;
      return back(`${desc} She's yours — the ${sh.name_}, riding at anchor off the end of the quay. Take the boat out to her; E at the wheel.`);
    } }));
    opts.push({ label: 'Just looking.', go: () => back('Dreaming costs nothing. Ships cost plenty.') });
    return { line: 'Built in this very yard, seasoned oak and Ironspire iron. What\'ll it be?', options: opts };
  }

  /** Fast travel: a hired horse and guide (any town with a stable yard) or a boat between the ports. */
  private travel(n: NPC): DNode {
    const g = this.game, P = g.player.pos;
    const back = (l: string) => this.root(n, l);
    const boat = n.person.role === 'ferryman';
    const dests = g.towns.plans.filter((pl) => !pl.minor && (boat ? !!pl.site.dock : !!pl.stableYard) && Math.hypot(pl.site.x - P.x, pl.site.z - P.z) > 300)
      .sort((a, b) => Math.hypot(a.site.x - P.x, a.site.z - P.z) - Math.hypot(b.site.x - P.x, b.site.z - P.z));
    if (!dests.length) return back(boat ? 'No other harbour I sail to.' : 'Nowhere I can take you from here.');
    const opts: DOption[] = dests.slice(0, 8).map((pl) => {
      const d = Math.hypot(pl.site.x - P.x, pl.site.z - P.z) * 1.25;          // roads wind
      const hours = d / ((boat ? 2.2 : 1.3) * 3600);                           // a steady trot / a fair wind, with rests and tolls
      const cost = Math.max(5, Math.round(d / (boat ? 90 : 120)));
      const enemy = kingdomAt(pl.site.x, pl.site.z) !== kingdomAt(P.x, P.z) && kingdomAt(pl.site.x, pl.site.z) !== 'isles' && kingdomAt(P.x, P.z) !== 'isles';
      return { label: `${pl.site.name} — ${cost}d, about ${hours < 1 ? Math.round(hours * 60) + ' min' : hours.toFixed(1) + ' h'}${enemy ? ' (across the front)' : ''}`, go: () => {
        if (g.interaction.money < cost) return back(`That's ${cost} pennies. Come back when you have them.`);
        if (enemy && n.person.temperament > 0.4) return back('Across the river? In a war? Not for any money.');
        g.interaction.money -= cost;
        g.ui.close(); this.end();
        g.fastTravel(pl, hours);
        return null;
      } };
    });
    opts.push({ label: 'Never mind.', go: () => back('Suit yourself.') });
    return { line: boat ? 'Where are you bound? Tides wait for no one.' : 'Where to? My lad will ride with you and bring the horse back.', options: opts };
  }

  private who(n: NPC): DNode {
    const g = this.game, p = n.person, m = this.mem(n);
    m.asked.add('who');
    const town = g.towns.byBuilding.get(p.home)?.site ?? 'these parts';
    const tName = g.towns.plans.find((pl) => pl.site.id === town)?.site.name ?? town;
    const role = p.role === 'spouse' ? 'I keep house' : p.role === 'child' ? 'I\'m nearly grown' : `I'm the ${p.role}`;
    const back = (l: string) => this.follow(n, l, 'life');
    const line = `${p.name}. ${role} here in ${tName}. ${p.age > 55 ? 'Seen more winters than I care to count.' : p.age < 25 ? 'Born and raised, never been further than the river.' : 'Lived here most of my life.'}`;
    return { line, options: [
      { label: 'What\'s your work like?', go: () => ({ line: pick(WORK[p.role] ?? WORK.laborer), options: [
        { label: 'Does it pay well?', go: () => back(p.role === 'merchant' || p.role === 'lord' ? 'Well enough. Better than most.' : 'Pay? Ha. Enough for bread and a roof, some weeks.') },
        { label: 'Would you do anything else?', go: () => back(pick(['Sail to the isles, maybe. See the sea before I die.', 'No. This is what I am.', 'I\'d have liked to be a scribe. Never learned my letters, though.'])) },
        { label: 'Let\'s talk about something else.', go: () => back('Very well.') },
      ] }) },
      { label: 'Tell me about your family.', go: () => back(this.family(n)) },
      { label: 'Let\'s talk about something else.', go: () => back('As you like.') },
    ] };
  }

  private family(n: NPC) {
    const g = this.game, p = n.person;
    const home = g.towns.byBuilding.get(p.home);
    const hh = home?.household;
    const others = hh ? hh.members.filter((x) => x.id !== p.id) : [];
    if (!others.length) return pick(['It\'s just me. Quieter that way.', 'No family left. The fever took them, years back.']);
    const kids = others.filter((x) => x.role === 'child'), adults = others.filter((x) => x.role !== 'child');
    const parts: string[] = [];
    if (adults.length) parts.push(`${adults.map((a) => a.name.split(' ')[0]).join(' and ')} ${adults.length > 1 ? 'live' : 'lives'} with me`);
    if (kids.length) parts.push(`${kids.length === 1 ? 'one little one' : kids.length + ' children'} — ${kids.map((c) => c.name.split(' ')[0]).join(', ')}`);
    return `The ${hh!.family} household. ${parts.join(', and ')}. ${kids.length ? 'They run me ragged.' : 'We get by.'}`;
  }

  private war(n: NPC): DNode {
    const g = this.game, k = kingdomAt(n.st.pos.x, n.st.pos.z) as Kingdom;
    const back = (l: string) => this.follow(n, l, 'war');
    const near = g.war.soldiers.filter((s) => s.alive && s.st.pos.distanceTo(n.st.pos) < 600).length;
    return { line: g.war.rumour(k), options: [
      { label: 'Who\'s winning?', go: () => back(g.war.battles.vanguardia === g.war.battles.ironreach ? 'Nobody. That\'s the trouble with this war: everybody loses a bit, every day.' : `${g.war.battles.vanguardia > g.war.battles.ironreach ? 'Vanguardia' : 'Ironreach'} has the upper hand, they say. For now.`) },
      { label: 'Where is the fighting?', go: () => back(`At the bridges mostly — ${pick(BRIDGES)} worst of all. ${near > 10 ? 'And close by: I\'ve seen columns on the road all week.' : 'Columns march down the roads to the river every few days.'}`) },
      { label: `What do you think of ${ENEMY[k] ?? 'the enemy'}?`, go: () => back(n.person.temperament > 0.6 ? `I'd hang every one of them from the bridge rails.` : `Their farmers aren't so different from ours, I expect. It's the lords who want the river.`) },
      { label: 'Should I join the fight?', go: () => back('Talk to a guard if you want to enlist. They\'ll send you to the bridge camps. Few come back the same.') },
      { label: 'Let\'s talk about something else.', go: () => back('Gladly. War talk sours the stomach.') },
    ] };
  }

  private place(n: NPC): DNode {
    const g = this.game, s = nearestSite(n.st.pos.x, n.st.pos.z).site, k = kingdomAt(n.st.pos.x, n.st.pos.z);
    const back = (l: string) => this.follow(n, l, 'place');
    const desc = s.kind === 'capital' ? `${s.name}, the crown city of ${KNAME[s.kingdom]}. Biggest walls you'll ever see.` : s.kind === 'castle' ? `${s.name}. The garrison keeps the road safe — mostly.` : s.kind === 'port' ? `${s.name}. Ships, fish and sailors' songs.` : `${s.name}. Small, but we look after our own.`;
    const w = g.weather;
    return { line: `This is ${desc}`, options: [
      { label: 'Who rules here?', go: () => back(`${KNAME[s.kingdom] ?? 'The crown'}. ${k === 'ironreach' ? 'The Iron King sits in Ironspire, high on the mountain.' : 'The Queen holds court in Aurelhold.'} Taxes go up every season.`) },
      { label: 'What\'s the weather doing?', go: () => back(w.kind === 'storm' ? 'Get indoors, fool! The storm\'s not done with us.' : w.cur.rain > 0.3 ? 'Wet. Wet and miserable. Good for the barley, I suppose.' : w.kind === 'fog' ? 'Fog off the river. Thieves love a morning like this.' : w.next !== w.kind ? `Fair now, but my knee says ${w.next === 'rain' || w.next === 'storm' ? 'rain is coming' : 'it\'ll change'}.` : 'Fair enough. Make the most of it.') },
      { label: 'What are prices like?', go: () => back(`Bread's ${g.economy.price('bread', n, 'buy')} pennies a loaf. ${g.economy.price('bread', n, 'buy') > 2 ? 'Robbery, with the war on.' : 'Could be worse.'} Iron's dear, salt dearer.`) },
      { label: 'Anything worth seeing?', go: () => back(pick([`The view from the walls at sunset.`, `The old chapel — they say a saint is buried under it.`, `The river, if you like watching soldiers glare at each other.`, `The tavern. Best stew this side of the river.`])) },
      { label: 'Let\'s talk about something else.', go: () => back('Of course.') },
    ] };
  }

  private gossip(n: NPC): DNode {
    const g = this.game, m = this.mem(n);
    const back = (l: string) => this.root(n, l);
    if (m.liking < -0.2) return back('I don\'t gossip with strangers who insult me.');
    const town = g.towns.byBuilding.get(n.person.home)?.site;
    const neighbours = g.towns.people.filter((x) => x.id !== n.person.id && g.towns.byBuilding.get(x.home)?.site === town && x.role !== 'child');
    const who = neighbours.length ? pick(neighbours).name.split(' ')[0] : 'the miller';
    const back2 = (l: string) => this.follow(n, l, 'gossip');
    const crimes = g.law.log.slice(-3);
    const line = crimes.length && Math.random() < 0.5 ? `Someone's been ${crimes[crimes.length - 1].crime === 'theft' ? 'stealing' : 'making trouble'} around ${crimes[crimes.length - 1].where}. The guards are asking questions.` : pick(GOSSIP)(who);
    return { line, options: [
      { label: 'Tell me more.', go: () => back2(pick(['That\'s all I know. And you didn\'t hear it from me.', 'Ask at the tavern. Ale loosens tongues.', 'I\'ve said too much already.'])) },
      { label: 'Anything else?', go: () => this.gossip(n) },
      { label: 'You shouldn\'t spread rumours.', go: () => { m.liking -= 0.1; return back2('Hmph. Everybody does.'); } },
      { label: 'Let\'s talk about something else.', go: () => back('Suit yourself.') },
    ] };
  }

  private directions(n: NPC): DNode {
    const back = (l: string) => this.root(n, l);
    const types: [string, string][] = [['tavern', 'The tavern'], ['smithy', 'The smithy'], ['stable', 'The stables'], ['chapel', 'The chapel'], ['shop', 'A shop'], ['hall', 'The hall'], ['dock', 'The docks']];
    return { line: 'Where to?', options: [
      ...types.map(([t, name]) => ({ label: name.replace(/^The |^A /, (x) => x).toString(), go: () => back(t === 'dock' ? this.dockDir(n) : `${name} is ${this.dirTo(n.st.pos, t)}.`) })),
      { label: 'Never mind.', go: () => back('Hm.') },
    ] };
  }
  private dockDir(n: NPC) {
    const g = this.game;
    const plan = g.towns.plans.find((p) => p.docks.length && Math.hypot(p.site.x - n.st.pos.x, p.site.z - n.st.pos.z) < p.site.r * 2);
    if (!plan) return 'No docks here. Saltmarsh to the south, or Gullrock out on the isles.';
    const d = plan.docks[0];
    return `The docks are ${this.compass(n.st.pos, d.x, d.z)}.`;
  }
  dirTo(from: THREE.Vector3, type: string) {
    const g = this.game;
    const plan = g.towns.plans.find((p) => Math.hypot(p.site.x - from.x, p.site.z - from.z) < p.site.r * 1.5);
    const b = plan?.buildings.filter((x) => x.spec.type === type).sort((a, c) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(c.x - from.x, c.z - from.z))[0];
    if (!b) return 'not in this town';
    return this.compass(from, b.x, b.z);
  }
  private compass(from: THREE.Vector3, x: number, z: number) {
    const dx = x - from.x, dz = z - from.z;
    const ang = Math.atan2(dx, -dz);
    const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    return `${Math.round(Math.hypot(dx, dz))} paces to the ${dirs[Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8]}`;
  }

  // ------------------------------------------------------------------ the drift of a conversation
  /** After an answer, the natural next questions on the same subject (ones not yet asked), plus a way to
   *  change the subject or leave — so the choices move with the conversation instead of resetting. */
  follow(n: NPC, line: string, topic: string): DNode {
    const m = this.mem(n);
    const pool = (FOLLOW[topic] ?? []).filter((f) => !m.asked.has(topic + ':' + f.q) && (!f.when || f.when(n, this)));
    const opts: DOption[] = [];
    for (const f of pool.sort(() => Math.random() - 0.5).slice(0, 3)) opts.push({ label: f.q, go: () => {
      m.asked.add(topic + ':' + f.q);
      if (f.like) m.liking = THREE.MathUtils.clamp(m.liking + f.like, -1, 1);
      const ans = typeof f.a === 'function' ? f.a(n, this) : pick(f.a);
      return this.follow(n, ans, f.next ?? topic);
    } });
    opts.push({ label: 'Let\'s talk about something else.', go: () => this.root(n, pick(['Very well.', 'As you like.', 'Hm. What else, then?', 'Go on.'])) });
    opts.push({ label: 'Farewell.', go: () => null });
    return { line, options: opts };
  }

  /** Rudeness has consequences, and you can make it worse or try to mend it. */
  private insult(n: NPC): DNode {
    const p = n.person, m = this.mem(n), gruff = p.temperament > 0.65;
    m.liking -= 0.4;
    m.asked.add('insulted');
    if (p.temperament > 0.82 && p.role !== 'child') { n.hostile = true; n.say('Right. You asked for it!', true); return { line: 'Right. You asked for it!', options: [{ label: '(Defend yourself)', go: () => null }] }; }
    const line = p.role === 'guard' ? 'Watch your tongue, or I\'ll watch it for you from inside a cell.' : p.role === 'child' ? 'I\'m telling my mam on you!' : gruff ? pick(['Say that again. I dare you.', 'You want a fist in your teeth?']) : pick(['How dare you!', 'Charming. Leave me be.', 'Go boil your head.']);
    return { line, options: [
      { label: 'I meant every word.', go: () => {
        m.liking -= 0.3;
        if (gruff && p.role !== 'child') { n.hostile = true; n.say('Then you\'ll answer for it!', true); return null; }
        if (p.role === 'guard') { this.game.law.crime('assault', n.st.pos, p.home, 0.05, false); return { line: 'That\'ll be a fine, then. Keep it up and it\'ll be the stocks.', options: [{ label: 'Fine. I\'m going.', go: () => null }, { label: 'Sorry, officer. Long day.', go: () => this.apologise(n) }] }; }
        return { line: pick(['Get away from me, or I\'ll call the watch!', 'I won\'t be spoken to like that. Leave.']), options: [{ label: '(Leave)', go: () => null }, { label: 'Wait — I\'m sorry. I shouldn\'t have said that.', go: () => this.apologise(n) }] };
      } },
      { label: 'Forgive me. The road has made me sour.', go: () => this.apologise(n) },
      { label: 'Ha! Only jesting, friend.', go: () => {
        const humour = 1 - p.temperament + Math.random() * 0.4;
        if (humour > 0.75) { m.liking += 0.35; return this.follow(n, pick(['Ha! You had me there. You\'ve a wicked tongue, traveller.', 'Hah. Funny. Very funny.']), 'banter'); }
        return { line: 'Strange sense of humour you have.', options: [{ label: 'Let me make it up to you.', go: () => this.apologise(n) }, { label: 'Suit yourself.', go: () => null }] };
      } },
      { label: 'What are you going to do about it?', go: () => {
        m.liking -= 0.3;
        if (p.role === 'guard' || gruff) { n.hostile = true; n.say(p.role === 'guard' ? 'Resisting the watch, are we?' : 'This!', true); return null; }
        n.activity = 'flee'; n.say(pick(['Guards! Guards!', 'Help! A madman!']), true);
        return null;
      } },
    ] };
  }
  private apologise(n: NPC): DNode {
    const p = n.person, m = this.mem(n), g = this.game;
    m.liking = Math.min(m.liking + 0.25, 0.2);
    return { line: p.temperament > 0.65 ? 'Hmph. Words are cheap.' : 'Well… we all have our days, I suppose.', options: [
      { label: 'Let me buy you a drink. (2 pennies)', go: () => {
        if (g.interaction.money < 2) return { line: 'With what? Your empty purse?', options: [{ label: 'Fair point.', go: () => this.root(n, 'Hm.') }] };
        g.interaction.money -= 2; m.liking += 0.35;
        return this.follow(n, 'Well. That\'s more like it. I\'ll drink to your health.', 'banter');
      } },
      { label: 'Can we start again?', go: () => this.root(n, p.temperament > 0.65 ? 'Fine. Once.' : 'Of course. Hello, then.') },
      { label: 'I\'ll leave you be.', go: () => null },
    ] };
  }
  private compliment(n: NPC): DNode {
    const p = n.person, m = this.mem(n);
    if (m.liking < 0) return this.apologise(n);
    const first = !m.asked.has('flatter');
    m.asked.add('flatter');
    m.liking = Math.min(1, m.liking + (first ? 0.2 : 0.03));
    const line = !first ? 'You\'ve said that already. Are you after something?' : p.temperament > 0.65 ? 'Flattery won\'t get you far with me. …But thank you.' : p.role === 'child' ? 'Really? Mam says I look like a turnip.' : 'Oh! Well. That\'s kind of you to say.';
    return this.follow(n, line, 'warm');
  }

  private errand(n: NPC): DNode {
    const g = this.game, m = this.mem(n);
    const back = (l: string) => this.root(n, l);
    if (m.errand?.done) return back('You\'ve done enough already. Thank you.');
    const r = Math.random;
    const item = pick(ERRAND_ITEMS, r), cnt = ITEMS[item].stack ? 2 + Math.floor(r() * 4) : 1;
    const pay = Math.max(3, Math.round(ITEMS[item].value * cnt * 1.8 + 2 + m.liking * 3));
    const name = ITEMS[item].name.toLowerCase();
    return { line: `Since you ask… I need ${cnt > 1 ? cnt + ' ' + name + 's' : 'a ' + name}. ${pick(['My legs aren\'t what they were.', 'I can\'t leave the house today.', 'The market was sold out.'])} I'd pay ${pay} pennies.`, options: [
      { label: cnt > 1 ? 'I\'ll bring them.' : 'I\'ll bring it.', go: () => { m.errand = { item, n: cnt, pay }; g.hud.toast(`Errand: bring ${cnt} × ${ITEMS[item].name} to ${n.name} (${pay}d)`); return back('Bless you. I\'ll be here.'); } },
      { label: 'Make it more and you have a deal.', go: () => { if (m.liking > 0.2 || n.person.temperament < 0.4) { m.errand = { item, n: cnt, pay: pay + 3 }; return back(`Fine, ${pay + 3}. Don't make me regret it.`); } m.liking -= 0.05; return back('That\'s my price. Take it or leave it.'); } },
      { label: 'Not now.', go: () => back('Another time, then.') },
    ] };
  }

  // ------------------------------------------------------------------ NPC-NPC chats
  update(dt: number) {
    const g = this.game, P = g.player.pos;
    // the person talking to the player faces them and gestures while their line is "spoken"
    if (this.player) {
      const n = this.player;
      this.playerSpeakT -= dt;
      n.anim.talking += ((this.playerSpeakT > 0 ? 1 : 0.15) - n.anim.talking) * Math.min(1, dt * 5);
      if (g.ui.screen !== 'dialogue' && g.ui.screen !== 'trade') this.end();
    }
    // running chats
    for (let ci = this.chats.length - 1; ci >= 0; ci--) {
      const c = this.chats[ci];
      const ab = [c.a, c.b];
      const broken = ab.some((x) => !x.alive || x.hostile || x.talkPartner === 'player' || x.activity === 'flee' || x.activity === 'arrest') || c.a.st.pos.distanceTo(c.b.st.pos) > 4.5;
      if (broken || c.i >= c.lines.length) {
        for (const x of ab) { if (x.talkPartner !== 'player') x.talkPartner = null; x.anim.talking = 0; x.chatCooldown = 40 + Math.random() * 80; }
        this.chats.splice(ci, 1);
        continue;
      }
      c.t -= dt;
      const cur = c.lines[c.i];
      for (let k = 0; k < 2; k++) ab[k].anim.talking += ((cur?.who === k ? 1 : 0.1) - ab[k].anim.talking) * Math.min(1, dt * 4);
      if (c.t <= 0) {
        c.i++;
        const nx = c.lines[c.i];
        if (nx) {
          const sp = ab[nx.who];
          c.t = 1.4 + nx.text.split(' ').length * 0.3;
          sp.bubble = nx.text; sp.bubbleT = c.t;
          if (sp.st.pos.distanceTo(P) < 14) g.hud.subtitle(sp.name, nx.text, sp.st.pos);
        }
      }
    }
    // strike up new chats: two free people meeting outdoors (or in the tavern)
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = 0.7;
    const free = g.residents.live.filter((n) => n.alive && !n.hostile && !n.talkPartner && n.chatCooldown <= 0 && n.st.pos.distanceToSquared(P) < 60 * 60 &&
      ['wander', 'home', 'work', 'tavern', 'field', 'patrol'].includes(n.activity) && n.sleepPose === null);
    for (const a of free) {
      if (a.talkPartner) continue;
      const b = free.find((x) => x !== a && !x.talkPartner && x.st.pos.distanceToSquared(a.st.pos) < 3.2 * 3.2 && Math.abs(x.st.pos.y - a.st.pos.y) < 1.2);
      if (!b || Math.random() < 0.5) { a.chatCooldown = 6 + Math.random() * 10; continue; }
      a.talkPartner = b; b.talkPartner = a;
      const lines = this.script(a, b);
      this.chats.push({ a, b, lines, i: -1, t: 0.3 });
    }
  }

  /** A short exchange between two neighbours, built from their roles, the town, the weather and the war. */
  private script(a: NPC, b: NPC): { who: 0 | 1; text: string }[] {
    const g = this.game, A = a.person, B = b.person, out: { who: 0 | 1; text: string }[] = [];
    const say = (who: 0 | 1, t: string) => out.push({ who, text: t });
    const fa = A.name.split(' ')[0], fb = B.name.split(' ')[0];
    const night = g.hours > 20 || g.hours < 6, w = g.weather;
    const k = kingdomAt(a.st.pos.x, a.st.pos.z);
    // greeting
    say(0, pick(night ? [`Evening, ${fb}.`, `Still up, ${fb}?`] : [`Morning, ${fb}!`, `${fb}! How goes it?`, `Good day, ${fb}.`, `Ah, ${fb}. Just the person.`]));
    say(1, pick([`${fa}. Can't complain. Well — I can, but nobody listens.`, `Well enough, ${fa}, well enough.`, `Tired, ${fa}. Always tired.`, `Ah, ${fa}! Better for seeing you.`]));
    // one or two topics
    const topics = ['weather', 'war', 'prices', 'gossip', 'work', 'family', 'stranger'];
    const n = 1 + (Math.random() < 0.5 ? 1 : 0);
    const used = new Set<string>();
    for (let t = 0; t < n; t++) {
      let topic = pick(topics);
      if (topic === 'stranger' && g.player.pos.distanceTo(a.st.pos) > 15) topic = 'weather';
      if (used.has(topic)) continue;
      used.add(topic);
      const s = (t % 2) as 0 | 1, o = (1 - s) as 0 | 1;
      switch (topic) {
        case 'weather':
          if (w.cur.rain > 0.3) { say(s, 'This rain will rot the roots in the ground.'); say(o, 'Better than last summer\'s drought. Nearly lost the lot.'); }
          else if (w.kind === 'fog') { say(s, 'Can\'t see your hand in front of your face out there.'); say(o, 'Stay off the river road, then. Fog hides worse than puddles.'); }
          else { say(s, pick(['Fine weather, at least.', 'Warm for the season.', 'Sky looks kind today.'])); say(o, pick(['Won\'t last. Never does.', 'Make hay while it shines, as my father said.', 'Aye. Gods know we\'ve earned it.'])); }
          break;
        case 'war':
          say(s, `Did you hear? ${pick([`Another column went down to ${pick(BRIDGES)} yesterday.`, `${ENEMY[k] ?? 'They'} shelled the bridge again.`, 'They\'re pressing every man under forty.'])}`);
          say(o, pick(['I\'ll believe it when I see it.', 'Gods keep my boy safe out there.', 'Let the lords fight their own war, I say.', 'We\'ll push them back across the river. You\'ll see.']));
          if (Math.random() < 0.5) say(s, pick(['Quiet. Walls have ears.', 'Aye. Let\'s hope.', 'Hmph.']));
          break;
        case 'prices':
          say(s, `Bread's ${g.economy.price('bread', a, 'buy')} pennies at the market now.`);
          say(o, pick(['Robbery! It was two last spring.', 'It\'s the war. Everything goes to the front.', 'Bake your own, then. That\'s what I do.']));
          break;
        case 'gossip': {
          const town = g.towns.byBuilding.get(A.home)?.site;
          const others = g.towns.people.filter((x) => x.id !== A.id && x.id !== B.id && g.towns.byBuilding.get(x.home)?.site === town && x.role !== 'child');
          const who = others.length ? pick(others).name.split(' ')[0] : 'the miller';
          say(s, pick(GOSSIP)(who));
          say(o, pick(['No! Really?', 'I always knew it.', 'You shouldn\'t say such things… tell me more.', 'Pfft. I don\'t believe a word.']));
          break;
        }
        case 'work':
          say(s, pick(WORK[A.role] ?? WORK.laborer));
          say(o, pick(['Same as ever, then.', 'At least you have work.', 'Rather you than me.']));
          break;
        case 'family': {
          const hh = g.towns.byBuilding.get(B.home)?.household;
          const kid = hh?.members.find((x) => x.role === 'child');
          say(s, kid ? `How's little ${kid.name.split(' ')[0]}?` : 'How\'s the family?');
          say(o, pick(['Growing like a weed. Eats like a horse.', 'Fevered last week, better now, thank the gods.', 'Driving me mad, as ever.', 'Well enough. Thanks for asking.']));
          break;
        }
        case 'stranger':
          say(s, g.law.wanted > 0 ? 'Don\'t look now — that\'s the one from the posters.' : 'Who\'s that? Never seen them before.');
          say(o, g.law.wanted > 0 ? 'Keep your purse close.' : pick(['A traveller. Probably passing through.', 'Spy, maybe. Keep your voice down.', 'Looks harmless enough.']));
          break;
      }
    }
    // farewell
    say(0, pick(['Well, I\'d best be off.', 'Can\'t stand here all day.', 'I\'ll let you get on.', night ? 'Get some sleep.' : 'Mind how you go.']));
    say(1, pick([`Take care, ${fa}.`, 'And you.', `Gods keep you, ${fa}.`, 'Until tomorrow.']));
    return out;
  }
}
