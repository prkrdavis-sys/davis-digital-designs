import * as THREE from "three";

/**
 * Shared sky + haze. The sky map is the art-directed equirect from
 * art/worlds/dunes/sky.py, Reinhard-encoded: x = pow(tex, 2.2), radiance = x / (1 - x).
 * Every material in the world fogs toward the sky's own horizon color, so
 * distant dunes melt into exactly the sky behind them.
 */
export const ATMOSPHERE_GLSL = /* glsl */ `
  uniform sampler2D uSky;
  uniform float uSkyStrength;
  uniform vec3 uHazeTint;
  uniform float uFogDensity;
  uniform float uFogHeight;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;

  vec3 dunesSkyDecode(vec3 e) { vec3 x = pow(clamp(e, 0.0, 0.995), vec3(2.2)); return x / (1.0 - x); }
  vec2 dunesSkyUv(vec3 d) {
    vec3 b = vec3(d.x, -d.z, d.y);
    return vec2(atan(b.y, -b.x) * 0.15915494 + 0.5, atan(b.z, length(b.xy)) * 0.31830989 + 0.5);
  }
  vec3 dunesSky(vec3 d) { return dunesSkyDecode(texture2D(uSky, dunesSkyUv(d)).rgb) * uSkyStrength; }
  vec3 dunesHaze(vec3 d) { return dunesSky(normalize(vec3(d.x, 0.035, d.z))) * uHazeTint; }
  float dunesFogAmount(vec3 wp) {
    vec3 rd = wp - cameraPosition;
    float dist = length(rd);
    float b = 1.0 / uFogHeight;
    float dy = rd.y * b;
    float falloff = abs(dy) > 1e-3 ? (1.0 - exp(-dy)) / dy : 1.0;
    float fog = uFogDensity * exp(-max(cameraPosition.y, -20.0) * b) * dist * falloff;
    return 1.0 - exp(-max(fog, 0.0));
  }
  vec3 dunesFog(vec3 col, vec3 wp) {
    return mix(col, dunesHaze(normalize(wp - cameraPosition)), dunesFogAmount(wp));
  }
`;

export type AtmosphereUniforms = {
  uSky: THREE.IUniform<THREE.Texture | null>;
  uSkyStrength: THREE.IUniform<number>;
  uHazeTint: THREE.IUniform<THREE.Vector3>;
  uFogDensity: THREE.IUniform<number>;
  uFogHeight: THREE.IUniform<number>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
};

/** Built-in materials: fog in world space with the shared uniforms. */
export function withAtmosphere<T extends THREE.Material>(material: T, uniforms: AtmosphereUniforms, key: string): T {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vDunesWorld;")
      .replace("#include <project_vertex>", "#include <project_vertex>\n  vDunesWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vDunesWorld;\n${ATMOSPHERE_GLSL}`)
      .replace("#include <fog_fragment>", "gl_FragColor.rgb = dunesFog(gl_FragColor.rgb, vDunesWorld);");
  };
  material.customProgramCacheKey = () => `dunes-atmo-${key}`;
  return material;
}
