"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { RENDER_ORDER, terrainOffset } from "@/lib/constants";
import { SCENE, scenes } from "@/lib/scenes";
import { groundDimUniforms } from "./ground-dim";

/**
 * Low cloud wisps between the drone and the ground (Raven, user 2026-11-02): thin, broken, streaky stratus that
 * scrolls with the terrain (same travel, plus a slow wind) so it has natural parallax. When a wisp passes under the
 * dark drone the silhouette reads against white. From the Airframe chapter on whenever the camera looks down
 * (Airframe, Connection, Prepare, Route), off in the hero/opening, from the Care teams map on and after ignition.
 */
const HEIGHT = -1.25; // drones fly near y 0, the ground is at about -2.4
/** Opacity of the black overlay between the terrain and the wisps, at full wisp strength (normal blend). */
const GROUND_DIM = 0.5;
const SIZE = 160;

const vertexShader = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uTravel;
uniform float uStrength;
uniform vec3 uFocus; // where the camera's view ray meets the layer
uniform float uReach; // camera -> focus distance
varying vec3 vWorld;

// Sine-free hash (Hoskins): phone GPUs (Mali/Adreno) evaluate sin() of the large fBm arguments with too little
// precision, which smeared the clouds into streaky brush strokes on real phones (user 2026-11-13).
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}

void main() {
  // World-fixed like the ground (content at z + travel), streaks stretched across the flight line, slow wind in x.
  vec2 p = vec2(vWorld.x, vWorld.z + uTravel);
  vec2 q = vec2(p.x * 0.2 + uTime * 0.015, p.y * 0.55);
  float n = fbm(q);
  float d = fbm(q * 3.1 + 7.3);
  float cover = smoothstep(0.44, 0.66, 0.75 * n + 0.25 * d); // broken: roughly 40% coverage (was ~25%, user wanted more)
  // Fade around the point the camera looks at, scaled by its distance: overhead chapters sit ~15-28 units up (a
  // fixed 8-18 unit fade from the camera hid the layer), the Route camera looks ~15 units ahead, and the layer never
  // reads as a sheet running to the horizon.
  float fade = 1.0 - smoothstep(0.7 * uReach, 1.4 * uReach, length(vWorld.xz - uFocus.xz));
  vec3 col = mix(vec3(0.78, 0.83, 0.89), vec3(0.97, 0.98, 0.99), smoothstep(0.45, 0.8, d));
  gl_FragColor = vec4(col, cover * fade * uStrength * 0.68);
}`;

const _dir = new THREE.Vector3();
const _cam = new THREE.Vector3();

export function CloudWisps() {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uTravel: { value: 0 },
          uStrength: { value: 0 },
          uFocus: { value: new THREE.Vector3() },
          uReach: { value: 10 },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false, // the terrain lens reads the ground's depth
      }),
    [],
  );

  useFrame(({ camera, clock }) => {
    const m = mesh.current;
    if (!m) return;
    const state = scenes();
    camera.getWorldDirection(_dir);
    // Looking down (overhead and oblique chapters such as Route), but never in the opening/hero: gated on the story
    // having left the hero frame (DELTA_DRONE), since the hero camera also looks 33 deg down.
    const overhead =
      THREE.MathUtils.smoothstep(-_dir.y, 0.3, 0.55) * THREE.MathUtils.smoothstep(state[SCENE.DELTA_DRONE].progress, 0.3, 0.6);
    const notMap = 1 - THREE.MathUtils.smoothstep(state[SCENE.PHALANX_AI].progress, 0, 0.02);
    const notIgnited = 1 - state[SCENE.IGNITION_VERIFIED].progress;
    const strength = overhead * notMap * notIgnited;
    m.visible = strength > 0.001;
    groundDimUniforms.uGroundDim.value = GROUND_DIM * strength;
    if (!m.visible) return;
    // The camera sits in a moving rig: use its world position. Focus = view ray hitting the layer (looking down).
    camera.getWorldPosition(_cam);
    const t = (_cam.y - HEIGHT) / Math.max(-_dir.y, 0.2);
    const focus = material.uniforms.uFocus.value as THREE.Vector3;
    focus.copy(_cam).addScaledVector(_dir, t);
    material.uniforms.uReach.value = Math.max(t, 8);
    m.position.set(focus.x, HEIGHT, focus.z);
    material.uniforms.uStrength.value = strength;
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uTravel.value = terrainOffset.current ?? 0;
  });

  return (
    <mesh ref={mesh} renderOrder={RENDER_ORDER.CLOUDS} rotation={[-Math.PI / 2, 0, 0]} material={material} frustumCulled={false}>
      <planeGeometry args={[SIZE, SIZE]} />
    </mesh>
  );
}
