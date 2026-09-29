import * as THREE from "three";

/** Per-bubble deformation + glow uniforms (shared objects, so the CPU can write them every frame). */
export interface Squish {
  /** Local-space unit direction (xyz) and amount (w): squash along it, bulge across it. */
  squash: { value: THREE.Vector4 };
  jelly: { value: number };
  time: { value: number };
  seed: { value: number };
  glow: { value: THREE.Color };
  inner: { value: number };
  rim: { value: number };
}

export function makeSquish(seed: number): Squish {
  return {
    squash: { value: new THREE.Vector4(0, 1, 0, 0) },
    jelly: { value: 0 },
    time: { value: 0 },
    seed: { value: seed },
    glow: { value: new THREE.Color(0, 0, 0) },
    inner: { value: 0 },
    rim: { value: 0 },
  };
}

const VERT_HEAD = /* glsl */ `
  uniform vec4 uSquash;
  uniform float uJelly;
  uniform float uSTime;
  uniform float uSeed;
`;

const VERT_BODY = /* glsl */ `
  {
    vec3 sd = uSquash.xyz;
    float along = dot(transformed, sd);
    transformed += sd * along * (-uSquash.w) + (transformed - sd * along) * (uSquash.w * 0.45);
    float ph = uSTime * 6.0 + uSeed * 6.28;
    float wave = sin(position.x * 2.4 + ph) * 0.55 + sin(position.y * 2.9 - ph * 0.7) * 0.45;
    transformed += objectNormal * wave * uJelly;
  }
`;

const FRAG_HEAD = /* glsl */ `
  uniform vec3 uGlow;
  uniform float uInner;
  uniform float uRimGlow;
`;

const FRAG_BODY = /* glsl */ `
  {
    float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
    totalEmissiveRadiance += uGlow * (pow(facing, 1.4) * uInner + pow(1.0 - facing, 3.0) * uRimGlow);
  }
`;

export function withSquish<T extends THREE.Material>(m: T, u: Squish): T {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uSquash: u.squash, uJelly: u.jelly, uSTime: u.time, uSeed: u.seed, uGlow: u.glow, uInner: u.inner, uRimGlow: u.rim });
    shader.vertexShader = VERT_HEAD + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + VERT_BODY);
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + FRAG_BODY);
  };
  m.customProgramCacheKey = () => `bubbles-squish-${m.type}`;
  return m;
}

export function bubbleVinyl(color: string, night: boolean, glyph = false) {
  if (color === "chrome") {
    return new THREE.MeshPhysicalMaterial({ color: "#f7f6fb", metalness: 1, roughness: 0.05, envMapIntensity: night ? 0.9 : 1.25 });
  }
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: glyph ? 0.2 : 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    sheen: 0.3,
    sheenRoughness: 0.35,
    sheenColor: new THREE.Color("#ffffff"),
    specularIntensity: 0.6,
    envMapIntensity: night ? 0.5 : 1.15,
  });
}
