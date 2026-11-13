"use client";

import { PerspectiveCamera, useKeyboardControls } from "@react-three/drei";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { CopyPass } from "postprocessing";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { ASSETS } from "@/lib/assets";
import { ENGINE_COPY_Y, RENDER_ORDER } from "@/lib/constants";
import { useLoading } from "@/lib/loading";
import { damp, lerp, remap } from "@/lib/math";
import { SCENE, scenes, useMouse } from "@/lib/scenes";
import { isScrollLocked } from "@/lib/scroll-lock";
import { openingNow } from "@/lib/story-map";
import {
  ALTITUDE_TIMELINE,
  altitudeScreen,
  payloadLook,
  payloadScreen,
  ROUTE_FLIGHT,
  ROUTE_TIMELINE,
  routeScreen,
  SPEED_FIGURES,
  LEG2_MS,
  speedScreen,
} from "@/lib/payload";
import { payloadClayUniforms } from "./materials/TerrainMaterial";
import { useMediaQuery } from "@/lib/use-media-query";
import { CAMERA_BINDINGS, ClipSeeker, DRONE1_BINDINGS, DRONE2_BINDINGS, DRONE3_BINDINGS } from "./ClipSeeker";
import { Drone } from "./Drone";
import { applyOpening } from "./opening";
import { applyPayloadCamera, applyRouteCamera } from "./payload-camera";
import { NetTerrain } from "./net-terrain";
import { useRenderScale } from "@/lib/render-scale";
import { SpecsCallouts } from "./overlays/SpecsCallouts";
import { applyCameraTilt, cameraTilt } from "./camera-tilt";
import { applyLandscapeCamera } from "./clay-map";
import { SwarmTags } from "./overlays/SwarmTags";
import { useGLB } from "./types";
import { bootPose } from "@/lib/boot-pose";

/** Camera shake intensity per scene (shipped `tM`). */
const SHAKE = {
  [SCENE.INTRO_SCENE]: 0.001,
  [SCENE.REAL_TIME_DETECTION]: 0.002,
  [SCENE.THERMAL_IRREGULARITY]: 0.0015,
};

/** Micro camera shake, independent of scroll-driven motion (shipped `tP`). */
function CameraShake({ children }: { children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const amount = useRef(0);
  const [, getKeys] = useKeyboardControls();
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const { shift } = getKeys() as { shift: boolean };
    const s = scenes();
    const intro = s[SCENE.INTRO_SCENE];
    const det = s[SCENE.REAL_TIME_DETECTION];
    const thermal = s[SCENE.THERMAL_IRREGULARITY];
    const target = intro.isActive
      ? (SHAKE[SCENE.INTRO_SCENE] + (shift && !isScrollLocked() ? 0.001 : 0)) * intro.progress
      : det.isActive
        ? SHAKE[SCENE.REAL_TIME_DETECTION] * det.progress
        : thermal.isActive
          ? SHAKE[SCENE.THERMAL_IRREGULARITY] * thermal.progress
          : 0;
    // Off from the payload stage on (user 2026-11-05: "the mountain is jumping like a bob shake"): the story is held on
    // the intro scene for the whole payload page, so its hero shake kept running in the payload, mountain and speed
    // views, where the 20 deg lens turned it into a visible wobble of the whole massif.
    const stageCalm = 1 - THREE.MathUtils.smoothstep(payloadLook().p, 0, 0.3);
    amount.current = lerp(amount.current, target * stageCalm, 0.05);
    const u = amount.current;
    const t = clock.getElapsedTime();
    const x = Math.sin(3 * t * 8) * u + Math.sin(2.2 * t * 8 + 1) * u * 0.5;
    const y = Math.cos(2.7 * t * 8) * u + Math.cos(1.8 * t * 8 + 2) * u * 0.5;
    const z = Math.sin(1.6 * t * 8 + 3) * u * 0.3;
    const rz = Math.sin(2.3 * t * 8) * u * 0.4;
    const rx = Math.cos(1.7 * t * 8) * u * 0.3;
    ref.current.position.set(x, y, z);
    ref.current.rotation.set(rx, ref.current.rotation.y, rz);
  });
  return <group ref={ref}>{children}</group>;
}

type Pose = { position: THREE.Vector3; rotation: THREE.Vector3 };
/** Hero lens (shipped `<PerspectiveCamera fov={20}>`); the Raven opening widens it before the hero frame. */
const HERO_FOV = 20;
/** Raven (user, 2026-10-31): all three drones 1.2x the shipped scale in every scene. */
const DRONE_SCALE = 1.2;
/**
 * Extra size for the hero drone when the camera looks straight down on it (Airframe top view, Connection ...; user,
 * 2026-11-02: the product reads too small there). Same top-view blend as the background blur (PostFX): camera
 * -dir.y 0.75 -> 0.95, eased over ~0.4 s, so it grows smoothly through the tilt. The spec callouts are fixed world
 * points near the drone centre, so they still point into the larger airframe.
 */
const TOP_VIEW_SCALE = 1.35;
/**
 * Hero section (opening and the hero frame; user 2026-11-03: "increase the size of the drone in the hero section"):
 * the hero drone reads 1.25x larger, easing back over DELTA_DRONE 0 -> 0.2 so it has gone before the top-view
 * enlargement (TOP_VIEW_SCALE) builds up in the tilt; the two never stack.
 */
const HERO_SCALE = 1.25;
const _topDir = new THREE.Vector3();
const _zoomCam = new THREE.Vector3();
const _zoomDrone = new THREE.Vector3();
/**
 * Hero drone scale / camera distance at the Prepare frame (scale 0.0075 x 1.2 x 1.35 at 17.24) and the Route frame
 * (0.0075 x 1.2 at 14.7), desktop tracks (measured 1440×900, fov 20; the ratio does not depend on the viewport).
 */
const APPARENT_PREPARE = (0.0075 * 1.2 * 1.35) / 17.24;
const APPARENT_ROUTE = (0.0075 * 1.2) / 14.7;
const _tiltDrone = new THREE.Vector3();
const _poseA = new THREE.Object3D();
const _poseB = new THREE.Object3D();
const _offA = new THREE.Vector3();
const _offB = new THREE.Vector3();
const _swing = new THREE.Quaternion();
const _partial = new THREE.Quaternion();
/** Payload box: its centre in Drone1Group space (measured once per model), the stable anchor and its screen point. */
const PAYLOAD_BOX = /^MED_Box/;
const _boxW = new THREE.Box3();
const _boxPart = new THREE.Box3();
const _inv = new THREE.Matrix4();
const _anchor = new THREE.Vector3();
const _onScreen = new THREE.Vector3();

/** Altitude stage: drone top / skid points (Drone1Group space), ground under the drone (world), its raycast. */
const _top = new THREE.Vector3();
const _skid = new THREE.Vector3();
const _ground = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _ray = new THREE.Raycaster();
/** Raycast every n frames (the ground moves slowly under the drone; the result is damped). */
const GROUND_RAY_EVERY = 2;
const _centre = new THREE.Vector3();

/**
 * Altitude line (user, 2026-11-03: the line must sit on the terrain, hide behind ridges, fade, draw from the drone):
 * a camera-facing ribbon in the scene, depth-tested against the terrain (no depth write), from the skids (v = 0) to the
 * ground (v = 1). Bright yellow core with a soft glow, fading toward the ground, drawn downward by uDraw.
 */
const ALTITUDE_LINE = { halfPx: 7, corePx: 0.9, drawS: 0.9, retractS: 0.35 };
function createAltitudeLine() {
  const material = new THREE.ShaderMaterial({
    name: "RavenAltitudeLine",
    uniforms: {
      uTop: { value: new THREE.Vector3() },
      uBottom: { value: new THREE.Vector3() },
      uHalf: { value: 0.01 },
      uCore: { value: 0.12 },
      uDraw: { value: 0 },
      uColor: { value: new THREE.Color("#ffcb47") },
    },
    vertexShader: /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform float uHalf;
varying vec2 vLine;
void main() {
  float v = position.y + 0.5;           // 0 at the skids, 1 at the ground
  vec3 p = mix(uTop, uBottom, v);
  vec3 dir = normalize(uBottom - uTop + vec3(0.0, -1e-5, 0.0));
  vec3 side = normalize(cross(dir, normalize(cameraPosition - p)));
  p += side * position.x * 2.0 * uHalf;
  vLine = vec2(position.x * 2.0, v);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uCore;
uniform float uDraw;
uniform vec3 uColor;
varying vec2 vLine;
void main() {
  float v = vLine.y;
  float u = abs(vLine.x);
  float head = 1.0 - smoothstep(uDraw - 0.06, uDraw, v);       // drawn from the drone downward
  float along = mix(1.0, 0.28, smoothstep(0.0, 1.0, v));        // fades toward the ground
  float core = 1.0 - smoothstep(uCore * 0.5, uCore * 1.4, u);
  float glow = exp(-u * u * 5.0) * 0.3;
  float a = (core + glow) * along * head;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * (1.0 + core * 0.35), a);
}`,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 40;
  return mesh as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
}

/**
 * Route stage planned path (user, 2026-11-03: "it will draw a curvy line towards the destination. this path animation
 * will start from drone"; then: the distance to the destination on top of the `net` section's terrain): a camera-facing
 * ribbon along that section's route curve (net-terrain.ts), depth-tested against its terrain, drawn from the drone to
 * the clinic over `drawS`. Yellow dashes flowing toward the destination
 * over a faint continuous trace, a bright head while it draws, fading in out of the drone.
 */
const ROUTE_PATH = { halfPx: 6, corePx: 1.1, dashPx: 12, flowPx: 22, drawS: 2.6, retractS: 0.5 };
const ROUTE_PATH_N = 140;
const _pathPts = new Float32Array((ROUTE_PATH_N + 1) * 3);
function createRoutePath(color = "#ffcb47", alpha = 1) {
  const N = ROUTE_PATH_N;
  const count = (N + 1) * 2;
  const g = new THREE.BufferGeometry();
  const attr = (n: number) => new THREE.BufferAttribute(new Float32Array(count * n), n).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute("position", attr(3));
  g.setAttribute("aPrev", attr(3));
  g.setAttribute("aNext", attr(3));
  g.setAttribute("aLen", attr(1));
  const side = new Float32Array(count);
  const v = new Float32Array(count);
  for (let i = 0; i <= N; i++) {
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
    v[i * 2] = v[i * 2 + 1] = i / N;
  }
  g.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
  g.setAttribute("aV", new THREE.BufferAttribute(v, 1));
  const index: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setIndex(index);
  const material = new THREE.ShaderMaterial({
    name: "RavenRoutePath",
    uniforms: {
      uPx: { value: 0.001 },
      uHalfPx: { value: ROUTE_PATH.halfPx },
      uCore: { value: ROUTE_PATH.corePx / ROUTE_PATH.halfPx },
      uDash: { value: 0.1 },
      uFlow: { value: 0 },
      uDraw: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uAlpha: { value: alpha },
      /** Flown share: the ribbon is cut behind it (speed stage, only the path ahead shows). */
      uFrom: { value: 0 },
    },
    vertexShader: /* glsl */ `
attribute vec3 aPrev;
attribute vec3 aNext;
attribute float aSide;
attribute float aV;
attribute float aLen;
uniform float uPx;
uniform float uHalfPx;
varying vec2 vLine;
varying float vLen;
void main() {
  vec3 p = position;
  vec3 t = normalize(aNext - aPrev + vec3(1e-6, 0.0, 0.0));
  vec3 side = normalize(cross(t, normalize(cameraPosition - p)));
  p += side * aSide * uHalfPx * uPx * distance(cameraPosition, p);
  vLine = vec2(aSide, aV);
  vLen = aLen;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uCore;
uniform float uDash;
uniform float uFlow;
uniform float uDraw;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uFrom;
varying vec2 vLine;
varying float vLen;
void main() {
  float u = abs(vLine.x);
  float v = vLine.y;
  float drawn = 1.0 - smoothstep(uDraw - 0.004, uDraw, v);
  float emerge = smoothstep(0.0, 0.06, v) * smoothstep(uFrom, uFrom + 0.03, v); // out of the drone, not its body
  float ph = fract((vLen - uFlow) / uDash);
  float dash = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.5, 0.58, ph));
  float core = 1.0 - smoothstep(uCore * 0.5, uCore * 1.4, u);
  float glow = exp(-u * u * 6.0) * 0.22;
  float head = exp(-pow((v - uDraw) / 0.012, 2.0)) * step(uDraw, 0.999); // bright tip while drawing
  float a = (core * mix(0.28, 1.0, dash) + glow) * drawn * emerge + head * (exp(-u * u * 3.0) * 0.9);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * (1.0 + core * dash * 0.35 + head * 0.6), min(a, 1.0) * uAlpha);
}`,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 41;
  return mesh as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
}

/** Writes the sampled curve into the ribbon (two vertices per sample, prev/next for the facing, length along). */
function updateRoutePath(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>, pts: Float32Array) {
  const N = ROUTE_PATH_N;
  const g = mesh.geometry;
  const pos = g.attributes.position.array as Float32Array;
  const prev = g.attributes.aPrev.array as Float32Array;
  const next = g.attributes.aNext.array as Float32Array;
  const len = g.attributes.aLen.array as Float32Array;
  let L = 0;
  for (let i = 0; i <= N; i++) {
    const ip = Math.max(i - 1, 0);
    const iN = Math.min(i + 1, N);
    if (i > 0) L += Math.hypot(pts[i * 3] - pts[ip * 3], pts[i * 3 + 1] - pts[ip * 3 + 1], pts[i * 3 + 2] - pts[ip * 3 + 2]);
    for (let s = 0; s < 2; s++) {
      const k = i * 2 + s;
      for (let c = 0; c < 3; c++) {
        pos[k * 3 + c] = pts[i * 3 + c];
        prev[k * 3 + c] = pts[ip * 3 + c];
        next[k * 3 + c] = pts[iN * 3 + c];
      }
      len[k] = L;
    }
  }
  g.attributes.position.needsUpdate = true;
  g.attributes.aPrev.needsUpdate = true;
  g.attributes.aNext.needsUpdate = true;
  g.attributes.aLen.needsUpdate = true;
}

const _dest = new THREE.Vector3();
const _netEye = new THREE.Vector3();
const _netQuat = new THREE.Quaternion();
const _netPt = new THREE.Vector3();
const _pathPts2 = new Float32Array((ROUTE_PATH_N + 1) * 3);
const _dest2 = new THREE.Vector3();
const _netDir = new THREE.Vector3();
const _flyW = new THREE.Vector3();
const _flyW0 = new THREE.Vector3();
const _fwdDrone = new THREE.Vector3();
const _qYaw = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _X = new THREE.Vector3(1, 0, 0);
/** Leg 2 colour (distance and speed), next to the altitude leg's yellow. */
const ROUTE_GREEN = "#4ade80";
const _Y = new THREE.Vector3(0, 1, 0);
/** Nose-down tilt while flying the route (rad), as a multirotor leans into forward flight. */
const FLIGHT_PITCH = 0.14;
const _payloadEnd = new THREE.Object3D();
const _anchorFly = new THREE.Vector3();
/** Share of the screen width the mountain views slide left by (desktop/landscape only). */
/** Zoom of the mountain views (view window W / zoom), and where in the frame it zooms toward (0..1, 0.5 = centre). */
const MOUNTAIN_ZOOM = 1.12;
const MOUNTAIN_ZOOM_CENTER = { x: 0.5, y: 0.62 };
const MOUNTAIN_SHIFT = 0.08; // was .13, .08, .045 (with MOUNTAIN_ZOOM); back to .08 (user 2026-11-06: the massif still ran under the right-hand callout)
/**
 * Phones (portrait, < 768 px; user 2026-11-06: "the next stop Summit Station is cutting"): the summit sits off the
 * right edge, so the view window pans right with the drone once it passes this share of the window width (Ridge
 * Clinic sits at ~54%, so the climb frame is unchanged), and back as it returns. `rate` = easing per second.
 */
const MOBILE_FOLLOW = { at: 0.6, rate: 6 } as const;
const _fwdEnd = new THREE.Vector3();

/** Top and bottom centre of `drone`'s bounds in its local space (rotors, mast and skids included). */
function measureDroneExtent(drone: THREE.Object3D) {
  drone.updateWorldMatrix(true, true);
  _boxW.setFromObject(drone);
  if (_boxW.isEmpty()) return null;
  const c = _boxW.getCenter(new THREE.Vector3());
  _inv.copy(drone.matrixWorld).invert();
  return {
    top: new THREE.Vector3(c.x, _boxW.max.y, c.z).applyMatrix4(_inv),
    skid: new THREE.Vector3(c.x, _boxW.min.y, c.z).applyMatrix4(_inv),
  };
}

/** Centre of the medical box meshes in `drone`'s local space, or null before the model has mounted. */
function measurePayloadBox(drone: THREE.Object3D) {
  drone.updateWorldMatrix(true, true);
  _boxW.makeEmpty();
  drone.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!mats.some((m) => PAYLOAD_BOX.test(m.name))) return;
    mesh.geometry.boundingBox ?? mesh.geometry.computeBoundingBox();
    _boxW.union(_boxPart.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld));
  });
  if (_boxW.isEmpty()) return null;
  return _boxW.getCenter(new THREE.Vector3()).applyMatrix4(_inv.copy(drone.matrixWorld).invert());
}

const pose = (): Pose => ({ position: new THREE.Vector3(), rotation: new THREE.Vector3() });

/** Procedural idle hover offsets (shipped `tO`). */
function hover(t: number, offset: number, amp: number, out: Pose) {
  const o = t + offset;
  const y = (0.02 * Math.sin(0.4 * o) + 0.01 * Math.sin(1.1 * o) + 0.005 * Math.sin(2.7 * o)) * amp;
  const z = 10 * Math.sin(0.5 * o) * amp;
  const roll =
    (0.015 * Math.sin(0.35 * o) + 0.008 * Math.sin(1.2 * o) + 0.003 * Math.sin(2.9 * o)) * 3 +
    0.007 * Math.sin(20 * o) * Math.sin(0.4 * o) * 0.25;
  const x = -(5 * (0.015 * Math.sin(0.35 * o) + 0.008 * Math.sin(1.2 * o) + 0.003 * Math.sin(2.9 * o)));
  out.position.set(x, y, z);
  out.rotation.set(0, 0, roll);
}

/** Camera + three drones driven by the shipped GLB clips (shipped `tU` + `tN`). */
export function DroneRig() {
  const isMd = useMediaQuery("(min-width: 768px)");
  const size = useThree((s) => s.size);
  const cam = useGLB(ASSETS.cameraAnimations);
  const camMobile = useGLB(ASSETS.cameraAnimationsMobile);
  const drones = useGLB(ASSETS.droneAnimations);
  const dronesMobile = useGLB(ASSETS.droneAnimationsMobile);
  const [, getKeys] = useKeyboardControls();

  const env = useLoader(EXRLoader, ASSETS.env, (loader) => loader.setDataType(THREE.HalfFloatType));
  env.mapping = THREE.EquirectangularReflectionMapping;

  const sceneCopy = useMemo(() => new CopyPass(), []);
  useEffect(() => () => sceneCopy.dispose(), [sceneCopy]);

  // Trackers: GLTFLoader sanitizes "Drone.001" -> "Drone001" (PropertyBinding.sanitizeNodeName).
  const seekers = useMemo(() => {
    const find = (root: THREE.Object3D, name: string) => root.getObjectByName(name) ?? null;
    const make = (root: THREE.Object3D, name: string, clips: THREE.AnimationClip[], b: typeof CAMERA_BINDINGS) => {
      const node = find(root, name);
      return node ? new ClipSeeker(node, clips, b) : null;
    };
    return {
      desktop: {
        camera: make(cam.scene, "Camera", cam.animations, CAMERA_BINDINGS),
        d1: make(drones.scene, "Drone", drones.animations, DRONE1_BINDINGS),
        d2: make(drones.scene, "Drone001", drones.animations, DRONE2_BINDINGS),
        d3: make(drones.scene, "Drone002", drones.animations, DRONE3_BINDINGS),
      },
      mobile: {
        camera: make(camMobile.scene, "Camera-mobile", camMobile.animations, CAMERA_BINDINGS),
        d1: make(dronesMobile.scene, "Drone-mobile", dronesMobile.animations, DRONE1_BINDINGS),
        d2: make(dronesMobile.scene, "Drone001-mobile", dronesMobile.animations, DRONE2_BINDINGS),
        d3: make(dronesMobile.scene, "Drone002-mobile", dronesMobile.animations, DRONE3_BINDINGS),
      },
    };
  }, [cam, camMobile, drones, dronesMobile]);

  useEffect(
    () => () => {
      for (const set of [seekers.desktop, seekers.mobile]) for (const s of Object.values(set)) s?.dispose();
    },
    [seekers],
  );

  const cameraMover = useRef<THREE.Group>(null);
  const cameraDolly = useRef<THREE.Group>(null);
  const camera = useRef<THREE.PerspectiveCamera>(null);
  const droneRoot = useRef<THREE.Group>(null);
  const mover1 = useRef<THREE.Group>(null);
  const topView = useRef(0);
  /** Journey progress eased in time, drives the Prepare -> Route camera move and drone size (see the clip frame). */
  const transitionF = useRef(0);
  const mover2 = useRef<THREE.Group>(null);
  const mover3 = useRef<THREE.Group>(null);
  const drone1 = useRef<THREE.Group>(null);
  const drone2 = useRef<THREE.Group>(null);
  const drone3 = useRef<THREE.Group>(null);

  const mouseRoll = useRef(0);
  const swarmX = useRef(0);
  const swarmZ = useRef(0);
  const steer = useRef(0);
  const steerVel = useRef(0);
  const bank = useRef(0);
  const settle = useRef(0);
  const flankEase = useRef(0);
  const flankScale = useRef(1);
  const reveal = useRef(0);
  const lastPos = useRef(new THREE.Vector3());
  const lateralSpeed = useRef(0);
  const tmpA = useRef(new THREE.Vector3());
  const tmpB = useRef(new THREE.Vector3());
  const first = useRef(true);
  const poses = useRef([pose(), pose(), pose()]);
  const payloadBox = useRef<THREE.Vector3 | null>(null);
  const droneExtent = useRef<{ top: THREE.Vector3; skid: THREE.Vector3 } | null>(null);
  const groundY = useRef<number | null>(null);
  const groundFrame = useRef(0);
  const lineDraw = useRef(0);
  const altitudeLine = useMemo(createAltitudeLine, []);
  const routePath = useMemo(() => createRoutePath(), []);
  // Leg 2 of the connected route (clinic -> summit station), drawn on from leg 1's end. Green (user: altitude reads
  // yellow, distance and speed green).
  const routePath2 = useMemo(() => createRoutePath(ROUTE_GREEN), []);
  const draw2 = useRef(0);
  /** Speed stage flight along leg 2 (0..1, time). */
  const flight2 = useRef(0);
  const mobilePan = useRef(0); // phones: view window pan toward Summit Station (full-frame px)
  const flyScreen = useRef({ x: 0, ok: false }); // drone's route point on screen (CSS px), for mobilePan
  /** Smoothed leg 2 speed (share of the leg per second): the HUD's km/h and the forward lean. */
  const flight2Vel = useRef(0);
  useEffect(() => () => {
    routePath2.geometry.dispose();
    routePath2.material.dispose();
  }, [routePath2]);
  /** Flight up the clinic route (0..1), the drone's offset from its start (world) and where it heads. */
  const flight = useRef(0);
  /** Smoothed climb speed (share of the route per second), for the forward lean while it climbs. */
  const climbVel = useRef(0);
  const routeOffset = useRef(new THREE.Vector3());
  const heading = useRef({ dir: new THREE.Vector3(0, 0, -1), weight: 0, fly: 0 });
  const pathDraw = useRef(0);
  useEffect(() => () => {
    routePath.geometry.dispose();
    routePath.material.dispose();
  }, [routePath]);
  // Route stage terrain (the `net` section's, built in a worker on mount).
  const net = useMemo(() => new NetTerrain(ROUTE_PATH_N), []);
  useEffect(() => () => net.dispose(), [net]);
  const sceneDpr = useRenderScale((s) => s.sceneDpr);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const netPlaced = useRef(false);
  const tilesRef = useRef<THREE.Object3D | null>(null);
  useEffect(() => () => {
    altitudeLine.geometry.dispose();
    altitudeLine.material.dispose();
  }, [altitudeLine]);
  const payloadBoxOwner = useRef<THREE.Object3D | null>(null);

  // Clip seeking runs before the procedural pass, mirroring the shipped order 1..15.
  // Loader match cut (lib/boot-pose.ts): publish the hero drone, camera and canvas while the loader is up. Runs after
  // the rig's own frame hooks (priority 99) and before the composer renders (100), so it matches the frame on screen.
  useFrame((state) => {
    if (useLoading.getState().loadingCanvasHidden) return;
    const model = drone1.current?.children[0]?.children[0];
    const cam = camera.current;
    if (!model || !cam) return;
    model.updateWorldMatrix(true, false);
    cam.updateWorldMatrix(true, false);
    bootPose.model.copy(model.matrixWorld);
    bootPose.camera.copy(cam.matrixWorld);
    bootPose.projection.copy(cam.projectionMatrix);
    const r = state.gl.domElement.getBoundingClientRect();
    bootPose.rect.x = r.left;
    bootPose.rect.y = r.top;
    bootPose.rect.w = r.width;
    bootPose.rect.h = r.height;
    bootPose.ready = true;
  }, 99);

  useFrame((state, dt) => {
    const set = isMd ? seekers.desktop : seekers.mobile;
    if (mover1.current) set.d1?.apply(mover1.current);
    if (cameraMover.current) set.camera?.apply(cameraMover.current);
    // Raven opening: fly from the low wide shot into the clip's hero pose (scene/opening.ts). The wide lens would show
    // the flank drones (off frame from the hero shot on), so they stay hidden until it lands (user, 2026-11-01).
    const opening = openingNow();
    if (cameraMover.current && camera.current) applyOpening(cameraMover.current, camera.current, opening, HERO_FOV);
    // Oblique view instead of straight down in Airframe and Connection (camera-tilt.ts).
    if (cameraMover.current && drone1.current) {
      const sc = scenes();
      // Oblique through Airframe, Connection and Prepare (user: no top-down angle at all); hands off to the Journey
      // network map during its transition (FLOCK_SCENE 0.4 -> 0.75, before the flock pass mixes in).
      const f = sc[SCENE.FLOCK_SCENE].progress;
      const gate = opening >= 1 ? 1 - THREE.MathUtils.smoothstep(f, 0.4, 0.75) : 0;
      drone1.current.updateWorldMatrix(true, false);
      applyCameraTilt(cameraMover.current, drone1.current.getWorldPosition(_tiltDrone), gate);
      // Prepare -> Route (Journey range, now a transition): one eased camera move between the two fixed end poses
      // instead of the clip in between. The clip pitched 40 -> 51 -> 31 deg and the drone drifted past centre and
      // back while the tilt handed off ("awkward motion", user 2026-11-02). A = tilted Camera03 end (Prepare frame),
      // B = Camera04-02 end (Route holds it). Distance lerps, the direction about the drone and the orientation slerp,
      // eased with smootherstep (C2: starts and lands at rest), so pitch, distance and framing each move one way.
      // The wheel's first frames move the page in a burst (246, 94, 37 px, shipped Lenis lerp .95), so the move is
      // driven by Journey progress eased over ~0.1 s: the camera absorbs the burst, scroll speed is unchanged.
      // Large jumps (nav ticks, scrollTo) snap.
      const tf = transitionF.current;
      transitionF.current = Math.abs(f - tf) > 0.5 ? f : tf + (f - tf) * (1 - Math.exp(-dt / 0.1));
      const fs = transitionF.current;
      if (opening >= 1 && fs > 0.0001 && fs < 0.9999 && set.camera?.sample("Camera03", 1, _poseA.position, _poseA.quaternion)
        && set.camera.sample("Camera04-02", 1, _poseB.position, _poseB.quaternion)) {
        applyCameraTilt(_poseA, _tiltDrone, 1);
        const e = THREE.MathUtils.smootherstep(fs, 0, 1);
        _offA.copy(_poseA.position).sub(_tiltDrone);
        _offB.copy(_poseB.position).sub(_tiltDrone);
        const r = THREE.MathUtils.lerp(_offA.length(), _offB.length(), e);
        _swing.setFromUnitVectors(_offA.normalize(), _offB.normalize());
        _partial.identity().slerp(_swing, e);
        cameraMover.current.position.copy(_offA.applyQuaternion(_partial).multiplyScalar(r)).add(_tiltDrone);
        cameraMover.current.quaternion.copy(_poseA.quaternion).slerp(_poseB.quaternion, e);
        cameraTilt.weight = 1 - e; // drone-focus effects (blur, size, shadow) follow the same curve
      }
    }
    // Raven payload stage (lib/payload.ts): ease in toward the medical box from the hero pose. The anchor is the box
    // in the clip drone's frame (without the idle hover), so the camera glides instead of bobbing with the drone.
    const look = payloadLook();
    if (drone1.current && mover1.current && cameraMover.current && camera.current) {
      const model = drone1.current.children[0]?.children[0] ?? null; // Drone > RavenModel primitive (remount check)
      if (!payloadBox.current || payloadBoxOwner.current !== model) {
        payloadBox.current = measurePayloadBox(drone1.current);
        droneExtent.current = payloadBox.current ? measureDroneExtent(drone1.current) : null;
        payloadBoxOwner.current = payloadBox.current ? model : null;
      }
      if (payloadBox.current && look.zoom > 0) {
        mover1.current.updateWorldMatrix(true, false);
        // Without the route flight's offset: the cameras and the section terrain stay put while the drone flies.
        _anchor.copy(payloadBox.current).applyMatrix4(mover1.current.matrixWorld).sub(routeOffset.current);
        // The payload frame's camera (zoom 1, from the same clip pose): the section terrain is turned to look its way.
        _payloadEnd.position.copy(cameraMover.current.position);
        _payloadEnd.quaternion.copy(cameraMover.current.quaternion);
        applyPayloadCamera(_payloadEnd, _anchor, 1, camera.current.fov, camera.current.aspect);
        // The live camera follows the drone up the route (user 2026-11-05: same camera angle while it climbs) and
        // the mountain stage's pull-back blends from that following pose to the section view.
        _anchorFly.copy(_anchor).add(routeOffset.current);
        applyPayloadCamera(cameraMover.current, _anchorFly, look.zoom, camera.current.fov, camera.current.aspect);
        // The section terrain is the ground from the payload stage on (pivot on the drone without its hover); the
        // mountain stage pulls the camera back to the section's view.
        const ext = droneExtent.current;
        if (ext) {
          _top.copy(ext.top).applyMatrix4(mover1.current.matrixWorld);
          _skid.copy(ext.skid).applyMatrix4(mover1.current.matrixWorld);
          _centre.lerpVectors(_top, _skid, 0.5).sub(routeOffset.current);
          net.setYaw(_fwdEnd.set(0, 0, -1).applyQuaternion(_payloadEnd.quaternion));
          net.place(_centre);
          netPlaced.current = true;
          if (look.r > 0 && net.ready) {
            net.pose(HERO_FOV, camera.current.aspect, _netEye, _netQuat);
            applyRouteCamera(cameraMover.current, _netEye, _netQuat, _centre, look.wide);
          }
        }
      }
    }
    if (camera.current) {
      cameraMover.current?.updateMatrixWorld(true);
      // Shown from the payload sweep on; the clay tiles give way to it at the clay front (TerrainMaterial uPayloadNet),
      // and once the front has reached the drone they are hidden.
      net.update(dt, look.clay > 0 && netPlaced.current, look.section, camera.current, sceneDpr, reducedMotion);
      payloadClayUniforms.uPayloadNet.value = net.ready ? 1 : 0;
      const tiles = (tilesRef.current ??= state.scene.getObjectByName("TerrainTiles") ?? null);
      if (tiles && net.ready && look.clay >= 1) tiles.visible = false;
    }
    // Raven clay landscape: Care teams opens on a low view across the lifted relief, handing back to the shipped
    // track over early Review (clay-map.ts LANDSCAPE).
    if (cameraMover.current && camera.current) {
      applyLandscapeCamera(cameraMover.current, camera.current.aspect);
    }
    // Raven: only the hero drone flies (user, 2026-11-02: "remove three drone and keep the center one only"). The
    // flank drones' clips still run (nothing else moves), but they are never shown.
    if (mover2.current && set.d2?.apply(mover2.current)) mover2.current.visible = false;
    if (mover3.current && set.d3?.apply(mover3.current)) mover3.current.visible = false;
    // Altitude line (3D ribbon, depth-tested against the terrain) from the real skids (hover included) down to the
    // ground under them: raycast on the terrain tiles every other frame, no damping, so the foot stays on the drawn
    // ground (under the flight corridor the mountain shader adds no lift, so the CPU mesh is the drawn ground).
    altitudeScreen.ok = false;
    const ext = droneExtent.current;
    const lineMat = altitudeLine.material;
    const lineOn = look.a > 0 && !!ext && !!drone1.current && !!camera.current;
    lineDraw.current = lineOn && look.a >= ALTITUDE_TIMELINE.callout
      ? Math.min(1, lineDraw.current + dt / ALTITUDE_LINE.drawS)
      : Math.max(0, lineDraw.current - dt / ALTITUDE_LINE.retractS);
    altitudeLine.visible = lineOn && lineDraw.current > 0;
    if (lineOn && ext && drone1.current && camera.current) {
      drone1.current.updateWorldMatrix(true, false);
      camera.current.updateWorldMatrix(true, false);
      _skid.copy(ext.skid).applyMatrix4(drone1.current.matrixWorld);
      if (groundY.current === null || groundFrame.current++ % GROUND_RAY_EVERY === 0) {
        const tiles = state.scene.getObjectByName("TerrainTiles");
        let hit: number | null = null;
        if (tiles) {
          _ray.set(_rayOrigin.copy(_skid), _down);
          _ray.far = 40;
          for (const h of _ray.intersectObject(tiles, true)) {
            let shown = true;
            for (let o: THREE.Object3D | null = h.object; o; o = o.parent) if (!o.visible) shown = false;
            if (shown) {
              hit = h.point.y;
              break;
            }
          }
        }
        groundY.current = hit ?? _skid.y - 2;
      }
      _ground.set(_skid.x, groundY.current, _skid.z);
      const u = lineMat.uniforms;
      u.uTop.value.copy(_skid);
      u.uBottom.value.copy(_ground);
      u.uDraw.value = THREE.MathUtils.smootherstep(lineDraw.current, 0, 1);
      // Ribbon width in world units for ALTITUDE_LINE.halfPx screen pixels at the line's distance.
      const dist = camera.current.getWorldPosition(_zoomCam).distanceTo(_skid);
      const pxWorld = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.current.fov / 2))) / Math.max(size.height, 1);
      u.uHalf.value = ALTITUDE_LINE.halfPx * pxWorld;
      u.uCore.value = ALTITUDE_LINE.corePx / ALTITUDE_LINE.halfPx;
      // Ground ripples (terrain shader) once the line has reached the ground.
      payloadClayUniforms.uPayloadRippleAt.value.copy(_ground);
      payloadClayUniforms.uPayloadRipple.value = THREE.MathUtils.smoothstep(lineDraw.current, 0.92, 1);
      payloadClayUniforms.uPayloadTime.value = state.clock.elapsedTime;
      // Label and end square (DOM).
      _onScreen.copy(_skid).project(camera.current);
      const okD = _onScreen.z < 1;
      altitudeScreen.dx = (_onScreen.x * 0.5 + 0.5) * size.width;
      altitudeScreen.dy = (0.5 - _onScreen.y * 0.5) * size.height;
      _onScreen.copy(_ground).project(camera.current);
      altitudeScreen.gx = (_onScreen.x * 0.5 + 0.5) * size.width;
      altitudeScreen.gy = (0.5 - _onScreen.y * 0.5) * size.height;
      altitudeScreen.ok = okD && _onScreen.z < 1;
    } else {
      groundY.current = null;
      payloadClayUniforms.uPayloadRipple.value = 0;
    }
    // Route stage: the section's route from the drone to the clinic (sway included), and the clay tiles fading into
    // the black (their fog is measured from the camera) while the section terrain comes in.
    routeScreen.ok = false;
    routeScreen.ok2 = false;
    const pathOn = look.r > 0 && net.ready && !!camera.current;
    // The route line draws ahead of the drone over the first half of the pull-back (was time-driven after it),
    // so the climb that follows in the same gesture starts on a finished line.
    pathDraw.current = pathOn ? THREE.MathUtils.smoothstep(look.r, 0.02, 0.55) : Math.max(0, pathDraw.current - dt / ROUTE_PATH.retractS);
    // Then the drone flies the clinic route (user: "drone should start moving towards top of the terrain", the
    // altitude counting up with it); it flies back quickly when the page scrolls back. In the speed stage leg 1 is
    // done (also after a jump straight there).
    // Climb stage (user 2026-11-05: "on 2 scroll it should go up there"): the flight follows the scroll (lib/payload
    // `climbProgress`, two snap stops), lightly damped so the drone glides into each stop instead of locking to it.
    const inSpeed = look.sp > 0;
    if ((inSpeed || look.c > 0) && pathOn) pathDraw.current = 1; // (also when a jump lands past the pull-back)
    // Back from leg 2 (feedback 2026-11-13: "from Ridge Clinic back it is jumping"): leg 1 waits at the clinic until the
    // drone is back there. It used to follow the scroll meanwhile, so a scroll back past the clinic while leg 2 was still
    // easing home moved leg 1 ~30% down the route unseen, and the hand-off teleported the drone (measured 150 px in one
    // frame). Leg 1 then eases from the clinic to the scroll (continuous).
    const backFromLeg2 = !inSpeed && pathOn && flight2.current > 1e-4;
    const flyTarget = !pathOn ? 0 : inSpeed || backFromLeg2 ? 1 : look.fly;
    const prevFlight = flight.current;
    // Same smoothing as the camera (the page scroll is already eased by Lenis): with its own extra lag the drone fell
    // behind the camera on a fast scroll, the view arrived while the drone was still on the way (user 2026-11-05).
    flight.current += (flyTarget - flight.current) * (1 - Math.exp(-dt * 30));
    if (Math.abs(flyTarget - flight.current) < 1e-4) flight.current = flyTarget;
    climbVel.current += ((dt > 0 ? (flight.current - prevFlight) / dt : 0) - climbVel.current) * (1 - Math.exp(-dt * 5));
    // Leg 2 draws on from the clinic once the drone is there (user: the checkpoints are connected).
    draw2.current = pathOn && flight.current >= 0.999
      ? Math.min(1, draw2.current + dt / ROUTE_FLIGHT.drawS)
      : Math.max(0, draw2.current - dt / ROUTE_PATH.retractS);
    // Speed stage: fly leg 2 once the chase view has settled.
    // Speed stage: leg 2 follows the scroll (two stops, like the climb), lightly damped.
    if (inSpeed && pathOn) draw2.current = 1;
    const fly2Target = pathOn && inSpeed ? look.sp : 0;
    const prevFlight2 = flight2.current;
    // Free scroll on desktop (Lenis already eases it) and the snap on phones: the same light damping as leg 1. Was 7/s,
    // which kept the drone on leg 2 ~0.7 s after the scroll was back at the clinic.
    flight2.current += (fly2Target - flight2.current) * (1 - Math.exp(-dt * 30));
    if (Math.abs(fly2Target - flight2.current) < 1e-4) flight2.current = fly2Target;
    flight2Vel.current += ((dt > 0 ? (flight2.current - prevFlight2) / dt : 0) - flight2Vel.current) * (1 - Math.exp(-dt * 5));
    // Cruise = the snap's leg pace (LEG2_MS for the whole leg); the HUD reads km/h against it.
    const cruise2 = Math.min(1, Math.abs(flight2Vel.current) / (1 / (LEG2_MS / 1000)));
    // On leg 2 until the drone is back at the clinic: on the way back the scroll reaches the clinic before the eased
    // flight does, and switching to leg 1 there snapped the drone the last stretch (user 2026-11-05).
    const onLeg2 = inSpeed || (pathOn && flight2.current > 1e-4);
    routePath.visible = pathOn && pathDraw.current > 0;
    routePath2.visible = pathOn && draw2.current > 0;
    speedScreen.ok = false;
    flyScreen.current.ok = false;
    heading.current.weight = 0;
    if (pathOn && camera.current) {
      camera.current.updateWorldMatrix(true, false);
      const write = (pts: Float32Array, out: Float32Array) => {
        for (let i = 0; i < pts.length; i += 3) {
          net.toWorld(_netPt.set(pts[i], pts[i + 1], pts[i + 2]), _netPt);
          out[i] = _netPt.x;
          out[i + 1] = _netPt.y;
          out[i + 2] = _netPt.z;
        }
      };
      if (routePath.visible) {
        write(net.route, _pathPts);
        updateRoutePath(routePath, _pathPts);
      }
      if (routePath2.visible) {
        write(net.route2, _pathPts2);
        updateRoutePath(routePath2, _pathPts2);
      }
      net.toWorld(net.site, _dest);
      net.toWorld(net.site2, _dest2);
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.current.fov / 2));
      const pxK = (2 * tanV) / Math.max(size.height, 1); // world per pixel at distance 1
      const atDest = camera.current.getWorldPosition(_zoomCam).distanceTo(_dest);
      const dashAt = atDest;
      [routePath, routePath2].forEach((path, i) => {
        const u = path.material.uniforms;
        u.uPx.value = pxK;
        u.uDash.value = ROUTE_PATH.dashPx * pxK * dashAt;
        u.uFlow.value = state.clock.elapsedTime * ROUTE_PATH.flowPx * pxK * dashAt;
        u.uDraw.value = THREE.MathUtils.smootherstep(i === 0 ? pathDraw.current : draw2.current, 0, 1);

      });
      // Flight: the drone's offset along the route (applied to droneRoot next frame), its heading and the counter.
      const sFly = flight.current; // the scroll snap already eases each stop
      routeScreen.alt = net.along(sFly, _netPt, _netDir);
      if (onLeg2) {
        // Leg 2: distance by the trapezoid speed profile (speeding up and slowing down at the ends).
        const s2 = flight2.current; // the scroll snap eases each stop
        net.along2(s2, _netPt, _netDir);
        const total = net.length2 * SPEED_FIGURES.metresPerUnit;
        speedScreen.total = total;
        speedScreen.left = total * (1 - s2);
        speedScreen.kmh = SPEED_FIGURES.kmh * cruise2;
        speedScreen.fly = flight2.current;
      } else {
        // Back on leg 1 (or at the clinic): no stale leg 2 progress (it folded the clinic card shut on the way back).
        speedScreen.fly = 0;
        speedScreen.kmh = 0;
      }
      net.toWorld(_netPt, _flyW);
      _onScreen.copy(_flyW).project(camera.current);
      flyScreen.current.x = (_onScreen.x * 0.5 + 0.5) * size.width;
      flyScreen.current.ok = _onScreen.z < 1;
      net.toWorld(net.start, _flyW0);
      routeOffset.current.subVectors(_flyW, _flyW0);
      net.dirToWorld(_netDir, heading.current.dir);
      // Turn to face up the mountain while the view widens (user: the drone angle must change toward the terrain).
      heading.current.weight = THREE.MathUtils.smootherstep(look.wide, 0, 0.3); // turned up the route as it sets off
      heading.current.fly = onLeg2
        ? cruise2
        : Math.min(1, Math.abs(climbVel.current) * 2.6); // lean while climbing (a stop takes ~1.7 s for half the route)
      // Pins (DOM): both sites.
      _onScreen.copy(_dest).project(camera.current);
      routeScreen.vx = (_onScreen.x * 0.5 + 0.5) * size.width;
      routeScreen.vy = (0.5 - _onScreen.y * 0.5) * size.height;
      routeScreen.draw = pathDraw.current;
      routeScreen.fly = flight.current; // the clinic pin opens into its card on arrival (overlays/RouteCallout.tsx)
      routeScreen.ok = _onScreen.z < 1;
      _onScreen.copy(_dest2).project(camera.current);
      routeScreen.v2x = (_onScreen.x * 0.5 + 0.5) * size.width;
      routeScreen.v2y = (0.5 - _onScreen.y * 0.5) * size.height;
      // Narrow screens frame the drone and the clinic; the summit can fall outside, then its pin stays hidden.
      routeScreen.ok2 = _onScreen.z < 1 && routeScreen.v2x > 24 && routeScreen.v2x < size.width - 24;
      routeScreen.draw2 = draw2.current;
      if (inSpeed) {
        speedScreen.vx = routeScreen.v2x;
        speedScreen.vy = routeScreen.v2y;
        speedScreen.ok = _onScreen.z < 1;
      }
    } else {
      routeOffset.current.set(0, 0, 0);
      routeScreen.alt = 0;
      routeScreen.fly = 0;
    }
    // Mountain views sit left of the right-hand callout block (user 2026-11-05: "push the scene a little to the left,
    // the text on the right overlaps"): the projection window slides right by MOUNTAIN_SHIFT of the screen width, eased
    // in with the pull-back. A view offset keeps the camera angle and keeps every projected pin and line aligned.
    if (camera.current) {
      const W = size.width;
      const H = size.height;
      const k = THREE.MathUtils.smootherstep(look.wide, 0, 1);
      const shift = W > H && W >= 768 ? MOUNTAIN_SHIFT * k : 0;
      // Zoom (user 2026-11-05: "make the scene bigger, a little zoom in"): a smaller view window, centred a little below
      // the middle where the massif sits, scaled up to the screen. Every size, eased in with the pull-back.
      const zoom = 1 + (MOUNTAIN_ZOOM - 1) * k;
      const w = W / zoom;
      const h = H / zoom;
      const cam = camera.current;
      const ox0 = (W - w) * MOUNTAIN_ZOOM_CENTER.x + shift * W;
      // Phones: follow the drone right (MOBILE_FOLLOW). Its screen x was projected with last frame's window, so map it
      // back to the full frame first (x / scale + offset): the pan target never depends on the pan itself.
      let panTarget = 0;
      if (W < 768 && H > W && flyScreen.current.ok) {
        const v = cam.view;
        const fullX = v?.enabled ? flyScreen.current.x * (v.width / W) + v.offsetX : flyScreen.current.x;
        panTarget = Math.max(0, fullX - (ox0 + w * MOBILE_FOLLOW.at)) * k;
      }
      mobilePan.current += (panTarget - mobilePan.current) * (1 - Math.exp(-dt * MOBILE_FOLLOW.rate));
      if (mobilePan.current < 0.05 && panTarget === 0) mobilePan.current = 0;
      const ox = Math.round((ox0 + mobilePan.current) * 10) / 10;
      const oy = Math.round((H - h) * MOUNTAIN_ZOOM_CENTER.y * 10) / 10;
      if (ox > 0.05 || zoom > 1.0005) {
        const v = cam.view;
        if (!v || !v.enabled || v.offsetX !== ox || v.offsetY !== oy || Math.abs(v.width - w) > 0.01 || v.fullWidth !== W || v.fullHeight !== H)
          cam.setViewOffset(W, H, ox, oy, w, h);
      } else if (cam.view?.enabled) cam.clearViewOffset();
    }
    // Payload callout (overlays/PayloadCallout.tsx): the real box (hover included) on screen, CSS px.
    payloadScreen.ok = false;
    if (look.p > 0 && payloadBox.current && drone1.current && camera.current) {
      drone1.current.updateWorldMatrix(true, false);
      camera.current.updateWorldMatrix(true, false);
      _onScreen.copy(payloadBox.current).applyMatrix4(drone1.current.matrixWorld).project(camera.current);
      if (_onScreen.z < 1) {
        payloadScreen.x = (_onScreen.x * 0.5 + 0.5) * size.width;
        payloadScreen.y = (0.5 - _onScreen.y * 0.5) * size.height;
        payloadScreen.ok = true;
      }
    }
  }, 1);

  useFrame((state, dt) => {
    const t = state.clock.getElapsedTime();
    const { x: mouseX } = useMouse.getState();
    const s = scenes();
    const flock = s[SCENE.FLOCK_SCENE].progress;
    const swarm = s[SCENE.SWARM_SCENE].progress;
    const delta = s[SCENE.DELTA_DRONE].progress;
    const mission = s[SCENE.MISSION_PRESET].progress;
    const thermal = s[SCENE.THERMAL_IRREGULARITY].progress;
    const detection = s[SCENE.REAL_TIME_DETECTION].progress;

    flankEase.current = damp(flankEase.current, mission > 0.01 ? 0 : 1, 2, dt);
    flankScale.current = damp(flankScale.current, mission > 0.01 ? 0 : 1, 2, dt);
    if (!drone1.current || !drone2.current || !drone3.current) return;

    mouseRoll.current = damp(mouseRoll.current, 0.25 * mouseX * delta * (1 - swarm), 2, dt);
    const [p1, p2, p3] = poses.current;
    hover(t, 0, 0.75, p1);
    hover(t, 1.7, 3, p2);
    hover(t, 3.4, 3, p3);

    const mobileScale = remap(window.innerWidth, 390, 768, 1, 1.35);
    const mobileLift = remap(window.innerHeight, 390, 1080, 1, 2);
    const mobileSwarmZ = remap(swarm, 0, 1, 0, 0.5) * remap(mission, 0, 1, 0.5, 0);
    if (droneRoot.current) {
      droneRoot.current.position.set(0, 0, isMd ? 0 : mobileSwarmZ * mobileLift).add(routeOffset.current);
      droneRoot.current.scale.setScalar(isMd ? 1 : mobileScale);
    }
    swarmX.current = remap(swarm, 0, 1, 0, 24) * remap(mission, 0, 0.75, 1, 0);
    swarmZ.current = remap(swarm, 0, 1, 0, 24) * remap(mission, 0, 0.75, 1, 0);

    settle.current = damp(settle.current, delta > 0.01 && swarm === 0 ? 0 : 1, 1, dt);

    const { left, right } = getKeys() as { left: boolean; right: boolean };
    // Arrow-key steering only on the hero frame itself (not during the payload stage).
    const heroIdle = delta < 0.001 && !isScrollLocked() && payloadLook().p <= 0;
    if (heroIdle) {
      const force = 100 * (Number(left) - Number(right)) - 1.25 * steer.current;
      steerVel.current = damp(steerVel.current, force, 1.5, dt);
      steer.current = THREE.MathUtils.clamp(steer.current + steerVel.current * dt, -200, 200);
    } else {
      steer.current = damp(steer.current, 0, 2, dt);
      steerVel.current = damp(steerVel.current, 0, 1, dt);
    }

    reveal.current = damp(reveal.current, Number(useLoading.getState().loadingCanvasHidden), 3, dt);
    drone1.current.position.set(
      (p1.position.x + (isMd ? swarmX.current : 0) + steer.current) * reveal.current,
      p1.position.y * reveal.current,
      (p1.position.z * settle.current + (isMd ? swarmZ.current : 0)) * reveal.current,
    );

    const pos = tmpA.current.copy(drone1.current.position);
    if (first.current || dt > 0.1) {
      lastPos.current.copy(pos);
      lateralSpeed.current = 0;
      first.current = false;
    } else {
      const d = tmpB.current.copy(pos).sub(lastPos.current);
      lateralSpeed.current = (d.length() / dt) * Math.sign(d.x);
      lastPos.current.copy(pos);
    }

    const inset = remap(size.width, 768, 1280, -64, 0);
    const k = flankScale.current;
    const e = flankEase.current;
    drone2.current.position.set(
      (p2.position.x * k + 100) * e + (isMd ? inset : 0),
      p2.position.y * k,
      p2.position.z * k,
    );
    drone3.current.position.set(
      (p3.position.x * k - 100) * e - (isMd ? inset : 0),
      p3.position.y * k,
      (p3.position.z * k - 100) * e,
    );

    bank.current = damp(bank.current, heroIdle ? -(0.002 * lateralSpeed.current) : 0, 3, dt);
    drone1.current.rotation.set(
      p1.rotation.x,
      p1.rotation.y - (isMd ? 0.3 * thermal : 0),
      p1.rotation.z + mouseRoll.current + bank.current,
    );
    // Mountain stage: face up the route (yaw about the parent's up), leaning into the flight (local pitch).
    const hd = heading.current;
    if (hd.weight > 0) {
      drone1.current.updateWorldMatrix(true, false);
      _fwdDrone.set(0, 0, -1).transformDirection(drone1.current.matrixWorld);
      const a0 = Math.atan2(-_fwdDrone.x, -_fwdDrone.z);
      const a1 = Math.atan2(-hd.dir.x, -hd.dir.z);
      const d = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
      drone1.current.quaternion.premultiply(_qYaw.setFromAxisAngle(_Y, d * hd.weight));
      drone1.current.quaternion.multiply(_qPitch.setFromAxisAngle(_X, -FLIGHT_PITCH * hd.fly));
    }
    drone2.current.rotation.set(p2.rotation.x, p2.rotation.y, p2.rotation.z);
    drone3.current.rotation.set(p3.rotation.x, p3.rotation.y, p3.rotation.z);

    if (cameraDolly.current) {
      // Shipped push-in (flock .85 -> 1) and pull-back (Route 0 -> .45) were hidden by the Journey map transition.
      // Journey is removed, so they read as a zoom in then out (user, 2026-11-02): no dolly.
      cameraDolly.current.position.z = 0;
    }
    if (camera.current) {
      camera.current.getWorldDirection(_topDir);
      const target = Math.max(THREE.MathUtils.smoothstep(-_topDir.y, 0.75, 0.95), cameraTilt.weight);
      topView.current += (target - topView.current) * (1 - Math.exp(-dt / 0.4));
    }
    if (mover1.current) {
      const sc = remap(swarm, 0, 0.5, 0.0075, 0.0085) - 0.001 * mission;
      const top = 1 + (TOP_VIEW_SCALE - 1) * topView.current;
      // Phones keep 1x (mobile pass 2026-11-06): at 1.25x the hero frame cut the drone's right arms off a 390 px screen.
      const hero = 1 + ((isMd ? HERO_SCALE : 1) - 1) * (1 - THREE.MathUtils.smoothstep(delta, 0, 0.2));
      let scale = (isMd ? sc : 0.0075) * DRONE_SCALE * top * hero;
      // Prepare -> Route (Journey range, desktop track): hold the drone's apparent size (scale / camera distance) on
      // an even path from the Prepare frame to the Route frame. Measured at 1440×900: the clip camera moves in
      // (17.2 -> 13.7) while the top-view enlargement fades out, which read as a zoom in, then out (user, 2026-11-02).
      const fs = transitionF.current; // same eased progress as the camera move
      if (isMd && camera.current && fs > 0) {
        const dist = camera.current.getWorldPosition(_zoomCam).distanceTo(drone1.current.getWorldPosition(_zoomDrone));
        const a = THREE.MathUtils.lerp(APPARENT_PREPARE, APPARENT_ROUTE, THREE.MathUtils.smootherstep(fs, 0, 1));
        const held = a * dist;
        scale += (held - scale) * THREE.MathUtils.smoothstep(fs, 0, 0.08);
      }
      mover1.current.scale.setScalar(scale);
    }
  });

  return (
    <>
      <group ref={cameraMover}>
        <group ref={cameraDolly}>
          <CameraShake>
            <PerspectiveCamera ref={camera} makeDefault fov={HERO_FOV} />
          </CameraShake>
        </group>
      </group>
      <mesh
        scale={0}
        position={[0, ENGINE_COPY_Y, 0]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.HERO_DRONE_ENGINE}
        onBeforeRender={(gl) => {
          const target = gl.getRenderTarget();
          if (!target) return;
          gl.setRenderTarget(null);
          sceneCopy.setSize(Math.floor(target.width), Math.floor(target.height));
          sceneCopy.render(gl, target, null);
          gl.setRenderTarget(target);
        }}
      >
        <planeGeometry args={[0.001, 0.001]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      <group ref={droneRoot}>
        <group ref={mover1} scale={0.0075 * DRONE_SCALE}>
          <group ref={drone1} name="Drone1Group">
            <Drone envMap={env} />
          </group>
        </group>
        <group ref={mover2} scale={(isMd ? 0.007 : 0.004) * DRONE_SCALE} visible={false}>
          <group ref={drone2} name="Drone2Group">
            <Drone envMap={env} />
          </group>
        </group>
        <group ref={mover3} scale={(isMd ? 0.007 : 0.0025) * DRONE_SCALE} visible={false}>
          <group ref={drone3} name="Drone3Group">
            <Drone envMap={env} />
          </group>
        </group>
      </group>
      <SwarmTags mainRef={drone1} />
      <SpecsCallouts />
      <primitive object={altitudeLine} />
      <primitive object={routePath2} />
      <primitive object={routePath} />
      <primitive object={net.root} />
    </>
  );
}

useGLB.preload(ASSETS.raven);
useGLB.preload(ASSETS.cameraAnimations);
useGLB.preload(ASSETS.cameraAnimationsMobile);
useGLB.preload(ASSETS.droneAnimations);
useGLB.preload(ASSETS.droneAnimationsMobile);
