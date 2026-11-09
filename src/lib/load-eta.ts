/**
 * Loader ETA (user 2026-11-09: "show how long it will take to load the site, not the complete site"): seconds until
 * the reveal, i.e. the first frame, NOT until every full-quality map has arrived.
 *
 * The reveal waits on (production build, cold load, Slow 4G, 2026-11-09):
 *   1. ~1.92 MB over the wire: page + scene JS 615 KB, Geist fonts 194 KB, HTML + CSS 22 KB, first-frame files 1.09 MB
 *      (drone + terrain previews, env map, Draco, camera/drone clips, noise textures);
 *   2. the mountain build in its worker + material compile behind the loader (2-6 s on an M-series Mac);
 *   3. on fast links only, up to FULL_MAP_WAIT_MS (Terrain.tsx, 0.8 s) for the full-quality maps.
 *
 * It runs as an inline script in the page HTML (layout.tsx, `LOAD_ETA_SCRIPT`), so the figure shows from the first
 * paint instead of after hydration (Slow 4G: hydration is ~6.7 s in). React only reports phases to it through
 * `window.__ravenEta` (`markSceneCodeLoaded`, `markPreparing`, `markRevealed`); the script writes the figure into
 * `#load-eta`'s `data-eta`, drawn by CSS (globals.css `.load-eta`), so React never owns that text.
 *
 * Estimate: (bytes still to come) / (link rate) + prepare (+ round trips while the scene JS is not in).
 * - Rate: Chrome/Edge/Android report the link (`navigator.connection.downlink`, capped at 10 Mbps); otherwise, and
 *   whenever it is higher, the rate measured from finished downloads. Measured alone, the first second is dominated
 *   by small latency-bound files and read ~3x too slow (Slow 4G opened at "~32 s" for a 14 s wait).
 * - Bytes to come: Resource Timing lists only finished files, while the HTML preloads fill the link from the first
 *   byte, so received bytes are max(finished, rate x elapsed) rather than finished alone (which opened at "~17 s" for
 *   a 9 s wait).
 * No figure until `minBytes` and `minMs` of measurement exist (or the browser reports the link).
 * Re-measure `totalBytes` if the bundle or the first-frame assets change much.
 * `npm run dev` ships ~10 MB of unminified JS, so the figure is only meaningful on a production build.
 */
const CONFIG = {
  /** Everything downloaded before the reveal (compressed bytes, production build, 2026-11-09). */
  totalBytes: 1.92e6,
  /** Request round trips still ahead while the scene JS is not in (page JS, scene chunks, then the GLB/Draco chain). */
  trips: 4,
  /**
   * Share of the reported link the page actually gets: round-trip gaps between requests leave it idle. Calibrated on
   * Slow 4G and Fast 4G (2026-11-09): at 1.0 both runs opened ~25-45% low.
   */
  efficiency: 0.8,
  /** Mountain build + shader compile after the files are in (s): 3.6-3.8 s in every throttled run, 2-6 s unthrottled. */
  prepS: 3,
  /** While preparing, the figure never drops below this (s): past the estimate it holds at "~1 s". */
  floorS: 1,
  /** Fast links: the reveal waits up to this long for the full-quality maps (Terrain.tsx FULL_MAP_WAIT_MS). */
  hdS: 0.8,
  /** Terrain.tsx SLOW_PAGE_MS: past this the reveal no longer waits for the full-quality maps. */
  slowMs: 8000,
  /** Without a browser link figure, hold the first figure until this much has downloaded ... */
  minBytes: 96 * 1024,
  /** ... over at least this long (ms since the first request). */
  minMs: 1200,
};

/** State shared between React and the inline script. */
type EtaState = { scene: boolean; prep: number | null; done: boolean };
declare global {
  interface Window {
    __ravenEta?: EtaState;
  }
}
const state = (): EtaState | null => {
  if (typeof window === "undefined") return null;
  return (window.__ravenEta ??= { scene: false, prep: null, done: false });
};

/** FixedContainer's module has run: every scene chunk is in. */
export function markSceneCodeLoaded() {
  const s = state();
  if (s) s.scene = true;
}
/** Files are in; the mountain build and compile run (loader "Preparing scene"). */
export function markPreparing() {
  const s = state();
  if (s && s.prep === null) s.prep = performance.now();
}
/** The loader is fading out: stop and clear the figure. */
export function markRevealed() {
  const s = state();
  if (!s) return;
  s.done = true;
  document.getElementById("load-eta")?.removeAttribute("data-eta"); // now, not on the script's next tick
}

/**
 * Plain ES5 on purpose: it is inlined as a string, never transpiled. Ticks every 250 ms, counts down with the clock and
 * eases toward each new estimate (faster when it drops than when it grows), so the figure never jumps.
 */
const TICKER = `(function (c) {
  var w = window, s = (w.__ravenEta = w.__ravenEta || { scene: false, prep: null, done: false });
  var shown = null, last = 0, id = 0;
  function path(u) { try { return new URL(u, location.href).pathname; } catch (e) { return u; } }
  function estimate(now) {
    var hd = now < c.slowMs ? c.hdS : 0;
    if (s.prep !== null) return Math.max(c.floorS, c.prepS + hd - (now - s.prep) / 1000);
    var es = performance.getEntriesByType("resource"), nav = performance.getEntriesByType("navigation")[0];
    var bytes = 0, start = nav ? nav.requestStart : Infinity, end = nav ? nav.responseEnd : 0;
    if (nav) bytes += nav.encodedBodySize || nav.transferSize || 0;
    for (var i = 0; i < es.length; i++) {
      var e = es[i], size = e.encodedBodySize || e.transferSize || 0;
      if (size > 0) {
        bytes += size;
        start = Math.min(start, e.requestStart || e.startTime);
        end = Math.max(end, e.responseEnd);
      }
    }
    var conn = navigator.connection, hint = conn && conn.downlink > 0 ? (conn.downlink * 1e6) / 8 : 0;
    var rtt = conn && conn.rtt > 0 ? conn.rtt / 1000 : 0;
    var measured = bytes >= c.minBytes && now - start >= c.minMs && end > start ? bytes / ((end - start) / 1000) : 0;
    var rate = Math.max(measured, hint * c.efficiency);
    if (!rate || !isFinite(start)) return null;
    var received = Math.max(bytes, rate * ((now - start) / 1000));
    return Math.max(0, c.totalBytes - received) / rate + (s.scene ? 0 : c.trips * rtt) + c.prepS + hd;
  }
  function fmt(t) { return t < 1.5 ? "~1 s" : t < 60 ? "~" + Math.ceil(t) + " s" : "~" + Math.round(t / 60) + " min"; }
  function tick() {
    var el = document.getElementById("load-eta");
    if (s.done) { clearInterval(id); if (el) el.removeAttribute("data-eta"); return; }
    var now = performance.now(), target = estimate(now);
    if (target === null || !isFinite(target)) { last = now; return; }
    shown = shown === null ? target : Math.max(0, shown - (now - last) / 1000);
    shown += (target - shown) * (target < shown ? 0.35 : 0.15);
    last = now;
    if (el) el.setAttribute("data-eta", fmt(shown));
  }
  id = setInterval(tick, 250);
  tick();
})`;

/** Inline script for layout.tsx. */
export const LOAD_ETA_SCRIPT = `${TICKER}(${JSON.stringify(CONFIG)});`;
