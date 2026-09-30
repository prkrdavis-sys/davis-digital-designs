import * as THREE from "three";
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { SUNVIS_GLSL } from "@/worlds/scenes/greenhouse/sunvis";

/**
 * The conservatory's humid air, as a post effect: for every pixel it marches
 * from the camera to the depth buffer through the sun-visibility grid, so the
 * haze glows where sunlight reaches it (light shafts) and scatters forward
 * toward the sun (Henyey-Greenstein), like the Cycles volume it stands in for.
 * Outside the grid (the sky beyond the glass) nothing is added.
 */
const fragment = /* glsl */ `
  ${SUNVIS_GLSL}
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  uniform vec3 uCamPos;
  uniform vec3 uSunDir;
  uniform vec3 uSun;
  uniform vec3 uAmbient;
  uniform float uDensity;
  uniform float uG;
  uniform float uMaxDist;

  float hgPhase(float mu, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (12.5663706 * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    vec4 vp = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    vec3 vdir = normalize(vp.xyz / vp.w);
    float dist = depth >= 0.99999 ? uMaxDist : min(uMaxDist, getViewZ(depth) / vdir.z);
    vec3 rd = normalize(mat3(uCamWorld) * vdir);

    // Clip the march to the grid box (Blender axes: x, -z, y).
    vec3 ro = vec3(uCamPos.x, -uCamPos.z, uCamPos.y);
    vec3 rdb = vec3(rd.x, -rd.z, rd.y);
    vec3 inv = 1.0 / (abs(rdb) + 1e-6) * sign(rdb + 1e-12);
    vec3 ta = (uVisMin - ro) * inv;
    vec3 tb = (uVisMin + uVisSize - ro) * inv;
    vec3 tlo = min(ta, tb);
    vec3 thi = max(ta, tb);
    float t0 = max(max(tlo.x, tlo.y), max(tlo.z, 0.0));
    float t1 = min(min(min(thi.x, thi.y), thi.z), dist);

    vec3 acc = vec3(0.0);
    float T = 1.0;
    if (t1 > t0) {
      float dt = (t1 - t0) / float(HAZE_STEPS);
      // Static interleaved-gradient dither: no temporal filter here, so a moving pattern would shimmer.
      float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float stepT = exp(-uDensity * dt);
      vec3 sun = uSun * hgPhase(dot(rd, uSunDir), uG);
      for (int i = 0; i < HAZE_STEPS; i++) {
        vec3 p = uCamPos + rd * (t0 + (float(i) + jitter) * dt);
        acc += T * (sun * sunVisibility(p) + uAmbient) * (1.0 - stepT);
        T *= stepT;
      }
    }
    outputColor = vec4(inputColor.rgb * T + acc, inputColor.a);
  }
`;

/**
 * The Cycles stills use AgX "Medium High Contrast"; the shared compositor
 * applies plain AgX. This restores the punch in scene-referred space: contrast
 * around middle grey in log2, then saturation around luminance.
 */
const gradeFragment = /* glsl */ `
  uniform float uContrast;
  uniform float uSaturation;
  uniform vec3 uTint;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = max(inputColor.rgb, vec3(1e-6));
    c = 0.18 * exp2((log2(c / 0.18)) * uContrast);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = max(mix(vec3(l), c, uSaturation), 0.0) * uTint;
    outputColor = vec4(c, inputColor.a);
  }
`;

export class GradeEffect extends Effect {
  constructor(o: { contrast: number; saturation: number; tint?: THREE.Color }) {
    const tint = o.tint ?? new THREE.Color(1, 1, 1);
    super("GreenhouseGrade", gradeFragment, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ["uContrast", new THREE.Uniform(o.contrast)],
        ["uSaturation", new THREE.Uniform(o.saturation)],
        ["uTint", new THREE.Uniform(new THREE.Vector3(tint.r, tint.g, tint.b))],
      ]),
    });
  }
}

export interface HazeOptions {
  vis: { tVis: { value: THREE.Data3DTexture }; uVisMin: { value: THREE.Vector3 }; uVisSize: { value: THREE.Vector3 } };
  sunDir: THREE.Vector3;
  /** Sun radiance scale times colour (Cycles units, like the lightmaps). */
  sun: THREE.Color;
  ambient: THREE.Color;
  density: number;
  g: number;
  maxDist?: number;
  steps?: number;
}

export class HazeEffect extends Effect {
  private readonly cam: THREE.PerspectiveCamera;
  private readonly invProj = new THREE.Matrix4();
  private readonly camWorld = new THREE.Matrix4();
  private readonly camPos = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, o: HazeOptions) {
    super("GreenhouseHaze", fragment, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.DEPTH,
      defines: new Map([["HAZE_STEPS", String(o.steps ?? 20)]]),
      uniforms: new Map<string, THREE.Uniform>([
        ["tVis", new THREE.Uniform(o.vis.tVis.value)],
        ["uVisMin", new THREE.Uniform(o.vis.uVisMin.value)],
        ["uVisSize", new THREE.Uniform(o.vis.uVisSize.value)],
        ["uInvProj", new THREE.Uniform(null)],
        ["uCamWorld", new THREE.Uniform(null)],
        ["uCamPos", new THREE.Uniform(null)],
        ["uSunDir", new THREE.Uniform(o.sunDir)],
        ["uSun", new THREE.Uniform(new THREE.Vector3(o.sun.r, o.sun.g, o.sun.b))],
        ["uAmbient", new THREE.Uniform(new THREE.Vector3(o.ambient.r, o.ambient.g, o.ambient.b))],
        ["uDensity", new THREE.Uniform(o.density)],
        ["uG", new THREE.Uniform(o.g)],
        ["uMaxDist", new THREE.Uniform(o.maxDist ?? 40)],
      ]),
    });
    this.cam = camera;
    const u = this.uniforms;
    for (const [k, v] of [
      ["uInvProj", this.invProj],
      ["uCamWorld", this.camWorld],
      ["uCamPos", this.camPos],
    ] as const) {
      const slot = u.get(k);
      if (slot) slot.value = v;
    }
  }

  override update(): void {
    this.invProj.copy(this.cam.projectionMatrixInverse);
    this.camWorld.copy(this.cam.matrixWorld);
    this.camPos.setFromMatrixPosition(this.cam.matrixWorld);
  }
}
