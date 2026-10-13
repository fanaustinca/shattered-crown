// Sky dome, sun/moon state, and the environment (IBL) capture of the sky.
import * as THREE from 'three';
import { SKY_GLSL, SKY_UNIFORMS } from './skyglsl';

export const skyUniforms = {
  uSunDir: { value: new THREE.Vector3(0.3, 0.6, -0.4).normalize() },
  uMoonDir: { value: new THREE.Vector3(-0.3, 0.5, 0.4).normalize() },
  uSkyScale: { value: 0.2 },
  uTurbidity: { value: 2.4 },
  uOvercast: { value: 0 },
  uTime: { value: 0 },
};

export function makeSkyMaterial(discs = 1) {
  return new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = (modelMatrix * vec4(position, 0.0)).xyz;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: SKY_UNIFORMS + SKY_GLSL + /* glsl */ `
      varying vec3 vDir;
      void main() {
        gl_FragColor = vec4(skyRadiance(normalize(vDir), ${discs.toFixed(1)}), 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
}

export class Sky {
  mesh: THREE.Mesh;
  envScene = new THREE.Scene();
  pmrem: THREE.PMREMGenerator;
  envRT: THREE.WebGLRenderTarget | null = null;
  private lastEnvSun = new THREE.Vector3(0, -2, 0);
  private lastOvercast = -1;
  constructor(private renderer: THREE.WebGLRenderer) {
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), makeSkyMaterial(1));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), makeSkyMaterial(0));
    envSky.scale.setScalar(100);
    this.envScene.add(envSky);
    // a dark ground disc so the IBL's lower hemisphere isn't sky-coloured
    const ground = new THREE.Mesh(new THREE.CircleGeometry(100, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -2;
    (ground.material as THREE.MeshBasicMaterial).color.setRGB(0.05, 0.045, 0.035);
    this.groundMat = ground.material as THREE.MeshBasicMaterial;
    this.envScene.add(ground);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }
  groundMat: THREE.MeshBasicMaterial;

  update(camera: THREE.Camera) {
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(20000);
  }

  /** Re-capture the sky into the IBL environment when the sun has moved enough. */
  updateEnv(force = false): THREE.Texture | null {
    const s = skyUniforms.uSunDir.value;
    if (!force && s.distanceTo(this.lastEnvSun) < 0.02 && Math.abs(this.lastOvercast - skyUniforms.uOvercast.value) < 0.03) return null;
    this.lastEnvSun.copy(s);
    this.lastOvercast = skyUniforms.uOvercast.value;
    // ground bounce colour follows daylight
    const day = THREE.MathUtils.smoothstep(s.y, -0.15, 0.4);
    this.groundMat.color.setRGB(0.09 * day + 0.002, 0.085 * day + 0.002, 0.06 * day + 0.003);
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000, { size: 128 } as never);
    old?.dispose();
    return this.envRT.texture;
  }
}

// ---- CPU mirror of the sky model for light colours ----
const totalRayleigh = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MieConst = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
/** Sun transmittance through the atmosphere (linear RGB, 0..1). */
export function sunTransmittance(sunY: number, turbidity: number, out = new THREE.Color()): THREE.Color {
  const y = Math.max(0.0, Math.min(1, sunY));
  const za = Math.acos(y);
  const inv = 1 / (Math.cos(za) + 0.15 * Math.pow(Math.max(1e-3, 93.885 - (za * 180) / Math.PI), -1.253));
  const c = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const bR = totalRayleigh[i] * 1.6;
    const bM = 0.434 * (0.2 * turbidity) * 10e-18 * MieConst[i] * 0.005;
    c[i] = Math.exp(-(bR * 8.4e3 * inv + bM * 1.25e3 * inv));
  }
  return out.setRGB(c[0], c[1], c[2]);
}
