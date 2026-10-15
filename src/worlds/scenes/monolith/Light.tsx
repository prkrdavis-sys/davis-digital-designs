"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { MonolithLayout } from "@/worlds/scenes/monolith/layout";
import { drive } from "@/worlds/scenes/monolith/drive";

/** The ceiling blade. Its direction is the cursor, within a short swing. */
export function Light({ layout, night }: { layout: MonolithLayout; night: boolean }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const blade = useRef<THREE.Mesh>(null);
  const focus = useMemo(() => new THREE.Vector3(...layout.focus), [layout]);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const rest = useMemo(() => new THREE.Vector3(0.18, 0.86, 0.28).normalize(), []);
  const swing = useMemo(() => new THREE.Quaternion(), []);
  const axis = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const side = useMemo(() => new THREE.Vector3(), []);
  const face = useMemo(() => new THREE.Vector3(), []);
  const mid = useMemo(() => new THREE.Vector3(), []);
  const toCam = useMemo(() => new THREE.Vector3(), []);
  const basis = useMemo(() => new THREE.Matrix4(), []);
  const camera = useThree((s) => s.camera);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uColor: { value: new THREE.Color(night ? "#c9d8ff" : "#f7f4ff") },
          uOpacity: { value: night ? 0.55 : 0.28 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          uniform vec3 uColor;
          uniform float uOpacity;
          void main() {
            float across = pow(1.0 - smoothstep(0.0, 1.0, abs(vUv.x - 0.5) * 2.0), 1.6);
            float along = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.62, 1.0, vUv.y));
            float a = across * along * uOpacity;
            gl_FragColor = vec4(uColor * a, a);
          }
        `,
      }),
    [night],
  );

  useFrame(() => {
    swing.setFromAxisAngle(axis, drive.yaw);
    dir.copy(rest).applyQuaternion(swing);
    const sun = light.current;
    if (sun) {
      sun.position.copy(focus).addScaledVector(dir, 9);
      sun.target.position.copy(focus);
      sun.target.updateMatrixWorld();
    }
    const mesh = blade.current;
    if (!mesh) return;
    mid.copy(focus).addScaledVector(dir, 2.4);
    toCam.copy(camera.position).sub(mid);
    side.crossVectors(dir, toCam);
    if (side.lengthSq() < 1e-8) return;
    side.normalize();
    face.crossVectors(side, dir).normalize();
    basis.makeBasis(side, dir, face);
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.position.copy(mid);
  });

  return (
    <>
      <directionalLight ref={light} intensity={night ? 3.6 : 5.4} color={night ? "#d5e2ff" : "#f4f7ff"} />
      <mesh ref={blade} material={material} renderOrder={4}>
        <planeGeometry args={[1.35, 6.2]} />
      </mesh>
    </>
  );
}
