import * as THREE from "three";
import { create } from "zustand";

/**
 * Raven payload stage (user, 2026-11-03): the page is now hero -> payload only. After the opening move lands on the
 * hero frame, one scroll gesture plays the payload stage over page [Q, Q + T] (story-map `storyMap.Q/T`):
 *   - the live mountain terrain turns into the grey clay model on black, sweeping from the far ridges to the drone
 *     (materials/TerrainMaterial `payloadClay`), sky and clouds fade to black,
 *   - the camera eases in toward the drone and lowers to the payload box (scene/payload-camera.ts),
 *   - the drone turns into its vector form, sweeping top to bottom (Drone.tsx `vectorise`),
 *   - the payload box lights up and the callout "15-25 kg" (user's figure) comes in (overlays/PayloadCallout.tsx).
 * Everything is a pure function of the scroll position, so it plays forward and backward with the scroll.
 */
export const PAYLOAD_VH = 200;
/** Snap duration for the whole stage (hero -> payload frame), whatever the viewport height. */
export const PAYLOAD_MS = 2000; // was 4200, 3200, 2700, 2300 (user 2026-11-05: "a little faster")

/** Stage timeline in payload progress (0 = hero frame, 1 = payload frame). */
export const PAYLOAD_TIMELINE = {
  /** Hero copy leaves (it used to leave at DELTA_DRONE .075). */
  heroExit: 0.02,
  /** Sky, clouds and clear colour to black. */
  sky: [0.02, 0.6],
  /** Clay sweep front, far ridges -> under the drone. */
  clay: [0.03, 0.8],
  /** Camera move toward the payload. */
  zoom: [0, 1],
  /** Drone to vector form (sweep top -> bottom). */
  vector: [0.22, 0.85],
  /** Payload box highlight. */
  highlight: [0.74, 0.96],
  /** Callout shown from here (enters with its own text motion; was .9, user 2026-11-05: text came in too slow). */
  callout: 0.74,
  /** Terrain travel speed in the clay view (x hero speed). */
  claySpeed: 0.4,
} as const;

/** The callout copy (user, 2026-11-03: "we can carry upto 15 to 25 kg"). */
export const PAYLOAD_COPY = {
  kicker: "Rated payload", // copy from the user's mockups, 2026-11-06
  value: "15–25 kg",
  body: "Of mission-ready medical payload, flown point-to-point in a single flight.",
} as const;

/** Clay look on black (scene/clay-map.ts CLAY, the reference's `net` section colours). */
export const PAYLOAD_BG = new THREE.Color("#0e0e0e");

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** C2 ease (smootherstep) of p over [a, b]. */
export const easeRange = (p: number, [a, b]: readonly [number, number]) => {
  const t = clamp01((p - a) / (b - a));
  return t * t * t * (t * (6 * t - 15) + 10);
};

/**
 * Early-peaking ease over [a, b]: smootherstep(t^0.6). It starts from rest (no kick: the plain ease-out jumped the
 * camera from still to full speed in ~0.2 s, user 2026-11-05: "jerky"), is already ~10% along at t = .1 so the scroll
 * answers at once, peaks early and lands softly.
 */
export const easeOutRange = (p: number, [a, b]: readonly [number, number]) => {
  const u = Math.pow(clamp01((p - a) / (b - a)), 0.6);
  return u * u * u * (u * (6 * u - 15) + 10);
};

/**
 * Scroll-proportional ease over [a, b] for free-scrolled stages: 65% linear + 35% smootherstep. Moves with the first
 * scroll and never stalls near the end (a plain ease-out or S-curve leaves hundreds of px where nothing moves).
 */
export const scrollEase = (p: number, [a, b]: readonly [number, number]) => {
  const t = clamp01((p - a) / (b - a));
  return 0.65 * t + 0.35 * t * t * t * (t * (6 * t - 15) + 10);
};

/**
 * Hero-frame hand-off (user feedback 2026-11-10: "jitter or lag at this exact point" on the hero frame). The opening
 * camera arrived at 65% of its mean speed and stopped turning in one frame while the payload zoom set off at 65% of
 * its own, in another direction (measured: camera turn 1.06 deg/100 px -> 0, drone on screen 0 -> +4.9 / 1e4 px).
 * Now the two overlap over HANDOFF_SHARE of the opening's length: the opening's linear part brakes to rest over its
 * last stretch while the zoom's linear part speeds up from rest over the same page px, so the camera's speed carries
 * through with no dead zone.
 */
export const HANDOFF_SHARE = 0.12;
/** Linear on [0, 1] with its slope easing to 0 over the last `w` (quadratic), rescaled to end on 1. */
export const linearEaseOutTail = (t: number, w: number) => {
  const x = clamp01(t);
  if (w <= 0) return x;
  const s = (x - (1 - w)) / w;
  return (s <= 0 ? x : 1 - w + w * (s - (s * s) / 2)) / (1 - w / 2);
};
/** Payload camera zoom for a page scroll: starts HANDOFF_SHARE of the opening before the hero frame, from rest. */
export const payloadZoomAt = (page: number) => {
  const { Q, T } = payloadRange;
  if (T <= 0) return 0;
  const lead = Q * HANDOFF_SHARE; // the opening spans page [0, Q]
  const t = clamp01((page - (Q - lead)) / (T + lead));
  const w = lead / (T + lead);
  return 0.65 * (1 - linearEaseOutTail(1 - t, w)) + 0.35 * t * t * t * (t * (6 * t - 15) + 10);
};

/** Page range of the stage, set by story-map `measureStoryMap`. */
export const payloadRange = { Q: 0, T: 0 };

/**
 * Altitude stage (user, 2026-11-03: "how much it fly in altitude wise ... zoom out in the side view ... draw a line from
 * the ground ... 5000m ... show the upcoming terrains which is taller"): the next gesture after the payload frame.
 * Same clay world and vector drone; the camera pulls back to a low side view (taller ridges ahead on the right), and a
 * dimension line rises from the ground under the drone to its skids (overlays/AltitudeCallout.tsx).
 */
export const ALTITUDE_VH = 200;
export const ALTITUDE_TIMELINE = {
  /** Payload callout leaves. */
  payloadExit: 0.02,
  /** Payload box back from yellow to the vector white. */
  highlightOut: [0.02, 0.35],
  /** Camera to the side view (payload-camera.ts applyAltitudeCamera eases its parts inside this). */
  camera: [0.02, 1],
  /** Clay fog opens up so the far ridges ahead show. */
  fog: [0.2, 0.95],
  /** Callout shown from here. */
  callout: 0.9,
} as const;

/** The altitude callout copy (user's figure: "5000m"). */
export const ALTITUDE_COPY = {
  kicker: "Service ceiling", // user's mockups, 2026-11-06
  value: "5,000 m",
  body: "Of operating altitude, putting even the last ridge within reach.",
} as const;

/** Page range of the altitude stage (directly after the payload stage), set by story-map `measureStoryMap`. */
export const altitudeRange = { Q: 0, T: 0 };
/** Altitude progress for a page scroll (0 = payload frame, 1 = side view with the altitude line). */
export const altitudeProgress = (page: number) => (altitudeRange.T > 0 ? clamp01((page - altitudeRange.Q) / altitudeRange.T) : 0);

/**
 * Mountain stage (user, 2026-11-03, final story: payload, then this; the altitude side view is gone): the gesture after
 * the payload frame. The ground under the drone already is the `net` section's terrain of
 * assets/html/raven_homepage (3).html ("Mapped to the last ridge", scene/net-terrain.ts), swept in by the payload
 * stage's clay front; its massif waits behind the drone in the haze. The camera pulls back to that section's view (the
 * haze clears, the drone gets small), then the route line draws from the drone to the top of the massif and the
 * altitude figure (user's "5,000 m") and the one checkpoint (Ridge Clinic) come in. A camera move, nothing grows.
 */
export const ROUTE_VH = 200;
export const ROUTE_TIMELINE = {
  /** Payload callout leaves. */
  payloadExit: 0.02,
  /** Payload box back from yellow to the vector white. */
  highlightOut: [0.02, 0.35],
  /** Camera pull-back to the section view (payload-camera.ts applyRouteCamera eases inside this). */
  camera: [0.02, 1],
  /** Section look (its fog, idle sway, pointer tilt) takes over from the close payload view. */
  section: [0.05, 0.85],
  /**
   * Altitude callout in from here (user 2026-11-05: the climb starts with the first scroll after the payload frame, so
   * the counter must be there from the start; was .9 when the line drew and the drone flew only after the pull-back).
   */
  path: 0.12,
} as const;

/**
 * Checkpoints (the section's sites; its depot is where the drone hovers): the clinic on top of the main massif, which
 * the drone flies to, and the summit station (user: "add another checkpoint ... how we have showed in the Html").
 */
export const ROUTE_COPY = { destination: "Ridge Clinic", second: "Summit Station" } as const;
/**
 * Site cards (user 2026-11-05: when the drone arrives a pin opens into a card with a photo and the name). Photos are
 * the user's own (portrait, ~270x310 and ~320x350, replaced 2026-11-09).
 */
export type SiteImage = { src: string; alt: string };
export const ROUTE_CLINIC_IMAGE: SiteImage = { src: "/assets/route/ridge-clinic.webp", alt: "Ridge Clinic, a small clinic in a mountain village" };
export const ROUTE_SUMMIT_IMAGE: SiteImage = { src: "/assets/route/summit-station.webp", alt: "Summit Station, a field medical tent" };
/** Flight up the route once the line has drawn (s), and the altitude the counter reaches at the route's top. */
export const ROUTE_FLIGHT = { drawS: 1.6, flyS: 6.5, returnS: 0.8, topM: 5000 } as const;

/**
 * Speed stage (user, 2026-11-03: distance and speed from the first checkpoint to the second; first tried as a drone
 * POV, then "maintain the same camera angle", the path "very simple" and in green): the gesture after the mountain
 * frame. Same section view; the drone flies leg 2 (one smooth arc, green) from the clinic to the summit station while
 * the HUD measures it: distance left (the path's own length, at the section's scale), speed and time.
 */
export const SPEED_VH = 200;
export const SPEED_TIMELINE = {
  /** Mountain callout leaves. */
  routeExit: 0.02,
  /** Stage weight (the view itself does not change). */
  camera: [0.02, 1],
  /**
   * HUD in from here. The flight itself follows the scroll since 2026-11-05 (user: "from here to here also it should
   * go on scroll"): speed progress = share of leg 2, two snap stops (halfway, Summit Station); was time-driven from .9.
   */
  fly: 0.03,
} as const;
/**
 * Figures. Distance: the section's "scene units ~ 50 m". Speed: from the user's own `net` section, whose cards give
 * 11.8 km in 9 min (Ridge Clinic) and 18.4 km in 14 min (Summit Station), both ~79 km/h. Time = distance / speed.
 * The flight on screen is compressed to `flyS`; the HUD shows the real distance and time.
 */
export const SPEED_FIGURES = { metresPerUnit: 50, kmh: 79 } as const;
export const SPEED_FLIGHT = { flyS: 11, returnS: 1, rampShare: 0.12 } as const;
export const SPEED_COPY = { kicker: "Cruise speed", eta: "ETA", distance: "Distance" } as const; // user's mockups, 2026-11-06: big figure = cruise speed // kicker was "Speed and distance" (user 2026-11-05: big figure = distance from 0)
/** Page range of the speed stage (directly after the mountain stage), set by story-map `measureStoryMap`. */
export const speedRange = { Q: 0, T: 0 };
export const speedProgress = (page: number) => (speedRange.T > 0 ? clamp01((page - speedRange.Q) / speedRange.T) : 0);
/** Speed stage on screen, written by DroneRig: leg 2 metres left, current speed (km/h), flight progress, summit pin. */
export const speedScreen = { left: 0, total: 0, kmh: 0, fly: 0, vx: 0, vy: 0, ok: false };

/**
 * Climb stage (user 2026-11-05: "it should climb the mount like on 2 scroll it should go up there"): right after the
 * mountain stage's pull-back (same `#route-band`, its second 200dvh). The flight up the route to Ridge Clinic follows
 * the scroll instead of a timer: two stops, halfway up, then the clinic. The altitude counter follows the drone.
 */
export const CLIMB_VH = 200;
/** Snap time per climb stop (ms): slower than the stage moves so the climb reads. */
export const CLIMB_STOP_MS = 2000; // was 1400 (user 2026-11-05: the Summit Station leg "too fast")
/** Leg 2 (Ridge Clinic -> Summit Station) in one gesture (user 2026-11-05: two stops were "too many scrolls"). */
export const LEG2_MS = 2600;
export const climbRange = { Q: 0, T: 0 };
/** Climb progress for a page scroll (0 = foot of the route, 1 = at Ridge Clinic). */
export const climbProgress = (page: number) => (climbRange.T > 0 ? clamp01((page - climbRange.Q) / climbRange.T) : 0);
/**
 * Share of the route to Ridge Clinic flown at a page scroll (user 2026-11-05: "after that section on scroll show the
 * drone climbing the mountain with the same camera angle and while climbing zoom out"). The climb runs over the
 * pull-back AND the climb band: the first gesture (payload frame -> halfway stop, story-map `pageBands`) flies the
 * first half while the camera zooms out, the second gesture the rest.
 */
export function routeFlight(page: number) {
  const span = routeRange.T + climbRange.T;
  if (span <= 0) return 0;
  const u = clamp01((page - routeRange.Q) / span);
  const start = 0.04; // a beat on the payload frame before the drone moves off
  // Even along the whole scroll (user 2026-11-05: back from Ridge Clinic the drone shot down the route). It used to be
  // split at the old halfway stop: the first half of the route over 3/4 of the scroll, the second half over the last
  // 1/4, so near the clinic each scrolled pixel moved the drone three times as far. The free climb has no stops now.
  return clamp01((u - start) / (1 - start));
}

/** Page range of the mountain stage (directly after the payload stage), set by story-map `measureStoryMap`. */
export const routeRange = { Q: 0, T: 0 };
/** Mountain stage progress for a page scroll (0 = payload frame, 1 = section view with the route line). */
export const routeProgress = (page: number) => (routeRange.T > 0 ? clamp01((page - routeRange.Q) / routeRange.T) : 0);

/** Payload progress for a page scroll (0 = hero frame, 1 = payload frame). */
export const payloadProgress = (page: number) => (payloadRange.T > 0 ? clamp01((page - payloadRange.Q) / payloadRange.T) : 0);
/** Payload progress now (root Lenis scrolls the window, so scrollY is the smoothed page scroll). */
export const payloadNow = () => (typeof window === "undefined" ? 0 : payloadProgress(window.scrollY));

/** Eased stage weights for the current scroll (payload stage, then altitude stage; one place for every consumer). */
export function payloadLook(page = typeof window === "undefined" ? 0 : window.scrollY) {
  const t = PAYLOAD_TIMELINE;
  const p = payloadProgress(page);
  const a = altitudeProgress(page);
  const r = routeProgress(page);
  const sp = speedProgress(page);
  const c = climbProgress(page);
  const rt = ROUTE_TIMELINE;
  return {
    p,
    a,
    r,
    /** Climb stage progress, and the share of the route flown (pull-back + climb, `routeFlight`). */
    c,
    fly: routeFlight(page),
    sky: easeRange(p, t.sky),
    // Linear (user 2026-11-05: the sweep jumped): the front then crosses the visible ground at an even pace instead of
    // racing through it mid-curve. Was easeRange (smootherstep), which packed the visible sweep into ~10% of the stage.
    clay: clamp01((p - t.clay[0]) / (t.clay[1] - t.clay[0])),
    // Ease-out (user 2026-11-05: the hero did not answer the scroll at once): the camera starts moving with the
    // scroll and settles softly. The S-curve it had (smootherstep) moved it <4% over the first fifth of the stage.
    // Mostly linear since 2026-11-06 (free scroll, user: "snap-like"): easeOutRange moved it 5% over the last 30% of the
    // stage, a dead zone before the mountain stage. scrollEase keeps ~2/3 of its mean speed at both ends.
    zoom: payloadZoomAt(page), // was scrollEase(p, t.zoom); starts just before the hero frame (HANDOFF_SHARE)
    vector: clamp01((p - t.vector[0]) / (t.vector[1] - t.vector[0])), // the sweep shader eases its own front
    highlight: easeRange(p, t.highlight) * (1 - easeRange(r, ROUTE_TIMELINE.highlightOut)),
    /** Altitude stage camera weight (raw progress in its range; the camera eases its parts). */
    side: clamp01((a - ALTITUDE_TIMELINE.camera[0]) / (ALTITUDE_TIMELINE.camera[1] - ALTITUDE_TIMELINE.camera[0])),
    fog: easeRange(a, ALTITUDE_TIMELINE.fog),
    /** Mountain stage camera weight (raw; applyRouteCamera eases it) and the section look's weight. */
    wide: clamp01((r - rt.camera[0]) / (rt.camera[1] - rt.camera[0])),
    section: easeRange(r, rt.section),
    /** Speed stage progress and its camera weight (raw; the chase blend eases it). */
    sp,
    chase: clamp01((sp - SPEED_TIMELINE.camera[0]) / (SPEED_TIMELINE.camera[1] - SPEED_TIMELINE.camera[0])),
  };
}

/** Threshold store for the DOM (hero copy out, callout in); written on every scroll tick (SmoothScroll). */
export const usePayload = create<{ p: number; a: number; r: number; sp: number; setP: (p: number, a: number, r: number, sp: number) => void }>()((set, get) => ({
  p: 0,
  a: 0,
  r: 0,
  sp: 0,
  setP: (p, a, r, sp) => {
    const s = get();
    const moved = (x: number, y: number) => Math.abs(x - y) > 0.002 || ((x === 0 || x === 1) && x !== y);
    if (moved(p, s.p) || moved(a, s.a) || moved(r, s.r) || moved(sp, s.sp)) set({ p, a, r, sp });
  },
}));

/** Payload box on screen (CSS px from the top-left), written by DroneRig every frame for the callout. */
export const payloadScreen = { x: 0, y: 0, ok: false };
/** Altitude line ends on screen (CSS px): ground under the drone (gx, gy) and the drone's skids (dx, dy). */
export const altitudeScreen = { gx: 0, gy: 0, dx: 0, dy: 0, ok: false };
/**
 * Mountain stage on screen (CSS px), written by DroneRig: the two sites (clinic, summit), how far the route lines have
 * drawn (0..1) and the altitude fraction the flying drone has reached (0..1, counter).
 */
export const routeScreen = { vx: 0, vy: 0, v2x: 0, v2y: 0, ok2: false, draw: 0, draw2: 0, alt: 0, fly: 0, ok: false };
