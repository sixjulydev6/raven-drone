"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useKeyboardControls, useTexture } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { ASSETS } from "@/lib/assets";
import {
  RENDER_ORDER,
  resolution,
  TERRAIN_SCALE,
  terrainOffset,
  terrainRamp,
  terrainTravel,
  terrainWrapped,
} from "@/lib/constants";
import { easeInOutCubic, lerp, remap, remapEased, wrap } from "@/lib/math";
import { SCENE, scenes, type SceneId } from "@/lib/scenes";
import { isScrollLocked } from "@/lib/scroll-lock";
import { openingNow } from "@/lib/story-map";
import { useLoading } from "@/lib/loading";
import { useMediaQuery } from "@/lib/use-media-query";
import { useRenderScale } from "@/lib/render-scale";
import { MountainMaterial } from "./materials/MountainMaterial";
import { CLAY_FOG_PAYLOAD, CLAY_FOG_SIDE, payloadClayUniforms, TerrainMaterial } from "./materials/TerrainMaterial";
import { PAYLOAD_TIMELINE, payloadLook } from "@/lib/payload";
import { forgetMountainSlices, mountainSlice, sharedMountainSlices, mountainTerrainEnabled, type MountainSlices } from "./mountain-terrain";
import { getNoiseTexture } from "./textures";
import { openingEase } from "./opening";
import { useOpeningPanorama } from "./OpeningSky";
import { DetectionPoints } from "./DetectionPoints";
import { RAVEN_DETECTION_Y, RAVEN_TILE_MAPS, ravenTileVariant, terrainVariant } from "./raven-terrain";
import { useGLB } from "./types";
import { HD_PRIORITY, hdSettled, queueHd, whenQuiet } from "./hd-assets";
import { clayOn, clayState } from "./clay-map";
import { TerrainProbe, probeEnabled } from "./TerrainProbe";

/** Longest the loader waits for the drone/terrain originals after the mountain build (then reveals on the previews). */
const FULL_MAP_WAIT_MS = 800;
/** Page time after which the reveal no longer waits for the 4K map (fast links are ready in ~3-5 s). */
const SLOW_PAGE_MS = 8000;

/** Distance between tile origins (shipped `X`). */
export const TILE_STEP = 2 * TERRAIN_SCALE * 200 - 0.01;
/** Altitude stage: lift (x the mountain part) of the ridges the drone flies toward, so the side view shows them taller. */
const ALTITUDE_RISE_LIFT = 8;
/** The shipped canvas dpr ([1, 1.5], clamped device ratio), which the travel speed was tuned against. */
const TRAVEL_DPR = typeof window === "undefined" ? 1 : Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5);

type FogValues = {
  uFogStart: number;
  uFogEnd: number;
  uFogDensity: number;
  uFogExponent: number;
  uFogBlendFactor: number;
};

/** Fog keyframes per scene (shipped `z`/`k`). */
const FOG: Partial<Record<SceneId, FogValues>> = {
  [SCENE.INTRO_SCENE]: { uFogStart: 12, uFogEnd: 32, uFogDensity: 1, uFogExponent: 1, uFogBlendFactor: 0.5 },
  [SCENE.DELTA_DRONE]: { uFogStart: 12, uFogEnd: 36, uFogDensity: 0, uFogExponent: 1, uFogBlendFactor: 0.5 },
  [SCENE.FLOCK_SCENE]: { uFogStart: 24, uFogEnd: 32, uFogDensity: 1, uFogExponent: 1, uFogBlendFactor: 0.2 },
  [SCENE.THERMAL_IRREGULARITY]: { uFogStart: 36, uFogEnd: 56, uFogDensity: 1, uFogExponent: 1, uFogBlendFactor: 0.2 },
  [SCENE.IGNITION_VERIFIED]: { uFogStart: 36, uFogEnd: 56, uFogDensity: 0, uFogExponent: 1, uFogBlendFactor: 0.2 },
};
const FOG_INTRO_MOBILE: FogValues = { ...FOG[SCENE.INTRO_SCENE]!, uFogStart: 16 };
/**
 * Raven opening: the low shot looks across the ground, so fog thickens to full sky colour before the tiles end
 * (opening tiles reach ~48 units) and the far ridges (OpeningSky) rise out of the haze. Blends out to the scene fog
 * by the hero frame.
 */
const FOG_OPENING: FogValues = { uFogStart: 9, uFogEnd: 40, uFogDensity: 1, uFogExponent: 1.25, uFogBlendFactor: 0 };
const FOG_KEYS = Object.keys(FOG_OPENING) as (keyof FogValues)[];

type FogStep = { scene: SceneId; start?: number; end?: number; from: FogValues; to: FogValues; always?: boolean };

function applyFog(material: TerrainMaterial, steps: FogStep[]) {
  const state = scenes();
  for (const { scene, start = 0, end = 1, from, to, always } of steps) {
    const p = state[scene].progress;
    if (!(p > 0 || always)) continue;
    const u = material.uniforms;
    u.uFogStart.value = remap(p, start, end, from.uFogStart, to.uFogStart);
    u.uFogEnd.value = remap(p, start, end, from.uFogEnd, to.uFogEnd);
    u.uFogDensity.value = remap(p, start, end, from.uFogDensity, to.uFogDensity);
    u.uFogExponent.value = remap(p, start, end, from.uFogExponent, to.uFogExponent);
    u.uFogBlendFactor.value = remap(p, start, end, from.uFogBlendFactor, to.uFogBlendFactor);
  }
}

function fogSteps(isMd: boolean): FogStep[] {
  const intro = isMd ? FOG[SCENE.INTRO_SCENE]! : FOG_INTRO_MOBILE;
  return [
    { scene: SCENE.INTRO_SCENE, from: intro, to: intro, always: true },
    { scene: SCENE.DELTA_DRONE, from: intro, to: FOG[SCENE.DELTA_DRONE]! },
    { scene: SCENE.FLOCK_SCENE, start: 0.5, end: 1, from: FOG[SCENE.DELTA_DRONE]!, to: FOG[SCENE.FLOCK_SCENE]! },
    { scene: SCENE.THERMAL_IRREGULARITY, from: FOG[SCENE.FLOCK_SCENE]!, to: FOG[SCENE.THERMAL_IRREGULARITY]! },
    { scene: SCENE.IGNITION_VERIFIED, from: FOG[SCENE.THERMAL_IRREGULARITY]!, to: FOG[SCENE.IGNITION_VERIFIED]! },
  ];
}

function Buildings({ material }: { material: THREE.Material }) {
  const { nodes } = useGLB(ASSETS.building);
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (ref.current) ref.current.visible = (scenes()[SCENE.IGNITION_VERIFIED]?.progress ?? 0) < 0.25;
  });
  return (
    <group dispose={null}>
      <mesh ref={ref} rotation={[0, Math.PI, 0]} geometry={nodes.Buildings.geometry} material={material} />
    </group>
  );
}

type TileProps = {
  position: [number, number];
  geometries: [THREE.BufferGeometry, THREE.BufferGeometry];
  material: THREE.Material;
  isCity?: boolean;
  withPoints?: boolean;
  desktopOnly?: boolean;
  /** Raven natural tile: its village rides the same moving tile group (not drawn on the city tile). */
  houses?: { geometry: THREE.BufferGeometry; material: THREE.Material };
  detectionY?: readonly number[];
  /** Raven tree-layout variants: the tile picks one by column and ground strip (see `ravenTileVariant`). */
  variants?: readonly THREE.Material[];
  /** Mountain terrain (`?terrain=mountain`): the tile shows its super-tile slice for its column and ground strip. */
  slices?: MountainSlices | null;
  /**
   * City tile only: the natural mountain look used in the altitude and route side views, which see this tile from
   * afar; the shipped city ground has no mountain part, so it read as a flat hole between the raised ridges.
   */
  sideNatural?: { variants: readonly THREE.Material[]; slices: MountainSlices } | null;
};

/** Tile rows the wrapped travel has advanced: a ground strip keeps its variant when the tiles jump back a row. */
function wrapsTravelled() {
  return Math.round(((terrainOffset.current || 0) - (terrainWrapped.current || 0)) / TILE_STEP);
}

/** One terrain tile (shipped `K`); slides in -z by the wrapped travel offset. */
function Tile({
  position: [col, row],
  geometries,
  material,
  isCity,
  withPoints,
  desktopOnly,
  houses,
  detectionY,
  variants,
  slices,
  sideNatural,
}: TileProps) {
  const is2xl = useMediaQuery("(min-width: 1536px)");
  const ref = useRef<THREE.Group>(null);
  const land = useRef<THREE.Mesh>(null);
  const buildings = useRef<THREE.Group>(null);
  const z = TILE_STEP * row;
  const x = TILE_STEP * col;
  useEffect(() => {
    if (!ref.current) return;
    ref.current.scale.setScalar(TERRAIN_SCALE);
    ref.current.position.x = x;
    ref.current.position.z = z;
  }, [x, z]);
  useFrame(() => {
    if (!ref.current) return;
    ref.current.position.z = z - (terrainWrapped.current || 0);
    // The side views (altitude, route) see the whole field from afar: the wide-screen-only tiles fill it there too.
    if (desktopOnly) ref.current.visible = is2xl || payloadLook().a > 0;
    const strip = row + wrapsTravelled();
    if (variants && land.current) land.current.material = variants[ravenTileVariant(col, strip)];
    if (slices && land.current) land.current.geometry = mountainSlice(slices, col, strip);
    if (sideNatural && land.current) {
      const side = payloadLook().a > 0;
      land.current.material = side ? sideNatural.variants[ravenTileVariant(col, strip)] : material;
      land.current.geometry = side ? mountainSlice(sideNatural.slices, col, strip) : geometries[1];
      if (buildings.current) buildings.current.visible = !side;
    }
  });
  return (
    <group ref={ref}>
      <mesh
        ref={land}
        // Mountain slices carry bounds that include the vertex-shader lift, so they can be culled (~30 tiles, a few
        // in view); the GLB tiles keep the shipped no-culling.
        frustumCulled={!!slices && !isCity}
        renderOrder={RENDER_ORDER.TERRAIN}
        geometry={geometries[isCity ? 1 : 0]}
        material={material}
      />
      {houses && !isCity && (
        <mesh frustumCulled={false} renderOrder={RENDER_ORDER.TERRAIN} geometry={houses.geometry} material={houses.material} />
      )}
      {isCity && (
        <group ref={buildings}>
          <Buildings material={material} />
        </group>
      )}
      {withPoints && <DetectionPoints groundY={detectionY} villages={!!houses} />}
    </group>
  );
}

/** Shipped natural tile (its map is the city tile's base) + city tile + its overlay. */
type CityAssets = { land: THREE.Mesh; cityLand: THREE.Mesh; cityTex: THREE.Texture };

function configureCityTexture(t: THREE.Texture | THREE.Texture[]) {
  const tex = Array.isArray(t) ? t[0] : t;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 4;
}

/** Suspends on the shipped tile, the city tile and its overlay; warms the buildings (drawn on the city tile). */
function useCityAssets(): CityAssets {
  const terrain = useGLB(ASSETS.terrain);
  const city = useGLB(ASSETS.cityTerrain);
  useGLB(ASSETS.building);
  const cityTex = useTexture(ASSETS.cityTexture, configureCityTexture) as THREE.Texture;
  return useMemo(
    () => ({ land: terrain.nodes["Land-A"] as THREE.Mesh, cityLand: city.nodes["Land-A"] as THREE.Mesh, cityTex }),
    [terrain, city, cityTex],
  );
}

function CityAssetsLoader({ onLoad }: { onLoad: (a: CityAssets) => void }) {
  const assets = useCityAssets();
  useEffect(() => onLoad(assets), [assets, onLoad]);
  return null;
}

/** `?terrain=original`: the shipped tile is the natural ground, so the city assets are part of the first frame. */
function OriginalTerrain() {
  const city = useCityAssets();
  return <TerrainView city={city} />;
}

/**
 * Endless terrain (shipped `J`). Raven (default): only the Raven tile is part of the first frame. The city tile (shown
 * after thermal, never reached on this page; the side views draw it as a natural tile) and the shipped tile (its base
 * map) load only when the story first approaches it (load time, 2026-11-06: 3 MB never downloaded on this page).
 */
export function Terrain() {
  // Canvas children render on the client only, so the query string is readable on first render.
  const [variant] = useState(terrainVariant);
  return variant === "raven" ? <TerrainView /> : <OriginalTerrain />;
}

function TerrainView({ city: eagerCity }: { city?: CityAssets }) {
  const raven = useGLB(ASSETS.ravenTerrain);
  const gl = useThree((s) => s.gl);
  const [variant] = useState(terrainVariant);
  const [lateCity, setLateCity] = useState<CityAssets | null>(null);
  const city = eagerCity ?? lateCity;
  // The city tile shows as a city only past thermal / in multi-threat (never on the payload page; the side views draw
  // it as a natural tile): its assets load the first time that happens (load time, 2026-11-06).
  const [needCity, setNeedCity] = useState(false);
  const [probe] = useState(probeEnabled);
  const isRaven = variant === "raven";
  const [mountainOn] = useState(() => isRaven && mountainTerrainEnabled());
  const [, getKeys] = useKeyboardControls();
  // Screen-space borders are in drawing-buffer pixels of the scene render (lib/render-scale.ts), not the canvas.
  const dpr = useRenderScale((s) => s.sceneDpr);
  const isMd = useMediaQuery("(min-width: 768px)");
  const boost = useRef(1);
  const appear = useRef(0);
  const wasThermal = useRef(false);

  const ravenLand = raven.nodes["Land-A"] as THREE.Mesh;
  const ravenHouses = raven.nodes.Houses as THREE.Mesh;
  // Original mode always has `eagerCity`.
  const naturalLand = isRaven ? ravenLand : city!.land;
  const cityLand = city?.cityLand;
  const geometries = useMemo(
    () => [naturalLand.geometry, (cityLand ?? naturalLand).geometry] as [THREE.BufferGeometry, THREE.BufferGeometry],
    [naturalLand, cityLand],
  );
  // The city tile keeps the shipped base map under its overlay; natural tiles take the Raven bake when active.
  const baseMap = city ? (city.land.material as THREE.MeshStandardMaterial).map : null;
  const naturalMap = (naturalLand.material as THREE.MeshStandardMaterial).map;
  const housesMap = (ravenHouses.material as THREE.MeshStandardMaterial).map;
  const cityTex = city?.cityTex ?? null;

  const panorama = useOpeningPanorama();
  const [natural] = useState(() => new TerrainMaterial(getNoiseTexture()));
  const [urban] = useState(() => new TerrainMaterial(getNoiseTexture()));
  // Same fog/scan treatment as the ground so houses never sit crisp over hazy terrain.
  const [village] = useState(() => {
    const m = new TerrainMaterial(getNoiseTexture());
    m.uniforms.uPayloadHouse.value = 1; // payload stage: light clay houses
    return m;
  });
  // Raven tree-layout variants of the natural tile: one material per base map, same fog/scan as `natural`.
  const [naturalVariants] = useState(() => [natural, ...RAVEN_TILE_MAPS.map(() => new TerrainMaterial(getNoiseTexture()))]);
  // Mountain terrain: same base maps, MountainMaterial; used once the slices are built (old tiles until then).
  const [mountainVariants] = useState(() =>
    mountainOn ? naturalVariants.map(() => new MountainMaterial(getNoiseTexture())) : ([] as TerrainMaterial[]),
  );
  const [slices, setSlices] = useState<MountainSlices | null>(null);
  const materials = useMemo(
    () => [urban, village, ...naturalVariants, ...mountainVariants],
    [urban, village, naturalVariants, mountainVariants],
  );
  const variants = isRaven ? (slices ? mountainVariants : naturalVariants) : undefined;
  const houses = useMemo(
    () => (isRaven ? { geometry: ravenHouses.geometry, material: village } : undefined),
    [isRaven, ravenHouses, village],
  );

  useEffect(() => {
    for (const map of [baseMap, naturalMap, housesMap]) if (map) map.anisotropy = 4;
    for (const m of materials) {
      m.uniforms.uResolution.value = resolution;
      m.uniforms.uCityTexture.value = cityTex;
      m.uniforms.uBgColor.value.set(0x000000);
      m.uniforms.uPanorama.value = panorama;
    }
    urban.uniforms.uBaseTexture.value = baseMap;
    village.uniforms.uBaseTexture.value = housesMap;
  }, [baseMap, naturalMap, housesMap, cityTex, materials, urban, village, panorama]);

  // Load time (2026-11-05/06): the GLB carries a 512 preview of the land map (scripts/split-raven-terrain.mjs). The 4K
  // map (same bytes as before) and then the tree-variant maps load through the full-quality queue (hd-assets.ts:
  // after the drone's own maps, one at a time so they never split the link); until then tiles show the best map in
  // so far. Mountain slices are built off the critical path (worker; FixedContainer starts the build early).
  useEffect(() => {
    if (!mountainOn) return;
    let alive = true;
    let built: MountainSlices | null = null;
    // Hold the loader until the mountain ground has rendered (never reveal the old tiles first).
    useLoading.setState({ terrainReady: false });
    const frames = () => requestAnimationFrame(() => requestAnimationFrame(() => useLoading.setState({ terrainReady: true })));
    // Fast links get up to FULL_MAP_WAIT_MS for the drone and terrain originals, so they never see a preview. A page
    // that is already slow reveals on the previews at once: the originals could not arrive in time there anyway.
    const release = () => {
      const slow = performance.now() > SLOW_PAGE_MS;
      const wait = new Promise((r) => setTimeout(r, slow ? 0 : FULL_MAP_WAIT_MS));
      Promise.race([hdSettled(HD_PRIORITY.terrain), wait]).then(() => alive && frames());
    };
    sharedMountainSlices(ravenLand.geometry, ravenHouses.geometry)
      .then((s) => {
        built = s;
        if (alive) {
          setSlices(s);
          // Two frames: React swaps the tiles to their slices and MountainMaterial compiles behind the loader.
          release();
        } else for (const g of s.flat()) g.dispose();
      })
      // On failure the Raven tiles simply stay (and the loader is released).
      .catch((err) => {
        console.error("Mountain terrain build failed; keeping the Raven tiles.", err);
        release();
      });
    return () => {
      alive = false;
      useLoading.setState({ terrainReady: true });
      forgetMountainSlices(ravenLand.geometry);
      if (built) for (const g of built.flat()) g.dispose();
    };
  }, [mountainOn, ravenLand, ravenHouses]);

  // Natural/mountain base maps are owned here (not in the uniform effect above, which re-runs when the city assets
  // arrive and would put the preview back).
  useEffect(() => {
    for (const m of [...naturalVariants, ...mountainVariants]) m.uniforms.uBaseTexture.value = naturalMap;
    if (!isRaven || !naturalMap) return;
    const loaded: THREE.Texture[] = [];
    let alive = true;
    // Decoded off the main thread like the GLB's own preview (GLTFLoader's ImageBitmapLoader, same options, so the
    // orientation matches); HTML image fallback where ImageBitmap is missing.
    const bitmaps = typeof createImageBitmap !== "undefined";
    const load = async (url: string) => {
      const tex = bitmaps
        ? new THREE.Texture(await new THREE.ImageBitmapLoader().setOptions({ premultiplyAlpha: "none" }).loadAsync(url))
        : await new THREE.TextureLoader().loadAsync(url);
      if (!alive) {
        tex.dispose();
        return null;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false; // glTF UV convention, like the GLB map
      tex.wrapS = naturalMap.wrapS;
      tex.wrapT = naturalMap.wrapT;
      tex.minFilter = naturalMap.minFilter;
      tex.magFilter = naturalMap.magFilter;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      // Upload in a quiet frame (never mid-scroll), not on the first frame that samples it.
      await whenQuiet();
      if (!alive) {
        tex.dispose();
        return null;
      }
      gl.initTexture(tex);
      loaded.push(tex);
      return tex;
    };
    // Connection-adaptive final quality (user 2026-11-06: "drone full + ground 2K" on slow links). A page that took
    // past SLOW_PAGE_MS to get its scene up is on a slow link: the ground stops at the 2K map (all tiles), so Slow 4G
    // finishes downloading at ~25 s instead of ~75 s. Fast links skip the 2K step and get the 4K map and the
    // tree-variant maps, exactly as before. The drone's originals load on every link (hd-assets.ts).
    const slowLink = performance.now() > SLOW_PAGE_MS;
    // Phones (user 2026-11-13: "make it scroll smooth the entire page"): the 2K map too, no 4K maps. Each 4096^2 upload
    // held the main thread ~300 ms (measured, 390x844 @3x) and landed between swipes at payload and route/climb;
    // a 2K upload is a quarter of that, and a phone screen cannot show the 4K detail.
    const phone = window.matchMedia("(max-width: 767px)").matches;
    if (slowLink || phone) {
      queueHd(HD_PRIORITY.terrainStep, async () => {
        const mid = await load(ASSETS.ravenLandMap2k);
        if (mid) for (const m of [...naturalVariants, ...mountainVariants]) m.uniforms.uBaseTexture.value = mid;
      });
    } else {
      queueHd(HD_PRIORITY.terrain, async () => {
        const full = await load(ASSETS.ravenLandMap);
        // Tile 0 and every variant still waiting on its own map (the variant maps queue after this one).
        if (full) for (const m of [...naturalVariants, ...mountainVariants]) m.uniforms.uBaseTexture.value = full;
      });
      RAVEN_TILE_MAPS.forEach((url, i) =>
        queueHd(HD_PRIORITY.variants, async () => {
          const tex = await load(url);
          if (!tex) return;
          naturalVariants[i + 1].uniforms.uBaseTexture.value = tex;
          if (mountainVariants[i + 1]) mountainVariants[i + 1].uniforms.uBaseTexture.value = tex;
        }),
      );
    }
    return () => {
      alive = false;
      for (const tex of loaded) tex.dispose();
      for (const m of [...naturalVariants, ...mountainVariants]) m.uniforms.uBaseTexture.value = naturalMap;
    };
  }, [isRaven, naturalMap, naturalVariants, mountainVariants, gl]);

  useEffect(() => {
    for (const m of materials) m.uniforms.uDpr.value = dpr;
  }, [dpr, materials]);

  const groupA = useRef<THREE.Group>(null);
  const groupB = useRef<THREE.Group>(null);
  const groupCity = useRef<THREE.Group>(null);
  const groupWide = useRef<THREE.Group>(null);
  const groupAfter = useRef<THREE.Group>(null);
  const groupOpening = useRef<THREE.Group>(null);
  const tiles = useRef<THREE.Group>(null);
  const steps = useMemo(() => fogSteps(isMd), [isMd]);

  useFrame(({ clock }, dt) => {
    const state = scenes();
    const delta = state[SCENE.DELTA_DRONE];
    const detection = state[SCENE.REAL_TIME_DETECTION];
    const thermal = state[SCENE.THERMAL_IRREGULARITY];
    const phalanx = state[SCENE.PHALANX_AI];
    const { shift } = getKeys() as { shift: boolean };
    const heroIdle = delta.progress < 0.001 && !isScrollLocked();
    boost.current += ((shift && heroIdle ? 6 : 1) - boost.current) * (shift ? 0.05 : 0.025);

    // Raven payload stage: the ground turns to clay (far -> near) and slows to a calm drift.
    const look = payloadLook();
    payloadClayUniforms.uPayloadClay.value = look.clay;
    const speed =
      (0.25 + 0.2 * delta.progress + 0.2 * detection.progress) *
      (1 - remapEased(thermal.progress, 0, 0.75, 0, 1, easeInOutCubic)) *
      boost.current *
      (1 - (1 - PAYLOAD_TIMELINE.claySpeed) * look.clay * (1 - look.fog)); // full speed again in the side view

    const inThermal = thermal.showRatio > 0;
    if (inThermal !== wasThermal.current) {
      terrainRamp.current = inThermal ? 2 * TILE_STEP - wrap(terrainTravel.current, 0, TILE_STEP) : 0;
    }
    wasThermal.current = inThermal;

    if (inThermal) {
      terrainOffset.current = terrainTravel.current + thermal.progress * (terrainRamp.current || 0);
    } else {
      // Shipped speed scales with the canvas dpr, which was [1, 1.5]; the render dpr now goes to 2 (FixedContainer), so
      // the travel keeps the old factor instead of speeding the ground up on sharper screens.
      terrainTravel.current += 2 * dt * TRAVEL_DPR * speed;
      terrainOffset.current = terrainTravel.current;
    }
    terrainWrapped.current =
      thermal.progress === 1 ? 2 * TERRAIN_SCALE * 200 : wrap(terrainOffset.current, 0, TILE_STEP);

    appear.current = Math.min(Math.max(appear.current + 0.3 * dt, 0), 1);

    let nearCity = false;
    if (terrainRamp.current > 0) {
      const travelled = terrainOffset.current - terrainTravel.current;
      nearCity = terrainRamp.current - travelled <= 200 * TERRAIN_SCALE;
    }
    const scan = remapEased(phalanx.progress, 0, 0.5, 0, 1, easeInOutCubic);
    for (const m of materials) m.uniforms.uHideRatio.value = scan;
    // Raven clay map (clay-map.ts): ClayTerrain draws the swept ground, the tiles step aside.
    // Payload page: DroneRig hides the tiles once the clay front has handed the ground to the section terrain.
    if (tiles.current) tiles.current.visible = !(clayState.enabled && clayOn(state));
    urban.uniforms.uisCity.value = nearCity;

    const tp = thermal.progress;
    const ignitionDone = state[SCENE.IGNITION_VERIFIED].progress > 0.9;
    const multi = state[SCENE.MULTI_THREAT_RESPONSE].progress;
    const approachingCity = tp > 0.5;
    if (!needCity && !eagerCity && (tp > 0 || multi > 0.5)) setNeedCity(true);
    if (groupB.current) groupB.current.visible = !ignitionDone;
    if (groupA.current) groupA.current.visible = !(tp > 0.99);
    if (groupCity.current) groupCity.current.visible = approachingCity;
    if (groupAfter.current) groupAfter.current.visible = approachingCity && !ignitionDone;
    if (groupWide.current) groupWide.current.visible = (approachingCity && !ignitionDone) || multi > 0.75;

    for (const m of materials) applyFog(m, steps);

    const opening = openingNow();
    // Also in the altitude stage: its side view looks along the flight path at the ground ahead (rows -1..-3).
    if (groupOpening.current) groupOpening.current.visible = opening < 1 || look.a > 0;
    // The side view looks along +z (flight direction): rows 3-4 carry the rising ridges ahead of the drone.
    if (look.a > 0) {
      if (groupCity.current) groupCity.current.visible = true;
      if (groupWide.current) groupWide.current.visible = true;
    }
    // Altitude side view: the ridges the drone flies toward (+z, right of the frame) rise taller.
    payloadClayUniforms.uPayloadSide.value = look.fog;
    payloadClayUniforms.uPayloadRiseLift.value = ALTITUDE_RISE_LIFT;
    payloadClayUniforms.uPayloadFog.value.set(lerp(CLAY_FOG_PAYLOAD.x, CLAY_FOG_SIDE.x, look.fog), lerp(CLAY_FOG_PAYLOAD.y, CLAY_FOG_SIDE.y, look.fog));
    const w = 1 - openingEase(opening);
    for (const m of materials) {
      // Opening: far tiles dissolve into the panorama behind them (OpeningSky), not into a flat haze colour.
      // Mountain terrain: no land layer behind the tiles (MountainRanges), so the opening fog goes to the sky haze.
      m.uniforms.uPanoMix.value = mountainOn ? 0 : w;
      m.uniforms.uCloudTime.value = clock.elapsedTime; // cloud sea drift, same clock as OpeningSky
      if (w > 0) for (const k of FOG_KEYS) m.uniforms[k].value += (FOG_OPENING[k] - m.uniforms[k].value) * w;
    }
  });

  const detectionY = isRaven ? RAVEN_DETECTION_Y : undefined;
  const tile = (pos: [number, number], extra: Partial<TileProps> = {}) => (
    <Tile
      key={pos.join(",")}
      position={pos}
      geometries={geometries}
      material={natural}
      houses={houses}
      detectionY={detectionY}
      variants={variants}
      slices={slices}
      {...extra}
    />
  );

  return (
    <group ref={tiles} name="TerrainTiles">
      {!eagerCity && needCity && (
        <Suspense fallback={null}>
          <CityAssetsLoader onLoad={setLateCity} />
        </Suspense>
      )}
      {probe && <TerrainProbe />}
      <group ref={groupA}>
        {tile([-1, 0], { desktopOnly: true })}
        {tile([0, 0], { withPoints: true })}
        {tile([1, 0])}
        {tile([-1, 1])}
        {tile([0, 1], { withPoints: true })}
        {tile([1, 1])}
      </group>
      <group ref={groupB}>
        {tile([-1, 2])}
        {tile([0, 2], { withPoints: true })}
        {tile([1, 2])}
      </group>
      <group ref={groupCity}>
        {tile([-1, 3])}
        {/* Until the city assets arrive (after the full terrain maps) this is a natural tile. */}
        {tile(
          [0, 3],
          city
            ? {
                material: urban,
                isCity: true,
                variants: undefined,
                slices: undefined,
                sideNatural: slices && variants ? { variants, slices } : null,
              }
            : {},
        )}
        {tile([1, 3])}
      </group>
      <group ref={groupWide}>
        {tile([-1, 4], { desktopOnly: true })}
        {tile([0, 4])}
        {tile([1, 4])}
      </group>
      {/* Raven opening: ground ahead of and beside the low wide shot (hidden from the hero frame on). */}
      <group ref={groupOpening}>
        {[-1, -2, -3].flatMap((row) => [-1, 0, 1, 2].map((col) => tile([col, row])))}
        {tile([2, 0])}
        {tile([2, 1])}
        {tile([2, 2])}
      </group>
      <group ref={groupAfter}>
        {tile([2, 3], { desktopOnly: true })}
        {tile([2, 4], { desktopOnly: true })}
        {tile([0, 5], { desktopOnly: true })}
        {tile([-1, 5], { desktopOnly: true })}
      </group>
    </group>
  );
}

useGLB.preload(ASSETS.ravenTerrain);
// The shipped/city tiles are first-frame assets only in `?terrain=original` (see Terrain).
if (typeof window !== "undefined" && terrainVariant() !== "raven") {
  useGLB.preload(ASSETS.terrain);
  useGLB.preload(ASSETS.cityTerrain);
  useGLB.preload(ASSETS.building);
}
