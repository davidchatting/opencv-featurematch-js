# opencv-featurematch-js

A JavaScript library for feature-based image alignment in the browser, built on [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html). Given two images, it finds matching features, computes a homography between them, returning a transform used to warp one image onto the other.

Originally adapted from Scott Suhy's [Image Alignment (Feature Based) in OpenCV.js](https://web.archive.org/web/20210201184709/https://scottsuhy.com/2021/02/01/image-alignment-feature-based-in-opencv-js-javascript/) tutorial.

## Demo

<!-- p5js-sync:homepage -->
[**Open in the p5.js editor**](https://editor.p5js.org/davidchatting/sketches/YHF4dsSbR)
<!-- /p5js-sync:homepage -->

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

## License

MIT - see [LICENSE](LICENSE).
