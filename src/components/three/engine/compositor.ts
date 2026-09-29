import * as THREE from "three";
import type { TransitionKind } from "@/worlds/types";

export const TRANSITION_INDEX: Record<TransitionKind, number> = {
  dissolve: 0,
  chroma: 1,
  frost: 2,
  refract: 3,
  dive: 4,
  wipe: 5,
};

/** "none" is for pre-rendered Cycles imagery that is already display-referred. */
export type ToneMap = "agx" | "aces" | "neutral" | "none";
export const TONE_INDEX: Record<ToneMap, number> = { agx: 0, aces: 1, neutral: 2, none: 3 };

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tA;
  uniform sampler2D tB;
  uniform float uMix;
  uniform int uKind;
  uniform bool uHasA;
  uniform bool uHasB;
  uniform float uExposureA;
  uniform float uExposureB;
  uniform int uToneA;
  uniform int uToneB;
  uniform float uTime;
  uniform vec2 uRes;
  uniform float uGrain;
  uniform float uVignette;
  uniform float uVelocity;
  uniform vec3 uSeam;

  // ---- tone mapping (scene-referred linear in, display-referred linear out)
  vec3 agxContrast(vec3 x) {
    vec3 x2 = x * x; vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  }
  vec3 agx(vec3 c) {
    const mat3 inset = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859);
    const mat3 outset = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
    const float minEv = -12.47393; const float maxEv = 4.026069;
    c = inset * max(c, vec3(1e-10));
    c = clamp(log2(c), minEv, maxEv);
    c = (c - minEv) / (maxEv - minEv);
    c = agxContrast(c);
    c = outset * c;
    c = pow(max(vec3(0.0), c), vec3(2.2));
    return clamp(c, 0.0, 1.0);
  }
  vec3 aces(vec3 x) {
    x *= 0.6;
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  vec3 neutral(vec3 color) {
    const float startCompression = 0.8 - 0.04; const float desaturation = 0.15;
    float x = min(color.r, min(color.g, color.b));
    float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    color -= offset;
    float peak = max(color.r, max(color.g, color.b));
    if (peak < startCompression) return color;
    float d = 1.0 - startCompression;
    float newPeak = 1.0 - d * d / (peak + d - startCompression);
    color *= newPeak / peak;
    float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(color, vec3(newPeak), g);
  }
  vec3 tonemap(vec3 c, int op, float exposure) {
    c *= exposure;
    if (op == 1) return aces(c);
    if (op == 2) return neutral(c);
    if (op == 3) return clamp(c, 0.0, 1.0);
    return agx(c);
  }

  // ---- noise
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
  vec2 voronoi(vec2 p) {
    vec2 g = floor(p); vec2 f = fract(p); float d1 = 8.0; float d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 r = o + vec2(hash(g + o), hash(g + o + 17.1)) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
    return vec2(sqrt(d1), sqrt(d2));
  }

  vec3 sampleA(vec2 uv) { return tonemap(texture2D(tA, uv).rgb, uToneA, uExposureA); }
  vec3 sampleB(vec2 uv) { return tonemap(texture2D(tB, uv).rgb, uToneB, uExposureB); }

  vec3 radialA(vec2 uv, float amount) {
    vec3 acc = vec3(0.0); vec2 dir = uv - 0.5;
    for (int i = 0; i < 8; i++) acc += sampleA(0.5 + dir * (1.0 - amount * float(i) / 8.0));
    return acc / 8.0;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uRes.x / uRes.y;
    float p = clamp(uMix, 0.0, 1.0);
    vec3 col;

    if (!uHasB || p <= 0.0001) {
      // Subtle velocity-driven chromatic fringe keeps fast scrolling feeling physical.
      float ca = clamp(abs(uVelocity) * 0.0025, 0.0, 0.004);
      if (ca > 0.0002) {
        vec2 d = (uv - 0.5) * ca;
        col = vec3(sampleA(uv + d).r, sampleA(uv).g, sampleA(uv - d).b);
      } else {
        col = sampleA(uv);
      }
    } else if (p >= 0.9999 || !uHasA) {
      col = sampleB(uv);
    } else if (uKind == 1) {
      // chroma: RGB split that peaks mid-transition, with a slight push-in.
      float peak = sin(p * 3.14159);
      vec2 d = (uv - 0.5) * peak * 0.05;
      vec2 zoomA = 0.5 + (uv - 0.5) * (1.0 - peak * 0.06);
      vec2 zoomB = 0.5 + (uv - 0.5) * (1.0 + (1.0 - p) * 0.08);
      vec3 a = vec3(sampleA(zoomA + d).r, sampleA(zoomA).g, sampleA(zoomA - d).b);
      vec3 b = vec3(sampleB(zoomB - d).r, sampleB(zoomB).g, sampleB(zoomB + d).b);
      float n = fbm(uv * vec2(aspect, 1.0) * 2.0 + uTime * 0.1);
      col = mix(a, b, smoothstep(0.35, 0.65, p + (n - 0.5) * 0.3));
    } else if (uKind == 2) {
      // frost: ice crystals grow in from the edges.
      vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
      vec2 v = voronoi(q * 9.0 + 3.0);
      float edge = length(q) * 1.3 + (v.x - 0.3) * 0.35;
      float grow = mix(1.25, -0.2, p);
      float m = smoothstep(grow + 0.08, grow - 0.08, edge);
      float cracks = smoothstep(0.06, 0.0, v.y - v.x) * (1.0 - abs(m * 2.0 - 1.0));
      vec2 refr = (vec2(hash(floor(q * 40.0)), hash(floor(q * 40.0) + 5.0)) - 0.5) * 0.01 * (1.0 - abs(p * 2.0 - 1.0));
      col = mix(sampleA(uv + refr), sampleB(uv - refr), m) + cracks * vec3(0.8, 0.9, 1.0) * 0.6;
    } else if (uKind == 3) {
      // refract: through a curved glass lens (snow globe).
      vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
      float r = length(c);
      float k = sin(p * 3.14159) * 0.55;
      vec2 warpA = 0.5 + (uv - 0.5) * (1.0 - k * (1.0 - r * r) * 0.9) * (1.0 - p * 0.4);
      vec2 warpB = 0.5 + (uv - 0.5) * (1.0 + k * r * 0.8) * (0.8 + p * 0.2);
      float lens = smoothstep(p * 1.6 - 0.1, p * 1.6 + 0.1, r);
      col = mix(sampleB(warpB), sampleA(warpA), lens);
      col += (1.0 - smoothstep(0.0, 0.05, abs(r - p * 1.6))) * 0.25 * sin(p * 3.14159);
    } else if (uKind == 4) {
      // dive: fly through the centre of A into B.
      float zoom = pow(p, 1.6);
      vec2 uvA = 0.5 + (uv - 0.5) / (1.0 + zoom * 5.0);
      vec3 a = radialA(uvA, zoom * 0.5);
      vec2 uvB = 0.5 + (uv - 0.5) * mix(1.6, 1.0, smoothstep(0.35, 1.0, p));
      vec3 b = sampleB(uvB);
      float t = smoothstep(0.45, 0.8, p);
      float flash = exp(-pow((p - 0.55) * 7.0, 2.0)) * 0.6;
      col = mix(a, b, t) + flash * uSeam;
    } else if (uKind == 5) {
      // wipe: soft diagonal sweep with a displaced, glowing edge.
      float n = fbm(uv * vec2(aspect, 1.0) * 3.0) - 0.5;
      float line = (uv.x * 0.8 + (1.0 - uv.y) * 0.4) / 1.2 + n * 0.12;
      float edge = mix(-0.15, 1.15, p);
      float m = smoothstep(edge + 0.06, edge - 0.06, line);
      vec2 push = vec2(0.03, 0.0) * (1.0 - abs(p * 2.0 - 1.0));
      col = mix(sampleA(uv - push), sampleB(uv + push * 0.5), m);
      col += smoothstep(0.03, 0.0, abs(line - edge)) * uSeam * 0.5;
    } else {
      // dissolve: organic noise burn with a glowing seam.
      float n = fbm(uv * vec2(aspect, 1.0) * 3.5 + vec2(0.0, uTime * 0.03));
      float edge = mix(-0.1, 1.1, p);
      float m = smoothstep(edge - 0.08, edge + 0.08, n);
      col = mix(sampleB(uv), sampleA(uv), m);
      col += (1.0 - smoothstep(0.0, 0.04, abs(n - edge))) * uSeam * 0.45 * sin(p * 3.14159);
    }

    // Vignette + grain + dither, all in display-referred space.
    vec2 vq = (uv - 0.5) * vec2(aspect, 1.0);
    col *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(vq));
    float g = hash(uv * uRes + fract(uTime * 13.7) * 100.0) - 0.5;
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col += g * uGrain * (0.35 + 0.65 * (1.0 - luma));
    col += (hash(uv * uRes + 0.37) - 0.5) / 255.0;

    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <colorspace_fragment>
  }
`;

export function createCompositor() {
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      tA: { value: null },
      tB: { value: null },
      uMix: { value: 0 },
      uKind: { value: 0 },
      uHasA: { value: false },
      uHasB: { value: false },
      uExposureA: { value: 1 },
      uExposureB: { value: 1 },
      uToneA: { value: 0 },
      uToneB: { value: 0 },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uGrain: { value: 0.035 },
      uVignette: { value: 0.35 },
      uVelocity: { value: 0 },
      uSeam: { value: new THREE.Color("#ffffff") },
    },
  });
  const geometry = new THREE.BufferGeometry();
  // Single oversized triangle covers the screen with no diagonal seam.
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    material,
    render(gl: THREE.WebGLRenderer) {
      gl.setRenderTarget(null);
      gl.render(scene, camera);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export type Compositor = ReturnType<typeof createCompositor>;
