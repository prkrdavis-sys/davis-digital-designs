"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { pointer } from "@/lib/store";
import { sceneState } from "@/components/three/sceneState";

const vertex = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vTwinkle;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vTwinkle = 0.55 + 0.45 * sin(uTime * 3.0 + aPhase);
    gl_PointSize = aSize * uPixelRatio * (90.0 / -mv.z) * (0.7 + 0.3 * vTwinkle);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uNight;
  varying float vTwinkle;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.05, d);
    float glow = smoothstep(0.5, 0.0, d) * 0.6;
    float alpha = (core + glow) * vTwinkle * mix(0.35, 1.0, uNight);
    vec3 col = uColor * (1.0 + uNight * 1.6);
    gl_FragColor = vec4(col, alpha);
  }
`;

interface FirefliesProps {
  count: number;
}

/**
 * A swarm of glowing points that drift around the camera. They gently gather
 * toward the pointer and scatter when the mouse is held down. Brighter at night.
 */
export function Fireflies({ count }: FirefliesProps) {
  const points = useRef<THREE.Points>(null);
  const mat = useRef<THREE.ShaderMaterial>(null);

  const { positions, sizes, phases, velocities, homes } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const homes = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 30;
      const y = Math.random() * 9 - 2;
      const z = -Math.random() * 40 + 4;
      positions.set([x, y, z], i * 3);
      homes.set([x, y, z], i * 3);
      sizes[i] = 1.2 + Math.random() * 2.4;
      phases[i] = Math.random() * Math.PI * 2;
    }
    return { positions, sizes, phases, velocities, homes };
  }, [count]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uColor: { value: new THREE.Color("#fff1a8") },
      uNight: { value: 0 },
    }),
    [],
  );

  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    const geo = points.current?.geometry;
    const u = mat.current?.uniforms;
    if (!geo || !u) return;
    const step = Math.min(dt, 0.05);
    u.uTime.value += step;
    u.uPixelRatio.value = state.gl.getPixelRatio();
    u.uNight.value = sceneState.night;
    u.uColor.value.copy(sceneState.particleColors[0]).lerp(new THREE.Color("#fff1a8"), 0.5);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const camZ = state.camera.position.z;
    const target = sceneState.pointerWorld;
    const scatter = pointer.down ? -1 : 1;
    const attract = pointer.active ? 1 : 0;

    for (let i = 0; i < count; i++) {
      const ix = i * 3;
      // Wander around home.
      const t = u.uTime.value + phases[i];
      const hx = homes[ix] + Math.sin(t * 0.6) * 1.4;
      const hy = homes[ix + 1] + Math.cos(t * 0.8) * 0.9;
      const hz = homes[ix + 2] + camZ + Math.sin(t * 0.4) * 1.2;

      let ax = (hx - arr[ix]) * 0.6;
      let ay = (hy - arr[ix + 1]) * 0.6;
      let az = (hz - arr[ix + 2]) * 0.6;

      // Pointer influence, falls off with distance.
      tmp.set(target.x - arr[ix], target.y - arr[ix + 1], target.z - arr[ix + 2]);
      const d = tmp.length();
      if (d < 9 && attract) {
        const f = (1 - d / 9) * 9 * scatter;
        tmp.normalize().multiplyScalar(f);
        ax += tmp.x;
        ay += tmp.y;
        az += tmp.z;
      }

      velocities[ix] = (velocities[ix] + ax * step) * 0.9;
      velocities[ix + 1] = (velocities[ix + 1] + ay * step) * 0.9;
      velocities[ix + 2] = (velocities[ix + 2] + az * step) * 0.9;

      arr[ix] += velocities[ix];
      arr[ix + 1] += velocities[ix + 1];
      arr[ix + 2] += velocities[ix + 2];
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={points} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
        <bufferAttribute attach="attributes-aPhase" args={[phases, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={mat}
        vertexShader={vertex}
        fragmentShader={fragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}
