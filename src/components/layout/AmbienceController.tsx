"use client";

import { useEffect } from "react";
import { useUi } from "@/lib/store";
import { WORLDS } from "@/lib/worlds";
import { ambience } from "@/lib/ambience";
import { engine } from "@/components/three/engine/state";

/** Keeps the ambient soundscape on the scene you are looking at. Silent unless opted in. */
export function AmbienceController() {
  const ambient = useUi((s) => s.ambient);
  const muted = useUi((s) => s.muted);
  const on = ambient && !muted;

  useEffect(() => {
    ambience.setEnabled(on);
    if (!on) return;
    // Browsers only start audio after a gesture; a stored preference waits for the first one.
    const kick = () => ambience.resume();
    window.addEventListener("pointerdown", kick, { once: true });
    window.addEventListener("keydown", kick, { once: true });
    const id = window.setInterval(() => {
      ambience.setScene(engine.primaryScene ?? WORLDS[useUi.getState().world].scene);
    }, 500);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
    };
  }, [on]);

  return null;
}
