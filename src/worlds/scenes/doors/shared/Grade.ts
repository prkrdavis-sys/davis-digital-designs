import { Color, Uniform } from "three";
import { Effect } from "postprocessing";

const fragment = /* glsl */ `
  uniform float contrast;
  uniform float pivot;
  uniform float saturation;
  uniform vec3 lift;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    // A power curve in scene-linear is a straight contrast in log2, which is where AgX works,
    // so this matches Blender's AgX "High Contrast" looks without touching the compositor.
    vec3 c = max(inputColor.rgb, vec3(1e-6));
    c = pivot * pow(c / pivot, vec3(contrast));
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = max(mix(vec3(l), c, saturation) + lift * l, vec3(0.0));
    outputColor = vec4(c, inputColor.a);
  }
`;

export interface GradeOptions {
  /** Log-space contrast around `pivot` (1 = unchanged). */
  contrast?: number;
  /** Scene-linear value that stays fixed (0.18 = middle grey). */
  pivot?: number;
  saturation?: number;
  /** Colour pushed into the image in proportion to luminance (warm/cool cast). */
  lift?: string;
}

/** HDR grade applied before the compositor's tone mapping. */
export class GradeEffect extends Effect {
  constructor({ contrast = 1.25, pivot = 0.18, saturation = 1.08, lift = "#000000" }: GradeOptions = {}) {
    super("GradeEffect", fragment, {
      uniforms: new Map<string, Uniform>([
        ["contrast", new Uniform(contrast)],
        ["pivot", new Uniform(pivot)],
        ["saturation", new Uniform(saturation)],
        ["lift", new Uniform(new Color(lift))],
      ]),
    });
  }
}
