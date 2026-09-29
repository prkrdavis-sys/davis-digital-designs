# Diorama handoff (scene `diorama`)

## Status
- Not started. `src/worlds/scenes/diorama/index.tsx` is a placeholder; there are no `art/worlds/diorama/` or `public/worlds/diorama/` files.

## Inputs you depend on
- Miniatures from the other worlds at `public/worlds/<scene>/lo/mini.glb`. On your base branch these exist for: `dna`, `garden`, `greenhouse`, `planes` (check with `ls public/worlds/*/lo/mini.glb`). The rest (pinball, snowglobe, dunes, everest, bubbles, doors, museum) are being built on other branches in parallel and will be merged later.
- So: at runtime, HEAD-check each mini and show a tasteful placeholder (a small glossy primitive on a plinth in that world's palette) for missing ones. In Blender, import whichever minis exist and use the same placeholders for the others. Make `layers` and `pano` re-runnable on their own (`blend diorama --steps layers,pano`), so they can be re-rendered once every mini is merged.
- The homepage palette is `home` in `src/lib/worlds.ts`; each world's palette is there too.
