import * as THREE from "three";
import { Effect, EffectAttribute } from "postprocessing";

const fragment = /* glsl */ `
  uniform float uStrength;
  uniform float uHorizon;
  uniform float uTime;

  float shimmerHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float shimmerNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(shimmerHash(i), shimmerHash(i + vec2(1, 0)), f.x), mix(shimmerHash(i + vec2(0, 1)), shimmerHash(i + vec2(1, 1)), f.x), f.y);
  }

  // Hot air over the sand: a thin band of wobble hugging the horizon, only on
  // distant dunes and the sky right above them, rising slowly.
  void mainUv(inout vec2 uv) {
    if (uStrength <= 0.0005) return;
    float band = exp(-abs(uv.y - uHorizon) * 22.0);
    if (band < 0.01) return;
    float dist = -getViewZ(readDepth(uv));
    float far = smoothstep(120.0, 900.0, dist);
    float m = uStrength * band * far;
    vec2 q = vec2(uv.x * aspect * 55.0, uv.y * 140.0 - uTime * 2.2);
    vec2 w = vec2(shimmerNoise(q) - 0.5, shimmerNoise(q * 1.9 + 7.3) - 0.5);
    w += 0.5 * vec2(shimmerNoise(q * 3.7 + 1.1) - 0.5, shimmerNoise(q * 4.1 - 2.9) - 0.5);
    uv += w * m * vec2(0.0012, 0.0028);
  }
`;

/** Screen-space heat haze near the horizon (depth-masked so the foreground stays crisp). */
export class HeatShimmerEffect extends Effect {
  constructor(strength = 1) {
    super("DunesHeatShimmer", fragment, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ["uStrength", new THREE.Uniform(strength)],
        ["uHorizon", new THREE.Uniform(0.5)],
        ["uTime", new THREE.Uniform(0)],
      ]),
    });
  }

  set strength(v: number) {
    this.uniforms.get("uStrength")!.value = v;
  }

  set time(v: number) {
    this.uniforms.get("uTime")!.value = v;
  }

  private static readonly tmp = new THREE.Vector3();
  private static readonly fwd = new THREE.Vector3();

  /** Screen height of the eye-level horizon straight ahead; off screen when looking steeply up or down. */
  track(camera: THREE.PerspectiveCamera) {
    const { tmp, fwd } = HeatShimmerEffect;
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    tmp.copy(camera.position).addScaledVector(fwd, 20000).project(camera);
    this.uniforms.get("uHorizon")!.value = tmp.z < 1 ? tmp.y * 0.5 + 0.5 : -10;
  }
}
