// Minimal p5.js demo of the opencv-featurematch library - no EXIF, no camera
// fly-through, no playback timeline, no drag-and-drop. Loads the two classic
// OpenCV tutorial images, aligns them once via alignImagePair(), then uses the
// resulting transform to rectify the scene photo (box_in_scene.png) into the
// reference image's own frame (box.png) with drawProjectedImage() - the
// classic "unwarp this object to a head-on view" homography demonstration.
// Shown side by side with the original reference image for comparison.

const GAP = 20;
let sceneImg, refImg;
let sceneToRefTransform = null;
let ready = false;
let loadedCount = 0;

function setup() {
  createCanvas(324 * 2 + GAP, 223, WEBGL);
  textureMode(NORMAL);

  function onLoaded() {
    loadedCount++;
    if (loadedCount < 2) return;

    // alignImagePair(reference, toAlign) returns a transform mapping toAlign's
    // coordinate space onto reference's - exactly what's needed to rectify the
    // scene photo into the reference image's own frame.
    const result = alignImagePair(refImg.elt, sceneImg.elt, { maxPerspective: 0.01, maxScale: 3 });
    if (result.valid) {
      sceneToRefTransform = result.transform;
    } else {
      console.warn('Alignment failed:', result.reason);
    }
    ready = true;
  }

  refImg = createImg('../../images/box.png', '', '', onLoaded);
  refImg.hide();
  sceneImg = createImg('../../images/box_in_scene.png', '', '', onLoaded);
  sceneImg.hide();
}

function draw() {
  background(230);
  if (!ready || !sceneToRefTransform) return;

  push();
    translate(-width / 2, -height / 2);
    // Left: the rectified scene, warped so the box appears head-on, exactly
    // as it does in the reference image.
    drawProjectedImage(sceneImg.elt, 0, 0, sceneToRefTransform, 0);
    // Right: the original reference image, for comparison.
    drawProjectedImage(refImg.elt, 324 + GAP, 0, identityMatrix, 0);
  pop();
}
