"use client";

import { useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { DoorsLayout } from "@/worlds/scenes/doors/layout";
import type { DoorFx } from "@/worlds/scenes/doors/Doors";

const RUSH_SECONDS = 1.25;
const up = new THREE.Vector3(0, 1, 0);

/**
 * Runs after RailCamera: turns the view a little toward a hovered door, and
 * when a door card is clicked, rushes the camera through that portal (the
 * compositor's "dive" transition plays on top). Also reports a focus point.
 */
export function CameraFx({ layout, fx, focus }: { layout: DoorsLayout; fx: DoorFx; focus: THREE.Vector3 }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const tmp = useMemo(
    () => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), target: new THREE.Vector3(), pos: new THREE.Vector3(), fwd: new THREE.Vector3(), c: new THREE.Vector3(), into: new THREE.Vector3(), attention: 0 }),
    [],
  );
  const centers = useMemo(() => layout.doors.map((d) => new THREE.Vector3(...d.center)), [layout]);
  const intos = useMemo(() => layout.doors.map((d) => new THREE.Vector3(...d.into)), [layout]);

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    const hovered = fx.hovered;
    tmp.attention += ((hovered >= 0 ? 1 : 0) - tmp.attention) * (1 - Math.exp(-d * 3));

    // Focus: the hovered door, else the nearest door ahead of the camera.
    camera.getWorldDirection(tmp.fwd);
    let best = -1;
    let bestD = Infinity;
    centers.forEach((c, i) => {
      tmp.c.copy(c).sub(camera.position);
      const ahead = tmp.c.dot(tmp.fwd);
      // Include the arch the camera is passing through. Skipping anything
      // closer than 2.5 m left that frame fully in the near-blur and it
      // came back as a black block.
      if (ahead > 0.6 && ahead < bestD) {
        bestD = ahead;
        best = i;
      }
    });
    const fi = fx.entering >= 0 ? fx.entering : hovered >= 0 ? hovered : best;
    if (fi >= 0) focus.lerp(centers[fi], 1 - Math.exp(-d * 4));

    if (hovered >= 0 && fx.entering < 0 && tmp.attention > 0.001) {
      tmp.m.lookAt(camera.position, centers[hovered], up);
      tmp.q.setFromRotationMatrix(tmp.m);
      camera.quaternion.slerp(tmp.q, 0.14 * tmp.attention);
    }

    if (fx.entering >= 0) {
      const i = fx.entering;
      const k = THREE.MathUtils.clamp(fx.enterT / RUSH_SECONDS, 0, 1);
      const e = k * k * (3 - 2 * k);
      const ease = e * e;
      // Stop just short of the portal plane so the other world fills the frame.
      tmp.target.copy(centers[i]).addScaledVector(intos[i], -0.4);
      tmp.target.y -= 0.2;
      tmp.pos.copy(camera.position).lerp(tmp.target, ease);
      camera.position.copy(tmp.pos);
      tmp.c.copy(centers[i]).addScaledVector(intos[i], 8);
      tmp.m.lookAt(camera.position, tmp.c, up);
      tmp.q.setFromRotationMatrix(tmp.m);
      camera.quaternion.slerp(tmp.q, Math.min(1, e * 1.4));
    }
  });
  return null;
}
