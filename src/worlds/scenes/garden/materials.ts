import * as THREE from "three";

/**
 * Per-object deformation uniforms. `lean` is a spring offset (world units)
 * applied with height so tall pieces sway from their base; `jelly` drives a
 * travelling surface wobble; `rim` is the night neon fresnel.
 */
export interface Wobble {
  lean: { value: THREE.Vector3 };
  jelly: { value: number };
  time: { value: number };
  base: { value: number };
  height: { value: number };
  seed: { value: number };
  rim: { value: THREE.Color };
  rimStrength: { value: number };
}

export function makeWobble(seed: number): Wobble {
  return {
    lean: { value: new THREE.Vector3() },
    jelly: { value: 0 },
    time: { value: 0 },
    base: { value: -1 },
    height: { value: 2 },
    seed: { value: seed },
    rim: { value: new THREE.Color(0, 0, 0) },
    rimStrength: { value: 0 },
  };
}

const VERT_HEAD = /* glsl */ `
  uniform vec3 uLean;
  uniform float uJelly;
  uniform float uWTime;
  uniform float uBase;
  uniform float uHeight;
  uniform float uSeed;
`;

const VERT_BODY = /* glsl */ `
  {
    float hh = clamp((position.y - uBase) / max(uHeight, 1e-3), 0.0, 1.0);
    transformed += uLean * hh * hh;
    float ph = uWTime * 7.0 + uSeed * 6.28;
    float wave = sin(position.y * 2.6 + ph) * 0.6 + sin(position.x * 3.1 - ph * 0.8 + position.z * 2.3) * 0.4;
    transformed += objectNormal * wave * uJelly * (0.25 + 0.75 * hh);
  }
`;

const FRAG_HEAD = /* glsl */ `
  uniform vec3 uRim;
  uniform float uRimStrength;
`;

const FRAG_BODY = /* glsl */ `
  {
    float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
    totalEmissiveRadiance += uRim * pow(1.0 - facing, 3.0) * uRimStrength;
  }
`;

/** Wire the wobble + rim uniforms into a built-in material's shaders. */
export function withWobble<T extends THREE.Material>(m: T, w: Wobble): T {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uLean: w.lean,
      uJelly: w.jelly,
      uWTime: w.time,
      uBase: w.base,
      uHeight: w.height,
      uSeed: w.seed,
      uRim: w.rim,
      uRimStrength: w.rimStrength,
    });
    shader.vertexShader = VERT_HEAD + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + VERT_BODY);
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + FRAG_BODY);
  };
  // One program for every wobbling material of the same type.
  m.customProgramCacheKey = () => `garden-wobble-${m.type}`;
  return m;
}

export function vinylMaterial(color: string, night: boolean) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: 0.3,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    sheen: 0.25,
    sheenRoughness: 0.35,
    sheenColor: new THREE.Color("#ffffff"),
    specularIntensity: 0.6,
    envMapIntensity: night ? 0.55 : 1.15,
  });
}

export function chromeMaterial(night: boolean) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(night ? "#d9d9f2" : "#f7f6fb"),
    metalness: 1,
    roughness: 0.045,
    envMapIntensity: night ? 0.9 : 1.25,
  });
}

export function glassMaterial(tint: string, night: boolean) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tint),
    metalness: 0,
    roughness: night ? 0.18 : 0.2,
    transmission: 1,
    thickness: 0.35,
    ior: 1.45,
    attenuationColor: new THREE.Color(night ? "#b8a6ff" : "#f1dcff"),
    attenuationDistance: 1.6,
    specularIntensity: 1,
    envMapIntensity: night ? 0.6 : 1.1,
  });
}
