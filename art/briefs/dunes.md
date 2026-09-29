# Dunes world (scene id `dunes`) for the Shop page

Page: `/shop` (src/app/shop/page.tsx). Chapters: intro (PageHero), work (shop tabs + product cards), faq (FAQ), outro (footer). The rail covers s in [0, 4] + margin (sMax ~4.2). Palette in src/lib/worlds.ts (`shop`: "The golden dunes", "Templates, standing tall at sunset").

The owner's direction: "Desert dunes at sunset with monumental template monoliths standing in the sand (photoreal). Camera zooms over the dunes at a low altitude, going right by some of the monoliths."
- Terrain: PHOTOREAL sand dunes: sharp crescent (barchan) ridges and seif ridges from layered ridged noise, fine wind-ripple micro-detail (normal map / displacement), and realistic sand PBR (ambientCG/Poly Haven sand textures). Long sunset shadows. Bake the terrain lighting (Cycles, low sun) into its texture for richness, with live specular sparkle (glints) on top.
- Monoliths: tall polished monoliths (black glass, brushed metal, or warm stone) standing in the sand at intervals along the flight path. Each is inlaid with a shop template design as a glowing panel. Shop products live in `content/shop/*.mdx` (`cover:` under `public/shop/`); load the covers at runtime with `useColorTextures`. Add sand drifts at their bases, footprints, and a few sun-bleached details.
- Atmosphere: height fog / haze, a physical sunset sky with a big sun disc and mie glow, blowing-sand streaks across the dune crests (live particles), and heat shimmer (a subtle screen-space distortion effect near the horizon, e.g. a custom postprocessing Effect in your folder).
- Camera: a fast, low-altitude drone flight over the dunes, banking between ridges and skimming right past the monoliths (close enough to see reflections); a rise over a crest reveals a new valley in each chapter; the faq chapter glides slowly along a row of monoliths; outro climbs high toward the sunset horizon. Smooth, cinematic, with big perspective changes; subject framed right of centre for text legibility.
- Night variant: moonlit dunes in cool blue, the Milky Way and stars (a procedural sky or a Poly Haven night HDRI), and the monolith panels glowing warmly.
- The Shop has no project pages, but support mode="parked" gracefully (hold a calm view by a monolith with `<CoverPanel/>` as its panel).
- Lo version: LayerStack + live blowing-sand particles.
- Pano: on a dune crest at sunset. Mini: a small dune with a monolith on a base (~1 unit tall).
