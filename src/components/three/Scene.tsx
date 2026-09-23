"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { SEASON_THEMES, type Season } from "@/lib/seasons";
import { scrollState, useUi } from "@/lib/store";
import { Sky } from "@/components/three/Sky";
import { Terrain, TERRAIN_LENGTH } from "@/components/three/Terrain";
import { Fireflies } from "@/components/three/Fireflies";
import { SeasonParticles } from "@/components/three/SeasonParticles";
import { HeroModel } from "@/components/three/HeroModel";
import { sceneState, NIGHT_SKY, GOLDEN_SKY, NIGHT_TERRAIN } from "@/components/three/sceneState";

interface SceneProps {
  season: Season;
  quality: "high" | "low";
}

function smoothstep(a: number, b: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Owns the per-frame lerp of colors, the camera fly-over, and the lights.
 * Everything else reads from sceneState.
 */
export function Scene({ season, quality }: SceneProps) {
  const theme = useUi((s) => s.theme);
  const isDark = theme === "dark";
  const seasonTheme = SEASON_THEMES[season];
  const camera = useThree((s) => s.camera);

  const targets = useMemo(
    () => ({
      skyTop: new THREE.Color(),
      skyBottom: new THREE.Color(),
      terrainTop: new THREE.Color(),
      terrainBottom: new THREE.Color(),
      particles: [new THREE.Color(), new THREE.Color(), new THREE.Color()],
    }),
    [],
  );

  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const bloomRef = useRef<{ intensity: number } | null>(null);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  const unproject = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    camera.position.set(0, 2.6, 0);
  }, [camera]);

  useFrame((state, dt) => {
    const step = Math.min(dt, 0.05);
    const k = 1 - Math.pow(0.001, step); // frame-rate independent lerp (~fast)
    const slow = 1 - Math.pow(0.05, step);

    // Time of day + night blend.
    const progress = scrollState.progress;
    const timeTarget = isDark ? 1 : progress;
    const nightTarget = isDark ? 1 : smoothstep(0.62, 0.98, progress);
    sceneState.time += (timeTarget - sceneState.time) * slow;
    sceneState.night += (nightTarget - sceneState.night) * slow;

    // Sky: season → golden hour mid-scroll → night.
    const golden = smoothstep(0.3, 0.6, sceneState.time) * (1 - smoothstep(0.6, 0.95, sceneState.time));
    targets.skyTop.set(seasonTheme.sky.high).lerp(GOLDEN_SKY.top, golden * 0.85).lerp(NIGHT_SKY.top, sceneState.night);
    targets.skyBottom.set(seasonTheme.sky.low).lerp(GOLDEN_SKY.bottom, golden * 0.85).lerp(NIGHT_SKY.bottom, sceneState.night);
    targets.terrainTop.set(seasonTheme.terrain.top).lerp(NIGHT_TERRAIN.top, sceneState.night * 0.85);
    targets.terrainBottom.set(seasonTheme.terrain.bottom).lerp(NIGHT_TERRAIN.bottom, sceneState.night * 0.85);
    seasonTheme.particle.forEach((c, i) => targets.particles[i % 3].set(c));

    sceneState.skyTop.lerp(targets.skyTop, slow);
    sceneState.skyBottom.lerp(targets.skyBottom, slow);
    sceneState.terrainTop.lerp(targets.terrainTop, slow);
    sceneState.terrainBottom.lerp(targets.terrainBottom, slow);
    sceneState.particleColors.forEach((c, i) => c.lerp(targets.particles[i], slow));

    // Camera fly-over.
    const travel = -(progress * (TERRAIN_LENGTH - 90));
    sceneState.cameraZ += (travel - sceneState.cameraZ) * k;
    const bob = Math.sin(state.clock.elapsedTime * 0.7) * 0.12;
    const px = state.pointer.x;
    const py = state.pointer.y;
    camera.position.x += (px * 1.2 - camera.position.x) * k;
    camera.position.y += (2.6 + bob + py * 0.5 - camera.position.y) * k;
    camera.position.z = sceneState.cameraZ;
    lookTarget.set(px * 2.5, 1.6 + py * 1.2 - sceneState.night * 0.6, sceneState.cameraZ - 14);
    camera.lookAt(lookTarget);

    // Pointer projected 8 units into the scene for particles to react to.
    unproject.set(px, py, 0.5).unproject(camera).sub(camera.position).normalize().multiplyScalar(8).add(camera.position);
    sceneState.pointerWorld.lerp(unproject, k);

    // Lights follow the sun and dim at night.
    if (sun.current) {
      sun.current.position.set(8 - sceneState.time * 16, 6 + Math.sin(sceneState.time * Math.PI) * 6, sceneState.cameraZ - 10);
      sun.current.target.position.set(0, 0, sceneState.cameraZ - 20);
      sun.current.target.updateMatrixWorld();
      sun.current.intensity = THREE.MathUtils.lerp(2.2, 0.35, sceneState.night);
      sun.current.color.set(isDark ? "#b8c6ff" : "#fff4dd").lerp(new THREE.Color("#ffb070"), golden);
    }
    if (hemi.current) {
      hemi.current.intensity = THREE.MathUtils.lerp(0.9, 0.35, sceneState.night);
      hemi.current.color.copy(sceneState.skyTop);
      hemi.current.groundColor.copy(sceneState.terrainBottom);
    }
    if (bloomRef.current) {
      bloomRef.current.intensity = THREE.MathUtils.lerp(0.35, 1.4, sceneState.night);
    }
  });

  const particleScale = quality === "high" ? 1 : 0.45;

  return (
    <>
      <Sky />
      <hemisphereLight ref={hemi} intensity={0.9} />
      <directionalLight ref={sun} intensity={2} castShadow={false} />
      <fog attach="fog" args={["#ffffff", 30, 110]} />
      <FogColor />
      <Terrain />
      <HeroModel />
      <Fireflies count={quality === "high" ? 285 : 98} />
      <SeasonParticles season={season} scale={particleScale} />
      {quality === "high" && (
        <EffectComposer multisampling={0}>
          <Bloom ref={bloomRef as never} intensity={0.6} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
        </EffectComposer>
      )}
    </>
  );
}

/** Keeps the fog color matched to the horizon so hills melt into the sky. */
function FogColor() {
  const scene = useThree((s) => s.scene);
  useFrame(() => {
    if (scene.fog && "color" in scene.fog) {
      (scene.fog as THREE.Fog).color.copy(sceneState.skyBottom);
    }
  });
  return null;
}
