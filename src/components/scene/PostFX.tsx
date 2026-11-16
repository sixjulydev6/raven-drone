"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { BlendFunction, CopyPass, Effect, EffectComposer, EffectPass, Pass, RenderPass, SMAAEffect, SMAAPreset } from "postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { BG_COLOR, DRONE_LAYER, SKY_COLOR, terrainOffset } from "@/lib/constants";
import { PAYLOAD_BG, payloadLook } from "@/lib/payload";
import { damp, remap } from "@/lib/math";
import { computeSceneRanges, SCENE, sceneDataAt, scenes, useScenes, type SceneData, type SceneId } from "@/lib/scenes";
import { mapStory, openingNow, storyMap, useStage, wipeProgress, wipeRatioAt } from "@/lib/story-map";
import { useMediaQuery } from "@/lib/use-media-query";
import { droneLayerSamples, useRenderScale } from "@/lib/render-scale";
import { clayState } from "./clay-map";
import { fisheyeAt } from "./opening";
import { TerrainLensEffect } from "./TerrainLensEffect";
import { sceneWarm } from "./scene-warm";
import { mountainTerrainEnabled } from "./mountain-terrain";
import { terrainVariant } from "./raven-terrain";
import { DAYLIGHT, HERO_LIGHT, heroLight } from "./hero-light";
import { cameraTilt } from "./camera-tilt";

/** Flock scene radial-blur crossfade (shipped module 8743 + shader 79755). */
class RenderTargetMixEffect extends Effect {
  constructor(target: THREE.WebGLRenderTarget) {
    super(
      "RenderTargetMixEfx",
      /* glsl */ `
uniform sampler2D uRenderTarget;
uniform float uMixFactor;
uniform float uNextSceneProgress;
#define MAX_STRENGTH 0.3

float Exponential_easeInOut(float begin, float change, float duration, float time) {
    if (time == 0.0) return begin;
    if (time == duration) return begin + change;
    float t = time / (duration / 2.0);
    if (t < 1.0) return change / 2.0 * pow(2.0, 10.0 * (t - 1.0)) + begin;
    return change / 2.0 * (-pow(2.0, -10.0 * (t - 1.0)) + 2.0) + begin;
}

float Sinusoidal_easeInOut(float begin, float change, float duration, float time) {
    return -change / 2.0 * (cos(PI * time / duration) - 1.0) + begin;
}

float rand(vec3 scale, float seed) {
    return fract(sin(dot(gl_FragCoord.xyz + seed, scale)) * 43758.5453 + seed);
}

vec3 crossFade(vec2 texCoord, float dissolve) {
    vec3 fromColor = texture2D(inputBuffer, texCoord).rgb;
    vec3 toColor = texture2D(uRenderTarget, texCoord).rgb;
    return mix(fromColor, toColor, dissolve);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float progress = uMixFactor;
    float fadeOut = 1.0 - smoothstep(0.05, 0.15, uNextSceneProgress);
    if (progress <= 0.0 || fadeOut <= 0.0) {
        outputColor = inputColor;
        return;
    }
    vec2 center = vec2(0.5);
    float dissolve = Exponential_easeInOut(0.0, 1.0, 1.0, progress);
    float strength = Sinusoidal_easeInOut(0.0, MAX_STRENGTH, 0.5, progress);
    vec3 color = vec3(0.0);
    float total = 0.0;
    vec2 toCenter = center - uv;
    float offset = rand(vec3(12.9898, 78.233, 151.7182), 0.0) * 0.5;
    for (float t = 0.0; t <= 20.0; t++) {
        float percent = (t + offset) / 20.0;
        float weight = percent - percent * percent;
        color += crossFade(uv + toCenter * percent * strength, dissolve) * weight;
        total += weight;
    }
    vec3 blurred = color / total;
    outputColor = vec4(mix(inputColor.rgb, blurred, fadeOut), 1.0);
}`,
      {
        blendFunction: BlendFunction.NORMAL,
        uniforms: new Map<string, THREE.Uniform>([
          ["uRenderTarget", new THREE.Uniform(target.texture)],
          ["uMixFactor", new THREE.Uniform(0)],
          ["uNextSceneProgress", new THREE.Uniform(0)],
        ]),
      },
    );
  }
  set mixFactor(v: number) {
    this.uniforms.get("uMixFactor")!.value = v;
  }
  set nextSceneProgress(v: number) {
    this.uniforms.get("uNextSceneProgress")!.value = v;
  }
}

/**
 * Raven opening lens (not in the shipped bundle): barrel distortion for the wide low shot. Centre magnified, edges
 * compressed, corners pinned to the corners so nothing outside the render is sampled. Strength 0 = identity; the pass
 * is disabled at the hero frame and after.
 */
class FisheyeEffect extends Effect {
  constructor() {
    super(
      "FisheyeEfx",
      /* glsl */ `
uniform float uStrength;
uniform float uAspect;
void mainUv(inout vec2 uv) {
  vec2 d = (uv - 0.5) * vec2(uAspect, 1.0);
  float rMax2 = 0.25 * (uAspect * uAspect + 1.0);
  d *= (1.0 + uStrength * dot(d, d) / rMax2) / (1.0 + uStrength);
  uv = 0.5 + d / vec2(uAspect, 1.0);
}`,
      {
        uniforms: new Map<string, THREE.Uniform>([
          ["uStrength", new THREE.Uniform(0)],
          ["uAspect", new THREE.Uniform(1)],
        ]),
      },
    );
  }
  u(name: string) {
    return this.uniforms.get(name)!;
  }
}

/**
 * Raven: diagonal transition from story band 1 (Route) into band 2 (Care teams map), user 2026-11-01. The shipped
 * Phalanx wipe (terrain/grid/fire shaders, `computeScreenUv` + `hideRatio`) restyles one continuous overhead view; Raven
 * skips the thermal/ignition flight that led there. So the Route stays live (terrain travel, drone hover) and the
 * swept side shows the Care teams map at phalanx .5, rendered once off screen (`Preroll` in `usePostFX`): in the shipped scene
 * that frame is static (terrain stopped, camera parked). Same edge maths as `computeScreenUv` on the composer uv
 * (= gl_FragCoord / drawing-buffer size, as in the terrain shader) and the same 0.1 border on the swept side.
 */
class DiagonalWipeEffect extends Effect {
  constructor(capture: THREE.Texture) {
    super(
      "DiagonalWipeEfx",
      /* glsl */ `
uniform sampler2D uCapture;
uniform float uRatio;
uniform float uBorder;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 s = (uv - 0.5) / sqrt(2.0) + 0.5;
  float a = radians(5.0 * 45.0);
  float x = cos(a) * (s.x - 0.5) - sin(a) * (s.y - 0.5) + 0.5;
  if (x < uRatio) {
    vec3 map = texture2D(uCapture, uv).rgb;
    if (x > uRatio - uBorder) map += vec3(0.1);
    outputColor = vec4(map, 1.0);
  } else {
    outputColor = inputColor;
  }
}`,
      {
        uniforms: new Map<string, THREE.Uniform>([
          ["uCapture", new THREE.Uniform(capture)],
          ["uRatio", new THREE.Uniform(0)],
          ["uBorder", new THREE.Uniform(0.001)],
        ]),
      },
    );
  }
  u(name: string) {
    return this.uniforms.get(name)!;
  }
}

/** Frames rendered in the map state before the capture (clip seekers, terrain travel and fog settle in one). */
const MAP_SETTLE_FRAMES = 3;
type Preroll = { state: "idle" | "running" | "done"; frame: number; saved: { id: SceneId; ref: SceneData; val: SceneData }[]; warm: number };

/** Puts the store into `data` without notifying React (DOM chapter copy, HUD and nav never see it); returns undo info. */
function enterSilently(data: Record<SceneId, SceneData>) {
  const st = useScenes.getState();
  const saved: Preroll["saved"] = [];
  for (const id of Object.keys(data) as SceneId[]) {
    const ref = st[id];
    saved.push({ id, ref, val: { ...ref } });
    Object.assign(ref, data[id]);
  }
  return saved;
}
/** Restores what `enterSilently` replaced, unless a real scroll update already swapped that scene's object. */
function leaveSilently(saved: Preroll["saved"]) {
  const st = useScenes.getState();
  for (const { id, ref, val } of saved) if (st[id] === ref) Object.assign(ref, val);
}

/** Grade, grain and vignette (shipped module 98894 + shader 25460; thermal palette box dropped with the thermal chapter). */
class FinalEffect extends Effect {
  constructor() {
    super(
      "FinalEfx",
      /* glsl */ `
uniform vec3 uBgColor;
uniform float uOpacity;
uniform float uVignetteFrom;
uniform float uVignetteTo;
uniform vec2 uVignetteAspect;
uniform vec3 uVignetteColor;
uniform float uSaturation;
uniform float uContrast;
uniform float uBrightness;
uniform vec3 uTintColor;
uniform float uTintOpacity;
uniform float uSharpenKernelOffset;
uniform float uSharpenOpacity;
uniform float uGamma;
uniform float uGrainAmount;
uniform float uTime;

float hash13(vec3 p3) {
  p3 = fract(p3 * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 screen(vec3 cb, vec3 cs) { return cb + cs - (cb * cs); }
vec3 colorDodge(vec3 cb, vec3 cs) { return mix(min(vec3(1.0), cb / (1.0 - cs)), vec3(1.0), step(vec3(1.0), cs)); }
vec3 sharpen(sampler2D image, vec2 uv) {
  mat3 kernel = mat3(-1, -1, -1, -1, 9, -1, -1, -1, -1);
  float offset = uSharpenKernelOffset;
  vec3 sum = vec3(0.0);
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      sum += texture2D(image, uv + vec2(float(x), float(y)) * offset).rgb * kernel[x + 1][y + 1];
    }
  }
  return sum;
}
vec3 colorVibrancy(vec3 color, float vibrancy, float luma) {
  float maxVal = max(max(color.r, color.g), color.b);
  float minVal = min(min(color.r, color.g), color.b);
  float sat = maxVal - minVal;
  float vibFactor = smoothstep(0.0, 0.5, sat);
  vibFactor = 1.0 + vibrancy * (1.0 - vibFactor);
  return mix(vec3(luma), color, vibFactor);
}
vec3 gammaCorrect(vec3 color, float gamma) { return pow(clamp(color, 0.0, 1.0), vec3(1.0 / gamma)); }
vec3 ACESFilm(vec3 x) { return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 sharpenedColor = sharpen(inputBuffer, uv);
  vec3 color = mix(inputColor.rgb, sharpenedColor, uSharpenOpacity);
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color = colorVibrancy(color, uSaturation, luma);
  color = 0.5 + (1.0 + uContrast) * (color - 0.5);
  color += uBrightness;
  float grain = fract(sin(dot(uv, vec2(100.9898 + uTime * 1.1, 100.233))) * 43758.5453);
  float darkGrainAmount = uGrainAmount * pow(1. - luma, 3.);
  color += color * (grain - 0.8) * (uGrainAmount + darkGrainAmount);
  color = mix(color, screen(colorDodge(color, uTintColor), uTintColor), uTintOpacity);
  float d = length((uv - 0.5) * uVignetteAspect) * 2.0;
  color = mix(color, uVignetteColor, smoothstep(uVignetteFrom, uVignetteTo, d));
  color += hash13(vec3(gl_FragCoord.xy, uTime)) / 255.0;
  float verticalFalloff = smoothstep(0.25, 0.75, abs(uv.y - 0.5));
  color = mix(color, uVignetteColor, verticalFalloff);

  float fadeOut = smoothstep(0.0, 1.0 - uOpacity, uv.y);
  color = mix(uBgColor, color, fadeOut);
  color = gammaCorrect(color, uGamma);
  color = mix(color, ACESFilm(color), 0.15);
  outputColor = vec4(vec3(color), 1.0);
}`,
      {
        blendFunction: BlendFunction.NORMAL,
        uniforms: new Map<string, THREE.Uniform>([
          ["uBgColor", new THREE.Uniform(BG_COLOR)],
          ["uOpacity", new THREE.Uniform(1)],
          ["uVignetteFrom", new THREE.Uniform(0)],
          ["uVignetteTo", new THREE.Uniform(1)],
          ["uVignetteAspect", new THREE.Uniform(new THREE.Vector2())],
          ["uVignetteColor", new THREE.Uniform(new THREE.Color("#000"))],
          ["uSaturation", new THREE.Uniform(0.3)],
          ["uContrast", new THREE.Uniform(0.02)],
          ["uBrightness", new THREE.Uniform(0.02)],
          ["uTintColor", new THREE.Uniform(new THREE.Color("#092b3b"))],
          ["uTintOpacity", new THREE.Uniform(0.06)],
          ["uGamma", new THREE.Uniform(1.1)],
          ["uSharpenKernelOffset", new THREE.Uniform(14e-5)],
          ["uSharpenOpacity", new THREE.Uniform(0.3)],
          ["uGrainAmount", new THREE.Uniform(0.25)],
          ["uTime", new THREE.Uniform(0)],
        ]),
      },
    );
  }
  u(name: string) {
    return this.uniforms.get(name)!;
  }
}

/** Lens (Raven): exposure for the terrain motion blur and the thin-lens blur at infinity (px at 1080p). */
const SHUTTER_S = 1 / 30;
/** Perceived flight speed: terrain-travel streak exposed as if the ground passed this many times faster.
 * 3 -> 1.5 and the streak cap 16 -> 9 px (user, 2026-11-02: terrain motion blur was too strong). */
const SPEED_GAIN = 1.5;
/** Longest motion streak and largest defocus disc (px at 1080p). */
const MAX_BLUR_PX = 9;
/**
 * Thin-lens focus on the drone (user, 2026-11-02: blur the landscape like a film lens / the eye focusing on the
 * product). CoC = COC_INF_PX * |1 - focus / dist|: from overhead the ground is only ~15% beyond the drone, so 5 gave
 * < 1 px; 60 gives ~8 px there, and the far hero background reaches the 14 px cap. Drones are never blurred.
 */
const MAX_COC_PX = 14;
const COC_INF_PX = 60;
/**
 * Only when the camera looks down on the drone (user: not in the hero or the chapters that follow it obliquely).
 * Elsewhere the original light blur (5). Blend by view direction: -dir.y 0.75 -> 0.95 (hero/Route ~0.55, top views 1).
 */
const COC_INF_PX_BASE = 5;
const _camDir = new THREE.Vector3();
/** Smoothed top-view weight: follows the tilt, eased over ~0.4 s so snaps and camera-track switches never pop. */
const topViewState = { value: 0 };
/** Top of the terrain band in world Y (parent -2.5 + 0.04 x highest roof ~20 local = -1.7); drones fly above. */
const TERRAIN_TOP = -1.55;
/**
 * Mountain terrain (`?terrain=mountain`): the corridor ground reaches local ~34 (world -1.14) and the lifted peaks
 * away from the flight path rise above the drones, so the band is raised to just under the drones (world 0) and
 * anything beyond 1.8x the focus distance counts as terrain at any height (the drones sit at the focus distance).
 */
const MOUNTAIN_TERRAIN_TOP = -0.4;
const MOUNTAIN_TERRAIN_FAR = 1.8;
/**
 * Mountain terrain clarity (user, 2026-11-03: "increase the clarity of the landscape, currently it feels low quality").
 * Measured with `?lens=off`: the lens's depth of field (5 px on all far ground, 60 in top views) and travel streaks were
 * the main softening; the 0.25 daylight grain and a sharpen whose kernel offset was ~0.2 px (no visible effect) added
 * noise without crispness. The v09 tiles keep the values above.
 */
const MOUNTAIN_CLARITY = { cocBase: 1.5, cocTop: 26, speedGain: 0.9, maxBlurPx: 5, grain: 0.1, heroGrain: 0.04, sharpen: 0.18 };
const _vp = new THREE.Matrix4();
const _drone = new THREE.Vector3();
const _eye = new THREE.Vector3();

/** Layer the hero drones' bodies are drawn on in their own render Lights are added to it too. */
// DRONE_LAYER (lib/constants): the drone bodies and their vector outlines (Drone.tsx).
const DRONE_GROUPS = ["Drone1Group", "Drone2Group", "Drone3Group"];
const _clear = new THREE.Color();
const _clearMix = new THREE.Color();
const _box3 = new THREE.Box3();
const _part3 = new THREE.Box3();
const _corner = new THREE.Vector4();
const _crop = new THREE.Matrix4();
const _proj = new THREE.Matrix4();
const _projInv = new THREE.Matrix4();
/** Drone layer region padding (drawing-buffer px): the MSAA edge, the 3x3 depth taps and rounding. */
const REGION_PAD = 8;
/** Region allocations grow in these steps and are kept while the need stays within 60-100% (no per-frame reallocs). */
const REGION_STEP = 64;
const REGION_KEEP = 0.6;
const REGION_HEADROOM = 1.15;
/** Stencil value the drone bodies write in the drone layer; the rotor blur discs draw there only over it. */
const BODY_STENCIL = 1;
/** Rotor blur discs hang off an anchor named `<rotor>_blur` (rotor-blur.ts). */
const isRotorDisc = (o: THREE.Object3D) => !!o.parent?.name.endsWith("_blur");

/**
 * Raven drone layer (user 2026-11-03: "the drone ... should not pixelate in any of the screens"). The scene renders at
 * the adaptive scene density (lib/render-scale.ts) without the drone bodies; the bodies render on their own into
 * `tDrone` at the canvas density with MSAA (premultiplied: clear alpha 0). This pass lays them over the scene at the
 * canvas density, so their edges are never stretched or stair-stepped. Everything after (fisheye, wipe capture, grade,
 * grain) sees one frame, as before.
 * The look of the single-pass render is kept: the rotor blur discs (no depth write) stay in the scene render, where
 * the lens blurs them with the ground behind them as it always did; in the drone layer they are drawn only over the
 * body (stencil), where the lens never reached. The depth test keeps terrain that is nearer than the body in front of
 * it (nearest body depth around the pixel, so antialiased edge samples are never dropped).
 * Difference: depth-test-free overlays drawn after the drones (clay map pins) now sit under the body.
 */
class DroneCompositePass extends Pass {
  readonly uniforms = {
    tScene: new THREE.Uniform<THREE.Texture | null>(null),
    tSceneDepth: new THREE.Uniform<THREE.Texture | null>(null),
    tDrone: new THREE.Uniform<THREE.Texture | null>(null),
    tDroneDepth: new THREE.Uniform<THREE.Texture | null>(null),
    uSceneDepth: new THREE.Uniform(0),
    uDrones: new THREE.Uniform(0),
    uDroneTexel: new THREE.Uniform(new THREE.Vector2(1, 1)),
    /** Drone layer region in canvas uv: x, y (bottom-left), width, height. */
    uDroneRect: new THREE.Uniform(new THREE.Vector4(0, 0, 1, 1)),
  };
  constructor() {
    super("DroneCompositePass");
    this.needsSwap = false; // writes the input buffer, like the RenderPass it replaces
    this.fullscreenMaterial = new THREE.ShaderMaterial({
      name: "DroneComposite",
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`,
      fragmentShader: /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tSceneDepth;
uniform sampler2D tDrone;
uniform sampler2D tDroneDepth;
uniform float uSceneDepth;
uniform float uDrones;
uniform vec2 uDroneTexel;
uniform vec4 uDroneRect;
varying vec2 vUv;
void main() {
  vec4 scene = texture2D(tScene, vUv);
  // The layer covers only the drones' screen region (texel-aligned with the canvas pixels).
  vec2 duv = (vUv - uDroneRect.xy) / uDroneRect.zw;
  bool inside = uDrones > 0.5 && all(greaterThanEqual(duv, vec2(0.0))) && all(lessThanEqual(duv, vec2(1.0)));
  vec4 drone = inside ? texture2D(tDrone, duv) : vec4(0.0);
  if (drone.a > 0.0 && uSceneDepth > 0.5) {
    float dz = 1.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) dz = min(dz, texture2D(tDroneDepth, duv + vec2(float(x), float(y)) * uDroneTexel).r);
    }
    if (dz < 1.0 && texture2D(tSceneDepth, vUv).r < dz) drone = vec4(0.0);
  }
  gl_FragColor = vec4(drone.rgb + scene.rgb * (1.0 - drone.a), drone.a + scene.a * (1.0 - drone.a));
}`,
    });
  }
  render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget | null) {
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer);
    renderer.render(this.scene, this.camera);
  }
}

/**
 * Puts one hero drone on the drone layer: bodies leave the scene render (layer 0) and write the body stencil; rotor
 * blur discs stay in the scene render and, in the drone layer, draw only over the body. Idempotent (every frame, so a
 * remounted model is picked up); stencil settings are GL state, no shader recompiles. Only the three stage drones
 * are touched.
 */
function assignDroneLayer(group: THREE.Object3D) {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const disc = isRotorDisc(mesh);
    mesh.layers.enable(DRONE_LAYER);
    if (!disc) mesh.layers.disable(0);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (m.stencilWrite) continue;
      m.stencilWrite = true; // also enables the stencil test; the scene buffers have no stencil, so it always passes there
      m.stencilRef = BODY_STENCIL;
      if (disc) {
        m.stencilFunc = THREE.EqualStencilFunc;
        m.stencilZPass = THREE.KeepStencilOp;
      } else {
        m.stencilFunc = THREE.AlwaysStencilFunc;
        m.stencilZPass = THREE.ReplaceStencilOp;
      }
    }
  });
}

/** Scene composer buffers at their own size (EffectComposer.setSize always uses the canvas drawing buffer). */
function setComposerBufferSize(composer: EffectComposer, width: number, height: number) {
  composer.inputBuffer.setSize(width, height);
  composer.outputBuffer.setSize(width, height);
  (composer as unknown as { depthRenderTarget: THREE.WebGLRenderTarget | null }).depthRenderTarget?.setSize(width, height);
  for (const pass of composer.passes) pass.setSize(width, height);
}

/** Composer: scene -> terrain lens (Raven) -> flock crossfade -> AA -> final grade (shipped module 41480). */
export function usePostFX(flockTarget: THREE.WebGLRenderTarget) {
  const { gl, scene, size, camera } = useThree();
  const dpr = useThree((s) => s.viewport.dpr);
  const sceneDpr = useRenderScale((s) => s.sceneDpr);
  const droneGroups = useRef<THREE.Object3D[]>([]);
  /** Canvas drawing-buffer size (fw, fh) and the drone layer's current allocation (aw, ah), in pixels. */
  const droneRegion = useRef({ fw: 1, fh: 1, aw: 0, ah: 0 });
  const aspect = useRef(new THREE.Vector2());
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  // `?lens=off` disables the Raven lens pass (comparison).
  const [lensOn] = useState(() => typeof window === "undefined" || new URLSearchParams(window.location.search).get("lens") !== "off");
  const [mountainLens] = useState(() => terrainVariant() === "raven" && mountainTerrainEnabled());
  const lensState = useRef({ prevVP: new THREE.Matrix4(), prevOffset: 0, step: 0, first: true, frame: 0, drone: null as THREE.Object3D | null });
  const pre = useRef<Preroll>({ state: "idle", frame: 0, saved: [], warm: 0 });
  /** A capture of the Care teams map exists (survives resizes; replaced by each new preroll). */
  const captured = useRef(false);
  const lastSide = useRef(0);
  const mixWarm = useRef(3);
  const [composer, sceneComposer, droneTarget, composite, final, mix, mixPass, lens, fisheye, fisheyePass, capturePass, captureTarget, wipe, wipePass, finalPass] = useMemo(() => {
    // No MSAA on the scene: tried 4x (2026-11-03); with the depth-reading lens it cost ~3x the frame (8-20 fps headless
    // at 1x). The drones get MSAA in their own layer (DroneCompositePass) instead.
    // Scene composer (scene density, drones hidden): scene -> terrain lens -> SMAA. Its result feeds the composite.
    const sceneComposer = new EffectComposer(gl, { multisampling: 0 });
    sceneComposer.autoRenderToScreen = false;
    const lens = new TerrainLensEffect();
    sceneComposer.addPass(new RenderPass(scene, camera));
    sceneComposer.addPass(new EffectPass(camera, lens)); // needs the scene depth: first pass after the render
    // Shipped bundle constructs a default effect here (minified `eF`); SMAA is inferred. Raven: before the fisheye now
    // (the drones are antialiased in their own layer); HIGH preset (was MEDIUM) for the terrain on 1x screens.
    sceneComposer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    // Drone layer: same 8-bit sRGB storage as the composer buffers; depth + stencil (body mask for the rotor discs).
    const droneDepth = new THREE.DepthTexture(1, 1, THREE.UnsignedInt248Type);
    droneDepth.format = THREE.DepthStencilFormat;
    const droneTarget = new THREE.WebGLRenderTarget(1, 1, {
      samples: droneLayerSamples(gl.getPixelRatio()),
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: true,
      depthTexture: droneDepth,
      colorSpace: sceneComposer.inputBuffer.texture.colorSpace,
    });
    droneTarget.texture.generateMipmaps = false;
    const composer = new EffectComposer(gl, { multisampling: 0 });
    const composite = new DroneCompositePass();
    composer.addPass(composite);
    const final = new FinalEffect();
    const mix = new RenderTargetMixEffect(flockTarget);
    const fisheye = new FisheyeEffect();
    const fisheyePass = new EffectPass(camera, fisheye);
    composer.addPass(fisheyePass); // Raven opening: bends the finished frame (drones included), before the grade
    const mixPass = new EffectPass(camera, mix);
    composer.addPass(mixPass);
    // Raven band 1 → band 2: the Care teams map is captured here once (off screen, no swap), then laid over the live
    // Route on the swept side; both before the grade, so grain and vignette stay live across the edge.
    // Own-size capture target (autoResize off): a resize must not clear the map the wipe is showing. It keeps the
    // previous capture (stretched) until the new one is taken (user, 2026-11-03: a live Route frame showed mid-wipe
    // after a resize, while the old code waited ~13 frames for the recapture with the wipe overlay switched off).
    const captureTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const capturePass = new CopyPass(captureTarget, false);
    const wipe = new DiagonalWipeEffect(capturePass.texture);
    const wipePass = new EffectPass(camera, wipe);
    capturePass.enabled = false;
    wipePass.enabled = false;
    composer.addPass(capturePass);
    composer.addPass(wipePass);
    const finalPass = new EffectPass(camera, final);
    composer.addPass(finalPass);
    return [composer, sceneComposer, droneTarget, composite, final, mix, mixPass, lens, fisheye, fisheyePass, capturePass, captureTarget, wipe, wipePass, finalPass] as const;
  }, [gl, scene, camera, flockTarget]);

  useEffect(() => {
    // Also on a pixel-ratio change (moving the window to another screen): R3F resizes the canvas but not the composer,
    // whose buffers then stayed at the old resolution and were stretched over the new drawing buffer.
    composer.setSize(size.width, size.height);
    // The capture target was resized (cleared) and the camera track may have switched (mobile/desktop): re-render.
    if (pre.current.state === "done") pre.current = { state: "idle", frame: 0, saved: [], warm: 0 };
  }, [composer, size, dpr]);
  useEffect(() => {
    setComposerBufferSize(sceneComposer, Math.max(1, Math.round(size.width * sceneDpr)), Math.max(1, Math.round(size.height * sceneDpr)));
  }, [sceneComposer, size, sceneDpr]);
  useEffect(() => {
    // Same size as the canvas drawing buffer (the composite samples it 1:1).
    const samples = droneLayerSamples(dpr);
    if (droneTarget.samples !== samples) {
      droneTarget.dispose(); // the sample count is fixed when the buffers are created
      droneTarget.samples = samples;
    }
    // Canvas drawing-buffer size; the layer itself is sized to the drones' region each frame (renderSceneAndDrones).
    const r = droneRegion.current;
    r.fw = Math.max(1, Math.round(size.width * dpr));
    r.fh = Math.max(1, Math.round(size.height * dpr));
    r.aw = r.ah = 0; // reallocate on the next frame
  }, [droneTarget, size, dpr]);
  useEffect(
    () => () => {
      composer.dispose();
      sceneComposer.dispose();
      droneTarget.dispose();
      captureTarget.dispose(); // not owned by the composer (own size)
    },
    [composer, sceneComposer, droneTarget, captureTarget],
  );
  useEffect(() => {
    const k = size.height / Math.sqrt(size.width * size.width + size.height * size.height);
    aspect.current.set((size.width / size.height) * k, k);
  }, [size]);

  // A positive-priority frame callback disables R3F's automatic render.
  useFrame(() => {}, 1);
  useFrame((state, dt) => {
    if (!sceneWarm.ready) return; // first-frame gate (scene-warm.ts): programs still linking in parallel
    const p = pre.current;
    // Off-screen map render: the store was put into the map state at the end of the previous frame, so every scene
    // component has already updated for it this frame. Nothing reaches the canvas (final pass off) and the DOM never
    // re-renders (silent store), so the visitor keeps seeing the last presented frame for these few frames.
    if (p.state === "running") {
      p.frame++;
      const capture = p.frame >= MAP_SETTLE_FRAMES;
      runFrame(state, dt, { capture, offscreen: true });
      if (capture) {
        leaveSilently(p.saved);
        storyMap.preroll = false;
        lensState.current.first = true;
        p.state = "done";
        captured.current = true;
      }
      return;
    }
    runFrame(state, dt, { capture: false, offscreen: false });
    // Start the map render once the scene has rendered a few frames and the layout is measured (behind the loader on
    // a normal load; on resize it costs a few frames of a held picture).
    // Without any capture yet (first load, or a remount) and the wipe on screen, capture at once.
    const urgent = !captured.current && wipeProgress(window.scrollY) > 0;
    if (p.state === "idle" && storyMap.W > 0 && (++p.warm > 10 || (urgent && p.warm > 1))) {
      const vh = storyMap.vh || window.innerHeight;
      // Size the capture to the drawing buffer now (this clears it; nothing is shown until the capture frame).
      captureTarget.setSize(composer.inputBuffer.width, composer.inputBuffer.height);
      storyMap.preroll = true;
      p.saved = enterSilently(sceneDataAt(mapStory(), computeSceneRanges(vh), vh));
      p.frame = 0;
      p.state = "running";
    }
  }, 100);

  function runFrame(state: { clock: THREE.Clock; camera: THREE.Camera }, dt: number, o: { capture: boolean; offscreen: boolean }) {
    const s = scenes();
    const multi = s[SCENE.MULTI_THREAT_RESPONSE];
    if (!o.offscreen) {
      if (multi.hideRatio > 0.8) return;
      if (useStage.getState().cover === 0) return; // Raven: stage off screen after the story
    }
    // Journey's network map is not shown (user, 2026-11-02: Journey removed); the pass stays for the load-time warm-up.
    const mixFactor = 0;
    const nextProgress = s[SCENE.REAL_TIME_DETECTION].progress;
    mix.mixFactor = mixFactor;
    mix.nextSceneProgress = nextProgress;
    // Perf: the shader passes the input through unchanged when mixFactor <= 0 or its fadeOut (1 - smoothstep(.05, .15,
    // next)) is 0; skip the full-screen pass then.
    // Raven: also run it for the first frames (mixFactor 0 = input unchanged) so it compiles at load, not as a one-frame
    // stall when the Journey map fades in.
    mixPass.enabled = (mixFactor > 0 && nextProgress < 0.15) || mixWarm.current-- > 0;
    final.u("uVignetteAspect").value.copy(aspect.current);
    final.u("uTime").value = state.clock.getElapsedTime();
    // Hero preset (hero-light.ts): grain and sharpen from the user's panel in the hero, shipped values after.
    const h = heroLight.weight;
    if (mountainLens) {
      // A real 1 px unsharp kernel (in drawing-buffer pixels) at a fixed strength; light grain.
      final.u("uGrainAmount").value = MOUNTAIN_CLARITY.grain + (MOUNTAIN_CLARITY.heroGrain - MOUNTAIN_CLARITY.grain) * h;
      // Payload page: no unsharp mask on the clay view (it ringed the altitude line and the vector outlines).
      final.u("uSharpenOpacity").value = MOUNTAIN_CLARITY.sharpen * (1 - payloadLook().clay);
      final.u("uSharpenKernelOffset").value = 1 / Math.max(size.width * gl.getPixelRatio(), 1);
    } else {
      final.u("uGrainAmount").value = DAYLIGHT.grain + (HERO_LIGHT.post.grain - DAYLIGHT.grain) * h;
      final.u("uSharpenOpacity").value = DAYLIGHT.sharpen + (HERO_LIGHT.post.sharpen - DAYLIGHT.sharpen) * h;
    }
    final.u("uOpacity").value = remap(multi.hideRatio, 0, 0.25, 1, 0);
    updateLens(state.camera, dt);
    const barrel = fisheyeAt(openingNow());
    fisheyePass.enabled = barrel > 1e-4;
    fisheye.u("uStrength").value = barrel;
    fisheye.u("uAspect").value = size.width / size.height;
    // Diagonal transition (Route live, map captured): active strictly inside the wipe range of the page.
    const page = window.scrollY;
    const t = wipeProgress(page);
    const side = t <= 0 ? 0 : t >= 1 ? 2 : 1;
    if ((side === 2) !== (lastSide.current === 2)) lensState.current.first = true; // camera cut at the switch: no history
    lastSide.current = side;
    capturePass.enabled = o.capture;
    finalPass.enabled = !o.offscreen;
    wipePass.enabled = !o.offscreen && side === 1 && captured.current;
    wipe.u("uRatio").value = wipeRatioAt(page);
    wipe.u("uBorder").value = 2 / size.width; // shipped: uDpr / uResolution.x * 2 in drawing-buffer pixels
    gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    const night = s[SCENE.IGNITION_VERIFIED].progress > 0.99;
    // Raven payload stage (lib/payload.ts): the sky goes to the clay model's black.
    _clearMix.copy(night ? BG_COLOR : SKY_COLOR).lerp(PAYLOAD_BG, payloadLook().sky);
    gl.setClearColor(_clearMix, 1);
    gl.outputColorSpace = THREE.SRGBColorSpace;
    renderSceneAndDrones(dt);
    composer.render(dt);
    lensState.current.prevVP.copy(_vp);
  }

  /** Current hero drone groups (re-resolved if a remount replaced them). */
  function drones() {
    const list = droneGroups.current;
    if (list.length !== DRONE_GROUPS.length || list.some((g) => !g.parent)) {
      droneGroups.current = DRONE_GROUPS.map((n) => scene.getObjectByName(n)).filter((g): g is THREE.Object3D => !!g);
    }
    return droneGroups.current;
  }

  /**
   * Scene at the scene density without the drone bodies, then the bodies alone into the drone layer
   * (DroneCompositePass). The sun's shadow map is only cast by and received on the drones (Drone.tsx), so it is
   * rendered in the drone pass only.
   */
  function renderSceneAndDrones(dt: number) {
    const groups = drones();
    const shownGroups: THREE.Object3D[] = [];
    for (const g of groups) {
      assignDroneLayer(g); // before the scene render: the bodies must already be off its layer
      let shown = true;
      for (let o: THREE.Object3D | null = g; o; o = o.parent) if (!o.visible) shown = false;
      if (shown) shownGroups.push(g);
    }
    let anyShown = shownGroups.length > 0;
    const autoShadow = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;
    sceneComposer.render(dt);
    gl.shadowMap.autoUpdate = autoShadow;
    // The scene composer swaps its buffers once per swapping pass: the result is in the input buffer after an even count.
    let swaps = 0;
    for (const pass of sceneComposer.passes) if (pass.enabled && pass.needsSwap) swaps++;
    const u = composite.uniforms;
    u.tScene.value = (swaps % 2 === 0 ? sceneComposer.inputBuffer : sceneComposer.outputBuffer).texture;
    const depth = (sceneComposer as unknown as { depthRenderTarget: THREE.WebGLRenderTarget | null }).depthRenderTarget;
    u.tSceneDepth.value = depth?.depthTexture ?? null;
    u.uSceneDepth.value = depth?.depthTexture ? 1 : 0;
    // The region the drones cover on screen (the scene render just updated every world matrix and the camera).
    const r = droneRegion.current;
    const rect = anyShown ? droneScreenRect(shownGroups, r.fw, r.fh) : null;
    anyShown = !!rect;
    u.uDrones.value = anyShown ? 1 : 0;
    if (!rect) return;
    // Allocation: grows in steps with headroom and is kept while the need stays within 60-100% of it, so it is
    // reallocated only on large changes (chapter switches), never per frame. Near full screen it is the full canvas.
    const nw = Math.min(r.fw, rect[2] - rect[0]);
    const nh = Math.min(r.fh, rect[3] - rect[1]);
    if (r.aw === 0 || nw > r.aw || nh > r.ah || nw < REGION_KEEP * r.aw || nh < REGION_KEEP * r.ah) {
      r.aw = Math.min(r.fw, Math.max(REGION_STEP, Math.ceil((nw * REGION_HEADROOM) / REGION_STEP) * REGION_STEP));
      r.ah = Math.min(r.fh, Math.max(REGION_STEP, Math.ceil((nh * REGION_HEADROOM) / REGION_STEP) * REGION_STEP));
      if (r.aw * r.ah > 0.8 * r.fw * r.fh) {
        r.aw = r.fw;
        r.ah = r.fh;
      }
      droneTarget.setSize(r.aw, r.ah);
    }
    const rx = Math.min(Math.max(Math.round((rect[0] + rect[2] - r.aw) / 2), 0), r.fw - r.aw);
    const ry = Math.min(Math.max(Math.round((rect[1] + rect[3] - r.ah) / 2), 0), r.fh - r.ah);
    u.uDroneRect.value.set(rx / r.fw, ry / r.fh, r.aw / r.fw, r.ah / r.fh);
    u.uDroneTexel.value.set(1 / r.aw, 1 / r.ah);

    // Every light joins the drone layer, so the bodies are lit exactly as in a single-pass render (same light set,
    // same shader programs as the prewarm compiled).
    scene.traverse((o) => {
      if ((o as THREE.Light).isLight) o.layers.enable(DRONE_LAYER);
    });
    const mask = camera.layers.mask;
    const prevTarget = gl.getRenderTarget();
    const prevAlpha = gl.getClearAlpha();
    gl.getClearColor(_clear);
    const background = scene.background;
    scene.background = null;
    camera.layers.set(DRONE_LAYER);
    // Crop the camera's own projection to the region (clip-space scale + offset), restored exactly afterwards; no
    // updateProjectionMatrix, so the layer always uses the very projection the scene was rendered with.
    _proj.copy(camera.projectionMatrix);
    _projInv.copy(camera.projectionMatrixInverse);
    const sx = r.fw / r.aw;
    const sy = r.fh / r.ah;
    _crop.set(sx, 0, 0, sx - 1 - (2 * rx) / r.aw, 0, sy, 0, sy - 1 - (2 * ry) / r.ah, 0, 0, 1, 0, 0, 0, 0, 1);
    camera.projectionMatrix.premultiply(_crop);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    gl.setRenderTarget(droneTarget);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, true, true);
    gl.render(scene, camera);
    camera.projectionMatrix.copy(_proj);
    camera.projectionMatrixInverse.copy(_projInv);
    camera.layers.mask = mask;
    scene.background = background;
    gl.setRenderTarget(prevTarget);
    gl.setClearColor(_clear, prevAlpha);
    u.tDrone.value = droneTarget.texture;
    u.tDroneDepth.value = droneTarget.depthTexture;
  }

  /**
   * Drawing-buffer rect [x0, y0, x1, y1] (bottom-left origin, padded) of the shown drones' world bounds, or the whole
   * canvas if a corner is behind the camera; null if nothing of them is on screen.
   */
  function droneScreenRect(groups: THREE.Object3D[], fw: number, fh: number): [number, number, number, number] | null {
    _box3.makeEmpty();
    for (const g of groups) _box3.union(_part3.setFromObject(g));
    if (_box3.isEmpty()) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      _corner.set(i & 1 ? _box3.max.x : _box3.min.x, i & 2 ? _box3.max.y : _box3.min.y, i & 4 ? _box3.max.z : _box3.min.z, 1);
      _corner.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      if (_corner.w <= 1e-6) return [0, 0, fw, fh];
      const px = (_corner.x / _corner.w) * 0.5 + 0.5;
      const py = (_corner.y / _corner.w) * 0.5 + 0.5;
      x0 = Math.min(x0, px);
      y0 = Math.min(y0, py);
      x1 = Math.max(x1, px);
      y1 = Math.max(y1, py);
    }
    const ax = Math.max(0, Math.floor(x0 * fw) - REGION_PAD);
    const ay = Math.max(0, Math.floor(y0 * fh) - REGION_PAD);
    const bx = Math.min(fw, Math.ceil(x1 * fw) + REGION_PAD);
    const by = Math.min(fh, Math.ceil(y1 * fh) + REGION_PAD);
    return bx > ax && by > ay ? [ax, ay, bx, by] : null;
  }

  function updateLens(cam: THREE.Camera, dt: number) {
    const st = lensState.current;
    const pc = cam as THREE.PerspectiveCamera;
    cam.updateWorldMatrix(true, false); // camera lives under the clip-driven mover/dolly groups
    _vp.multiplyMatrices(pc.projectionMatrix, pc.matrixWorldInverse);
    const offset = terrainOffset.current ?? 0;
    let step = offset - st.prevOffset;
    st.prevOffset = offset;
    if (st.first || Math.abs(step) > 2 || dt > 0.1) {
      // first frame, wrap/ramp jump or a stalled tab: no history, no blur this frame
      st.prevVP.copy(_vp);
      step = 0;
      st.step = 0;
      st.first = false;
    }
    // Smooth the per-frame travel so frame-time jitter does not make the streak length flicker.
    st.step = damp(st.step, step, 10, dt);
    st.drone ??= scene.getObjectByName("Drone1Group") ?? null;
    cam.getWorldPosition(_eye);
    const focus = st.drone ? st.drone.getWorldPosition(_drone).distanceTo(_eye) : 10;
    // The lens runs in the scene composer: its drawing-buffer pixels (scene density), not the canvas.
    const ratio = sceneComposer.inputBuffer.height / Math.max(size.height, 1);
    const u = (n: string) => lens.u(n).value;
    u("uInvProj").copy(pc.projectionMatrixInverse);
    u("uCamWorld").copy(pc.matrixWorld);
    u("uPrevViewProj").copy(st.prevVP);
    u("uTexel").set(1 / sceneComposer.inputBuffer.width, 1 / sceneComposer.inputBuffer.height);
    lens.u("uPxScale").value = (size.height * ratio) / 1080;
    lens.u("uNear").value = pc.near;
    lens.u("uFar").value = pc.far;
    lens.u("uTerrainStep").value = st.step;
    // Streak = per-frame screen motion scaled to the exposure: velocity x shutter time.
    lens.u("uShutter").value = dt > 0 ? Math.min(SHUTTER_S / dt, 4) : 0;
    // Payload stage: no travel streak on the clay model (it smeared the dot grid into dashes).
    lens.u("uMotion").value = reducedMotion || !lensOn ? 0 : 1 - payloadLook().clay;
    lens.u("uSpeedGain").value = mountainLens ? MOUNTAIN_CLARITY.speedGain : SPEED_GAIN;
    lens.u("uFocus").value = focus;
    pc.getWorldDirection(_camDir);
    // Top views, and the overhead chapters now shown obliquely (camera-tilt.ts).
    const topTarget = Math.max(THREE.MathUtils.smoothstep(-_camDir.y, 0.75, 0.95), cameraTilt.weight);
    topViewState.value += (topTarget - topViewState.value) * (1 - Math.exp(-dt / 0.4));
    const topView = topViewState.value;
    // Raven clay map (clay-map.ts): a sharp model, no depth of field (its contours and dots are the content).
    const dof = lensOn && !clayState.on;
    const [cocBase, cocTop] = mountainLens ? [MOUNTAIN_CLARITY.cocBase, MOUNTAIN_CLARITY.cocTop] : [COC_INF_PX_BASE, COC_INF_PX];
    // Payload page route stage: the `net` section terrain is a sharp model like the clay map (no defocus).
    lens.u("uCocInf").value = dof ? (cocBase + (cocTop - cocBase) * topView) * (1 - payloadLook().section) : 0;
    lens.u("uMaxBlurPx").value = (mountainLens ? MOUNTAIN_CLARITY.maxBlurPx : MAX_BLUR_PX) * ((size.height * ratio) / 1080);
    lens.u("uMaxCocPx").value = MAX_COC_PX * ((size.height * ratio) / 1080);
    lens.u("uTerrainTop").value = mountainLens ? MOUNTAIN_TERRAIN_TOP : TERRAIN_TOP;
    // Far rule off (perf, 2026-11-03): with the mountain's 1.5 px DoF the far ranges gain nothing visible from the lens,
    // and processing that whole band cost the opening ~15 fps. Kept for reference: MOUNTAIN_TERRAIN_FAR.
    lens.u("uTerrainFar").value = 0;
    void MOUNTAIN_TERRAIN_FAR;
    lens.u("uMinBlur").value = mountainLens ? 1.0 : 0.5;
    lens.u("uFrame").value = st.frame = (st.frame + 1) % 997;
    // Mountain terrain: its small blur (1.5 px DoF base, 5 px streak cap) needs half the taps; with the heavier
    // mountain ground shader, 24 taps pushed the frame past 16.7 ms (26-38 fps measured, 60 with the lens off).
    lens.u("uTaps").value = mountainLens ? 12 : 24;
  }
}
