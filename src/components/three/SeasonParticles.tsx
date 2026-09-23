"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { pointer } from "@/lib/store";
import { SEASON_THEMES, type Season } from "@/lib/seasons";
import { sceneState } from "@/components/three/sceneState";

const MAX = 340;
const BOX = { x: 34, y: 16, z: 40 };

function makeShapeTexture(kind: "petal" | "leaf" | "snow" | "pollen" | "dust"): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#fff";
  ctx.translate(size / 2, size / 2);
  switch (kind) {
    case "petal": {
      ctx.beginPath();
      ctx.moveTo(0, -28);
      ctx.bezierCurveTo(22, -22, 22, 14, 0, 28);
      ctx.bezierCurveTo(-22, 14, -22, -22, 0, -28);
      ctx.fill();
      break;
    }
    case "leaf": {
      ctx.beginPath();
      ctx.moveTo(0, -28);
      ctx.quadraticCurveTo(26, -6, 0, 28);
      ctx.quadraticCurveTo(-26, -6, 0, -28);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -24);
      ctx.lineTo(0, 24);
      ctx.stroke();
      break;
    }
    case "snow": {
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "pollen":
    case "dust": {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 20);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.5, "rgba(255,255,255,0.6)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

interface Props {
  season: Season;
  scale?: number;
}

/**
 * Petals, leaves, snow, pollen, or golden dust depending on the season.
 * One InstancedMesh; season changes recolor and re-time the same instances.
 */
export function SeasonParticles({ season, scale = 1 }: Props) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const theme = SEASON_THEMES[season];
  const count = Math.min(MAX, Math.round(theme.particleCount * scale));

  const textures = useMemo(
    () => ({
      petal: makeShapeTexture("petal"),
      leaf: makeShapeTexture("leaf"),
      snow: makeShapeTexture("snow"),
      pollen: makeShapeTexture("pollen"),
      dust: makeShapeTexture("dust"),
    }),
    [],
  );

  const data = useMemo(() => {
    const arr = Array.from({ length: MAX }, () => ({
      x: (Math.random() - 0.5) * BOX.x,
      y: Math.random() * BOX.y - 4,
      z: -Math.random() * BOX.z + 6,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 2,
      phase: Math.random() * Math.PI * 2,
      size: 0.5 + Math.random() * 0.8,
      speed: 0.7 + Math.random() * 0.6,
    }));
    return arr;
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorTarget = useMemo(() => new THREE.Color(), []);

  // Recolor instances when the season changes.
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    for (let i = 0; i < MAX; i++) {
      colorTarget.set(theme.particle[i % theme.particle.length]);
      m.setColorAt(i, colorTarget);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.alphaMap = textures[theme.particleKind];
    mat.needsUpdate = true;
  }, [theme, textures, colorTarget]);

  useFrame((state, dt) => {
    const m = mesh.current;
    if (!m) return;
    const step = Math.min(dt, 0.05);
    const t = state.clock.elapsedTime;
    const camZ = state.camera.position.z;
    const fall = theme.fallSpeed;
    const sway = theme.sway;
    const sizeMul = theme.particleKind === "pollen" || theme.particleKind === "dust" ? 0.35 : theme.particleKind === "snow" ? 0.55 : 1;

    for (let i = 0; i < count; i++) {
      const p = data[i];
      p.y -= fall * p.speed * step * 2.2;
      p.x += Math.sin(t * 0.9 + p.phase) * sway * step * 0.8;
      p.rot += p.spin * step;

      // Pointer wind: nearby particles get nudged away from the cursor.
      const dx = p.x - sceneState.pointerWorld.x;
      const dy = p.y - sceneState.pointerWorld.y;
      const dz = p.z + camZ - sceneState.pointerWorld.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (pointer.active && d2 < 16) {
        const f = (1 - d2 / 16) * step * 6;
        p.x += dx * f;
        p.y += dy * f;
      }

      if (p.y < -6) {
        p.y = BOX.y - 4;
        p.x = (Math.random() - 0.5) * BOX.x;
      } else if (p.y > BOX.y - 3) {
        p.y = -5;
        p.x = (Math.random() - 0.5) * BOX.x;
      }

      dummy.position.set(p.x, p.y, p.z + camZ);
      dummy.rotation.set(p.rot * 0.7, p.rot, p.rot * 0.3);
      const s = p.size * sizeMul;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.count = count;
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX]} frustumCulled={false}>
      <planeGeometry args={[0.7, 0.7]} />
      <meshBasicMaterial transparent depthWrite={false} side={THREE.DoubleSide} alphaTest={0.05} opacity={0.95} />
    </instancedMesh>
  );
}
