# Davis Digital Designs

A portfolio that is itself a portfolio piece: a persistent 3D world (sky, hills, fireflies, seasons) that reacts to scroll and cursor, five categories of work, and a template shop.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Changes to code and content hot-reload.

Other commands:

| Command         | What it does                                   |
| --------------- | ---------------------------------------------- |
| `npm run build` | Production build. Also validates all content.  |
| `npm run lint`  | ESLint (React Compiler rules included).        |
| `npx tsc --noEmit` | Type-check without building.               |

## Add a project (no code required)

1. Copy `content/work/_template.mdx` to `content/work/my-project.mdx`. The filename becomes the URL: `/work/my-project`.
2. Fill in the fields at the top (the "frontmatter"). Required: `title`, `tagline`, `category`, `year`, `cover`.
3. Make a folder `public/work/my-project/` and drop in `cover.svg` (or `.png`/`.jpg`; update the `cover` path to match). 1600×900 looks best.
4. Write the story below the `---` line in Markdown.
5. Set `draft: false` (or delete the line).

If a field is wrong the build tells you the file and the field:

```
Invalid frontmatter in content/work/my-project.mdx:
  - category: Invalid enum value. Expected 'sites' | 'apps' | 'play' | 'create'
```

Fields worth knowing:

- `category`: `sites`, `apps`, `play`, or `create`. Decides which door it lives behind and which season it wears.
- `featured: true`: shows on the homepage reel.
- `size`: `sm`, `md`, or `lg`. How much room the card takes in grids.
- `tags`: become the filter chips on the category page.
- `link` + `linkLabel`: external button (live site, itch.io, YouTube).
- `problem` / `solution` / `result`: the three story cards on the project page.

## Add a shop item

Same idea: copy `content/shop/_template.mdx`. Two tiers:

- `tier: grab-and-go`: a preset template. When Lemon Squeezy is set up, add `checkoutUrl` and the button becomes "Buy now". Until then it says "Notify me" and opens the contact form.
- `tier: made-to-order`: a commission. `price` is the starting price; the button says "Commission this".

Prices are in cents (`2900` = $29).

## Turn on real email

1. Make a free account at https://resend.com and create an API key.
2. Copy `.env.example` to `.env.local` and paste the key into `RESEND_API_KEY`.
3. On Vercel, add the same variable under Project → Settings → Environment Variables.

Without a key the form still works: it opens the visitor's mail app with everything prefilled.

## Turn on Lemon Squeezy checkout

1. Create a store at https://lemonsqueezy.com, add a product, upload a PDF that contains your Canva template link.
2. Copy the product's checkout URL (looks like `https://YOUR-STORE.lemonsqueezy.com/checkout/buy/...`).
3. Paste it into that product's `checkoutUrl` in `content/shop/`.

## Swap in a real 3D model (later)

`src/components/three/HeroModel.tsx` is the slot. Export a `.glb` from Spline or Blender into `public/models/`, then replace the procedural blob with:

```tsx
const { scene } = useGLTF("/models/hero.glb");
return <primitive object={scene} />;
```

Keep models under ~2 MB; use Draco compression if bigger.

## Where things live

```
content/            projects and shop items (MDX)
public/work/        project images
public/shop/        shop images
src/app/            pages (Next.js App Router)
src/components/
  three/            the 3D world: Sky, Terrain, Fireflies, SeasonParticles, HeroModel
  fx/               cursor, magnetic buttons, particle bursts, ripple image, vine
  home/             homepage sections
  work/             category + project UI
  shop/             shop UI
  layout/           nav, footer, page transitions, smooth scroll
  easter/           the Konami firefly game
src/lib/
  seasons.ts        season palettes and particle behavior
  motion.ts         the shared eases and durations
  content.ts        MDX loader + validation
  store.ts          global UI state (theme, mute, season, pointer)
  sfx.ts            Web Audio sound effects
```

## Design rules baked in

- One motion language: three eases, four durations, in `src/lib/motion.ts`.
- Reduced motion is respected everywhere. Touch devices get lighter particle counts and no cursor effects.
- No WebGL? A gradient background takes over. Nothing breaks.
- Colors are CSS variables in `src/app/globals.css`. Light is day, dark is night, and each season overrides the accent trio.

## Secrets

- Konami code (↑ ↑ ↓ ↓ ← → ← → B A) starts a firefly-catching game.
- Click the logo five times to shuffle the season.
- Hold the mouse button down anywhere and the fireflies scatter.
