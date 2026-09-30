import * as THREE from "three";
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";

const fragment = /* glsl */ `
  uniform vec2 uSun;
  uniform float uStrength;
  uniform float uDecay;
  uniform float uDensity;
  uniform float uThreshold;
  uniform vec3 uTint;
  uniform float uAspect;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 delta = (uv - uSun) * uDensity / float(STEPS);
    // Jitter the start per pixel so the steps never band.
    float j = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
    vec2 p = uv - delta * j;
    float w = 1.0;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < STEPS; i++) {
      p -= delta;
      vec3 c = texture2D(inputBuffer, clamp(p, 0.0, 1.0)).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      acc += c * (max(l - uThreshold, 0.0) / max(l, 1e-4)) * w;
      w *= uDecay;
    }
    vec2 q = (uv - uSun) * vec2(uAspect, 1.0);
    float falloff = 1.0 / (1.0 + dot(q, q) * 1.5);
    outputColor = vec4(inputColor.rgb + acc * uTint * (uStrength * falloff / float(STEPS)), 1.0);
  }
`;

/**
 * Screen-space crepuscular rays: march from each pixel toward the light's
 * screen position and gather the bright sky, so shafts pour through the gaps
 * between clouds and planes.
 */
export class GodRaysEffect extends Effect {
  constructor({ strength = 0.5, decay = 0.965, density = 0.85, threshold = 0.9, tint = new THREE.Color(1, 1, 1), steps = 40 } = {}) {
    super("PlanesGodRays", fragment, {
      // SRC: the HDR buffer's alpha is 0, and NORMAL would blend the sky away.
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.CONVOLUTION,
      defines: new Map([["STEPS", String(steps)]]),
      uniforms: new Map<string, THREE.Uniform>([
        ["uSun", new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ["uStrength", new THREE.Uniform(strength)],
        ["uDecay", new THREE.Uniform(decay)],
        ["uDensity", new THREE.Uniform(density)],
        ["uThreshold", new THREE.Uniform(threshold)],
        ["uTint", new THREE.Uniform(tint)],
        ["uAspect", new THREE.Uniform(1)],
      ]),
    });
  }

  get strength() {
    return this.uniforms.get("uStrength")!.value as number;
  }

  /** Place the light on screen; fades the rays when it leaves the frame or goes behind us. */
  update(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget) {
    this.uniforms.get("uAspect")!.value = inputBuffer.width / Math.max(1, inputBuffer.height);
  }
}

const ndc = new THREE.Vector3();
const fwd = new THREE.Vector3();

/** Returns 0..1 visibility of the light for ray strength, and writes its screen UV. */
export function placeLight(effect: GodRaysEffect, camera: THREE.Camera, dir: THREE.Vector3, base: number) {
  camera.getWorldDirection(fwd);
  const facing = fwd.dot(dir);
  ndc.copy(camera.position).addScaledVector(dir, 1000).project(camera);
  const sun = effect.uniforms.get("uSun")!.value as THREE.Vector2;
  sun.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
  const off = Math.max(Math.abs(ndc.x), Math.abs(ndc.y));
  const vis = facing <= 0 ? 0 : THREE.MathUtils.smoothstep(facing, 0.05, 0.4) * (1 - THREE.MathUtils.smoothstep(off, 1.2, 2.2));
  effect.uniforms.get("uStrength")!.value = base * vis;
  return vis;
}
