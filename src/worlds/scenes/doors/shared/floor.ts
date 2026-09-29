import * as THREE from "three";

/**
 * Polished stone floor over a mirrored copy of the room.
 *
 * Albedo is procedural (tiles, joints, veins) so it stays crisp at any
 * distance; lighting comes from the Cycles-baked irradiance map. The shader
 * outputs (diffuse * (1 - F), F) with custom blending src + dst * srcAlpha, so
 * the mirrored scene underneath shows through as a Fresnel reflection.
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

const MAX_SPILL = 5;

const fragment = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  uniform sampler2D uLight;
  uniform float uLightScale;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uInlay;
  uniform vec3 uVein;
  uniform float uTile;
  uniform float uJoint;
  uniform int uMode;
  uniform float uReflect;
  uniform float uReflectMax;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec3 uSpillPos[${MAX_SPILL}];
  uniform vec3 uSpillCol[${MAX_SPILL}];
  uniform vec2 uSpillDir[${MAX_SPILL}];
  uniform float uSpillAmt[${MAX_SPILL}];
  uniform float uTime;

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.07 + 1.3; a *= 0.5; } return v; }

  float line(float d, float w) {
    float aa = fwidth(d) * 1.2 + 1e-5;
    return 1.0 - smoothstep(w * 0.5, w * 0.5 + aa, d);
  }

  void main() {
    vec2 q = vWorld.xz;
    vec2 p = q / uTile;
    vec2 cell = floor(p);
    vec2 f = fract(p);
    float checker = mod(cell.x + cell.y, 2.0);
    vec2 e = min(f, 1.0 - f) * uTile;
    float joint = line(min(e.x, e.y), uJoint);
    float band = 0.0;
    if (uMode == 1) {
      // Museum: each slab carries an inlaid diamond of the second marble.
      float d = (abs(f.x - 0.5) + abs(f.y - 0.5)) * uTile;
      float r = uTile * 0.32;
      checker = step(d, r);
      band = line(abs(d - r), uJoint * 1.4);
    }
    // Veins: warped sine bands, different per slab so tiles do not repeat.
    vec2 w = q * 0.42 + cell * 1.7;
    float n = fbm(w * 1.1);
    float n2 = fbm(w * 2.6 + 7.0);
    float v1 = pow(1.0 - abs(sin((w.x * 0.8 + w.y * 0.45) * 2.4 + n * 7.0)), 14.0);
    float v2 = pow(1.0 - abs(sin((w.x * -0.3 + w.y * 0.9) * 4.1 + n2 * 9.0)), 38.0);
    float cloud = fbm(w * 0.7 + 3.0);
    vec3 base = mix(uA, uB, checker);
    base *= 0.94 + 0.12 * cloud;
    base = mix(base, uVein, clamp(v1 * 0.55 + v2 * 0.4, 0.0, 1.0));
    float inlay = max(joint, band);
    base = mix(base, uInlay, inlay);

    vec3 light = texture2D(uLight, vUv).rgb * uLightScale;
    vec3 col = base * light;

    for (int i = 0; i < ${MAX_SPILL}; i++) {
      vec2 d = q - uSpillPos[i].xz;
      vec2 dir = uSpillDir[i];
      float along = dot(d, dir);
      float side = dot(d, vec2(-dir.y, dir.x));
      float g = exp(-(along * along) / 5.0 - (side * side) / 1.6);
      col += uSpillCol[i] * base * g * uSpillAmt[i];
    }

    vec3 V = normalize(cameraPosition - vWorld);
    float c = clamp(V.y, 0.0, 1.0);
    float F = uReflect + (uReflectMax - uReflect) * pow(1.0 - c, 5.0);
    F *= 1.0 - inlay * 0.5;
    F *= 0.9 + 0.2 * n2;
    col *= 1.0 - F;

    float dist = length(vWorld - cameraPosition);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogColor * (1.0 - F), fog);
    gl_FragColor = vec4(col, F * (1.0 - fog));
  }
`;

export interface FloorOptions {
  light: THREE.Texture | null;
  a: string;
  b: string;
  inlay: string;
  vein: string;
  tile: number;
  joint: number;
  mode?: 0 | 1;
  reflect?: number;
  reflectMax?: number;
  lightScale?: number;
}

export function floorMaterial(o: FloorOptions) {
  const blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  blank.needsUpdate = true;
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uLight: { value: o.light ?? blank },
      uLightScale: { value: o.lightScale ?? 2 },
      uA: { value: new THREE.Color(o.a) },
      uB: { value: new THREE.Color(o.b) },
      uInlay: { value: new THREE.Color(o.inlay) },
      uVein: { value: new THREE.Color(o.vein) },
      uTile: { value: o.tile },
      uJoint: { value: o.joint },
      uMode: { value: o.mode ?? 0 },
      uReflect: { value: o.reflect ?? 0.1 },
      uReflectMax: { value: o.reflectMax ?? 0.85 },
      uFogColor: { value: new THREE.Color() },
      uFogDensity: { value: 0 },
      uSpillPos: { value: Array.from({ length: MAX_SPILL }, () => new THREE.Vector3()) },
      uSpillCol: { value: Array.from({ length: MAX_SPILL }, () => new THREE.Color(0, 0, 0)) },
      uSpillDir: { value: Array.from({ length: MAX_SPILL }, () => new THREE.Vector2(0, 1)) },
      uSpillAmt: { value: new Array(MAX_SPILL).fill(0) },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.SrcAlphaFactor,
  });
}

/** Copy the scene's FogExp2 into the floor shader. */
export function syncFog(m: THREE.ShaderMaterial, fog: THREE.Fog | THREE.FogExp2 | null) {
  if (fog && (fog as THREE.FogExp2).isFogExp2) {
    m.uniforms.uFogColor.value.copy(fog.color);
    m.uniforms.uFogDensity.value = (fog as THREE.FogExp2).density;
  } else {
    m.uniforms.uFogDensity.value = 0;
  }
}
