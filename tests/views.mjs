// Named camera views for visual QA. cam = [x, y, z, tx, ty, tz]; y may be 'g+N' (N m above ground).
export const VIEWS = [
  { name: 'aurelhold-plains', time: 9.5, cam: [-1250, 'g+40', 750, -1250, 'g+5', 350] },
  { name: 'river-valley', time: 16.5, cam: [-250, 'g+30', 300, 200, 'g+0', 600] },
  { name: 'ironreach-mtns', time: 11, cam: [600, 'g+60', -500, 1500, 'g+60', -600] },
  { name: 'aerial', time: 10, cam: [-2500, 1800, 3500, 0, 0, 0] },
  { name: 'sunset-coast', time: 18.6, cam: [-1250, 'g+12', 2000, -1250, 3, 2700] },
  { name: 'ground-grass', time: 13, cam: [-900, 'g+1.7', 300, -800, 'g+1.5', 250] },
];
VIEWS.push(
  { name: 'nofog-ground', time: 11, setup: (SC) => { SC.game.pipeline.atmoUniforms.uFogDensity.value = 0; SC.game.pipeline.atmoUniforms.uCloudCover.value = 0; }, cam: [-900, 'g+3', 300, -880, 'g+0', 280] },
);
VIEWS.push(
  { name: 'forest-east', time: 10.5, cam: [700, 'g+2', -1300, 760, 'g+6', -1350] },
  { name: 'forest-west', time: 15, cam: [-1700, 'g+2', -800, -1650, 'g+5', -850] },
);
VIEWS.push(
  { name: 'river-close', time: 14, cam: [riverXjs(-200) - 50, 'g+4', -200, riverXjs(-200) + 30, 'g-2', -150] },
  { name: 'ocean', time: 17.2, cam: [-1250, 'g+6', 2330, -1300, 2, 2700] },
);
function riverXjs(z) { return 60 + 140 * Math.sin(z / 610 + 0.4) + 55 * Math.sin(z / 233 + 1.3) + 18 * Math.sin(z / 97 + 2.1); }
VIEWS.push(
  { name: 'dusk-coast', time: 18.35, cam: [-1250, 'g+12', 2000, -1250, 3, 2700] },
  { name: 'night-plains', time: 23, cam: [-900, 'g+3', 300, -800, 'g+8', 250] },
  { name: 'dawn-mtns', time: 6.1, cam: [600, 'g+60', -500, 1500, 'g+60', -600] },
);
VIEWS.push(
  { name: 'gallery-animals', time: 11, setup: (SC) => { SC.gallery(-900, 300, ['horse', 'donkey', 'cow', 'pig', 'bunny', 'chicken', 'crow', 'pigeon', 'sparrow']); }, cam: [-893, 'g+1.6', 305.5, -893, 'g+0.8', 300] },
  { name: 'gallery-humans', time: 11, setup: (SC) => { SC.gallery(-920, 320, ['human0', 'human1', 'human2', 'human3', 'human4', 'human5']); }, cam: [-917.3, 'g+1.5', 323.2, -917.3, 'g+1.1', 320] },
);
VIEWS.push(
  { name: 'herd', time: 10, setup: async (SC) => { const h = SC.game.fauna.herds.find((h) => h.species === 'horse' && h.owner === 'aurelhold'); SC.teleport(h.x + 12, h.z + 12); SC.hold([], 6); SC.game.freeCam = true; window.__h = h; }, frames: 2, cam: null },
);
VIEWS.push(
  { name: 'town-millbrook', time: 10, setup: (SC) => { const s = SC.site('millbrook').site; SC.stream(s.x, s.z); SC.view(s.x - 40, 'g+14', s.z + 30, s.x, 'g+2', s.z); } },
  { name: 'town-aurelhold', time: 15, setup: (SC) => { const s = SC.site('aurelhold').site; SC.stream(s.x, s.z); SC.view(s.x + 60, 'g+25', s.z + 50, s.x, 'g+3', s.z); } },
  { name: 'castle-whitecrest', time: 9, setup: (SC) => { const s = SC.site('whitecrest').site; SC.stream(s.x, s.z); SC.view(s.x - 150, 'g+40', s.z + 120, s.x, 'g+8', s.z); } },
  { name: 'town-ironspire', time: 12, setup: (SC) => { const s = SC.site('ironspire').site; SC.stream(s.x, s.z); SC.view(s.x - 80, 'g+30', s.z + 80, s.x, 'g+3', s.z); } },
  { name: 'interior-1', time: 11, setup: (SC) => { window.__int = SC.interior('millbrook', 0, 0); } },
  { name: 'interior-2', time: 21, setup: (SC) => { window.__int = SC.interior('aurelhold', 3, 1); } },
);
VIEWS.push(
  { name: 'wall-close', time: 10, setup: (SC) => { const s = SC.site('whitecrest').site; SC.stream(s.x, s.z); const a = (s.gateYaw ?? 0) + 0.5, rr = s.r * 0.82; SC.view(s.x + Math.cos(a) * (rr + 30), 'g+4', s.z + Math.sin(a) * (rr + 30), s.x + Math.cos(a) * rr, 'g+8', s.z + Math.sin(a) * rr); } },
  { name: 'wall-dark', time: 14, setup: (SC) => { const s = SC.site('ironspire').site; SC.stream(s.x, s.z); const a = 2.0, rr = s.r * 0.99; SC.view(s.x + Math.cos(a) * (rr + 40), 'g+6', s.z + Math.sin(a) * (rr + 40), s.x + Math.cos(a) * rr, 'g+8', s.z + Math.sin(a) * rr); } },
  { name: 'farm', time: 11, setup: (SC) => { const pl = SC.site('millbrook'); const pd = pl.paddocks[0]; SC.teleport(pd.x + 25, pd.z + 25); SC.hold([], 3); SC.view(pd.x + 30, 'g+9', pd.z + 30, pd.x, 'g+1', pd.z); } },
  { name: 'town-street', time: 16, setup: (SC) => { const s = SC.site('millbrook').site; SC.teleport(s.x + 3, s.z + 3); SC.hold([], 2); SC.view(s.x + 2, 'g+1.7', s.z + 2, s.x + 30, 'g+2', s.z + 18); } },
);
