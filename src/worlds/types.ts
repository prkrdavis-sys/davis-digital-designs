/** Renderable 3D scenes. A page (world) plays one or more of these as you scroll. */
export type SceneId =
  | "garden"
  | "doors"
  | "museum"
  | "bubbles"
  | "diorama"
  | "greenhouse"
  | "dna"
  | "pinball"
  | "snowglobe"
  | "dunes"
  | "everest"
  | "planes";

export const SCENE_IDS: SceneId[] = ["garden", "doors", "museum", "bubbles", "diorama", "greenhouse", "dna", "pinball", "snowglobe", "dunes", "everest", "planes"];

/** How one scene hands over to the next, in the compositor. */
export type TransitionKind = "dissolve" | "chroma" | "frost" | "refract" | "dive" | "wipe";

export type Variant = "day" | "night";
export type Quality = "hi" | "lo";

/** "tour" follows the scroll rail; "parked" is the calmer view used behind project pages. */
export type SceneMode = "tour" | "parked";

export interface SceneComponentProps {
  variant: Variant;
  quality: Quality;
  mode: SceneMode;
}
