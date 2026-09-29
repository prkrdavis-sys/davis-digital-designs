# Snow globe world (scene id `snowglobe`) for the Create page

Page: `/create` (src/app/[category]/page.tsx). Chapters: intro (PageHero), work (project grid), interlude (one line: "Stories settle like snow: slowly, then all at once."), outro (footer). The rail covers s in [0, 4] + margin (sMax ~4.2). Palette in src/lib/worlds.ts (`create`: "The snow globe", "Stories in a tiny, perfect world").

Art direction: a gorgeous, tactile, tilt-shift miniature world, like a luxury holiday ad.
- Outside (intro): a large refractive glass snow globe (real transmission: IOR ~1.5, thickness; water inside with slight tint; a lacquered wood or ceramic base with a small brass plaque "DAVIS DIGITAL") sitting on a creator's desk. The desk has a vintage film camera, film reels and strips, a clapperboard, a mug, a notebook, and warm window light. Soft bokeh background of a cozy studio.
- The camera pushes in and passes THROUGH the glass (the compositor has a "refract" transition kind, but here it happens inside one scene: animate a refraction/warp as the camera crosses the glass, e.g. a screen-space distortion driven by camera distance to the globe surface, or ride the camera through while the glass material's refraction swirls).
- Inside (work, interlude): a tilt-shift winter creator village: a tiny timber studio cabin with lit windows, a ring light and camera on a tripod, a mini movie-theater marquee, tiny billboards and screens showing Create project covers (find them in `content/work/*.mdx` with `category: create`, `cover:` under `public/work/`; load with `useColorTextures`), snowy pine trees, a frozen pond with skaters or ice, lamp posts, a winding path, and snow drifts with sparkle. Snow falls constantly (live particles, swirling), and depth of field / tilt-shift (postprocessing `TiltShiftEffect` or DOF) sells the miniature.
- Outro: pull back out of the globe; the snow swirls as if the globe was just shaken, and the camera ends on the globe glowing on the desk.
- Night variant: warm glowing windows and street lamps, an aurora curtain in the globe's sky (animated shader), and moonlit snow sparkle.
- Parked mode (Create project pages): a calm view inside the village, with `<CoverPanel/>` as the village's big cinema screen / billboard.
- Lo version: LayerStack + live falling snow particles.
- Pano: from inside the village square. Mini: a small snow globe with the base (~1 unit tall).
- Cycles bake for static village pieces is encouraged. Glass must look real (live transmission via MeshPhysicalMaterial with transmission + thickness + ior, and an env map).
