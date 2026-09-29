# Homepage scenes A: `garden` (hero) and `bubbles` (testimonials)

You build TWO scenes. The brief's file-ownership rule applies to both: `art/worlds/garden/**`, `art/worlds/bubbles/**`, `src/worlds/scenes/garden/**`, `src/worlds/scenes/bubbles/**`, `public/worlds/garden/**`, `public/worlds/bubbles/**`.

Homepage (`/`, src/app/page.tsx) chapters in order: hero (garden), doors (another agent), reel (another agent), voices (bubbles), cta + outro (another agent). Each homepage scene owns one chapter, so its rail covers s in [0, 1] plus ~0.15 margin on both ends (the compositor blends scenes across chapter boundaries: the outgoing scene keeps playing to s ~1.1, and the incoming one starts at s = 0). Palette: `home` in src/lib/worlds.ts (bubblegum pink #ff9cc2, periwinkle #9dbcff, butter #ffe08f; night: #ffa6d0, #a3b6ff, #cdb0ff). The cursor themes for both scenes already exist.

## Art direction: the Figma Config '25 ad look
Glossy, slightly droopy inflatable primitives and glyphs that catch light like vinyl, plus chrome, frosted glass and clay, under studio lighting with shallow depth of field. Use `ddd.inflate` (cloth-pressure inflation) to make the inflatables: puffy seams, soft wrinkles, real volume. Bake AO/GI where static. Everything must look like a polished 3D motion-design ad frame.

### garden (hero chapter, the first thing people see)
- A sculpture garden of giant glossy primitives floating over and resting in a mirror-still reflecting pool: an inflated rounded star, a blob, an arch, stacked pills, a torus, a big inflated letter "D" (the studio logo), chrome spheres, frosted transmissive glass slabs (MeshPhysicalMaterial transmission + thickness + roughness), and matte clay plinths and steps.
- The pool: drei `MeshReflectorMaterial` (blurred reflections) or a custom mirror, plus soft ripples where the cursor passes (read `pointer` from `@/lib/store`, project it onto the water plane, and drive a ripple shader).
- Studio HDRI from Poly Haven for reflections, a soft key light, colored bounce light.
- Camera: a slow push through the sculptures as you scroll (they part around the camera). The sculptures wobble and jiggle subtly with scroll velocity (`useSceneTime().velocity`) via a vertex-shader jiggle or spring rotation. Subject framed right of centre (the hero text is on the left).
- Night: the same garden at night with emissive neon rims, inner glow in the frosted glass, a dark glossy pool, and stars.

### bubbles (voices chapter: testimonials)
- Inflated glossy speech bubbles (rounded bubble plus tail, made with `ddd.inflate`) drifting and gently bumping into each other (simple soft-body-ish spring physics at runtime) in a pastel sky, with Cycles-rendered cloud impostors / cloud cards for depth.
- Some bubbles carry little glyphs ("...", a heart, a star) in contrasting glossy material.
- Camera floats up through them as you scroll.
- Night: bubbles lit from within against a starry dusk.

## Both scenes
- Parked mode is not used on the homepage; still handle mode="parked" gracefully.
- Lo versions: LayerStack + a few cheap live particles.
- Deliver pano-day/night.webp and lo/mini.glb for each (minis: one inflatable star on a base; one speech bubble on a base).
