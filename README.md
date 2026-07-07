# opencv-featurematch-js

A JavaScript library for feature-based image alignment in the browser, built on [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html). Given two images, it finds matching features, computes a homography between them, returning a transform used to warp one image onto the other.

Useful anywhere two overlapping images need to be lined up automatically - panorama/mosaic stitching, burst-sequence or time-lapse alignment, augmented reality overlays, document/whiteboard scanning, or motion tracking across frames.

Originally adapted from Scott Suhy's [Image Alignment (Feature Based) in OpenCV.js](https://web.archive.org/web/20210201184709/https://scottsuhy.com/2021/02/01/image-alignment-feature-based-in-opencv-js-javascript/) tutorial.

## Example

This example is written with **p5.js** and this example can be <!-- p5js-sync:homepage -->
[**Open in the p5.js editor**](https://editor.p5js.org/davidchatting/sketches/YHF4dsSbR)
<!-- /p5js-sync:homepage -->.

sketch.js
<!-- p5js-sync:sketch.js -->
```js
let box, box_in_scene;
let result;

function preload() {
  box = loadImage('images/bastoncini.png');
  box_in_scene = loadImage('images/bastoncini_in_scene.png');
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
      applyMatrix(result.transform);
      noFill();
      strokeWeight(3);
      stroke('green');
      rect(0, 0, box.width, box.height);
    }
  pop();
}
```
<!-- /p5js-sync:sketch.js -->

`await featurematchReady()` waits until the feature-matching is ready, this also requires both the OpenCv and Shimage libraries to be loaded succesfully.

`alignImages(imageA, imageB, options)` computes the alignment of the images, a 3D transform that will map `imageA`'s own coordinate space into `imageB`'s directly. Internally, the OpenCV pipeline detects KAZE features in both images, matches them with a kNN matcher, keeps the confident matches, and fits a homography between them with `cv.findHomography` (RANSAC).

The returned result object:
- `valid` - whether the fitted homography passed the thresholds set by `options` below
- `transform` - a flat 16-element **column-major** 4x4 matrix (the same layout WebGL/OpenGL use natively). Populated as soon as any homography is found at all, even on an otherwise-invalid result - only `null` if no homography was found
- `inlierMatches` / `outlierMatches` - the underlying point correspondences, each an array of `[[xA, yA], [xB, yB]]` pairs in that image's own pixel coordinates; `inlierMatches` are the ones RANSAC kept, `outlierMatches` the ones it rejected
- `reason` - why an invalid result was rejected (or `'OK'`)

`options` passed to `alignImages`:
- `maxRotationDeg` - max allowed rotation in degrees (default: unbounded)
- `maxScale` - max allowed scale factor, n - the homography can be up to nx bigger or nx smaller (default `3`)
- `maxShear` - max allowed shear (default `0.5`)
- `maxPerspective` - max allowed perspective distortion (default `0.01`)
- `precision` - decimal places to round `inlierMatches`/`outlierMatches` coordinates to (default `0`, i.e. whole pixels)

index.html
<!-- p5js-sync:index.html -->
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <script src="https://cdn.jsdelivr.net/npm/p5@1.11.13/lib/p5.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/p5@1.11.13/lib/addons/p5.sound.min.js"></script>
    <script src="https://cdn.jsdelivr.net/gh/davidchatting/shimage@1.3.0/shimage.js"></script>
    <script src="https://cdn.jsdelivr.net/gh/davidchatting/cdn/opencv/4.5.1/opencv.js"></script>
    <script src="https://cdn.jsdelivr.net/gh/davidchatting/opencv-featurematch-js@0.5.1/opencv-featurematch-js.js"></script>
    
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

### Syncing with the p5.js Editor

This repository automatically synchronises with the <!-- p5js-sync:homepage -->
[**Open in the p5.js editor**](https://editor.p5js.org/davidchatting/sketches/YHF4dsSbR)
<!-- /p5js-sync:homepage -->, where the example code is maintained. Using the github workflows, every repository push to `main`, triggers `build.yml` to download the sketch's files via the editor's export API, write them into [`p5js/`](p5js) in this repo, and insert the same content into the code blocks in this README. The reference for the p5.js sketch is held in the `package.json` `homepage` field.

## License

MIT - see [LICENSE](LICENSE).
