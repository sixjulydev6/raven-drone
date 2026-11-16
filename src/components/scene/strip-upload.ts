import * as THREE from "three";
import { whenQuiet } from "@/lib/quiet";

/**
 * Upload a large decoded image to the GPU a strip at a time (user 2026-11-16, Chrome on a Mac: "the drone loading is
 * lagging"). One texSubImage2D of a 4096^2 map held the main thread 160-310 ms (measured in Chrome, 1440x900 @2x), three
 * times right after the reveal, freezing the hovering drone. Here three only allocates the texture (`dataReady` false:
 * texStorage2D, no pixels), then each 256-row strip (~1/16 of the cost) is cropped off the thread by createImageBitmap
 * and uploaded on its own animation frame, in scroll pauses; mipmaps are built once at the end.
 *
 * `like` supplies wrap/filter settings. Orientation and colour handling match GLTFLoader's ImageBitmapLoader path
 * (no flip, no premultiply, no colour-space conversion, sRGB). Returns null if `alive()` turns false meanwhile.
 */
export async function uploadInStrips(
  renderer: THREE.WebGLRenderer,
  bitmap: ImageBitmap,
  like: THREE.Texture,
  alive: () => boolean,
  rows = 256,
): Promise<THREE.Texture | null> {
  const { width: w, height: h } = bitmap;
  const tex = new THREE.DataTexture(null, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.wrapS = like.wrapS;
  tex.wrapT = like.wrapT;
  tex.minFilter = like.minFilter;
  tex.magFilter = like.magFilter;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.source.dataReady = false; // allocate only
  tex.needsUpdate = true;
  renderer.initTexture(tex);
  const glTex = (renderer.properties.get(tex) as { __webglTexture?: WebGLTexture }).__webglTexture;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  if (!glTex) {
    tex.dispose();
    return null;
  }
  for (let y = 0; y < h; y += rows) {
    await whenQuiet(120);
    if (!alive()) {
      tex.dispose();
      return null;
    }
    const sh = Math.min(rows, h - y);
    const strip = await createImageBitmap(bitmap, 0, y, w, sh, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    renderer.state.bindTexture(gl.TEXTURE_2D, glTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y, w, sh, gl.RGBA, gl.UNSIGNED_BYTE, strip);
    strip.close();
  }
  await whenQuiet(120);
  if (!alive()) {
    tex.dispose();
    return null;
  }
  renderer.state.bindTexture(gl.TEXTURE_2D, glTex);
  gl.generateMipmap(gl.TEXTURE_2D);
  return tex;
}
