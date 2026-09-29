import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { SceneComponentProps, SceneId } from "@/worlds/types";
import { SCENE_IDS } from "@/worlds/types";

export interface SceneModule {
  default: ComponentType<SceneComponentProps>;
  /** Optional warm-up (fetch GLBs/textures) before the scene mounts. */
  preload?: () => void;
}

const loaders: Record<SceneId, () => Promise<SceneModule>> = {
  garden: () => import("@/worlds/scenes/garden"),
  doors: () => import("@/worlds/scenes/doors"),
  museum: () => import("@/worlds/scenes/museum"),
  bubbles: () => import("@/worlds/scenes/bubbles"),
  diorama: () => import("@/worlds/scenes/diorama"),
  greenhouse: () => import("@/worlds/scenes/greenhouse"),
  dna: () => import("@/worlds/scenes/dna"),
  pinball: () => import("@/worlds/scenes/pinball"),
  snowglobe: () => import("@/worlds/scenes/snowglobe"),
  dunes: () => import("@/worlds/scenes/dunes"),
  everest: () => import("@/worlds/scenes/everest"),
  planes: () => import("@/worlds/scenes/planes"),
};

export const SCENE_COMPONENTS = Object.fromEntries(SCENE_IDS.map((id) => [id, lazy(loaders[id])])) as Record<
  SceneId,
  LazyExoticComponent<ComponentType<SceneComponentProps>>
>;

const warmed = new Set<SceneId>();

/** Fetch a scene's code and assets ahead of time (nav hover, door hover). */
export function preloadScene(id: SceneId) {
  if (warmed.has(id)) return;
  warmed.add(id);
  void loaders[id]().then((m) => m.preload?.());
}
