// imgproc.js - generic multi-image alignment/compositing helpers for opencv-featurematch
// Extracted from the segmention branch: matrix math, homography validation/cleanup,
// low-res/mask generation, and the multi-image alignment search. No EXIF, camera, or
// playback logic here - that's application-specific and stays in each app's own sketch.js.
//
// Depends on align_img.js being loaded first (uses its globals: Align_img, h,
// good_inlier_matches). generateMask() expects the including sketch to define a
// global `maskSegmentation` (a ready MediaPipe SelfieSegmentation instance) before
// it's called.

const identityMatrix = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
];

// Once a candidate match clears this many RANSAC inliers, stop searching further
// (temporally-nearer) candidates in processHomography - an early exit to avoid an
// O(n^2) alignment search across the whole sequence when the nearest neighbour is
// already a confident match, which is true for the large majority of burst-sequence
// pairs.
const EARLY_EXIT_INLIER_THRESHOLD = 50;

function applyTransform4x4(px, py, M) {
  // strict: accept only flat row-major 4x4 arrays (length 16)
  if (!Array.isArray(M) || M.length !== 16) return [px, py];

  const X = M[0] * px + M[1] * py + M[2] * 0 + M[3];
  const Y = M[4] * px + M[5] * py + M[6] * 0 + M[7];
  const W = M[12] * px + M[13] * py + M[14] * 0 + M[15];

  if (!isFinite(W) || Math.abs(W) < 1e-12) return [X, Y];
  return [X / W, Y / W];
}

/**
 * Multiplies two 4x4 row-major flat matrices and returns the result.
 * Result = A * B (A applied first, then B)
 * @param {Array} A - flat 16-element row-major 4x4 matrix
 * @param {Array} B - flat 16-element row-major 4x4 matrix
 * @returns {Array} - flat 16-element row-major 4x4 matrix (A * B)
 */
function multiplyMatrix4x4(A, B) {
  let result = null;

  if (!A || A.length !== 16 || !B || B.length !== 16) {
  }
  else {
    result = new Array(16);

    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += A[row * 4 + k] * B[k * 4 + col];
        }
        result[row * 4 + col] = sum;
      }
    }
  }

  return result;
}

function invertMatrix4x4(A) {
  const inv = new Array(16);
  const det = determinant4x4(A);
  if (det === 0) {
    return null;
  }
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      inv[j * 4 + i] = cofactor4x4(A, i, j) / det;
    }
  }
  return inv;
}

function determinant4x4(m) {
  if (!m || m.length !== 16) return null;

  // Helper for 3x3 determinant
  function det3(a, b, c, d, e, f, g, h, i) {
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  }

  const m0 = m[0],  m1 = m[1],  m2 = m[2],  m3 = m[3],
        m4 = m[4],  m5 = m[5],  m6 = m[6],  m7 = m[7],
        m8 = m[8],  m9 = m[9],  m10 = m[10], m11 = m[11],
        m12 = m[12], m13 = m[13], m14 = m[14], m15 = m[15];

  return (
    m0 * det3(m5, m6, m7,  m9, m10, m11,  m13, m14, m15)
    - m1 * det3(m4, m6, m7,  m8, m10, m11,  m12, m14, m15)
    + m2 * det3(m4, m5, m7,  m8, m9, m11,  m12, m13, m15)
    - m3 * det3(m4, m5, m6,  m8, m9, m10,  m12, m13, m14)
  );
}

function cofactor4x4(m, row, col) {
  // Build the 3x3 minor by skipping the given row and column
  const minor = [];
  for (let i = 0; i < 4; i++) {
    if (i === row) continue;
    for (let j = 0; j < 4; j++) {
      if (j === col) continue;
      minor.push(m[i * 4 + j]);
    }
  }
  // Compute the determinant of the 3x3 minor
  const det =
    minor[0] * (minor[4] * minor[8] - minor[5] * minor[7]) -
    minor[1] * (minor[3] * minor[8] - minor[5] * minor[6]) +
    minor[2] * (minor[3] * minor[7] - minor[4] * minor[6]);
  // Apply the checkerboard sign
  return ((row + col) % 2 === 0 ? 1 : -1) * det;
}

/**
 * Checks if a homography transform looks reasonable.
 * Returns { valid: boolean, reason: string, rotation: number, scale: number, shear: number }
 *
 * A "reasonable" homography for image alignment should have:
 * - Minimal rotation (< maxRotationDeg)
 * - Scale close to 1 (within scaleRange)
 * - Low shear
 * - Low perspective distortion (bottom row close to [0, 0, 1])
 *
 * @param {Array} H - flat 9-element row-major 3x3 homography, or flat 16-element 4x4
 * @param {Object} options - optional thresholds
 * @returns {Object} { valid, reason, rotation, scale, shear, perspective }
 */
function isReasonableHomography(H, options = {}) {
  const {
    maxRotationDeg = 15,      // max allowed rotation in degrees
    minScale = 0.5,           // min allowed scale
    maxScale = 2.0,           // max allowed scale
    maxShear = 0.3,           // max allowed shear
    maxPerspective = 0.001    // max allowed perspective distortion
  } = options;

  if (!H) return { valid: false, reason: 'H is null or undefined' };

  // extract 3x3 from flat 9 or flat 16
  let h00, h01, h02, h10, h11, h12, h20, h21, h22;
  if (H.length === 9) {
    [h00, h01, h02, h10, h11, h12, h20, h21, h22] = H;
  } else if (H.length === 16) {
    // 4x4 row-major: extract the 2D affine/projective part
    h00 = H[0];  h01 = H[1];  h02 = H[3];   // skip H[2] (z column)
    h10 = H[4];  h11 = H[5];  h12 = H[7];
    h20 = H[12]; h21 = H[13]; h22 = H[15];
  } else {
    return { valid: false, reason: 'H must be length 9 or 16' };
  }

  // normalize so h22 = 1 (if possible)
  if (Math.abs(h22) < 1e-12) {
    return { valid: false, reason: 'h22 is zero, degenerate homography' };
  }
  h00 /= h22; h01 /= h22; h02 /= h22;
  h10 /= h22; h11 /= h22; h12 /= h22;
  h20 /= h22; h21 /= h22; h22 = 1;

  // perspective distortion: bottom row should be [0, 0, 1]
  const perspective = Math.sqrt(h20 * h20 + h21 * h21);
  if (perspective > maxPerspective) {
    return {
      valid: false,
      reason: `Perspective distortion too high: ${perspective.toFixed(6)} > ${maxPerspective}`,
      perspective
    };
  }

  // decompose upper-left 2x2 into rotation, scale, shear
  // H = [ a  b  tx ]   where [a b; c d] = R * S * Shear
  //     [ c  d  ty ]
  //     [ 0  0  1  ]
  const a = h00, b = h01, c = h10, d = h11;

  // scale: sqrt of determinant gives overall scale
  const det = a * d - b * c;
  if (det <= 0) {
    return { valid: false, reason: 'Negative or zero determinant (flipped or degenerate)' };
  }
  const scale = Math.sqrt(det);

  // rotation angle from the 2x2 matrix (assumes no/low shear)
  // rotation = atan2(c, a) for a proper rotation matrix
  const rotationRad = Math.atan2(c, a);
  const rotationDeg = Math.abs(rotationRad * 180 / Math.PI);

  // shear: measure how non-orthogonal the axes are
  // shear ~ (a*b + c*d) / det for normalized matrix
  const shear = Math.abs(a * b + c * d) / det;

  // check thresholds
  if (rotationDeg > maxRotationDeg) {
    return {
      valid: false,
      reason: `Rotation too large: ${rotationDeg.toFixed(2)}° > ${maxRotationDeg}°`,
      rotation: rotationDeg,
      scale,
      shear,
      perspective
    };
  }

  if (scale < minScale || scale > maxScale) {
    return {
      valid: false,
      reason: `Scale out of range: ${scale.toFixed(3)} not in [${minScale}, ${maxScale}]`,
      rotation: rotationDeg,
      scale,
      shear,
      perspective
    };
  }

  if (shear > maxShear) {
    return {
      valid: false,
      reason: `Shear too high: ${shear.toFixed(3)} > ${maxShear}`,
      rotation: rotationDeg,
      scale,
      shear,
      perspective
    };
  }

  return {
    valid: true,
    reason: 'OK',
    rotation: rotationDeg,
    scale,
    shear,
    perspective
  };
}

// Strips shear out of a 4x4 transform, rebuilding it as a pure rotation + uniform
// scale from its top-row (a, c) components. Real (especially weakly-matched)
// homographies carry small shear, which corrupts anything that derives rotation
// from more than one edge of the transformed image (e.g. camera framing that uses
// a left/bottom edge as well as the top edge). Deriving from a single edge keeps
// callers immune to that noise.
function stripShear(transform) {
  if (!transform) return transform;

  const a = transform[0], c = transform[4];
  const tx = transform[3], ty = transform[7];

  const scale = Math.hypot(a, c) || 1;
  const cosT = a / scale, sinT = c / scale;

  return [
    scale * cosT, -scale * sinT, 0, tx,
    scale * sinT,  scale * cosT, 0, ty,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
}

function setImageTransform(element, transform) {
  if (element && Array.isArray(transform)) {
    element.setAttribute('data-transform', JSON.stringify(transform));
  }
}

function getImageTransformFromElement(element, traverse = false) {
  let result = null;

  if (element) {
    const b = traverse ? (getImageTransformFromElement(element.parentElement, false) || identityMatrix) : identityMatrix;
    try {
      result = JSON.parse(element.getAttribute('data-transform'));
    }
    catch (e) {
    }
    if (result) result = multiplyMatrix4x4(b, result);
  }

  return result;
}

function generateLowResImage(imgElement, onloaded = () => {}) {
  let lowresImg = null;

  const lowresMaxPixels = 1024 * 768;
  if (imgElement.width * imgElement.height > lowresMaxPixels) {
    const s = Math.sqrt(lowresMaxPixels / (imgElement.width * imgElement.height));

    const targetW = Math.round(imgElement.width * s);
    const targetH = Math.round(imgElement.height * s);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgElement, 0, 0, targetW, targetH);

    const dataUrl = canvas.toDataURL("image/jpeg", 1.0);
    canvas.width = 0;
    canvas.height = 0;

    lowresImg = createImg(dataUrl, '');
    lowresImg.elt.onload = onloaded;

    // Attach a 4x4 scaling transform (row-major)
    const invS = 1 / s;
    const scaleTransform = [
      invS, 0, 0, 0,
      0, invS, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ];
    setImageTransform(lowresImg.elt, scaleTransform);
  } else {
    lowresImg = new p5.Element(imgElement);
    setTimeout(onloaded, 0);

    // Attach identity transform (no scaling)
    setImageTransform(lowresImg.elt, identityMatrix);
  }

  return lowresImg;
}

// Helper: Promise version of generateLowResImage
function generateLowResImageAsync(imgElement) {
  return new Promise(resolve => {
    const lowresImg = generateLowResImage(imgElement, () => resolve(lowresImg));
  });
}

// Expects a ready MediaPipe SelfieSegmentation instance in the global `maskSegmentation`.
function generateMask(imgElement, onloaded = () => {}) {
  let maskImg = createImg('', '');

  maskSegmentation.onResults(async (results) => {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = results.segmentationMask.width;
    maskCanvas.height = results.segmentationMask.height;
    const ctx = maskCanvas.getContext('2d');

    // flip horizontally
    ctx.translate(maskCanvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(results.segmentationMask, 0, 0);

    // convert red-channel mask to greyscale (copy R to G and B)
    const imageData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];     // red channel holds the mask value
      data[i]     = r;       // R (keep)
      data[i + 1] = r;       // G (copy from R)
      data[i + 2] = r;       // B (copy from R)
    }
    ctx.putImageData(imageData, 0, 0);
    setImageTransform(maskImg.elt, getImageTransformFromElement(imgElement));

    maskImg.elt.onload = onloaded;
    maskImg.elt.src = maskCanvas.toDataURL();
  });
  maskSegmentation.send({ image: imgElement });

  return (maskImg);
}

// Helper: Promise version of generateMask
function generateMaskAsync(imgElement) {
  return new Promise(resolve => {
    const maskImg = generateMask(imgElement, () => resolve(maskImg));
  });
}

/**
 * Creates a new image element with the mask applied.
 * Pixels where the mask is dark (black) become transparent.
 * @param {HTMLImageElement|p5.Element} colorImg - the colour image
 * @param {HTMLImageElement|p5.Element} maskImg - the greyscale mask (white = keep, black = transparent)
 * @returns {p5.Element} - a new p5 img element containing the masked image
 */
function applyMaskToImage(colorImg, maskImg, invert = false, onloaded = () => {}) {
  let resultImg = createImg('', '');

  const w = colorImg.naturalWidth || colorImg.width;
  const h = colorImg.naturalHeight || colorImg.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  ctx.drawImage(colorImg, 0, 0, w, h);

  const colorData = ctx.getImageData(0, 0, w, h);
  const cPixels = colorData.data;

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(maskImg, 0, 0, w, h);
  const maskData = ctx.getImageData(0, 0, w, h);
  const mPixels = maskData.data;

  for (let i = 0; i < cPixels.length; i += 4) {
    const maskVal = invert ? 255 - mPixels[i] : mPixels[i];
    cPixels[i] = maskVal > 0 ? cPixels[i] : random(255);
    cPixels[i + 1] = maskVal > 0 ? cPixels[i + 1] : random(255);
    cPixels[i + 2] = maskVal > 0 ? cPixels[i + 2] : random(255);
    cPixels[i + 3] = maskVal;
  }

  ctx.putImageData(colorData, 0, 0);
  setImageTransform(resultImg.elt, getImageTransformFromElement(colorImg));

  resultImg.elt.onload = onloaded;
  resultImg.elt.src = canvas.toDataURL();

  return resultImg;
}

// Helper: Promise version of applyMaskToImage
function applyMaskToImageAsync(colorImg, maskImg, invert) {
  return new Promise(resolve => {
    const resultImg = applyMaskToImage(colorImg, maskImg, invert, () => resolve(resultImg));
  });
}

// cache for converted images (HTMLImageElement -> p5.Graphics)
const textureCache = new WeakMap();

function getTextureFromElement(el) {
  if (!el) return null;

  // Use natural pixel dimensions, not the CSS-rendered box size - el.width/height
  // reflect layout (and go wrong if surrounding CSS changes), while
  // naturalWidth/naturalHeight are the actual decoded image dimensions.
  const w = el.naturalWidth || el.width;
  const h = el.naturalHeight || el.height;

  // check cache first
  if (textureCache.has(el)) {
    const cached = textureCache.get(el);
    // check if image size changed (unlikely but safe)
    if (cached.width === w && cached.height === h) {
      return cached;
    }
    // size changed, remove old and recreate
    cached.remove();
  }

  // convert HTMLImageElement to p5.Graphics
  const g = createGraphics(w, h);
  g.drawingContext.drawImage(el, 0, 0);
  textureCache.set(el, g);
  return g;
}

// draw a textured quad: srcImg projected by homography Hproj into target image space
function drawProjectedImage(srcImg, x, y, Hproj, zDepth = 0) {
  if (!srcImg || !Hproj) return;

  const img = getTextureFromElement(srcImg);
  if (!img) return;

  const w = img.width, h = img.height;
  const corners = [0, 0, w, 0, w, h, 0, h];
  // project corners into target image pixel coords (corners is a flat array [x0,y0,...])
  const dst = [];
  for (let i = 0; i < corners.length; i += 2) {
    const p = applyTransform4x4(corners[i], corners[i + 1], Hproj) || [0, 0];
    dst.push(p[0] + x, p[1] + y);
  }
  // draw textured polygon in WEBGL using normalized texture coords (0..1)
  push();
    noStroke();
    texture(img);
    beginShape();
      // vertex(x, y, z, u, v)
      vertex(dst[0], dst[1], zDepth, 0, 0);
      vertex(dst[2], dst[3], zDepth, 1, 0);
      vertex(dst[4], dst[5], zDepth, 1, 1);
      vertex(dst[6], dst[7], zDepth, 0, 1);
    endShape(CLOSE);
  pop();
}

/**
 * Aligns the newest image in a '.background'-tagged media collection against
 * the best-matching (by RANSAC inlier count) previously-aligned image, trying
 * candidates nearest-in-DOM-order first and stopping early once a confident
 * match is found. Writes the resulting 4x4 transform onto the new image's
 * container via setImageTransform.
 */
function processHomography(id) {
  const selector = '.background';
  const mediaCollection = select('#media')?.elt.querySelectorAll(selector);
  if (!mediaCollection || mediaCollection.length === 0) return;

  const n = mediaCollection.length;

  if (n === 1) {
    setImageTransform(mediaCollection[0].parentElement, identityMatrix);
    return;
  }

  // The newest image is the last one
  const image_b = mediaCollection[n - 1];

  // Skip if already aligned
  if (getImageTransformFromElement(image_b.parentElement)) return;

  // Try all previously aligned images and pick the best match by inlier count
  let bestInliers = 0;
  let bestT0B = null;
  let bestMatchId = null;

  for (let i = n - 2; i >= 0; i--) {
    const image_a = mediaCollection[i];
    const t0A = getImageTransformFromElement(image_a.parentElement);

    // Skip images that haven't been aligned yet
    if (!t0A) continue;

    Align_img(image_a, image_b);

    const inlierCount = (good_inlier_matches && good_inlier_matches.size) ? good_inlier_matches.size() : 0;

    if (h && !h.empty() && h.data64F) {
      const check = isReasonableHomography(Array.from(h.data64F));

      if (check.valid && inlierCount > bestInliers) {
        const tab = [
          h.data64F[0], h.data64F[1], 0, h.data64F[2],
          h.data64F[3], h.data64F[4], 0, h.data64F[5],
          0, 0, 1, 0,
          h.data64F[6], h.data64F[7], 0, h.data64F[8]
        ];

        const tAa = getImageTransformFromElement(image_a);
        const tBb = getImageTransformFromElement(image_b);
        const tBb_i = invertMatrix4x4(tBb);
        const tAB = multiplyMatrix4x4(multiplyMatrix4x4(tAa, tab), tBb_i);

        bestT0B = multiplyMatrix4x4(t0A, tAB);
        bestInliers = inlierCount;
        bestMatchId = image_a.parentElement.id;

        // Candidates are tried nearest-in-time first (i counts down from n-2),
        // so a confident match here is very likely the best one available -
        // stop searching rather than aligning against every earlier frame too.
        if (bestInliers >= EARLY_EXIT_INLIER_THRESHOLD) {
          break;
        }
      } else if (!check.valid) {
        console.warn('Rejecting homography with', image_a.parentElement.id, ':', check.reason);
      }
    }
  }

  if (bestT0B) {
    setImageTransform(image_b.parentElement, bestT0B);
  } else {
    console.warn('No valid homography found for', image_b.parentElement.id);
  }
}
