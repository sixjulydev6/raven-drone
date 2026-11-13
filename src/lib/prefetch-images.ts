import { useLoading } from "./loading";
import { whenQuiet } from "./quiet";

/**
 * Background prefetch for the sections below the 3D stage (user 2026-11-13: on phones the Hardware and Use cases
 * images "are loading very late"). Their <img> tags stay `loading="lazy"` (no fetch during the loader), so on a phone
 * the download only started once the section was close, while the scene's full-quality textures were still on the
 * network. Here they are fetched once the scene is revealed (the loader's first-frame downloads are done) and the
 * visitor is not scrolling, one at a time at low priority, so the lazy images later come straight from the HTTP cache.
 * Each entry is the <img>'s own src / srcset / sizes, so the browser picks the same candidate it will display.
 */
export type PrefetchImage = { src: string; srcSet?: string; sizes?: string };

const queue: PrefetchImage[] = [];
const seen = new Set<string>();
let running = false;

/** The scene is revealed (loader fading out): its first-frame assets are in. */
function afterReveal(): Promise<void> {
  if (useLoading.getState().loadingCanvasIsHiding) return Promise.resolve();
  return new Promise((resolve) => {
    const off = useLoading.subscribe((s) => {
      if (!s.loadingCanvasIsHiding) return;
      off();
      resolve();
    });
  });
}

function idle(): Promise<void> {
  return new Promise((resolve) =>
    "requestIdleCallback" in window ? window.requestIdleCallback(() => resolve(), { timeout: 2000 }) : setTimeout(resolve, 200),
  );
}

function fetchOne(entry: PrefetchImage): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = "low";
    if (entry.sizes) img.sizes = entry.sizes;
    if (entry.srcSet) img.srcset = entry.srcSet;
    img.onload = img.onerror = () => resolve();
    img.src = entry.src;
  });
}

async function pump() {
  if (running) return;
  running = true;
  await afterReveal();
  // Let the drone's full-quality maps (first in the scene's own queue) go first.
  await new Promise((r) => setTimeout(r, 1500));
  while (queue.length) {
    await whenQuiet();
    await idle();
    await fetchOne(queue.shift()!);
  }
  running = false;
}

/** Queue images for a background fetch (in order; duplicates ignored). Client only. */
export function prefetchImages(images: PrefetchImage[]) {
  if (typeof window === "undefined") return;
  for (const i of images) {
    const key = `${i.src}|${i.srcSet ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push(i);
  }
  void pump();
}
