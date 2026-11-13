/**
 * Raven opening land layer (glb/raven-sky/01_opening_panorama.py, land mode): 360 deg equirectangular RGBA band,
 * latitude PANORAMA_LAT_MIN..PANORAMA_LAT_MAX, transparent sky (the procedural OpeningSky sky shows through). Image
 * centre = heading 0 (world -Z), heading grows toward +X (three atan2(x, -z)). Default flipY: v = 0 is the bottom row.
 *
 * Plus a procedural sea of cloud below the horizon (user, 2026-11-02): while the opening camera climbs it looks down
 * past the last terrain tiles onto the Blender plain; the cloud covers that, densest toward the horizon and toward the
 * left/right screen edges, thinning smoothly toward the near ground. Its far part takes the sky's horizon colour, so it
 * meets the horizon without a line. Both the land dome and the terrain fog use it, so the tiles dissolve into it.
 */
export const PANORAMA_LAT_MIN = -22.5;
export const PANORAMA_LAT_MAX = 12;

const rad = (deg: number) => ((deg * Math.PI) / 180).toFixed(6);

export const panoramaLookup = /* glsl */ `
uniform sampler2D uPanorama;
uniform float uCloudTime; // seconds; drives the cloud sea drift (same clock in the land dome and the terrain fog)

// Sine-free hash (Hoskins): phone GPUs (Mali/Adreno) evaluate sin() of the large fBm arguments with too little
// precision, which smeared the clouds into streaky brush strokes on real phones (user 2026-11-13).
float panoHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float panoNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(panoHash(i), panoHash(i + vec2(1, 0)), f.x), mix(panoHash(i + vec2(0, 1)), panoHash(i + vec2(1, 1)), f.x), f.y);
}
float panoFbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * panoNoise(p); p = p * 2.07 + 13.7; a *= 0.5; }
  return v;
}

/** Cloud sea on a plane below the camera. edge: 0 at the screen centre, 1 at the left/right edges. */
vec4 cloudSea(vec3 d, float edge) {
  // The bank tops out a little above the horizon (1.4-2.0 deg, varying with heading) so it also hides the Blender
  // hills that rise ~1 deg above it; a flat top at 0 left a green strip and a hard line there.
  float heading = atan(d.x, -d.z);
  float bankTop = 0.03 + 0.010 * (panoFbm(vec2(heading * 9.0, 2.3)) - 0.5); // 1.4-2.0 deg: no hill slivers above
  float down = max(-d.y + bankTop, 0.0);
  // Slow drift across the plane (~1 noise cell per minute), mostly along one wind direction.
  vec2 p = d.xz / max(down, 0.015) * 0.35 + vec2(0.016, 0.006) * uCloudTime;
  // Detail fades out toward the horizon (the plane compresses there and would alias).
  float detail = smoothstep(0.012, 0.08, down);
  float n = mix(0.55, panoFbm(p + vec2(4.1, 1.7)), detail);
  // Coverage: full toward the back, growing at the screen edges, thinning toward the near ground.
  float far = 1.0 - smoothstep(0.03, 0.26, down);
  float sides = edge * edge * (1.0 - smoothstep(0.12, 0.45, down));
  float cover = clamp(far + 0.75 * sides, 0.0, 1.0);
  float a = cover * smoothstep(0.3, 0.62, n + 0.3 * cover) * smoothstep(0.0, 0.008, down); // soft top
  vec3 lit = mix(vec3(0.74, 0.80, 0.87), vec3(0.96, 0.97, 0.98), smoothstep(0.35, 0.75, n));
  vec3 col = mix(vec3(0.584, 0.745, 0.930), lit, smoothstep(0.004, 0.05, down)); // horizon: SKY_COLOR
  return vec4(col, a);
}

vec4 panoramaColor(vec3 dir, float edge) {
  vec3 d = normalize(dir);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float u = atan(d.x, -d.z) * 0.15915494 + 0.5;
  float v = clamp((lat - ${rad(PANORAMA_LAT_MIN)}) / ${rad(PANORAMA_LAT_MAX - PANORAMA_LAT_MIN)}, 0.0, 1.0);
  // Mipmapped (~2 texels per screen pixel); derivatives across the atan wrap behind the camera are folded back, or
  // that column would pick the smallest mip.
  vec2 uv = vec2(u, v);
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  gx.x -= floor(gx.x + 0.5);
  gy.x -= floor(gy.x + 0.5);
  vec4 c = textureGrad(uPanorama, uv, gx, gy);
  c = lat > ${rad(PANORAMA_LAT_MAX)} ? vec4(0.0) : c; // after the derivatives (uniform control flow)
  // Cloud sea over the land (straight alpha "over").
  vec4 s = cloudSea(d, edge);
  float a = s.a + c.a * (1.0 - s.a);
  vec3 rgb = a > 0.0 ? (s.rgb * s.a + c.rgb * c.a * (1.0 - s.a)) / a : vec3(0.0);
  return vec4(rgb, a);
}`;
