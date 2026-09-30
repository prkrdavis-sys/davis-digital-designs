"use client";

import { createContext, Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CopyPass, EffectComposer, EffectPass, RenderPass, type Effect } from "postprocessing";
import type { Quality, SceneId } from "@/worlds/types";
import { engine } from "@/components/three/engine/state";
import type { ToneMap } from "@/components/three/engine/compositor";

/** Per-frame values the director writes for each mounted scene. */
export interface SlotTime {
  /** Scene-local chapter time (0 = start of this scene's first chapter). */
  s: number;
  /** Damped d(s)/dt. */
  velocity: number;
  /** 0..1 how much of the final frame this scene occupies. */
  weight: number;
  /** True while the scene is being rendered this frame. */
  visible: boolean;
}

export interface Look {
  exposure: number;
  tone: ToneMap;
  /** Color used for transition seams and the loading fallback. */
  seam: string;
  /** Film grain strength in the compositor. */
  grain: number;
  /** Vignette strength in the compositor. */
  vignette: number;
}

export interface SlotHandle {
  id: SceneId;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  time: SlotTime;
  look: Look;
  ready: boolean;
  /** Renders the scene (with its effects) and returns the HDR result. */
  render: (gl: THREE.WebGLRenderer, size: { width: number; height: number }, buffer: THREE.Vector2) => THREE.Texture;
  /** Frees GPU buffers after the scene has been off screen for a while. */
  release: () => void;
  setEffects: (effects: Effect[] | null) => void;
  dispose: () => void;
}

const SlotContext = createContext<SlotHandle | null>(null);

/**
 * Mipmapped bloom builds a pyramid of half-float targets. On this GPU that
 * pyramid's texture makes the effect pass write black, while the Kawase blur
 * the same effect uses otherwise keeps the picture. Point the bloom at Kawase.
 */
function useKawaseBloom(effects: Effect[]) {
  for (const effect of effects) {
    const bloom = effect as Effect & {
      mipmapBlurPass?: { enabled: boolean };
      renderTarget?: THREE.WebGLRenderTarget;
      uniforms?: Map<string, { value: unknown }>;
    };
    if (!bloom.mipmapBlurPass || !bloom.renderTarget) continue;
    bloom.mipmapBlurPass.enabled = false;
    const map = bloom.uniforms?.get("map");
    if (map) map.value = bloom.renderTarget.texture;
  }
}

export function useSlot(): SlotHandle {
  const h = useContext(SlotContext);
  if (!h) throw new Error("useSlot must be used inside a scene");
  return h;
}

/** Mutable time object for the current scene. Read it inside useFrame. */
export function useSceneTime(): SlotTime {
  return useSlot().time;
}

/** Declare the scene's exposure, tone mapping operator and seam color. */
export function useLook(look: Partial<Look>) {
  const slot = useSlot();
  const { exposure, tone, seam, grain, vignette } = look;
  useLayoutEffect(() => {
    if (exposure !== undefined) slot.look.exposure = exposure;
    if (tone !== undefined) slot.look.tone = tone;
    if (seam !== undefined) slot.look.seam = seam;
    if (grain !== undefined) slot.look.grain = grain;
    if (vignette !== undefined) slot.look.vignette = vignette;
  }, [slot, exposure, tone, seam, grain, vignette]);
}

/**
 * Post-processing for this scene (postprocessing library effects). Effects run
 * in HDR before the compositor tone-maps, so bloom and DOF behave physically.
 */
export function usePostFX(factory: (ctx: { camera: THREE.PerspectiveCamera; scene: THREE.Scene }) => Effect[] | null, deps: unknown[]) {
  const slot = useSlot();
  useEffect(() => {
    const effects = factory({ camera: slot.camera, scene: slot.scene });
    slot.setEffects(effects);
    return () => {
      slot.setEffects(null);
      effects?.forEach((e) => e.dispose());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, ...deps]);
}

function createHandle(id: SceneId, quality: Quality): SlotHandle {
  const scene = new THREE.Scene();
  scene.name = id;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 4000);
  let composer: EffectComposer | null = null;
  let output: THREE.WebGLRenderTarget | null = null;
  let effects: Effect[] | null = null;
  let dirty = true;
  const lastSize = { w: 0, h: 0 };
  const samples = quality === "hi" ? 4 : 0;

  const ensureOutput = (w: number, h: number, msaa: boolean) => {
    const want = msaa ? samples : 0;
    if (output && output.samples !== want) {
      output.dispose();
      output = null;
    }
    if (!output) {
      output = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: want, depthBuffer: true, colorSpace: THREE.LinearSRGBColorSpace });
      dirty = true;
    } else if (output.width !== w || output.height !== h) {
      output.setSize(w, h);
    }
    return output;
  };

  const freeComposer = () => {
    composer?.dispose();
    composer = null;
    dirty = true;
  };

  const handle: SlotHandle = {
    id,
    scene,
    camera,
    time: { s: 0, velocity: 0, weight: 0, visible: false },
    look: { exposure: 1, tone: "agx", seam: "#ffffff", grain: 0.03, vignette: 0.3 },
    ready: false,
    setEffects(next) {
      effects = next && next.length ? next : null;
      dirty = true;
    },
    render(gl, size, buffer) {
      const aspect = size.width / Math.max(1, size.height);
      // Scenes using a view offset (Low Resources portrait panning) manage aspect themselves.
      if (!camera.view?.enabled && Math.abs(camera.aspect - aspect) > 1e-4) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
      if (!effects) {
        if (composer) freeComposer();
        const target = ensureOutput(buffer.x, buffer.y, true);
        gl.setRenderTarget(target);
        gl.render(scene, camera);
        return target.texture;
      }
      const target = ensureOutput(buffer.x, buffer.y, false);
      if (!composer || dirty) {
        composer?.dispose();
        // MSAA on these half-float buffers breaks after bloom switches render
        // targets: small geometry (paper planes, the trail head, point lights)
        // comes back as black blocks. The scene is antialiased on the no-effects path instead.
        composer = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
        composer.autoRenderToScreen = false;
        composer.addPass(new RenderPass(scene, camera));
        composer.addPass(new EffectPass(camera, ...effects));
        composer.addPass(new CopyPass(target, false));
        dirty = false;
        lastSize.w = 0;
      }
      if (lastSize.w !== buffer.x || lastSize.h !== buffer.y) {
        composer.setSize(size.width, size.height, false);
        lastSize.w = buffer.x;
        lastSize.h = buffer.y;
      }
      if (effects) useKawaseBloom(effects);
      composer.render(1 / 60);
      return target.texture;
    },
    release() {
      freeComposer();
      output?.dispose();
      output = null;
    },
    dispose() {
      handle.release();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
      });
    },
  };
  return handle;
}

interface SlotProps {
  id: SceneId;
  quality: Quality;
  register: (h: SlotHandle | null, id: SceneId) => void;
  children: ReactNode;
}

/** Marks the slot ready once every lazy child resolved and shaders compiled. */
function ReadyMarker({ handle }: { handle: SlotHandle }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    let cancelled = false;
    const compile = gl.compileAsync ? gl.compileAsync(handle.scene, handle.camera) : Promise.resolve();
    void compile.then(() => {
      if (cancelled) return;
      handle.ready = true;
      engine.readyScenes.add(handle.id);
    });
    return () => {
      cancelled = true;
      handle.ready = false;
      engine.readyScenes.delete(handle.id);
    };
  }, [gl, handle]);
  return null;
}

/** Hosts one scene module in its own THREE.Scene and camera. */
export function SceneSlot({ id, quality, register, children }: SlotProps) {
  const handle = useMemo(() => createHandle(id, quality), [id, quality]);
  const registered = useRef(false);

  useEffect(() => {
    register(handle, id);
    registered.current = true;
    return () => {
      register(null, id);
      handle.dispose();
    };
  }, [handle, id, register]);

  return createPortal(
    <SlotContext.Provider value={handle}>
      <Suspense fallback={null}>
        {children}
        <ReadyMarker handle={handle} />
      </Suspense>
    </SlotContext.Provider>,
    handle.scene,
    { camera: handle.camera },
  );
}
