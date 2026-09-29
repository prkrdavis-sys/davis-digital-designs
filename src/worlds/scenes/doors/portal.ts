import * as THREE from "three";

/**
 * A window into another world. The world's 360 panorama is sampled by view
 * direction expressed in the door's frame (into / right / up), so the world
 * appears to sit infinitely far behind the doorway and parallaxes correctly
 * as the camera moves. Without a panorama it paints an aurora in the world's
 * palette. UV is the opening in meters (x across, y up) for the rim glow.
 */

const vertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  #define PI 3.14159265
  varying vec2 vUv;
  varying vec3 vWorld;
  uniform sampler2D uPano;
  uniform float uHasPano;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  uniform vec3 uInto;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform float uW;
  uniform float uH;
  uniform float uTime;
  uniform float uOpen;
  uniform float uGain;
  uniform float uNight;
  uniform float uMirror;
  uniform float uSeed;

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 3.1; a *= 0.5; } return v; }

  vec3 aurora(vec3 d) {
    float el = d.y;
    float az = atan(d.x, d.z);
    vec2 q = vec2(az * 1.6, el * 2.2);
    float t = uTime * 0.05 + uSeed;
    float n = fbm(q + vec2(t, -t * 0.6));
    float n2 = fbm(q * 2.3 - vec2(t * 1.4, 0.0) + n);
    vec3 col = mix(uB, uA, smoothstep(-0.35, 0.55, el + (n - 0.5) * 0.5));
    col = mix(col, uC, smoothstep(0.55, 0.9, n2) * 0.7);
    // Horizon glow and drifting light ribbons.
    col += uC * exp(-pow((el - 0.02 + (n - 0.5) * 0.15) * 7.0, 2.0)) * 0.6;
    float ribbon = smoothstep(0.02, 0.0, abs(fract(az * 0.5 + el * 1.5 + n2 * 0.6 - t) - 0.5) - 0.44);
    col += uA * ribbon * 0.25;
    if (uNight > 0.5) {
      vec2 sq = floor(q * 60.0);
      float star = step(0.996, hash(sq)) * (0.6 + 0.4 * sin(uTime * 2.0 + hash(sq + 3.0) * 30.0));
      col = col * 0.55 + star * 1.6;
    }
    return col;
  }

  void main() {
    vec3 d = normalize(vWorld - cameraPosition);
    d.y *= uMirror;
    d = normalize(mix(d, uInto, uOpen * 0.18));
    float a = dot(d, uRight);
    float b = dot(d, uInto);
    float c = dot(d, uUp);
    vec3 col;
    if (uHasPano > 0.5) {
      // Membrane ripple: the view wobbles a little near the edge of the opening.
      vec2 uv = vec2(0.5 + atan(a, b) / (2.0 * PI), 0.5 + asin(clamp(c, -1.0, 1.0)) / PI);
      uv += (vec2(noise(vUv * 3.0 + uTime * 0.4), noise(vUv * 3.0 - uTime * 0.37)) - 0.5) * 0.004 * (1.0 + uOpen * 2.0);
      col = texture2D(uPano, uv).rgb;
    } else {
      col = aurora(vec3(a, c, b));
    }

    // Distance to the arch outline (meters, positive inside).
    float x = vUv.x;
    float z = vUv.y;
    float side = uW - abs(x);
    float top = z > uH ? uW - length(vec2(x, z - uH)) : 1e3;
    float e = max(0.0, min(min(side, top), z));
    float rim = exp(-e * 9.0);
    float haze = exp(-e * 2.2);
    col = mix(col, uA * 1.2, haze * 0.18 * (1.0 - uOpen * 0.5));
    col *= uGain * (1.0 + uOpen * 0.55);
    col += mix(uA, uC, 0.35) * rim * (0.6 + uOpen * 1.8) * (uNight > 0.5 ? 1.6 : 1.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface PortalUniforms {
  [key: string]: THREE.IUniform;
  uPano: THREE.IUniform<THREE.Texture | null>;
  uHasPano: THREE.IUniform<number>;
  uOpen: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  uGain: THREE.IUniform<number>;
}

export function portalMaterial(opts: {
  colors: [string, string, string];
  into: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  w: number;
  h: number;
  night: boolean;
  mirror?: boolean;
  seed: number;
}) {
  const uniforms: PortalUniforms = {
    uPano: { value: null },
    uHasPano: { value: 0 },
    uA: { value: new THREE.Color(opts.colors[0]) },
    uB: { value: new THREE.Color(opts.colors[1]) },
    uC: { value: new THREE.Color(opts.colors[2]) },
    uInto: { value: opts.into.clone() },
    uRight: { value: opts.right.clone() },
    uUp: { value: opts.up.clone() },
    uW: { value: opts.w },
    uH: { value: opts.h },
    uTime: { value: 0 },
    uOpen: { value: 0 },
    uGain: { value: opts.night ? 1.9 : 1.25 },
    uNight: { value: opts.night ? 1 : 0 },
    uMirror: { value: opts.mirror ? -1 : 1 },
    uSeed: { value: opts.seed },
  };
  return new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms, fog: false });
}
