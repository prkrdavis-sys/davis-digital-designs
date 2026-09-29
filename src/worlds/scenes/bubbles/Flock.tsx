"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { pointer } from "@/lib/store";
import { useSceneTime } from "@/components/three/engine/slot";
import { bakedGeometry, node, useWorldGLTF } from "@/components/three/engine/assets";
import { BUBBLES } from "@/worlds/scenes/bubbles/palette";
import { bubbleVinyl, makeSquish, withSquish, type Squish } from "@/worlds/scenes/bubbles/materials";
import type { BubblesLayout } from "@/worlds/scenes/bubbles/layout";

interface Body {
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  baseQuat: THREE.Quaternion;
  invQuat: THREE.Quaternion;
  squish: Squish;
  glyphSquish: Squish | null;
  squash: number;
  squashVel: number;
  squashDir: THREE.Vector3;
  jelly: number;
  hovered: boolean;
  seed: number;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const closest = new THREE.Vector3();
const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();
const tilt = new THREE.Quaternion();
const euler = new THREE.Euler();
const decompScale = new THREE.Vector3();
const localDir = new THREE.Vector3();

/**
 * Speech bubbles drifting around the column, springing back to slowly
 * wandering homes. Overlaps push them apart and squash both (the vertex
 * shader squashes along the contact normal); the cursor shoves them;
 * scrolling makes them lag like balloons on strings.
 */
export function Flock({ variant, layout }: { variant: Variant; layout: BubblesLayout }) {
  const gltf = useWorldGLTF("bubbles", "bubbles.glb");
  const camera = useThree((s) => s.camera);
  const time = useSceneTime();
  const night = variant === "night";
  const pal = BUBBLES[variant];

  const { group, bodies, disposables } = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const geo = (name: string) => bakedGeometry(node(gltf, name));
    const shapes: Record<string, THREE.BufferGeometry> = { round: geo("bubble_round"), pill: geo("bubble_pill"), square: geo("bubble_square") };
    const glyphs: Record<string, THREE.BufferGeometry> = { heart: geo("glyph_heart"), star: geo("glyph_star"), dots: geo("glyph_dots") };
    const group = new THREE.Group();
    const bodies: Body[] = [];
    const disposables: { dispose: () => void }[] = [...Object.values(shapes), ...Object.values(glyphs)];
    layout.bubbles.forEach((b, i) => {
      const squish = makeSquish(i * 0.173);
      const color = pal.vinyl[b.color] ?? "#ffffff";
      const mat = withSquish(bubbleVinyl(color, night), squish);
      disposables.push(mat);
      if (night) {
        // Lit from within: body glows face-on, a softer halo at the rim.
        squish.glow.value.set(color);
        squish.inner.value = 0.55;
        squish.rim.value = 0.9;
      }
      const mesh = new THREE.Mesh(shapes[b.shape], mat);
      const m = new THREE.Matrix4().fromArray(b.matrix);
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      m.decompose(pos, quat, decompScale);
      mesh.position.copy(pos);
      mesh.quaternion.copy(quat);
      mesh.scale.copy(decompScale);
      group.add(mesh);
      let glyphSquish: Squish | null = null;
      if (b.glyph) {
        glyphSquish = makeSquish(i * 0.173);
        const gcol = pal.vinyl[b.glyph.color] ?? "#ffffff";
        const gm = withSquish(bubbleVinyl(gcol, night, true), glyphSquish);
        disposables.push(gm);
        if (night && b.glyph.color !== "chrome") {
          glyphSquish.glow.value.set(gcol);
          glyphSquish.inner.value = 1.4;
          glyphSquish.rim.value = 1.2;
        }
        const g = new THREE.Mesh(glyphs[b.glyph.shape], gm);
        g.position.set(0, 0.02, b.front - 0.04);
        mesh.add(g);
      }
      const sphereR = shapes[b.shape].boundingSphere?.radius ?? 1.2;
      bodies.push({
        mesh,
        home: pos.clone(),
        pos: pos.clone(),
        vel: new THREE.Vector3(),
        radius: sphereR * Math.abs(decompScale.y) * 0.78,
        baseQuat: quat.clone(),
        invQuat: quat.clone().invert(),
        squish,
        glyphSquish,
        squash: 0,
        squashVel: 0,
        squashDir: new THREE.Vector3(0, 1, 0),
        jelly: 0,
        hovered: false,
        seed: i,
      });
    });
    return { group, bodies, disposables };
  }, [gltf, layout, pal, night]);

  useEffect(() => () => disposables.forEach((d) => d.dispose()), [disposables]);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.033);
    const t = state.clock.elapsedTime;
    const v = THREE.MathUtils.clamp(time.velocity, -3, 3);
    ndc.set(pointer.nx, pointer.ny);
    ray.setFromCamera(ndc, camera);
    const n = bodies.length;

    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      const ph = b.seed * 1.7;
      // Homes wander slowly so neighbours drift into each other now and then.
      tmp.set(Math.sin(t * 0.13 + ph) * 0.9, Math.sin(t * 0.17 + ph * 1.3) * 0.6, Math.cos(t * 0.11 + ph * 0.7) * 0.9).add(b.home);
      tmp.y -= v * 0.9;
      b.vel.addScaledVector(tmp.sub(b.pos), 0.9 * d);
      // Cursor shove: push away from the pointer ray.
      closest.copy(b.pos);
      ray.ray.closestPointToPoint(b.pos, closest);
      const reach = b.radius + 0.9;
      const off = tmp2.subVectors(b.pos, closest);
      const dist = off.length();
      const over = pointer.active && dist < reach && closest.distanceTo(camera.position) > 0.5;
      if (over) {
        b.vel.addScaledVector(off.normalize(), (1 - dist / reach) * 9 * d);
        if (!b.hovered) b.jelly = Math.max(b.jelly, 0.04);
      }
      b.hovered = over;
    }

    // Soft collisions: separate, trade momentum, squash both.
    for (let i = 0; i < n; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < n; j++) {
        const b = bodies[j];
        tmp.subVectors(b.pos, a.pos);
        const dist = tmp.length();
        const min = (a.radius + b.radius) * 0.9;
        if (dist >= min || dist < 1e-4) continue;
        const overlap = min - dist;
        tmp.divideScalar(dist);
        const push = overlap * 3.5 * d;
        a.vel.addScaledVector(tmp, -push);
        b.vel.addScaledVector(tmp, push);
        const rel = tmp2.subVectors(b.vel, a.vel).dot(tmp);
        if (rel < 0) {
          a.vel.addScaledVector(tmp, rel * 0.4);
          b.vel.addScaledVector(tmp, -rel * 0.4);
        }
        const k = Math.min(0.22, overlap / min);
        if (k > a.squash) a.squashDir.copy(tmp);
        if (k > b.squash) b.squashDir.copy(tmp);
        a.squashVel += k * 30 * d;
        b.squashVel += k * 30 * d;
        a.jelly = Math.max(a.jelly, k * 0.08);
        b.jelly = Math.max(b.jelly, k * 0.08);
      }
    }

    for (const b of bodies) {
      b.vel.multiplyScalar(Math.exp(-1.1 * d));
      b.pos.addScaledVector(b.vel, d);
      b.mesh.position.copy(b.pos);
      // Lean into the motion like a balloon, plus a slow idle sway.
      euler.set(b.vel.z * 0.12 + Math.sin(t * 0.5 + b.seed) * 0.04, Math.sin(t * 0.3 + b.seed * 2.1) * 0.08, -b.vel.x * 0.12 + Math.sin(t * 0.42 + b.seed * 0.7) * 0.04);
      tilt.setFromEuler(euler);
      b.mesh.quaternion.copy(tilt).multiply(b.baseQuat);
      // Squash spring (target 0), direction into the bubble's local space.
      b.squashVel += -b.squash * 60 * d;
      b.squashVel *= Math.exp(-7 * d);
      b.squash = THREE.MathUtils.clamp(b.squash + b.squashVel * d, -0.12, 0.24);
      localDir.copy(b.squashDir).applyQuaternion(b.invQuat).normalize();
      b.jelly *= Math.exp(-2.5 * d);
      const jelly = b.jelly + Math.min(0.03, Math.abs(v) * 0.015);
      for (const s of b.glyphSquish ? [b.squish, b.glyphSquish] : [b.squish]) {
        s.squash.value.set(localDir.x, localDir.y, localDir.z, b.squash);
        s.jelly.value = jelly;
        s.time.value = t;
      }
    }
  });

  return <primitive object={group} />;
}
