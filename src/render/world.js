// The 3D table: boards, factories, tiles, water, lights, picking and the
// animations that move tiles between engine states. The world never changes
// game state; it only mirrors the state it is given.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { WALL_SIZE, FLOOR_PENALTIES, wallColumnFor } from '../engine/constants.js';
import { isFirstPlayerToken, FLOOR_ROW } from '../engine/game.js';
import { BOARD_W, BOARD_H, CELL, layout, paintBoard } from './boardTexture.js';
import { tween, tweenVector, updateTweens, Easing, wait } from './tween.js';
import { makeRng } from '../engine/rng.js';

export const PLAYER_ACCENTS = ['#2a7de1', '#e1562a', '#2ab06b', '#9b4de1'];

const BOARD_T = 0.12;
const BOARD_DIST = 10.8;
const FACTORY_R = 5.2;
const DISK_RADIUS = 1.5;
const DISK_H = 0.18;
const TILE_W = 0.6;
const TILE_H = 0.14;
const SKY = 0x9fc9e6;
const HIGHLIGHT = {
  valid: 0x4ade80,
  hover: 0x22c55e,
  invalid: 0xef4444,
  floor: 0xf59e0b,
  target: 0x60a5fa,
  pick: 0xfde047,
};

const CAMERA = { dist: 22, height: 17.5, targetDist: 5.4, fov: 44 };

function playerAngle(index, count) {
  return Math.PI / 2 + (index * Math.PI * 2) / count;
}

// ---------------------------------------------------------------------------
// Water + sky shaders

const waterMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x0e4f80) },
        uShallow: { value: new THREE.Color(0x3aa0c9) },
        uSun: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      },
    ]),
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorld = worldPosition.xyz;
        vec4 mvPosition = viewMatrix * worldPosition;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uSun;
      varying vec3 vWorld;
      float wave(vec2 p, float t) {
        return sin(p.x * 1.1 + t) * sin(p.y * 1.4 - t * 1.3) * 0.5
             + sin((p.x + p.y) * 2.2 + t * 1.7) * 0.25
             + sin((p.x - p.y) * 3.1 - t * 0.9) * 0.25
             + sin(p.x * 5.3 - t * 2.1) * sin(p.y * 4.1 + t * 1.6) * 0.12;
      }
      // Thin, wandering light lines (sum of two rotated ridge patterns).
      float ridges(vec2 p, float t) {
        float a = abs(sin(p.x * 2.7 + sin(p.y * 1.9 + t) * 1.5 + t * 0.7));
        float b = abs(sin((p.x * 0.6 + p.y * 0.8) * 2.3 + sin(p.x * 1.3 - t * 0.8) * 1.4 - t * 0.5));
        return pow(1.0 - min(a, b), 6.0);
      }
      void main() {
        vec2 p = vWorld.xz * 0.35;
        float t = uTime * 0.6;
        float h = wave(p, t);
        float e = 0.01;
        vec3 n = normalize(vec3(wave(p + vec2(e, 0.0), t) - h, 0.2, wave(p + vec2(0.0, e), t) - h));
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
        vec3 col = mix(uDeep, uShallow, h * 0.5 + 0.5);
        col = mix(col, vec3(0.75, 0.9, 1.0), fresnel * 0.55);
        col += vec3(0.45, 0.6, 0.7) * ridges(p * 0.9, t) * 0.09;
        vec3 halfway = normalize(uSun + viewDir);
        float spec = pow(max(dot(n, halfway), 0.0), 90.0);
        col += vec3(1.0) * spec * 0.6;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
    fog: true,
  });

const skyMaterial = () =>
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x4a8fd0) },
      uHorizon: { value: new THREE.Color(0xd8ecf7) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y;
        float t = smoothstep(-0.1, 0.6, h);
        gl_FragColor = vec4(mix(uHorizon, uTop, t), 1.0);
      }`,
  });

// ---------------------------------------------------------------------------

export class World {
  constructor(container, popupLayer) {
    this.container = container;
    this.popupLayer = popupLayer;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 38, 95);

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 400);
    this.camera.position.set(0, CAMERA.height, CAMERA.dist);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 45;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.target.set(0, 0, CAMERA.targetDist);
    this.controls.enablePan = false;

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.setupLights();
    this.setupEnvironment();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-10, -10);
    this.clock = new THREE.Clock();

    this.boards = [];
    this.factories = [];
    this.tiles = new Map(); // id -> mesh
    this.hidden = new Set();
    this.popups = [];
    this.selected = new Set();
    this.hovered = new Set();
    this.idle = true;
    this.state = null;
    this.tileSet = null;

    this.tileGeometry = null;
    this.tokenMesh = null;
    this.content = new THREE.Group();
    this.scene.add(this.content);

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // -------------------------------------------------------------------------
  // Static scene

  setupLights() {
    this.scene.add(new THREE.HemisphereLight(0xdcefff, 0x3b5b7a, 0.75));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.9);
    sun.position.set(12, 24, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.camera.near = 5;
    sun.shadow.camera.far = 60;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbfdfff, 0.5);
    fill.position.set(-10, 10, -8);
    this.scene.add(fill);
  }

  setupEnvironment() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), skyMaterial());
    this.scene.add(sky);

    this.water = new THREE.Mesh(new THREE.PlaneGeometry(260, 260, 1, 1), waterMaterial());
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = -0.08;
    this.scene.add(this.water);

    // A soft shadow-catching mat so boards and factories feel anchored.
    const mat = new THREE.Mesh(
      new THREE.CircleGeometry(16, 64),
      new THREE.ShadowMaterial({ opacity: 0.22 }),
    );
    mat.rotation.x = -Math.PI / 2;
    mat.position.y = -0.03;
    mat.receiveShadow = true;
    this.scene.add(mat);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Keep the whole table in view on narrow screens by widening the FOV.
    this.camera.fov = w / h < 1 ? CAMERA.fov + (1 - w / h) * 40 : CAMERA.fov;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  // Game setup

  reset() {
    this.content.traverse((obj) => {
      if (obj.geometry && obj !== this.content) obj.geometry.dispose?.();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          m.map?.dispose?.();
          m.dispose?.();
        }
      }
    });
    this.scene.remove(this.content);
    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.boards = [];
    this.factories = [];
    this.tiles.clear();
    this.hidden.clear();
    this.selected.clear();
    this.hovered.clear();
    this.tokenMesh = null;
  }

  /** Build every mesh for a fresh game. `tileSet` comes from buildTileSet(). */
  async setup(state, tileSet, { factoryTexture } = {}) {
    this.reset();
    this.state = state;
    this.tileSet = tileSet;
    const n = state.players.length;

    this.tileGeometry = new RoundedBoxGeometry(TILE_W, TILE_H, TILE_W, 3, tileSet.style.rounded ?? 0.05);
    this.tileTextures = tileSet.canvases.map((c) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      return t;
    });

    state.players.forEach((player, i) => this.buildBoard(player, i, n));
    this.buildFactories(state.factories.length, factoryTexture);
    this.buildCenterMat();

    const all = [...state.bag, ...state.lid, ...state.center, ...state.factories.flat()];
    for (const p of state.players) {
      all.push(...p.floor.filter((t) => !isFirstPlayerToken(t)), ...p.lines.flat());
      for (const row of p.wall) for (const t of row) if (t) all.push(t);
    }
    for (const tile of all) this.buildTile(tile);
    this.buildToken();

    // Tiles stay hidden until the first sync(), so the caller can choose to
    // animate them rising onto the factories.
    this.focusPlayer(0, false);
    this.idle = false;
  }

  buildBoard(player, index, count) {
    const group = new THREE.Group();
    const angle = playerAngle(index, count);
    group.position.set(Math.cos(angle) * BOARD_DIST, 0, Math.sin(angle) * BOARD_DIST);
    group.rotation.y = Math.PI / 2 - angle;

    const canvas = document.createElement('canvas');
    paintBoard(canvas, {
      tileCanvases: this.tileSet.canvases,
      name: player.name,
      accent: PLAYER_ACCENTS[index % PLAYER_ACCENTS.length],
      rng: makeRng(`board-${index}`),
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const side = new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.8 });
    const top = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.75, metalness: 0 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W, BOARD_T, BOARD_H), [side, side, top, side, side, side]);
    mesh.position.y = BOARD_T / 2;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);

    const cells = { pattern: [], wall: [], floor: [], rows: [], floorTarget: null };
    const planeGeo = new THREE.PlaneGeometry(CELL, CELL);
    const makeCell = (rect, color) => {
      const m = new THREE.Mesh(
        planeGeo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }),
      );
      m.rotation.x = -Math.PI / 2;
      const c = layout.center(rect);
      m.position.set(c.x - BOARD_W / 2, BOARD_T + 0.004, c.y - BOARD_H / 2);
      group.add(m);
      return m;
    };
    for (let row = 0; row < WALL_SIZE; row++) {
      cells.pattern.push(Array.from({ length: row + 1 }, (_, k) => makeCell(layout.patternCell(row, k), HIGHLIGHT.valid)));
      cells.wall.push(Array.from({ length: WALL_SIZE }, (_, col) => makeCell(layout.wallCell(row, col), HIGHLIGHT.target)));
    }
    for (let i = 0; i < FLOOR_PENALTIES.length; i++) cells.floor.push(makeCell(layout.floorCell(i), HIGHLIGHT.floor));

    // Invisible hit targets: one per row band plus the floor band.
    const makeTarget = (rect, data) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(rect.w, rect.h),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      m.rotation.x = -Math.PI / 2;
      const c = layout.center(rect);
      m.position.set(c.x - BOARD_W / 2, BOARD_T + 0.002, c.y - BOARD_H / 2);
      m.userData = data;
      group.add(m);
      return m;
    };
    for (let row = 0; row < WALL_SIZE; row++) cells.rows.push(makeTarget(layout.rowBand(row), { kind: 'row', row, player: index }));
    cells.floorTarget = makeTarget(layout.floorBand(), { kind: 'row', row: FLOOR_ROW, player: index });

    // Score marker.
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.15, 0.12, 24),
      new THREE.MeshStandardMaterial({ color: PLAYER_ACCENTS[index % PLAYER_ACCENTS.length], roughness: 0.3, metalness: 0.1 }),
    );
    marker.castShadow = true;
    group.add(marker);

    const board = { group, mesh, cells, marker, index, angle, score: player.score };
    this.placeMarker(board, player.score);
    this.boards.push(board);
    this.content.add(group);
  }

  buildFactories(count, factoryTexture) {
    const texture = factoryTexture ? new THREE.TextureLoader().load(factoryTexture) : null;
    if (texture) texture.colorSpace = THREE.SRGBColorSpace;
    const topMat = new THREE.MeshStandardMaterial({ map: texture, color: texture ? 0xffffff : 0xe8dcc0, roughness: 0.7 });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0xb8702a, roughness: 0.6 });
    const geo = new THREE.CylinderGeometry(DISK_RADIUS, DISK_RADIUS, DISK_H, 48);
    for (let k = 0; k < count; k++) {
      const angle = Math.PI / 2 + ((k + 0.3) * Math.PI * 2) / count;
      const mesh = new THREE.Mesh(geo, [sideMat, topMat, sideMat]);
      mesh.position.set(Math.cos(angle) * FACTORY_R, DISK_H / 2, Math.sin(angle) * FACTORY_R);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { kind: 'factory', index: k };
      this.content.add(mesh);
      this.factories.push(mesh);
    }
  }

  buildCenterMat() {
    const mat = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 64),
      new THREE.MeshStandardMaterial({ color: 0x0b2238, roughness: 0.95, transparent: true, opacity: 0.35 }),
    );
    mat.rotation.x = -Math.PI / 2;
    mat.position.y = 0.01;
    mat.receiveShadow = true;
    this.content.add(mat);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.12, 3.2, 64),
      new THREE.MeshBasicMaterial({ color: 0xe0c48a, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    this.content.add(ring);
  }

  buildTile(tile) {
    const style = this.tileSet.style;
    const map = this.tileTextures[tile.color];
    const params = {
      map,
      roughness: style.roughness ?? 0.4,
      metalness: style.metalness ?? 0,
      clearcoat: style.clearcoat ?? 0,
      clearcoatRoughness: 0.25,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: style.emissive ? map : null,
      emissiveIntensity: style.emissive ?? 0,
    };
    if (!style.emissive) params.emissive = new THREE.Color(0x000000);
    if (style.opacity && style.opacity < 1) {
      params.transparent = true;
      params.opacity = style.opacity;
    }
    const mesh = new THREE.Mesh(this.tileGeometry, new THREE.MeshPhysicalMaterial(params));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { kind: 'tile', id: tile.id, color: tile.color };
    mesh.visible = false;
    this.hidden.add(tile.id);
    this.content.add(mesh);
    this.tiles.set(tile.id, mesh);
    return mesh;
  }

  buildToken() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f4e9d2';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#8c7b5a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#2f3a4a';
    ctx.font = 'bold 72px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('1', 64, 68);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const side = new THREE.MeshStandardMaterial({ color: 0xe6d8bc, roughness: 0.6 });
    const top = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 32), [side, top, side]);
    mesh.castShadow = true;
    mesh.userData = { kind: 'token' };
    this.content.add(mesh);
    this.tokenMesh = mesh;
  }

  // -------------------------------------------------------------------------
  // Coordinates

  boardLocal(board, rect, lift = 0) {
    const c = layout.center(rect);
    return new THREE.Vector3(c.x - BOARD_W / 2, BOARD_T + TILE_H / 2 + lift, c.y - BOARD_H / 2);
  }

  boardWorld(board, rect, lift = 0) {
    return board.group.localToWorld(this.boardLocal(board, rect, lift));
  }

  factoryTilePosition(index, slot) {
    const f = this.factories[index].position;
    const dx = (slot % 2) * 0.78 - 0.39;
    const dz = Math.floor(slot / 2) * 0.78 - 0.39;
    return new THREE.Vector3(f.x + dx, DISK_H + TILE_H / 2, f.z + dz);
  }

  centerTilePosition(color, j) {
    const x = (color - 2) * 1.35 + ((j % 2) - 0.5) * 0.66;
    const z = -1.9 + Math.floor(j / 2) * 0.66;
    return new THREE.Vector3(x, TILE_H / 2 + 0.01, z);
  }

  placeMarker(board, score) {
    const rect = layout.scoreCell(score);
    const p = this.boardLocal(board, rect, 0.0);
    board.marker.position.set(p.x, BOARD_T + 0.06, p.z);
    board.score = score;
  }

  /** Compute where every tile should be for the given state. */
  computeTargets(state) {
    const targets = new Map();
    let token = null;
    state.factories.forEach((factory, i) => {
      factory.forEach((tile, slot) => targets.set(tile.id, { pos: this.factoryTilePosition(i, slot), rot: 0 }));
    });
    const perColor = [0, 0, 0, 0, 0];
    const sortedCenter = [...state.center].sort((a, b) => a.color - b.color || a.id - b.id);
    for (const tile of sortedCenter) {
      targets.set(tile.id, { pos: this.centerTilePosition(tile.color, perColor[tile.color]++), rot: 0 });
    }
    if (state.centerHasFirstPlayer) token = { pos: new THREE.Vector3(0, 0.05, -2.9), rot: 0 };

    state.players.forEach((player, p) => {
      const board = this.boards[p];
      player.lines.forEach((line, row) => {
        line.forEach((tile, k) => targets.set(tile.id, { pos: this.boardWorld(board, layout.patternCell(row, k)), rot: board.group.rotation.y }));
      });
      player.wall.forEach((rowTiles, row) => {
        rowTiles.forEach((tile, col) => {
          if (tile) targets.set(tile.id, { pos: this.boardWorld(board, layout.wallCell(row, col)), rot: board.group.rotation.y });
        });
      });
      player.floor.forEach((tile, i) => {
        const rect = layout.floorCell(Math.min(i, FLOOR_PENALTIES.length - 1));
        const stack = Math.max(0, i - (FLOOR_PENALTIES.length - 1)) * TILE_H;
        const t = { pos: this.boardWorld(board, rect, stack), rot: board.group.rotation.y };
        if (isFirstPlayerToken(tile)) token = t;
        else targets.set(tile.id, t);
      });
    });
    return { targets, token };
  }

  // -------------------------------------------------------------------------
  // Sync & animation

  /**
   * Move every tile mesh to where the state says it should be. Returns a
   * promise that resolves when the animation finishes.
   */
  sync(state, { animate = true, stagger = 25, duration = 550, arc = 0.9 } = {}) {
    this.state = state;
    const { targets, token } = this.computeTargets(state);
    const promises = [];
    let i = 0;
    for (const [id, mesh] of this.tiles) {
      const target = targets.get(id);
      const wasHidden = this.hidden.has(id);
      if (!target) {
        if (!wasHidden) {
          this.hidden.add(id);
          if (animate) {
            promises.push(
              tween({
                duration: 350,
                onUpdate: (t) => {
                  mesh.scale.setScalar(1 - t);
                  mesh.position.y -= 0.01;
                },
                onComplete: () => {
                  mesh.visible = false;
                  mesh.scale.setScalar(1);
                },
              }),
            );
          } else {
            mesh.visible = false;
          }
        }
        continue;
      }
      const moved = mesh.position.distanceTo(target.pos) > 0.001 || wasHidden;
      if (!moved) continue;
      if (wasHidden) {
        this.hidden.delete(id);
        mesh.visible = true;
        if (animate) {
          mesh.position.copy(target.pos).add(new THREE.Vector3(0, -1.2, 0));
          mesh.scale.setScalar(0.01);
          mesh.rotation.y = target.rot;
          promises.push(
            tween({
              duration: 450,
              delay: i++ * stagger,
              easing: Easing.outBack,
              onUpdate: (t) => {
                mesh.scale.setScalar(0.01 + 0.99 * t);
                mesh.position.y = target.pos.y - 1.2 * (1 - t);
              },
              onComplete: () => mesh.position.copy(target.pos),
            }),
          );
        } else {
          mesh.position.copy(target.pos);
          mesh.rotation.y = target.rot;
          mesh.scale.setScalar(1);
        }
        continue;
      }
      if (animate) {
        const fromRot = mesh.rotation.y;
        promises.push(
          tweenVector(mesh.position, target.pos, {
            duration,
            delay: i++ * stagger,
            arc,
            easing: Easing.inOutCubic,
            onUpdate: (t) => {
              mesh.rotation.y = fromRot + (target.rot - fromRot) * t;
            },
          }),
        );
      } else {
        mesh.position.copy(target.pos);
        mesh.rotation.y = target.rot;
      }
    }
    // First-player token.
    if (this.tokenMesh) {
      if (token) {
        this.tokenMesh.visible = true;
        if (animate && this.tokenMesh.position.distanceTo(token.pos) > 0.001) {
          promises.push(tweenVector(this.tokenMesh.position, token.pos, { duration, arc, easing: Easing.inOutCubic }));
        } else {
          this.tokenMesh.position.copy(token.pos);
        }
      } else {
        this.tokenMesh.visible = false;
      }
    }
    return Promise.all(promises);
  }

  /** Fly the taken tiles (and the leftovers pushed to the center) home. */
  async animateMove(stateAfter, result) {
    this.clearHighlights();
    this.releaseGlow();
    await this.sync(stateAfter, { animate: true, stagger: 45 });
    this.flashTargets(result);
  }

  /** Drop hover/selection glow without moving tiles (they are about to fly). */
  releaseGlow() {
    for (const id of [...this.selected, ...this.hovered]) {
      const mesh = this.tiles.get(id);
      if (!mesh) continue;
      const base = this.tileSet.style.emissive ?? 0;
      mesh.material.emissiveIntensity = base;
      if (!this.tileSet.style.emissive) mesh.material.emissive.set(0x000000);
      mesh.rotation.y = 0;
    }
    this.selected.clear();
    this.hovered.clear();
  }

  flashTargets(result) {
    const board = this.boards[result.player];
    const cells = [];
    if (result.move.row !== FLOOR_ROW) {
      const line = this.state.players[result.player].lines[result.move.row];
      for (let k = 0; k < line.length; k++) cells.push(board.cells.pattern[result.move.row][k]);
    }
    const floorNow = this.state.players[result.player].floor.length;
    const floorBefore = floorNow - result.toFloor.length;
    for (let i = floorBefore; i < Math.min(floorNow, FLOOR_PENALTIES.length); i++) cells.push(board.cells.floor[i]);
    for (const cell of cells) {
      cell.material.color.set(HIGHLIGHT.valid);
      tween({
        duration: 700,
        onUpdate: (t) => {
          cell.material.opacity = 0.6 * (1 - t);
        },
      });
    }
  }

  /** Animate one wall-tiling event: tile flies to the wall, leftovers vanish. */
  async animateWallEvent(event) {
    const board = this.boards[event.player];
    const mesh = this.tiles.get(event.tile.id);
    const target = this.boardWorld(board, layout.wallCell(event.row, event.col));
    const cell = board.cells.wall[event.row][event.col];
    cell.material.color.set(HIGHLIGHT.target);
    tween({ duration: 500, onUpdate: (t) => (cell.material.opacity = 0.7 * (1 - t)) });
    await tweenVector(mesh.position, target, { duration: 500, arc: 0.6, easing: Easing.inOutCubic });
    for (const t of event.discarded) {
      const m = this.tiles.get(t.id);
      this.hidden.add(t.id);
      tween({
        duration: 320,
        onUpdate: (k) => {
          m.scale.setScalar(1 - k);
          m.position.y -= 0.01;
        },
        onComplete: () => {
          m.visible = false;
          m.scale.setScalar(1);
        },
      });
    }
    this.popup(target, `+${event.points}`, 'good');
    await this.moveScore(event.player, event.score);
  }

  async animateFloorEvent(event) {
    const board = this.boards[event.player];
    const ids = event.tiles.map((t) => t.id);
    const first = this.boardWorld(board, layout.floorCell(0), 0.3);
    for (const id of ids) {
      const m = this.tiles.get(id);
      this.hidden.add(id);
      tween({
        duration: 380,
        onUpdate: (k) => {
          m.scale.setScalar(1 - k);
          m.position.y -= 0.012;
        },
        onComplete: () => {
          m.visible = false;
          m.scale.setScalar(1);
        },
      });
    }
    if (event.hadToken && this.tokenMesh) this.tokenMesh.visible = false;
    if (event.applied !== 0) this.popup(first, `${event.applied}`, 'bad');
    await wait(250);
    await this.moveScore(event.player, event.score);
  }

  async animateBonusEvent(event) {
    const board = this.boards[event.player];
    const pos = this.boardWorld(board, layout.scoreCell(Math.min(100, event.score)), 0.3);
    if (event.total > 0) this.popup(pos, `+${event.total} bonus`, 'good');
    await this.moveScore(event.player, event.score);
  }

  /** Slide a player's marker along the track cell by cell. */
  moveScore(playerIndex, score) {
    const board = this.boards[playerIndex];
    const from = board.score;
    const to = Math.max(0, Math.min(100, score));
    if (from === to) return Promise.resolve();
    const step = to > from ? 1 : -1;
    const cells = [];
    for (let s = from + step; s !== to + step; s += step) cells.push(this.boardLocal(board, layout.scoreCell(s)));
    const start = board.marker.position.clone();
    const total = Math.min(900, 70 * cells.length);
    return tween({
      duration: total,
      easing: Easing.inOutCubic,
      onUpdate: (t) => {
        const f = t * cells.length;
        const i = Math.min(cells.length - 1, Math.floor(f));
        const frac = f - i;
        const a = i === 0 ? start : cells[i - 1];
        const b = cells[i];
        board.marker.position.x = a.x + (b.x - a.x) * frac;
        board.marker.position.z = a.z + (b.z - a.z) * frac;
        board.marker.position.y = BOARD_T + 0.06 + Math.sin(frac * Math.PI) * 0.12;
      },
      onComplete: () => this.placeMarker(board, to),
    });
  }

  // -------------------------------------------------------------------------
  // Highlights

  tileIdsFor(source, index, color) {
    const pool = source === 'factory' ? this.state.factories[index] : this.state.center;
    return pool.filter((t) => t.color === color).map((t) => t.id);
  }

  setHover(ids) {
    const next = new Set(ids);
    for (const id of this.hovered) {
      if (!next.has(id) && !this.selected.has(id)) this.setTileGlow(id, 0, 0);
    }
    for (const id of next) if (!this.selected.has(id)) this.setTileGlow(id, 0.12, 0.35);
    this.hovered = next;
  }

  setSelection(ids) {
    const next = new Set(ids);
    for (const id of this.selected) if (!next.has(id)) this.setTileGlow(id, 0, 0);
    for (const id of next) this.setTileGlow(id, 0.42, 0.55);
    this.selected = next;
  }

  setTileGlow(id, lift, glow) {
    const mesh = this.tiles.get(id);
    if (!mesh) return;
    const { targets } = this.computeTargets(this.state);
    const target = targets.get(id);
    if (!target) return;
    mesh.userData.glow = glow;
    const base = this.tileSet.style.emissive ?? 0;
    mesh.material.emissiveIntensity = glow ? base + glow : base;
    if (glow && !this.tileSet.style.emissive) mesh.material.emissive.set(HIGHLIGHT.pick);
    if (!glow && !this.tileSet.style.emissive) mesh.material.emissive.set(0x000000);
    tweenVector(mesh.position, new THREE.Vector3(target.pos.x, target.pos.y + lift, target.pos.z), { duration: 180 });
  }

  /**
   * Show which pattern rows accept the selected color.
   * @param playerIndex board to highlight
   * @param validRows   array of row indices
   * @param hoverRow    row under the cursor (or FLOOR_ROW / null)
   * @param count       number of tiles being placed
   * @param wallColor   color index, used to mark the wall target cell
   */
  highlightRows(playerIndex, validRows, hoverRow, count, wallColor) {
    const board = this.boards[playerIndex];
    const player = this.state.players[playerIndex];
    const valid = new Set(validRows);
    for (let row = 0; row < WALL_SIZE; row++) {
      const line = player.lines[row];
      const isValid = valid.has(row);
      const isHover = hoverRow === row;
      for (let k = 0; k < board.cells.pattern[row].length; k++) {
        const cell = board.cells.pattern[row][k];
        const willFill = isValid && k >= line.length && k < line.length + count;
        if (isValid) {
          cell.material.color.set(isHover ? HIGHLIGHT.hover : HIGHLIGHT.valid);
          cell.material.opacity = willFill ? (isHover ? 0.8 : 0.42) : isHover ? 0.25 : 0.12;
        } else {
          cell.material.color.set(HIGHLIGHT.invalid);
          cell.material.opacity = isHover ? 0.35 : 0;
        }
      }
      for (let col = 0; col < WALL_SIZE; col++) {
        const cell = board.cells.wall[row][col];
        const isTarget = isValid && col === wallColumnFor(row, wallColor);
        cell.material.color.set(HIGHLIGHT.target);
        cell.material.opacity = isTarget ? (isHover ? 0.75 : 0.35) : 0;
      }
    }
    // Floor preview: amber over the cells that would receive tiles.
    let overflow = count;
    if (hoverRow !== null && hoverRow !== FLOOR_ROW && valid.has(hoverRow)) {
      overflow = Math.max(0, count - (hoverRow + 1 - player.lines[hoverRow].length));
    }
    const floorHover = hoverRow === FLOOR_ROW || overflow > 0;
    const start = player.floor.length;
    for (let i = 0; i < FLOOR_PENALTIES.length; i++) {
      const cell = board.cells.floor[i];
      const hit = i >= start && i < start + (hoverRow === FLOOR_ROW ? count : overflow);
      cell.material.color.set(HIGHLIGHT.floor);
      cell.material.opacity = floorHover && hit ? 0.75 : hoverRow === null ? 0.18 : 0.1;
    }
  }

  clearHighlights() {
    for (const board of this.boards) {
      for (const row of board.cells.pattern) for (const c of row) c.material.opacity = 0;
      for (const row of board.cells.wall) for (const c of row) c.material.opacity = 0;
      for (const c of board.cells.floor) c.material.opacity = 0;
    }
  }

  // -------------------------------------------------------------------------
  // Picking

  updatePointer(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** What is under the pointer: a draftable tile, a row target, or nothing. */
  pick(playerIndex) {
    if (!this.state) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const sources = [];
    this.state.factories.forEach((f, i) => f.forEach((t) => sources.push(this.tiles.get(t.id))));
    this.state.center.forEach((t) => sources.push(this.tiles.get(t.id)));
    const hit = this.raycaster.intersectObjects(sources, false)[0];
    if (hit) {
      const id = hit.object.userData.id;
      const factoryIndex = this.state.factories.findIndex((f) => f.some((t) => t.id === id));
      return {
        kind: 'tile',
        id,
        color: hit.object.userData.color,
        source: factoryIndex >= 0 ? 'factory' : 'center',
        index: factoryIndex >= 0 ? factoryIndex : 0,
      };
    }
    // Clicking a factory disk itself is a convenience: pick its first color.
    const disk = this.raycaster.intersectObjects(this.factories, false)[0];
    if (disk) return { kind: 'factory', index: disk.object.userData.index };

    if (playerIndex !== null && playerIndex !== undefined) {
      const board = this.boards[playerIndex];
      const targets = [...board.cells.rows, board.cells.floorTarget];
      const rowHit = this.raycaster.intersectObjects(targets, false)[0];
      if (rowHit) return { kind: 'row', row: rowHit.object.userData.row };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Camera

  focusPlayer(index, animate = true) {
    const n = this.boards.length || 2;
    const angle = playerAngle(index, n);
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const position = dir.clone().multiplyScalar(CAMERA.dist).setY(CAMERA.height);
    const target = dir.clone().multiplyScalar(CAMERA.targetDist);
    return this.flyTo(position, target, animate);
  }

  focusOverview(animate = true) {
    return this.flyTo(new THREE.Vector3(0.01, 34, 6), new THREE.Vector3(0, 0, 0), animate);
  }

  flyTo(position, target, animate) {
    if (!animate) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      return Promise.resolve();
    }
    const p0 = this.camera.position.clone();
    const t0 = this.controls.target.clone();
    return tween({
      duration: 900,
      easing: Easing.inOutCubic,
      onUpdate: (t) => {
        this.camera.position.lerpVectors(p0, position, t);
        this.controls.target.lerpVectors(t0, target, t);
        this.controls.update();
      },
    });
  }

  // -------------------------------------------------------------------------
  // Popups (DOM labels projected from world positions)

  popup(worldPos, text, cls = '') {
    if (!this.popupLayer) return;
    const el = document.createElement('div');
    el.className = `popup ${cls}`;
    el.textContent = text;
    this.popupLayer.appendChild(el);
    const entry = { el, pos: worldPos.clone(), born: performance.now() };
    this.popups.push(entry);
    setTimeout(() => {
      el.remove();
      this.popups = this.popups.filter((p) => p !== entry);
    }, 1700);
  }

  projectPopups() {
    if (!this.popups.length) return;
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const v = new THREE.Vector3();
    for (const p of this.popups) {
      const age = (performance.now() - p.born) / 1700;
      v.copy(p.pos).setY(p.pos.y + 0.6 + age * 1.2).project(this.camera);
      p.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
      p.el.style.opacity = String(Math.max(0, 1 - age * age));
    }
  }

  // -------------------------------------------------------------------------
  // Frame loop

  frame() {
    const now = performance.now();
    const elapsed = this.clock.getElapsedTime();
    updateTweens(now);
    this.water.material.uniforms.uTime.value = elapsed;
    if (this.idle) {
      // Slow orbit behind the title screen.
      const a = elapsed * 0.08;
      this.camera.position.set(Math.sin(a) * 24, 14 + Math.sin(elapsed * 0.3) * 1.5, Math.cos(a) * 24);
      this.controls.target.set(0, 0, 0);
    }
    for (const id of this.selected) {
      const mesh = this.tiles.get(id);
      if (mesh) mesh.rotation.y = Math.sin(elapsed * 3 + id) * 0.08;
    }
    this.controls.update();
    this.projectPopups();
    this.renderer.render(this.scene, this.camera);
  }

  setIdle(idle) {
    this.idle = idle;
    this.controls.enabled = !idle;
  }
}
