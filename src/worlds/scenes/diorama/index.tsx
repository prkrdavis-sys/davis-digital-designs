"use client";

import { WORLDS } from "@/lib/worlds";
import type { SceneComponentProps } from "@/worlds/types";
import { Placeholder } from "@/worlds/scenes/Placeholder";

export default function Scene(props: SceneComponentProps) {
  return <Placeholder {...props} colors={WORLDS.home.palette} />;
}
