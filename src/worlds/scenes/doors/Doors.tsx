"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { homeState } from "@/components/three/engine/state";
import { useWorldGLTF } from "@/components/three/engine/assets";
import { doorPalette, isDoorWorld, type DoorsLayout } from "@/worlds/scenes/doors/layout";
import { portalMaterial } from "@/worlds/scenes/doors/portal";
import { loadPano } from "@/worlds/scenes/doors/shared/panoEnv";

/** Animated per-door values shared by the arches, their mirror image, the floor and particles. */
export interface DoorFx {
  /** 0..1 how far each door is swung open. */
  open: number[];
  /** Light spilling out of each portal (base glow + hover). */
  glow: number[];
  /** Index of the door being entered, or -1. */
  entering: number;
  /** Seconds since the enter started. */
  enterT: number;
  hovered: number;
}

export function createDoorFx(n: number): DoorFx {
  return { open: new Array(n).fill(0), glow: new Array(n).fill(0), entering: -1, enterT: 0, hovered: -1 };
}

const BASE_GLOW = { day: 0.35, night: 0.7 };

/** Reads the homepage DOM state (hovered / clicked door card) and eases the door values. */
export function DoorController({ layout, fx, variant }: { layout: DoorsLayout; fx: DoorFx; variant: Variant }) {
  useEffect(() => {
    // A stale click from a previous visit must not replay the dive.
    homeState.enteredDoor = null;
  }, []);
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    const hovered = homeState.hoveredDoor;
    const entered = homeState.enteredDoor;
    fx.hovered = isDoorWorld(hovered) ? layout.doors.findIndex((x) => x.id === hovered) : -1;
    const enterIdx = isDoorWorld(entered) ? layout.doors.findIndex((x) => x.id === entered) : -1;
    if (enterIdx !== fx.entering) {
      fx.entering = enterIdx;
      fx.enterT = 0;
    }
    if (fx.entering >= 0) {
      fx.enterT += d;
      if (fx.enterT > 3.2) homeState.enteredDoor = null;
    }
    layout.doors.forEach((_, i) => {
      const on = i === fx.entering ? 1.25 : i === fx.hovered ? 1 : 0;
      fx.open[i] += (on - fx.open[i]) * (1 - Math.exp(-d * (on > fx.open[i] ? 5 : 2.5)));
      const glow = BASE_GLOW[variant] + fx.open[i] * 1.6;
      fx.glow[i] += (glow - fx.glow[i]) * (1 - Math.exp(-d * 6));
    });
  });
  return null;
}

type Tuned = THREE.MeshStandardMaterial & Partial<THREE.MeshPhysicalMaterial>;

const NIGHT_EMISSIVE: Record<string, string> = { seam: "#6dffab" };
const DAY_EMISSIVE: Record<string, string> = { seam: "#5cf2e0" };

/** Material fixes that glTF cannot express, applied once per variant. */
function tuneMaterials(root: THREE.Object3D, variant: Variant) {
  const night = variant === "night";
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.name.startsWith("portal")) return;
    const m = mesh.material as Tuned;
    if (!m || seen.has(m)) return;
    seen.add(m);
    const name = m.name.replace(/\.\d+$/, "");
    m.userData.baseEmissive ??= m.emissiveIntensity ?? 1;
    m.envMapIntensity = 1;
    switch (name) {
      case "glass":
        m.transmission = 0;
        m.transparent = true;
        m.opacity = 0.22;
        m.roughness = 0.04;
        m.metalness = 0;
        m.envMapIntensity = 2.2;
        m.depthWrite = false;
        m.side = THREE.DoubleSide;
        break;
      case "ice":
        m.transmission = 1;
        m.thickness = 0.45;
        m.ior = 1.31;
        m.roughness = 0.14;
        m.attenuationColor = new THREE.Color(night ? "#7fb7ff" : "#a9dcff");
        m.attenuationDistance = 0.9;
        m.envMapIntensity = 1.6;
        break;
      case "ivy":
        m.vertexColors = true;
        m.side = THREE.DoubleSide;
        m.color.set("#ffffff");
        break;
      case "steel":
        // No anisotropy: the GLB has no tangents and derivative-based frames go NaN on its UVs, which bloom smears over the frame.
        m.roughness = 0.26;
        m.metalness = 1;
        m.envMapIntensity = 1.4;
        break;
      case "snow":
        m.sheen = 0.8;
        m.sheenColor = new THREE.Color("#dfefff");
        break;
      default:
        break;
    }
    if (m.emissive && m.emissiveMap == null && (m.emissive.r + m.emissive.g + m.emissive.b > 0.01)) {
      const tint = (night ? NIGHT_EMISSIVE : DAY_EMISSIVE)[name];
      if (tint) m.emissive.set(tint);
      m.emissiveIntensity = m.userData.baseEmissive * (night ? 1.5 : 0.9);
      m.toneMapped = false;
    }
    m.needsUpdate = true;
  });
}

interface DoorNodes {
  leaves: { node: THREE.Object3D; base: THREE.Quaternion; sign: number; door: number }[];
  portals: { mesh: THREE.Mesh; material: THREE.ShaderMaterial }[];
}

const axisY = new THREE.Vector3(0, 1, 0);
const swing = new THREE.Quaternion();

/**
 * The five arches with their leaves and portals. `mirror` builds an
 * independent copy for the floor reflection (portals sample the reflected ray).
 */
export function Doors({ layout, fx, variant, mirror = false }: { layout: DoorsLayout; fx: DoorFx; variant: Variant; mirror?: boolean }) {
  const gltf = useWorldGLTF("doors", "arches.glb");
  const night = variant === "night";

  // Always a clone: leaves animate per instance and the cached GLB stays pristine.
  const root = useMemo(() => gltf.scene.clone(true), [gltf]);
  useMemo(() => tuneMaterials(gltf.scene, variant), [gltf, variant]);

  const nodes = useMemo<DoorNodes>(() => {
    const out: DoorNodes = { leaves: [], portals: [] };
    layout.doors.forEach((door, i) => {
      for (const side of ["L", "R"] as const) {
        const node = root.getObjectByName(`leaf_${door.id}_${side}`);
        if (node) out.leaves.push({ node, base: node.quaternion.clone(), sign: side === "L" ? -1 : 1, door: i });
      }
      const mesh = root.getObjectByName(`portal_${door.id}`) as THREE.Mesh | undefined;
      if (mesh) {
        const material = portalMaterial({
          colors: doorPalette(door.id, variant),
          into: new THREE.Vector3(...door.into),
          right: new THREE.Vector3(...door.right),
          up: new THREE.Vector3(...door.up),
          w: layout.w,
          h: layout.h,
          night,
          mirror,
          seed: i * 3.7,
        });
        mesh.material = material;
        out.portals.push({ mesh, material });
      }
    });
    return out;
  }, [root, layout, variant, night, mirror]);

  // Load each world's panorama (if its agent has produced one yet).
  useEffect(() => {
    let alive = true;
    layout.doors.forEach((door, i) => {
      void loadPano(`/worlds/${door.scene}/pano-${variant}.webp`).then((tex) => {
        const p = nodes.portals[i];
        if (!alive || !tex || !p) return;
        p.material.uniforms.uPano.value = tex;
        p.material.uniforms.uHasPano.value = 1;
      });
    });
    return () => {
      alive = false;
      nodes.portals.forEach((p) => p.material.dispose());
    };
  }, [nodes, layout, variant]);

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    for (const l of nodes.leaves) {
      const o = fx.open[l.door];
      // Doors rest ajar; hovering swings them wide toward the visitor.
      const angle = 0.5 + Math.min(1.25, o) * 1.05;
      swing.setFromAxisAngle(axisY, angle * l.sign);
      l.node.quaternion.copy(l.base).multiply(swing);
    }
    nodes.portals.forEach((p, i) => {
      const u = p.material.uniforms;
      u.uTime.value += d;
      u.uOpen.value = Math.min(1, fx.open[i]);
    });
  });

  return (
    <>
      <primitive object={root} />
      <Bulbs layout={layout} night={night} />
      {!mirror && <SpillLights layout={layout} fx={fx} variant={variant} />}
    </>
  );
}

/** Marquee bulbs on the Play arch: a chase that speeds up when the door is hovered. */
function Bulbs({ layout, night }: { layout: DoorsLayout; night: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const count = layout.bulbs.length;
  const geometry = useMemo(() => new THREE.SphereGeometry(0.042, 12, 8), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const color = useMemo(() => new THREE.Color(), []);
  const warm = useMemo(() => new THREE.Color("#ffd49a"), []);
  const t = useRef(0);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    layout.bulbs.forEach((p, i) => {
      mat.makeTranslation(p[0], p[1], p[2]);
      m.setMatrixAt(i, mat);
      m.setColorAt(i, warm);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [layout, warm]);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    const hover = homeState.hoveredDoor === "play" ? 1 : 0;
    t.current += Math.min(dt, 0.05) * (1.4 + hover * 3);
    for (let i = 0; i < count; i++) {
      const phase = (t.current - i * 0.25) % 3;
      const on = phase < 1 ? 1 : 0.18;
      const k = (night ? 5.5 : 3.2) * on;
      color.copy(warm).multiplyScalar(k);
      m.setColorAt(i, color);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} />;
}

/** One coloured point light in front of each portal; hover floods the arch with its world's light. */
function SpillLights({ layout, fx, variant }: { layout: DoorsLayout; fx: DoorFx; variant: Variant }) {
  const refs = useRef<(THREE.PointLight | null)[]>([]);
  const night = variant === "night";
  const positions = useMemo(
    () =>
      layout.doors.map((d) => {
        const c = new THREE.Vector3(...d.center);
        return c.addScaledVector(new THREE.Vector3(...d.into), -0.9);
      }),
    [layout],
  );
  useFrame(() => {
    refs.current.forEach((l, i) => {
      if (l) l.intensity = fx.glow[i] * (night ? 9 : 6);
    });
  });
  return (
    <>
      {layout.doors.map((d, i) => (
        <pointLight
          key={d.id}
          ref={(l) => {
            refs.current[i] = l;
          }}
          position={positions[i]}
          color={doorPalette(d.id, variant)[0]}
          distance={9}
          decay={2}
        />
      ))}
    </>
  );
}
