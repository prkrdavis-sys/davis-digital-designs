"use client";

import { Suspense, useMemo, useRef, type RefObject } from "react";
import Image from "next/image";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useUi } from "@/lib/store";
import { cn } from "@/lib/utils";

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uMap;
  uniform vec2 uMouse;
  uniform float uTime;
  uniform float uStrength;
  uniform float uPlaneAspect;
  uniform float uImageAspect;

  vec2 coverUv(vec2 uv) {
    // object-fit: cover
    float r = uPlaneAspect / uImageAspect;
    vec2 scale = r > 1.0 ? vec2(1.0, 1.0 / r) : vec2(r, 1.0);
    return (uv - 0.5) * scale + 0.5;
  }

  void main() {
    vec2 uv = vUv;
    vec2 d = (uv - uMouse) * vec2(uPlaneAspect, 1.0);
    float dist = length(d);
    float ripple = sin(dist * 42.0 - uTime * 7.0) * exp(-dist * 7.0);
    vec2 offset = normalize(d + 1e-5) * ripple * 0.035 * uStrength;
    vec2 cuv = coverUv(uv + offset);

    // Chromatic split on the ripple crest for extra shine.
    float split = ripple * 0.006 * uStrength;
    vec4 c;
    c.r = texture2D(uMap, cuv + vec2(split, 0.0)).r;
    c.g = texture2D(uMap, cuv).g;
    c.b = texture2D(uMap, cuv - vec2(split, 0.0)).b;
    c.a = 1.0;

    // Specular highlight riding the wave.
    c.rgb += max(ripple, 0.0) * 0.25 * uStrength;
    gl_FragColor = c;
  }
`;

function RipplePlane({ src, hover }: { src: string; hover: RefObject<boolean> }) {
  const texture = useLoader(THREE.TextureLoader, src);
  const mat = useRef<THREE.ShaderMaterial>(null);
  const size = useThree((s) => s.size);
  const target = useMemo(() => new THREE.Vector2(0.5, 0.5), []);
  const strength = useRef(0);

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;

  const uniforms = useMemo(
    () => ({
      uMap: { value: texture },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uTime: { value: 0 },
      uStrength: { value: 0 },
      uPlaneAspect: { value: 1 },
      uImageAspect: { value: 1 },
    }),
    [texture],
  );

  useFrame((state, dt) => {
    const u = mat.current?.uniforms;
    if (!u) return;
    u.uTime.value += dt;
    u.uPlaneAspect.value = size.width / size.height;
    const img = texture.image as { width?: number; height?: number } | undefined;
    if (img?.width && img?.height) u.uImageAspect.value = img.width / img.height;

    // R3F pointer is -1..1 over the canvas; convert to 0..1 uv space.
    const hovering = hover.current;
    target.set((state.pointer.x + 1) / 2, (state.pointer.y + 1) / 2);
    u.uMouse.value.lerp(target, 0.08);
    strength.current += ((hovering ? 1 : 0) - strength.current) * 0.06;
    u.uStrength.value = strength.current;
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial ref={mat} vertexShader={vertex} fragmentShader={fragment} uniforms={uniforms} toneMapped={false} />
    </mesh>
  );
}

interface Props {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}

/**
 * An image with a water-ripple that follows the cursor. Renders a plain
 * <Image> for touch/reduced motion so nothing is lost on phones.
 */
export function RippleImage({ src, alt, className, priority }: Props) {
  const isTouch = useUi((s) => s.isTouch);
  const reducedMotion = useUi((s) => s.reducedMotion);
  const live = !isTouch && !reducedMotion;
  const hover = useRef(false);

  return (
    <div
      className={cn("relative overflow-hidden", className)}
      data-cursor="hidden"
      onPointerEnter={() => (hover.current = true)}
      onPointerLeave={() => (hover.current = false)}
    >
      <Image src={src} alt={alt} fill priority={priority} sizes="100vw" className={cn("object-cover", live && "opacity-0")} />
      {live && (
        <Canvas
          className="absolute inset-0"
          dpr={[1, 1.5]}
          orthographic
          gl={{ antialias: false, alpha: true, powerPreference: "low-power" }}
          camera={{ position: [0, 0, 1], zoom: 1 }}
          frameloop="always"
        >
          <Suspense fallback={null}>
            <RipplePlane src={src} hover={hover} />
          </Suspense>
        </Canvas>
      )}
    </div>
  );
}
