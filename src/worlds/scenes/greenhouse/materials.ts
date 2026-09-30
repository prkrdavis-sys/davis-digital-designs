import * as THREE from "three";
import { SUNVIS_GLSL, type sunVisUniforms } from "@/worlds/scenes/greenhouse/sunvis";

/** Shared GLSL: equirect lookup matching Blender's environment layout (and three's). */
const EQUIRECT = /* glsl */ `
  vec2 equirectUv(vec3 d) {
    d = normalize(d);
    return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
  }
`;

const NOISE = /* glsl */ `
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
  float vnoise3(vec3 p) { vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y);
    float b = mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y);
    return mix(a, b, f.z); }
  float fbm3(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise3(p); p *= 2.07; a *= 0.5; } return v; }
`;

// --------------------------------------------------------------------------
const floorVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const floorFragment = /* glsl */ `
  uniform sampler2D tAlbedo;
  uniform sampler2D tNormal;
  uniform sampler2D tRough;
  uniform sampler2D tLight;
  uniform sampler2D tEnv;
  uniform vec4 uBounds;
  uniform float uTile;
  uniform float uLmScale;
  uniform float uEnvGain;
  uniform float uTime;
  uniform float uCaustic;
  uniform float uShade;
  uniform vec3 uCausticColor;
  varying vec3 vWorld;
  ${EQUIRECT}
  ${NOISE}

  // Thin bright filaments drifting slowly: light refracted by old wavy glass and stirred leaves.
  float caustic(vec2 p, float t) {
    vec2 q = p;
    float c = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      q = p + vec2(cos(t * (0.21 + fi * 0.03) - q.x * (1.1 + fi * 0.2) + q.y), sin(t * (0.17 + fi * 0.04) + q.y * (1.2 + fi * 0.15) - q.x)) * 0.6;
      c += 1.0 / max(0.08, length(vec2(sin(q.x * 3.1 + t * 0.3), cos(q.y * 2.7 - t * 0.25))) * 6.0);
    }
    c /= 4.0;
    return pow(clamp(c, 0.0, 1.0) * 1.35, 3.0);
  }

  void main() {
    vec2 bxy = vec2(vWorld.x, -vWorld.z);
    vec2 tuv = bxy * uTile;
    vec3 alb = texture2D(tAlbedo, tuv).rgb;
    vec3 tn = texture2D(tNormal, tuv).xyz * 2.0 - 1.0;
    vec3 n = normalize(vec3(tn.x, tn.z, -tn.y) * vec3(0.8, 1.0, 0.8));
    float rough = clamp(texture2D(tRough, tuv).g * 0.85, 0.05, 1.0);
    vec2 luv = (bxy - uBounds.xy) / (uBounds.zw - uBounds.xy);
    vec3 irr = texture2D(tLight, luv).rgb * uLmScale;
    vec3 col = alb * irr;

    // Sunlit patches: caustics and a slow dapple from swaying leaves.
    float lum = dot(irr, vec3(0.2126, 0.7152, 0.0722));
    float sun = smoothstep(uShade * 1.6, uShade * 4.5, lum);
    float dapple = 0.82 + 0.3 * vnoise(bxy * 1.3 + vec2(uTime * 0.11, -uTime * 0.07));
    col *= mix(1.0, dapple, sun);
    col += alb * irr * uCausticColor * caustic(bxy * 2.2, uTime) * sun * uCaustic;

    // Polished tile: rough env reflection with Schlick fresnel.
    vec3 V = normalize(cameraPosition - vWorld);
    float ndv = clamp(dot(n, V), 0.0, 1.0);
    float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, n);
    vec3 env = textureLod(tEnv, equirectUv(R), rough * 7.0).rgb * uEnvGain;
    col = col * (1.0 - F) + env * F * (1.0 - rough * 0.6);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function floorMaterial(opts: {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  rough: THREE.Texture;
  light: THREE.Texture;
  env: THREE.Texture;
  bounds: [number, number, number, number];
  tile: number;
  lmScale: number;
  envGain: number;
  caustic: number;
  causticColor: string;
  shade: number;
}) {
  for (const t of [opts.albedo, opts.normal, opts.rough]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return new THREE.ShaderMaterial({
    vertexShader: floorVertex,
    fragmentShader: floorFragment,
    uniforms: {
      tAlbedo: { value: opts.albedo },
      tNormal: { value: opts.normal },
      tRough: { value: opts.rough },
      tLight: { value: opts.light },
      tEnv: { value: opts.env },
      uBounds: { value: new THREE.Vector4(...opts.bounds) },
      uTile: { value: 1 / opts.tile },
      uLmScale: { value: opts.lmScale },
      uEnvGain: { value: opts.envGain },
      uTime: { value: 0 },
      uCaustic: { value: opts.caustic },
      uCausticColor: { value: new THREE.Color(opts.causticColor) },
      uShade: { value: opts.shade },
    },
  });
}

// --------------------------------------------------------------------------
const glassVertex = /* glsl */ `
  attribute vec3 color;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vTint;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vTint = color;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const glassFragment = /* glsl */ `
  uniform sampler2D tEnv;
  uniform float uEnvGain;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform float uGlint;
  uniform vec3 uGrime;
  uniform float uGrimeAmount;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vTint;
  ${EQUIRECT}
  ${NOISE}

  vec2 voronoi(vec2 x) {
    vec2 n = floor(x); vec2 f = fract(x); float md = 8.0; vec2 mr = vec2(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(hash12(n + g), hash12(n + g + 19.7));
      vec2 r = g + o - f; float d = dot(r, r);
      if (d < md) { md = d; mr = vec2(hash12(n + g + 3.1), 0.0); }
    }
    return vec2(sqrt(md), mr.x);
  }

  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 n = normalize(vNormalW);
    if (dot(n, V) < 0.0) n = -n;
    // Old crown glass is never flat.
    vec3 w = vWorld * 1.3;
    n = normalize(n + (vec3(vnoise3(w), vnoise3(w + 7.1), vnoise3(w + 3.3)) - 0.5) * 0.06);

    // Condensation beads in the pane plane.
    vec3 t = normalize(abs(n.y) < 0.95 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
    vec3 bt = cross(n, t);
    vec2 puv = vec2(dot(vWorld, t), dot(vWorld, bt)) * 55.0;
    vec2 vr = voronoi(puv);
    float wet = smoothstep(0.45, 0.75, fbm3(vWorld * vec3(0.9, 2.2, 0.9)));
    float drop = smoothstep(0.32, 0.18, vr.x) * step(0.45, vr.y) * wet;

    float ndv = clamp(dot(n, V), 0.0, 1.0);
    float F = (0.04 + 0.96 * pow(1.0 - ndv, 5.0)) * 0.6;
    vec3 R = reflect(-V, n);
    vec3 refl = textureLod(tEnv, equirectUv(R), 1.5).rgb * uEnvGain;
    float glint = pow(max(dot(R, uLightDir), 0.0), 900.0) * uGlint;

    // Grime film: forward-scatters the sun when you look toward it.
    float g = smoothstep(0.38, 0.9, fbm3(vWorld * 1.6)) * uGrimeAmount;
    float phase = pow(max(dot(-V, uLightDir), 0.0), 6.0);
    vec3 grime = uGrime * (0.35 + uLightColor * phase * 2.5);

    vec3 rgb = refl * F + grime * g + uLightColor * glint + vec3(drop) * (refl * 0.6 + uLightColor * phase * 0.6);
    float a = clamp(g + drop * 0.35 + F * 0.25, 0.0, 1.0);
    rgb *= vTint;
    gl_FragColor = vec4(rgb, a);
  }
`;

export function glassMaterial(opts: { env: THREE.Texture; envGain: number; lightDir: THREE.Vector3; lightColor: THREE.Color; glint: number; grime: string; grimeAmount: number }) {
  return new THREE.ShaderMaterial({
    vertexShader: glassVertex,
    fragmentShader: glassFragment,
    uniforms: {
      tEnv: { value: opts.env },
      uEnvGain: { value: opts.envGain },
      uLightDir: { value: opts.lightDir },
      uLightColor: { value: opts.lightColor },
      uGlint: { value: opts.glint },
      uGrime: { value: new THREE.Color(opts.grime) },
      uGrimeAmount: { value: opts.grimeAmount },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

// --------------------------------------------------------------------------
const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const skyFragment = /* glsl */ `
  uniform sampler2D tSky;
  uniform float uGain;
  uniform float uHot;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform float uDisc;
  uniform float uHalo;
  varying vec3 vDir;
  ${EQUIRECT}
  void main() {
    vec3 d = normalize(vDir);
    vec3 c = texture2D(tSky, equirectUv(d)).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // Re-expand the highlights the LDR bake clipped.
    c *= uGain * (1.0 + uHot * smoothstep(0.7, 1.0, l));
    float cosA = dot(d, uLightDir);
    c += uLightColor * (smoothstep(0.99985, 0.99995, cosA) * uDisc + pow(max(cosA, 0.0), 250.0) * uHalo + pow(max(cosA, 0.0), 12.0) * uHalo * 0.08);
    gl_FragColor = vec4(c, 1.0);
  }
`;

export function skyMaterial(opts: { sky: THREE.Texture; gain: number; hot: number; lightDir: THREE.Vector3; lightColor: THREE.Color; disc: number; halo: number }) {
  return new THREE.ShaderMaterial({
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    uniforms: {
      tSky: { value: opts.sky },
      uGain: { value: opts.gain },
      uHot: { value: opts.hot },
      uLightDir: { value: opts.lightDir },
      uLightColor: { value: opts.lightColor },
      uDisc: { value: opts.disc },
      uHalo: { value: opts.halo },
    },
    side: THREE.BackSide,
    depthWrite: false,
  });
}

// --------------------------------------------------------------------------
const beamVertex = /* glsl */ `
  attribute vec3 aA;
  attribute vec3 aB;
  attribute float aSeed;
  uniform float uWidth;
  varying vec2 vUv;
  varying float vSeed;
  varying float vLen;
  varying float vFade;
  varying vec3 vView;
  void main() {
    vec3 axis = aB - aA;
    vec3 p = aA + axis * position.y;
    vec3 view = normalize(cameraPosition - p);
    vec3 side = normalize(cross(axis, view));
    float w = uWidth * (0.7 + 0.6 * aSeed) * (1.0 + position.y * 0.35);
    p += side * position.x * w;
    vUv = vec2(position.x, position.y);
    vSeed = aSeed;
    vLen = length(axis);
    vView = view;
    float camDist = length(cameraPosition - p);
    vFade = smoothstep(0.6, 2.5, camDist);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uLightDir;
  uniform float uIntensity;
  uniform float uTime;
  varying vec2 vUv;
  varying float vSeed;
  varying float vLen;
  varying float vFade;
  varying vec3 vView;
  ${NOISE}
  void main() {
    float across = exp(-vUv.x * vUv.x * 3.2);
    float along = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
    float motes = 0.75 + 0.5 * vnoise(vec2(vUv.x * 2.5 + vSeed * 10.0, vUv.y * vLen * 1.4 - uTime * 0.08));
    float streak = 0.7 + 0.3 * vnoise(vec2(vUv.x * 7.0 + vSeed * 3.0, vUv.y * 2.0));
    float phase = 0.3 + 1.2 * pow(max(dot(-vView, uLightDir), 0.0), 3.0);
    float a = across * along * motes * streak * phase * vFade * uIntensity * (0.55 + 0.45 * vSeed);
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`;

export function beamGeometry(beams: { a: [number, number, number]; b: [number, number, number] }[]) {
  const base = new THREE.PlaneGeometry(2, 1, 1, 8);
  base.translate(0, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.getAttribute("position"));
  const a = new Float32Array(beams.length * 3);
  const b = new Float32Array(beams.length * 3);
  const seed = new Float32Array(beams.length);
  beams.forEach((bm, i) => {
    a.set(bm.a, i * 3);
    b.set(bm.b, i * 3);
    seed[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    seed[i] = Math.abs(seed[i]);
  });
  g.setAttribute("aA", new THREE.InstancedBufferAttribute(a, 3));
  g.setAttribute("aB", new THREE.InstancedBufferAttribute(b, 3));
  g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));
  g.instanceCount = beams.length;
  return g;
}

export function beamMaterial(opts: { color: THREE.Color; lightDir: THREE.Vector3; width: number; intensity: number }) {
  return new THREE.ShaderMaterial({
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    uniforms: {
      uColor: { value: opts.color },
      uLightDir: { value: opts.lightDir },
      uWidth: { value: opts.width },
      uIntensity: { value: opts.intensity },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// --------------------------------------------------------------------------
const moteVertex = /* glsl */ `
  attribute vec3 aSeed;
  uniform vec3 uCam;
  uniform float uBox;
  uniform float uTime;
  uniform float uDpr;
  varying float vAlpha;
  varying float vLit;
  ${SUNVIS_GLSL}
  void main() {
    vec3 drift = vec3(sin(uTime * 0.13 + aSeed.x * 6.28), sin(uTime * 0.09 + aSeed.y * 6.28) * 0.6 + uTime * 0.02 * (aSeed.z - 0.3), cos(uTime * 0.11 + aSeed.z * 6.28)) * 0.6;
    vec3 p = position * uBox + drift;
    p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
    // Dust only sparkles where the sun (moon) actually reaches.
    float lit = smoothstep(0.35, 0.95, sunVisibility(p));
    vLit = lit;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    float size = (0.006 + aSeed.x * 0.012) * (1.0 + lit * 0.8);
    gl_PointSize = clamp(size / max(depth, 0.05) * 1100.0, 1.0, 26.0) * uDpr;
    vAlpha = smoothstep(0.15, 0.6, depth) * (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, depth));
    gl_Position = projectionMatrix * mv;
  }
`;

const moteFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uLitColor;
  uniform float uBase;
  varying float vAlpha;
  varying float vLit;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float s = exp(-r * r * 5.0);
    if (s < 0.01) discard;
    vec3 c = mix(uColor * uBase, uLitColor * 3.5, vLit);
    gl_FragColor = vec4(c * s * vAlpha, 1.0);
  }
`;

export function moteMaterial(opts: { color: THREE.Color; litColor: THREE.Color; base: number; vis: ReturnType<typeof sunVisUniforms> }) {
  return new THREE.ShaderMaterial({
    vertexShader: moteVertex,
    fragmentShader: moteFragment,
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uBox: { value: 9 },
      uTime: { value: 0 },
      uDpr: { value: 1 },
      uColor: { value: opts.color },
      uLitColor: { value: opts.litColor },
      uBase: { value: opts.base },
      ...opts.vis,
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// --------------------------------------------------------------------------
/** Wind sway + back-lit translucency on top of MeshStandardMaterial (foliage). */
export interface LeafUniforms {
  uTime: { value: number };
  uWind: { value: number };
  uLightView: { value: THREE.Vector3 };
  uTrans: { value: THREE.Color };
  uTransBase: { value: number };
}

export function makeLeafUniforms(): LeafUniforms {
  return { uTime: { value: 0 }, uWind: { value: 1 }, uLightView: { value: new THREE.Vector3(0, 1, 0) }, uTrans: { value: new THREE.Color(0, 0, 0) }, uTransBase: { value: 0.06 } };
}

/** The sun's direct light, dimmed by the baked visibility grid at each fragment (shadows from the ironwork and plants). */
const SHADOWED_LIGHTS = THREE.ShaderChunk.lights_fragment_begin.replace(
  "getDirectionalLightInfo( directionalLight, directLight );",
  "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= gSunVis;",
);

export function patchLeaf(m: THREE.MeshStandardMaterial, u: LeafUniforms, mode: "sway" | "flutter", vis: ReturnType<typeof sunVisUniforms>) {
  // Offsets are applied in world space after projection: GLB positions are quantized, so local units are not meters.
  const amp = mode === "sway" ? "0.03" : "0.012";
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, vis);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        uniform float uWind;
        varying vec3 vSunPos;
        float leafNoise(vec3 p) { return sin(p.x) * sin(p.y * 1.3 + 1.7) * sin(p.z * 0.9 + 0.4); }`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        {
          vec4 lp0 = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          lp0 = instanceMatrix * lp0;
          #endif
          vec3 wp0 = (modelMatrix * lp0).xyz;
          vec3 q = wp0 * 0.9 + vec3(uTime * 0.35, uTime * 0.21, uTime * 0.27);
          vec3 off = vec3(leafNoise(q), leafNoise(q.yzx + 3.1) * 0.4, leafNoise(q.zxy + 5.7)) * ${amp};
          off += vec3(sin(uTime * 2.3 + dot(wp0, vec3(9.1, 7.3, 8.7)))) * vec3(0.004, 0.002, 0.004);
          mvPosition.xyz += mat3(viewMatrix) * off * uWind;
          vSunPos = wp0 + off * uWind;
          gl_Position = projectionMatrix * mvPosition;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform vec3 uLightView;
        uniform vec3 uTrans;
        uniform float uTransBase;
        varying vec3 vSunPos;
        ${SUNVIS_GLSL}`,
      )
      .replace("#include <lights_fragment_begin>", `float gSunVis = sunVisibility(vSunPos);\n${SHADOWED_LIGHTS}`)
      .replace(
        "#include <opaque_fragment>",
        `{
          // Light through the leaf: strongest looking into the sun, and only where the sun reaches.
          vec3 Vv = normalize(vViewPosition);
          float back = pow(max(dot(-Vv, uLightView), 0.0), 4.0);
          outgoingLight += diffuseColor.rgb * uTrans * (uTransBase + back * 2.2 * gSunVis);
        }
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => `leaf-${mode}`;
}

/** Any standard material: the sun's direct light (here mostly specular glints) respects the visibility grid. */
export function withSunShadow<T extends THREE.MeshStandardMaterial>(m: T, vis: ReturnType<typeof sunVisUniforms>, key: string): T {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, vis);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vSunPos;").replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      {
        vec4 sp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        sp = instanceMatrix * sp;
        #endif
        vSunPos = (modelMatrix * sp).xyz;
      }`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vSunPos;\n${SUNVIS_GLSL}`)
      .replace("#include <lights_fragment_begin>", `float gSunVis = sunVisibility(vSunPos);\n${SHADOWED_LIGHTS}`);
  };
  m.customProgramCacheKey = () => `sunshadow-${key}`;
  return m;
}

// --------------------------------------------------------------------------
const glowVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const glowFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    vec2 q = vUv - 0.5;
    float r = length(q * vec2(1.0, 1.35)) * 2.0;
    float a = exp(-r * r * 3.0) * uOpacity;
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`;

/** Soft additive halo card (panel glow, flame glow). */
export function glowMaterial(color: string, opacity: number) {
  return new THREE.ShaderMaterial({
    vertexShader: glowVertex,
    fragmentShader: glowFragment,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
