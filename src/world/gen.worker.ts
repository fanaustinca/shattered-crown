// Generates a band of heightmap rows off the main thread.
import { generateRows } from './terrainfn';

self.onmessage = (e: MessageEvent<{ r0: number; r1: number }>) => {
  const { r0, r1 } = e.data;
  const out = generateRows(r0, r1);
  (self as unknown as Worker).postMessage({ r0, r1, ...out }, [out.heights.buffer, out.bio.buffer, out.wet.buffer]);
};
