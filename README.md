# opencv-featurematch-js

A small JavaScript library for feature-based image alignment in the browser, built on [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html). Given two images, it finds matching features (ORB/KAZE + RANSAC), computes a homography between them, and hands back a transform you can use to warp one image onto the other.

Originally adapted from Scott Suhy's [Image Alignment (Feature Based) in OpenCV.js](https://web.archive.org/web/20210201184709/https://scottsuhy.com/2021/02/01/image-alignment-feature-based-in-opencv-js-javascript/) tutorial (original link now dead; attribution kept in `opencv-featurematch-js.js`).

## The library

Everything ships as a single file, **`opencv-featurematch-js.js`**:

- The core feature-matching/homography computation (`Align_img`), adapted from the tutorial above.
- Alignment math on top: matrix helpers for both the 3D/WEBGL 4x4 form (`invertMatrix4x4`, `multiplyMatrix4x4`, `to2dAffine`) and the plain 2D affine 6-element form (`invertMatrix2D`), homography validation (`isReasonableHomography`) and shear cleanup (`stripShear`), and the clean two-image primitive most consumers actually want:

```js
const result = alignImagePair(imageA, imageB, options);
// -> { valid: true, transform: [16 numbers, row-major 4x4], transform2D: [a, b, c, d, e, f], inliers: 26, inlierMatches: [...], outlierMatches: [...], reason: 'OK' }
```

`alignImagePair` exists because `Align_img` itself doesn't return anything - it's an OpenCV.js port that mutates module-level globals (`h`, `good_inlier_matches`). `alignImagePair` wraps that and gives you a real return value instead. It's synchronous throughout: every OpenCV.js call inside `Align_img` (`detectAndCompute`, `knnMatch`, `findHomography`) is a synchronous WASM operation, nothing here is ever awaited.

`transform` and `transform2D` are the same homography in two shapes: `transform` is padded to a flat 16-element row-major 4x4 (for `drawProjectedImage`'s 3D/WEBGL quad warp and the other 4x4 matrix helpers), `transform2D` is the flat 6-element `[a, b, c, d, e, f]` affine form that both the canvas API's `setTransform()` and p5.js's `applyMatrix()` (2D mode) expect directly - equivalent to calling `to2dAffine(transform)` yourself, just already done for you. Perspective terms are dropped in `transform2D` (`isReasonableHomography`'s own default `maxPerspective` threshold already keeps those small for any result that comes back `valid`). Invert it with `invertMatrix2D`, not `invertMatrix4x4`.

`inlierMatches` and `outlierMatches` are the underlying point correspondences the homography was computed from, each an array of `{ imageA: [x, y], imageB: [x, y] }` pairs in that image's own pixel coordinates - `inlierMatches` are the ones RANSAC kept, `outlierMatches` the ones it rejected. Useful for visualizing match quality (e.g. drawing lines between the two images) rather than just trusting the `inliers` count. Populated whenever `Align_img` finds any matches at all, even on an otherwise-`invalid` result (e.g. one rejected for excessive perspective).

Before calling either of the above, `await cvLoaded()` - opencv.js's `<script onload>` fires once its JS wrapper has loaded, not once its WASM runtime has actually finished initializing, and calling into this library before that finishes throws `"undefined is not a constructor"`:

```js
await cvLoaded();
const result = alignImagePair(imageA, imageB, options);
applyMatrix(result.transform2D);
```

`to2dAffine` still exists for converting any other 4x4 matrix (e.g. one composed via `multiplyMatrix4x4` outside of `alignImagePair`) into the same 6-element form:

```js
applyMatrix(to2dAffine(someOther4x4Transform));
```

The library is deliberately just feature matching and math - no DOM conventions (how a transform gets stored on an element, how images get downscaled/masked), no rendering, no EXIF/camera/playback, and no multi-image sequencing policy (which candidate to try, when to stop). All of that is application-specific. [davidchatting/shimage](https://github.com/davidchatting/shimage) covers the p5.js/WEBGL rendering side (converting a DOM image to a texture, drawing a warped quad); see [RugbySynth](https://github.com/davidchatting-bot/RugbySynth) for a full application built on both (EXIF-timed playback, a 3D camera fly-through, foreground/background segmentation).

A minified build, `opencv-featurematch-js.min.js`, is generated automatically by CI on every push to `main` (see `.github/workflows/build-min.yml`) and committed back alongside the source - both are available via jsDelivr:

```
https://cdn.jsdelivr.net/gh/davidchatting/opencv-featurematch-js@main/opencv-featurematch-js.min.js
```

## Demo

A minimal, editable sketch showing `cvLoaded()` + `alignImagePair()` in the smallest amount of code, loaded straight from the CDN.

[**Open in the p5.js editor**](https://editor.p5js.org/davidchatting/sketches/YHF4dsSbR)

## License

MIT - see [LICENSE](LICENSE).
