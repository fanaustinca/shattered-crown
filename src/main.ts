import { Game } from './game';
import { installDebugApi } from './debug';
import { coatFor } from './creature/rig';
import * as Anim from './creature/anim';
import * as Furn from './props/furniture';
import { FurnitureNode } from './props/furnish';
(window as unknown as { __coatFor: typeof coatFor }).__coatFor = coatFor;
(window as unknown as { __anim: typeof Anim }).__anim = Anim;
(window as unknown as { __furn: unknown }).__furn = { ...Furn, FurnitureNode };

const canvas = document.getElementById('game') as HTMLCanvasElement;
const bar = document.getElementById('loadbar')!;
const msg = document.getElementById('loadmsg')!;
const game = new Game(canvas);
const test = new URLSearchParams(location.search).has('test');
installDebugApi(game);
game.init((f, m) => { bar.style.width = `${Math.round(f * 100)}%`; msg.textContent = m + '…'; })
  .then(() => {
    document.getElementById('loading')!.classList.add('done');
    game.start();
    if (!test) {
      // a slow orbit behind the title screen
      game.freeCam = true;
      let a = 0;
      const orbit = setInterval(() => { a += 0.0015; const s = game.towns.plans[0].site; game.camera.position.set(s.x + Math.cos(a) * 320, game.world.heightAt(s.x, s.z) + 90, s.z + Math.sin(a) * 320); game.camera.lookAt(s.x, game.world.heightAt(s.x, s.z) + 10, s.z); }, 16);
      game.ui.showTitle(() => { clearInterval(orbit); game.freeCam = false; game.started = true; game.hud.toast('Press H for help with the controls.'); });
    } else game.started = true;
  })
  .catch((e) => { msg.textContent = 'Failed to load: ' + (e?.message || e); console.error(e); });
