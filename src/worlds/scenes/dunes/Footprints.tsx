"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { heightAt, lightDir, type DunesData } from "@/worlds/scenes/dunes/data";

const vertex = /* glsl */ `
  attribute float aSide;
  varying vec2 vUv;
  varying float vSide;
  varying vec3 vSunLocal;
  varying float vFade;
  uniform vec3 uSunDir;
  void main() {
    vUv = uv;
    vSide = aSide;
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    // Sun in the print's own frame (x across, y toward the toes = local -Z, z up = local +Y).
    mat3 m = mat3(modelMatrix * instanceMatrix);
    vec3 ax = normalize(m[0]);
    vec3 ay = -normalize(m[2]);
    vec3 az = normalize(m[1]);
    vSunLocal = vec3(dot(uSunDir, ax), dot(uSunDir, ay), dot(uSunDir, az));
    // Ride just above the sand so the decimated mesh never swallows a print.
    vec3 toCam = cameraPosition - w.xyz;
    float d = length(toCam);
    w.xyz += toCam / d * min(0.35, 0.03 + d * 0.004);
    vFade = 1.0 - smoothstep(60.0, 160.0, d);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  varying vec2 vUv;
  varying float vSide;
  varying vec3 vSunLocal;
  varying float vFade;
  uniform float uStrength;

  // A bare foot pressed into soft sand: heel + ball + toe smudge, as a depth field.
  float foot(vec2 p) {
    p.x *= vSide;
    float heel = exp(-dot((p - vec2(0.0, -0.26)) / vec2(0.2, 0.2), (p - vec2(0.0, -0.26)) / vec2(0.2, 0.2)) * 3.0);
    float arch = exp(-dot((p - vec2(0.05, 0.0)) / vec2(0.14, 0.3), (p - vec2(0.05, 0.0)) / vec2(0.14, 0.3)) * 3.0) * 0.7;
    float ball = exp(-dot((p - vec2(0.02, 0.24)) / vec2(0.25, 0.17), (p - vec2(0.02, 0.24)) / vec2(0.25, 0.17)) * 3.0);
    float toes = exp(-dot((p - vec2(-0.02, 0.43)) / vec2(0.24, 0.08), (p - vec2(-0.02, 0.43)) / vec2(0.24, 0.08)) * 3.0) * 0.8;
    float pit = max(max(heel, ball), max(arch, toes));
    // Displaced sand heaped in a soft rim around the print.
    float rim = exp(-dot(p / vec2(0.42, 0.72), p / vec2(0.42, 0.72)) * 2.2) * 0.35;
    return -pit + rim;
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float e = 0.02;
    float h = foot(p);
    vec2 g = vec2(foot(p + vec2(e, 0.0)) - foot(p - vec2(e, 0.0)), foot(p + vec2(0.0, e)) - foot(p - vec2(0.0, e))) / (2.0 * e);
    vec3 n = normalize(vec3(-g * 0.22, 1.0));
    float flat_ = max(vSunLocal.z, 0.05);
    float lit = max(dot(n, vSunLocal), 0.0) / flat_;
    float shade = mix(1.0, lit, 0.85) * (1.0 + h * 0.08);
    float edge = smoothstep(1.0, 0.8, max(abs(p.x), abs(p.y)));
    float v = mix(1.0, clamp(shade, 0.25, 1.8), edge * vFade * uStrength);
    // 2x multiply blend: 0.5 leaves the sand untouched.
    gl_FragColor = vec4(vec3(0.5 * v), 1.0);
  }
`;

/** A walker's trail across the row of slabs, pressed into the baked sand. */
export function Footprints({ data, variant }: { data: DunesData; variant: Variant }) {
  const prints = data.meta.footprints;
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(0.34, 0.62);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uSunDir: { value: lightDir(data) },
          uStrength: { value: variant === "night" ? 0.6 : 1.0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.DstColorFactor,
        blendDst: THREE.SrcColorFactor,
      }),
    [data, variant],
  );

  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, prints.length);
    const side = new Float32Array(prints.length);
    const o = new THREE.Object3D();
    const up = new THREE.Vector3();
    for (let i = 0; i < prints.length; i++) {
      const f = prints[i];
      const x = f.p[0];
      const z = -f.p[1];
      // Tilt with the slope from the height field.
      const e = 1.5;
      const dx = (heightAt(data, x + e, z) - heightAt(data, x - e, z)) / (2 * e);
      const dz = (heightAt(data, x, z + e) - heightAt(data, x, z - e)) / (2 * e);
      up.set(-dx, 1, -dz).normalize();
      o.position.set(x, f.p[2], z);
      o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      // Toes point along local -Z; Blender yaw is CCW from +X toward +Y.
      o.rotateY(THREE.MathUtils.degToRad(f.yaw) - Math.PI / 2);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      side[i] = f.side ? -1 : 1;
    }
    m.geometry.setAttribute("aSide", new THREE.InstancedBufferAttribute(side, 1));
    m.instanceMatrix.needsUpdate = true;
    m.frustumCulled = false;
    m.renderOrder = 2;
    return m;
  }, [geometry, material, prints, data]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
    [geometry, material, mesh],
  );

  return <primitive object={mesh} />;
}
