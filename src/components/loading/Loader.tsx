"use client";

import clsx from "clsx";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useLoading } from "@/lib/loading";
import { whenQuiet } from "@/lib/quiet";
import { markPreparing, markRevealed } from "@/lib/load-eta";

/** The silhouette canvas (three.js) loads on its own; the rest of the loader is plain DOM in the page's HTML. */
const MatchCutCanvas = dynamic(() => import("./MatchCutCanvas"), { ssr: false });

const STATUS = {
  initializing: { label: "Initializing", progress: 0.18 },
  loading: { label: "Loading assets", progress: 0.52 },
  calibrating: { label: "Preparing scene", progress: 0.84 },
  ready: { label: "Ready", progress: 1 },
  degraded: { label: "Slow connection", progress: 0.52 },
};

/** Status line + progress hairline (shipped module 58905). */
function LoadingStatus() {
  const loaded = useLoading((s) => s.loadingCanvasLoaded);
  const main = useLoading((s) => s.mainAppLoaded);
  // "Preparing scene" until the mountain terrain is built (it was the footer sequence until the footer was removed).
  const terrain = useLoading((s) => s.terrainReady);
  const hiding = useLoading((s) => s.loadingCanvasIsHiding);
  const hidden = useLoading((s) => s.loadingCanvasHidden);
  const degraded = useLoading((s) => s.degraded);
  const status = hiding
    ? STATUS.ready
    : degraded
      ? STATUS.degraded
      : loaded
        ? main
          ? terrain
            ? STATUS.ready
            : STATUS.calibrating
          : STATUS.loading
        : STATUS.initializing;
  const max = useRef(0);
  max.current = Math.max(max.current, status.progress);
  // Loader ETA (lib/load-eta.ts): the inline script in the page HTML computes it; React only reports the phases.
  const preparing = main && !terrain;
  useEffect(() => {
    if (preparing) markPreparing();
  }, [preparing]);
  const done = hiding || hidden || status === STATUS.ready;
  useEffect(() => {
    if (done) markRevealed();
  }, [done]);
  if (hidden) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "pointer-events-none fixed inset-x-0 bottom-[max(12vh,5.5rem)] z-[950] transition-opacity duration-700 ease-out",
        hiding ? "opacity-0" : "opacity-100",
      )}
    >
      {/* Fades in from the first paint (CSS, globals.css .loader-status-in), not after hydration: on Slow 4G that was
          ~7 s of nothing. The outer element owns the fade-out at the reveal. */}
      <div className="loader-status-in flex flex-col items-center gap-3">
        <div className="h-px w-24 overflow-hidden bg-white/10">
          <div className="h-full bg-white/40 transition-[width] duration-700 ease-out" style={{ width: `${100 * max.current}%` }} />
        </div>
        <p className="font-mono text-[0.625rem] tracking-[0.28em] text-white/35 uppercase">
          {status.label}
          {/* Figure written by the inline ETA script as data-eta and drawn by CSS (globals.css .load-eta). */}
          <span id="load-eta" className="load-eta" suppressHydrationWarning />
        </p>
      </div>
    </div>
  );
}

/**
 * Loader orchestration (shipped modules 86700 + 60745). The reference reports
 * "loading-canvas-loaded/hidden" from a worker-rendered OffscreenCanvas; here the
 * DOM splash stands in and the reveal follows the same state transitions and
 * fallback timers (12s loaded, 20s degraded, 3s hide).
 */
export function Loader() {
  const loaded = useLoading((s) => s.loadingCanvasLoaded);
  const hidden = useLoading((s) => s.loadingCanvasHidden);
  const hiding = useLoading((s) => s.loadingCanvasIsHiding);
  const main = useLoading((s) => s.mainAppLoaded);
  const terrain = useLoading((s) => s.terrainReady);
  // Boot splash first, then the loading canvas takes over (12s fallback in the reference).
  useEffect(() => {
    const id = setTimeout(() => useLoading.setState({ loadingCanvasLoaded: true }), 600);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (main && terrain) useLoading.getState().setCanRemoveLoading();
  }, [main, terrain]);

  useEffect(() => {
    if (!loaded || hiding) return;
    const id = setTimeout(() => {
      useLoading.setState({ degraded: true });
      useLoading.getState().setCanRemoveLoading();
    }, 20000);
    return () => clearTimeout(id);
  }, [loaded, hiding]);

  useEffect(() => {
    if (!hiding || hidden) return;
    const id = setTimeout(() => useLoading.setState({ loadingCanvasHidden: true }), 900);
    return () => clearTimeout(id);
  }, [hiding, hidden]);

  // The silhouette canvas outlives the fade (hidden, paused) and is torn down at the first quiet moment: destroying a
  // WebGL context holds a frame (~100 ms), which used to land in the opening scroll move (load time, 2026-11-06).
  const [canvasGone, setCanvasGone] = useState(false);
  useEffect(() => {
    if (!hidden) return;
    let alive = true;
    whenQuiet().then(() => alive && setCanvasGone(true));
    return () => {
      alive = false;
    };
  }, [hidden]);

  return (
    <>
      {/* Stand-in for the reference's worker-rendered loading canvas (chunk 4867, not captured). */}
      {!canvasGone && loaded && (
        <div
          aria-hidden="true"
          className={clsx(
            "pointer-events-none fixed inset-0 z-[890] transition-opacity duration-700 ease-out",
            hiding || hidden ? "opacity-0" : "opacity-100",
            hidden && "invisible",
          )}
          style={{ background: "radial-gradient(120% 120% at 50% 45%, #0d1014 0%, #06070a 45%, #000 80%)" }}
        >
          <MatchCutCanvas paused={hidden} />
        </div>
      )}
      {!hidden && (
        <div
          aria-hidden="true"
          className={clsx(
            "pointer-events-none fixed inset-0 z-[900] flex items-center justify-center transition-opacity duration-500 ease-out",
            loaded ? "opacity-0" : "opacity-100",
          )}
          style={{ background: "radial-gradient(120% 120% at 50% 45%, #0d1014 0%, #06070a 45%, #000 80%)" }}
        />
      )}
      <LoadingStatus />
    </>
  );
}
