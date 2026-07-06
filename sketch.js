const imageTransforms = [
  [1, 0, 0, 0,
   0, 1, 0, 0,
   0, 0, 1, 0,
   0, 0, 0, 1],
  [1, 0, 0, 100,
   0, 1, 0,   0,
   0, 0, 1,   0,
   0, 0, 0,   1]
];

function setup() {
  // Use WEBGL so texture()/vertex(u,v) in drawImageWithHomography works
  canvas = createCanvas(1600, 800, WEBGL);
  canvas.drop(onFileDropped);
  
  // ensure texture UVs use normalized coordinates
  textureMode(NORMAL);
}

function onFileDropped(file) {
  console.log("Dropped file: " + file.name);
  const div = upsertMedia(file.name);

  const img = createImg(file.data, '', () => {
    console.log('Image loaded:', file.name);
    console.log('Image dimensions:', img.width, 'x', img.height);

    img.parent(div);
    img.addClass('original');

    const lowresMaxPixels = 640 * 480;
    if (img.width * img.height > lowresMaxPixels) {
      const s = Math.sqrt(lowresMaxPixels / (img.width * img.height));

      const targetW = Math.round(img.width * s);
      const targetH = Math.round(img.height * s);

      console.log('lowResImg dimensions:', targetW, 'x', targetH);
      const g = createGraphics(targetW, targetH);
      g.image(img, 0, 0, targetW, targetH);
      const lowResDataUrl = g.elt.toDataURL("image/jpeg", 1.0);

      const lowResImg = createImg(lowResDataUrl, '', processImages);
      lowResImg.addClass('lowres');
      lowResImg.parent(div);
    }
    else {
      img.addClass('lowres');
      processImages();
    }
  });
}

function processImages() {
  const mediaElement = select('#media')?.elt;
  if(mediaElement) {
    const n = mediaElement.childElementCount;
    
    if(n === 2){
      console.log("Two images loaded, starting alignment...");
      Align_img(mediaElement.children[0].querySelector('.lowres') , mediaElement.children[1].querySelector('.lowres'));
      if(h && !h.empty() && h.data64F) {
        const d = h.data64F;
        //flat 4x4 row-major so
        imageTransforms[1] = [
          d[0], d[1], 0, d[2],
          d[3], d[4], 0, d[5],
          0   , 0   , 1, 0   ,
          d[6], d[7], 0, d[8]
        ];
      }
    }
  }
}

  // draw a textured quad: srcImg projected by homography Hproj into target image space (targetIndex)
  function drawProjectedImage(srcImg, x, y, Hproj) {
    if (!srcImg || !Hproj) return;
    const w = srcImg.width, h = srcImg.height;
    const corners = [0,0,w,0,w,h,0,h];
    // project corners into target image pixel coords (corners is a flat array [x0,y0,...])
    const dst = [];
    for (let i = 0; i < corners.length; i += 2) {
      const p = applyTransform4x4(corners[i], corners[i + 1], Hproj) || [0, 0];
      dst.push(p[0]+x, p[1]+y);
    }
    // draw textured polygon in WEBGL using normalized texture coords (0..1)
    push();
      try {
        const gl = drawingContext;
        if (gl && gl.disable) gl.disable(gl.DEPTH_TEST);
      } catch (e) {}
      noStroke();
      texture(srcImg);
      beginShape();
        // top-left (0,0) -> u=0,v=0 ; top-right -> u=1,v=0 ; bottom-right -> u=1,v=1 ; bottom-left -> u=0,v=1
        vertex(dst[0], dst[1], 0, 0);
        vertex(dst[2], dst[3], 1, 0);
        vertex(dst[4], dst[5], 1, 1);
        vertex(dst[6], dst[7], 0, 1);
      endShape(CLOSE);
      try {
        const gl = drawingContext;
        if (gl && gl.enable) gl.enable(gl.DEPTH_TEST);
      } catch (e) {}
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

function draw() {
  background(220);
  
  push();
    if(inputImageB) translate(-inputImageB.width / 2, -inputImageB.height / 2);
    if(inputImageA) {
      push();
        tint(255, 127);
        drawProjectedImage(inputImageA, 0, 0,  imageTransforms[1]);
      pop();
    }

    if(inputImageB) {
      push();
        tint(255, 127);
        drawProjectedImage(inputImageB, 0, 0, imageTransforms[0]);
      pop();
    }

    push();
      // draw matches overlay last so lines appear on top
      // keep this inside the same top-left transform so coordinates match the points/circles
      try {
        const gl = drawingContext;
        if (gl && gl.disable) gl.disable(gl.DEPTH_TEST);
      } catch (e) { }
      drawMatchesOverlay();
      try {
        const gl = drawingContext;
        if (gl && gl.enable) gl.enable(gl.DEPTH_TEST);
      } catch (e) {}
    // close the initial top-left transform
    pop();
  pop();
}

// applyTransform4x4 now lives in imgproc.js