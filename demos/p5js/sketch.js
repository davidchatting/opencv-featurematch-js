// Minimal p5.js demo of the opencv-featurematch library - no EXIF, no camera
// fly-through, no playback timeline, no drag-and-drop. Loads the two classic
// OpenCV tutorial images as p5.Image objects via async setup()/await
// loadImage() - p5 waits for setup() to resolve before starting the draw
// loop, same as it would for preload(). Aligns them once via
// alignImagePair(), then uses the resulting transform to rectify the scene
// photo (box_in_scene.png) into the reference image's own frame (box.png)
// with drawProjectedImage() - the classic "unwarp this object to a head-on
// view" homography demonstration. Shown side by side with the original
// reference image for comparison.

const GAP = 20;
let sceneImg, refImg;
let sceneToRefTransform = null;
let croppedSceneImg = null;
let croppedTransform = null;

// opencv.js's own onload fires once its JS wrapper has loaded, not once its
// WASM runtime has actually finished initializing - cv.DMatchVector (used by
// Align_img) isn't callable until some time after that. cv is technically
// thenable, but awaiting it directly never resolves; polling for a real
// constructor to appear is the reliable option.
function waitForOpenCv() {
  return new Promise(resolve => {
    (function poll() {
      if (typeof cv !== 'undefined' && typeof cv.DMatchVector === 'function') {
        resolve();
      } else {
        setTimeout(poll, 50);
      }
    })();
  });
}

async function setup() {
  createCanvas(324 * 2 + GAP, 223, WEBGL);
  textureMode(NORMAL);

  await waitForOpenCv();

  refImg = await loadImage('../../images/box.png');
  sceneImg = await loadImage('../../images/box_in_scene.png');

  // alignImagePair(reference, toAlign) returns a transform mapping toAlign's
  // coordinate space onto reference's - exactly what's needed to rectify the
  // scene photo into the reference image's own frame. It expects a DOM
  // image/canvas source - p5.Image exposes its underlying pixels as a real
  // <canvas> via .canvas.
  const result = await alignWithRetry(refImg.canvas, sceneImg.canvas, { maxPerspective: 0.01, maxScale: 3 });
  if (result.valid) {
    sceneToRefTransform = result.transform;
    cropToBoxRegion();
  } else {
    console.warn('Alignment failed:', result.reason);
  }
}

// waitForOpenCv only confirms cv.DMatchVector (a plain data structure) is
// constructible - in practice its actual feature detectors (e.g. KAZE) can
// still be a little behind that, briefly returning zero keypoints for a
// perfectly good image. Retrying a few times a short delay apart clears this
// reliably without a fragile fixed sleep guess.
async function alignWithRetry(refCanvas, sceneCanvas, options, maxAttempts = 10, delayMs = 200) {
  let result;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    result = alignImagePair(refCanvas, sceneCanvas, options);
    if (result.valid || result.inliers > 0) return result;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return result;
}

// The scene photo (512x384) is much larger than the matched box region within
// it (roughly 190x140). drawProjectedImage warps a source image by mapping
// its own 4 corners through Hproj and texturing the resulting quad with plain
// bilinear interpolation - a good approximation of the true (nonlinear)
// projective warp only over a small extent. Over the full scene image, the
// homography's small-but-real perspective term (h20, h21) compounds badly at
// the far corners, and the bilinear approximation visibly distorts the
// interior - including the box region - well away from the true warp. Cropping
// tightly to the box's own region first keeps the coordinates - and so the
// perspective term's effect - small, which keeps the approximation accurate.
function cropToBoxRegion() {
  const inv = invertMatrix4x4(sceneToRefTransform);
  const refCorners = [[0, 0], [refImg.width, 0], [refImg.width, refImg.height], [0, refImg.height]];
  const sceneCorners = refCorners.map(([x, y]) => applyTransform4x4(x, y, inv));

  const margin = 20;
  const xs = sceneCorners.map(c => c[0]), ys = sceneCorners.map(c => c[1]);
  const minX = Math.max(0, Math.min(...xs) - margin);
  const minY = Math.max(0, Math.min(...ys) - margin);
  const maxX = Math.min(sceneImg.width, Math.max(...xs) + margin);
  const maxY = Math.min(sceneImg.height, Math.max(...ys) + margin);
  const cropW = maxX - minX, cropH = maxY - minY;

  const canvas = document.createElement('canvas');
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sceneImg.canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
  croppedSceneImg = canvas;

  // The crop's own (0,0) corresponds to (minX, minY) in the original scene
  // image - prepend that offset so the transform still maps correctly.
  // multiplyMatrix4x4(A, B) computes the matrix product A*B; since
  // applyTransform4x4 applies a matrix to a column vector (M*p), getting
  // "cropOffset first, then sceneToRefTransform" means passing
  // sceneToRefTransform first here, cropOffset second.
  const cropOffset = [
    1, 0, 0, minX,
    0, 1, 0, minY,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
  croppedTransform = multiplyMatrix4x4(sceneToRefTransform, cropOffset);
}

function draw() {
  background(230);
  if (!sceneToRefTransform) return;

  push();
    translate(-width / 2, -height / 2);
    // Left: the rectified (cropped) scene, warped so the box appears
    // head-on, exactly as it does in the reference image.
    if (croppedSceneImg && croppedTransform) {
      drawProjectedImage(croppedSceneImg, 0, 0, croppedTransform, 0);
    }
    // Right: the original reference image, for comparison.
    drawProjectedImage(refImg.canvas, 324 + GAP, 0, identityMatrix, 0);
  pop();
}
