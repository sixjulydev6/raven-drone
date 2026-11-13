# AGENTS.md — Raven medical delivery drone site (built on a USAvionix homepage reconstruction)

Context for coding agents (Codex, Claude Code, others). Read this before editing.

## Current direction — Raven (user update)

The user has repurposed this project as **Raven**, a medical delivery drone concept for remote mountain villages and cold-climate/tundra communities. This overrides the original brand/copy fidelity goal. Preserve existing camera tracks, scene spans, scrolling, and transitions. Hero/swarm use `public/assets/models/raven_hexa.glb`, the user-supplied black hexacopter medical drone (`glb/new-drone/Hexa_Medical_Drone_Black.glb`, v2 from 2026-10-30: 6 props, white medical box, EO/IR turret, LiDAR and thermal pods; v1 kept as `Hexa_Medical_Drone_Black_v1.glb`), prepared by `glb/new-drone/prepare_hexa.mjs`. The light-gray coaxial quad sources (`glb/raven-quad/`) are kept because `build_silhouettes.py` there builds the flock/ops silhouettes (still the quad); the loader and boot SVG show the hexa since 2026-10-31. The original `raven_drone.glb`, the earlier dark hexacopter (`glb/raven-refined/`) and the Blender story scene (`glb/raven-story/`) were removed in the 2026-10-31 cleanup (recoverable from git history). Product performance is unspecified: do not invent payload, range, speed, certification, or cold-weather ratings. The exceptions are the user-supplied figures "15–25 kg" payload and "5,000 m" altitude (2026-11-03), shown only in their callouts (`lib/payload.ts` `PAYLOAD_COPY`, `ALTITUDE_COPY`). Every jet silhouette is now a Raven drone (loader, sync flock, Raven Ops drones). The footer (CTA, legal links, landing drone, wordmark) was removed on 2026-11-03 (user): the page ends with the About section.

## What this project is

Started as a faithful reconstruction of https://www.usavionix.com/ (captured 2026-10-29); the user then turned it
into **Raven**. Scroll choreography, camera tracks, terrain and several mirrored assets still come from the reference.
Not affiliated with USAvionix.

- Deployment (user decision 2026-10-30): private GitHub repo + public Vercel production. The page stays `noindex`.
  Third-party reference material stays local and is gitignored/vercelignored: `research/` (captured bundles/HTML),
  `asset/` (DJI videos), and the unused mirrored jet/brand assets listed in `.gitignore`. Do not re-add them.
- Never hotlink reference assets. Everything is served from `public/`.
- Contact form has **no backend** on purpose: it validates, then says nothing was sent. Never fake success,
  never submit to the real site.

## Commands

```bash
npm install
npm run dev              # http://localhost:3100 (preview config: .claude/launch.json, name "drone-site")
npm run build            # production build — must pass
npm run typecheck        # tsc --noEmit — must pass
npm run assets:manifest  # regenerates research/usavionix/asset-manifest.json
```

Local production builds use `.next-production/`; development uses `.next/` so checks do not corrupt a running preview.
On Vercel (`VERCEL` env set) the build uses the default `.next/`.
Git: private GitHub repo `bishwamandal/raven-drone-site`. Production: https://raven-drone-site.vercel.app (Vercel project
`raven-drone-site`, connected to the repo: every push to `main` builds and deploys to production). Manual deploy from the working
copy: `vercel deploy --prod --yes`.
`.vercelignore` keeps `glb/` sources and local-only material out of the upload.

## Stack (installed versions)

Next.js 15.5 (App Router, `src/`), React 19, three 0.176, @react-three/fiber 9.8, @react-three/drei 10.7,
postprocessing 6.39, lenis 1.3, zustand 5, motion 12 (`motion/react`), delaunator 5, Tailwind 4 (CSS `@theme`),
Geist + Geist Mono via the `geist` package, clsx. Path alias `@/*` → `src/*`.

## Source of truth

| Path | What |
|---|---|
| `prompt.md` | Original task brief (requirements, constraints). |
| `research/usavionix/ANALYSIS.md` | Reference analysis: assets, design tokens, scene spans, timings (local only, not in git). |
| `research/usavionix/shipped/` | Minified bundles + 5 GLBs from the live site. Research input, not runnable. |
| `research/usavionix/home.html` | Captured homepage HTML (structure, classes, spacer height). |
| `research/usavionix/asset-manifest.json` | 132 local assets: source URL, bytes, SHA-256, MIME, dims, GLB nodes/clips. |
| `research/usavionix/public-mirror/` | Mirrored reference assets the site no longer serves (jet GLBs, brand, landing frames, media); moved out of `public/` 2026-10-31. `build_silhouettes.py` reads `loading-delta.glb` from here. |
| `RECONSTRUCTION.md` | Architecture table, verification done, **known discrepancy list**. Update it when behavior changes. |

Key shipped modules (in `page-33beb1af07230f28.js` unless noted): `7370` main scene, `36745` scene store
(2245 chunk), `82245` scroll controller, `41480`/`98894`/`8743` post FX, `73560` landing sequence,
`48847` globe, `88572` mission cards, `72781` navbar (layout chunk), `66741`/`98317` modal/form (8866 chunk),
`76772` mission-log data (5720 chunk), `25621` asset paths. When unsure about a value, read the bundle
— do not invent numbers.

## Architecture

```
src/app/layout.tsx          fonts, <SmoothScroll>, <Navbar>
src/app/page.tsx            Loader, FixedContainer (fixed stage), opening, story band 1 + band 2 spacers (contiguous), team (About)
src/lib/
  scenes.ts                 SCENE ids, SCENE_SPAN (vh), SCENE_ORDER, computeSceneRanges, zustand store
  constants.ts              shared mutable refs (terrain travel), RENDER_ORDER, sun, colors
  math.ts                   remap / remapEased / damp / wrap / easeInOutCubic (ported helpers)
  assets.ts                 asset paths, DRACO_PATH=/draco/
  loading.ts                loader state machine store
  scroll-lock.ts            ref-counted Lenis lock + "lenis-lock-change" event
  render-scale.ts           canvas / scene / drone-layer densities (no drone pixelation)
src/components/
  SmoothScroll.tsx          ONE Lenis instance (lerp .1 free scroll, syncTouch; wheel inside the snap bands is cancelled and played as eased snaps; a new gesture mid-snap queues the next stop) + scene progress writer + scene-end snapping
  Navbar.tsx                logo, chapter ticks (150ms fade → .75s scroll → restore), Contact, menu <dialog>
  ui/ Modal (native <dialog>), Button (exact CTA classes), Badge, icons
  ContactForm / ContactButton
  loading/Loader.tsx        boot splash + loading-drone canvas + status line
  scene/
    FixedContainer.tsx      Canvas (screen dpr max 2, no AA, no depth buffer), PerformanceMonitor, ChapterCopy, HudLog
    MainScene.tsx           assembly, flock FBO portal, hero audio, sets mainAppLoaded
    PostFX.tsx              scene composer (RenderPass → lens → SMAA) + drone layer → DroneCompositePass → fisheye → flock mix → wipe → FinalEffect
    DroneRig.tsx            camera + 3 drones, ClipSeeker per tracker, hover/steer, shake, engine scene copy
    ClipSeeker.ts           deterministic GLB clip seeking (time = duration*progress - 1e-6)
    Drone.tsx               PBR drone (5 nodes), engine flame shader, hull number via RenderTexture
    Terrain.tsx             endless tiles, fog keyframes per scene, Phalanx scan wipe, city tile
    Grid, Clouds, DetectionPoints, Flock, Perimeters, CoordinationDrones, LowPolyDrone, PowerStation
    ChapterCopy.tsx         chapter copy + time windows (exact text)
    HudLog.tsx              scripted mission log
    overlays/               SpecsCallouts, SwarmTags, GroundHtml
    materials/              TerrainMaterial
    shaders/screen-uv.ts    shared GLSL (diagonal scan wipe, grid AA)
  sections/                 FeatureSection, CapabilityVideos, UseCases, ClosingCta (About/`Sections.tsx` removed 2026-11-05)
public/assets/              mirrored reference assets (same paths as live site); images/media = _next/static/media
public/draco/               Draco decoder copied from three/examples (do not CDN)
scripts/asset-manifest.mjs  manifest generator
```

### Scroll / progress model (do not break)

- **Payload page (user, 2026-11-03: "only these three things we are going to show")**: the page is now opening ->
  hero -> payload stage, nothing after (`story-map.ts` `PAYLOAD_ONLY`; spacers `#opening` 300dvh, `#payload-band`
  `calc(200dvh + 1px)` with the `#payload` anchor at its end, one closing screen). The story is held on the hero frame
  (`toStory` <= 1), so Airframe ... Care teams, the diagonal wipe and the map capture are never reached (code kept);
  nav chapter ticks are off (`SHOW_CHAPTER_TICKS`). One gesture plays the payload stage over `PAYLOAD_MS` (2.0 s),
  everything a pure function of `payloadProgress` (`lib/payload.ts` `PAYLOAD_TIMELINE`): hero copy out at .02, sky and
  clouds to black, the terrain shader's clay sweep far -> near (`TerrainMaterial` `payloadClay`, shared
  `payloadClayUniforms`; clay colours, dot grid and black from `clay-map.ts` CLAY), terrain travel slowed to 0.4x and
  the lens travel streak off, the camera eased toward the medical box (`scene/payload-camera.ts`, from the live hero
  pose), the drone's own materials switched to the vector form top -> bottom (`Drone.tsx` `vectorise`, outline
  `EdgesGeometry` on `DRONE_LAYER`, rotor discs drawn as rings), the box turned yellow, then the DOM callout
  (`overlays/PayloadCallout.tsx`; since 2026-11-05 payload, altitude and speed callouts share one right-aligned block, `overlays/callout-layout.ts`, user mockup; the payload marker/leader line was dropped, `payloadScreen` is still written but unused). From the payload sweep on, the
  ground is the terrain of the `net` section of `assets/html/raven_homepage (3).html` ("Mapped to the last ridge"),
  ported exactly (`scene/net-terrain-field.ts` + worker, `scene/net-terrain.ts`: height field, contours, dot grid, hover
  glow, idle sway): the clay front cuts the tiles (`uPayloadNet`) and draws it beyond, pivoted on the drone over its
  depot. Then the **mountain stage** (`#route-band` 200dvh, `#route` anchor; same pace): the camera pulls back to the
  section's view (its fog takes over, the massif comes out of the haze) while the drone turns to face up its route; the
  yellow route ribbon draws to Ridge Clinic (a faint white one to Summit Station, the second checkpoint), then two
  scroll stops fly the drone up the route (halfway, then the clinic) and "Operating altitude" counts from a random 80-90 m (small random upticks while waiting) -> 5,000 m with its climb (`climbRange`,
  `overlays/RouteCallout.tsx`); leg 2 of the connected route then draws on in green from the clinic to Summit Station
  (`netArcRoute`: climb, cruise, descend). Then the **speed stage** (`#speed-band`, `#speed`): same view, the drone
  flies leg 2 while `overlays/SpeedCallout.tsx` shows speed (~79 km/h from the user's own `net` section figures,
  `SPEED_FIGURES`), distance left and time. The altitude side
  view (user removed it 2026-11-03) is still in the code (`applyAltitudeCamera`, the altitude line) but has no page
  range. No speed/distance figures until the user supplies them. After the speed stage (2026-11-04): Section 03 (`#features-band`, three feature stops, slides up over the stage, which then hides) and Section 04 (`#capabilities`, auto-advancing capability videos); see RECONSTRUCTION.md "Sections 03 and 04". The
  bullets below describe the shipped story bands, still in the code but off the page.

- Opening (user, 2026-11-01; replaced the pad takeoff film): page [0, P] (`#opening`, `OPENING_VH` 300) flies the
  live camera from a low wide shot under the hovering drone (procedural sky dome + ridge rings + Blender land layer,
  `scene/OpeningSky.tsx`, source `glb/raven-sky/`; terrain fog fades into the land layer via `uPanoMix`) into the
  Camera01 hero pose in one move (`scene/opening.ts`: dolly zoom fov 75 → 20 on an ease-out `openingEase` since 2026-11-05, was smootherstep, which felt like a delay before the camera moved, barrel pass in PostFX, extra ground
  tiles + fog in Terrain), story held at 0. At P everything opening-only is off and the hero frame is unchanged. The hero
  copy shows from the first opening frame and leaves at delta .075, as before (user). Band 1 opens with an opening range (page 0 → P+1): one
  gesture plays it over `OPENING_MS` (2.5 s), reverse returns to the low shot; no auto-advance on reveal. Desktop: free scroll since 2026-11-06 (see Free zone); `OPENING_MS` only applies on touch phones.
- Journey (FLOCK_SCENE) removed (user, 2026-11-02): no network map (flock mix and portal render off), no copy or nav
  tick; its story range plays on 30% of its page length (`JOURNEY_PAGE_SHARE`, `band1Page`/`band1Story` in
  story-map.ts) inside the Route snap range, so one gesture flies Prepare -> Route. Band 1 spacer `calc(2150dvh + 1px)`.
- Homepage layout (user decisions 2026-10-30/11-01): the shipped story runs in two contiguous page bands
  (`lib/story-map.ts`). Band 1 = intro → real-time-detection (Route). Band 2 starts right after it, at the START of
  phalanx-ai, and ends at the clay landscape's ridge village (analysis-evaluation .5, `CLIMB_SHARE`): Review, Updates,
  Support and Network were removed (user, 2026-11-03); later scenes exist in story coordinates but are never reached
  (`toStory` clamps at the end). The `#parts` section was removed (2026-11-01). Thermal and ignition are
  skipped. The bands are joined by the shipped diagonal Phalanx wipe with the Route still live: over the first half of
  phalanx's page range (`storyMap.W`) the story holds on Route (terrain travel and drone hover keep running) and PostFX
  `DiagonalWipeEffect` lays the Care teams map (phalanx .5) over the swept side (`wipeRatioAt` = shipped
  `remapEased(phalanx, 0, .5, 0, 1, easeInOutCubic)`, same `computeScreenUv` edge + 0.1 border). That map is static in
  the shipped scene, so it is rendered once off screen (PostFX `Preroll`: store set silently with
  `sceneDataAt(mapStory())`, final pass off, `CopyPass` capture, store restored; again after a resize) and at X + W
  the story switches to the identical live map. Chapter copy + HUD are clipped by `wipeClipPath`; Route labels hide
  where `wipeX` < ratio. Scene
  ranges and every scene component stay in story coordinates; `toStory`/`toPage` convert page scroll, `stageTop` keeps
  the fixed stage covering through both bands and scrolls it away after band 2, `useStage.cover` gates PostFX and the
  bar background. Snapping is one band from the opening to the end of the story; after it the page is free.
- Scene spans unchanged (intro 1px, 12 × 500vh, zone 100vh, multi 500vh, in story px). Spacers: band 1
  `calc(2150dvh + 1px)` (story to Route, Journey compressed to 150vh of page), band 2 `850dvh` (phalanx 500 + flight to both villages 250 + one screen, `#care-teams` anchor at
  500dvh = finished landscape frame, target of the Network links).
- Per scene: `progress=(scroll-start)/height`, `showRatio`, `hideRatio`, `isActive`, clamped 0–1, written on every
  Lenis scroll event. Everything reads `useScenes.getState()` in frame loops (no React state per frame).
- One progress source, one Lenis. Do not add GSAP ScrollTrigger scrub or a second smoothing layer.
- Snapping: wheel/arrow/touch picks next/prev scene end; RAF steps 2px/ms while Lenis velocity is low.
- Airframe/Connection are capped to a ~40 deg oblique view (smooth elevation ceiling from 35 deg) on top of the shipped clips (`scene/camera-tilt.ts`, user 2026-11-02), Prepare included; hands off to the Journey map over FLOCK_SCENE 0.4-0.75.
- Camera mapping: delta→Camera01 (always), swarm→Camera02, mission→03, flock→04-02, thermal→05, ignition→06,
  analysis→07, interdrone→08, multi-threat→09. Drones: 01-01 (last frame), 02-01/02-02/02-03, 03-01/03-02.
  Mobile tracks (`*-mobile.glb`) below 768px. GLTFLoader renames `Drone.001` → `Drone001`.
- Hero drone grows to 1.35x in top views (`TOP_VIEW_SCALE` in DroneRig, eased top-view blend, user 2026-11-02) and is
  1.25x in the opening and hero frame (`HERO_SCALE`, eased out over DELTA_DRONE 0-0.2 so the two never stack; user
  2026-11-03). Drone maps get anisotropy 8 (`RavenModel`).
- Render resolution (`lib/render-scale.ts`, user 2026-11-03: the drone must not pixelate on any screen): canvas at
  the screen density (max 2). The scene renders in PostFX's scene composer at an adaptive density (1x .. native,
  start 1.5, drei `PerformanceMonitor` in FixedContainer); the drone bodies render on their own layer (6) with MSAA at
  canvas density, cropped to their screen bounds, and `DroneCompositePass` lays them over the scene before fisheye,
  wipe and grade. Rotor discs stay in the scene render (the lens blurs them as before) and draw over the body via
  stencil. Screen-space uniforms rendered in the scene (`resolution`, Terrain/Grid `uDpr`) use the scene density.
  Performance budget: 60 fps on an M3 at 1x and 2x on `next start`.
- Overlay gates from the bundle, e.g. specs callouts: delta > .9 && swarm < .01; hero copy exits at delta .075.

### Rendering notes

- A `useFrame(..., 1)` exists, so R3F auto-render is off; the composer renders at priority 100.
- Clear color: sky `#c9e0f7`, black after ignition > .99. Final grade fades to black with multi-threat hideRatio.
- Custom ShaderMaterials output raw values: textures sampled there must not be sRGB-decoded unless the source did
  (landing frames use `NoColorSpace`).
- Footer removed (user, 2026-11-03): `Footer`, `LandingSequence` (desktop WebGL landing drone, wordmark, team text),
  `FooterDrone`, `HeroLogo`, `drone-flight.ts` and the footer-only `Geist-SemiBold.woff` are gone (recoverable from git
  history). The About section is plain DOM on every size; the loader's "Preparing scene" step now waits on the terrain.

## Design tokens (from shipped CSS, in `globals.css @theme`)

bg `#0f0f0f`; red `#f66`; yellow `#ffcb47`; **green token is cyan `#7aebff`**; transition flash `#FF2200`.
Type: d-h0 80/76 600 -.04em; d-h1 76/80; d-h2 50/52 -.03em; d-h3 29/32 500 -.01em; d-body-l 19/24;
d-mono 12/16 .06em; m-h0 43/38.7; m-h1 34/36; m-h2 30/32; m-h3 19/20; m-body-l 14/16; m-mono 11/16.
Nav: homepage bar, `--nav-height` clamp(56px, 5.4vw, 82px) (the stage offset and spacer use the variable). Shipped CTA rounded-full white/25 → hover white/30, 20×12px padding; the hero uses the homepage square CTA.
z: scroll-sequence 550, over-scroll-sequence 575, navbar 600, menu 700, modal 800.
Text motion: enter opacity0 y+8 #FF2200 → white, exit y-8 #FF2200, .4s easeInOut; support +.2s, CTA +.4s.

## Rules for changes

- Fidelity first: port from the bundle; cite the shipped module/var in a short comment like existing code.
- Match surrounding style: refs in hot paths, `scenes()` reads in `useFrame`, zustand selectors for threshold booleans.
- Keep text in semantic DOM; keep dialogs keyboard-accessible (Escape, focus return, scroll lock via `lockScroll`).
- Don't claim "exact" without side-by-side evidence at identical viewport + scrollY. Record new gaps in
  `RECONSTRUCTION.md`.
- After changes: `npm run typecheck`, `npm run build`, then visual check in browser.

## Verification tips

- Payload page at vh=900 (1440 wide): opening low shot 0, hero frame 2701, payload stage 2701 -> 4501 (callout from
  ~4033, threshold .74), mountain stage 4501 -> 6301 flowing without a stop into the climb 6301 -> 8101: the drone sets off with the first
  gesture after the payload frame while the camera follows it and pulls back (`routeFlight` in lib/payload.ts; one
  gesture 4501 -> 7201 = halfway up, user 2026-11-05) -> 8101 (Ridge Clinic, 5,000 m;
  scroll-driven since 2026-11-05, `#route-band` 400dvh, `climbRange`/`CLIMB_STOP_MS` in lib/payload.ts), speed stage
  8101 -> 9901 in one gesture (`LEG2_MS` 2600; the halfway stop was removed 2026-11-05) -> Summit Station card ( big figure = distance flown 0 -> 5.5 km; scroll-driven since 2026-11-05, HUD from the start
  of the stage, km/h from the drone's actual pace), then Section 03 from 9901 on the next gesture; 390×844 positions shift the same way. The positions below are for the old story bands.
- Jump to a state: `window.scrollTo(0, Y)`. At vh=900 (1440 wide, page scroll): opening low shot 0, hero frame 2701,
  delta end 7201, swarm 11701, mission 16201, (Journey, compressed: 16201 → 17551), Route 22051 (= band 2 start, wipe
  22051 → 24301), Care teams frame 26551, Hill clinic stop 27676, Ridge village stop (story end) 28801, stage gone
  29701, page height ~30325 (footer removed). Test snapping with real wheel events (agent-browser `mouse wheel`, not `scroll`).
- Up to the story end, same vh on reference and local gives identical scrollY ↔ scene mapping (verified before the
  homepage change; the later shipped chapters are no longer on the page).
- Built-in preview pane throttles RAF between tool calls: wait a few seconds before screenshots; FPS dips there are
  harness artifacts (recovers to 60fps).

## Raven drone asset / rotor contract

- `RavenModel` loads `raven_hexa.glb` (1.99 MB, 86k tris): the source's 11 JPEG maps kept byte-identical (lossless WebP of them was 6.6 MB, so they are not re-encoded) + Draco geometry; `KHR_texture_transform` is required. User rule: never resize or lossy-recompress Raven textures; keep source bytes or lossless WebP, whichever is smaller, and Draco. Draco quantization 16/12/16 (position/normal/texcoord). Sun-glint materials are matched by name in `Drone.tsx` (`GLINT_MATERIALS`).
- Hero lighting preset (`scene/hero-light.ts`, user's panel values, 2026-11-02): sun off, hemisphere sky fill 1.65, HDRI x0.65 rotated, grain 0.06, sharpen 0 in the opening, hero and Airframe; blends back to daylight over SWARM_SCENE 0-0.6.
- Live daylight (`scene/sunlight.ts`, written by `MainScene`, read by `RavenModel`): travel-driven sun/env heading sway, cloud shade on the directional light, facet sun glints. Reduced motion disables it. While the environment plate shows, `scene/plate-light.ts` takes over (see Open work). Rebuild the hexa from `glb/new-drone/README.md` (`prepare_hexa.mjs`, textures unchanged, Draco last, once); never edit the GLB by hand.
- Rotor selection lives in `scene/raven-rotors.ts`: the exact six names in `RAVEN_ROTOR_NAMES` (`Rotor_<Front|Mid|Rear>_<Left|Right>`), never a `Rotor_` prefix match. Pivots sit on the prop hubs (spin about local +Y) with `spin_direction` extras read from the source's own prop clips: FL/MR/RL CW, FR/ML/RR CCW (alternating round the ring). The nav point lights in the source are stripped. Spin rate 150 rad/s (`ROTOR_SPEED`); while spinning, `scene/rotor-blur.ts` hides the `PROP_*` blade/tip meshes and shows one blur-disc shader per pivot (sized to the measured tips; hub stays visible), because faster mesh rotation only aliases at 60 Hz. The disc draws two swept blade images (26 rad/s visible sweep since 2026-11-03, was 13; longer motion tail, random phase and ±15% sweep speed per rotor and per drone instance so the three drones never flash in step, real spin direction) and a sun flash computed from the live `sunlight.direction` against twisted/cambered blade normals (0.15-0.75 rad), so flashes ride on individual blades: streaks in the oblique hero, narrow sectors from above. Reduced motion: still rotors, real blades, no discs.
- `node scripts/check-raven-rotors.mjs` verifies pivots, positions, directions, child transforms, clone independence and web-asset parity.
- Hexa build commands: `glb/new-drone/README.md`. The quad's Blender build/QA/export commands (silhouette source): `glb/raven-quad/README.md`.

## Open work (see RECONSTRUCTION.md for full list)

- Leg 2 follows the scroll on desktop (feedback 2026-11-13: Ridge Clinic -> Summit Station, the green line, "scroll is too much and it is not on scroll ... should be same like [the climb]"). It was one 2.6 s snap per swipe (`LEG2_MS`); it is now a second free zone (`SmoothScroll` `freeZones`: [top, Ridge Clinic] and the speed band), same speed cap as the climb; wheel scale `CLIMB_SCROLL_SCALE.leg2` .72 (feedback 2026-11-13: "too fast ... increase one more scroll"): ~480 px per swipe, 4 swipes each way (was 3 at 1.0). Ridge Clinic stays a wall between the zones (a swipe or fling that reaches it ends there; the next one flies on) and Summit Station a wall before the Section 03 snaps. Touch phones keep their snap (no free zones there). Reverse (feedback 2026-11-13: "coming reverse it is taking too many scrolls in both lines") had a lower speed cap (1300 px/s, ~370 px per swipe); `FREE_MAX_SPEED` is now 2800 both ways (~667 px per swipe back too; a hard reverse fling glides at ~2,500 px/s, no jump, and stops at the Ridge Clinic wall). Jump back from Ridge Clinic after visiting Summit Station (feedback 2026-11-13): leg 2 eased home at 7/s while leg 1 already followed the scroll, so scrolling back past the clinic before the drone arrived teleported it ~30% down the route at the hand-off (measured 150 px in one frame). `DroneRig` now holds leg 1 at the clinic until leg 2 is home (`backFromLeg2`) and leg 2 eases at 30/s like leg 1; measured max 14 px/frame for repeat swipes 60-400 ms apart. Route card photos (`public/assets/route/*.webp`, ~40 KB, were 250 KB PNGs): preloaded at high priority, a failed load retries 3x (cache-busted) instead of hiding the photo for the visit (feedback: "sometimes these images are not loading").
- Phone stall at the end of Section 03 (2026-11-10, user on iPhone: "getting stuck at this point for 3-4 scrolls", screenshot = motor stop into Section 04). Cause: the closing CTA drone (`ClosingCtaDrone`, second WebGL context) mounted when its section came within three screens, which on a 390x844 phone is the last Hardware stop; mounting cost two main-thread stalls (354 + 461 ms at 4x CPU, dev build; GPU uploads/compiles on top on a real phone) and touch scroll is Lenis on the main thread, so the next swipes were lost. Now `ClosingCta` starts six screens ahead and waits for a reading pause before each half (`whenQuiet(CTA_QUIET_MS)` 800 ms: chunk, then canvas; `whenQuiet` takes an optional quiet time). Desktop (feedback 2026-11-13: the closing drone "is having delay"): steady scrolling never left an 800 ms pause, so it loaded only once the reader stopped at the section (canvas 2.1 s after arrival); desktop now skips the pauses (canvas ~5 s ahead, 6.5 screens) and phones mount at once within 1.5 screens even without a pause. Measured 390x844 4x CPU, swipes 0.6-2.5 s apart: both stalls land on the first Hardware stop in a pause, none overlaps a swipe; 11 swipes top -> bottom. Not checked on a real iPhone. Also seen: stops use `window.innerHeight` while Section 03's band is `100dvh` per feature; if a browser reports them differently (iOS toolbars), the stops drift (simulated +200 px: the Structure stop landed 756 px late). Not changed yet.

- Hero-frame hand-off (2026-11-10, reviewer feedback via user: "jitter or lag at this exact point", screenshot = hero frame). Measured per frame (camera + drone screen position vs scroll, slow wheel): (1) `applyOpening` blended the clip's roll in over the last 15% (slerp, smoothstep .85-1), swinging the drone up then down the screen (+5.7 -> -8.6 / 1e4 px) and reversing it at P (+4.9); now the clip's offset from the lookAt pose is taken at the hero pose and eased in along the whole path (`_qFix`, by u): the drone holds still on screen through the opening. (2) At P the camera stopped turning in one frame (1.06 deg/100 px -> 0) while the payload zoom set off at full speed: now they overlap over `HANDOFF_SHARE` .12 of the opening (lib/payload.ts): `openingEase`'s linear part brakes to rest (`linearEaseOutTail`) while `payloadZoomAt(page)` starts that many px before P from rest. No one-frame steps left; the hero frame itself is now passed through (zoom ~.02 at P), not a resting pose. Old: `scrollEase(p, PAYLOAD_TIMELINE.zoom)` (zoom entry now unused).
- Menu (2026-11-10, reviewer feedback: "the menu on the right side needs to be updated"): `MENU_LINKS` in Navbar lists every section: The delivery story, Payload, Altitude, Speed, Hardware (`#features-band` = first feature stop), Capabilities (`#capabilities`), Use cases (`#use-cases`), then Contact (contact modal, now on all sizes; was phones only). Checked 1440x860: each link lands with its section top at 0. Contact opens the modal over the still-open menu (as it did on phones).

- Climb speed cap (2026-11-09, user: a fast scroll back from Ridge Clinic "jumps" down the route; then "too many scrolls to go up"): the free route/climb cap is a speed per direction, `FREE_MAX_SPEED` up 2800 / down 1300 px/s, turned into a wheel lead at `FREE_LERP` (~260 / ~120 px). The old fixed 280 px lead was tuned at lerp .11; at .18 a reverse flick ran ~2,800 px/s and flew ~2/3 of the route in 0.5 s (forward, the Ridge Clinic wall stops it, so forward stays fast). Climb wheel scale `CLIMB_SCROLL_SCALE.climb` 1.0 (was .75). Measured 1440x866, in-page 16 ms wheel swipes: payload frame -> clinic ~3.5 moderate swipes (~1,000 px each on the climb); hard reverse flick ~1,200 px/s, no jump.

- Loader ETA (2026-11-09, user: "show how long it will take to load the site, not the complete site"; same day: show it sooner, fix the high first figure): time left until the reveal, computed by an inline script in the page HTML (`lib/load-eta.ts` `LOAD_ETA_SCRIPT`, injected in layout.tsx), so it shows from ~2-3 s on Slow 4G instead of after hydration (~6.7 s); the status line fades in by CSS (`.loader-status-in`), the figure is `#load-eta[data-eta]` drawn by CSS. React reports phases via `window.__ravenEta` (`markSceneCodeLoaded` in FixedContainer, `markPreparing`/`markRevealed` in Loader). Model: (1.92 MB before the reveal - received) / rate + 4 round trips until the scene JS is in + 3 s prepare (+0.8 s full-map wait on fast links); rate = max(measured, 0.8 x `navigator.connection.downlink`), received = max(finished bytes, rate x elapsed). Checked on `next start`: Slow 4G first figure ~18 s at 2.9 s, reveal 14.9 / 16.3 s later; Fast 4G ~6 s at 1.9 s, reveal 6.4 s later. Safari/Firefox have no `navigator.connection` (measured rate only; not checked). Re-measure `totalBytes` if the bundle or first-frame assets change much; meaningless on `npm run dev`.
- Phones (2026-11-06, user): the hero headline flows as one paragraph below 640 px, so it reads in three lines ("The road goes / around. Raven / goes over.", checked 320-430 px; one line per sentence from sm). The sensor render fades to black at its bottom on phones (`fadeBottom` 62 + `aspect` in `lib/features.ts`, `.feature-img-fadeb` in globals.css): its own bottom edge cut through the medical box.
- Phone fixes (2026-11-06, user): Section 03's render band is kept clear of the heading and card (`--head-bottom` /
  `--card-top` measured in FeatureSection, CSS `max()` with the old 28% / 36%), plus tighter type at max-height 720 px;
  checked 390x844 and 360x640. (A phone drone-edge change, sharpen off + 4 MSAA, was reverted the same day: user found
  the drone too blurry.)
- Phone snap response (2026-11-06, user: hero snap "delaying, late response" on mobile): a swipe's snap starts at the
  finger's pace (`touchVel`, at least 60% of cruise, `touchLaunch`) without waiting for Lenis' touch inertia, and the
  opening/payload snaps run `PHONE_STAGE_SPEEDUP` 1.7x faster on touch phones. Measured 390x844, 250 px CDP swipe:
  moves on the first frame after touchend (was a dead stop + 220 ms ramp); lands 1.1-1.5 s after the lift (was 2.0-2.6).
- Section 03 indicator (2026-11-06, user: "make this clickable"): STRUCTURE / SENSOR / MOTOR are buttons
  (`.feature-nav-btn`, `goTo` in FeatureSection) that ease to that feature's stop (Lenis scrollTo 0.8 s, band top +
  i x viewport height); labels two away stay hidden and unclickable. Checked 1440x900 click and 390x844 tap.
- Phone pan to Summit Station (2026-11-06, user: the next stop was cut off on mobile): portrait < 768 px, the mountain view window pans right with the drone once it passes 60% of the width (`MOBILE_FOLLOW` / `mobilePan` in DroneRig, on top of the zoom view offset; Ridge Clinic at ~54% so the climb frame is unchanged) and back as it returns. Site cards slide on their stem near an edge only as they open (`placeClinicPin` dx x open), so the closed Ridge Clinic pin stays on its stem at the left edge.
- Phone stage stops (2026-11-06, user: "taking too many scrolls" on mobile): touch phones have no free zone
  (SmoothScroll `touchPhone`, from the `(max-width: 768px) and (pointer: coarse)` query); the climb plays its two band
  stops (halfway, Ridge Clinic). 390x844 with 400 px touch flicks: 6 swipes top -> Section 03 (was 12). Desktop keeps
  the free climb. Payload camera ends at `radiusPortrait` 1.05 x the hero distance on portrait screens (0.86 landscape)
  so the rotor rings stay inside a phone's width (checked 360/390/430 px).
- Closing CTA framing (2026-11-06, user): section `clamp(560px, 76dvh, 860px)` on desktop (was 100dvh), phones
  `clamp(460px, 135vw, 100svh)`; the camera fits the drone to width (`fill` .64, phones `fillPortrait` .85) or height
  (`fillHeight` .7 of the section, drone ~1.15 units tall), whichever is tighter (ClosingCtaDrone `VIEW`).
- Section 03 on phones (2026-11-06, user: "images are very big"): each render is contained (whole, ~390x240) in a band
  between the heading and the card (`.feature-frame` top 28% / bottom 36%, edge fade), was full-bleed cover.
- Mobile pass (2026-11-06, see RECONSTRUCTION.md "Mobile pass"): 390x844, 360x640 and 844x390 checked headless; feature frames isolated, phone callouts at the bottom, hero drone 1x on phones, landscape-phone hero/Section 03/site-card fixes. Not checked on real iOS/Android devices or 768-1023 portrait tablets.
- Section 04 video panel (2026-11-06, user: "previously it is cropped, increase the height a little"): `.caps-panel` min-height = width / 2.2 (was ~2.65:1 at 1440x900), `.caps` min-height one screen and grows past it when needed (934 px at 1440x900).
- Sections 03/04 (2026-11-04, user Figma): Section 03 redesigned 2026-11-05 to the user's "Feature 7/8" mockups (heading "Engineered for Performance. Built for Reliability.", compact card bottom right with the user's copy, BUILT/SENSOR/MOTOR indicator on the right; `lib/features.ts` FEATURE_*). The heading lines and line below fade up (blur 6px -> 0, staggered .12 s) once 35% of the stage is in view, and again on each re-entry. Renders are the user's `raven-drone-site/src/hardware` images (flattened on black, WebP); Renders are shown at 0.74x, a little below centre, with a radial edge fade (globals.css `.feature-frame`); `frame` in FEATURES nudges the motor up/left. Switching: the old render fades out in 0.2 s while the new one fades in over 0.4 s (user: fast, no old image behind) and the card copy for every feature sits in one grid cell (`.feature-stack`), so the card height never jumps (was AnimatePresence popLayout, which glitched). Not checked on Safari/iOS touch.
- Section 05 + closing CTA (2026-11-05, user mockups): `sections/UseCases.tsx` (three photo cards, the user's
  1088x1120 originals from raven-drone-site/src/usecases as JPEG q86; NDRF India uniforms and Red Cross emblems:
  confirm rights) and `sections/ClosingCta.tsx` ("Make your product impossible to scroll past."; Talk to us -> https://sixjuly.com/contact/ since 2026-11-10, was the contact modal) over
  the tundra-terrain footer landing drone (`sections/drone-flight.ts` restored from 98b052b; `RavenModel realLook`
  skips the payload vector sweep; descent is one eased curve over 3.4 s, starting nearer, triggered at 5% visible with the canvas rendering a screen ahead, not the old ease-out drop). Framing checked at 1440x900 only (reduced-motion pose); glide-in not seen at 60 fps.
- Site cards (2026-11-05, user mockup; 2026-11-06 second mockup: portrait photo on top, name centred below, `card()` in RouteCallout, desktop 140 wide with a 120x130 photo, phones < 768 px 112 wide `CARD_PHONE` (user: smaller, 2026-11-06; opaque and above its stem); was 300x92 photo left + name right, phones 196x60; the photos are only 128 px, so they look soft at this size) a site pin opens into a photo + name card when the drone
  arrives (`ClinicPin`/`placeClinicPin` in `overlays/RouteCallout.tsx`): Ridge Clinic at the end of the climb (folds
  back as the speed flight leaves), Summit Station at the end of the speed flight. Photos are the user's
  (`public/assets/route/ridge-clinic.png`, `summit-station.png`, 128 px, from `raven-drone-site/src/img1.png`/`img-2.png`).
  The Summit Station photo shows the Red Cross emblem; confirm use rights before a public deploy.
- Mountain views slide left by `MOUNTAIN_ZOOM` 1.12 toward (0.5, 0.62) and `MOUNTAIN_SHIFT` (8% of the width since 2026-11-06, user: the massif still ran under the right-hand callout; was 13%, 8%, 4.5%, DroneRig, camera view offset eased in with the
  pull-back; landscape >= 768px only) so the right-hand callout block does not cover the massif (user 2026-11-05).
- Free zone (2026-11-05, user: scroll follows the gesture and stops where it stops; the hero part was reverted to
  snaps the same day; 2026-11-06, user: hero -> payload was "sticky", "should scroll immediately": then "still too sticky": the
  free zone starts at the top of the page (`freeStart` 0: the opening is no longer a 2.5 s glide that swallowed scrolls),
  wheel x`CLIMB_SCROLL_SCALE.payload` 1.4 (was 1.8; user: "too fast" after the lerp change) up to the payload frame, `FREE_LERP` .18
  (was .11); then "smooth but some delay": up to the payload frame Lenis runs at `PAYLOAD_LERP` .24 (.3 was too fast) with lead cap `PAYLOAD_MAX_LEAD` 300 (was .18 / 460; set per wheel step in virtualScroll; measured headless 60 fps: one notch reaches 90% in ~150 ms, was ~200, drift after a swipe ~170 ms, was ~300; a swipe travels ~20% less); desktop only, touch phones keep snaps): top of the page -> Ridge Clinic has no snap stops (`isFree`/`freeStart`/`freeEnd` in
  SmoothScroll; Lenis lerp .11; wheel/touch distance x`CLIMB_SCROLL_SCALE` 1.1 in the pull-back, .75 on the climb, speed capped by `FREE_MAX_LEAD` 280 px of wheel lead). Both ends are soft walls (`freeWall`: the swipe that hits one ends there). Opening,
  hero -> payload, the Summit Station leg and Section 03 still snap.
- Camera curves for free scroll (2026-11-06, user: "still some slow, snap-like effect"): `openingEase`, the payload `zoom` (`scrollEase` in lib/payload.ts) and `applyRouteCamera` are 65% linear + 35% smootherstep. Their ease-outs, tuned for the old glides, left ~500 px of scroll at each stage end where the camera hardly moved (opening 3% over its last fifth, payload zoom 5% over its last 30%), which read as a snap around the payload frame.
- Scene density (2026-11-05, user: "the mountain is jumping"): PerformanceMonitor changes wait while the page is
  between the payload frame and Summit Station and apply on leaving; after a first step down the density never climbs
  back (FixedContainer `useSceneResolution`). The route flight follows the scroll with the camera's smoothing
  (DroneRig damping 30/s, was 4.5: the drone lagged the camera on fast scrolls).
- Wheel gestures are classified once per event in a shared tracker (`classifyWheel`/`G` in SmoothScroll), used by both
  Lenis' virtualScroll hook and the snap controller: the momentum of a swipe that landed a stop is blocked from the
  free climb too (it used to fling the drone back down the route after Summit Station -> Ridge Clinic).
- Loader match cut (2026-11-05, user): the loader no longer shows the traced boot SVG or `loading-drone.glb`; it draws
  the real `raven_hexa.glb` as a flat silhouette through the main camera, on a canvas laid over the main canvas
  (`lib/boot-pose.ts`, written by a priority-99 frame hook in DroneRig while the loader is up), so the reveal turns the
  silhouette into the lit drone in place. The pose is taken once (and after a resize), so the silhouette stays still
  (user: it shook with the live hover). (`loader/boot-shape.ts` and `loading-drone.glb` were removed 2026-11-05.)
- Camera shake (DroneRig `CameraShake`): the intro scene stays "active" for the whole payload page, so its hero
  shake ran on in the payload, mountain and speed views (the 20 deg lens made it a visible bob of the massif, user
  2026-11-05). It now fades out over payload progress 0 -> .3 (`stageCalm`); measured 0 deg per frame after it.
- `routeFlight` (lib/payload.ts) maps the whole free climb evenly onto the route (it was still split at the removed
  halfway stop: the last quarter of the scroll flew half the route, so the drone shot down from Ridge Clinic).
- Load time (2026-11-05/06, user: Slow 4G took ~2 min, DevTools "Finish" must be ~20 s; low-res first, then full).
  DevTools Slow 4G on `next start`, cold cache, ONE tab (other WebGL tabs skew it by ~6 s): "Ready" 13.0 s, Finish
  25.4 s, 3.9 MB total (was Finish ~75 s / ~15 MB). Fast 4G: Ready 4.3 s, everything (4K + variants) by 13.5 s.
  `npm run dev` ships ~10.7 MB of unminified JS: never judge load time on the dev server.
  - Connection-adaptive final quality (user choice 2026-11-06, "drone full + ground 2K"): a page whose scene took
    past `SLOW_PAGE_MS` (8 s) is a slow link: drone originals, then the ground's 2K map on every tile, then stop.
    Fast links: drone originals, 4K land map, tree-variant maps b/c (unchanged final look). Terrain.tsx `slowLink`.
  - Previews: `raven_hexa-lite.glb` (same geometry/JSON, 11 maps as 256 JPEG, `images[].extras.full`) and
    `raven-terrain-lite.glb` (512 land map). Originals: `raven-hexa-maps/` = the GLB's JPEGs re-packed losslessly by
    jpegtran (decoded pixels verified identical, ~15% smaller), `raven-natural-a.webp` (4K, byte-identical),
    `raven-natural-a-2k.webp`. Scripts: `scripts/split-raven-hexa.mjs`, `scripts/split-raven-terrain.mjs` (re-run after
    rebuilding `raven_hexa.glb` / `raven-terrain.glb`, which stay in `public/` as sources and are not fetched).
  - `scene/hd-assets.ts`: one-at-a-time queue, paused until MainScene's first frame (`startHd`). `upgradeGltfMaps`
    puts the original into the shared texture `Source` and calls `dispose()` + `needsUpdate` (three's immutable
    texStorage otherwise keeps the preview size: GL_INVALID_VALUE). Decodes match GLTFLoader's ImageBitmapLoader
    (`premultiplyAlpha` and `colorSpaceConversion` "none"). `performance` marks `raven-hd-<priority>` time each step.
  - Never downloaded on this page (only when first shown): city tile + `terrain.glb` + buildings (Terrain `needCity`),
    Journey flock + grid (MainScene `FlockPortal` `enabled`), clay-map markers (ClayFlight, troika + GeistMono TTF).
  - Mountain build starts when the tile GLB is in (FixedContainer `MountainPrebuild`, `sharedMountainSlices`).
  - JS: first-load 445 -> 159 KB. Loader DOM is server-rendered (three.js silhouette: `loading/MatchCutCanvas.tsx`,
    dynamic). Closing CTA drone (`sections/ClosingCtaDrone.tsx`) loads within three screens of the section.
  - Section by section: feature renders lazy, Section 04 clips/posters on `near`, use-case photos lazy, CTA drone on
    `near`. Not fetched in mountain mode: opening panorama, flat grid. First-frame files hinted from the HTML
    (`layout.tsx`); Inter Tight / DM Mono not preloaded. Removed as dead: `loading-drone.glb`, `boot-shape.ts`,
    `sections/Sections.tsx`.
- Scroll response (2026-11-06, user: opening -> hero "not responding immediately, delay, then scrolling"). Measured
  with real (trusted) wheel input in Playwright on the M5 GPU and Slow 4G: the snap starts in 75-115 ms; the delays
  were (1) input ignored for the ~0.9 s loader fade (scroll now unlocks at `loadingCanvasIsHiding`, SmoothScroll
  `scrollUnlocked`), (2) one-off GPU work landing mid-move: full-quality texture uploads (up to 167 ms) and the loader
  canvas teardown (~100 ms). Both now wait for `lib/quiet.ts` `whenQuiet` (300 ms without scroll input); the loader
  canvas stays mounted, paused and invisible until then. Testing note: Playwright/CDP wheel calls arrive with 180-220 ms
  gaps, which the gesture classifier rightly reads as a second swipe (one swipe then plays two stops); use in-page
  WheelEvents on a 16 ms clock or a single notch to test chaining.
- Hold stops (2026-11-05, user): Ridge Clinic (climb end) and Summit Station (speed end) are never chained past, and
  wheel input pauses for `HOLD_MS` 350 after landing there; a new scroll in the pause plays when it ends (`isHoldStop`).
- Snap feel (2026-11-05, SmoothScroll): moves reach cruise in `SNAP_START_MS` 180 ms (responsive), brake over a share
  of their length (`SNAP_EASE_SHARE`, max 1.1 s), keep one pace per move; a scroll during a move queues the next stop
  (played once the move is `CHAIN_AFTER` .35 done); `GESTURE_GAP_MS` 120. Swipe detection (`classifyWheel`, user 2026-11-05 "sometimes I have to do many scrolls"): a new swipe counts when deltas rise twice from the previous tail's low point (was: only once that tail fell under 30% of its peak), and a continuously spun mouse wheel starts a new gesture every `RESWIPE_MS` 1.2 s. Test swipes with in-page WheelEvents on a
  fixed 16 ms clock: CDP wheel events arrive with >1 s gaps while a stage first loads and fake new gestures.
- Contour flow (2026-11-05, user; 2026-11-06: "only from bottom of the mountain to top"): a glow front climbs the `net` massif by terrain height from the h 40 contour (`foot` 38.5; user: the lines below it read as ground, they never light; first try started at h 14) to above the summit (h 86), lighting the contours one after another (`CONTOUR_FLOW` in `scene/net-terrain.ts`: 4.2 s rise, 5.4 s cycle; frozen under reduced motion). Was a screen-height front from the bottom edge, which lit the foreground ground first.
- Mountain stage: the section's pointer tilt is off and its idle sway is .04 rad (was .12), hover glow halved (user:
  the mountain jumped with mouse moves while scrolling).
- Payload page (2026-11-03): the route stage has no speed/distance figures yet (waiting on the user). Not checked on Safari/iOS or low-end GPUs; the callout's leader line crosses a front
  rotor at 1440×900; the vector form is a shader switch on the real hexa (no separate low-poly model). Old story code
  (bands, wipe, clay landscape, chapters) is unreachable but not removed.

- Homepage layout (2026-10-30): hero composition and bar follow `asset/html/raven_homepage.html` (local only); its
  map section was replaced by story band 2 (user). The reference's specs (prop size, km/h, AGL, kg, ETA, altitudes)
  were not carried over. The `#parts` live close-up track was removed on 2026-11-01 (user); the diagonal wipe now
  joins the bands. The fire sprites, thermal HUD/palette box and the thermal/fire copy and HUD lines were deleted (2026-10-31); the thermal and ignition scenes still exist in story coordinates because later scenes read their progress.

- Clay map (user, 2026-11-02, after the `net` section of `asset/html/raven_homepage.html`): band 2's map is a clay
  landscape (`scene/ClayTerrain.tsx`, `scene/clay-map.ts`; the terrain tiles hide while it shows). Care teams opens on
  a low camera on one mountain raised out of our real Raven relief (its ridges are the tile's own, no noise or
  texture); over early Review the camera hands back to the shipped track and the relief settles to real heights. Still open with the user: pins/routes like
  the reference, the flat overlays in the landscape view.
- Raven follow-up: all jet imagery is replaced (silhouettes, mission cards, demo). The footer and its "RAVEN" wordmark were removed (2026-11-03). The third-party team-logos texture, the USAvionix legal copy and the Notes link were removed. Preserve current camera/scroll choreography.
- Story/content Phase 1 is done (copy only, 2026-10-30): one illustrative health-centre → hill-clinic delivery across chapters, HUD, scene labels, nav, menu and sections. Inventory and claim status: `RAVEN_CONTENT_MAP.md`. Chapter/HUD text lives beside its timing (`ChapterCopy.tsx`, `HudLog.tsx`); repeated notice/CTA copy lives in `src/lib/copy.ts`. Keep labels display-only: no fake confirmations ("delivered", "clinic notified", "cold chain maintained"), no numbers (temperature, confidence, speed).
- Story Phase 2 (visual, plan only): `RAVEN_VISUAL_STORY_PLAN.md`. The fire/thermal detour is the main replacement candidate; preparation, launch, handoff and return are not animated yet. Product decisions D1–D5 in that file are open.
- Quad site-imagery renders (`glb/raven-quad/render_media.py` + `encode_media.mjs`: cards, demo, 96 landing frames) are no longer used by the page; their outputs were deleted in the 2026-10-31 cleanup.
- Raven terrain (default since 2026-10-30; v09 since 2026-11-01: the Windows look-dev file v08 baked as-is, i.e. v05 grass/cliff, v06 Poly Haven `aerial_grass_rock` lawns, v08 BlenderKit moss forest floor, and 24 Cottage_FREE cottages as 16-tri web proxies baked from the detailed model; 4K WebP q80, 2.85 MB; built on the Windows workstation by `glb/raven-terrain/12_v09_webport.py`, encoded on the Mac because Windows sharp fails. The v09 ground material lives only in that .blend, not in 09_lookdev_material.py; the Cottage_FREE (TurboSquid) licence is unconfirmed for a public GLB): natural tiles use `public/assets/models/raven-terrain.glb` (`Land-A` + `Houses`, v03 built by `glb/raven-terrain/build_all.py` then `encode.sh`, validated by `glb/raven-terrain/check_terrain.py`; rebuild/check commands in `glb/raven-terrain/README.md`). Same footprint, flat 2.189 rim and planar-UV contract as the shipped tile; houses ride each natural tile with their own `TerrainMaterial` (fog/scan). The city tile is still the shipped one (settlement/clinic tile not built). `DetectionPoints` heights come from `RAVEN_DETECTION_Y` in `scene/raven-terrain.ts` (re-sample with the checker if the relief changes). `?terrain=original` and `?plate=h00` use the shipped natural tile. Tree-layout variants (2026-11-02, user: groves must not
  repeat): `raven-natural-b/c.webp` from `glb/raven-terrain/13_tree_variants.py` (look-dev `raven-terrain-v11-treevariants.blend`),
  picked per tile by `ravenTileVariant` in `scene/raven-terrain.ts`; same hills/roads/houses, so those still repeat.
- Mountain terrain (default since 2026-11-03, user: "host this site in this link" = localhost:3100/; `?terrain=v09`
  shows the previous baked Raven tiles, `?terrain=original` the shipped tile; after everest.suraj.work; plan and open decisions D1-D6:
  `RAVEN_MOUNTAIN_TERRAIN_PLAN.md`; study: `research/everest/ANALYSIS.md`, local only). Phases 0-2 done: built in the
  browser from the Raven tile, no Blender: `scene/mountain-field.ts` (heightfield maths, no three.js) runs in
  `scene/mountain-terrain.worker.ts` (inline fallback), `scene/mountain-terrain.ts` makes the geometries and textures. Each natural tile shows its slice of one periodic
  4-column x 6-strip heightfield = old relief + domain-warped ridged noise (3 ridges per tile, 7 octaves, droplet
  erosion for gullies; user reference 2026-11-03: the Everest site's high-country frame), pinned to the old ground
  around houses, village scans and detection anchors (so `RAVEN_DETECTION_Y` and the houses still fit), soft-capped at
  local ~34 under the measured flight path (drone 1 at map y 2.5, opening camera 2.13: `?probe=terrain`,
  `scene/TerrainProbe.tsx`). Tiles swap slice per strip like the tree variants. `materials/MountainMaterial.ts`
  extends `TerrainMaterial` (fog, panorama, scan wipe unchanged; the drone shadow on terrain and clouds was removed 2026-11-03, user): the vertex shader scales the
  mountain part up away from the corridor (|x| > 13, far ahead) for horizon peaks; the fragment reads the baked map as
  land use and recolours it as grey-brown high country (turf, moss, heath, lichen; forest only below a low treeline;
  scree, strata rock, snow above a noisy snowline with streaks down steep faces and blue-grey shade), with procedural
  rock + micro normal maps applied triplanar (Everest `_rkF`/`_m1`), lit by a low 17 deg warm terrain sun with ray-marched
  cast shadows. Lens: `TERRAIN_TOP` -0.4 plus
  "beyond 1.8x focus = terrain" in mountain mode only. Build ~1.6 s in the worker on a production build (160
  segments; mobile 96), main thread free; old tiles show until ready. Not done: villages (phase 3, needs D4), instanced trees
  (phase 4), horizon DEM (D5); houses still repeat per tile; shadows ignore the horizon lift. Far ranges in the
  opening: `scene/MountainRanges.tsx` (3D ridged band r 55-200 around the origin, lit by the terrain sun, snow per
  vertex, aerial haze + valley haze up to y ~22) replaces OpeningSky's ridge rings and Blender land layer in mountain
  mode; the terrain's opening fog then goes to the sky colour (`uPanoMix` 0).
- Environment plate prototype (opt-in `?plate=h00`, `scene/HeroPlate.tsx`): three Seedance clips of one flight behind the drones. Hero loop `raven-h00-loop.mp4` (time-driven); Airframe tilt `raven-s01-airframe.mp4` (all-intra, scrubbed: DELTA_DRONE progress -> measured camera pitch -> clip time, flow-map drift when idle); Connection `raven-s02-connection.mp4` (straight down past the health centre, plays from frame 0 when the tilt ends, then loops 5.5-12.04 s so the building never repeats). Fades to live terrain at the end of SWARM_SCENE; shader adds parallax, motion blur and haze on oblique views. The live terrain moves away from the camera (it retreats ahead of the drone): prompts must say the ground recedes toward the top of the frame. While it shows, `scene/plate-light.ts` swaps the drone to plate-matched light (high late-morning sun beyond the frame, hazy sky, the plate's own terrain as reflected ground) instead of the sunset `env.exr`. The sun casts soft shadows (2048 PCF) on the drones only: its shadow camera is refitted around `Drone1Group` in `MainScene`; terrain is unlit and never receives. Brief: `RAVEN_ENVIRONMENT_FILM_SEEDANCE_PROMPT.md`; sources in `research/raven-film/h00/` (local only).
- Terrain lens (`scene/TerrainLensEffect.ts`, first EffectPass after the RenderPass in `PostFX.tsx`): depth-reconstructed motion blur (terrain travel + camera reprojection, 1/30 s shutter) and thin-lens DoF focused on `Drone1Group`, applied only below world y -1.55 so drones stay sharp. Exaggerated for a high-speed look (travel streak x`SPEED_GAIN` 1.5, cap 9 px since 2026-11-02, user: was too strong at 3 / 16; `COC_INF_PX` 5, rising to 60 in top views only with an eased blend, disc cap 14 px since 2026-11-02: drone-focused depth of field, user): tune those constants in `PostFX.tsx`. Anything drawn after the terrain must not write depth (the clouds did, which hid the ground from the lens). `?lens=off` disables it. If drones ever fly lower or the terrain parent moves, re-check `TERRAIN_TOP`.
- Silhouette assets: `drone-lowpoly.glb` (nodes `mainBody` + `outlineHull`, jet axis contract) and `loading-drone.glb`; the boot SVG is traced to sit over the 3D loader. Rebuild with `glb/raven-quad/build_silhouettes.py` (see its README section).

1. Loader is a stand-in for the worker OffscreenCanvas (chunk 4867 not captured).
2. 821×1109 capture set and upward-travel checks for every chapter not done; no image-diff tooling yet.
3. Phosphor icons are stand-ins; menu links are `#`.
