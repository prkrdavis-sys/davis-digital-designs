# Paper planes world (scene id `planes`) for the Contact page

Page: `/contact` (src/app/contact/page.tsx, src/components/contact/ContactForm.tsx). Chapters: intro (PageHero), form (the contact form + aside), outro (footer). The rail covers s in [0, 3] + margin (sMax ~3.2). Palette in src/lib/worlds.ts (`contact`: "Paper planes", "Send one over the clouds").

Art direction: a dreamy, premium sunset cloudscape with a flock of folded paper planes. Think a high-end airline or stationery ad.
- Clouds: a volumetric-looking cloud sea at golden hour. Render the cloud layers in Blender Cycles as volumes into layered cards / impostor sprites with depth (or procedural volume shader cards), plus live raymarched or noise-sprite cloud wisps near the camera for parallax. Tall cumulus towers, a sun low on the horizon, god rays, and pastel peach / lavender / cream color.
- Paper planes: a boids flock (~40-80) of real folded-paper planes (proper paper-plane geometry with fold creases, paper texture, subtle translucency and backlight through the paper), banking and gliding in formation, each with a faint contrail. A few hero planes pass close to the camera.
- Launch hook: when the contact form submits successfully, a plane should launch from the form area toward the horizon. Expose a tiny event bus in your folder, e.g. `src/worlds/scenes/planes/launch.ts` exporting `launchPlane()` and a subscribe function, and have the scene animate a special hero plane when it fires. You MAY make ONE minimal edit to `src/components/contact/ContactForm.tsx`: call `launchPlane()` in the existing effect where `state.status === "sent"` or `"fallback"` (import it from your module). Mention the edit in your report.
- Camera: intro drifts above the cloud sea toward the sun; form glides alongside the flock as it banks; outro rises up over the clouds into the sunset / stars. Smooth, dreamy, with big perspective changes; subject framed right of centre for text legibility.
- Night variant: moonlit clouds, stars, and paper planes carrying tiny glowing lanterns.
- Contact has no project pages; support mode="parked" gracefully.
- Lo version: LayerStack + live gliding plane sprites or wisps.
- Pano: above the cloud sea at sunset. Mini: a folded paper plane on a small stand (~1 unit tall).
