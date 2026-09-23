import * as THREE from "three";

/**
 * Per-frame lerped values shared across the 3D scene. Written by <Scene>,
 * read by children. Kept outside React so nothing re-renders each frame.
 */
export const sceneState = {
  /** 0 day → 1 night. Driven by scroll progress and the dark theme. */
  night: 0,
  /** 0..1 time of day used for sky/sun. */
  time: 0,
  skyTop: new THREE.Color("#9fd9ff"),
  skyBottom: new THREE.Color("#ffe6f2"),
  terrainTop: new THREE.Color("#7fd39a"),
  terrainBottom: new THREE.Color("#3d9a63"),
  particleColors: [new THREE.Color("#ff9ec4"), new THREE.Color("#ffc3dc"), new THREE.Color("#fff0f6")],
  /** Camera travel along -Z. */
  cameraZ: 0,
  /** World-space pointer target in front of the camera. */
  pointerWorld: new THREE.Vector3(),
  quality: 1,
};

export const NIGHT_SKY = { top: new THREE.Color("#0b1020"), bottom: new THREE.Color("#2a2f5a") };
export const GOLDEN_SKY = { top: new THREE.Color("#ff9a6b"), bottom: new THREE.Color("#ffe2a8") };
export const NIGHT_TERRAIN = { top: new THREE.Color("#1e2a45"), bottom: new THREE.Color("#0f1630") };
