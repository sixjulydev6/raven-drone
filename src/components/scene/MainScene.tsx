"use client";

import { useFBO, useKeyboardControls, useTexture } from "@react-three/drei";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ASSETS } from "@/lib/assets";
import { resolution, SUN_POSITION, TERRAIN_SCALE, terrainOffset } from "@/lib/constants";
import { useLoading } from "@/lib/loading";
import { SCENE, scenes } from "@/lib/scenes";
import { isScrollLocked } from "@/lib/scroll-lock";
import { useMediaQuery } from "@/lib/use-media-query";
import { useRenderScale } from "@/lib/render-scale";
import { Clouds } from "./Clouds";
import { CloudWisps } from "./CloudWisps";
import { DroneRig } from "./DroneRig";
import { Flock } from "./Flock";
import { GridRow } from "./Grid";
import { HeroPlate, heroPlateEnabled } from "./HeroPlate";
import { startHd } from "./hd-assets";
import { sceneWarm, WARM_MAX_MS } from "./scene-warm";
import { OpeningSky } from "./OpeningSky";
import { usePostFX } from "./PostFX";
import { DAYLIGHT, HERO_LIGHT, heroLight, updateHeroLight } from "./hero-light";
import { plateLight } from "./plate-light";
import { sunlight, updateSunlight } from "./sunlight";
import { Terrain } from "./Terrain";
import { ClayTerrain } from "./ClayTerrain";
import { terrainVariant } from "./raven-terrain";

const TILE = 2 * TERRAIN_SCALE * 200;
/** Sun shadow camera hugs the hero drone (refit every few frames: swarm/mission rescale it). */
const SHADOW_REFIT_FRAMES = 15;
const _box = new THREE.Box3();
const _sphere = new THREE.Sphere();

const SOUNDS = {
  engine: "/assets/sounds/delta-jet.mp3",
  jetWind: "/assets/sounds/jet-wind.mp3",
  windLeft: "/assets/sounds/jet-wind-left.mp3",
  windRight: "/assets/sounds/jet-wind-right.mp3",
} as const;
const GAIN = { engine: 0.54, jetWind: 0.67, windLeft: 0.67, windRight: 0.65 };
type SoundKey = keyof typeof SOUNDS;

/** Keyboard-triggered engine/wind audio in the hero (shipped `t5`). Starts only on user keypress. */
function HeroAudio() {
  const [, getKeys] = useKeyboardControls();
  const ctx = useRef<AudioContext | null>(null);
  const nodes = useRef<Partial<Record<SoundKey, { gain: GainNode; source: AudioBufferSourceNode }>>>({});
  const levels = useRef<Record<SoundKey, number>>({ engine: 0, jetWind: 0, windLeft: 0, windRight: 0 });
  const started = useRef(false);
  useEffect(
    () => () => {
      Object.values(nodes.current).forEach((n) => n?.source.stop());
      ctx.current?.close();
    },
    [],
  );
  useFrame(() => {
    const { shift, left, right } = getKeys() as { shift: boolean; left: boolean; right: boolean };
    const idle = scenes()[SCENE.DELTA_DRONE].progress < 0.001 && !isScrollLocked();
    const want: Record<SoundKey, boolean> = {
      engine: shift && idle,
      jetWind: shift && idle,
      windLeft: left && idle,
      windRight: right && idle,
    };
    if (!started.current && (want.engine || want.windLeft || want.windRight)) {
      started.current = true;
      const ac = new AudioContext();
      ctx.current = ac;
      (Object.keys(SOUNDS) as SoundKey[]).forEach((k) => {
        fetch(SOUNDS[k])
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
          .then((b) => ac.decodeAudioData(b))
          .then((buf) => {
            const gain = ac.createGain();
            gain.gain.value = 0;
            gain.connect(ac.destination);
            const source = ac.createBufferSource();
            source.buffer = buf;
            source.loop = true;
            source.connect(gain);
            source.start();
            nodes.current[k] = { gain, source };
          })
          .catch(() => {});
      });
    }
    (Object.keys(SOUNDS) as SoundKey[]).forEach((k) => {
      const l = levels.current;
      if (want[k]) l[k] += (1 - l[k]) * 0.05;
      else {
        l[k] += (0 - l[k]) * 0.18;
        if (l[k] < 0.01) l[k] = 0;
      }
      const n = nodes.current[k];
      if (n) {
        n.gain.gain.value = l[k] * GAIN[k];
        if (k === "engine") n.source.playbackRate.value = 0.85 + 0.4 * l[k];
      }
    });
  });
  return null;
}

/**
 * Compile every material in `scene` now, hidden objects included, so nothing compiles mid-scroll. compileAsync
 * collects the programs synchronously, so visibility only has to be forced for that traversal.
 */
function prewarm(gl: THREE.WebGLRenderer, scene: THREE.Object3D, cam: THREE.Camera): Promise<unknown> {
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  const done = gl.compileAsync(scene, cam).catch(() => {});
  for (const o of hidden) o.visible = false;
  return done;
}

/** Flock scene rendered into an FBO through a portal (shipped `tK.Y`). */
function FlockPortal({ target, enabled }: { target: THREE.WebGLRenderTarget; enabled: boolean }) {
  const camera = useThree((s) => s.camera);
  const [portalScene] = useState(() => new THREE.Scene());
  const warmed = useRef(false);
  useFrame(({ gl }) => {
    // The Journey map renders its own scene. Render it once for real as soon as its instanced drones exist (compile
    // alone does not upload geometry): its first render at the transition stalled one frame (user: jitter).
    if (!warmed.current) {
      let ready = false;
      portalScene.traverse((o) => {
        if ((o as THREE.InstancedMesh).isInstancedMesh) ready = true;
      });
      if (ready) {
        warmed.current = true;
        const hidden: THREE.Object3D[] = [];
        portalScene.traverse((o) => {
          if (!o.visible) {
            hidden.push(o);
            o.visible = true;
          }
        });
        const prev = gl.getRenderTarget();
        gl.setRenderTarget(target);
        gl.clear();
        gl.render(portalScene, camera);
        gl.setRenderTarget(prev);
        for (const o of hidden) o.visible = false;
      }
    }
    if (!enabled) return;
    const prev = gl.getRenderTarget();
    const prevAuto = gl.autoClear;
    gl.setRenderTarget(target);
    gl.clear();
    gl.render(portalScene, camera);
    gl.setRenderTarget(prev);
    gl.autoClear = prevAuto;
  });
  // Journey is not on the page: the flock and its ground (the shipped 2 MB tile + grid) load only if it is ever
  // rendered, behind their own boundary so they never suspend the scene (load time, 2026-11-06).
  return <>{createPortal(<Suspense fallback={null}>{enabled && <Flock camera={camera} />}</Suspense>, portalScene)}</>;
}

/** Everything inside the sticky canvas (shipped `t4`). */
export function MainScene() {
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  // Scene render density (lib/render-scale.ts): terrain/sky screen-space maths and the flock target follow it.
  const dpr = useRenderScale((s) => s.sceneDpr);
  const announced = useRef(false);
  const flockOn = useRef(false);
  const [renderFlock, setRenderFlock] = useState(false);
  const [plate, setPlate] = useState(false);
  useEffect(() => setPlate(heroPlateEnabled()), []);
  // Canvas children render on the client only, so the query string is readable on first render (as in Terrain).
  const [clayMap] = useState(() => terrainVariant() === "raven");

  useTexture(ASSETS.blueNoise, (t) => {
    const tex = Array.isArray(t) ? t[0] : t;
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
  });

  useEffect(() => {
    resolution.set(width * dpr, height * dpr);
  }, [width, height, dpr]);

  const flockTarget = useFBO(width * dpr, height * dpr);
  usePostFX(flockTarget);

  const sunRef = useRef<THREE.DirectionalLight>(null);
  const skyFillRef = useRef<THREE.HemisphereLight>(null);
  const scene = useThree((s) => s.scene);
  const heroDrone = useRef<THREE.Object3D | null>(null);
  const shadowFit = useRef({ frame: 0, centre: new THREE.Vector3(), radius: 1 });
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const sunDistance = SUN_POSITION.length();

  // First-frame gate (scene-warm.ts): link every program in parallel before PostFX draws the first frame.
  useFrame(({ gl, camera: cam }) => {
    if (sceneWarm.started) return;
    sceneWarm.started = true;
    const open = () => void (sceneWarm.ready = true);
    Promise.race([prewarm(gl, scene, cam), new Promise((r) => setTimeout(r, WARM_MAX_MS))]).then(open, open);
  });

  useFrame(({ clock, gl, camera: cam }) => {
    // Raven daylight: travel-driven sun sway + passing cloud shade (see sunlight.ts).
    updateSunlight(terrainOffset.current ?? 0, clock.getElapsedTime(), reducedMotion);
    // Over the H00 plate the light is the plate's: fixed sun (no sway, no cloud dips), warm key.
    const w = plateLight.weight;
    if (w > 0) {
      sunlight.direction.lerp(plateLight.sunDirection, w).normalize();
      sunlight.heading *= 1 - w;
      sunlight.pitch *= 1 - w;
      sunlight.shade += (1 - sunlight.shade) * w;
    }
    // Hero preset (hero-light.ts, user's panel values): sun to its colour/direction/intensity, sky fill on.
    updateHeroLight();
    const h = heroLight.weight;
    sunlight.direction.lerp(heroLight.sunDirection, h).normalize();
    sunlight.strength = 1 + (HERO_LIGHT.sun.intensity / DAYLIGHT.sunIntensity - 1) * h;
    const fill = skyFillRef.current;
    if (fill) {
      // Intensity only, never `visible`: a change in the light count recompiles every lit material (7 programs, a
      // ~67 ms stall mid-Connection the first time the hero preset finished fading out).
      fill.intensity = HERO_LIGHT.hemisphere.intensity * h;
    }
    const sun = sunRef.current;
    if (sun) {
      sun.intensity = DAYLIGHT.sunIntensity * sunlight.shade * sunlight.strength;
      sun.color.setRGB(1, 1, 1).lerp(plateLight.sunColor, w).lerp(heroLight.sunColor, h);
      // Same parallel sun, but placed just above the hero drone so a tight shadow frustum gives crisp
      // self-shadowing (arms and deck onto the medical box and gear).
      heroDrone.current ??= scene.getObjectByName("Drone1Group") ?? null;
      const fit = shadowFit.current;
      if (heroDrone.current && fit.frame++ % SHADOW_REFIT_FRAMES === 0) {
        _box.setFromObject(heroDrone.current).getBoundingSphere(_sphere);
        if (_sphere.radius > 0) fit.radius = _sphere.radius;
        const cam = sun.shadow.camera;
        cam.left = cam.bottom = -1.05 * fit.radius;
        cam.right = cam.top = 1.05 * fit.radius;
        cam.near = 2 * fit.radius;
        cam.far = 6 * fit.radius;
        cam.updateProjectionMatrix();
        sun.shadow.normalBias = 0.006 * fit.radius;
      }
      if (heroDrone.current) {
        heroDrone.current.getWorldPosition(fit.centre);
        sun.target.position.copy(fit.centre);
        sun.position.copy(sunlight.direction).multiplyScalar(4 * fit.radius).add(fit.centre);
      } else {
        sun.position.copy(sunlight.direction).multiplyScalar(sunDistance);
      }
      sun.target.updateMatrixWorld();
    }
    if (!announced.current && sceneWarm.ready) {
      announced.current = true;
      setTimeout(() => useLoading.getState().setMainAppLoaded(true), 25);
      startHd(); // full-quality textures (hd-assets.ts) only once the first frame is up
      // Every material, hidden objects included (flank drones, tags appear later), was compiled by the first-frame
      // gate above: the first time they became visible in Connection the compile stalled one frame ("still a jitter").
    }
    const on = false; // Journey's network map is not shown (user, 2026-11-02: Journey removed)
    if (on !== flockOn.current) {
      flockOn.current = on;
      setRenderFlock(on);
    }
  }, 0);

  return (
    <>
      <HeroAudio />
      <DroneRig />
      {plate && <HeroPlate />}
      <OpeningSky />
      <group position={[0, -2.5, -8.6]}>
        <Terrain />
        {clayMap && <ClayTerrain />}
        {/* Raven: the clay map drapes its own dot grid over the relief (clay-map.ts); the flat grid would cut it. */}
        {!clayMap && <GridRow offset={2 * TILE} isCity />}
      </group>
      <Clouds />
      {/* Raven: overhead low-cloud wisps (the drones' shadow on terrain and clouds was removed, user 2026-11-03). */}
      <CloudWisps />
      <directionalLight
        ref={sunRef}
        args={[0xffffff, 4]}
        position={SUN_POSITION}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={HERO_LIGHT.sun.bias}
      />
      {/* Hero sky fill (hero-light.ts); intensity follows the hero weight. */}
      <hemisphereLight
        ref={skyFillRef}
        args={[HERO_LIGHT.hemisphere.sky, HERO_LIGHT.hemisphere.ground, HERO_LIGHT.hemisphere.intensity]}
      />
      <FlockPortal target={flockTarget} enabled={renderFlock} />
    </>
  );
}
