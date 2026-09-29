"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { firstMeshGeometry, useColorTextures, useWorldGLTF } from "@/components/three/engine/assets";
import { FlockSim, planeMatrix } from "@/worlds/scenes/planes/sim";
import { paperMaterial } from "@/worlds/scenes/planes/paper";
import { lightDir, lin, sky } from "@/worlds/scenes/planes/shaders";
import { onLaunch } from "@/worlds/scenes/planes/launch";

export const PAPER_TEXTURES = ["/worlds/planes/hi/paper.webp", "/worlds/planes/hi/paper-normal.webp"];

const TINTS = ["#ffffff", "#fff6ec", "#fff0f2", "#f6f2ff", "#fffbe8", "#f0f7ff", "#ffffff", "#fff3e6"];
const HEROES = 2;
const TRAIL = 26;
const TRAIL_DT = 0.07;

const trailVertex = /* glsl */ `
  attribute float aAge;
  attribute float aSide;
  attribute float aAlpha;
  varying float vAge;
  varying float vSide;
  varying float vAlpha;
  void main() {
    vAge = aAge;
    vSide = aSide;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`;
const trailFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAge;
  varying float vSide;
  varying float vAlpha;
  void main() {
    float edge = 1.0 - vSide * vSide;
    float a = pow(1.0 - vAge, 1.7) * smoothstep(0.0, 0.05, vAge) * edge * uOpacity * vAlpha;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

const glowVertex = /* glsl */ `
  uniform float uDpr;
  uniform float uSize;
  void main() {
    vec4 mv = viewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(uSize * uDpr / max(-mv.z, 0.1), 2.0, 90.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const glowFragment = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = exp(-r * r * 5.0) * 0.8 + exp(-r * r * 40.0);
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

interface Flight {
  active: boolean;
  t: number;
  dur: number;
  /** Camera-relative Bezier (heroes) or world Bezier (launch). */
  p: THREE.Vector3[];
  roll: number;
}

const bez = (out: THREE.Vector3, p: THREE.Vector3[], t: number) => {
  const u = 1 - t;
  return out
    .copy(p[0])
    .multiplyScalar(u * u * u)
    .addScaledVector(p[1], 3 * u * u * t)
    .addScaledVector(p[2], 3 * u * t * t)
    .addScaledVector(p[3], t * t * t);
};

/**
 * The flock: 64 folded paper planes on a formation sim, two hero planes that
 * sweep past the camera now and then, and the launch plane fired by the
 * contact form. Each leaves a faint contrail; at night each carries a lantern.
 */
export function Flock({ variant, flow }: { variant: Variant; flow: { speed: number } }) {
  const night = variant === "night";
  const gltf = useWorldGLTF("planes", "plane.glb");
  const [map, normal] = useColorTextures(PAPER_TEXTURES);
  const sim = useMemo(() => new FlockSim(), []);
  const total = sim.n + HEROES + 1;
  const LAUNCH = sim.n + HEROES;

  const geometry = useMemo(() => {
    const g = firstMeshGeometry(gltf).clone();
    const print = new Float32Array(total);
    const tint = new Float32Array(total * 3);
    const c = new THREE.Color();
    for (let i = 0; i < total; i++) {
      const s = sim.slots[i % sim.n];
      print[i] = i >= sim.n ? (i === LAUNCH ? 1 : i % 4) : s.print;
      c.set(TINTS[Math.floor(s.tint * TINTS.length) % TINTS.length]);
      if (i === LAUNCH) c.set("#ffffff");
      tint.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("aPrint", new THREE.InstancedBufferAttribute(print, 1));
    g.setAttribute("aTint", new THREE.InstancedBufferAttribute(tint, 3));
    return g;
  }, [gltf, sim, total, LAUNCH]);

  const paper = useMemo(() => {
    map.flipY = false;
    map.colorSpace = THREE.SRGBColorSpace;
    map.needsUpdate = true;
    normal.colorSpace = THREE.NoColorSpace;
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    normal.repeat.set(2.5, 2.5);
    normal.needsUpdate = true;
    return paperMaterial(map, normal, night);
  }, [map, normal, night]);
  useEffect(() => () => paper.material.dispose(), [paper]);

  const mesh = useRef<THREE.InstancedMesh>(null);
  const sun = useMemo(() => lightDir(variant), [variant]);
  const sunCol = useMemo(() => lin(sky(variant).light.color, night ? 0.8 : 2.6), [variant, night]);

  // Contrails: TRAIL samples per plane, advected back with the air.
  const trails = useMemo(() => {
    const verts = total * TRAIL * 2;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(verts * 3);
    const age = new Float32Array(verts);
    const side = new Float32Array(verts);
    const alpha = new Float32Array(verts);
    const index: number[] = [];
    for (let p = 0; p < total; p++) {
      for (let k = 0; k < TRAIL; k++) {
        const v = (p * TRAIL + k) * 2;
        age[v] = age[v + 1] = k / (TRAIL - 1);
        side[v] = -1;
        side[v + 1] = 1;
        alpha[v] = alpha[v + 1] = p >= sim.n ? 1.6 : 0.55 + ((p * 0.37) % 1) * 0.45;
        if (k < TRAIL - 1) index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAge", new THREE.BufferAttribute(age, 1));
    g.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    g.setIndex(index);
    const hist = new Float32Array(total * TRAIL * 3);
    const material = new THREE.ShaderMaterial({
      vertexShader: trailVertex,
      fragmentShader: trailFragment,
      uniforms: { uColor: { value: night ? lin("#c3cbff", 0.9) : lin("#fff3ea", 1.6) }, uOpacity: { value: night ? 0.3 : 0.42 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    return { geometry: g, material, hist, clock: 0, primed: new Uint8Array(total), shown: new Uint8Array(total) };
  }, [total, sim.n, night]);
  useEffect(
    () => () => {
      trails.geometry.dispose();
      trails.material.dispose();
    },
    [trails],
  );

  // Lanterns (night): a glowing bead under each plane on a short thread.
  const lanterns = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(total * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const threads = new THREE.BufferGeometry();
    threads.setAttribute("position", new THREE.BufferAttribute(new Float32Array(total * 6), 3).setUsage(THREE.DynamicDrawUsage));
    const bead = new THREE.SphereGeometry(0.045, 12, 8);
    bead.scale(1, 1.25, 1);
    return {
      glow: g,
      threads,
      bead,
      beadMat: new THREE.MeshBasicMaterial({ color: lin("#ffc27a", 7) }),
      glowMat: new THREE.ShaderMaterial({
        vertexShader: glowVertex,
        fragmentShader: glowFragment,
        uniforms: { uColor: { value: lin("#ffa24a", 2.2) }, uDpr: { value: 1 }, uSize: { value: 26 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      threadMat: new THREE.LineBasicMaterial({ color: lin("#6d5a7a", 0.5), transparent: true, opacity: 0.5 }),
      swing: new Float32Array(total * 2),
    };
  }, [total]);
  const beads = useRef<THREE.InstancedMesh>(null);

  const flights = useRef<Flight[]>(
    Array.from({ length: HEROES + 1 }, () => ({ active: false, t: 0, dur: 4, p: [0, 1, 2, 3].map(() => new THREE.Vector3()), roll: 0 })),
  );
  const nextHero = useRef(2.5);

  useEffect(
    () =>
      onLaunch(() => {
        const f = flights.current[HEROES];
        f.active = true;
        f.t = 0;
        f.dur = 7.5;
        f.roll = 0;
        f.p[0].set(NaN, 0, 0); // resolved against the camera on the next frame
      }),
    [],
  );

  const tmp = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      p: new THREE.Vector3(),
      q: new THREE.Vector3(),
      h: new THREE.Vector3(),
      zero: new THREE.Matrix4().makeScale(0, 0, 0),
      camQ: new THREE.Quaternion(),
      tail: new THREE.Vector3(),
      side: new THREE.Vector3(),
      toCam: new THREE.Vector3(),
      fwd: new THREE.Vector3(),
      keel: new THREE.Vector3(),
    }),
    [],
  );
  const time = useRef(0);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    time.current += dt;
    const t = time.current;
    const cam = state.camera;
    const im = mesh.current;
    if (!im) return;
    sim.step(dt, t, cam.position);

    paper.uniforms.uSunDirView.value.copy(sun).transformDirection(cam.matrixWorldInverse);
    paper.uniforms.uSunCol.value.copy(sunCol);

    const shown = trails.shown;
    for (let i = 0; i < sim.n; i++) {
      const s = sim.slots[i];
      tmp.p.fromArray(sim.pos, i * 3);
      sim.heading(i, tmp.h);
      const flutter = Math.sin(t * 6.3 + s.phase) * 0.035 + Math.sin(t * 2.1 + s.phase * 3) * 0.05;
      planeMatrix(tmp.m, tmp.p, tmp.h, sim.bank[i] + flutter, Math.sin(t * 1.7 + s.phase) * 0.03, s.scale);
      im.setMatrixAt(i, tmp.m);
      shown[i] = 1;
    }

    // Hero flybys: camera-relative sweeps from behind-right into the distance.
    tmp.camQ.copy(cam.quaternion);
    if (t > nextHero.current) {
      const f = flights.current.find((x, k) => k < HEROES && !x.active);
      if (f) {
        const k = Math.random();
        f.active = true;
        f.t = 0;
        f.dur = 3.6 + k * 1.4;
        f.roll = -0.35 - k * 0.3;
        f.p[0].set(1.6 + k * 0.6, -1.1 - k * 0.3, 3.0);
        f.p[1].set(0.9 + k * 0.4, -0.45, -2.2);
        f.p[2].set(1.8 + k, 0.2 + k * 0.4, -12);
        f.p[3].set(4 + k * 3, 1.4 + k, -48);
      }
      nextHero.current = t + 6 + Math.random() * 5;
    }
    const worldOf = (local: THREE.Vector3, out: THREE.Vector3) => out.copy(local).applyQuaternion(tmp.camQ).add(cam.position);
    for (let k = 0; k <= HEROES; k++) {
      const f = flights.current[k];
      const idx = sim.n + k;
      if (!f.active) {
        im.setMatrixAt(idx, tmp.zero);
        shown[idx] = 0;
        continue;
      }
      if (k === HEROES && Number.isNaN(f.p[0].x)) {
        // Launch: from just below the form, up and away toward the light on the horizon.
        worldOf(new THREE.Vector3(-0.35, -0.75, -2.4), f.p[0]);
        cam.getWorldDirection(tmp.fwd);
        f.p[1].copy(f.p[0]).addScaledVector(tmp.fwd, 5).add(new THREE.Vector3(0, 2.2, 0));
        f.p[2].copy(f.p[0]).addScaledVector(sun, 60).add(new THREE.Vector3(0, 5, 0));
        f.p[3].copy(cam.position).addScaledVector(sun, 700);
        trails.primed[idx] = 0;
      }
      f.t += dt / f.dur;
      if (f.t >= 1) {
        f.active = false;
        im.setMatrixAt(idx, tmp.zero);
        shown[idx] = 0;
        continue;
      }
      const u = k === HEROES ? 1 - Math.pow(1 - f.t, 2.2) : f.t;
      const du = 0.01;
      if (k === HEROES) {
        bez(tmp.p, f.p, u);
        bez(tmp.q, f.p, Math.min(1, u + du));
      } else {
        bez(tmp.q, f.p, u);
        worldOf(tmp.q, tmp.p);
        bez(tmp.h, f.p, Math.min(1, u + du));
        worldOf(tmp.h, tmp.q);
      }
      tmp.h.subVectors(tmp.q, tmp.p).normalize();
      const roll = k === HEROES ? Math.sin(f.t * Math.PI * 2) * 0.35 : f.roll * Math.sin(f.t * Math.PI);
      planeMatrix(tmp.m, tmp.p, tmp.h, roll, 0, k === HEROES ? 1.1 : 1.0);
      im.setMatrixAt(idx, tmp.m);
      shown[idx] = 1;
    }
    im.instanceMatrix.needsUpdate = true;

    // Contrails: shift history back with the air, push a new head sample every TRAIL_DT.
    const H = trails.hist;
    const drift = flow.speed * dt;
    trails.clock += dt;
    const push = trails.clock >= TRAIL_DT;
    if (push) trails.clock = 0;
    for (let p = 0; p < total; p++) {
      im.getMatrixAt(p, tmp.m);
      tmp.tail.set(0, 0, 0.42).applyMatrix4(tmp.m);
      const base = p * TRAIL * 3;
      const hidden = !shown[p];
      if (hidden || !trails.primed[p]) {
        for (let k = 0; k < TRAIL; k++) tmp.tail.toArray(H, base + k * 3);
        trails.primed[p] = hidden ? 0 : 1;
        continue;
      }
      for (let k = 0; k < TRAIL; k++) H[base + k * 3 + 2] += drift;
      if (push) H.copyWithin(base + 3, base, base + (TRAIL - 1) * 3);
      tmp.tail.toArray(H, base);
    }
    const P = trails.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = P.array as Float32Array;
    for (let p = 0; p < total; p++) {
      const base = p * TRAIL * 3;
      for (let k = 0; k < TRAIL; k++) {
        const a = base + Math.max(0, k - 1) * 3;
        const b = base + Math.min(TRAIL - 1, k + 1) * 3;
        tmp.side.set(H[a] - H[b], H[a + 1] - H[b + 1], H[a + 2] - H[b + 2]);
        tmp.toCam.set(cam.position.x - H[base + k * 3], cam.position.y - H[base + k * 3 + 1], cam.position.z - H[base + k * 3 + 2]);
        tmp.side.cross(tmp.toCam);
        const len = tmp.side.length();
        const w = (0.02 + 0.2 * Math.pow(k / (TRAIL - 1), 1.2)) * (p >= sim.n ? 1.4 : 1);
        if (len > 1e-6) tmp.side.multiplyScalar(w / len);
        const v = (p * TRAIL + k) * 2 * 3;
        arr[v] = H[base + k * 3] - tmp.side.x;
        arr[v + 1] = H[base + k * 3 + 1] - tmp.side.y;
        arr[v + 2] = H[base + k * 3 + 2] - tmp.side.z;
        arr[v + 3] = H[base + k * 3] + tmp.side.x;
        arr[v + 4] = H[base + k * 3 + 1] + tmp.side.y;
        arr[v + 5] = H[base + k * 3 + 2] + tmp.side.z;
      }
    }
    P.needsUpdate = true;

    if (night && beads.current) {
      const G = lanterns.glow.getAttribute("position") as THREE.BufferAttribute;
      const T = lanterns.threads.getAttribute("position") as THREE.BufferAttribute;
      const ga = G.array as Float32Array;
      const ta = T.array as Float32Array;
      for (let p = 0; p < total; p++) {
        im.getMatrixAt(p, tmp.m);
        tmp.keel.set(0, -0.07, -0.02).applyMatrix4(tmp.m);
        // Pendulum lag: the lantern trails a little behind sideways motion.
        const sw = lanterns.swing;
        const vx = p < sim.n ? sim.vel[p * 3] : 0;
        sw[p * 2] += (-vx * 0.05 - sw[p * 2]) * (1 - Math.exp(-dt * 3));
        const lx = tmp.keel.x + sw[p * 2];
        const ly = tmp.keel.y - 0.24;
        const lz = tmp.keel.z + 0.02;
        ga[p * 3] = lx;
        ga[p * 3 + 1] = ly;
        ga[p * 3 + 2] = lz;
        ta.set([tmp.keel.x, tmp.keel.y, tmp.keel.z, lx, ly + 0.05, lz], p * 6);
        const s = shown[p];
        tmp.m.makeScale(s, s, s).setPosition(lx, ly, lz);
        beads.current.setMatrixAt(p, tmp.m);
      }
      G.needsUpdate = true;
      T.needsUpdate = true;
      beads.current.instanceMatrix.needsUpdate = true;
      lanterns.glowMat.uniforms.uDpr.value = state.gl.getPixelRatio();
    }
  });

  return (
    <>
      <instancedMesh ref={mesh} args={[geometry, paper.material, total]} frustumCulled={false} />
      <mesh geometry={trails.geometry} material={trails.material} frustumCulled={false} renderOrder={3} />
      {night && (
        <>
          <instancedMesh ref={beads} args={[lanterns.bead, lanterns.beadMat, total]} frustumCulled={false} />
          <points geometry={lanterns.glow} material={lanterns.glowMat} frustumCulled={false} renderOrder={4} />
          <lineSegments geometry={lanterns.threads} material={lanterns.threadMat} frustumCulled={false} />
        </>
      )}
    </>
  );
}
