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
      applyMatrix(result.transform);
      noFill();
      strokeWeight(3);
      stroke('green');
      rect(0, 0, box.width, box.height);
    }
  pop();
}