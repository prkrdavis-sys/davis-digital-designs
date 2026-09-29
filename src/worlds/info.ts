import type { SceneId } from "@/worlds/types";

/** Human names for scenes and their cursors (easter egg toast, settings, a11y). */
export const SCENE_INFO: Record<SceneId, { label: string; cursor: string }> = {
  garden: { label: "Sculpture garden", cursor: "liquid chrome" },
  doors: { label: "Door corridor", cursor: "portal ring" },
  museum: { label: "Marble hall", cursor: "gallery spotlight" },
  bubbles: { label: "Speech-bubble sky", cursor: "bubble wand" },
  diorama: { label: "Diorama", cursor: "loupe" },
  greenhouse: { label: "Greenhouse", cursor: "pollen" },
  dna: { label: "Microscope", cursor: "fluorescent helix" },
  pinball: { label: "Pinball machine", cursor: "chrome ball" },
  snowglobe: { label: "Snow globe", cursor: "frost" },
  dunes: { label: "Dunes", cursor: "gold sand" },
  everest: { label: "Everest", cursor: "altimeter" },
  planes: { label: "Paper planes", cursor: "paper plane" },
};
