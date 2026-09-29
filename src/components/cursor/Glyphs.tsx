"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { cursor, resolveAdditive, toWorldX, toWorldY, useCursorClick, useThemeWeight, type Additive } from "@/components/cursor/core";
import { useVariant } from "@/lib/store";
import { sprite, type SpriteKind } from "@/components/cursor/sprites";

interface SpriteGlyphProps {
  kind: SpriteKind;
  size: number;
  color: string;
  rotate?: "velocity" | "spin" | "none";
  spinSpeed?: number;
  additive?: Additive;
  /** Color used in night mode (defaults to `color`). */
  nightColor?: string;
  /** Extra scale over links. */
  hoverScale?: number;
  /** Stretch along the direction of travel. */
  squash?: number;
  opacity?: number;
  /** Offset from the pointer, px. */
  offset?: [number, number];
  /** Initial rotation, radians (sprites drawn pointing up). */
  baseRotation?: number;
  /** Dark halo behind the glyph so light glyphs read on light pages. */
  outline?: string;
}

/** A textured sprite that sits on the pointer. */
export function SpriteGlyph({ kind, size, color, nightColor, rotate = "none", spinSpeed = 1, additive, hoverScale = 1.6, squash = 0, opacity = 1, offset, baseRotation = 0, outline }: SpriteGlyphProps) {
  const weight = useThemeWeight();
  const night = useVariant() === "night";
  const add = resolveAdditive(additive, night);
  const tint = night && nightColor ? nightColor : color;
  const mesh = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  // The dark halo only helps on light pages.
  const haloMat = useMemo(
    () => (outline && !night ? new THREE.MeshBasicMaterial({ map: sprite(kind, 256), color: new THREE.Color(outline), transparent: true, depthTest: false, depthWrite: false }) : null),
    [kind, outline, night],
  );
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: sprite(kind, 256),
        color: new THREE.Color(tint),
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [kind, tint, add],
  );
  const angle = useRef(baseRotation);
  const pulse = useRef(0);
  useCursorClick(() => (pulse.current = 1));

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    const d = Math.min(dt, 0.05);
    pulse.current = Math.max(0, pulse.current - d * 3.5);
    m.position.set(toWorldX(cursor.x + (offset?.[0] ?? 0)), toWorldY(cursor.y + (offset?.[1] ?? 0)), 1);
    if (rotate === "velocity" && cursor.speed > 40) {
      const target = Math.atan2(-cursor.vy, cursor.vx) - Math.PI / 2 + baseRotation;
      let diff = target - angle.current;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      angle.current += diff * (1 - Math.exp(-d * 10));
    } else if (rotate === "spin") {
      angle.current += d * spinSpeed;
    }
    m.rotation.z = angle.current;
    const s = size * (1 + (hoverScale - 1) * cursor.hover) * (1 + pulse.current * 0.35) * (cursor.labelled ? 0.4 : 1);
    const st = Math.min(cursor.speed / 1500, 1) * squash;
    m.scale.set(s * (1 - st * 0.3), s * (1 + st), 1);
    mat.opacity = opacity * weight.current * cursor.presence;
    const h = halo.current;
    if (h && haloMat) {
      h.position.copy(m.position);
      h.position.z = 0.5;
      h.rotation.z = m.rotation.z;
      h.scale.set(m.scale.x * 1.12, m.scale.y * 1.12, 1);
      haloMat.opacity = 0.55 * mat.opacity;
    }
  });

  return (
    <>
      {haloMat && (
        <mesh ref={halo} material={haloMat} renderOrder={4} frustumCulled={false}>
          <planeGeometry args={[1, 1]} />
        </mesh>
      )}
      <mesh ref={mesh} material={mat} renderOrder={5} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </>
  );
}

const envCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

function roomEnv(gl: THREE.WebGLRenderer): THREE.Texture {
  let tex = envCache.get(gl);
  if (!tex) {
    const pmrem = new THREE.PMREMGenerator(gl);
    tex = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    pmrem.dispose();
    envCache.set(gl, tex);
  }
  return tex;
}

/** Procedural studio reflections for chrome glyphs (no HDR download). */
function useRoomEnv(): THREE.Texture {
  const gl = useThree((s) => s.gl);
  return useMemo(() => roomEnv(gl), [gl]);
}

/** A mirror-polished ball on the pointer (pinball, liquid chrome head). */
export function ChromeBall({ radius, tint = "#ffffff", squash = 0.5, roughness = 0.05 }: { radius: number; tint?: string; squash?: number; roughness?: number }) {
  const weight = useThemeWeight();
  const env = useRoomEnv();
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: tint, metalness: 1, roughness, envMap: env, envMapIntensity: 1.3, transparent: true, depthTest: false }), [tint, roughness, env]);
  const roll = useRef(new THREE.Quaternion());
  const axis = useMemo(() => new THREE.Vector3(), []);
  const step = useMemo(() => new THREE.Quaternion(), []);
  const look = useMemo(() => new THREE.Quaternion(), []);
  const pulse = useRef(0);
  useCursorClick(() => (pulse.current = 1));

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    const d = Math.min(dt, 0.05);
    pulse.current = Math.max(0, pulse.current - d * 4);
    m.position.set(toWorldX(cursor.x), toWorldY(cursor.y), 10);
    // Roll like a real ball: rotate about the axis perpendicular to travel.
    const dist = cursor.moved;
    if (dist > 0.01) {
      axis.set(-cursor.vy, -cursor.vx, 0).normalize();
      step.setFromAxisAngle(axis, dist / radius);
      roll.current.premultiply(step);
    }
    const st = Math.min(cursor.speed / 1800, 1) * squash;
    const ang = Math.atan2(-cursor.vy, cursor.vx);
    look.setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang);
    m.quaternion.copy(look).multiply(roll.current);
    const s = radius * (1 + cursor.hover * 0.5) * (1 + pulse.current * 0.3) * (cursor.labelled ? 0.45 : 1);
    m.scale.setScalar(s);
    m.scale.x *= 1 + st;
    m.scale.y *= 1 - st * 0.35;
    mat.opacity = weight.current * cursor.presence;
  });

  return (
    <mesh ref={mesh} material={mat} renderOrder={6} frustumCulled={false}>
      <sphereGeometry args={[1, 48, 32]} />
    </mesh>
  );
}

const metaVertex = /* glsl */ `
  void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const metaFragment = /* glsl */ `
  #define N 28
  uniform vec3 uBlobs[N];
  uniform int uCount;
  uniform vec2 uRes;
  uniform float uDpr;
  uniform float uOpacity;
  uniform float uTime;
  uniform vec3 uTintA;
  uniform vec3 uTintB;
  vec3 env(vec3 n) {
    float y = n.y;
    vec3 sky = mix(vec3(0.92, 0.94, 1.0), vec3(0.55, 0.6, 0.75), clamp(y * 0.5 + 0.5, 0.0, 1.0));
    vec3 ground = vec3(0.12, 0.12, 0.16);
    vec3 c = mix(ground, sky, smoothstep(-0.15, 0.1, y));
    c += smoothstep(0.92, 0.99, n.y * 0.6 + n.x * 0.5) * 2.2;
    c += smoothstep(0.96, 1.0, -n.x * 0.8 + n.y * 0.3) * 1.2;
    return c;
  }
  void main() {
    vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
    float f = 0.0;
    vec2 g = vec2(0.0);
    for (int i = 0; i < N; i++) {
      if (i >= uCount) break;
      vec3 b = uBlobs[i];
      vec2 d = p - b.xy;
      float d2 = dot(d, d) + 1.0;
      float r2 = b.z * b.z;
      f += r2 / d2;
      g += -2.0 * r2 * d / (d2 * d2);
    }
    float aa = fwidth(f);
    float inside = smoothstep(1.0 - aa, 1.0 + aa, f);
    if (inside < 0.002) discard;
    vec3 n = normalize(vec3(-g.x * 6.0, g.y * 6.0, 1.0));
    vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
    vec3 col = env(r);
    float film = 0.5 + 0.5 * cos(6.2831 * (n.z * 1.6 + uTime * 0.05) + vec3(0.0, 2.1, 4.2)).x;
    col *= mix(uTintA, uTintB, film);
    float fres = pow(1.0 - n.z, 3.0);
    col = mix(col, vec3(1.0), fres * 0.25);
    gl_FragColor = vec4(col, inside * uOpacity);
  }
`;

/** Liquid chrome: a metaball stream that drips off the pointer and merges back. */
export function MetaballTrail({ tintA = "#ffffff", tintB = "#ffd6ec" }: { tintA?: string; tintB?: string }) {
  const weight = useThemeWeight();
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const N = 28;
  const blobs = useMemo(() => Array.from({ length: N }, () => ({ x: -999, y: -999, r: 0, vx: 0, vy: 0, age: 1e9, life: 1 })), []);
  const next = useRef(1);
  const last = useRef({ x: -999, y: -999 });
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: metaVertex,
        fragmentShader: metaFragment,
        uniforms: {
          uBlobs: { value: Array.from({ length: N }, () => new THREE.Vector3()) },
          uCount: { value: 0 },
          uRes: { value: new THREE.Vector2() },
          uDpr: { value: 1 },
          uOpacity: { value: 1 },
          uTime: { value: 0 },
          uTintA: { value: new THREE.Color(tintA) },
          uTintB: { value: new THREE.Color(tintB) },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [tintA, tintB],
  );

  const spawn = (x: number, y: number, r: number, vx: number, vy: number, life: number) => {
    const b = blobs[next.current];
    next.current = next.current + 1 >= N ? 1 : next.current + 1;
    Object.assign(b, { x, y, r, vx, vy, age: 0, life });
  };

  useCursorClick((x, y) => {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const sp = 180 + Math.random() * 160;
      spawn(x, y, 5 + Math.random() * 4, Math.cos(a) * sp, Math.sin(a) * sp, 0.7 + Math.random() * 0.4);
    }
  });

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    const u = mat.uniforms;
    u.uTime.value += d;
    u.uRes.value.set(size.width * gl.getPixelRatio(), size.height * gl.getPixelRatio());
    u.uDpr.value = gl.getPixelRatio();
    u.uOpacity.value = weight.current * cursor.presence;
    const head = blobs[0];
    head.x = cursor.x;
    head.y = cursor.y;
    head.r = 12 * (1 + cursor.hover * 0.6) * (cursor.labelled ? 0.4 : 1);
    head.age = 0;
    head.life = 1e9;
    if (Math.hypot(cursor.x - last.current.x, cursor.y - last.current.y) > 12) {
      spawn(cursor.x, cursor.y, 7 + Math.min(cursor.speed / 300, 4), cursor.vx * 0.05, cursor.vy * 0.05 + 20, 0.55 + Math.random() * 0.35);
      last.current = { x: cursor.x, y: cursor.y };
    }
    let count = 0;
    for (let i = 0; i < N; i++) {
      const b = blobs[i];
      if (i > 0) {
        b.age += d;
        b.vy += 260 * d;
        b.vx *= Math.exp(-d * 2);
        b.x += b.vx * d;
        b.y += b.vy * d;
      }
      const k = i === 0 ? 0 : b.age / b.life;
      if (k >= 1) continue;
      const r = b.r * (1 - k * k);
      (u.uBlobs.value as THREE.Vector3[])[count++].set(b.x, b.y, r);
    }
    u.uCount.value = count;
  });

  return (
    <mesh material={mat} renderOrder={4} frustumCulled={false}>
      <planeGeometry args={[size.width, size.height]} />
    </mesh>
  );
}

const loupeFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uPulse;
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0) discard;
    // Barrel distortion and a little chromatic fringe toward the rim.
    float k = 1.0 - 0.28 * r * r - uPulse * 0.1;
    vec2 uv = 0.5 + c * k;
    float fr = 0.012 * r * r;
    vec3 col = vec3(texture2D(uMap, uv + c * fr).r, texture2D(uMap, uv).g, texture2D(uMap, uv - c * fr).b);
    float rim = smoothstep(0.86, 0.9, r) * (1.0 - smoothstep(0.97, 1.0, r));
    vec3 brass = mix(vec3(0.55, 0.42, 0.22), vec3(1.0, 0.9, 0.62), 0.5 + 0.5 * sin(atan(c.y, c.x) * 3.0 + 1.2));
    col = mix(col, brass, rim);
    col += pow(max(0.0, 1.0 - length(c - vec2(-0.18, 0.2)) * 4.0), 3.0) * 0.35;
    float edge = 1.0 - smoothstep(0.985, 1.0, r);
    gl_FragColor = vec4(col, edge * uOpacity);
  }
`;

/** Magnifying loupe: shows a zoomed crop of the live 3D world under the pointer. */
export function Loupe({ radius = 70, zoom = 2.2 }: { radius?: number; zoom?: number }) {
  const weight = useThemeWeight();
  const mesh = useRef<THREE.Mesh>(null);
  const crop = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    return c;
  }, []);
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(crop);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [crop]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: loupeFragment,
        uniforms: { uMap: { value: tex }, uOpacity: { value: 1 }, uPulse: { value: 0 } },
        transparent: true,
        depthTest: false,
      }),
    [tex],
  );
  const source = useRef<HTMLCanvasElement | null>(null);
  const pulse = useRef(0);
  const ctx2d = useMemo(() => crop.getContext("2d"), [crop]);
  useCursorClick(() => (pulse.current = 1));
  useEffect(() => () => tex.dispose(), [tex]);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m || !ctx2d) return;
    pulse.current = Math.max(0, pulse.current - dt * 3);
    const w = weight.current * cursor.presence;
    mat.uniforms.uOpacity.value = w;
    mat.uniforms.uPulse.value = pulse.current;
    const r = radius * (1 + cursor.hover * 0.25) * (cursor.labelled ? 0.5 : 1);
    m.position.set(toWorldX(cursor.x), toWorldY(cursor.y), 2);
    m.scale.setScalar(r * 2);
    if (w < 0.01) return;
    source.current ??= document.querySelector<HTMLCanvasElement>("canvas[data-engine]");
    const src = source.current;
    if (!src) return;
    const sx = src.width / Math.max(1, src.clientWidth);
    const half = (r / (zoom * (1 + pulse.current * 0.4))) * sx;
    ctx2d.drawImage(src, cursor.x * sx - half, cursor.y * sx - half, half * 2, half * 2, 0, 0, 256, 256);
    tex.needsUpdate = true;
  });

  return (
    <mesh ref={mesh} material={mat} renderOrder={7} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}

function textTexture(text: string, color: string) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.font = "900 64px 'Bricolage Grotesque', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(20,10,40,0.85)";
  ctx.strokeText(text, 128, 64);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillText(text, 128, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Arcade score pops ("+100") that float up from each click. */
export function ScorePops({ values = ["+100", "+250", "+500", "+1000"], colors = ["#ffe066", "#ff5c9d", "#3edcff"] }: { values?: string[]; colors?: string[] }) {
  const weight = useThemeWeight();
  const textures = useMemo(() => values.flatMap((v) => colors.map((c) => textTexture(v, c))), [values, colors]);
  const pool = useMemo(() => Array.from({ length: 8 }, () => ({ mesh: null as THREE.Mesh | null, age: 1e9, x: 0, y: 0 })), []);
  const next = useRef(0);
  useCursorClick((x, y) => {
    const p = pool[next.current];
    next.current = (next.current + 1) % pool.length;
    p.age = 0;
    p.x = x + 18;
    p.y = y - 16;
    if (p.mesh) (p.mesh.material as THREE.MeshBasicMaterial).map = textures[Math.floor(Math.random() * textures.length)];
  });
  useFrame((_, dt) => {
    for (const p of pool) {
      if (!p.mesh) continue;
      p.age += Math.min(dt, 0.05);
      const k = p.age / 0.9;
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      if (k >= 1) {
        mat.opacity = 0;
        continue;
      }
      p.mesh.position.set(toWorldX(p.x), toWorldY(p.y - k * 60), 3);
      const s = 1 + Math.sin(Math.min(k * 6, Math.PI)) * 0.4;
      p.mesh.scale.set(96 * s, 48 * s, 1);
      mat.opacity = (1 - k * k) * weight.current;
    }
  });
  return (
    <>
      {pool.map((p, i) => (
        <mesh
          key={i}
          ref={(m) => {
            p.mesh = m;
          }}
          renderOrder={8}
          frustumCulled={false}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={textures[0]} transparent opacity={0} depthTest={false} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}
