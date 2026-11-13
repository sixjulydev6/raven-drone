import { create } from "zustand";

/**
 * Raven render resolution (user 2026-11-03: "the drone ... should not pixelate in any of the screens").
 *
 * Three densities, all in drawing-buffer pixels per CSS pixel:
 * - canvas: the screen's own density (max 2). The composited frame, grade, wipe and fisheye run here, so the drones are
 *   never stretched by the browser (the old 1.5 cap stretched every frame 1.33x on retina screens).
 * - scene: terrain, sky, clouds, lens and SMAA (PostFX low composer). Adaptive between 1 and the canvas density:
 *   starts at 1.5 (the previous cap) and follows the frame rate (FixedContainer PerformanceMonitor). The whole frame at
 *   native density is not affordable on large retina screens (2560x1440 at 2x measured ~7 fps on an M3).
 * - drones: rendered on their own (PostFX `renderSceneAndDrones`) at the canvas density with MSAA, then
 *   depth-composited over the scene.
 */

/** Drawing-buffer pixels up to which the canvas may go past 2x: phones only (412x915 CSS at 3x = 3.4M). */
const PHONE_PIXELS = 3.6e6;

/**
 * Canvas density: the screen's own, capped at 2, and at 3 on phones (user 2026-11-13: the drone looked pixelated on a
 * real phone; its ~2.6-3x screen stretched the 2x canvas 1.3-1.5x). A phone screen at 3x is still fewer pixels than a
 * laptop at 2x, and the scene behind the drones stays at its own adaptive density (max 2, `sceneDprFor`).
 */
export function canvasDpr() {
  if (typeof window === "undefined") return 1;
  const native = window.devicePixelRatio || 1;
  if (native <= 2) return native;
  const pixels = window.innerWidth * window.innerHeight * native * native;
  return pixels <= PHONE_PIXELS ? Math.min(3, native) : 2;
}

/** Highest scene density: the canvas density, at most 2 (the scene is never rendered past 2x, phones included). */
const sceneMax = (canvas: number) => Math.min(2, canvas);

/** Scene density for a PerformanceMonitor factor (0..1): 1x .. sceneMax, in quarter steps (fewer reallocations). */
export function sceneDprFor(factor: number, canvas = canvasDpr()) {
  const max = sceneMax(canvas);
  const min = Math.min(1, max);
  const d = min + (max - min) * Math.min(Math.max(factor, 0), 1);
  return Math.min(max, Math.max(min, Math.round(d * 4) / 4));
}

/** Starting factor: scene density 1.5 (or the canvas density if lower), the cap the scene was tuned at. */
export function initialSceneFactor(canvas = canvasDpr()) {
  const max = sceneMax(canvas);
  return max > 1 ? (Math.min(1.5, max) - 1) / (max - 1) : 1;
}

/**
 * Drone layer MSAA samples: 4 on 1x screens, 2 from 1.5x up (at retina density 2 samples looked the same as 4 and cost
 * less; measured on an M3, 2026-11-03). Supersampling the layer (2x on 1x screens) cost ~15 fps at 1920x1080.
 * Phones (canvas past 2x, see canvasDpr) get 4 again: the thin arms and legs stair-stepped with 2 (user 2026-11-13), and
 * MSAA resolves on-chip on phone (tile-based) GPUs, so it costs little there.
 */
export function droneLayerSamples(canvas = canvasDpr()) {
  return canvas < 1.5 || canvas > 2 ? 4 : 2;
}

export const useRenderScale = create<{ sceneDpr: number; setSceneDpr: (dpr: number) => void }>((set) => ({
  sceneDpr: typeof window === "undefined" ? 1 : sceneDprFor(initialSceneFactor()),
  setSceneDpr: (dpr) => set((s) => (s.sceneDpr === dpr ? s : { sceneDpr: dpr })),
}));
