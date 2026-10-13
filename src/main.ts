import { Game } from './game';
import { installDebugApi } from './debug';
import { installDevConsole } from './devconsole';
import { coatFor } from './creature/rig';
import * as Anim from './creature/anim';
import * as Furn from './props/furniture';
import { FurnitureNode } from './props/furnish';
(window as unknown as { __coatFor: typeof coatFor }).__coatFor = coatFor;
(window as unknown as { __anim: typeof Anim }).__anim = Anim;
(window as unknown as { __furn: unknown }).__furn = { ...Furn, FurnitureNode };

const canvas = document.getElementById('game') as HTMLCanvasElement;
// surface runtime errors on screen (players can report them; the console isn't always open)
const errBox = document.createElement('div');
errBox.style.cssText = 'position:fixed;left:8px;bottom:8px;max-width:60vw;z-index:99;font:12px monospace;color:#fdd;background:rgba(60,0,0,.8);padding:6px 8px;border-radius:4px;display:none;white-space:pre-wrap';
document.body.appendChild(errBox);
let errN = 0;
const showErr = (m: string) => { if (++errN > 4) return; errBox.style.display = 'block'; errBox.textContent += (errBox.textContent ? '\n' : '') + m.slice(0, 300); setTimeout(() => { errBox.style.display = 'none'; errBox.textContent = ''; errN = 0; }, 15000); };
window.addEventListener('error', (e) => showErr('Error: ' + (e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => showErr('Error: ' + ((e.reason as Error)?.message ?? e.reason)));
const bar = document.getElementById('loadbar')!;
const msg = document.getElementById('loadmsg')!;
const game = new Game(canvas);
const test = new URLSearchParams(location.search).has('test');
installDebugApi(game);
game.init((f, m) => { bar.style.width = `${Math.round(f * 100)}%`; msg.textContent = m + '…'; })
  .then(() => {
    document.getElementById('loading')!.classList.add('done');
    game.start();
    installDevConsole(game);
    if (!test) {
      // a slow orbit behind the title screen
      game.freeCam = true;
      let a = 0;
      const orbit = setInterval(() => { a += 0.0015; const s = game.towns.plans[0].site; game.camera.position.set(s.x + Math.cos(a) * 320, game.world.heightAt(s.x, s.z) + 90, s.z + Math.sin(a) * 320); game.camera.lookAt(s.x, game.world.heightAt(s.x, s.z) + 10, s.z); }, 16);
      game.ui.showTitle(() => { clearInterval(orbit); game.freeCam = false; game.started = true; game.player.updateCamera(game.camera, 1); game.hud.toast('Press H for help with the controls. F12 console: type help() for dev commands.'); });
    } else game.started = true;
  })
  .catch((e) => { msg.textContent = 'Failed to load: ' + (e?.message || e); console.error(e); });
