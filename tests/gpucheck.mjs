import { launch } from './harness.mjs';
const b = await launch();
const p = await b.newPage();
await p.goto('about:blank');
console.log(await p.evaluate(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); if (!gl) return 'no webgl2'; const d = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(d.UNMASKED_RENDERER_WEBGL) + ' | maxtex ' + gl.getParameter(gl.MAX_TEXTURE_SIZE) + ' | float lin ' + !!gl.getExtension('OES_texture_float_linear') + ' | clip ' + !!gl.getExtension('EXT_clip_control'); }));
await b.close();
