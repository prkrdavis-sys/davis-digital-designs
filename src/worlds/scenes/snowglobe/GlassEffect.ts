import { Color, Uniform } from "three";
import { BlendFunction, Effect } from "postprocessing";

const fragment = /* glsl */ `
  uniform float strength;
  uniform float time;
  uniform vec3 tint;

  // Crossing the glass: the frame bends like looking through the curved wall,
  // swirls a little, and ripples as if the water inside were moving.
  void mainUv(inout vec2 uv) {
    if (strength <= 0.0005) return;
    vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
    float r = length(c);
    float k = strength;
    float ang = k * 0.9 * (1.0 - smoothstep(0.0, 1.0, r)) * sin(time * 0.7 + r * 3.0);
    float s = sin(ang), co = cos(ang);
    c = mat2(co, -s, s, co) * c;
    c *= 1.0 - k * 0.42 * (1.0 - r * r * 0.8);
    c += k * 0.012 * vec2(sin(c.y * 34.0 + time * 2.6), cos(c.x * 30.0 - time * 2.1));
    uv = c / vec2(aspect, 1.0) + 0.5;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 col = inputColor.rgb;
    if (strength > 0.0005) {
      vec2 d = (uv - 0.5) * strength * 0.03;
      col.r = texture2D(inputBuffer, uv + d).r;
      col.b = texture2D(inputBuffer, uv - d).b;
      vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
      float r = length(c);
      // A bright meniscus ring sweeps outward as the lens passes the eye.
      float ring = exp(-pow((r - mix(0.1, 0.9, strength)) * 9.0, 2.0));
      col += tint * ring * strength * 0.8;
      col = mix(col, col * tint * 1.1 + tint * 0.05, strength * 0.35);
    }
    outputColor = vec4(col, 1.0);
  }
`;

/** Screen-space refraction for the moment the camera passes through the globe wall. */
export class GlassEffect extends Effect {
  constructor() {
    super("GlassEffect", fragment, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ["strength", new Uniform(0)],
        ["time", new Uniform(0)],
        ["tint", new Uniform(new Color("#dff3ff"))],
      ]),
    });
  }

  set strength(v: number) {
    this.uniforms.get("strength")!.value = v;
  }

  set time(v: number) {
    this.uniforms.get("time")!.value = v;
  }

  setTint(hex: string) {
    (this.uniforms.get("tint")!.value as Color).set(hex);
  }
}
