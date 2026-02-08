const identityMatrix = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
];

const imageTransforms = [];
let mediaBoundingBox = null;
let closestImageIndex = 0;

let maskSegmentation = null;

/**
 * Creates the foreground segmenter and waits until it's ready.
 * Returns a Promise that resolves when the segmenter is ready.
 */
async function createForegroundSegmenter() {
  maskSegmentation = new SelfieSegmentation({
    locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@latest/${file}`;
    }
  });
  var options = {
    selfieMode: true,
    modelSelection: 0, // general
    effect: 'mask',
  };
  maskSegmentation.setOptions(options);

  // Wait for the WASM to load (simulate "blocking" until ready)
  await maskSegmentation.initialize();
}

// In setup(), use async/await to block until ready
async function setup() {
  // Use WEBGL so texture()/vertex(u,v) in drawImageWithHomography works
  canvas = createCanvas(2000, 800, WEBGL);
  frameRate(10);
  canvas.drop(onFileDropped);

  // Block until segmenter is ready
  await createForegroundSegmenter();

  // ensure texture UVs use normalized coordinates
  textureMode(NORMAL);

  processAnyAttachedMedia();
}

function onFileDropped(file) {
  const id = file.name;
  console.log("Dropped file: " + file.name);
  const div = upsertMedia(id);

  const originalImg = createImg(file.data, '', () => {
    originalImg.parent(div);
    originalImg.addClass('original');
    setImageTransform(originalImg.elt, identityMatrix);

    processImage(originalImg.elt, div);
  });
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
    setImageTransform(lowresImg.elt, [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]);
  }

  return lowresImg;
}

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

    return(maskImg);
}

function processHomography(id) {
  const selector = '.background';
  const mediaCollection = select('#media')?.elt.querySelectorAll(selector);
  console.log('mediaCollection',mediaCollection);

  if(mediaCollection) {
    const n = mediaCollection.length;
    if(n > 0) {
      if(n == 1) {
        setImageTransform(mediaCollection[0].parentElement, identityMatrix);
      }
      else {
        let image_a = mediaCollection[n-2];
        let image_b = mediaCollection[n-1];
        let t0A = getImageTransformFromElement(image_a.parentElement);
        let t0B = getImageTransformFromElement(image_b.parentElement);
        if(t0A && !t0B) {
          console.log('*** align ', image_a.parentElement.id, image_b.parentElement.id);
          Align_img(image_a, image_b);

          if(h && !h.empty() && h.data64F) { 
            const check = isReasonableHomography(Array.from(h.data64F));
            console.log('Homography check:', check);
            
            if (check.valid) {
              // homography from new image (a) to matching image (b)
              const tab = [
                h.data64F[0], h.data64F[1], 0, h.data64F[2],
                h.data64F[3], h.data64F[4], 0, h.data64F[5],
                0, 0, 1, 0,
                h.data64F[6], h.data64F[7], 0, h.data64F[8]
              ];
              
              const tAa = getImageTransformFromElement(image_a);
              //const t0a = multiplyMatrix4x4(t0A, tAa);
              //const t0b = multiplyMatrix4x4(t0a, tab);
              //const tAb = multiplyMatrix4x4(tAa, tab);

              const tBb = getImageTransformFromElement(image_b);
              const tBb_i = invertMatrix4x4(tBb);
              const tAB = multiplyMatrix4x4(multiplyMatrix4x4(tAa, tab), tBb_i);
              t0B = multiplyMatrix4x4(t0A, tAB);

              setImageTransform(image_b.parentElement, t0B);
            } else {
              console.warn('Rejecting homography:', check.reason);
            }
          }
        }
      }
    }
  }

  /*
  if(mediaCollection && mediaCollection.childElementCount > 0) {
    const elementToProcess = select(`[id="${id}"]`);
    if(!elementToProcess) return;

    if (elementToProcess.elt !== mediaCollection.children[0]) {
      let foundValidHomography = false;

      const image_b = elementToProcess.elt.querySelector(selector);
      for (let n = mediaCollection.childElementCount - 1; n >= 0 && !foundValidHomography; n--) {
        const mediaElement = mediaCollection.children[n];
        if(id !== mediaElement.id) {
          const image_a = mediaElement.querySelector(selector);

          console.log("*align to B:" + image_b);
          console.log("*align to B:" + image_b.parentElement.id);

          console.log("*align from A:" + image_a);
          console.log("*align from A:" + image_a.parentElement.id);

          if(image_a &&image_b && !getImageTransformFromElement(image_b.parentElement)) {
            Align_img(image_a, image_b);
            if(h && !h.empty() && h.data64F) { 
              const check = isReasonableHomography(Array.from(h.data64F));
              console.log('Homography check:', check);
              
              if (check.valid) {
                // homography from new image (a) to matching image (b)
                const tab = [
                  h.data64F[0], h.data64F[1], 0, h.data64F[2],
                  h.data64F[3], h.data64F[4], 0, h.data64F[5],
                  0, 0, 1, 0,
                  h.data64F[6], h.data64F[7], 0, h.data64F[8]
                ];
                
                const tAa = getImageTransformFromElement(image_a);
                const tBb_i = invertMatrix4x4(getImageTransformFromElement(image_b));
                const tAB = multiplyMatrix4x4(multiplyMatrix4x4(tBb_i, tab), tAa);

                setImageTransform(image_b.parentElement, tAB);
                foundValidHomography = true;
              } else {
                console.warn('Rejecting homography:', check.reason);
              }
            }
          }
          }
      }
    } else {
      setImageTransform(elementToProcess.elt, identityMatrix);
    }
  }
    */
}

// cache for converted images (HTMLImageElement -> p5.Graphics)
const textureCache = new WeakMap();

function getTextureFromElement(el) {
  if (!el) return null;
  
  // check cache first
  if (textureCache.has(el)) {
    const cached = textureCache.get(el);
    // check if image size changed (unlikely but safe)
    if (cached.width === el.width && cached.height === el.height) {
      return cached;
    }
    // size changed, remove old and recreate
    cached.remove();
  }
  
  // convert HTMLImageElement to p5.Graphics
  const g = createGraphics(el.width, el.height);
  g.drawingContext.drawImage(el, 0, 0);
  textureCache.set(el, g);
  return g;
}

// draw a textured quad: srcImg projected by homography Hproj into target image space (targetIndex)
function drawProjectedImage(srcImg, x, y, Hproj, zDepth = 0) {
  if (!srcImg || !Hproj) return;
  
  const img = getTextureFromElement(srcImg);
  if (!img) return;
  
  const w = img.width, h = img.height;
  const corners = [0,0,w,0,w,h,0,h];
  // project corners into target image pixel coords (corners is a flat array [x0,y0,...])
  const dst = [];
  for (let i = 0; i < corners.length; i += 2) {
    const p = applyTransform4x4(corners[i], corners[i + 1], Hproj) || [0, 0];
    dst.push(p[0]+x, p[1]+y);
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

function upsertMedia(id) {
  if (!id) return null;

  let container = select('#media');
  if (!container) return null;

  const found = container.elt.querySelector('#' + id);
  if (found) return select('#' + id); // use p5.select to return a p5.Element

  const d = createDiv('');
  d.id(id);
  d.parent(container);
  return d;
}

/**
 * Finds the index of the image whose transformed origin (0,0) is closest to the mouse,
 * taking into account the framing matrix used for drawing.
 * @returns {number} - index of closest image, or -1 if none
 */
function getClosestImageToMouse() {
  const mediaElement = select('#media')?.elt;
  if (!mediaElement) return -1;

  // Get the framing matrix used for drawing
  const framing = getFramingMatrix3x2(mediaBoundingBox);

  // Invert the framing matrix to map mouse position back to "world" coordinates
  // [a, b, d, e, tx, ty] for 2D affine
  const [a, b, d, e, tx, ty] = framing;
  const det = a * e - b * d;
  if (Math.abs(det) < 1e-12) return -1;

  // Inverse affine matrix
  const ia =  e / det;
  const ib = -b / det;
  const id = -d / det;
  const ie =  a / det;
  const itx = (d * ty - e * tx) / det;
  const ity = (b * tx - a * ty) / det;

  // Mouse position in canvas coordinates
  const mx = mouseX;
  const my = mouseY;

  // Map mouse position to "world" coordinates
  const worldX = ia * mx + ib * my + itx;
  const worldY = id * mx + ie * my + ity;

  let closestIndex = -1;
  let closestDist = Infinity;

  for (let i = 0; i < mediaElement.children.length; i++) {
    const transform = getImageTransformFromElement(mediaElement.children[i], true);
    if (!transform) continue;

    // transform origin (0,0) to world coords
    const [tx, ty] = applyTransform4x4(0, 0, transform);

    const d = Math.sqrt((worldX - tx) ** 2 + (worldY - ty) ** 2);
    if (d < closestDist) {
      closestDist = d;
      closestIndex = i;
    }
  }

  return closestIndex;
}

/**
 * Returns the bounding box (in screen coordinates) that contains all media elements,
 * with their transforms applied (using imageTransforms).
 * @returns {{left: number, top: number, right: number, bottom: number}|null}
 */
function getBoundingBox(selector) {
  const mediaElement = select('#media')?.elt;
  if (!mediaElement) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (let i = 0; i < mediaElement.children.length; i++) {
    const transform = getImageTransformFromElement(mediaElement.children[i], true) || identityMatrix;
    if (!transform) continue;

    const image = mediaElement.children[i].querySelector(selector);
    if (!image) continue;

    const w = image.naturalWidth || image.width;
    const h = image.naturalHeight || image.height;

    // Corners in local image coordinates (top-left origin)
    const corners = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h]
    ];

    // Transform each corner and update bounds
    for (const [x, y] of corners) {
      const [tx, ty] = applyTransform4x4(x, y, transform);
      minX = Math.min(minX, tx);
      minY = Math.min(minY, ty);
      maxX = Math.max(maxX, tx);
      maxY = Math.max(maxY, ty);
    }
  }

  if (minX === Infinity) return null;

  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

function draw() {
  const imageSelector = '.original';
  background(220);
  mediaBoundingBox = getBoundingBox(imageSelector);

  //getClosestImageToMouse();

  const mediaElement = select('#media')?.elt;
  if(mediaElement) {
    push();
      applyMatrix(...getFramingMatrix3x2(mediaBoundingBox));
      for (let i = 0; i < mediaElement.children.length; i++) {
        const image = mediaElement.children[i].querySelector(imageSelector);
        if (image) {
          if(i == 0) translate(-image.width / 2, -image.height / 2);
          push();
            //tint(255, 127);
            if(i === closestImageIndex) tint(255, 255);
            else tint(255, 10);
            const zDepth = (i === closestImageIndex) ? 0 : -1;

            const t = getImageTransformFromElement(image, true);

            drawProjectedImage(image, 0, 0, t ? t :identityMatrix, zDepth);
          pop();
        }
      }
    pop();
  }
}

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

function keyPressed() {
  if (key === 'x' || key === 'X') {
    exportAllMediaElements('.original');
  }

  // Set closestImageIndex from number keys
  if (key >= '0' && key <= '9') {
    closestImageIndex = Number(key) - 1;
  }
}

/**
 * Creates as many fully transparent PNG image elements as there are media elements,
 * each with the dimensions of mediaBoundingBox, draws the corresponding media image into it
 * using its transform relative to the bounding box, and appends them to #export.
 */
function exportAllMediaElements(selector) {
  const mediaElement = select('#media')?.elt;
  const exportElement = select('#export')?.elt;
  if (!mediaElement || !exportElement || !mediaBoundingBox) {
    console.warn('Missing #media, #export, or mediaBoundingBox');
    return;
  }

  // Clear previous exports
  exportElement.innerHTML = '';

  const w = Math.round(mediaBoundingBox.width);
  const h = Math.round(mediaBoundingBox.height);

  for (let i = 0; i < mediaElement.children.length; i++) {
    // Create a canvas for export
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // Fill with fully transparent background
    ctx.clearRect(0, 0, w, h);

    // Draw the media image (e.g. .lowres) into the canvas, using its transform
    const img = mediaElement.children[i].querySelector(selector);
    const transform = getImageTransformFromElement(img, true);
    console.log(transform);
    if (img && transform) {
      const imgW = img.naturalWidth || img.width;
      const imgH = img.naturalHeight || img.height;

      // Use only the 2D affine part for drawImage
      const a = transform[0];
      const b = transform[1];
      const c = transform[4];
      const d = transform[5];
      const tx = transform[3] - mediaBoundingBox.left;
      const ty = transform[7] - mediaBoundingBox.top;

      ctx.save();
      ctx.setTransform(a, b, c, d, tx, ty);
      ctx.drawImage(img, 0, 0, imgW, imgH);
      ctx.restore();
    }

    // Create an image element from the canvas
    const outImg = document.createElement('img');
    outImg.src = canvas.toDataURL('image/png');
    outImg.width = w;
    outImg.height = h;
    outImg.style.width = w + "px";
    outImg.style.height = h + "px";

    exportElement.appendChild(outImg);
  }
}

/**
 * Returns a 3x2 affine matrix [a, b, d, e, tx, ty] that frames the bounding box within the canvas.
 * Suitable for p5.js applyMatrix(a, b, d, e, tx, ty).
 * @param {{left: number, top: number, width: number, height: number}} boundingBox
 * @returns {Array} - flat 6-element array [a, b, d, e, tx, ty]
 */
function getFramingMatrix3x2(boundingBox) {
  if (!boundingBox) return [1, 0, 0, 1, 0, 0];

  // Compute scale to fit bounding box into canvas
  const s = Math.min(width / boundingBox.width, height / boundingBox.height);

  // Compute translation to move bounding box's top-left to (0,0) after scaling
  const tx = -boundingBox.left * s;
  const ty = -boundingBox.top * s;

  // 2D scale + translate in 3x2 form: [a, b, d, e, tx, ty]
  // [ s, 0, 0 ]
  // [ 0, s, 0 ]
  // [ tx, ty, 1 ]
  return [s, 0, 0, s, tx, ty];
}

async function processAnyAttachedMedia() {
  const originals = selectAll('#media .original');
  // Wait for all images to load
  await Promise.all(originals.map(i => {
    return new Promise(resolve => {
      if (i.elt.complete) resolve();
      else {
        i.elt.onload = resolve;
        i.elt.onerror = resolve;
      }
    });
  }));

  // Process images sequentially using a numerical index
  for (let idx = 0; idx < originals.length; idx++) {
    const orig = originals[idx];
    setImageTransform(orig.elt, identityMatrix);
    await processImage(orig.elt, orig.parent());
    processHomography(orig.parent().id);
  }
}

async function processImage(originalImgElement, div) {
  // 1. Generate low-res image and wait for it to load
  const lowResImg = await generateLowResImageAsync(originalImgElement);
  lowResImg.parent(div);
  lowResImg.addClass('lowres');

  // 2. Generate mask and wait for it to load
  const maskImg = await generateMaskAsync(lowResImg.elt);
  maskImg.parent(div);
  maskImg.addClass('mask');

  // 3. Apply mask to get foreground and background, wait for both
  const [foregroundImg, backgroundImg] = await Promise.all([
    applyMaskToImageAsync(lowResImg.elt, maskImg.elt, false),
    applyMaskToImageAsync(lowResImg.elt, maskImg.elt, true)
  ]);
  foregroundImg.parent(div);
  foregroundImg.addClass('foreground');
  backgroundImg.parent(div);
  backgroundImg.addClass('background');
}

// Helper: Promise version of generateLowResImage
function generateLowResImageAsync(imgElement) {
  return new Promise(resolve => {
    const lowresImg = generateLowResImage(imgElement, () => resolve(lowresImg));
  });
}

// Helper: Promise version of generateMask
function generateMaskAsync(imgElement) {
  return new Promise(resolve => {
    const maskImg = generateMask(imgElement, () => resolve(maskImg));
  });
}

// Helper: Promise version of applyMaskToImage
function applyMaskToImageAsync(colorImg, maskImg, invert) {
  return new Promise(resolve => {
    const resultImg = applyMaskToImage(colorImg, maskImg, invert, () => resolve(resultImg));
  });
}

function setImageTransform(element, transform) {
  console.log('setImageTransform', element, transform);
  if (element && Array.isArray(transform)) {
    element.setAttribute('data-transform', JSON.stringify(transform));
  }
}

function getImageTransformFromElement(element, traverse = false) {
  let result = null;

  if (element){
    const b = traverse ? (getImageTransformFromElement(element.parentElement, false) || identityMatrix) : identityMatrix;
    try {
      result = JSON.parse(element.getAttribute('data-transform'));
    }
    catch (e) {
    }
    if(result) result = multiplyMatrix4x4(b, result);
  }

  return result;
}