"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import type { Vec3 } from "@/worlds/scenes/greenhouse/data";
import { glowMaterial } from "@/worlds/scenes/greenhouse/materials";

const bulbVertex = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  varying float vGlow;
  void main() {
    float s = aSeed * 6.2831;
    vGlow = 0.72 + 0.28 * sin(uTime * (0.6 + aSeed * 1.4) + s) * sin(uTime * 0.37 + s * 3.0);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const bulbFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uNight;
  varying float vGlow;
  void main() {
    gl_FragColor = vec4(uColor * mix(1.0, vGlow, uNight), 1.0);
  }
`;

/** Fairy lights strung along the ribs (lit at night, clear glass beads by day) and lantern flames. */
export function NightLights({ bulbs, flames, variant }: { bulbs: Vec3[]; flames: Vec3[]; variant: Variant }) {
  const night = variant === "night";
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    const g = new THREE.SphereGeometry(0.02, 8, 6);
    const seed = new Float32Array(bulbs.length);
    for (let i = 0; i < bulbs.length; i++) seed[i] = (i * 0.61803) % 1;
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));
    return g;
  }, [bulbs]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: bulbVertex,
        fragmentShader: bulbFragment,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: night ? new THREE.Color("#ffb45e").multiplyScalar(14) : new THREE.Color("#e9e2cf").multiplyScalar(0.9) },
          uNight: { value: night ? 1 : 0 },
        },
      }),
    [night],
  );

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new THREE.Object3D();
    bulbs.forEach((p, i) => {
      o.position.set(...p);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [bulbs]);

  const flameMat = useMemo(() => glowMaterial("#ffa24a", 1.6), []);
  const flameRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lights = useRef<(THREE.PointLight | null)[]>([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    mat.uniforms.uTime.value = t;
    flames.forEach((_, i) => {
      const k = 0.85 + 0.1 * Math.sin(t * 11 + i * 3) + 0.07 * Math.sin(t * 23 + i * 7);
      const f = flameRefs.current[i];
      if (f) {
        f.scale.setScalar(k);
        f.quaternion.copy(state.camera.quaternion);
      }
      const l = lights.current[i];
      if (l) l.intensity = 1.6 * k;
    });
  });

  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
      flameMat.dispose();
    },
    [geo, mat, flameMat],
  );

  return (
    <>
      <instancedMesh ref={mesh} args={[geo, mat, bulbs.length]} frustumCulled={false} />
      {night &&
        flames.map((p, i) => (
          <group key={i} position={p}>
            <mesh
              ref={(m) => {
                flameRefs.current[i] = m;
              }}
              material={flameMat}
              renderOrder={40}
            >
              <planeGeometry args={[0.5, 0.6]} />
            </mesh>
            {i < 4 && (
              <pointLight
                ref={(l) => {
                  lights.current[i] = l;
                }}
                color="#ff9c50"
                intensity={1.6}
                distance={4.5}
                decay={2}
              />
            )}
          </group>
        ))}
    </>
  );
}
