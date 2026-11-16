import { afterReveal, idle } from "./prefetch-images";
import { whenQuiet } from "./quiet";

/**
 * Section 04 clips downloaded in the background as whole files (user 2026-11-16, iPad mini: "the videos are not loading
 * fast"). iOS Safari ignores `preload="auto"`, so a clip only started downloading when it was asked to play, and each
 * tab switch waited for the next clip. Here the clips are fetched once the scene is revealed, one at a time at low
 * priority in scroll pauses, and handed to the <video>s as blob URLs: they play at once, including on the tab switch.
 * Skipped when the visitor asked to save data (the <video>s then stream as before).
 */
const blobs = new Map<string, string>();
const listeners = new Set<(url: string, blob: string) => void>();
let started = false;

export function videoBlob(url: string): string | undefined {
  return blobs.get(url);
}

/** Called with (network url, blob url) as each clip arrives. Returns an unsubscribe. */
export function onVideoBlob(fn: (url: string, blob: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function prefetchVideos(urls: string[]) {
  if (typeof window === "undefined" || started) return;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  started = true;
  void (async () => {
    await afterReveal();
    // After the drone's full-quality maps and the section images (prefetch-images starts 1.5 s after the reveal).
    await new Promise((r) => setTimeout(r, 3000));
    for (const url of urls) {
      await whenQuiet();
      await idle();
      try {
        const res = await fetch(url, { priority: "low" } as RequestInit);
        if (!res.ok) continue;
        const blob = URL.createObjectURL(await res.blob());
        blobs.set(url, blob);
        for (const fn of listeners) fn(url, blob);
      } catch {
        // Network error: that clip streams from its URL as before.
      }
    }
  })();
}
