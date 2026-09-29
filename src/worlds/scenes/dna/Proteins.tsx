"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { useSceneTime } from "@/components/three/engine/slot";
import { firstMeshGeometry, useWorldGLTF } from "@/components/three/engine/assets";
import { axisPoint, forkOffset, sampleTrack, type DnaData } from "@/worlds/scenes/dna/model";
import { proteinMaterial } from "@/worlds/scenes/dna/materials";

type Key = "histone" | "pcna" | "helicase" | "polymerase" | "groel" | "chromosome";

/** Proteins are single meshes by construction; bake the node transform (quantized GLBs). */
function useGeometry(key: Key): THREE.BufferGeometry {
  const gltf = useWorldGLTF("dna", `${key}.glb`);
  return useMemo(() => firstMeshGeometry(gltf), [gltf]);
}

/** Rotation taking the geometry's thinnest bounding-box axis onto `axis`. */
function alignThinAxis(g: THREE.BufferGeometry, axis: THREE.Vector3): THREE.Quaternion {
  g.computeBoundingBox();
  const size = new THREE.Vector3();
  g.boundingBox!.getSize(size);
  const thin = size.x <= size.y && size.x <= size.z ? new THREE.Vector3(1, 0, 0) : size.y <= size.z ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  return new THREE.Quaternion().setFromUnitVectors(thin, axis.clone().normalize());
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * The machinery: histone octamers the DNA wraps around, the replication
 * helicase riding the fork, the PCNA sliding clamp and polymerase copying the
 * separated strand, and GroEL chaperones drifting through the haze.
 */
export function Proteins({ data, variant, fog }: { data: DnaData; variant: Variant; fog: string }) {
  const { meta } = data;
  const time = useSceneTime();
  const histone = useGeometry("histone");
  const pcna = useGeometry("pcna");
  const helicase = useGeometry("helicase");
  const polymerase = useGeometry("polymerase");
  const groel = useGeometry("groel");

  const mats = useMemo(
    () => ({
      histone: proteinMaterial(variant, "histone", fog),
      pcna: proteinMaterial(variant, "pcna", fog),
      helicase: proteinMaterial(variant, "helicase", fog),
      polymerase: proteinMaterial(variant, "polymerase", fog),
      groel: proteinMaterial(variant, "groel", fog),
    }),
    [variant, fog],
  );

  const histoneAlign = useMemo(() => meta.nucleosomes.map((n) => alignThinAxis(histone, new THREE.Vector3(...n.axis))), [histone, meta]);
  const ringAlign = useMemo(() => ({ pcna: alignThinAxis(pcna, new THREE.Vector3(0, 1, 0)), helicase: alignThinAxis(helicase, new THREE.Vector3(0, 1, 0)) }), [pcna, helicase]);

  const refs = {
    histones: useRef<(THREE.Mesh | null)[]>([]),
    helicases: useRef<(THREE.Mesh | null)[]>([]),
    pcna: useRef<THREE.Mesh>(null),
    polymerase: useRef<THREE.Mesh>(null),
    groel: useRef<(THREE.Mesh | null)[]>([]),
  };
  const spin = useRef(0);

  useFrame((state, dt) => {
    const s = time.s;
    const d = Math.min(dt, 0.05);
    spin.current += d;
    const fork = sampleTrack(meta, "fork", s);
    const wrap = sampleTrack(meta, "wrap", s);
    const fade = sampleTrack(meta, "helix", s);
    const cam = state.camera as THREE.PerspectiveCamera;
    const density = 0.16 / Math.max(3, Math.hypot(cam.position.x, cam.position.z) * 2.2);
    for (const m of Object.values(mats)) {
      const u = (m as THREE.ShaderMaterial).uniforms;
      if (u?.uFogDensity) u.uFogDensity.value = density;
    }

    // A helicase ring at each fork of the replication bubble, threading one strand.
    const bubble = meta.fork.bubble;
    const on = smooth(Math.min(1, fork / 30)) * fade;
    [
      { i: fork + 5, strand: 0 as const, dir: 1 },
      { i: fork + bubble - 5, strand: 1 as const, dir: -1 },
    ].forEach((f, k) => {
      const h = refs.helicases.current[k];
      if (!h) return;
      const [ax, ay, az] = axisPoint(meta, f.i);
      const [ox, , oz] = forkOffset(meta, f.i, f.strand, fork);
      h.position.set(ax + ox, ay, az + oz);
      h.quaternion.copy(ringAlign.helicase);
      h.rotateY(spin.current * 0.6 * f.dir);
      h.scale.setScalar(0.5 * on);
      h.visible = on > 0.01;
    });
    // PCNA clamp encircles one parted strand mid-bubble, the polymerase copying beside it.
    const p = refs.pcna.current;
    const pol = refs.polymerase.current;
    if (p && pol) {
      const i = fork + bubble * 0.5;
      const [ax, ay, az] = axisPoint(meta, i);
      const [ox, , oz] = forkOffset(meta, i, 1, fork);
      p.position.set(ax + ox, ay, az + oz);
      p.quaternion.copy(ringAlign.pcna);
      p.rotateY(-spin.current * 0.35);
      p.scale.setScalar(0.5 * on);
      p.visible = on > 0.01;
      const out = new THREE.Vector3(ox, 0, oz).normalize().multiplyScalar(3.4);
      pol.position.set(p.position.x + out.x, ay + 1.2, p.position.z + out.z);
      pol.rotation.set(0.4, spin.current * 0.2, 0.2);
      pol.scale.setScalar(0.55 * on);
      pol.visible = on > 0.01;
    }
    // Histone octamers grow in as the DNA wraps around them.
    meta.nucleosomes.forEach((n, k) => {
      const m = refs.histones.current[k];
      if (!m) return;
      const span = Math.max(1, meta.nBp - meta.nucStart);
      const local = Math.min(1, Math.max(0, wrap * 1.6 - ((n.firstBp - meta.nucStart) / span) * 0.6));
      const on = smooth(local) * Math.max(0.0, fade);
      m.position.set(...n.center);
      m.quaternion.copy(histoneAlign[k]);
      m.scale.setScalar(0.52 * on);
      m.visible = on > 0.01;
    });
    // Chaperones drift slowly in the background, tumbling.
    refs.groel.current.forEach((m, k) => {
      if (!m) return;
      const t = spin.current * 0.05 + k * 2.1;
      m.rotation.set(t * 0.7, t, t * 0.4);
    });
  });

  return (
    <>
      {meta.nucleosomes.map((n, k) => (
        <mesh
          key={k}
          ref={(m) => {
            refs.histones.current[k] = m;
          }}
          geometry={histone}
          material={mats.histone}
          visible={false}
        />
      ))}
      {[0, 1].map((k) => (
        <mesh
          key={k}
          ref={(m) => {
            refs.helicases.current[k] = m;
          }}
          geometry={helicase}
          material={mats.helicase}
          visible={false}
        />
      ))}
      <mesh ref={refs.pcna} geometry={pcna} material={mats.pcna} visible={false} />
      <mesh ref={refs.polymerase} geometry={polymerase} material={mats.polymerase} visible={false} />
      {[
        [26, -30, -24],
        [-34, -88, 30],
        [30, -150, 26],
      ].map((p, k) => (
        <mesh
          key={k}
          ref={(m) => {
            refs.groel.current[k] = m;
          }}
          geometry={groel}
          material={mats.groel}
          position={p as [number, number, number]}
          scale={0.9}
        />
      ))}
    </>
  );
}

export function Chromosome({ data, variant, fog }: { data: DnaData; variant: Variant; fog: string }) {
  const { meta } = data;
  const time = useSceneTime();
  const geometry = useGeometry("chromosome");
  const material = useMemo(() => {
    const m = proteinMaterial(variant, "chromosome", fog, true);
    if (m instanceof THREE.ShaderMaterial) m.uniforms.uIntensity.value = 1.1;
    return m;
  }, [variant, fog]);
  const mesh = useRef<THREE.Mesh>(null);
  const center = meta.chromosome?.center ?? [1000, -880, 370];

  useFrame((state, dt) => {
    const m = mesh.current;
    if (!m) return;
    const a = sampleTrack(meta, "chromosome", time.s);
    m.visible = a > 0.01;
    m.rotation.y += Math.min(dt, 0.05) * 0.05;
    if (material instanceof THREE.ShaderMaterial) {
      material.uniforms.uOpacity.value = a;
      material.uniforms.uFogDensity.value = 0.00018;
    } else {
      material.opacity = a;
    }
    m.scale.setScalar(0.85 + a * 0.15);
    void state;
  });

  return <mesh ref={mesh} geometry={geometry} material={material} position={center} rotation={[0.35, 0, 0.5]} visible={false} />;
}
