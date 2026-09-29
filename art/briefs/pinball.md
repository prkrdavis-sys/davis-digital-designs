# Pinball world (scene id `pinball`) for the Play page

Page: `/play` (src/app/[category]/page.tsx). Chapters: intro (PageHero), work (project grid), interlude (one line: "Tilt, flip, repeat. A good game is just physics with a sense of humor."), outro (footer). The rail covers s in [0, 4] + margin (sMax ~4.2). Palette in src/lib/worlds.ts (`play`: "Inside the machine", "Games, toys, and multiball"; neon pink #ff5c9d, cyan #3edcff, yellow #ffd84a).

Art direction: INSIDE a giant pinball machine, camera at ball height, glossy and neon, like a premium toy or game commercial.
- Playfield: a baked (`ddd.bake.bake_group`) wood playfield under clear-coat, with custom art: painted star bursts, lane arrows, insert-light shapes, a big stylized "DAVIS DIGITAL" logo and "PLAY" lettering (Blender text objects), and halftone / gradient art (procedural shader nodes baked to texture). Live clear-coat reflections on top (low roughness, env map).
- Hardware: chrome wireform ramps (curves with bevel, support posts), habitrail loops, pop bumpers (colored caps, chrome skirts, light rings), slingshots with white rubber rings, rubber posts, rollover lanes with star rollovers, a bank of drop targets, a spinner, translucent colored plastics with printed art, lane guides, flippers with rubbers, the apron, a backglass / backbox at the far end with the studio name, glowing playfield inserts (emissive), and the ball trough.
- Several chrome balls with live environment reflections (PMREM from an HDRI or a baked cube) and motion. Bloom for the neon.
- Camera: rides the ramps like a roller coaster as you scroll:
  - intro: start low near the flippers, looking up the playfield.
  - work: swoop up a ramp past bumpers that FLASH as the camera passes (driven by scroll).
  - interlude: loop through the habitrail / orbit.
  - outro: multiball finale, with balls launching and the backglass lighting up.
  Large, thrilling, but smooth perspective changes, with the subject framed right of centre for text legibility.
- Day variant: bright overhead softbox / fluorescent lighting on a glossy, colorful playfield. Night variant: a dark arcade with the playfield GI lamps and full neon, strong bloom and reflections.
- Scroll interactivity: bumpers pulse and flash based on scene time and camera proximity; balls roll along paths.
- Parked mode (project pages in the Play world): a calm view of the backglass area, with `<CoverPanel/>` shown as the backglass display or a DMD-style screen.
- Lo version: LayerStack + a few live sparkle / glint particles.
- Pano: from the center of the playfield. Mini: a small pinball table on legs (~1 unit tall).
