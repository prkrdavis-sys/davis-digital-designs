# Homepage scenes B: `doors` (Pick a door) and `museum` (Featured work)

You build TWO scenes. The brief's file-ownership rule applies to both: `art/worlds/doors/**`, `art/worlds/museum/**`, `src/worlds/scenes/doors/**`, `src/worlds/scenes/museum/**`, `public/worlds/doors/**`, `public/worlds/museum/**`.

Homepage (`/`, src/app/page.tsx) chapters: hero (garden, another agent), doors (yours), reel (museum, yours), voices (bubbles, another agent), cta + outro (another agent). Each of your scenes owns one chapter, so its rail covers s in [0, 1] plus ~0.15 margin on both ends (the compositor blends scenes across chapter boundaries: the outgoing scene keeps playing to s ~1.1, and the incoming one starts at s = 0). Palette: `home` in src/lib/worlds.ts. Cursor themes already exist for both.

### doors (chapter "doors": the Pick a door section with five category cards)
- A grand, glowing corridor/colonnade with FIVE themed arches receding into soft light, one per world:
  - Sites: wrought iron and glass, overgrown with ivy
  - Apps: brushed lab steel with fluorescent seams
  - Play: neon arcade arch with bulb lights
  - Create: carved ice with frost
  - Shop: warm sandstone with gold inlay
- Each doorway opens onto that world through a portal: sample the world's 360 panorama `public/worlds/<scene>/pano-<day|night>.webp` (scenes: greenhouse, dna, pinball, snowglobe, dunes) by view direction on the door's inner plane, so the world appears to exist behind the door with real parallax. Other agents are producing those panoramas right now, so some may not exist yet. Check with fetch HEAD at runtime and fall back to a rich animated gradient in that world's palette (from `WORLDS[<world>].palette` in src/lib/worlds.ts), so it looks good either way.
- DOM interplay: `homeState` in `src/components/three/engine/state.ts` exposes `hoveredDoor` (a world id: "sites" | "apps" | "play" | "create" | "shop", or null) set when the matching card is hovered. That door swings or glows open and spills light and particles. `enteredDoor` is set on click: the camera should rush toward that door (the compositor also plays a "dive" transition into the new page).
- Camera glides along the colonnade with scroll, with the doors staggered on the right side for text legibility (the cards and heading are on the left/center).
- Night: moonlit colonnade, doors glowing brighter.

### museum (chapter "reel": Featured work)
- A luminous marble museum hall: polished marble floor with reflections, a coffered ceiling with skylights and volumetric god rays, dust motes, and classical columns, all baked with `ddd.bake.bake_group` for rich GI.
- The featured projects' covers hang as lit, framed artworks (gilded or modern gallery frames, picture lights / gallery spotlights, small placards with the project title). Get featured projects from `content/work/*.mdx` frontmatter (`featured: true`, `cover:`, `title:`) in your build step, and write `public/worlds/museum/covers.json` for the runtime to load covers with `useColorTextures`.
- Details: benches, stanchions with velvet ropes, a few sculptures on plinths (Poly Haven has CC0 statues/busts; check `node art/fetch/polyhaven.mjs search models statue` / `bust`).
- Camera glides along the hall past the artworks as you scroll, subject right of centre.
- Night: the museum after hours, with gallery spotlights only, moonlight through the skylights, and deep shadows.

## Both scenes
- Parked mode is not used on the homepage; still handle mode="parked" gracefully.
- Lo versions: LayerStack + a few cheap live particles.
- Deliver pano-day/night.webp and lo/mini.glb for each (minis: a small themed archway on a base; a tiny framed painting on an easel).
