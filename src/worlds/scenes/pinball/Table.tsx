"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SceneMode, Variant } from "@/worlds/types";
import { bakedGeometry, useWorldGLTF, type LoadedGLTF } from "@/components/three/engine/assets";
import type { PinballMeta } from "@/worlds/scenes/pinball/model";
import type { TableState } from "@/worlds/scenes/pinball/state";
import { chaseMaterial, hardwareMaterial, insertMaterial, INSERT_GROUPS } from "@/worlds/scenes/pinball/materials";
import { Dmd, dmdMessage } from "@/worlds/scenes/pinball/Dmd";

interface Lamp {
  geometry: THREE.BufferGeometry;
  color: string;
  group: number;
  seq: number;
}

/** Merge lamp meshes into one geometry carrying per-vertex colour and (group, index). */
function mergeLamps(lamps: Lamp[]): THREE.BufferGeometry {
  const parts = lamps.map((l) => (l.geometry.index ? l.geometry.toNonIndexed() : l.geometry));
  const count = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const lamp = new Float32Array(count * 2);
  let o = 0;
  const c = new THREE.Color();
  parts.forEach((g, i) => {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    c.set(lamps[i].color);
    for (let v = 0; v < p.count; v++, o++) {
      pos.set([p.getX(v), p.getY(v), p.getZ(v)], o * 3);
      if (n) nrm.set([n.getX(v), n.getY(v), n.getZ(v)], o * 3);
      col.set([c.r, c.g, c.b], o * 3);
      lamp.set([lamps[i].group, lamps[i].seq], o * 2);
    }
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  out.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  out.setAttribute("aLamp", new THREE.BufferAttribute(lamp, 2));
  out.computeBoundingSphere();
  return out;
}

interface Hardware {
  group: THREE.Group;
  flippers: THREE.Group[];
  bumpers: { kick: THREE.Group; cap: THREE.MeshPhysicalMaterial }[];
  targets: THREE.Object3D[];
  spinner: THREE.Group;
  backglass: THREE.MeshBasicMaterial | null;
  inserts: THREE.ShaderMaterial;
  chase: THREE.ShaderMaterial;
  dmd: Dmd;
  dispose: () => void;
}

function topName(o: THREE.Object3D, root: THREE.Object3D): string {
  let n = o;
  while (n.parent && n.parent !== root) n = n.parent;
  return n.name;
}

function buildHardware(gltf: LoadedGLTF, meta: PinballMeta, variant: Variant): Hardware {
  const group = new THREE.Group();
  const mats = new Map<string, THREE.Material>();
  const geos: THREE.BufferGeometry[] = [];
  const material = (key: string) => {
    let m = mats.get(key);
    if (!m) {
      m = hardwareMaterial(key, variant) ?? new THREE.MeshBasicMaterial();
      mats.set(key, m);
    }
    return m;
  };

  const flippers = meta.flippers.map((f) => {
    const g = new THREE.Group();
    g.position.set(f.pivot[0], 0, f.pivot[2]);
    group.add(g);
    return g;
  });
  const bumpers = meta.bumpers.map((b) => {
    const kick = new THREE.Group();
    group.add(kick);
    const cap = hardwareMaterial(`cap_${colorName(b.color)}`, variant) as THREE.MeshPhysicalMaterial;
    return { kick, cap };
  });
  const sp = meta.spinner.p;
  const spinner = new THREE.Group();
  spinner.position.set(sp[0], 0.43, sp[2]);
  group.add(spinner);
  const targets: THREE.Object3D[] = meta.targets.map(() => new THREE.Object3D());
  const inserts: Lamp[] = [];
  const chase: Lamp[] = [];
  const seqByGroup = new Map<number, number>();
  const dmd = new Dmd();
  let backglass: THREE.MeshBasicMaterial | null = null;

  gltf.scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const m of meshes) {
    const role = topName(m, gltf.scene);
    const node = gltf.scene.getObjectByName(role) ?? m;
    const src = m.material as THREE.MeshStandardMaterial;
    const key = src.name || role;
    const geo = bakedGeometry(m);
    geos.push(geo);
    const add = (parent: THREE.Object3D, mat: THREE.Material, offset?: THREE.Vector3) => {
      if (offset) geo.translate(-offset.x, -offset.y, -offset.z);
      const mesh = new THREE.Mesh(geo, mat);
      parent.add(mesh);
      return mesh;
    };
    let k: number;
    if (role.startsWith("insert_")) {
      const g = Math.max(0, INSERT_GROUPS.indexOf(String(node.userData.group)));
      const seq = seqByGroup.get(g) ?? 0;
      seqByGroup.set(g, seq + 1);
      inserts.push({ geometry: geo, color: String(node.userData.color ?? "#ffffff"), group: g, seq });
    } else if (role.startsWith("chase_")) {
      chase.push({ geometry: geo, color: String(node.userData.color ?? "#ffffff"), group: 0, seq: Number(node.userData.index ?? chase.length) });
    } else if ((k = flipperIndex(role)) >= 0) {
      const f = meta.flippers[k];
      add(flippers[k], material(key), new THREE.Vector3(f.pivot[0], 0, f.pivot[2]));
    } else if (role.startsWith("bumper_cap_") || role.startsWith("bumper_skirt_") || role.startsWith("bumper_star_")) {
      const i = Number(role.split("_").pop());
      add(bumpers[i].kick, role.startsWith("bumper_cap_") ? bumpers[i].cap : material(key));
    } else if (role.startsWith("target_")) {
      const i = Number(role.split("_").pop());
      targets[i] = add(group, material(key));
    } else if (role.startsWith("spinner")) {
      add(spinner, material(key), spinner.position);
    } else if (role === "backglass") {
      backglass = new THREE.MeshBasicMaterial({ map: src.emissiveMap ?? src.map, toneMapped: false });
      add(group, backglass);
    } else if (role === "dmd") {
      add(group, dmd.material);
    } else {
      add(group, material(key));
    }
  }
  const insertMat = insertMaterial(variant);
  const chaseMat = chaseMaterial(variant);
  if (inserts.length) {
    const g = mergeLamps(inserts);
    geos.push(g);
    group.add(new THREE.Mesh(g, insertMat));
  }
  if (chase.length) {
    const g = mergeLamps(chase);
    geos.push(g);
    group.add(new THREE.Mesh(g, chaseMat));
  }
  return {
    group,
    flippers,
    bumpers,
    targets,
    spinner,
    backglass,
    inserts: insertMat,
    chase: chaseMat,
    dmd,
    dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      bumpers.forEach((b) => b.cap.dispose());
      insertMat.dispose();
      chaseMat.dispose();
      backglass?.dispose();
      dmd.dispose();
    },
  };
}

function flipperIndex(role: string): number {
  const m = /^flipper(?:_rubber|_cap)?_(\d)$/.exec(role);
  return m ? Number(m[1]) : -1;
}

function colorName(hex: string): string {
  return { "#ff5c9d": "pink", "#3edcff": "cyan", "#ffd84a": "yellow" }[hex.toLowerCase()] ?? "pink";
}

function buildCabinet(gltf: LoadedGLTF) {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || topName(m, gltf.scene) === "playfield") return;
    const src = m.material as THREE.MeshStandardMaterial;
    const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: src.emissiveMap, emissiveIntensity: 2, roughness: 0.28, metalness: 0, envMapIntensity: 0.7 });
    const geo = bakedGeometry(m);
    geos.push(geo);
    mats.push(mat);
    group.add(new THREE.Mesh(geo, mat));
  });
  return {
    group,
    dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
    },
  };
}

const smoothKick = (x: number) => x * x * (3 - 2 * x);

/** The machine: baked cabinet, live hardware, animated from the shared table state. */
export function Table({ variant, meta, state, mode }: { variant: Variant; meta: PinballMeta; state: TableState; mode: SceneMode }) {
  const hwGltf = useWorldGLTF("pinball", "hardware.glb");
  const cabGltf = useWorldGLTF("pinball", `cabinet-${variant}.glb`);
  const hw = useMemo(() => buildHardware(hwGltf, meta, variant), [hwGltf, meta, variant]);
  const cab = useMemo(() => buildCabinet(cabGltf), [cabGltf]);
  useEffect(() => () => hw.dispose(), [hw]);
  useEffect(() => () => cab.dispose(), [cab]);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const night = variant === "night";

  useFrame(() => {
    const t = state.time;
    hw.flippers.forEach((g, k) => {
      const f = meta.flippers[k];
      g.rotation.y = THREE.MathUtils.degToRad(f.up - f.rest) * smoothKick(state.flippers[k]);
    });
    hw.bumpers.forEach((b, i) => {
      const f = state.bumperFlash[i];
      b.kick.position.y = -0.045 * f;
      b.cap.emissiveIntensity = (night ? 1.1 : 0.3) + f * (night ? 7 : 3.5);
      const l = lights.current[i];
      if (l) l.intensity = (night ? 0.6 : 0.1) + f * (night ? 5 : 2.2);
    });
    hw.targets.forEach((o, k) => (o.position.y = -0.36 * state.targets[k]));
    hw.spinner.rotation.x = state.spinnerAngle;
    const u = hw.inserts.uniforms;
    u.uTime.value = t;
    u.uS.value = state.s;
    u.uLetters.value = state.letters;
    u.uMulti.value = state.multiball;
    hw.chase.uniforms.uTime.value = t;
    hw.chase.uniforms.uMulti.value = state.multiball;
    if (hw.backglass) {
      const m = state.multiball;
      const base = mode === "parked" ? 0.55 : night ? 1.35 : 1.05;
      const k = base * (0.82 + 0.45 * m + 0.18 * m * Math.max(0, Math.sin(t * 11)));
      hw.backglass.color.setScalar(k);
    }
    const [big, small] = dmdMessage(state.s, t, mode === "parked");
    hw.dmd.draw(big, small);
    hw.dmd.intensity = 2.4 + state.multiball * 1.6;
  });

  return (
    <>
      <primitive object={cab.group} />
      <primitive object={hw.group} />
      {meta.bumpers.map((b, i) => (
        <pointLight
          key={i}
          ref={(l) => {
            lights.current[i] = l;
          }}
          position={[b.p[0], 0.62, b.p[2]]}
          color={b.color}
          distance={3.2}
          decay={2}
        />
      ))}
    </>
  );
}

const ballGeometry = new THREE.SphereGeometry(1, 48, 24);
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

/** Chrome balls, one instanced draw. */
export function Balls({ state, meta }: { state: TableState; meta: PinballMeta }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f6f6fb", metalness: 1, roughness: 0.035, envMapIntensity: 1.25 }), []);
  useEffect(() => () => material.dispose(), [material]);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const sc = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const im = mesh.current;
    if (!im) return;
    sc.setScalar(meta.ballR);
    state.balls.forEach((b, i) => {
      if (b.visible) im.setMatrixAt(i, m4.compose(b.pos, q, sc));
      else im.setMatrixAt(i, hidden);
    });
    im.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[ballGeometry, material, state.balls.length]} frustumCulled={false} />;
}
