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
