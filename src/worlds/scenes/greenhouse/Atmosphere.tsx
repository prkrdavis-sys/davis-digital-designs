"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import type { Beam } from "@/worlds/scenes/greenhouse/data";
import { beamGeometry, beamMaterial, MAX_BEAMS, moteMaterial, type Atmos } from "@/worlds/scenes/greenhouse/materials";

const LOOK: Record<Variant, { beam: number; beamWidth: number; mote: string; moteLit: string; moteBase: number; count: number }> = {
  day: { beam: 0.16, beamWidth: 0.42, mote: "#fff4de", moteLit: "#ffd9a0", moteBase: 0.1, count: 2600 },
  night: { beam: 0.07, beamWidth: 0.5, mote: "#aebfff", moteLit: "#c9d6ff", moteBase: 0.05, count: 1400 },
};

/** Scene fog, sun (or moon) shafts traced through the glazing, and drifting dust and pollen. */
export function Atmosphere({ variant, atmos, beams, lightDir, lightColor }: { variant: Variant; atmos: Atmos; beams: Beam[]; lightDir: THREE.Vector3; lightColor: THREE.Color }) {
  const look = LOOK[variant];
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const fog = new THREE.FogExp2(atmos.fogColor, atmos.fogDensity);
    scene.fog = fog;
    return () => {
      scene.fog = null;
    };
  }, [scene, atmos]);

  const beamGeo = useMemo(() => beamGeometry(beams), [beams]);
  const beamMat = useMemo(() => beamMaterial({ color: lightColor.clone().multiplyScalar(variant === "day" ? 1 : 0.8), lightDir, width: look.beamWidth, intensity: look.beam }), [lightColor, lightDir, look, variant]);

  const moteGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(look.count * 3);
    const seed = new Float32Array(look.count * 3);
    for (let i = 0; i < look.count; i++) {
      pos.set([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5], i * 3);
      seed.set([Math.random(), Math.random(), Math.random()], i * 3);
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    return g;
  }, [look.count]);
  const moteMat = useMemo(() => {
    const m = moteMaterial({ color: new THREE.Color(look.mote), litColor: new THREE.Color(look.moteLit), base: look.moteBase, beamWidth: look.beamWidth * 0.8 });
    const n = Math.min(MAX_BEAMS, beams.length);
    const A = m.uniforms.uA.value as THREE.Vector3[];
    const B = m.uniforms.uB.value as THREE.Vector3[];
    for (let i = 0; i < n; i++) {
      A[i].set(...beams[i].a);
      B[i].set(...beams[i].b);
    }
    m.uniforms.uBeams.value = n;
    return m;
  }, [beams, look]);

  useEffect(
    () => () => {
      beamGeo.dispose();
      beamMat.dispose();
      moteGeo.dispose();
      moteMat.dispose();
    },
    [beamGeo, beamMat, moteGeo, moteMat],
  );

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    beamMat.uniforms.uTime.value += d;
    moteMat.uniforms.uTime.value += d;
    (moteMat.uniforms.uCam.value as THREE.Vector3).copy(state.camera.position);
    moteMat.uniforms.uDpr.value = state.gl.getPixelRatio();
  });

  return (
    <>
      <mesh geometry={beamGeo} material={beamMat} frustumCulled={false} renderOrder={30} />
      <points geometry={moteGeo} material={moteMat} frustumCulled={false} renderOrder={31} />
    </>
  );
}
