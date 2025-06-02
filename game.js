console.log("🟢 game.js loaded at", new Date().toLocaleTimeString());

import * as THREE from "https://unpkg.com/three@0.158.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.158.0/examples/jsm/controls/OrbitControls.js";
import { Water } from "https://unpkg.com/three@0.158.0/examples/jsm/objects/Water.js";
import { RoundedBoxGeometry } from "https://unpkg.com/three@0.158.0/examples/jsm/geometries/RoundedBoxGeometry.js";
import Delaunator from "https://unpkg.com/delaunator@5.0.0?module";

// ───────────── Constants ─────────────
const BOARD_N         = 5,
      HALF            = BOARD_N / 2;
const WATER_SIZE      = 200, WATER_Y    = -0.01;
const SKY_COLOR       = 0x87CEEB, WATER_COLOR = 0x0066ff;
const DISK_RADIUS     = 1.5, DISK_HEIGHT = 0.2, DISK_Y = 0.1;
const FACTORY_COUNT   = 5, FACTORY_RADIUS = 6;
const BASE_TILE       = 0.8 / 4;         // 0.2
const TILE_SCALE      = 1.44 * 1.1;      // +10%
const TILE_SIZE       = BASE_TILE * TILE_SCALE; // ~0.317
const TILE_HALF       = TILE_SIZE / 2;
const TILE_HEIGHT     = 0.2;             // ← new: tile thickness
const TILE_Y_ON_DISK  = 0.3;
const BOARD_THICKNESS = 0.05;            // slight board thickness
const BOARD_TILE_Y    = BOARD_THICKNESS + TILE_HEIGHT/2; // 0.05 + 0.1 = 0.15
const DRAG_Y          = 0.5;


// ── 1) SCENE, CAMERA, RENDERER ─────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY_COLOR);

const camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 500);
camera.position.set(7, 7, 12);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputEncoding      = THREE.sRGBEncoding;
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled   = true;
renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ── 2) CONTROLS ───────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.minDistance   = 6;
controls.maxDistance   = 20;

// ── 3) LIGHTING ───────────────────────────────────
scene.add(new THREE.HemisphereLight(0xeeeeff, 0x444444, 0.6));
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(5, 10, 7);
dir.castShadow = true;
dir.shadow.mapSize.set(1024, 1024);
scene.add(dir);

// ── EXTRA LIGHT FOR STAINED-GLASS ──────────────────
const pointLight = new THREE.PointLight(0xffffff, 1.0, 50);
pointLight.position.set(0, 8, 10);
pointLight.castShadow = true;
scene.add(pointLight);

// ── CURSOR LIGHT ─────────────────────────────────
const cursorLight = new THREE.PointLight(0xffffff, 0.6, 8);
cursorLight.castShadow = false;
cursorLight.visible = true;
scene.add(cursorLight);

// (optional) a little overall ambient boost
scene.add(new THREE.AmbientLight(0xffffff, 0.15));


// ── 4) WATER ──────────────────────────────────────
const loader = new THREE.TextureLoader();
const waterNormals = loader.load(
  'https://threejs.org/examples/textures/waternormals.jpg',
  tex => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
);
const water = new Water(
  new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE),
  {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals,
    sunDirection: dir.position.clone().normalize(),
    sunColor: 0xffffff,
    waterColor: WATER_COLOR,
    distortionScale: 3.7,
    fog: scene.fog !== undefined
  }
);
water.rotation.x = -Math.PI / 2;
water.position.y = WATER_Y;
scene.add(water);

// ── 5) BOARD ───────────────────────────────────────
const boardTex  = loader.load("assets/azul_board.jpg", tex => tex.encoding = THREE.sRGBEncoding);
const boardGeom = new THREE.BoxGeometry(BOARD_N, BOARD_THICKNESS, BOARD_N);
const boardMat  = new THREE.MeshStandardMaterial({ map: boardTex, roughness: 1 });
const board     = new THREE.Mesh(boardGeom, boardMat);
board.position.y    = BOARD_THICKNESS / 2;
board.receiveShadow = true;
scene.add(board);

// ── 6) DISK FACTORIES ─────────────────────────────
const factories = [];
const diskTex    = loader.load("assets/azul_factory.jpg", tex => tex.encoding = THREE.sRGBEncoding);
const diskMat    = new THREE.MeshStandardMaterial({ map: diskTex, roughness: 1 });
for (let i = 0; i < FACTORY_COUNT; i++) {
  const ang = (i / FACTORY_COUNT) * Math.PI * 2;
  const x   = Math.cos(ang) * FACTORY_RADIUS;
  const z   = Math.sin(ang) * FACTORY_RADIUS;
  const f   = new THREE.Mesh(
    new THREE.CylinderGeometry(DISK_RADIUS, DISK_RADIUS, DISK_HEIGHT, 32),
    diskMat
  );
  f.position.set(x, DISK_Y, z);
  f.castShadow = f.receiveShadow = true;
  scene.add(f);
  factories.push(f);
}

// ── CHOCOLATE TEXTURES ────────────────────────────
// 1) original swirl
function generateChocolateTexture() {
  const size = 512;
  const c    = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4B2E18';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 30; i++) {
    ctx.strokeStyle = `rgba(90,60,40,${0.2 + Math.random() * 0.3})`;
    ctx.lineWidth   = 10 + Math.random() * 20;
    ctx.beginPath();
    const sx  = Math.random()*size, sy  = Math.random()*size;
    const cp1x= Math.random()*size, cp1y= Math.random()*size;
    const cp2x= Math.random()*size, cp2y= Math.random()*size;
    const ex  = Math.random()*size, ey  = Math.random()*size;
    ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}

// 2) speckled: swirl + little colored dots
function generateChocolateSpeckTexture() {
  const tex = generateChocolateTexture();
  const size = tex.image.width;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.drawImage(tex.image, 0, 0);
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = `rgba(${200+Math.random()*55},${50+Math.random()*30},${50+Math.random()*30},1)`;
    ctx.beginPath();
    const x = Math.random()*size, y = Math.random()*size, r = 2 + Math.random()*3;
    ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 3) noise base
function generateChocolateNoiseTexture() {
  const size = 512;
  const c    = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 100 + Math.random()*30;
    img.data[i] = v;
    img.data[i+1] = v*0.8;
    img.data[i+2] = v*0.6;
    img.data[i+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 4) dual-tone gradient + swirl
function generateChocolateDualToneTexture() {
  const size = 512;
  const c    = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#6B4226');
  grad.addColorStop(1, '#9B6B3A');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  // dark swirl on top
  ctx.strokeStyle = 'rgba(60,30,20,0.4)';
  ctx.lineWidth = 8;
  for (let i = 0; i < 20; i++) {
    ctx.beginPath();
    const sx = Math.random()*size, sy = Math.random()*size;
    const cp1x = Math.random()*size, cp1y = Math.random()*size;
    const cp2x = Math.random()*size, cp2y = Math.random()*size;
    const ex = Math.random()*size, ey = Math.random()*size;
    ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 5) sprinkles: colored lines
function generateChocolateSprinkleTexture() {
  const size = 512;
  const c    = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4B2E18';
  ctx.fillRect(0, 0, size, size);
  const colors = ['#FFCC00','#FF6699','#66CCFF','#CC66FF'];
  for (let i = 0; i < 300; i++) {
    ctx.strokeStyle = colors[Math.floor(Math.random()*colors.length)];
    ctx.lineWidth = 1 + Math.random()*3;
    ctx.beginPath();
    const x1 = Math.random()*size, y1 = Math.random()*size;
    const angle = Math.random()*Math.PI*2;
    const x2 = x1 + Math.cos(angle)*5, y2 = y1 + Math.sin(angle)*5;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const chocolateTextures = [
  generateChocolateTexture(),
  generateChocolateSpeckTexture(),
  generateChocolateNoiseTexture(),
  generateChocolateDualToneTexture(),
  generateChocolateSprinkleTexture()
];

// ── 8) TWO-TONE TRIANGULAR MOSAIC (stained-glass) ───────────

// helper: build a two-color Delaunay mosaic texture
function generateTwoToneMosaic(color1, color2, pointCount = 40, size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // random points + border
  const pts = [];
  for (let i = 0; i < pointCount; i++) {
    pts.push([Math.random() * size, Math.random() * size]);
  }
  pts.push([0,0], [size,0], [size,size], [0,size]);

  // triangulate
  const d = Delaunator.from(pts);
  for (let i = 0; i < d.triangles.length; i += 3) {
    const p0 = pts[d.triangles[i]];
    const p1 = pts[d.triangles[i+1]];
    const p2 = pts[d.triangles[i+2]];

    // pick one of the two colors
    ctx.fillStyle = Math.random() < 0.5 ? color1 : color2;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.closePath();
    ctx.fill();

    // optional: thin border
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// define your four two-tone palettes
const stainedColorCombos = [
  ['#ff69b4', '#00ff00'], // pink & green
  ['#0000ff', '#ffff00'], // blue & yellow
  ['#ffa500', '#000000'], // orange & black
  ['#800080', '#ffffff']  // purple & white
];

// single box geometry for all
const stainedGeom = new THREE.BoxGeometry(TILE_SIZE, 0.2, TILE_SIZE);

// build the variants
const stainedVariants = stainedColorCombos.map(([c1, c2]) => ({
  geom: stainedGeom,
  tex:  generateTwoToneMosaic(c1, c2, 60, 512)
}));


// simple image tiles
const tileTextures = [];
for (let i = 1; i <= 5; i++) {
  const t = loader.load(`assets/tile${i}.jpg`, tx => tx.encoding = THREE.sRGBEncoding);
  tileTextures.push(t);
}

// ── 9) SPAWN 4 TILES PER FACTORY ───────────────────
const tiles = [];
factories.forEach(factory => {
  for (let i = 0; i < 4; i++) {
    const r = Math.random();
    let mat, geom;

    if (r < 0.25) {
      // stained-glass
      const v = stainedVariants[Math.floor(Math.random()*stainedVariants.length)];
      geom = v.geom;
      mat  = new THREE.MeshPhysicalMaterial({
        map:            v.tex,
        // ★ add these three lines ★
        emissive:       new THREE.Color(0xffffff),
        emissiveMap:    v.tex,
        emissiveIntensity: 0.6,
        roughness:      0.3,
        metalness:      0,
        transmission:   1,
        thickness:      0.5,
        opacity:        0.8,
        transparent:    true
      });
    }
     else if (r < 0.75) {
      // image‐tile
      geom = new THREE.BoxGeometry(TILE_SIZE, TILE_HEIGHT, TILE_SIZE);
      mat  = new THREE.MeshStandardMaterial({
        map:       tileTextures[Math.floor(Math.random()*tileTextures.length)],
        roughness: 0.3,
        metalness: 0
      });
    } else {
      // chocolate
      geom = new RoundedBoxGeometry(TILE_SIZE, TILE_HEIGHT, TILE_SIZE, 4, 0.05);
      mat  = new THREE.MeshStandardMaterial({
        map:       chocolateTextures[Math.floor(Math.random()*chocolateTextures.length)],
        roughness: 0.2,
        metalness: 0
      });
    }

    const tile = new THREE.Mesh(geom, mat);
    tile.castShadow = tile.receiveShadow = true;

    // soft point-light at tile’s center
    const glow = new THREE.PointLight(0xffffff, 0.1, TILE_SIZE * 3);
    glow.position.set(0, 0, 0);
    tile.add(glow);


    // find non‐overlapping spawn on this factory
    let pos;
    for (let attempt = 0; attempt < 20; attempt++) {
      const ang = Math.random()*Math.PI*2;
      const rad = Math.random()*(DISK_RADIUS - TILE_HALF - 0.05);
      const x   = factory.position.x + Math.cos(ang)*rad;
      const z   = factory.position.z + Math.sin(ang)*rad;
      let bad   = false;
      for (const t of tiles) {
        if (Math.abs(x - t.position.x) < TILE_SIZE && Math.abs(z - t.position.z) < TILE_SIZE) {
          bad = true; break;
        }
      }
      if (!bad) { pos = {x,z}; break; }
      if (attempt === 19) pos = { x: factory.position.x, z: factory.position.z };
    }

    tile.position.set(pos.x, TILE_Y_ON_DISK, pos.z);
    scene.add(tile);
    tiles.push(tile);
  }
});

// ── 10) DRAG & DROP + COLLISION + FACTORY DROP ─────
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();
let selected    = null, offsetX = 0, offsetZ = 0;

renderer.domElement.addEventListener("mousemove", e => {
  mouse.x = (e.clientX / innerWidth)  * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  // ── cursor light follows pointer when not dragging ──
  if (!selected) {
    raycaster.setFromCamera(mouse, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0,1,0), -DRAG_Y);
    const pt    = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, pt);
    cursorLight.position.set(pt.x, pt.y + 1, pt.z);
    cursorLight.visible = true;
  } else {
    cursorLight.visible = false;
  }

  if (selected) {
    raycaster.setFromCamera(mouse, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0,1,0), -DRAG_Y);
    const pt    = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, pt);
    const nx = pt.x - offsetX, nz = pt.z - offsetZ;
    let collide = false;
    for (const t of tiles) {
      if (t !== selected && Math.abs(nx - t.position.x) < TILE_SIZE && Math.abs(nz - t.position.z) < TILE_SIZE) {
        collide = true; break;
      }
    }
    if (!collide) selected.position.set(nx, DRAG_Y, nz);
  }
});

renderer.domElement.addEventListener("mousedown", () => {
  cursorLight.visible = false;

  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObjects(tiles)[0];
  if (hit) {
    selected = hit.object;
    selected.userData.prevPos = selected.position.clone();
    controls.enabled = false;
    offsetX = hit.point.x - selected.position.x;
    offsetZ = hit.point.z - selected.position.z;
    selected.position.y = DRAG_Y;
  }
});


renderer.domElement.addEventListener("mousedown", () => {
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObjects(tiles)[0];
  if (hit) {
    selected = hit.object;
    selected.userData.prevPos = selected.position.clone();
    controls.enabled = false;
    offsetX = hit.point.x - selected.position.x;
    offsetZ = hit.point.z - selected.position.z;
    selected.position.y = DRAG_Y;
  }
});

renderer.domElement.addEventListener("mouseup", () => {
  cursorLight.visible = true;
  if (!selected) return;

  controls.enabled = true;
  raycaster.setFromCamera(mouse, camera);

  // only test against factories & board
  const dropHits = raycaster.intersectObjects([...factories, board]);
  let finalX, finalZ, finalY;

  if (dropHits.length > 0) {
    const hit = dropHits[0];
    finalX = hit.point.x;
    finalZ = hit.point.z;
    finalY = factories.includes(hit.object)
             ? TILE_Y_ON_DISK
             : BOARD_TILE_Y;
  } else {
    // if nothing hit, snap back
    selected.position.copy(selected.userData.prevPos);
    selected = null;
    return;
  }

  // collision check
  const collided = tiles.some(t => 
    t !== selected &&
    Math.abs(finalX - t.position.x) < TILE_SIZE &&
    Math.abs(finalZ - t.position.z) < TILE_SIZE
  );

  if (collided) {
    selected.position.copy(selected.userData.prevPos);
  } else {
    selected.position.set(finalX, finalY, finalZ);
  }

  selected = null;
});

// ── 11) HOVER & ANIMATE ───────────────────────────
function hover() {
  if (selected) return;
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObjects(tiles)[0];
  tiles.forEach(t => t.scale.set(1,1,1));
  if (hit) hit.object.scale.set(1.2,1.2,1.2);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  hover();
  water.material.uniforms['time'].value += 1/60;
  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
});
