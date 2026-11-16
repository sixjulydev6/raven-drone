/**
 * First-frame gate (user 2026-11-16, Chrome on a Mac: "the drone loading is lagging"). The scene's first render used to
 * compile ~22 shader programs one after another on the main thread (2.5 s with a cold GPU cache, measured in Chrome
 * 1440x900), freezing the loader's drone silhouette. MainScene now starts `compileAsync` (KHR_parallel_shader_compile:
 * programs link in the background) on its first frame, and PostFX renders nothing until it resolves (or WARM_MAX_MS).
 */
export const WARM_MAX_MS = 8000;
export const sceneWarm = { started: false, ready: false };
