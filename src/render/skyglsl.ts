// Shared GLSL for the physically based sky: used by the sky dome, the environment-map capture,
// aerial perspective in the atmosphere pass, and the water reflections.
export const SKY_UNIFORMS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uSkyScale;
uniform float uTurbidity;
uniform float uOvercast;
uniform float uTime;
`;

export const SKY_GLSL = /* glsl */ `
const float SKY_PI = 3.141592653589793;
const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);

float sunIntensityF(float zc) {
  zc = clamp(zc, -1.0, 1.0);
  return 1000.0 * max(0.0, 1.0 - exp(-((1.6110731556870734 - acos(zc)) / 1.5)));
}
float hashSky(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }

// Radiance toward 'direction'. 'discs' adds the sun/moon discs and stars.
vec3 skyRadiance(vec3 direction, float discs) {
  vec3 sunDir = normalize(uSunDir);
  float sunE = sunIntensityF(sunDir.y);
  float sunfade = 1.0 - clamp(1.0 - exp(sunDir.y * 450000.0 / 450000.0), 0.0, 1.0);
  float rayleighCoef = 1.0 - (1.0 - sunfade);
  vec3 betaR = totalRayleigh * (rayleighCoef + 0.6);
  vec3 betaM = 0.434 * (0.2 * uTurbidity) * 10E-18 * MieConst * 0.005;
  vec3 d = direction;
  d.y = max(d.y, 0.0) * 0.98 + 0.02;   // keep the horizon band just below 0 so the sky meets the sea
  d = normalize(d);
  float zenithAngle = acos(max(0.0, d.y));
  float inv = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / SKY_PI), -1.253));
  vec3 Fex = exp(-(betaR * 8.4E3 * inv + betaM * 1.25E3 * inv));
  float cosTheta = dot(direction, sunDir);
  float rPhase = 0.05968310365946075 * (1.0 + pow(cosTheta * 0.5 + 0.5, 2.0));
  float g = 0.8, g2 = g * g;
  float mPhase = 0.07957747154594767 * ((1.0 - g2) / pow(1.0 - 2.0 * g * cosTheta + g2, 1.5));
  vec3 bRT = betaR * rPhase, bMT = betaM * mPhase;
  vec3 Lin = pow(sunE * ((bRT + bMT) / (betaR + betaM)) * (1.0 - Fex), vec3(1.5));
  Lin *= mix(vec3(1.0), pow(sunE * ((bRT + bMT) / (betaR + betaM)) * Fex, vec3(0.5)), clamp(pow(1.0 - sunDir.y, 5.0), 0.0, 1.0));
  vec3 col = ((Lin + vec3(0.1) * Fex) * 0.04 + vec3(0.0, 0.0003, 0.00075)) * uSkyScale;

  // night sky: deep blue gradient + stars + moon
  float night = smoothstep(0.02, -0.18, sunDir.y);
  vec3 nightCol = mix(vec3(0.0035, 0.0055, 0.011), vec3(0.0016, 0.0026, 0.0065), clamp(direction.y, 0.0, 1.0));
  vec3 moon = normalize(uMoonDir);
  float mc = dot(direction, moon);
  nightCol += vec3(0.006, 0.009, 0.015) * pow(max(mc, 0.0), 10.0) * max(moon.y + 0.1, 0.0);
  col = col + nightCol * night;
  if (discs > 0.5) {
    if (direction.y > 0.0) {
      vec3 sd = direction * 420.0;
      vec3 cell = floor(sd);
      float h = hashSky(cell);
      if (h > 0.9975) {
        vec3 c = cell + 0.5 + 0.35 * (vec3(hashSky(cell + 1.7), hashSky(cell + 3.1), hashSky(cell + 5.3)) - 0.5);
        float dd = length(sd - c);
        float tw = 0.65 + 0.35 * sin(uTime * (2.0 + h * 40.0) + h * 100.0);
        float star = smoothstep(0.42, 0.0, dd) * (h - 0.9975) * 400.0 * tw;
        vec3 sc = mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.85, 0.7), hashSky(cell + 9.0));
        col += sc * star * 0.06 * night * smoothstep(0.0, 0.15, direction.y) * (1.0 - uOvercast);
      }
      // milky band
      float band = exp(-pow(dot(direction, normalize(vec3(0.3, 0.2, 0.93))) * 3.2, 2.0));
      col += vec3(0.0009, 0.001, 0.0014) * band * night * (1.0 - uOvercast) * (0.6 + 0.4 * hashSky(floor(direction * 90.0)));
    }
    // moon disc with simple phase shading
    float moonDisc = smoothstep(0.99955, 0.99965, mc);
    if (moonDisc > 0.0) {
      vec3 mn = normalize(direction - moon * mc);
      float lit = clamp(dot(normalize(direction - moon), -sunDir) * 0.5 + 0.6, 0.05, 1.0);
      float crater = 0.8 + 0.2 * hashSky(floor(direction * 3000.0));
      col += vec3(0.32, 0.31, 0.28) * moonDisc * lit * crater * (1.0 - uOvercast * 0.9);
    }
    // sun disc
    float sundisc = smoothstep(0.999956, 0.99997, cosTheta);
    col += (19000.0 * sundisc) * min(sunE * Fex, 80.0) * 0.0004 * uSkyScale * 5.0 * (1.0 - uOvercast);
  }
  // overcast: flatten toward a grey dome lit by the hidden sun
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float dayL = smoothstep(-0.12, 0.35, sunDir.y);
  vec3 grey = vec3(0.62, 0.66, 0.72) * (0.06 * dayL * uSkyScale * 5.0 + 0.003) * (0.75 + 0.25 * clamp(direction.y, 0.0, 1.0));
  col = mix(col, grey, uOvercast * 0.85);
  return col;
}

// Approximate transmittance of sunlight reaching the ground (for sun colour/intensity).
vec3 sunTransmittance(vec3 sunDir) {
  float zenithAngle = acos(clamp(sunDir.y, 0.0, 1.0));
  float inv = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / SKY_PI), -1.253));
  vec3 betaR = totalRayleigh * 1.6;
  vec3 betaM = 0.434 * (0.2 * uTurbidity) * 10E-18 * MieConst * 0.005;
  return exp(-(betaR * 8.4E3 * inv + betaM * 1.25E3 * inv));
}
`;
