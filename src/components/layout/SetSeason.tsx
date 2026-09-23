"use client";

import { useEffect } from "react";
import type { Season } from "@/lib/seasons";
import { useUi } from "@/lib/store";

/** Lets a page declare its season (used by project pages, which follow their category). */
export function SetSeason({ season }: { season: Season }) {
  const setSeason = useUi((s) => s.setSeason);
  useEffect(() => {
    setSeason(season);
  }, [season, setSeason]);
  return null;
}
