"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { Variant } from "@/worlds/types";
import type { SnowMeta } from "@/worlds/scenes/snowglobe/data";

/**
 * The globe: real transmission (refracts the village and the desk behind
 * it), thin-shell thickness, a faint water tint, dispersion on the rim. It
 * does not write depth so the snow and aurora inside still draw over it.
 */
export function Glass({ meta, variant }: { meta: SnowMeta; variant: Variant }) {
  const { center, rOut, baseTop } = meta.globe;
  const geometry = useMemo(() => {
    // Stop where the sphere dips into the brass collar of the base.
    const theta = Math.acos(THREE.MathUtils.clamp((baseTop - 0.02 - center[1]) / rOut, -1, 1));
    return new THREE.SphereGeometry(rOut, 160, 96, 0, Math.PI * 2, 0, theta);
  }, [center, rOut, baseTop]);
  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: variant === "night" ? "#eef6ff" : "#f6fbff",
        metalness: 0,
        roughness: 0.015,
        transmission: 1,
        thickness: 0.14,
        ior: 1.45,
        dispersion: 0.35,
        attenuationColor: new THREE.Color("#d6efff"),
        attenuationDistance: 2.4,
        specularIntensity: 1,
        envMapIntensity: variant === "night" ? 1.6 : 1.25,
        clearcoat: 0.4,
        clearcoatRoughness: 0.02,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [variant],
  );
  return <mesh geometry={geometry} material={material} position={center} renderOrder={2} />;
}
