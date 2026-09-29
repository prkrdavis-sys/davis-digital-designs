"use client";

import { useEffect } from "react";
import type { WorldId } from "@/lib/worlds";
import { useUi } from "@/lib/store";

/** Lets a page declare its world (project pages follow their category, parked, showing their cover). */
export function SetWorld({ world, parked = false, cover = null }: { world: WorldId; parked?: boolean; cover?: string | null }) {
  const setWorld = useUi((s) => s.setWorld);
  useEffect(() => {
    setWorld(world, parked, cover);
  }, [world, parked, cover, setWorld]);
  return null;
}
