"use client";

import { Environment, Lightformer, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useInView } from "motion/react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RavenModel } from "@/components/scene/Drone";
import { useMouse } from "@/lib/scenes";
import { useMediaQuery } from "@/lib/use-media-query";
import { whenQuiet } from "@/lib/quiet";
import { FloatBob, landingPose, landingProgress, PointerLean, type LandingPose } from "./drone-flight";

/**
 * Closing CTA drone, its own chunk (load time, 2026-11-06: loaded by ClosingCta once the section is within three
 * screens, so its second WebGL context, environment bake, shader compile and drei Environment code stay out of the
 * page's first load).
 *
 * Closing CTA (user mockup 2026-11-05): the hexa, front on, large and dimmed behind the closing line ("Make your product
 * impossible to scroll past.", 2026-11-06). The drone's entrance is the footer landing of the tundra-terrain branch (FooterDrone + drone-flight.ts,
 * removed there in 7b9d467): a banked glide-in and let-down once the section is 30% in view, then a slow float that
 * leans with the pointer. Leaving the view resets it so it plays again. Reduced motion: parked, no flight.
 */

/** Glide start above the rest pose, in drone widths. */
const START_HEIGHT = 0.55; // was 1.45, 1.1 (user 2026-11-05: the drone arrived late; 2026-11-13: "should come immediately")
/** RavenModel is SPAN (200) units across; the flight model works in drone widths of 2. */
const MODEL_SCALE = 0.01;
const _e = new THREE.Euler();

function Flight({ playing, ready }: { playing: boolean; ready: boolean }) {
  const motion = useRef<THREE.Group>(null);
  const t = useRef(0);
  const floatBob = useRef(new FloatBob());
  const lean = useRef(new PointerLean());
  const pose = useRef<LandingPose>({ height: 0, scale: 1, yaw: 0, pitch: 0, roll: 0 });
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  useEffect(() => {
    if (!playing) return;
    t.current = 0;
    floatBob.current.reset();
    lean.current.reset();
  }, [playing]);

  useFrame((_, dt) => {
    const m = motion.current;
    if (!m) return;
    if (reducedMotion) {
      m.visible = ready;
      m.position.set(0, 0, 0);
      m.quaternion.identity();
      m.scale.setScalar(1);
      return;
    }
    m.visible = ready && playing;
    if (!ready || !playing) return;
    t.current += Math.min(dt, 1 / 20);
    const n = landingProgress(t.current);
    landingPose(n, START_HEIGHT, pose.current);
    const { x, y } = useMouse.getState();
    lean.current.update(dt, x, -y, n);
    const bob = floatBob.current.update(dt);
    m.position.set(2 * lean.current.shift.x, 2 * (pose.current.height + bob + lean.current.shift.y), 0);
    m.scale.setScalar(pose.current.scale);
    _e.set(pose.current.pitch, pose.current.yaw, pose.current.roll, "YXZ");
    m.quaternion.setFromEuler(_e).premultiply(lean.current.offset);
  });

  return (
    <group ref={motion}>
      {/* Front to camera: RavenModel turns the GLB 180 deg, undo it. */}
      <group rotation={[0, Math.PI, 0]} scale={MODEL_SCALE}>
        <RavenModel realLook />
      </group>
    </group>
  );
}

/**
 * Smoothness (user 2026-11-13, phone scroll): drei's <Preload all> compiled the drone's materials synchronously, a
 * 2.5 s main-thread freeze at the use-cases section (measured, 390x844 @3x). The canvas first renders a few frames with
 * the drone hidden, so the Environment bakes (compiling before it does builds programs without the env map, which
 * the first visible frame then re-links synchronously); then compileAsync links the drone's programs in the
 * background (KHR_parallel_shader_compile), the textures upload in a scroll pause, and only then is the drone shown.
 */
function Warmup({ onReady }: { onReady: () => void }) {
  const { gl, scene, camera } = useThree();
  const frames = useRef(0);
  const [baked, setBaked] = useState(false);
  useFrame(() => {
    if (!baked && ++frames.current >= 3) setBaked(true);
  });
  useEffect(() => {
    if (!baked) return;
    let alive = true;
    (async () => {
      try {
        // compileAsync walks visible objects only: show the hidden drone for the (synchronous) program setup.
        const hidden: THREE.Object3D[] = [];
        scene.traverse((o) => {
          if (!o.visible) {
            hidden.push(o);
            o.visible = true;
          }
        });
        const compiled = gl.compileAsync(scene, camera);
        for (const o of hidden) o.visible = false;
        await compiled;
        const textures = new Set<THREE.Texture>();
        scene.traverse((o) => {
          const mats = (o as THREE.Mesh).material;
          if (!mats) return;
          for (const m of Array.isArray(mats) ? mats : [mats])
            for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
        });
        for (const t of textures) {
          await whenQuiet();
          if (!alive) return;
          gl.initTexture(t);
        }
      } catch (err) {
        console.warn("Closing drone warm-up failed; compiling on first frame.", err);
      }
      if (alive) onReady();
    })();
    return () => {
      alive = false;
    };
  }, [baked, gl, scene, camera, onReady]);
  return null;
}

/** Mockup framing: front on from ~20 deg above (top plate visible), hub a little above the copy. */
/**
 * Framing: the drone (2 units across, props included; ~1.15 units tall from rotor rings to skids in this view) spans
 * `fill` of the canvas width or `fillHeight` of its height, whichever is tighter. User 2026-11-06: desktop "reduce the
 * section height and increase the drone size a little" (was a full-height section with a width-only fit held back by a
 * fixed minimum distance, ~55% wide); phones: 0.85 of the width (rotor rings clear the edges).
 */
const VIEW = { fov: 30, fill: 0.64, fillHeight: 0.7, droneHeight: 1.15, fillPortrait: 0.85, elevation: 0.3, target: 0.05 };
function CtaCamera() {
  const aspect = useThree((s) => s.size.width / Math.max(s.size.height, 1));
  const tanV = Math.tan(((VIEW.fov / 2) * Math.PI) / 180);
  const fill = aspect < 0.85 ? VIEW.fillPortrait : VIEW.fill;
  const byWidth = 2 / (fill * 2 * tanV * aspect);
  const byHeight = VIEW.droneHeight / (VIEW.fillHeight * 2 * tanV);
  const dist = Math.max(byWidth, byHeight);
  return (
    <PerspectiveCamera
      makeDefault
      fov={VIEW.fov}
      position={[0, dist * Math.sin(VIEW.elevation), dist * Math.cos(VIEW.elevation)]}
      onUpdate={(c) => c.lookAt(0, VIEW.target, 0)}
    />
  );
}

export default function CtaDrone({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // User 2026-11-05 ("the drone is not coming immediately"): render a full screen ahead so the canvas, model and
  // shaders are ready before the section arrives, and start the landing as soon as the section's top is on screen
  // (was 30% visible).
  const inView = useInView(ref, { margin: "200% 0px 200% 0px" }); // was 100%: first frames (compile, env bake) well ahead
  const seen = useInView(ref, { amount: 0.05 });
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  useEffect(() => {
    if (seen) setPlaying(true);
    else if (!inView) setPlaying(false);
  }, [seen, inView]);
  return (
    <div ref={ref} className={className} aria-hidden="true">
      <Canvas
        dpr={[1, 2]}
        frameloop={inView ? "always" : "never"}
        gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping }}
      >
        <CtaCamera />
        <Environment resolution={128} frames={1}>
          <Lightformer form="rect" intensity={2} position={[0, 4, 1]} rotation={[Math.PI / 2, 0, 0]} scale={[6, 4, 1]} />
          <Lightformer form="rect" intensity={1.2} color="#cfe9f5" position={[-4, 1, 2]} rotation={[0, Math.PI / 2.6, 0]} scale={[0.6, 5, 1]} />
          <Lightformer form="rect" intensity={1} color="#cfe9f5" position={[4, 1, 2]} rotation={[0, -Math.PI / 2.4, 0]} scale={[0.5, 5, 1]} />
        </Environment>
        <directionalLight position={[-0.4, 1, 0.8]} intensity={2.2} />
        <ambientLight intensity={0.25} />
        <Suspense fallback={null}>
          <Flight playing={playing} ready={ready} />
          {/* Compile the drone's materials up front, off the main thread, not on its first visible frame. */}
          <Warmup onReady={onReady} />
        </Suspense>
      </Canvas>
    </div>
  );
}
