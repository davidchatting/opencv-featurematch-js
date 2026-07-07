# opencv-featurematch-js

A small JavaScript library for feature-based image alignment in the browser, built on [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html). Given two images, it finds matching features (ORB/KAZE + RANSAC), computes a homography between them, and hands back a transform you can use to warp one image onto the other.

Originally adapted from Scott Suhy's [Image Alignment (Feature Based) in OpenCV.js](https://web.archive.org/web/20210201184709/https://scottsuhy.com/2021/02/01/image-alignment-feature-based-in-opencv-js-javascript/) tutorial (original link now dead; attribution kept in `opencv-featurematch-js.js`).

## The library

Everything ships as a single file, **`opencv-featurematch-js.js`**, which depends on both `opencv.js` and [davidchatting/shimage](https://github.com/davidchatting/shimage) being loaded too - not just the other way around (see below):

- The core feature-matching/homography computation (`Align_img`), adapted from the tutorial above.
- Alignment math on top: homography validation (`isReasonableHomography`) and shear cleanup (`stripShear`), and the clean two-image primitive most consumers actually want:

```js
const result = alignImages(imageA, imageB, options);
// -> { valid: true, transform: [16 numbers, column-major 4x4], inlierMatches: [...26 pairs...], outlierMatches: [...], reason: 'OK' }
```

`alignImages` exists because `Align_img` itself doesn't return anything - it's an OpenCV.js port that mutates module-level globals (`h`, `good_inlier_matches`). `alignImages` wraps that and gives you a real return value instead. It's synchronous throughout: every OpenCV.js call inside `Align_img` (`detectAndCompute`, `knnMatch`, `findHomography`) is a synchronous WASM operation, nothing here is ever awaited.

`transform` is a flat 16-element **column-major** 4x4 - the same layout WebGL/OpenGL use natively, so `applyMatrix(...result.transform)` in p5.js's WEBGL mode works directly, no conversion needed, as does `drawProjectedImage()` and the other 4x4 matrix helpers below. For plain 2D canvas/p5.js drawing, convert it with `to2dAffine(transform)` - see below. It's populated as soon as `Align_img` finds a homography at all - including on an otherwise-`invalid` result (e.g. one `isReasonableHomography` rejected for excessive perspective) - so you can inspect or use a rejected transform yourself rather than only ever getting `null`. It's only `null` when no homography was found in the first place.

`inlierMatches` and `outlierMatches` are the underlying point correspondences the homography was computed from, each an array of `[[xA, yA], [xB, yB]]` pairs in that image's own pixel coordinates - `inlierMatches` are the ones RANSAC kept, `outlierMatches` the ones it rejected (`inlierMatches.length` is the inlier count). Useful for visualizing match quality (e.g. drawing lines between the two images) rather than just trusting a summary number. Populated whenever `Align_img` finds any matches at all, even on an otherwise-`invalid` result (e.g. one rejected for excessive perspective). Coordinates are rounded to whole pixels by default - pass `{ precision: 2 }` (decimal places) to `alignImages` for finer-grained values.

Before calling either of the above, `await featurematchReady()` - opencv.js's `<script onload>` fires once its JS wrapper has loaded, not once its WASM runtime has actually finished initializing, and calling into this library before that finishes throws `"undefined is not a constructor"`. `featurematchReady()` waits for both `cvReady()` (OpenCV.js) and `shimageReady()` (`shimage.js`) - call it instead of either individually unless you have a specific reason to wait on just one:

```js
await featurematchReady();
const result = alignImages(imageA, imageB, options);

applyMatrix(...result.transform);          // p5.js WEBGL mode - works directly
applyMatrix(to2dAffine(result.transform)); // p5.js 2D mode / canvas setTransform()
```

`to2dAffine` (from `davidchatting/shimage` - see below) converts any 4x4 matrix (e.g. `result.transform`, or one composed via `multiplyMatrix4x4` outside of `alignImages`) into the same 6-element form.

The library is deliberately just feature matching and homography-level math - no DOM conventions (how a transform gets stored on an element, how images get downscaled/masked), no rendering, no EXIF/camera/playback, and no multi-image sequencing policy (which candidate to try, when to stop). All of that is application-specific. [davidchatting/shimage](https://github.com/davidchatting/shimage) covers both the plain matrix helpers (`applyTransform4x4`, `multiplyMatrix4x4`, `invertMatrix4x4`, `to2dAffine`, `invertMatrix2D`, etc., used throughout `isReasonableHomography` and by consumers composing `alignImages`'s `transform`) and the p5.js/WEBGL rendering side (converting a DOM image to a texture, drawing a warped quad) - make sure it's loaded alongside this file (script tag order between the two doesn't matter, since nothing calls either library until your own code runs later). See [RugbySynth](https://github.com/davidchatting-bot/RugbySynth) for a full application built on both (EXIF-timed playback, a 3D camera fly-through, foreground/background segmentation).

A minified build, `opencv-featurematch-js.min.js`, is generated automatically by CI on every push to `main` (see `.github/workflows/build-min.yml`) and committed back alongside the source - both are available via jsDelivr:

```html
<script src="https://cdn.jsdelivr.net/gh/davidchatting/opencv-featurematch-js@0.4.1/opencv-featurematch-js.min.js"></script>
```

Pin to a version tag (`@0.4.1`) rather than `@main` so updates here can't silently change behaviour (or hand you a stale jsDelivr cache) for existing consumers. See [davidchatting/cdn](https://github.com/davidchatting/cdn) for other vendored libraries served the same way.

## Demo

A minimal, editable sketch showing `featurematchReady()` + `alignImages()` in the smallest amount of code, loaded straight from the CDN.

<!-- p5js-sync:homepage -->
[**Open in the p5.js editor**](https://editor.p5js.org/davidchatting/sketches/YHF4dsSbR)
<!-- /p5js-sync:homepage -->
 - kept in sync automatically by `build.yml` on every push (from `package.json`'s `homepage` field), both above and in [`p5js/`](p5js).

<!-- p5js-sync:index.html -->
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <script src="https://cdn.jsdelivr.net/npm/p5@1.11.13/lib/p5.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/p5@1.11.13/lib/addons/p5.sound.min.js"></script>
    <script src="https://cdn.jsdelivr.net/gh/davidchatting/shimage@1.3.0/shimage.js"></script>
    <script src="https://cdn.jsdelivr.net/gh/davidchatting/cdn/opencv/4.5.1/opencv.js"></script>
    <script src="https://cdn.jsdelivr.net/gh/davidchatting/opencv-featurematch-js@0.4.3/opencv-featurematch-js.js"></script>
    
    <link rel="stylesheet" type="text/css" href="style.css">
    <meta charset="utf-8" />

  </head>
  <body>
    <main>
    </main>
    <script src="sketch.js"></script>
  </body>
</html>
```
<!-- /p5js-sync:index.html -->

<!-- p5js-sync:sketch.js -->
```js
let box, box_in_scene;
let result;

function preload() {
  box = loadImage('images/box.png');
  box_in_scene = loadImage('images/box_in_scene.png');
}

async function setup() {
  createCanvas(800, 400, WEBGL);
  await featurematchReady();
  const options = {};
  result = alignImages(box.canvas, box_in_scene.canvas, options);
  console.log(result);
}

function draw() {
  background(220);
  translate(-width/2, -height/2);
  image(box, 0, 0);
  
  push();
    translate(box.width, 0);
    image(box_in_scene, 0, 0);
    if (result && result.valid) {
      applyMatrix(invertMatrix4x4(result.transform));
      noFill();
      strokeWeight(3);
      stroke('green');
      rect(0, 0, box.width, box.height);
    }
  pop();
}
```
<!-- /p5js-sync:sketch.js -->

## License

MIT - see [LICENSE](LICENSE).
