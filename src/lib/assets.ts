/** Local copies of the reference asset paths (shipped module 25621). */
export const ASSETS = {
  blueNoise: "/assets/textures/terrain/bnoise.png",
  cityTexture: "/assets/textures/terrain/city.webp",
  terrain: "/assets/models/terrain.glb",
  cityTerrain: "/assets/models/city-terrain.glb",
  /**
   * Raven natural tile Land-A + Houses (glb/raven-terrain/). Load time (2026-11-05): the GLB carries a 512 preview of
   * the land map; the 4K map (same bytes as in the full GLB) is `ravenLandMap`, swapped in after the reveal
   * (scripts/split-raven-terrain.mjs).
   */
  ravenTerrain: "/assets/models/raven-terrain-lite.glb",
  ravenLandMap: "/assets/textures/terrain/raven-natural-a.webp",
  /** 2048 step between the GLB preview and the 4K map, slow links only (2026-11-06). */
  ravenLandMap2k: "/assets/textures/terrain/raven-natural-a-2k.webp",
  building: "/assets/models/building.glb",
  grid: "/assets/models/grid.glb",
  gridCity: "/assets/models/grid-city.glb",
  /**
   * Hexacopter medical drone (6 props); source glb/new-drone/. Load time (2026-11-06): the lite GLB has the same
   * geometry with 256 previews of its 11 maps; the originals (raven-hexa-maps/, byte-identical to raven_hexa.glb's)
   * are swapped in after the reveal (scripts/split-raven-hexa.mjs, scene/hd-assets.ts).
   */
  // Draco re-quantized (position 12 / normal 10 / uv 10 bits; was 14/10/12 default): 444 -> 306 KB gzipped, same JSON,
  // maps and extras.full links (load time, user 2026-11-14 "in android also load it fast"); renamed for the day cache.
  raven: "/assets/models/raven_hexa-lite-q.glb",
  droneLowpoly: "/assets/models/drone-lowpoly.glb", // Raven silhouette, same node/axis convention as delta-lowpoly
  cameraAnimations: "/assets/models/camera-animations.glb",
  cameraAnimationsMobile: "/assets/models/camera-animations-mobile.glb",
  droneAnimations: "/assets/models/drone-animations.glb",
  droneAnimationsMobile: "/assets/models/drone-animations-mobile.glb",
  noise: "/assets/textures/fx/noise.webp",
  openingLand: "/assets/textures/environment/raven-opening-land.webp", // glb/raven-sky/01_opening_panorama.py (land)
  // Sky lighting (drone reflections only), 256x128 half float, ZIP, low 4 mantissa bits rounded off: 71 KB (user
  // 2026-11-14: "not loading in mobile" / "load it fast"). Was env.exr (1024x512, DWAA, 149 KB): three's JS DWAA decoder
  // froze Safari's main thread 21-27 s during loading (WebKit, every run); ZIP decodes in ms everywhere. The drone looks
  // the same in side-by-side shots (PMREM blurs it anyway).
  env: "/assets/textures/environment/env-256.exr",
  /** Geist Mono (OFL, from the `geist` package) for WebGL labels on the clay landscape (ClayFlight). */
  geistMono: "/assets/3d-fonts/GeistMono-Regular.ttf",
} as const;

export const DRACO_PATH = "/draco/";
