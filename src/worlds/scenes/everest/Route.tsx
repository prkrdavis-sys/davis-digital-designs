"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import { useSceneTime } from "@/components/three/engine/slot";
import { drawAt, groundY, routePoint, type EverestData, type RouteData } from "@/worlds/scenes/everest/data";
import { LOOKS } from "@/worlds/scenes/everest/look";

export const FONTS = {
  label: "/worlds/everest/fonts/Geist-SemiBold.ttf",
  mono: "/worlds/everest/fonts/GeistMono-Medium.ttf",
};

const SEGMENTS = 7;

/** Tube skeleton: every ring vertex stores its centre, ring direction and route distance. */
function tubeGeometry(route: RouteData): THREE.BufferGeometry {
  const pts = route.points;
  const n = pts.length;
  const center = new Float32Array(n * SEGMENTS * 3);
  const dir = new Float32Array(n * SEGMENTS * 3);
  const dist = new Float32Array(n * SEGMENTS);
  const t = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    t.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    side.crossVectors(t, Y);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    up.crossVectors(side, t).normalize();
    for (let k = 0; k < SEGMENTS; k++) {
      const ang = (k / SEGMENTS) * Math.PI * 2;
      const j = (i * SEGMENTS + k) * 3;
      center.set(pts[i], j);
      dir[j] = side.x * Math.cos(ang) + up.x * Math.sin(ang);
      dir[j + 1] = side.y * Math.cos(ang) + up.y * Math.sin(ang);
      dir[j + 2] = side.z * Math.cos(ang) + up.z * Math.sin(ang);
      dist[i * SEGMENTS + k] = route.dist[i];
    }
  }
  const index: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < SEGMENTS; k++) {
      const a = i * SEGMENTS + k;
      const b = i * SEGMENTS + ((k + 1) % SEGMENTS);
      const c = a + SEGMENTS;
      const d = b + SEGMENTS;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(center, 3));
  g.setAttribute("aDir", new THREE.BufferAttribute(dir, 3));
  g.setAttribute("aDist", new THREE.BufferAttribute(dist, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

const tubeVertex = /* glsl */ `
  attribute vec3 aDir;
  attribute float aDist;
  uniform float uRadius;
  varying float vDist;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vec4 c = modelMatrix * vec4(position, 1.0);
    float vd = length(cameraPosition - c.xyz);
    // Constant-ish screen width: a few pixels wide from any altitude.
    float r = uRadius * clamp(vd * 0.0024, 0.045, 1.6);
    vec3 p = c.xyz + aDir * r + vec3(0.0, r * 0.8, 0.0);
    vDist = aDist;
    vN = aDir;
    vView = cameraPosition - p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const goldFragment = /* glsl */ `
  uniform float uDraw;
  uniform float uTime;
  uniform vec3 uGold;
  uniform vec3 uHot;
  uniform float uGlow;
  varying float vDist;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    if (vDist > uDraw) discard;
    float behind = uDraw - vDist;
    float facing = clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0);
    // Energy running up the line toward the head.
    float pulse = pow(0.5 + 0.5 * sin((vDist - uTime * 6.0) * 0.55), 6.0);
    vec3 col = uGold * (0.9 + 0.8 * facing) * uGlow;
    col += uGold * pulse * 0.9 * uGlow;
    col += uHot * exp(-behind * 0.22) * 3.5;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const ghostFragment = /* glsl */ `
  uniform float uDraw;
  uniform vec3 uGhost;
  uniform float uOpacity;
  varying float vDist;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    if (vDist < uDraw) discard;
    float dash = step(0.45, fract(vDist * 0.22));
    float ahead = smoothstep(0.0, 6.0, vDist - uDraw);
    gl_FragColor = vec4(uGhost, uOpacity * dash * ahead);
  }
`;

const glowVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const glowFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float core = exp(-r * r * 22.0);
    float halo = exp(-r * r * 3.5) * 0.35;
    float a = (core * 3.0 + halo) * smoothstep(1.0, 0.8, r);
    gl_FragColor = vec4(uColor * a * uIntensity, a);
  }
`;

const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float x = abs(vUv.x - 0.5) * 2.0;
    float a = exp(-x * x * 9.0) * pow(1.0 - vUv.y, 1.6);
    gl_FragColor = vec4(uColor * a * uIntensity, a);
  }
`;

const ringFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uPhase;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float ring = exp(-pow((r - uPhase) * 14.0, 2.0)) * (1.0 - uPhase);
    float disc = exp(-r * r * 10.0) * 0.35;
    float a = ring + disc;
    gl_FragColor = vec4(uColor * a * 2.5, a);
  }
`;

function additive(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({ vertexShader: glowVertex, fragmentShader, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
}

export function RouteLine({ data, variant }: { data: EverestData; variant: Variant }) {
  const { route } = data;
  const look = LOOKS[variant];
  const time = useSceneTime();
  const geometry = useMemo(() => tubeGeometry(route), [route]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const gold = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: tubeVertex,
        fragmentShader: goldFragment,
        uniforms: {
          uRadius: { value: 1 },
          uDraw: { value: 0 },
          uTime: { value: 0 },
          uGold: { value: new THREE.Color(look.gold) },
          uHot: { value: new THREE.Color(look.goldHot) },
          uGlow: { value: variant === "night" ? 2.4 : 1.9 },
        },
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -8,
      }),
    [look, variant],
  );
  const ghost = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: tubeVertex,
        fragmentShader: ghostFragment,
        uniforms: {
          uRadius: { value: 0.55 },
          uDraw: { value: 0 },
          uGhost: { value: new THREE.Color(variant === "night" ? "#cfe0ff" : "#ffffff") },
          uOpacity: { value: variant === "night" ? 0.35 : 0.55 },
        },
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -8,
      }),
    [variant],
  );
  const headGlow = useMemo(() => additive(glowFragment, { uColor: { value: new THREE.Color(look.goldHot) }, uIntensity: { value: 3.2 } }), [look]);
  const beam = useMemo(() => additive(beamFragment, { uColor: { value: new THREE.Color(look.gold) }, uIntensity: { value: variant === "night" ? 2.2 : 1.6 } }), [look, variant]);
  const ring = useMemo(() => additive(ringFragment, { uColor: { value: new THREE.Color(look.gold) }, uPhase: { value: 0 } }), [look]);
  useEffect(
    () => () => {
      for (const m of [gold, ghost, headGlow, beam, ring]) m.dispose();
    },
    [gold, ghost, headGlow, beam, ring],
  );

  const head = useRef<THREE.Group>(null);
  const glowMesh = useRef<THREE.Mesh>(null);
  const beamMesh = useRef<THREE.Mesh>(null);
  const ringMesh = useRef<THREE.Mesh>(null);
  const p = useMemo<[number, number, number]>(() => [0, 0, 0], []);
  const clock = useRef(0);

  useFrame((state, dt) => {
    clock.current += Math.min(dt, 0.05);
    const d = drawAt(route, time.s);
    gold.uniforms.uDraw.value = d;
    gold.uniforms.uTime.value = clock.current;
    ghost.uniforms.uDraw.value = d;
    const g = head.current;
    if (!g) return;
    const on = d > 0.05 && d < route.length - 0.05;
    const done = d >= route.length - 0.05;
    g.visible = d > 0.05;
    routePoint(route, d, p);
    g.position.set(p[0], p[1], p[2]);
    const cam = state.camera;
    const vd = cam.position.distanceTo(g.position);
    const k = THREE.MathUtils.clamp(vd * 0.0024, 0.045, 1.6);
    if (glowMesh.current) {
      glowMesh.current.quaternion.copy(cam.quaternion);
      glowMesh.current.scale.setScalar(k * (done ? 12 : 9) * (1 + 0.08 * Math.sin(clock.current * 4)));
      glowMesh.current.position.set(0, k * 0.8, 0);
    }
    if (beamMesh.current) {
      // Cylindrical billboard: face the camera around the vertical axis.
      const yaw = Math.atan2(cam.position.x - p[0], cam.position.z - p[2]);
      beamMesh.current.rotation.set(0, yaw, 0);
      beamMesh.current.scale.set(k * 3.2, k * 60, 1);
      beamMesh.current.position.set(0, k * 30, 0);
      beamMesh.current.visible = on || done;
    }
    if (ringMesh.current) {
      const phase = (clock.current * 0.6) % 1;
      ring.uniforms.uPhase.value = phase;
      ringMesh.current.scale.setScalar(k * 28);
      ringMesh.current.position.set(0, groundY(data, p[0], p[2]) - p[1] + 0.05, 0);
    }
  });

  return (
    <>
      <mesh geometry={geometry} material={ghost} frustumCulled={false} renderOrder={2} />
      <mesh geometry={geometry} material={gold} frustumCulled={false} renderOrder={3} />
      <group ref={head} visible={false}>
        <mesh ref={ringMesh} material={ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
          <planeGeometry args={[1, 1]} />
        </mesh>
        <mesh ref={beamMesh} material={beam} renderOrder={5}>
          <planeGeometry args={[1, 1]} />
        </mesh>
        <mesh ref={glowMesh} material={headGlow} renderOrder={6}>
          <planeGeometry args={[1, 1]} />
        </mesh>
      </group>
    </>
  );
}

// --------------------------------------------------------------------------
interface LabelSpec {
  key: string;
  title: string;
  sub: string;
  pos: [number, number, number];
  /** Route distance at which the label appears (-1 = always). */
  at: number;
  kind: "stop" | "peak";
}

const fmt = (m: number) => `${Math.round(m).toLocaleString("en-US")} m`;

const cardVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Rounded plate with a hairline border, sized in label units through uSize. */
const cardFragment = /* glsl */ `
  uniform vec2 uSize;
  uniform vec3 uColor;
  uniform vec3 uBorder;
  uniform float uOpacity;
  varying vec2 vUv;
  float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  void main() {
    vec2 p = (vUv - 0.5) * uSize;
    float d = sdRoundRect(p, uSize * 0.5, 0.32);
    float fw = max(fwidth(d), 1e-4);
    float fill = 1.0 - smoothstep(-fw, fw, d);
    float line = 1.0 - smoothstep(0.0, fw * 1.5, abs(d + 0.05));
    vec3 col = mix(uColor, uBorder, line * 0.85);
    gl_FragColor = vec4(col, max(fill * uOpacity, line * uOpacity * 1.3));
  }
`;

type TextMesh = THREE.Mesh & { fillOpacity: number; outlineOpacity: number; textRenderInfo?: { blockBounds: number[] } | null };

const PAD_X = 0.5;
const PAD_Y = 0.32;
const GAP = 0.14;
const TITLE_SIZE = { stop: 0.78, peak: 0.86 };
const SUB_SIZE = 0.58;

const projected = new THREE.Vector3();

function Label({ spec, data, variant }: { spec: LabelSpec; data: EverestData; variant: Variant }) {
  const look = LOOKS[variant];
  const time = useSceneTime();
  const peak = spec.kind === "peak";
  const group = useRef<THREE.Group>(null);
  const stem = useRef<THREE.Mesh>(null);
  const dot = useRef<THREE.Mesh>(null);
  const card = useRef<THREE.Mesh>(null);
  const title = useRef<TextMesh>(null);
  const sub = useRef<TextMesh>(null);
  const width = useRef({ title: spec.title.length * 0.62 * TITLE_SIZE[spec.kind], sub: spec.sub.length * 0.6 * SUB_SIZE });
  const accent = peak ? look.label : look.gold;
  const stemMat = useMemo(() => new THREE.MeshBasicMaterial({ color: accent, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }), [accent]);
  const cardMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: cardVertex,
        fragmentShader: cardFragment,
        uniforms: {
          uSize: { value: new THREE.Vector2(4, 2) },
          uColor: { value: new THREE.Color(look.card) },
          uBorder: { value: new THREE.Color(accent) },
          uOpacity: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    [look, accent],
  );
  useEffect(
    () => () => {
      stemMat.dispose();
      cardMat.dispose();
    },
    [stemMat, cardMat],
  );
  const fade = useRef(0);
  const cardH = PAD_Y * 2 + SUB_SIZE + GAP + TITLE_SIZE[spec.kind] * 0.9;

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const cam = state.camera;
    const [x, y, z] = spec.pos;
    const vd = Math.hypot(cam.position.x - x, cam.position.y - y, cam.position.z - z);
    const reached = spec.at < 0 || drawAt(data.route, time.s) >= spec.at - 0.5;
    const near = peak ? 1 - THREE.MathUtils.smoothstep(vd, 380, 560) : 1 - THREE.MathUtils.smoothstep(vd, 200, 320);
    // Stay clear of the page's text column on wide screens.
    projected.set(x, y, z).project(cam);
    const wide = state.size.width > state.size.height * 1.1;
    const side = wide ? THREE.MathUtils.smoothstep(projected.x, -0.42, -0.18) : 1;
    const onScreen = projected.z < 1 && Math.abs(projected.x) < 1.15 && Math.abs(projected.y) < 1.15 ? 1 : 0;
    const want = reached ? near * side * onScreen : 0;
    fade.current += (want - fade.current) * (1 - Math.exp(-Math.min(dt, 0.1) * 5));
    const a = fade.current;
    g.visible = a > 0.01;
    if (!g.visible) return;
    const k = vd * 0.0125;
    const lift = k * (peak ? 2.6 : 4.2) * (0.7 + 0.3 * a);
    g.position.set(x, y + lift, z);
    g.scale.setScalar(k);
    const w = Math.max(width.current.title, width.current.sub) + PAD_X * 2;
    if (card.current) {
      card.current.scale.set(w, cardH, 1);
      card.current.position.set(0, cardH / 2, 0);
      cardMat.uniforms.uSize.value.set(w, cardH);
      cardMat.uniforms.uOpacity.value = a * look.cardOpacity;
    }
    if (stem.current) {
      stem.current.scale.set(0.06, lift / k, 1);
      stem.current.position.set(0, -lift / k / 2, 0);
    }
    if (dot.current) dot.current.position.set(0, -lift / k, 0);
    stemMat.opacity = a * 0.85;
    if (title.current) {
      title.current.fillOpacity = a;
      title.current.outlineOpacity = 0;
    }
    if (sub.current) {
      sub.current.fillOpacity = a * 0.95;
      sub.current.outlineOpacity = 0;
    }
  });

  const measure = (key: "title" | "sub") => (t: TextMesh) => {
    const b = t.textRenderInfo?.blockBounds;
    if (b) width.current[key] = b[2] - b[0];
  };

  return (
    <group ref={group} visible={false}>
      <Billboard>
        <mesh ref={stem} material={stemMat} renderOrder={20}>
          <planeGeometry args={[1, 1]} />
        </mesh>
        <mesh ref={dot} material={stemMat} renderOrder={20}>
          <circleGeometry args={[0.2, 20]} />
        </mesh>
        <mesh ref={card} material={cardMat} renderOrder={21}>
          <planeGeometry args={[1, 1]} />
        </mesh>
        <Text
          ref={title}
          font={FONTS.label}
          fontSize={TITLE_SIZE[spec.kind]}
          letterSpacing={0.1}
          anchorX="center"
          anchorY="bottom"
          position={[0, PAD_Y + SUB_SIZE + GAP, 0]}
          color={peak ? look.label : look.goldHot}
          renderOrder={22}
          onSync={measure("title")}
          material-depthTest={false}
          material-toneMapped={false}
        >
          {spec.title.toUpperCase()}
        </Text>
        <Text
          ref={sub}
          font={FONTS.mono}
          fontSize={SUB_SIZE}
          letterSpacing={0.04}
          anchorX="center"
          anchorY="bottom"
          position={[0, PAD_Y, 0]}
          color={look.labelMuted}
          renderOrder={22}
          onSync={measure("sub")}
          material-depthTest={false}
          material-toneMapped={false}
        >
          {spec.sub}
        </Text>
      </Billboard>
    </group>
  );
}

const PEAK_LABELS = ["Everest", "Lhotse", "Nuptse", "Ama Dablam", "Pumori"];

export function Labels({ data, variant }: { data: EverestData; variant: Variant }) {
  const specs = useMemo<LabelSpec[]>(() => {
    const stops: LabelSpec[] = data.route.waypoints
      .filter((w) => w.label && w.name !== "Summit")
      .map((w) => ({ key: w.name, title: w.name, sub: fmt(w.elev), pos: w.pos, at: w.dist, kind: "stop" }));
    const peaks: LabelSpec[] = PEAK_LABELS.filter((n) => data.meta.peaks[n]).map((n) => {
      const p = data.meta.peaks[n];
      return { key: `peak-${n}`, title: n === "Everest" ? "Mt. Everest" : n, sub: fmt(p.ref), pos: p.local, at: -1, kind: "peak" };
    });
    return [...stops, ...peaks];
  }, [data]);
  return (
    <>
      {specs.map((s) => (
        <Label key={s.key} spec={s} data={data} variant={variant} />
      ))}
    </>
  );
}
