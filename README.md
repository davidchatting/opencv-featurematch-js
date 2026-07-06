# opencv-featurematch

A small JavaScript library for feature-based image alignment in the browser, built on [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html). Given two images, it finds matching features (ORB/KAZE + RANSAC), computes a homography between them, and hands back a transform you can use to warp one image onto the other.

Originally adapted from Scott Suhy's [Image Alignment (Feature Based) in OpenCV.js](https://scottsuhy.com/2021/02/01/image-alignment-feature-based-in-opencv-js-javascript/) tutorial (attribution kept in `align_img.js`).

## The library

Two files:

- **`align_img.js`** - the core feature-matching/homography computation (`Align_img`), adapted from the tutorial above.
- **`imgproc.js`** - pure alignment math on top: 4x4 matrix helpers, homography validation (`isReasonableHomography`) and shear cleanup (`stripShear`), and the clean two-image primitive most consumers actually want:

```js
const result = alignImagePair(imageA, imageB, options);
// -> { valid: true, transform: [16 numbers, row-major 4x4], inliers: 26, reason: 'OK' }
```

`alignImagePair` exists because `Align_img` itself doesn't return anything - it's an OpenCV.js port that mutates module-level globals (`h`, `good_inlier_matches`). `alignImagePair` wraps that and gives you a real return value instead. It's synchronous throughout: every OpenCV.js call inside `Align_img` (`detectAndCompute`, `knnMatch`, `findHomography`) is a synchronous WASM operation, nothing here is ever awaited.

`imgproc.js` is deliberately just the math - no DOM conventions (how a transform gets stored on an element, how images get downscaled/masked), no rendering, no EXIF/camera/playback, and no multi-image sequencing policy (which candidate to try, when to stop). All of that is application-specific. [davidchatting/shimage](https://github.com/davidchatting/shimage) covers the p5.js/WEBGL rendering side (converting a DOM image to a texture, drawing a warped quad); see [RugbySynth](https://github.com/davidchatting-bot/RugbySynth) for a full application built on both (EXIF-timed playback, a 3D camera fly-through, foreground/background segmentation).

## Demos

### Plain DOM demo

No p5.js, no canvas rendering - two `<img>` elements and a direct call to `alignImagePair()`.

[**Live demo**](https://davidchatting.github.io/opencv-featurematch/demos/dom/) · [source](demos/dom/index.html)

![Plain DOM demo screenshot](demos/screenshots/dom-demo.png)

### p5.js demo

Aligns two images, then uses the resulting transform to rectify a photo so the object in it appears head-on, via [shimage.js](https://github.com/davidchatting/shimage)'s `drawProjectedImage()`.

[**Live demo**](https://davidchatting.github.io/opencv-featurematch/demos/p5js/) · [source](demos/p5js/index.html)

![p5.js demo screenshot](demos/screenshots/p5js-demo.png)

## License

MIT - see [LICENSE](LICENSE).
