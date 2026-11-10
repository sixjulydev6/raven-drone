/**
 * Quiet moments (user 2026-11-06: the opening move "is not responding immediately"). Heavy one-off work (a full-quality
 * texture upload with mipmaps, tearing down the loader's WebGL canvas) can hold a frame for 50-170 ms; it waits until
 * the page has not scrolled (wheel, touch, keys, snap moves) for QUIET_MS, so it never lands mid scroll animation.
 * No three.js here: the server-rendered loader imports it.
 */
const QUIET_MS = 300;
let lastInput = -1e9;
if (typeof window !== "undefined") {
  const mark = () => void (lastInput = performance.now());
  for (const type of ["scroll", "wheel", "touchmove", "keydown"] as const) window.addEventListener(type, mark, { passive: true });
}

/** Resolves on an animation frame at least `quietMs` (default QUIET_MS) after the last scroll input. */
export function whenQuiet(quietMs = QUIET_MS): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const wait = lastInput + quietMs - performance.now();
      if (wait > 0) setTimeout(check, wait + 16);
      else requestAnimationFrame(() => resolve());
    };
    check();
  });
}
