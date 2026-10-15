// Texture decoding off the main thread: fetch, decode without premultiplication, read back raw RGBA.
let gl: WebGL2RenderingContext | null = null;
self.onmessage = async (e: MessageEvent<{ id: number; url: string; size: number }>) => {
  const { id, url, size } = e.data;
  try {
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', resizeWidth: size, resizeHeight: size, resizeQuality: 'high' });
    if (!gl) gl = new OffscreenCanvas(1, 1).getContext('webgl2', { premultipliedAlpha: false }) as WebGL2RenderingContext;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const out = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
    bmp.close();
    (self as unknown as Worker).postMessage({ id, out }, [out.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
