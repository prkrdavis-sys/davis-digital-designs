"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { pointer } from "@/lib/store";
import { useSceneTime } from "@/components/three/engine/slot";

const MAX_RIPPLES = 16;
const MAX_CONTACTS = 10;

const vertex = /* glsl */ `
  uniform mat4 uTextureMatrix;
  varying vec4 vReflect;
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vReflect = uTextureMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  #define MAX_RIPPLES ${MAX_RIPPLES}
  #define MAX_CONTACTS ${MAX_CONTACTS}
  uniform sampler2D tReflect;
  uniform vec4 uRipples[MAX_RIPPLES]; // x, z, start time, strength
  uniform vec4 uContacts[MAX_CONTACTS]; // x, z, radius, strength
  uniform float uTime;
  uniform vec3 uTint;
  uniform vec3 uFog;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uBaseReflect;
  uniform vec3 uKeyDir;
  uniform vec3 uKeyColor;
  uniform float uNight;
  varying vec4 vReflect;
  varying vec3 vWorld;

  // Radial wave packet: returns d(height)/d(r).
  float packet(float r, float front, float width, float k) {
    float x = r - front;
    float env = exp(-x * x / (width * width));
    return env * (k * cos(k * x) - 2.0 * x / (width * width) * sin(k * x));
  }

  void main() {
    vec2 p = vWorld.xz;
    vec2 grad = vec2(0.0);
    float crest = 0.0;
    for (int i = 0; i < MAX_RIPPLES; i++) {
      vec4 rp = uRipples[i];
      float age = uTime - rp.z;
      if (rp.w <= 0.0 || age < 0.0 || age > 5.0) continue;
      vec2 d = p - rp.xy;
      float r = length(d) + 1e-4;
      float front = age * 1.35;
      float amp = rp.w * exp(-age * 0.9) / (1.0 + front * 1.2);
      float g = packet(r, front, 0.22 + age * 0.12, 11.0) * amp;
      grad += d / r * g;
      crest += abs(g);
    }
    for (int i = 0; i < MAX_CONTACTS; i++) {
      vec4 c = uContacts[i];
      if (c.w <= 0.0) continue;
      vec2 d = p - c.xy;
      float r = length(d) + 1e-4;
      float x = r - c.z;
      if (x < 0.0 || x > 3.0) continue;
      float g = cos(x * 9.0 - uTime * 2.2) * 9.0 * exp(-x * 1.6) * c.w;
      grad += d / r * g;
    }
    // A whisper of wind so the mirror never looks like plastic.
    grad += vec2(sin(p.x * 1.7 + uTime * 0.6) * cos(p.y * 1.3 - uTime * 0.4), cos(p.x * 1.1 - uTime * 0.5) * sin(p.y * 2.1 + uTime * 0.7)) * 0.012;

    vec3 n = normalize(vec3(-grad.x * 0.05, 1.0, -grad.y * 0.05));
    vec3 v = normalize(cameraPosition - vWorld);
    float dist = length(cameraPosition - vWorld);

    vec2 uv = vReflect.xy / vReflect.w + n.xz * 0.35 / (1.0 + dist * 0.08);
    // Slightly softer the further away (blurred reflections), sampled from the mip chain.
    float lod = clamp(dist * 0.06, 0.0, 2.5);
    vec3 refl = texture2D(tReflect, uv, lod).rgb;

    float cosT = clamp(dot(n, v), 0.0, 1.0);
    float fres = uBaseReflect + (1.0 - uBaseReflect) * pow(1.0 - cosT, 4.0);
    vec3 col = mix(uTint, refl, fres);

    // Key light glint on the ripples.
    vec3 h = normalize(normalize(uKeyDir) + v);
    col += uKeyColor * pow(max(dot(n, h), 0.0), 220.0) * 1.6;
    col += refl * clamp(crest * 0.02, 0.0, 0.25);

    float fog = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, uFog, fog);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Ring buffer of ripples, shared so other parts of the scene can make splashes. */
export const ripples = {
  data: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0)),
  next: 0,
  /** Pool clock (seconds); ripple start times are on this clock. */
  now: 0,
  add(x: number, z: number, t: number, strength: number) {
    this.data[this.next].set(x, z, t, strength);
    this.next = (this.next + 1) % MAX_RIPPLES;
  },
};

interface PoolProps {
  tint: string;
  fog: string;
  night: boolean;
  /** Pieces resting in the water: [x, z, radius, strength]. */
  contacts: [number, number, number, number][];
  size?: number;
}

const plane = new THREE.Plane();
const normal = new THREE.Vector3(0, 1, 0);
const reflectorPos = new THREE.Vector3();
const cameraPos = new THREE.Vector3();
const rot = new THREE.Matrix4();
const lookAt = new THREE.Vector3();
const target = new THREE.Vector3();
const view = new THREE.Vector3();
const clip = new THREE.Vector4();
const q = new THREE.Vector4();
const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();
const hit = new THREE.Vector3();
const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const bufferSize = new THREE.Vector2();

/**
 * Mirror-still reflecting pool. A mirrored camera renders the scene above the
 * water into a mipmapped half-res target (oblique near plane clips anything
 * below the surface); the water shader bends it with cursor ripples and
 * contact rings, and fades to the horizon fog.
 */
export function Pool({ tint, fog, night, contacts, size = 260 }: PoolProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const time = useSceneTime();
  const mesh = useRef<THREE.Mesh>(null);
  const clock = useRef(0);
  const last = useRef({ x: 0, z: 0, t: -10, valid: false });

  const target_ = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true });
    rt.texture.generateMipmaps = true;
    rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
    return rt;
  }, []);
  useEffect(() => () => target_.dispose(), [target_]);
  const virtualCam = useMemo(() => new THREE.PerspectiveCamera(), []);
  const textureMatrix = useMemo(() => new THREE.Matrix4(), []);

  const material = useMemo(() => {
    const c = new Array(MAX_CONTACTS).fill(0).map((_, i) => (contacts[i] ? new THREE.Vector4(...contacts[i]) : new THREE.Vector4(0, 0, 0, 0)));
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        tReflect: { value: target_.texture },
        uTextureMatrix: { value: textureMatrix },
        uRipples: { value: ripples.data },
        uContacts: { value: c },
        uTime: { value: 0 },
        uTint: { value: new THREE.Color(tint) },
        uFog: { value: new THREE.Color(fog) },
        uFogNear: { value: 30 },
        uFogFar: { value: 130 },
        uBaseReflect: { value: night ? 0.55 : 0.42 },
        uKeyDir: { value: new THREE.Vector3(0.6, 0.7, 0.4) },
        uKeyColor: { value: new THREE.Color(night ? "#b9c4ff" : "#fff4e8") },
        uNight: { value: night ? 1 : 0 },
      },
    });
  }, [tint, fog, night, contacts, target_, textureMatrix]);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    const d = Math.min(dt, 0.05);
    clock.current += d;
    const now = clock.current;
    ripples.now = now;
    material.uniforms.uTime.value = now;

    // Cursor ripples: project the pointer onto the water, drop a ring every ~35 cm of travel.
    if (pointer.active && time.visible) {
      ndc.set(pointer.nx, pointer.ny);
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(waterPlane, hit) && hit.distanceTo(camera.position) < 60) {
        const l = last.current;
        const moved = Math.hypot(hit.x - l.x, hit.z - l.z);
        if (!l.valid || (moved > 0.35 && now - l.t > 0.06)) {
          if (l.valid) ripples.add(hit.x, hit.z, now, Math.min(1.2, 0.35 + moved * 0.5));
          l.x = hit.x;
          l.z = hit.z;
          l.t = now;
          l.valid = true;
        }
      } else {
        last.current.valid = false;
      }
    }

    if (!time.visible) return;
    // Size the target to half the drawing buffer.
    const size = gl.getDrawingBufferSize(bufferSize);
    const w = Math.max(256, Math.round(size.x * 0.5));
    const h = Math.max(256, Math.round(size.y * 0.5));
    if (target_.width !== w || target_.height !== h) target_.setSize(w, h);

    reflectorPos.setFromMatrixPosition(m.matrixWorld);
    cameraPos.setFromMatrixPosition(camera.matrixWorld);
    view.subVectors(reflectorPos, cameraPos);
    if (view.dot(normal) > 0) return;
    view.reflect(normal).negate().add(reflectorPos);
    rot.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rot).add(cameraPos);
    target.subVectors(reflectorPos, lookAt).reflect(normal).negate().add(reflectorPos);
    virtualCam.position.copy(view);
    virtualCam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    virtualCam.lookAt(target);
    virtualCam.far = camera.far;
    virtualCam.near = camera.near;
    virtualCam.updateMatrixWorld();
    virtualCam.projectionMatrix.copy(camera.projectionMatrix);

    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(virtualCam.projectionMatrix).multiply(virtualCam.matrixWorldInverse).multiply(m.matrixWorld);

    plane.setFromNormalAndCoplanarPoint(normal, reflectorPos).applyMatrix4(virtualCam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = virtualCam.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + pm[8]) / pm[0];
    q.y = (Math.sign(clip.y) + pm[9]) / pm[5];
    q.z = -1;
    q.w = (1 + pm[10]) / pm[14];
    clip.multiplyScalar(2 / clip.dot(q));
    pm[2] = clip.x;
    pm[6] = clip.y;
    pm[10] = clip.z + 1 - 0.003;
    pm[14] = clip.w;
    virtualCam.projectionMatrixInverse.copy(virtualCam.projectionMatrix).invert();

    const prevTarget = gl.getRenderTarget();
    const prevXr = gl.xr.enabled;
    const prevShadow = gl.shadowMap.autoUpdate;
    m.visible = false;
    gl.xr.enabled = false;
    gl.shadowMap.autoUpdate = false;
    gl.setRenderTarget(target_);
    gl.state.buffers.depth.setMask(true);
    if (gl.autoClear === false) gl.clear();
    gl.render(scene, virtualCam);
    gl.xr.enabled = prevXr;
    gl.shadowMap.autoUpdate = prevShadow;
    gl.setRenderTarget(prevTarget);
    m.visible = true;
  });

  return (
    <mesh ref={mesh} material={material} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -30]} frustumCulled={false}>
      <planeGeometry args={[size, size, 1, 1]} />
    </mesh>
  );
}
