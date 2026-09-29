import * as THREE from "three";

export interface PaperUniforms {
  uSunDirView: { value: THREE.Vector3 };
  uSunCol: { value: THREE.Color };
  uTrans: { value: number };
  uLantern: { value: number };
  uLanternCol: { value: THREE.Color };
}

/**
 * Folded paper: printed sheet (one of four designs per plane via `aPrint`),
 * fiber normal map, crease AO from vertex colors, and light glowing through
 * the sheet when the sun (or a lantern) is behind it.
 */
export function paperMaterial(map: THREE.Texture, normal: THREE.Texture, night: boolean) {
  const uniforms: PaperUniforms = {
    uSunDirView: { value: new THREE.Vector3(0, 0, -1) },
    uSunCol: { value: new THREE.Color() },
    uTrans: { value: night ? 0.35 : 0.6 },
    uLantern: { value: night ? 1 : 0 },
    uLanternCol: { value: new THREE.Color("#ffab55").multiplyScalar(2.4) },
  };
  const m = new THREE.MeshStandardMaterial({
    map,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.8,
    metalness: 0,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aPrint;
attribute vec3 aTint;
varying vec3 vTint;
varying vec3 vLanternView;`,
      )
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = vMapUv * 0.5 + vec2(mod(aPrint, 2.0), floor(aPrint / 2.0)) * 0.5;
#endif
  vTint = aTint;`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
#ifdef USE_INSTANCING
  vLanternView = (modelViewMatrix * instanceMatrix * vec4(0.0, -0.3, -0.04, 1.0)).xyz;
#else
  vLanternView = (modelViewMatrix * vec4(0.0, -0.3, -0.04, 1.0)).xyz;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 uSunDirView;
uniform vec3 uSunCol;
uniform float uTrans;
uniform float uLantern;
uniform vec3 uLanternCol;
varying vec3 vTint;
varying vec3 vLanternView;`,
      )
      .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb *= vTint;")
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
  {
    vec3 L = normalize(uSunDirView);
    vec3 V = normalize(vViewPosition);
    // Light reaching the far side of the sheet shows through it, strongest looking into the light.
    float through = max(dot(-normal, L), 0.0);
    float forward = pow(max(dot(-V, L), 0.0), 6.0);
    vec3 paper = diffuseColor.rgb;
    reflectedLight.directDiffuse += paper * uSunCol * uTrans * through * (0.55 + 2.2 * forward);
    if (uLantern > 0.5) {
      vec3 toL = vLanternView + vViewPosition;
      float d2 = dot(toL, toL);
      vec3 Ld = toL * inversesqrt(max(d2, 1e-6));
      float wrap = abs(dot(normal, Ld)) * 0.65 + 0.35;
      reflectedLight.directDiffuse += paper * uLanternCol * wrap / (1.0 + d2 * 40.0);
    }
  }`,
      );
  };
  m.customProgramCacheKey = () => `ddd-paper-${night ? "n" : "d"}`;
  return { material: m, uniforms };
}
