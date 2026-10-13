import { Game } from './game';
import { installDebugApi } from './debug';
import { coatFor } from './creature/rig';
(window as unknown as { __coatFor: typeof coatFor }).__coatFor = coatFor;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const bar = document.getElementById('loadbar')!;
const msg = document.getElementById('loadmsg')!;
const game = new Game(canvas);
installDebugApi(game);
game.init((f, m) => { bar.style.width = `${Math.round(f * 100)}%`; msg.textContent = m + '…'; })
  .then(() => {
    document.getElementById('loading')!.classList.add('done');
    game.start();
  })
  .catch((e) => { msg.textContent = 'Failed to load: ' + (e?.message || e); console.error(e); });
