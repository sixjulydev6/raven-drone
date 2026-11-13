"use client";

import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { ASSETS } from "@/lib/assets";
import { resolution, SKY_COLOR } from "@/lib/constants";
import { openingNow } from "@/lib/story-map";
import { MountainRanges } from "./MountainRanges";
import { mountainTerrainEnabled } from "./mountain-terrain";
import { terrainVariant } from "./raven-terrain";
import { panoramaLookup } from "./shaders/panorama";
import { useMediaQuery } from "@/lib/use-media-query";
import { sunlight } from "./sunlight";

/**
 * Raven opening sky (not in the shipped bundle). The shipped story never looks at the horizon, so the page only
 * clears to SKY_COLOR. The low opening shot does: a dome centred on the camera with the procedural sky (SKY_COLOR at
 * the horizon, deeper blue overhead, sun glow, drifting high cloud) and, over it, the Blender land layer
 * (glb/raven-sky/01_opening_panorama.py, land mode: layered blue ranges, snow massifs, valley fog; transparent sky).
 * The terrain fog fades into the same land layer during the opening (TerrainMaterial `uPanoMix`), so the last tiles
 * dissolve into the hills instead of a flat haze band. User, 2026-11-02: land from Blender, sky and clouds kept
 * procedural (the Blender sky was tried and rejected), Blender far ranges removed, and the two procedural ridge rings
 * (the far mountains of the first opening) kept behind the land layer.
 * Order: sky dome -> ridge rings (far first) -> land dome (alpha) -> terrain.
 * Mountain terrain (`?terrain=mountain`): the rings and the land layer are replaced by MountainRanges (3D, lit,
 * snow-shaded far ranges); the terrain fog then fades to the sky haze instead of the land layer (Terrain `uPanoMix`).
 * Does not write depth (the terrain lens treats it as sky). Hidden once the camera reaches the hero frame, where it
 * is out of frame (the hero view tops out 23 deg below the horizon).
 */
const DOME_RADIUS = 300;
/** Ridge rings around the world origin: [radius, base Y, peak height, haze 0..1, seed, lift deg (see below)]. */
const RIDGES: [number, number, number, number, number, number][] = [
  [130, -6, 15, 0.72, 1.7, 5.2], // far ring sits higher than the near one: layered depth (user, 2026-11-02)
  [78, -4.5, 9, 0.52, 4.1, 3.2],
];
/**
 * The land layer's hills are opaque up to ~3 deg above the horizon (partly to ~5), which hid most of the rings'
 * silhouettes (2-5 deg). Each ring is raised by its lift elevation (radius * tan) so its old silhouette shows above
 * the hills and its hazy foot sits behind them.
 */
const SEGMENTS = 384;
/** Hazed band below each ring's foot (world units), so lifting the rings leaves no visible bottom edge. */
const RIDGE_SKIRT = 30;

const domeVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const domeFragment = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uSun;
uniform float uTime;
varying vec3 vDir;

// Sine-free hash (Hoskins): phone GPUs (Mali/Adreno) evaluate sin() of the large fBm arguments with too little
// precision, which smeared the clouds into streaky brush strokes on real phones (user 2026-11-13).
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 1.0, h), 0.6));
  float s = max(dot(d, uSun), 0.0);
  col += vec3(1.0, 0.93, 0.8) * (0.18 * pow(s, 6.0) + 0.5 * pow(s, 400.0)) * smoothstep(-0.02, 0.06, d.y);
  // High cloud on a plane above the camera; thins toward the horizon so it never draws a line there.
  vec2 uv = d.xz / max(d.y, 0.06) * 0.9 + vec2(uTime * 0.004, uTime * 0.0015);
  float c = smoothstep(0.52, 0.82, fbm(uv)) * smoothstep(0.03, 0.3, d.y);
  col = mix(col, mix(vec3(1.0), uHorizon, 0.25), 0.75 * c);
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * Mountain terrain sky (user 2026-11-03, the Everest site's frame: "make the sky bright and blue like this"): deep
 * saturated blue overhead, a pale bright band at the horizon (SKY_COLOR, the colour the terrain fog and the far-range
 * haze end at), and fair-weather cumulus on a plane above the camera: domain-warped billows, lit from the sun side
 * (density sampled toward the sun = self-shadow), grey bases, thinning into the horizon haze.
 */
const mountainSkyFragment = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uMid;
uniform vec3 uZenith;
uniform vec3 uSun;
uniform float uTime;
varying vec3 vDir;

// Sine-free hash (Hoskins): phone GPUs (Mali/Adreno) evaluate sin() of the large fBm arguments with too little
// precision, which smeared the clouds into streaky brush strokes on real phones (user 2026-11-13).
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { v += a * noise(p); p = p * 2.07 + 17.1; a *= 0.5; }
  return v;
}
// Billowy cumulus density: warped fBm with rounded (squared) tops. t = seconds: the warp field evolves slowly (the
// heaps grow, thin and change shape) and the fine billows drift a little faster than the masses (depth).
// Perf (2026-11-03): the warp w is computed once per pixel and shared with the self-shadow sample (was a full
// second cumulus() call: 2 x 4 fBm per sky pixel at up to 2x density).
vec2 cumulusWarp(vec2 uv, float t) {
  return vec2(fbm(uv * 0.45 + 3.1 + vec2(t * 0.011, 0.0)), fbm(uv * 0.45 + 7.7 - vec2(0.0, t * 0.009)));
}
float cumulus(vec2 uv, vec2 w, float t) {
  float n = fbm(uv + 1.6 * w);
  // Coverage threshold plus a second billow octave: rounded heaps with clear gaps between them.
  float b = fbm(uv * 2.3 + 1.6 * w + 5.0 + vec2(t * 0.02, t * 0.006));
  float d = smoothstep(0.47, 0.72, n + 0.12 * (b - 0.5));
  return d * d * (3.0 - 2.0 * d);
}

void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.2, h));
  col = mix(col, uZenith, smoothstep(0.12, 0.62, h));
  float s = max(dot(d, uSun), 0.0);
  col += vec3(1.0, 0.95, 0.85) * (0.1 * pow(s, 8.0) + 0.6 * pow(s, 600.0)) * smoothstep(-0.02, 0.06, d.y);

  // Cloud layer: a gently curved projection (offset 0.45, not a flat plane) so the low sky the opening camera sees
  // keeps round puffs instead of radial streaks.
  // Wind: about one cloud width every ~40 s, slightly veering.
  vec2 drift = vec2(uTime * 0.024, uTime * 0.008 + 0.02 * sin(uTime * 0.01));
  vec2 uv = d.xz / (d.y + 0.45) * 2.6 + drift;
  vec2 w = cumulusWarp(uv, uTime);
  float dens = cumulus(uv, w, uTime);
  vec2 toSun = normalize(uSun.xz + 1e-4) * 0.12;
  // Self-shadow: density a little toward the sun, same warp (the warp varies slowly over that offset).
  float occl = smoothstep(0.47, 0.72, fbm(uv + toSun + 1.6 * w));
  float lit = clamp(0.55 + 0.45 * (dens - occl) * 3.0 + 0.25 * (1.0 - dens), 0.0, 1.0);
  vec3 cloud = mix(vec3(0.62, 0.67, 0.75), vec3(1.0, 0.99, 0.97), lit);
  // Fewer, flatter clouds low down (they sit in the haze), clear patches overhead.
  float amount = dens * smoothstep(0.0, 0.1, d.y) * (1.0 - 0.35 * smoothstep(0.35, 0.8, h));
  cloud = mix(cloud, uHorizon, 1.0 - smoothstep(0.0, 0.18, h));
  col = mix(col, cloud, clamp(amount, 0.0, 1.0) * 0.95);
  // Bright haze band hugging the horizon.
  col = mix(col, uHorizon, (1.0 - smoothstep(0.0, 0.06, h)) * 0.7);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Blender land layer, blended (straight alpha) over the sky and the ridge rings. */
const landFragment = /* glsl */ `
${panoramaLookup}
uniform vec2 uResolution;
varying vec3 vDir;
void main() {
  float edge = abs(gl_FragCoord.x / uResolution.x * 2.0 - 1.0);
  gl_FragColor = panoramaColor(vDir, edge);
}`;

const ridgeVertex = /* glsl */ `
attribute float aT;
varying float vT;
varying float vA;
void main() {
  vT = aT;
  vA = atan(position.x, position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ridgeFragment = /* glsl */ `
uniform vec3 uHaze;
uniform vec3 uRock;
uniform vec3 uLit;
uniform float uHazeAmount;
varying float vT;
varying float vA;
void main() {
  // Vertical streaks (gullies) and a lit upper band; aerial perspective thickens toward the base.
  // Soft, low-frequency light/shade along the ridge. The shipped-look gullies (sin(vA * 420) * sin(vA * 173)) aliased
  // into fine vertical comb stripes once the rings were lifted into clear view (user, 2026-11-02: "glitched?").
  float gully = 0.5 + 0.5 * sin(vA * 47.0 + 2.0 * sin(vA * 11.0)) * sin(vA * 19.0 + 1.3);
  vec3 col = mix(uRock, uLit, smoothstep(0.35, 1.0, vT) * (0.55 + 0.45 * gully));
  float haze = mix(1.0, uHazeAmount, smoothstep(0.0, 0.75, vT));
  gl_FragColor = vec4(mix(col, uHaze, haze), 1.0);
}`;

/** Ridge silhouette height (0..1) at angle a: integer harmonics keep the ring seamless. */
function ridge(a: number, seed: number) {
  let h = 0;
  let w = 0;
  for (const [k, amp] of [[3, 1], [5, 0.7], [8, 0.5], [13, 0.32], [21, 0.2], [34, 0.12], [55, 0.07]] as const) {
    h += amp * (1 - Math.abs(Math.sin(k * a * 0.5 + seed * k))); // ridged
    w += amp;
  }
  return Math.pow(h / w, 1.6);
}

function ridgeGeometry(radius: number, baseY: number, peak: number, seed: number) {
  const pos: number[] = [];
  const t: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    const x = Math.sin(a) * radius;
    const z = Math.cos(a) * radius;
    // skirt (fully hazed, well below the horizon) -> foot -> crest: the lifted foot never shows a bottom edge
    pos.push(x, baseY - RIDGE_SKIRT, z, x, baseY, z, x, baseY + 1.5 + peak * ridge(a, seed), z);
    t.push(0, 0, 1);
    if (i < SEGMENTS) {
      const j = 3 * i;
      index.push(j, j + 3, j + 1, j + 1, j + 3, j + 4); // skirt band
      index.push(j + 1, j + 4, j + 2, j + 2, j + 4, j + 5); // ridge band
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aT", new THREE.Float32BufferAttribute(t, 1));
  g.setIndex(index);
  return g;
}


/** Mountain terrain draws MountainRanges instead of the land layer and fogs to the sky, so it never samples it. */
const panoramaNeeded = () => !(terrainVariant() === "raven" && mountainTerrainEnabled());

function configurePanorama(t: THREE.Texture | THREE.Texture[]) {
  const tex = Array.isArray(t) ? t[0] : t;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
}

/**
 * The land layer texture (suspends: part of the first frame). Shared with Terrain for the opening fog. Null (never
 * fetched) in mountain mode: load time, 2026-11-05. The mode is fixed for the page, so the hook order never changes.
 */
export function useOpeningPanorama(): THREE.Texture | null {
  const [needed] = useState(panoramaNeeded);
  return needed ? (useTexture(ASSETS.openingLand, configurePanorama) as THREE.Texture) : null;
}

export function OpeningSky() {
  const group = useRef<THREE.Group>(null);
  const dome = useRef<THREE.Mesh>(null);
  const landDome = useRef<THREE.Mesh>(null);
  const land = useOpeningPanorama();
  const [mountain] = useState(() => terrainVariant() === "raven" && mountainTerrainEnabled());
  const stillSky = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [domeGeometry, domeMaterial, landMaterial] = useMemo(() => {
    const g = new THREE.SphereGeometry(DOME_RADIUS, 64, 32);
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uHorizon: { value: SKY_COLOR },
        uMid: { value: new THREE.Color("#5f8fca") },
        uZenith: { value: new THREE.Color(mountain ? "#2a5c9e" : "#6f9fdc") },
        uSun: { value: new THREE.Vector3() },
        uTime: { value: 0 },
      },
      vertexShader: domeVertex,
      fragmentShader: mountain ? mountainSkyFragment : domeFragment,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    const l = new THREE.ShaderMaterial({
      uniforms: { uPanorama: { value: null }, uResolution: { value: resolution }, uCloudTime: { value: 0 } },
      vertexShader: domeVertex,
      fragmentShader: landFragment,
      side: THREE.BackSide,
      // Transparent draws after all opaque objects, so it must depth-test: the terrain and drones (which write depth)
      // stay in front, the sky dome and ridge rings (no depth) stay behind.
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    return [g, m, l];
  }, [mountain]);
  landMaterial.uniforms.uPanorama.value = land;
  const ridges = useMemo(
    () =>
      RIDGES.map(([radius, baseY, peak, haze, seed, lift]) => ({
        geometry: ridgeGeometry(radius, baseY + radius * Math.tan((lift * Math.PI) / 180), peak, seed),
        material: new THREE.ShaderMaterial({
          uniforms: {
            uHaze: { value: SKY_COLOR },
            uRock: { value: new THREE.Color("#4d5e6e") },
            uLit: { value: new THREE.Color("#8d9a9c") },
            uHazeAmount: { value: haze },
          },
          vertexShader: ridgeVertex,
          fragmentShader: ridgeFragment,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      })),
    [],
  );

  useFrame((state) => {
    const on = openingNow() < 1;
    if (group.current) group.current.visible = on;
    if (!on || !dome.current) return;
    dome.current.position.copy(state.camera.getWorldPosition(dome.current.position));
    landDome.current?.position.copy(dome.current.position);
    domeMaterial.uniforms.uSun.value.copy(sunlight.direction);
    // Reduced motion: the clouds hold still.
    if (!stillSky) domeMaterial.uniforms.uTime.value = state.clock.getElapsedTime();
    landMaterial.uniforms.uCloudTime.value = state.clock.getElapsedTime();
  });

  // Sky, far ring, near ring, land layer; all before the terrain (render order 0 draws over them).
  return (
    <group ref={group}>
      <mesh ref={dome} geometry={domeGeometry} material={domeMaterial} renderOrder={-3} frustumCulled={false} />
      {mountain ? (
        <MountainRanges />
      ) : (
        <>
          {ridges.map((r, i) => (
            <mesh key={i} geometry={r.geometry} material={r.material} renderOrder={-2 + i * 0.5} frustumCulled={false} />
          ))}
          <mesh ref={landDome} geometry={domeGeometry} material={landMaterial} renderOrder={-0.5} frustumCulled={false} />
        </>
      )}
    </group>
  );
}

if (typeof window !== "undefined" && panoramaNeeded()) useTexture.preload(ASSETS.openingLand);
