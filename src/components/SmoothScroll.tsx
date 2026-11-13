"use client";

import { ReactLenis, useLenis } from "lenis/react";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { SCENE, SCENE_ORDER, SCENE_SPAN, sceneDataAt, useScenes, type SceneId, type SceneRange } from "@/lib/scenes";
import { measureStoryMap, pageBands, storyMap, toPage, toStory } from "@/lib/story-map";
import { linear } from "@/lib/math";
import { useLoading } from "@/lib/loading";
import { isScrollLocked, LOCK_EVENT } from "@/lib/scroll-lock";
import { useMediaQuery } from "@/lib/use-media-query";
import {
  CLIMB_STOP_MS,
  LEG2_MS,
  climbRange,
  altitudeProgress,
  altitudeRange,
  PAYLOAD_MS,
  payloadProgress,
  payloadRange,
  routeProgress,
  routeRange,
  speedProgress,
  speedRange,
  usePayload,
} from "@/lib/payload";

/** Returns a callback that scrolls to the end of `id` over 3s (shipped `w`). */
export function useScrollToScene(id: SceneId) {
  const lenis = useLenis();
  return () => {
    const vh = window.innerHeight;
    const target = SCENE_ORDER.slice(0, SCENE_ORDER.indexOf(id) + 1).reduce(
      (acc, s) => acc + (s === SCENE.INTRO_SCENE ? 1 : (SCENE_SPAN[s] / 100) * vh),
      0,
    );
    lenis?.scrollTo(toPage(target), { duration: 3, easing: linear });
  };
}

/** Snap duration for the whole opening move (page 0 → hero frame). */
const OPENING_MS = 2500; // was 5000, 3800, 3300, 2900 (user 2026-11-05: "a little faster")
/** Snap motion eases in and out (user 2026-11-05: "smooth scroll, seamless"): time to reach / leave full speed (ms). */
const SNAP_RAMP_MS = 260;
/** Share of a snap's cruise time spent easing in (and again out); capped at 1.1 s. */
const SNAP_EASE_SHARE = 0.28;
/** Time to reach cruise speed at the start of any move (ms): short, so a scroll answers at once. */
const SNAP_START_MS = 180;
/** Touch phones: opening and payload stage snaps play this much faster (user 2026-11-06: "late response"). */
const PHONE_STAGE_SPEEDUP = 1.7;
/** Free scroll smoothing outside the snap bands (Lenis lerp per 60 Hz frame; was .95 = almost none). */
const FREE_LERP = 0.18; // was .14, .11; user 2026-11-06: "too sticky and slow because of smoothness": less trailing
const WHEEL_MULTIPLIER = 1.1;
/**
 * Share of the wheel/touch distance the climb (free zone) scrolls by, by where it is (user 2026-11-05: "respond
 * immediately but not too fast", then "too many scrolls ... a little fast here"): the pull-back from the payload
 * frame goes quicker, the last stretch up to Ridge Clinic stays calm.
 */
const CLIMB_SCROLL_SCALE = { payload: 1.4, pullBack: 1.1, climb: 1.0, leg2: 0.72 }; // climb was .75 (user 2026-11-09: "too many scrolls to go up"); // tuned with FREE_MAX_LEAD (user 2026-11-05; payload 2026-11-06)
/**
 * Speed cap for the climb (user 2026-11-05: "it should be fast, but not this fast"): the wheel may run at most this far
 * (px) ahead of the eased scroll, so a hard flick moves the climb at ~lerp x lead x 60 px/s (~1,300) instead of
 * leaping, while ordinary scrolls are untouched.
 */
// User 2026-11-09 ("if I scroll back fast from Ridge Clinic it jumps"): the lead was 280 px, tuned at lerp .11; at
// FREE_LERP .18 that let a flick run ~2,800 px/s, so one fast reverse swipe flew the drone two-thirds of the way down
// the route in ~0.5 s (forward, the Ridge Clinic wall hid it). Now a speed, turned into a lead at the current lerp.
// User 2026-11-09 (next): "too many scrolls" up the climb at 1300 both ways. Forward runs into the Ridge Clinic wall,
// so it can be fast again; only the way back down stays calm.
// Feedback 2026-11-13 ("while coming reverse it is taking too many scrolls in both lines green and yellow"): reverse
// took ~370 px per swipe against ~667 forward. Same cap both ways now; the route is even along the scroll
// (payload.ts routeFlight), so a hard reverse fling covers ~1/3 of the climb, not 2/3 as at the old 280 px lead.
const FREE_MAX_SPEED = { up: 2800, down: 2800 }; // px/s (up = scrolling toward Ridge Clinic)
const freeMaxLead = (dir: number) => (dir > 0 ? FREE_MAX_SPEED.up : FREE_MAX_SPEED.down) / (FREE_LERP * 60); // ~260 / ~120 px at lerp .18
/** Hero -> payload frame (free since 2026-11-06, user: "too many scrolls"): a higher cap so a swipe crosses the stage. */
const PAYLOAD_MAX_LEAD = 300; // was 460 at lerp .18; top speed ~lerp x lead x 60 px/s (~4,300 at PAYLOAD_LERP, was ~5,000)
/**
 * Top of the page -> payload frame (user 2026-11-06: "smooth but there is some delay, not responding immediately").
 * Measured headless at 60 fps: the page moved on the first frame after the wheel, but at lerp .18 a step took ~200 ms to
 * reach 90% and drifted on ~300 ms after the swipe ended. A tighter lerp here follows the hand (~130 ms / ~180 ms).
 */
const PAYLOAD_LERP = 0.24; // .3 felt too fast (user 2026-11-06); .18 lagged
const inPayloadStage = (scroll: number) => payloadRange.T > 0 && scroll < payloadRange.Q + payloadRange.T;
const maxLead = (scroll: number, dir: number) => (inPayloadStage(scroll) ? PAYLOAD_MAX_LEAD : freeMaxLead(dir));
/** The root Lenis, for the climb's speed cap in the virtualScroll hook (set by SceneController). */
const lenisRef: { current: { targetScroll: number; animatedScroll: number; options: { lerp?: number } } | null } = { current: null };
/** Leg 2 (Ridge Clinic -> Summit Station; feedback 2026-11-13: "too fast ... increase one more scroll"): 3 -> 4 swipes. */
const onLeg2 = (scroll: number, dir: number) =>
  speedRange.T > 0 && scroll < speedRange.Q + speedRange.T + 0.5 && (scroll > speedRange.Q + 0.5 || (scroll >= speedRange.Q - 0.5 && dir > 0));
const climbScale = (scroll: number, dir: number) =>
  onLeg2(scroll, dir)
    ? CLIMB_SCROLL_SCALE.leg2
    : inPayloadStage(scroll)
    ? CLIMB_SCROLL_SCALE.payload
    : scroll < climbRange.Q
      ? CLIMB_SCROLL_SCALE.pullBack
      : CLIMB_SCROLL_SCALE.climb;
/** Wheel events closer than this belong to one swipe (trackpad momentum included). */
const GESTURE_GAP_MS = 120; // was 220: quick repeated scrolls were merged into one (momentum events come every ~16 ms)
/** A new swipe during a snap queues the next stop only after this share of the current one has played. */
const CHAIN_AFTER = 0.35; // was 0.6: a scroll during a move queues the next stop sooner

/**
 * Scrolling unlocks the moment the loader starts to fade, not once it has faded out (user 2026-11-06: "the scroll is
 * not responding immediately"): the scene is rendered by then, and the ~0.9 s fade used to swallow the first scroll.
 */
const scrollUnlocked = () => {
  const s = useLoading.getState();
  return s.loadingCanvasIsHiding || s.loadingCanvasHidden;
};

/**
 * Set by SceneController: true when a wheel step in `dir` is taken over by the snap controller. Lenis then ignores
 * that wheel event (virtualScroll), so its smoothing never fights the snap; outside the bands it smooths freely.
 */
const snapClaim: { current: ((dir: number, deltaY: number, event: WheelEvent) => boolean) | null } = {
  current: null,
};

/**
 * Hold stops (user 2026-11-05: "once it comes here [Ridge Clinic] there should be some pause, and again when I scroll
 * it should move"): the two checkpoints. A move never carries on past them (no chaining, no queued scroll), and
 * scrolling is ignored for HOLD_MS after landing so momentum cannot push on.
 */
const HOLD_MS = 350; // was 800 (user: "pausing too much")
const isHoldStop = (y: number) => {
  const clinic = climbRange.Q + climbRange.T;
  const summit = speedRange.Q + speedRange.T;
  return (climbRange.T > 0 && Math.abs(y - clinic) < 1) || (speedRange.T > 0 && Math.abs(y - summit) < 1);
};

/**
 * Free zone (user 2026-11-05: "the scroll should follow the gesture immediately ... if I stop scrolling anywhere it
 * should stop there" for the climb; the hero part went back to its snaps, user: "make the scroll same like the previous
 * one"): from the payload frame to Ridge Clinic there are no snap stops, Lenis follows the wheel/touch directly. Both
 * ends are soft walls (the swipe that reaches them ends there; the next new swipe snaps on as before).
 */
// User 2026-11-06 ("from hero to the payload it is sticky ... it should scroll immediately, remove the sticky scroll";
// then "still too sticky"): the free zone starts at the top of the page, so the opening (low shot -> hero) and the
// payload stage follow the wheel too (both are pure functions of scroll: openingProgress, payloadProgress). The opening
// used to be a 2.5 s glide that swallowed every scroll made during it. Touch phones keep snaps.
const freeStart = () => 0;
const freeEnd = () => (climbRange.T > 0 ? climbRange.Q + climbRange.T : 0);
/**
 * Leg 2 (Ridge Clinic -> Summit Station, the green line) is a second free zone (feedback 2026-11-13: one swipe flew the
 * whole leg in a 2.6 s glide, "too much and not on scroll"; it should scroll like the climb). Ridge Clinic stays a wall
 * between the two zones, so the swipe that reaches it ends there (the checkpoint pause) and the next one flies on.
 */
const freeZones = (): [number, number][] => {
  const zones: [number, number][] = [[freeStart(), freeEnd()]];
  if (speedRange.T > 0) zones.push([speedRange.Q, speedRange.Q + speedRange.T]);
  return zones.filter(([a, b]) => b > a);
};
/** The free zone a step in `dir` from `scroll` moves through (an end counts when the step heads into the zone). */
const freeZoneAt = (scroll: number, dir: number): [number, number] | null => {
  if (touchPhone.current) return null;
  for (const z of freeZones()) {
    const [a, b] = z;
    if (scroll > a + 0.5 && scroll < b - 0.5) return z;
    if ((Math.abs(scroll - a) <= 0.5 && dir > 0) || (Math.abs(scroll - b) <= 0.5 && dir < 0)) return z;
  }
  return null;
};
/**
 * Touch phones (user 2026-11-06: the 3D stage "is taking too many scrolls to go down only in mobile"): no free zone.
 * Following the finger, the climb took ~8 of the stage's 12 swipes on a 390x844 phone; there it plays its two stops
 * (halfway up, Ridge Clinic) like every other stage, one swipe each. Set by SceneController from its media query.
 */
const touchPhone = { current: false };
const isFree = (scroll: number, dir: number) => freeZoneAt(scroll, dir) !== null;
/** When the free scroll last ran into one of its walls (performance.now) and in which direction. */
const freeWall = { at: -1e9, dir: 0 };

/**
 * Wheel gesture tracker, shared by Lenis' virtualScroll hook (which sees each wheel event first) and the snap
 * controller. A momentum tail only decays; a new swipe = a long gap, a gap where the delta stops decaying, deltas
 * growing again from the low point the previous swipe decayed to, or the other way round.
 *
 * User 2026-11-05 ("sometimes ... I have to do many scrolls"): a new swipe started while the last one's momentum was
 * still above 30% of its peak was taken for that tail and swallowed (and in the free zone and at the walls a
 * swallowed swipe moves nothing). Now a rise from the tail's low point counts wherever the tail is (`low`, two rising
 * events, a dip of up to 15% does not reset the count), and a mouse wheel spun without a pause (events >= 40 ms apart,
 * not decaying) starts a new gesture every RESWIPE_MS instead of being one endless gesture.
 */
const RESWIPE_MS = 1200;
const G = { lastTs: -1e9, lastAbs: 0, peak: 0, low: 0, rising: 0, lastFreshAt: -1e9, spent: 0, ev: null as WheelEvent | null, fresh: false };
function classifyWheel(e: WheelEvent) {
  if (G.ev === e) return G.fresh; // same event seen by both listeners
  const dir = e.deltaY > 0 ? 1 : -1;
  const abs = Math.abs(e.deltaY);
  const gap = e.timeStamp - G.lastTs;
  G.low = Math.min(G.low, abs);
  const risingFromLow = abs > G.lastAbs * 1.15 && abs >= 6 && G.low < G.peak * 0.6 && abs >= G.low * 1.8;
  G.rising = risingFromLow ? G.rising + 1 : abs < G.lastAbs * 0.85 ? 0 : G.rising;
  const sustained = gap >= 40 && e.timeStamp - G.lastFreshAt > RESWIPE_MS && abs >= 8 && abs >= G.peak * 0.5 && abs >= G.lastAbs * 0.9;
  const fresh =
    gap > 700 ||
    (gap > GESTURE_GAP_MS && abs >= 10 && abs >= G.lastAbs * 0.9) ||
    G.rising >= 2 ||
    sustained ||
    (G.spent !== 0 && dir !== G.spent);
  G.peak = fresh ? abs : Math.max(G.peak, abs);
  if (abs >= G.peak) G.low = abs; // the low point is measured after the peak
  G.lastTs = e.timeStamp;
  G.lastAbs = abs;
  if (fresh) {
    G.spent = 0;
    G.rising = 0;
    G.low = abs;
    G.lastFreshAt = e.timeStamp;
  }
  G.ev = e;
  G.fresh = fresh;
  return fresh;
}

const findRangeIndex = (scroll: number, ranges: SceneRange[]) => {
  for (let i = 0; i < ranges.length; i++) if (scroll < ranges[i].end) return i;
  return ranges.length - 1;
};

/** Re-measure the story bands when the page layout changes (sections below band 1 size themselves after mount). */
function useStoryMeasure(onChange: () => void) {
  useEffect(() => {
    const ro = new ResizeObserver(() => onChange());
    ro.observe(document.body);
    window.addEventListener("resize", onChange);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onChange);
    };
  }, [onChange]);
}

/** Writes per-scene progress into the store on every Lenis scroll tick (Raven: from story scroll, story-map.ts). */
function useSceneProgressDriver() {
  const lenis = useLenis();
  const ranges = useRef<SceneRange[]>([]);
  const vhRef = useRef(0);

  useEffect(() => {
    if (!lenis) return;
    const measure = () => {
      vhRef.current = window.innerHeight;
      ranges.current = measureStoryMap();
    };
    const update = ({ scroll: page }: { scroll: number }) => {
      if (isScrollLocked()) return;
      const vh = vhRef.current || window.innerHeight;
      const data = sceneDataAt(toStory(page), ranges.current, vh);
      const { updateSceneData } = useScenes.getState();
      for (const r of ranges.current) updateSceneData(r.id, data[r.id]);
      usePayload.getState().setP(payloadProgress(page), altitudeProgress(page), routeProgress(page), speedProgress(page)); // hero copy / payload callout thresholds
    };
    const current = () => ({ scroll: lenis.actualScroll || lenis.scroll || 0 });
    measure();
    update(current());
    lenis.on("scroll", update);
    const onResize = () => {
      measure();
      update(current());
    };
    const onLock = (e: Event) => {
      if (!(e as CustomEvent).detail?.locked) update(current());
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(document.body);
    window.addEventListener("resize", onResize);
    window.addEventListener(LOCK_EVENT, onLock);
    return () => {
      ro.disconnect();
      window.removeEventListener(LOCK_EVENT, onLock);
      window.removeEventListener("resize", onResize);
      lenis.off("scroll", update);
    };
  }, [lenis]);
}

/**
 * The page-space band holding `scroll`, and the scene index inside it (null outside the story). The band's own end
 * counts as inside: the story ends on a resting frame (the ridge village), and a reverse gesture there must snap back.
 */
const findBand = (scroll: number, bands: SceneRange[][]) => {
  for (let b = 0; b < bands.length; b++) {
    const list = bands[b];
    if (list.length && scroll >= list[0].start && scroll <= list[list.length - 1].end + 0.5) return { b, list, i: findRangeIndex(scroll, list) };
  }
  return null;
};

/**
 * Chapter snapping (shipped `f` in module 82245): wheel/keys/touch pick the
 * next or previous scene end, then a RAF loop steps toward it at 2px/ms while
 * Lenis velocity is low.
 */
function SceneController() {
  const lenis = useLenis();
  const loadingHidden = useLoading((s) => s.loadingCanvasIsHiding || s.loadingCanvasHidden);
  const isTouchPhone = useMediaQuery("(max-width: 768px) and (pointer: coarse)");
  useEffect(() => {
    touchPhone.current = isTouchPhone;
  }, [isTouchPhone]);

  const scrollbarDrag = useRef(false);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const sb = window.innerWidth - document.documentElement.clientWidth;
      if (sb > 0 && e.clientX >= window.innerWidth - sb) scrollbarDrag.current = true;
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);

  useSceneProgressDriver();

  const bands = useRef<SceneRange[][]>([]);
  const target = useRef<number | null>(null);
  const lastTs = useRef<number | null>(null);
  const touching = useRef(false);
  const navTouch = useRef(false);
  const pendingDir = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  /** Signed snap speed (px/ms): eased up from rest and down into the target. */
  const snapVel = useRef(0);
  /** Target and length of the current snap leg (for the length-scaled ease). */
  const legTarget = useRef<number | null>(null);
  const legLen = useRef(0);
  const legRate = useRef(0);
  /** Start of the current stop-to-stop move, and a scroll made early in it that waits to queue the next stop. */
  const moveStart = useRef(0);
  const queuedDir = useRef(0);
  /** When the last move landed, and whether on a hold stop (checkpoint). */
  const arrivedAt = useRef(0);
  const arrivedHold = useRef(false);
  /**
   * Phones (user 2026-11-06: hero snap "delaying, late response" after a swipe): the finger's speed (px/ms, smoothed)
   * and a flag set when a swipe's snap is picked, so the move starts at the finger's pace instead of from rest.
   * Measured before (390x844, 250 px swipe): the page stopped dead ~70 ms after the lift, ramped over ~220 ms, and
   * landed 2.0-2.6 s after the lift.
   */
  const touchVel = useRef(0);
  const touchLaunch = useRef(false);

  const measure = useCallback(() => {
    bands.current = pageBands(measureStoryMap());
  }, []);
  useEffect(measure, [measure]);
  useStoryMeasure(measure);

  // Snapping works inside the story band (page space, opening → end of the story); after it the page scrolls freely.
  const computeTarget = useCallback((scroll: number, dir: number): number | null => {
    if (isFree(scroll, dir)) return null; // the free zone scrolls with the gesture, no stops
    const hit = findBand(scroll, bands.current);
    if (!hit) return null;
    const { b, list, i } = hit;
    const { start, height, end } = list[i];
    const p = (scroll - start) / height;
    const last = i === list.length - 1;
    // Reverse snapping ends on the band's opening frame (top of page / Care teams frame), then scrolls freely above it.
    const bandStart = b === 0 ? 0 : Math.abs(scroll - list[0].start) < 1 ? null : list[0].start;
    if (dir > 0) return p < 0.99 ? end : last ? null : list[i + 1].end;
    const prev = i - 1;
    if (prev < 0) return bandStart;
    const prevEnd = list[prev].end;
    if (Math.abs(prevEnd - scroll) < 1) return prev > 0 ? list[prev - 1].end : bandStart;
    return prevEnd;
  }, []);

  const pickTarget = useCallback(
    (dir: number) => {
      if (!lenis) return;
      target.current = computeTarget(lenis.scroll, dir);
    },
    [lenis, computeTarget],
  );

  // Wheel steps the snap will play are not also smoothed by Lenis (see snapClaim).
  useEffect(() => {
    if (!lenis) return;
    lenisRef.current = lenis;
    snapClaim.current = (dir, deltaY, event) => {
      if (!scrollUnlocked() || isScrollLocked()) return false;
      const fresh = classifyWheel(event);
      if (target.current !== null) return true;
      // Free zone: Lenis takes the wheel, except where it would run past one of its ends (payload frame, Ridge Clinic).
      if (isFree(lenis.scroll, dir)) {
        // The swipe that just landed a stop (e.g. Summit Station -> Ridge Clinic) must not run on into the free climb
        // with its momentum (user 2026-11-05: coming back, the drone jumped straight down the route); nor anything in
        // the short pause after landing on a checkpoint. A new swipe goes through at once.
        if (!fresh && arrivedAt.current >= G.lastFreshAt) return true;
        if (arrivedHold.current && performance.now() - arrivedAt.current < HOLD_MS) return true;
        const next = lenis.targetScroll + deltaY * WHEEL_MULTIPLIER * climbScale(lenis.targetScroll, dir);
        // The swipe that ran into a wall ends there: its momentum does not carry on into the next zone (Ridge Clinic).
        if (!fresh && dir === freeWall.dir && freeWall.at >= G.lastFreshAt) return true;
        const [za, zb] = freeZoneAt(lenis.scroll, dir)!;
        const wall = dir > 0 ? (next >= zb ? zb : null) : next <= za ? za : null;
        if (wall !== null) {
          lenis.scrollTo(wall); // eased by Lenis' lerp, lands on the frame
          freeWall.at = performance.now();
          freeWall.dir = dir;
          return true; // claimed: no native/Lenis step past the wall
        }
      }
      return computeTarget(lenis.scroll, dir) !== null;
    };
    return () => {
      snapClaim.current = null;
    };
  }, [lenis, computeTarget]);

  const request = useCallback(
    (dir: number) => {
      if (isTouchPhone) pendingDir.current = dir;
      else pickTarget(dir);
    },
    [isTouchPhone, pickTarget],
  );

  const run = useCallback(() => {
    if (raf.current !== null || !lenis) return;
    const step = (ts: number) => {
      if (isScrollLocked()) {
        touching.current = false;
        raf.current = null;
        lastTs.current = null;
        snapVel.current = 0;
        return;
      }
      const dt = Math.min(lastTs.current ? ts - lastTs.current : 16, 100);
      lastTs.current = ts;
      const vel = Math.abs(lenis.velocity);
      // Phones: no wait for Lenis' touch inertia to die down; the snap's own steps (immediate) replace it at once.
      if (isTouchPhone && !touching.current && pendingDir.current !== null) {
        pickTarget(pendingDir.current);
        pendingDir.current = null;
        touchLaunch.current = target.current !== null;
      }
      let t = target.current;
      const scroll = lenis.scroll;
      if (t !== null && queuedDir.current !== 0) {
        const leg = Math.abs(t - moveStart.current);
        const done = leg > 0 ? Math.abs(scroll - moveStart.current) / leg : 1;
        if (Math.sign(t - scroll) !== queuedDir.current) queuedDir.current = 0;
        else if (done >= CHAIN_AFTER) {
          const next = isHoldStop(t) ? null : computeTarget(t, queuedDir.current);
          if (next !== null) {
            moveStart.current = t;
            target.current = t = next;
          }
          queuedDir.current = 0;
        }
      }
      if (t !== null) {
        const delta = t - scroll;
        if (Math.abs(delta) <= 0.05) {
          target.current = null;
          snapVel.current = 0;
          arrivedAt.current = performance.now();
          arrivedHold.current = isHoldStop(t);
          queuedDir.current = 0;
        } else if ((vel < 2 * dt || isTouchPhone) && !scrollbarDrag.current && (!isTouchPhone || !touching.current)) {
          const sign = delta > 0 ? 1 : -1;
          // Raven: the opening move plays over OPENING_MS whatever the viewport height; the story keeps 2px/ms.
          // The clay landscape climb (Care teams → village, storyMap.C0..C1) moves at half speed so the climb reads.
          const inClimb = storyMap.C1 > storyMap.C0 && Math.min(scroll, t) >= storyMap.C0 - 1 && Math.max(scroll, t) <= storyMap.C1 + 1;
          // Raven payload stage (lib/payload.ts): one gesture plays it over PAYLOAD_MS whatever the viewport height.
          const { Q, T } = payloadRange;
          // Same pace for the altitude and route stages right after it.
          const stagesEnd =
            speedRange.T > 0
              ? speedRange.Q + speedRange.T
              : routeRange.T > 0
                ? routeRange.Q + routeRange.T
                : altitudeRange.T > 0
                  ? altitudeRange.Q + altitudeRange.T
                  : Q + T;
          const inPayload = T > 0 && Math.min(scroll, t) >= Q - 1 && Math.max(scroll, t) <= stagesEnd + 1;
          // The climb to Ridge Clinic (two stops) plays slower than the stage moves, so the climb reads.
          const C = climbRange;
          // Leg 2 (speed stage, two stops) at the same pace: climb start -> end of the speed stage.
          const legsEnd = speedRange.T > 0 ? speedRange.Q + speedRange.T : C.Q + C.T;
          const inMountClimb = C.T > 0 && Math.min(scroll, t) >= C.Q - 1 && Math.max(scroll, t) <= legsEnd + 1;
          const baseRate =
            scroll < storyMap.P + 1 && t <= storyMap.P + 1
              ? Math.max(storyMap.P / OPENING_MS, 0.2)
              : inMountClimb
                ? speedRange.T > 0 && Math.min(scroll, t) >= speedRange.Q - 1
                  ? Math.max(speedRange.T / LEG2_MS, 0.2) // leg 2 in one move
                  : Math.max(C.T / 2 / CLIMB_STOP_MS, 0.2)
                : inPayload
                  ? Math.max(T / PAYLOAD_MS, 0.2)
                  : inClimb
                    ? 1
                    : 2.4; // was 2 (shipped); user 2026-11-05: a little faster
          // Phones: the opening and payload moves (desktop scrolls them freely) were 2.5 s / 2.0 s glides that felt late
          // (user 2026-11-06); they play ~1.7x faster on touch phones.
          const rate = isTouchPhone && Math.max(scroll, t) <= payloadRange.Q + payloadRange.T + 1 ? baseRate * PHONE_STAGE_SPEEDUP : baseRate;
          // A swipe's snap starts at the finger's pace (at least 60% of cruise), not from rest.
          if (touchLaunch.current) {
            touchLaunch.current = false;
            legTarget.current = null;
            legLen.current = 0;
            legRate.current = 0;
            snapVel.current = sign * Math.min(rate, Math.max(rate * 0.6, Math.abs(touchVel.current)));
          }
          // Eased: accelerate to `rate` over SNAP_RAMP_MS, brake so speed reaches 0 at the target (v = sqrt(2 a d)).
          // Long moves (the climb, the stages) ease in and out over a share of their own duration, so they glide like a
          // camera move instead of starting and stopping at full speed (user 2026-11-05: "very smooth"); short moves
          // keep the short ramp.
          // One pace per move: a move that crosses from one stage's pace into another's (payload frame -> halfway up
          // the climb) keeps the pace it started with instead of slowing down mid-climb.
          if (legTarget.current !== t) {
            const fromRest = snapVel.current === 0;
            legTarget.current = t;
            legLen.current = Math.max(Math.abs(delta), fromRest ? 0 : legLen.current);
            legRate.current = fromRest ? rate : legRate.current || rate;
          }
          const pace = legRate.current || rate;
          // Responsive start, gentle landing (user 2026-11-05: "there is delay on scroll"): the move reaches cruise
          // speed in SNAP_START_MS whatever its length; only the braking into the stop scales with the move.
          const rampOutMs = Math.min(Math.max(SNAP_RAMP_MS, (legLen.current / pace) * SNAP_EASE_SHARE), 1100);
          const accelOut = pace / rampOutMs;
          const accel = pace / SNAP_START_MS;
          const want = sign * Math.min(pace, Math.sqrt(2 * accelOut * Math.abs(delta)));
          const dv = want - snapVel.current;
          const maxDv = (Math.sign(dv) === sign ? accel : Math.max(accel, accelOut) * 2) * dt;
          snapVel.current += Math.max(-maxDv, Math.min(maxDv, dv));
          // Never stall a hair short of the target.
          if (snapVel.current * sign < 0.02) snapVel.current = sign * 0.02;
          const stepPx = snapVel.current * dt;
          const next = sign > 0 ? Math.min(scroll + stepPx, t) : Math.max(scroll + stepPx, t);
          lenis.scrollTo(next, { immediate: true });
        }
      }
      if (target.current !== null || pendingDir.current !== null) raf.current = requestAnimationFrame(step);
      else {
        raf.current = null;
        lastTs.current = null;
        snapVel.current = 0;
      }
    };
    raf.current = requestAnimationFrame(step);
  }, [lenis, isTouchPhone, pickTarget]);

  useEffect(() => {
    if (!lenis) return;
    const ready = () => scrollUnlocked() && !isScrollLocked();
    // A trackpad swipe is a burst of events with a momentum tail that can last over a second. One swipe plays ONE
    // stop (user 2026-11-05: the payload stage ran straight on into the mountain stage): events less than
    // GESTURE_GAP_MS after the previous one belong to the same swipe and never start or extend a snap. A new swipe in
    // the snap's direction queues the next stop only once the current one is mostly played (CHAIN_AFTER).
    let holdTimer = 0;
    const onWheel = (e: WheelEvent) => {
      if (!ready() || e.deltaY === 0) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      const fresh = classifyWheel(e);
      // The swipe that ran into a free-zone wall ends there; only a new one goes on.
      if (dir === freeWall.dir && freeWall.at >= G.lastFreshAt) return;
      if (isTouchPhone) {
        request(dir);
        run();
        return;
      }
      const t = target.current;
      if (t !== null && Math.sign(t - lenis.scroll) === dir) {
        const leg = Math.abs(t - moveStart.current);
        const done = leg > 0 ? Math.abs(lenis.scroll - moveStart.current) / leg : 1;
        if (fresh && done >= CHAIN_AFTER) {
          const next = isHoldStop(t) ? null : computeTarget(t, dir); // never carried past a hold stop
          if (next !== null) {
            moveStart.current = t;
            target.current = next;
          }
          G.spent = dir;
        } else if (fresh) {
          // Too early to chain: remember it, the run loop queues the next stop once the move is far enough along
          // (user 2026-11-05: scrolls during a move were lost, "I have to scroll many times").
          queuedDir.current = dir;
          G.spent = dir;
        }
        run();
        return;
      }
      if (G.spent === dir) return; // momentum tail of a swipe that already played its stop
      // A pause on the checkpoints: nothing moves on for HOLD_MS after landing there.
      const holdLeft = arrivedHold.current ? HOLD_MS - (performance.now() - arrivedAt.current) : 0;
      if (holdLeft > 0) {
        G.spent = dir;
        // A new scroll during the pause is kept and plays the moment the pause ends (the arriving swipe's own
        // momentum is not fresh, so it is still swallowed).
        if (fresh && holdTimer === 0) {
          holdTimer = window.setTimeout(() => {
            holdTimer = 0;
            if (target.current !== null || !ready()) return;
            moveStart.current = lenis.scroll;
            queuedDir.current = 0;
            pickTarget(dir);
            run();
          }, holdLeft);
        }
        return;
      }
      moveStart.current = lenis.scroll;
      queuedDir.current = 0;
      pickTarget(dir);
      G.spent = target.current !== null ? dir : 0;
      run();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!ready()) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        request(e.key === "ArrowDown" ? 1 : -1);
        run();
      }
    };
    let touchY = 0;
    let touchT = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (!ready()) return;
      if (e.target instanceof Element && e.target.closest('[data-nav-touch="1"]')) {
        navTouch.current = true;
        return;
      }
      navTouch.current = false;
      touchY = e.touches[0].clientY;
      touchT = e.timeStamp;
      touchVel.current = 0;
      touching.current = true;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!ready() || navTouch.current) return;
      const y = e.touches[0].clientY;
      const dtT = e.timeStamp - touchT;
      if (dtT > 0) touchVel.current = touchVel.current * 0.5 + ((touchY - y) / dtT) * 0.5;
      request(touchY - y > 0 ? 1 : -1);
      touchY = y;
      touchT = e.timeStamp;
    };
    const onTouchEnd = () => {
      if (isScrollLocked()) return;
      if (navTouch.current) {
        navTouch.current = false;
        return;
      }
      touching.current = false;
      if (scrollUnlocked()) run();
    };
    const onMouseUp = () => {
      if (!scrollbarDrag.current) return;
      scrollbarDrag.current = false;
      if (!ready()) return;
      const hit = findBand(lenis.scroll, bands.current);
      if (hit) {
        target.current = hit.list[hit.i].end;
        run();
      }
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("wheel", onWheel);
      if (holdTimer) window.clearTimeout(holdTimer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("mouseup", onMouseUp);
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [lenis, request, run, computeTarget, isTouchPhone]);

  useEffect(() => {
    const prev = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = prev;
    };
  }, []);

  // Lock scrolling until the loader starts to fade (the scene is up then), always start at the top.
  useEffect(() => {
    if (!lenis) return;
    target.current = null;
    pendingDir.current = null;
    if (loadingHidden) lenis.start();
    else lenis.stop();
    lenis.scrollTo(0, { immediate: true, force: true });
  }, [lenis, loadingHidden]);

  // Shipped: on reveal, advance into the first chapter automatically. Raven: the page opens on the low opening shot
  // and waits for the first scroll (the opening move is band 1's first range), so there is no auto-advance.

  // After a modal/menu unlocks, settle on the nearest scene end.
  useEffect(() => {
    if (!lenis) return;
    const onLock = (e: Event) => {
      if ((e as CustomEvent).detail?.locked || !scrollUnlocked() || isScrollLocked()) return;
      const s = lenis.scroll;
      const hit = findBand(s, bands.current);
      if (!hit || s <= 1 || hit.list.some((r) => Math.abs(r.end - s) <= 1)) return;
      if (target.current === null && pendingDir.current === null) target.current = hit.list[hit.i].end;
      run();
    };
    window.addEventListener(LOCK_EVENT, onLock);
    return () => window.removeEventListener(LOCK_EVENT, onLock);
  }, [lenis, run]);

  return null;
}

export function SmoothScroll({ children }: { children: ReactNode }) {
  return (
    <ReactLenis
      root
      options={{
        lerp: FREE_LERP,
        syncTouch: true,
        wheelMultiplier: WHEEL_MULTIPLIER,
        // Wheel steps inside the story bands belong to the snap controller (eased steps); elsewhere Lenis smooths.
        // Returning false alone lets the browser scroll natively by the raw delta (a visible jump), so cancel it here.
        virtualScroll: (data) => {
          const { event, deltaY } = data;
          // The climb (free zone) follows the gesture at a calmer rate (user 2026-11-05: "respond immediately but not
          // too fast"); Lenis reads the delta after this hook.
          if (deltaY !== 0 && isFree(window.scrollY, deltaY > 0 ? 1 : -1)) {
            const dir = deltaY > 0 ? 1 : -1;
            let d = Math.abs(deltaY) * climbScale(window.scrollY, dir);
            const L = lenisRef.current;
            // Lenis reads options.lerp for each wheel step, so the payload stage can follow the hand more tightly.
            if (L) L.options.lerp = inPayloadStage(window.scrollY) ? PAYLOAD_LERP : FREE_LERP;
            if (L && event.type === "wheel") d = Math.min(d, Math.max(0, maxLead(window.scrollY, dir) -(L.targetScroll - L.animatedScroll) * dir));
            data.deltaY = dir * d;
          }
          if (event.type !== "wheel" || deltaY === 0 || !snapClaim.current?.(deltaY > 0 ? 1 : -1, deltaY, event as WheelEvent)) return true;
          if (event.cancelable) event.preventDefault();
          return false;
        },
      }}
    >
      <SceneController />
      {children}
    </ReactLenis>
  );
}
