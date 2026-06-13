import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ── Gemelo digital de planta (Three.js / WebGL) ────────
 *
 * El Edge101 no detecta posicion fisica: el usuario dibuja la planta y aca se
 * enlaza cada equipo a su deteccion real (MAC BLE / esclavo Modbus / CAN ID)
 * para reflejar estado en vivo. El render corre en el navegador del cliente,
 * no en el ESP32. Posiciones autoradas, datos reales.
 */
(function () {
  'use strict';

  var CELL = 5;            // unidades de mundo por celda de la grilla
  var MPU = 0.4;           // metros por unidad de mundo (1 celda = CELL*MPU = 2 m)
  var GRIDX = 36, GRIDZ = 36; // celdas por eje; se recalcula segun el tamano en metros
  var MOVE_PX = 5;         // umbral click-vs-drag
  var WALL_H = 3.6;        // altura por defecto de pared
  var WALL_T = 0.6;        // espesor de pared

  function mPerCell() { return CELL * MPU; }     // metros por celda (2 m)
  function applyFloorSize(wm, dm) {
    GRIDX = Math.max(6, Math.min(120, Math.round(wm / mPerCell())));
    GRIDZ = Math.max(6, Math.min(120, Math.round(dm / mPerCell())));
  }
  function floorMeters() { return { wm: Math.round(GRIDX * mPerCell()), dm: Math.round(GRIDZ * mPerCell()) }; }

  // Catalogo de equipos. Cada uno se arma con primitivas (sin assets externos).
  var KINDS = {
    edge:   { label: 'Edge101',   color: 0x4a9eff, build: buildEdge },
    plc:    { label: 'PLC',       color: 0x8b94ad, build: buildCabinet },
    vfd:    { label: 'Variador',  color: 0xa78bfa, build: buildCabinet },
    hmi:    { label: 'HMI',       color: 0x2dd4bf, build: buildHmi },
    sensor: { label: 'Sensor',    color: 0x84cc16, build: buildSensor },
    motor:  { label: 'Motor',     color: 0xf59e0b, build: buildMotor },
    io:     { label: 'I/O',       color: 0x9aa3b8, build: buildIo }
  };

  var BUSES = {
    modbus:   { label: 'Modbus',   color: 0xf59e0b },
    can:      { label: 'CAN',      color: 0x4a9eff },
    ble:      { label: 'BLE',      color: 0x2dd4bf },
    ethernet: { label: 'Ethernet', color: 0x22c55e },
    power:    { label: 'Alim.',    color: 0xef4444 }
  };

  var ST = { activo: 0x22c55e, inactivo: 0xf59e0b, libre: 0x4a5168, alerta: 0xef4444 };

  // Dispositivos BLE moviles simulados: posicion real en el plano para calcular
  // distancia geometrica al Edge y a cada modulo (lo que daria trilateracion).
  var AGENTS_SEED = [
    { mac: 'AA:BB:CC:11:22:33', name: 'Operario A',   color: 0x22c55e, speed: 2.4 },
    { mac: '11:22:AB:CD:EF:10', name: 'Tablet Mant.', color: 0x2dd4bf, speed: 1.7 },
    { mac: 'F0:E1:D2:C3:B4:A5', name: 'AGV-1',        color: 0xf59e0b, speed: 3.2 },
    { mac: '9C:1D:58:AA:BB:CC', name: 'Operario B',   color: 0x84cc16, speed: 2.0 },
    { mac: 'DE:AD:BE:EF:00:09', name: 'Beacon movil', color: 0xa78bfa, speed: 1.3 }
  ];

  // Modelos 3D reales (Kenney factory-kit) por tipo de equipo. Cada GLB se
  // normaliza a la altura objetivo y se centra con base en y=0. Si falla la
  // carga, el equipo cae a su primitiva procedural.
  var MODEL_BASE = '/models/';
  // Equipos auditados: modelo Kenney factory-kit por tipo, normalizado a altura.
  var MODELS = {
    edge:   { file: 'edge101.glb',                   h: 3.2 },
    plc:    { file: 'factory/machine.glb',           h: 3.4 },
    vfd:    { file: 'factory/machine-fortified.glb', h: 3.4 },
    hmi:    { file: 'factory/screen-wide.glb',       h: 3.0 },
    sensor: { file: 'factory/scanner-low.glb',       h: 2.2 },
    motor:  { file: 'factory/piston-round.glb',      h: 2.6 },
    io:     { file: 'factory/machine-bed.glb',       h: 1.8 }
  };
  // Escala global para props (estructuras Kenney) respecto al mundo. Las props
  // conservan su tamano nativo relativo; el usuario afina con [ y ].
  var PROP_SCALE = 2.4;

  var M = {
    gl: null, ready: false, visible: false,
    layout: null, nodeObj: {}, cables: [],
    sel: null, mode: 'ver', armedKind: null, cableArming: false, cableFrom: null,
    live: { ble: [], modbus: [], can: [], alerts: [] },
    cam: { az: Math.PI * 0.25, pol: 0.95, dist: 180, tx: 0, tz: 0 },
    drag: null, raf: null, clock: 0, dirty: false, pollTimer: null,
    agents: [], selAgent: null, distLines: [], frame: 0,
    propObj: {}, selProp: null, armedProp: null, manifest: null,
    wallObj: {}, selWall: null, wallArming: false, wallFrom: null, env: [],
    undo: []
  };

  /* ── geometria / helpers ─────────────────────────────── */

  function gridToWorld(gx, gz) { return { x: (gx - GRIDX / 2) * CELL, z: (gz - GRIDZ / 2) * CELL }; }

  function worldToGrid(x, z) {
    return { gx: clampCell(Math.round(x / CELL + GRIDX / 2), GRIDX),
             gz: clampCell(Math.round(z / CELL + GRIDZ / 2), GRIDZ) };
  }

  function clampCell(v, n) { return Math.max(0, Math.min((n || GRIDX) - 1, v)); }
  function hexVal(s) { return parseInt(String(s).replace(/^0x/i, ''), 16); }

  function mat(color, opts) {
    opts = opts || {};
    return new THREE.MeshStandardMaterial({
      color: color,
      roughness: opts.rough != null ? opts.rough : 0.6,
      metalness: opts.metal != null ? opts.metal : 0.35,
      emissive: opts.emissive || 0x000000,
      emissiveIntensity: opts.ei || 0
    });
  }

  function box(w, h, d, color, opts) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  function cyl(rt, rb, h, color, opts) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 20), mat(color, opts));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  /* ── builders de equipos (primitivas) ────────────────── */

  function buildCabinet(color) {
    var g = new THREE.Group();
    var body = box(2.4, 4, 1.8, color); body.position.y = 2; g.add(body);
    var panel = box(2.0, 1.2, 0.1, 0x10141f, { metal: 0.1 });
    panel.position.set(0, 2.7, 0.95); g.add(panel);
    var led = box(0.18, 0.18, 0.12, 0x22c55e, { emissive: 0x22c55e, ei: 0.8 });
    led.position.set(0.7, 3.4, 0.96); g.add(led);
    return g;
  }

  function buildEdge(color) {
    var g = new THREE.Group();
    var body = box(2.6, 1.2, 2.0, color, { metal: 0.6, rough: 0.3 });
    body.position.y = 0.6; g.add(body);
    var ant = cyl(0.05, 0.05, 1.6, 0x9aa3b8); ant.position.set(0.9, 1.8, 0.6); g.add(ant);
    var tip = cyl(0.14, 0.14, 0.14, 0x4a9eff, { emissive: 0x4a9eff, ei: 1 });
    tip.position.set(0.9, 2.6, 0.6); g.add(tip);
    return g;
  }

  function buildHmi(color) {
    var g = new THREE.Group();
    var post = cyl(0.12, 0.12, 2.2, 0x555c70); post.position.y = 1.1; g.add(post);
    var screen = box(2.2, 1.4, 0.18, color, { metal: 0.2 }); screen.position.y = 2.6;
    screen.rotation.x = -0.18; g.add(screen);
    var face = box(1.9, 1.1, 0.05, 0x0c1018); face.position.set(0, 2.62, 0.12);
    face.rotation.x = -0.18; g.add(face);
    return g;
  }

  function buildSensor(color) {
    var g = new THREE.Group();
    var post = cyl(0.1, 0.1, 1.6, 0x555c70); post.position.y = 0.8; g.add(post);
    var head = cyl(0.4, 0.5, 0.7, color); head.position.y = 1.8; g.add(head);
    var eye = cyl(0.2, 0.2, 0.1, 0x111111, { emissive: color, ei: 0.5 });
    eye.rotation.x = Math.PI / 2; eye.position.set(0, 1.8, 0.42); g.add(eye);
    return g;
  }

  function buildMotor(color) {
    var g = new THREE.Group();
    var base = box(2.2, 0.5, 1.6, 0x40465a); base.position.y = 0.25; g.add(base);
    var body = cyl(0.9, 0.9, 2.4, color); body.rotation.z = Math.PI / 2;
    body.position.y = 1.3; g.add(body);
    var shaft = cyl(0.2, 0.2, 0.8, 0xcccccc, { metal: 0.9, rough: 0.2 });
    shaft.rotation.z = Math.PI / 2; shaft.position.set(1.5, 1.3, 0); g.add(shaft);
    return g;
  }

  function buildIo(color) {
    var g = new THREE.Group();
    var body = box(1.6, 1.6, 1.2, color); body.position.y = 0.8; g.add(body);
    for (var i = 0; i < 3; i++) {
      var t = box(0.18, 0.18, 0.12, 0x636b80); t.position.set(-0.4 + i * 0.4, 1.0, 0.6); g.add(t);
    }
    return g;
  }

  /* ── modelos 3D reales (GLB Kenney) ──────────────────── */

  var loader = new GLTFLoader();
  var templates = {};

  function loadTemplate(kind) {
    if (templates[kind]) return templates[kind];
    var def = MODELS[kind];
    if (!def) return Promise.reject();
    templates[kind] = loader.loadAsync(MODEL_BASE + def.file).then(function (g) {
      var obj = g.scene; normalizeModel(obj, def.h);
      obj.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      return obj;
    });
    return templates[kind];
  }

  function normalizeModel(obj, targetH) {
    var b = new THREE.Box3().setFromObject(obj), size = new THREE.Vector3();
    b.getSize(size);
    obj.scale.setScalar(targetH / (size.y || 1));
    var b2 = new THREE.Box3().setFromObject(obj), c = new THREE.Vector3();
    b2.getCenter(c);
    obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= b2.min.y;
  }

  function applyModel(node, g) {
    loadTemplate(node.kind).then(function (t) {
      if (M.nodeObj[node.id] !== g) return;            // nodo borrado o rehecho
      var m = t.clone(true);
      if (node.scale && node.scale !== 1) m.scale.multiplyScalar(node.scale);
      m.traverse(function (o) { o.userData.nodeId = node.id; });
      var old = g.getObjectByName('placeholder'); if (old) g.remove(old);
      g.add(m); g.userData.model = m;
    }).catch(function () { /* se queda la primitiva procedural */ });
  }

  var fileTemplates = {};

  function loadFileTemplate(file) {
    if (fileTemplates[file]) return fileTemplates[file];
    fileTemplates[file] = loader.loadAsync(MODEL_BASE + file).then(function (g) {
      var obj = g.scene;
      obj.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      return obj;
    });
    return fileTemplates[file];
  }

  function addPropObj(prop) {
    var g = new THREE.Group();
    var ph = box(2, 2, 2, 0x555c70); ph.name = 'placeholder'; ph.position.y = 1; g.add(ph);
    var p = gridToWorld(prop.x, prop.z); g.position.set(p.x, 0, p.z);
    g.traverse(function (o) { o.userData.propId = prop.id; });
    applyXform(g, prop);
    M.gl.scene.add(g); M.propObj[prop.id] = g;
    applyPropModel(prop, g);
  }

  function applyPropModel(prop, g) {
    loadFileTemplate(prop.file).then(function (t) {
      if (M.propObj[prop.id] !== g) return;
      var m = t.clone(true); m.scale.setScalar((prop.scale || 1) * PROP_SCALE);
      m.traverse(function (o) { o.userData.propId = prop.id; });
      var old = g.getObjectByName('placeholder'); if (old) g.remove(old);
      g.add(m); g.userData.model = m;
    }).catch(function () { });
  }

  function propById(id) { return (M.layout.props || []).filter(function (p) { return p.id === id; })[0]; }
  function newPropId() { return 'p' + ((M.layout.props || []).length) + '_' + Math.floor(M.clock * 1000 % 100000); }

  /* ── escena ──────────────────────────────────────────── */

  function initGL() {
    var canvas = document.getElementById('mapa-canvas');
    if (!canvas || typeof THREE === 'undefined') { glFail(); return false; }
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    } catch (e) { glFail(); return false; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1000);
    M.gl = { renderer: renderer, scene: scene, camera: camera, canvas: canvas, ray: new THREE.Raycaster() };

    addLights(scene);
    rebuildEnvironment();
    bindPointer(canvas);
    M.ready = true;
    initAgents();
    return true;
  }

  function addLights(scene) {
    scene.add(new THREE.HemisphereLight(0xcdddff, 0x20242f, 0.9));
    var dir = new THREE.DirectionalLight(0xfff2e0, 1.25);
    dir.position.set(60, 95, 45); dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048); dir.shadow.bias = -0.0004;
    var c = dir.shadow.camera;
    c.left = -100; c.right = 100; c.top = 100; c.bottom = -100; c.near = 1; c.far = 300;
    scene.add(dir);
    var fill = new THREE.DirectionalLight(0x90a8d0, 0.35);
    fill.position.set(-50, 40, -40); scene.add(fill);
  }

  /* ── ambiente (piso configurable en metros) ──────────── */

  function rebuildEnvironment() {
    var scene = M.gl.scene;
    M.env.forEach(function (o) { scene.remove(o); }); M.env = [];
    var sx = GRIDX * CELL, sz = GRIDZ * CELL;
    var floor = new THREE.Mesh(
      new THREE.PlaneGeometry(sx, sz),
      new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.92, metalness: 0.02 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.name = 'floor';
    scene.add(floor); M.gl.floor = floor; M.env.push(floor);
    buildZones(scene, sx, sz);
  }

  function concreteTexture() {
    var c = document.createElement('canvas'); c.width = c.height = 512;
    var x = c.getContext('2d');
    x.fillStyle = '#54596a'; x.fillRect(0, 0, 512, 512);
    for (var i = 0; i < 9000; i++) {
      var v = 150 + (Math.random() * 90 | 0);
      x.fillStyle = 'rgba(' + v + ',' + v + ',' + (v + 6) + ',0.05)';
      x.fillRect(Math.random() * 512, Math.random() * 512, Math.random() * 3, Math.random() * 3);
    }
    x.strokeStyle = 'rgba(20,24,33,0.55)'; x.lineWidth = 3;
    for (var g = 0; g <= 512; g += 128) {
      x.beginPath(); x.moveTo(g, 0); x.lineTo(g, 512); x.moveTo(0, g); x.lineTo(512, g); x.stroke();
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(Math.max(1, GRIDX / 3), Math.max(1, GRIDZ / 3));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function buildZones(scene, sx, sz) {
    var qx = sx / 2, qz = sz / 2;
    var zones = [
      { label: 'Linea de produccion', x: -1, z: -1, color: 0x4a9eff },
      { label: 'Sala de servidores', x: 1, z: -1, color: 0xa78bfa },
      { label: 'Almacen', x: -1, z: 1, color: 0x84cc16 },
      { label: 'Sala de control', x: 1, z: 1, color: 0x2dd4bf }
    ];
    zones.forEach(function (z) {
      var pl = new THREE.Mesh(new THREE.PlaneGeometry(qx - 4, qz - 4),
        new THREE.MeshBasicMaterial({ color: z.color, transparent: true, opacity: 0.05 }));
      pl.rotation.x = -Math.PI / 2; pl.position.set(z.x * qx / 2, 0.04, z.z * qz / 2);
      scene.add(pl); M.env.push(pl);
      var lab = makeLabel(z.label, hexCss(z.color), 1.0);
      lab.position.set(z.x * qx / 2, 1.4, z.z * qz / 2 - qz / 2 + 6); scene.add(lab); M.env.push(lab);
    });
  }

  /* ── paredes (entidades personalizables) ─────────────── */

  function addWallObj(wall) {
    var a = gridToWorld(wall.x1, wall.z1), b = gridToWorld(wall.x2, wall.z2);
    var dx = b.x - a.x, dz = b.z - a.z, len = Math.sqrt(dx * dx + dz * dz) || 0.1;
    var h = wall.h || WALL_H;
    var m = new THREE.Mesh(new THREE.BoxGeometry(len, h, WALL_T), mat(0x434a5c, { rough: 0.9, metal: 0.05 }));
    m.position.set((a.x + b.x) / 2, h / 2, (a.z + b.z) / 2);
    m.rotation.y = -Math.atan2(dz, dx);
    m.castShadow = true; m.receiveShadow = true; m.userData.wallId = wall.id;
    M.gl.scene.add(m); M.wallObj[wall.id] = m;
  }

  function refreshWallObj(wall) {
    var m = M.wallObj[wall.id]; if (m) { M.gl.scene.remove(m); delete M.wallObj[wall.id]; }
    addWallObj(wall);
  }

  function wallById(id) { return (M.layout.walls || []).filter(function (w) { return w.id === id; })[0]; }
  function newWallId() { return 'w' + ((M.layout.walls || []).length) + '_' + Math.floor(M.clock * 1000 % 100000); }

  function pickWall(ev) {
    var ids = Object.keys(M.wallObj); if (!ids.length) return null;
    M.gl.ray.setFromCamera(ndc(ev), M.gl.camera);
    var hit = M.gl.ray.intersectObjects(ids.map(function (id) { return M.wallObj[id]; }), false)[0];
    return hit ? hit.object.userData.wallId : null;
  }

  function makeLabel(text, color, scale) {
    var c = document.createElement('canvas'); c.width = 256; c.height = 64;
    var ctx = c.getContext('2d');
    ctx.font = 'bold 30px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(10,13,20,.55)'; ctx.fillRect(0, 16, 256, 36);
    ctx.fillStyle = color || '#dde1f0'; ctx.fillText(text, 128, 34);
    var tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    var s = scale || 1; spr.scale.set(8 * s, 2 * s, 1);
    return spr;
  }

  /* ── construccion de nodos y cables ──────────────────── */

  function rebuildScene() {
    var scene = M.gl.scene;
    Object.keys(M.nodeObj).forEach(function (id) { scene.remove(M.nodeObj[id]); });
    Object.keys(M.propObj).forEach(function (id) { scene.remove(M.propObj[id]); });
    Object.keys(M.wallObj).forEach(function (id) { scene.remove(M.wallObj[id]); });
    M.cables.forEach(function (c) { scene.remove(c.mesh); if (c.dot) scene.remove(c.dot); });
    M.nodeObj = {}; M.propObj = {}; M.wallObj = {}; M.cables = [];
    (M.layout.walls || []).forEach(addWallObj);
    M.layout.nodes.forEach(addNodeObj);
    (M.layout.props || []).forEach(addPropObj);
    M.layout.cables.forEach(addCableObj);
    refreshStatuses();
  }

  function addNodeObj(node) {
    var k = KINDS[node.kind] || KINDS.io;
    var g = new THREE.Group();
    var ph = k.build(k.color); ph.name = 'placeholder'; g.add(ph);
    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.12, 8, 28),
      new THREE.MeshStandardMaterial({ color: ST.libre, emissive: ST.libre, emissiveIntensity: 0.6 })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; ring.name = 'ring'; g.add(ring);
    var lab = makeLabel(node.label || k.label, '#dde1f0', 0.62);
    lab.position.y = 4.6; lab.name = 'label'; g.add(lab);
    var p = gridToWorld(node.x, node.z); g.position.set(p.x, 0, p.z);
    g.traverse(function (o) { o.userData.nodeId = node.id; });
    applyXform(g, node);
    M.gl.scene.add(g); M.nodeObj[node.id] = g;
    applyModel(node, g);
  }

  function setNodeLabel(node) {
    var g = M.nodeObj[node.id]; if (!g) return;
    var old = g.getObjectByName('label'); if (old) g.remove(old);
    var lab = makeLabel(node.label || (KINDS[node.kind] || KINDS.io).label, '#dde1f0', 0.62);
    lab.position.y = 4.6; lab.name = 'label'; g.add(lab);
  }

  function busCurve(a, b) {
    var pa = M.nodeObj[a], pb = M.nodeObj[b];
    if (!pa || !pb) return null;
    var mid = new THREE.Vector3(
      (pa.position.x + pb.position.x) / 2, 1.6, (pa.position.z + pb.position.z) / 2);
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(pa.position.x, 0.4, pa.position.z), mid,
      new THREE.Vector3(pb.position.x, 0.4, pb.position.z)]);
  }

  function addCableObj(cable) {
    var curve = busCurve(cable.from, cable.to);
    if (!curve) return;
    var col = (BUSES[cable.bus] || BUSES.modbus).color;
    var dashed = cable.bus === 'ble';
    var mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 24, dashed ? 0.06 : 0.11, 8, false),
      mat(col, { emissive: col, ei: 0.25, rough: 0.5 }));
    mesh.userData.cable = cable; M.gl.scene.add(mesh);
    var dot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1 }));
    dot.visible = false; M.gl.scene.add(dot);
    M.cables.push({ cable: cable, mesh: mesh, curve: curve, dot: dot, t: 0, active: false });
  }

  function rebuildCablesOf(id) {
    M.cables.filter(function (c) { return c.cable.from === id || c.cable.to === id; })
      .forEach(function (c) {
        c.curve = busCurve(c.cable.from, c.cable.to);
        if (!c.curve) return;
        c.mesh.geometry.dispose();
        var dashed = c.cable.bus === 'ble';
        c.mesh.geometry = new THREE.TubeGeometry(c.curve, 24, dashed ? 0.06 : 0.11, 8, false);
      });
  }

  /* ── estado en vivo ──────────────────────────────────── */

  function detectionFor(node) {
    if (!node.bind || !node.bind.type) return null;
    var b = node.bind;
    if (b.type === 'ble') return findBle(b.key);
    if (b.type === 'modbus') return findModbus(b.key);
    if (b.type === 'can') return findCan(b.key);
    return null;
  }

  function findBle(mac) {
    var key = String(mac).toUpperCase();
    var d = M.live.ble.filter(function (x) { return String(x.mac).toUpperCase() === key; })[0];
    if (!d) return { found: false };
    return { found: true, vistoMs: d.visto_ms, rssi: d.rssi, fresh: d.visto_ms < 120000 };
  }

  function findModbus(slave) {
    var n = parseInt(slave, 10);
    var rows = M.live.modbus.filter(function (x) { return x.slave === n; });
    if (!rows.length) return { found: false };
    var min = Math.min.apply(null, rows.map(function (r) { return r.visto_ms; }));
    return { found: true, vistoMs: min, traffic: rows.length, fresh: min < 10000 };
  }

  function findCan(id) {
    var v = hexVal(id);
    var rows = M.live.can.filter(function (x) { return hexVal(x.id) === v; });
    if (!rows.length) return { found: false };
    var min = Math.min.apply(null, rows.map(function (r) { return r.visto_ms; }));
    return { found: true, vistoMs: min, traffic: rows.length, fresh: min < 10000 };
  }

  function alertFor(node) {
    if (!node.bind || !node.bind.key) return null;
    var key = String(node.bind.key).toUpperCase();
    var hit = M.live.alerts.filter(function (a) {
      var m = String(a.mensaje || '').toUpperCase();
      if (node.bind.type === 'modbus') return m.indexOf('ESCLAVO ' + key) >= 0 || m.indexOf('SLAVE ' + key) >= 0;
      return m.indexOf(key) >= 0;
    })[0];
    return hit || null;
  }

  function nodeStatus(node) {
    if (node.kind === 'edge') return { st: 'activo' };
    if (alertFor(node)) return { st: 'alerta' };
    var det = detectionFor(node);
    if (!node.bind || !node.bind.type) return { st: 'libre' };
    if (!det || !det.found) return { st: 'inactivo', det: det };
    return { st: det.fresh ? 'activo' : 'inactivo', det: det };
  }

  function refreshStatuses() {
    if (!M.ready) return;
    var activos = 0;
    M.layout.nodes.forEach(function (node) {
      var g = M.nodeObj[node.id]; if (!g) return;
      var s = nodeStatus(node);
      paintRing(g, s.st);
      if (s.st === 'activo') activos++;
    });
    M.cables.forEach(updateCableActivity);
    setText('mapa-chip', activos);
    setText('mapa-ts', 'actualizado ' + fmtAgo(0));
    if (M.sel) fillPanel(nodeById(M.sel));
  }

  function paintRing(g, st) {
    var ring = g.getObjectByName('ring'); if (!ring) return;
    var col = ST[st] || ST.libre;
    ring.material.color.setHex(col); ring.material.emissive.setHex(col);
    g.userData.st = st;
  }

  function updateCableActivity(c) {
    var fromNode = nodeById(c.cable.from), toNode = nodeById(c.cable.to);
    var a = fromNode && M.nodeObj[c.cable.from] && M.nodeObj[c.cable.from].userData.st === 'activo';
    var b = toNode && M.nodeObj[c.cable.to] && M.nodeObj[c.cable.to].userData.st === 'activo';
    c.active = !!(a || b);
    if (c.dot) c.dot.visible = c.active;
  }

  /* ── camara orbital ──────────────────────────────────── */

  function applyCamera() {
    var c = M.cam, cam = M.gl.camera;
    cam.position.x = c.tx + c.dist * Math.sin(c.pol) * Math.sin(c.az);
    cam.position.y = c.dist * Math.cos(c.pol);
    cam.position.z = c.tz + c.dist * Math.sin(c.pol) * Math.cos(c.az);
    cam.lookAt(c.tx, 0, c.tz);
  }

  function fitView() {
    var s = Math.max(GRIDX, GRIDZ) * CELL;
    M.cam.tx = 0; M.cam.tz = 0; M.cam.dist = s * 0.95; M.cam.az = Math.PI * 0.25; M.cam.pol = 0.95;
  }

  /* ── loop de render ──────────────────────────────────── */

  function loop() {
    if (!M.visible) { M.raf = null; return; }
    M.raf = requestAnimationFrame(loop);
    syncSize();
    M.clock += 0.016; M.frame++;
    updateAgents(0.016);
    updateSelection();
    pulseAlerts();
    animateTraffic();
    applyCamera();
    M.gl.renderer.render(M.gl.scene, M.gl.camera);
  }

  function pulseAlerts() {
    var p = 0.5 + 0.5 * Math.sin(M.clock * 4);
    Object.keys(M.nodeObj).forEach(function (id) {
      var g = M.nodeObj[id], ring = g.getObjectByName('ring');
      if (!ring) return;
      if (g.userData.st === 'alerta') {
        ring.material.emissiveIntensity = 0.4 + p; ring.scale.setScalar(1 + p * 0.12);
      } else if (id === M.sel) {
        ring.material.emissiveIntensity = 0.6 + p * 0.5; ring.scale.setScalar(1);
      } else {
        ring.material.emissiveIntensity = 0.6; ring.scale.setScalar(1);
      }
    });
  }

  function animateTraffic() {
    M.cables.forEach(function (c) {
      if (!c.active || !c.curve || !c.dot) return;
      c.t = (c.t + 0.01) % 1;
      var p = c.curve.getPoint(c.t); c.dot.position.copy(p);
    });
  }

  /* ── interaccion / picking ───────────────────────────── */

  function ndc(ev) {
    var r = M.gl.canvas.getBoundingClientRect();
    return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1,
      -((ev.clientY - r.top) / r.height) * 2 + 1);
  }

  function pickNode(ev) {
    M.gl.ray.setFromCamera(ndc(ev), M.gl.camera);
    var groups = Object.keys(M.nodeObj).map(function (id) { return M.nodeObj[id]; });
    var hit = M.gl.ray.intersectObjects(groups, true)[0];
    return hit ? hit.object.userData.nodeId : null;
  }

  function pickFloor(ev) {
    M.gl.ray.setFromCamera(ndc(ev), M.gl.camera);
    var hit = M.gl.ray.intersectObject(M.gl.floor, false)[0];
    return hit ? hit.point : null;
  }

  function bindPointer(canvas) {
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function onDown(ev) {
    var nodeId = null, propId = null, wallId = null;
    var arming = M.armedKind || M.armedProp || M.wallArming || M.cableArming;
    if (M.mode === 'editar' && !arming) {
      nodeId = pickNode(ev); if (!nodeId) propId = pickProp(ev);
      if (!nodeId && !propId) wallId = pickWall(ev);
    }
    M.drag = {
      x: ev.clientX, y: ev.clientY, moved: false,
      pan: ev.button === 2 || ev.shiftKey,
      nodeId: nodeId, propId: propId, wallId: wallId, orbit: !(nodeId || propId || wallId)
    };
  }

  function onMove(ev) {
    if (!M.drag) return;
    var dx = ev.clientX - M.drag.x, dy = ev.clientY - M.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > MOVE_PX) M.drag.moved = true;
    M.drag.x = ev.clientX; M.drag.y = ev.clientY;
    if ((M.drag.nodeId || M.drag.propId || M.drag.wallId) && M.drag.moved) {
      if (!M.drag.pushed) { pushUndo(); M.drag.pushed = true; }
      dragEntity(ev); return;
    }
    if (M.drag.pan) { panCamera(dx, dy); return; }
    if (M.drag.orbit) { orbitCamera(dx, dy); }
  }

  function onUp(ev) {
    if (!M.drag) return;
    if (!M.drag.moved) handleClick(ev);
    M.drag = null;
  }

  function orbitCamera(dx, dy) {
    M.cam.az -= dx * 0.006;
    M.cam.pol = Math.max(0.2, Math.min(1.45, M.cam.pol - dy * 0.005));
  }

  function panCamera(dx, dy) {
    var s = M.cam.dist * 0.0016;
    M.cam.tx -= (dx * Math.cos(M.cam.az) + dy * Math.sin(M.cam.az)) * s;
    M.cam.tz -= (-dx * Math.sin(M.cam.az) + dy * Math.cos(M.cam.az)) * s;
  }

  function onWheel(ev) {
    ev.preventDefault();
    M.cam.dist = Math.max(30, Math.min(800, M.cam.dist + (ev.deltaY > 0 ? 12 : -12)));
  }

  function dragEntity(ev) {
    var p = pickFloor(ev); if (!p) return;
    if (M.drag.nodeId) {
      var node = nodeById(M.drag.nodeId); if (!node) return;
      var cell = worldToGrid(p.x, p.z); node.x = cell.gx; node.z = cell.gz;
      var w = gridToWorld(node.x, node.z);
      M.nodeObj[node.id].position.set(w.x, node.ey || 0, w.z); rebuildCablesOf(node.id);
    } else if (M.drag.propId) {
      var prop = propById(M.drag.propId); if (!prop) return;
      prop.x = p.x / CELL + GRIDX / 2; prop.z = p.z / CELL + GRIDZ / 2;
      M.propObj[prop.id].position.set(p.x, prop.ey || 0, p.z);
    } else if (M.drag.wallId) {
      var wl = wallById(M.drag.wallId); if (!wl) return;
      var tgx = p.x / CELL + GRIDX / 2, tgz = p.z / CELL + GRIDZ / 2;
      var mx = (wl.x1 + wl.x2) / 2, mz = (wl.z1 + wl.z2) / 2;
      var ddx = tgx - mx, ddz = tgz - mz;
      wl.x1 += ddx; wl.z1 += ddz; wl.x2 += ddx; wl.z2 += ddz; refreshWallObj(wl);
    }
    markDirty();
  }

  function pickProp(ev) {
    var ids = Object.keys(M.propObj); if (!ids.length) return null;
    M.gl.ray.setFromCamera(ndc(ev), M.gl.camera);
    var objs = ids.map(function (id) { return M.propObj[id]; });
    var hit = M.gl.ray.intersectObjects(objs, true)[0];
    return hit ? hit.object.userData.propId : null;
  }

  function handleClick(ev) {
    if (M.wallArming) { clickWall(ev); return; }
    if (M.cableArming) { clickCable(pickNode(ev)); return; }
    // La seleccion SIEMPRE tiene prioridad sobre colocar: si clicas sobre algo,
    // lo seleccionas (aunque haya un asset armado). Solo se coloca en piso vacio.
    var aid = pickAgent(ev); if (aid) { selectAgent(aid); return; }
    var id = pickNode(ev); if (id) { selectNode(id); return; }
    var pid = pickProp(ev); if (pid) { selectProp(pid); return; }
    var wid = pickWall(ev); if (wid) { selectWall(wid); return; }
    if (M.mode === 'editar' && M.armedProp) { placeProp(ev); return; }
    if (M.mode === 'editar' && M.armedKind) { placeNode(ev); return; }
    closePanel();
  }

  function clickWall(ev) {
    var p = pickFloor(ev); if (!p) return;
    var gx = clampEnd(Math.round(p.x / CELL + GRIDX / 2), GRIDX);
    var gz = clampEnd(Math.round(p.z / CELL + GRIDZ / 2), GRIDZ);
    if (!M.wallFrom) { M.wallFrom = { gx: gx, gz: gz }; hint('Pared: clic en el extremo final'); return; }
    if (gx !== M.wallFrom.gx || gz !== M.wallFrom.gz) {
      pushUndo();
      var wall = { id: newWallId(), x1: M.wallFrom.gx, z1: M.wallFrom.gz, x2: gx, z2: gz, h: WALL_H };
      (M.layout.walls = M.layout.walls || []).push(wall); addWallObj(wall); markDirty();
    }
    M.wallFrom = null; hint('Pared: clic en el extremo inicial (Esc para salir)');
  }
  function clampEnd(v, n) { return Math.max(0, Math.min(n, v)); }

  function selectWall(id) {
    M.sel = null; M.selAgent = null; M.selProp = null; clearDistLines(); M.selWall = id;
    document.getElementById('mapa-panel').classList.remove('oculto');
    fillWallPanel(wallById(id));
  }

  function fillWallPanel(w) {
    if (!w) return;
    var a = gridToWorld(w.x1, w.z1), b = gridToWorld(w.x2, w.z2);
    var len = Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.z - a.z, 2)) * MPU;
    setText('mp-kind', 'Pared');
    var lab = document.getElementById('mp-label'); lab.value = 'Pared'; lab.disabled = true;
    var est = document.getElementById('mp-estado'); est.textContent = 'estructura'; est.className = 'mapa-panel-v';
    setText('mp-bind', 'longitud ' + len.toFixed(1) + ' m');
    setText('mp-visto', 'altura ' + (w.h || WALL_H).toFixed(1) + ' u');
    setText('mp-metric', M.mode === 'editar' ? '+ / - cambian la altura' : 'modo Editar para ajustar');
    document.getElementById('mp-alert').classList.add('oculto');
    document.getElementById('mp-bindbox').classList.add('oculto');
    document.getElementById('mp-dist').classList.add('oculto');
    showXform(M.mode === 'editar', 'wall');
  }

  /* ── editor ──────────────────────────────────────────── */

  function placeNode(ev) {
    var p = pickFloor(ev); if (!p) return;
    var cell = worldToGrid(p.x, p.z);
    var node = { id: newId(), kind: M.armedKind, x: cell.gx, z: cell.gz,
      label: KINDS[M.armedKind].label, bind: { type: '', key: '' } };
    pushUndo();
    M.layout.nodes.push(node); addNodeObj(node);
    refreshStatuses(); markDirty();
    M.armedKind = null; clearArmedPalette();
    hint('Colocado. Arrastralo para moverlo o usa el panel. Paleta para otro.');
    selectNode(node.id);
  }

  function placeProp(ev) {
    var p = pickFloor(ev); if (!p) return;
    pushUndo();
    var prop = { id: newPropId(), file: M.armedProp,
      x: p.x / CELL + GRIDX / 2, z: p.z / CELL + GRIDZ / 2, rot: 0, scale: 1 };
    (M.layout.props = M.layout.props || []).push(prop);
    addPropObj(prop); markDirty();
    M.armedProp = null;
    hint('Colocado. Arrastralo para moverlo o usa el panel. Assets para otro.');
    selectProp(prop.id);
  }

  function selectProp(id) {
    M.sel = null; M.selAgent = null; clearDistLines(); M.selProp = id;
    document.getElementById('mapa-panel').classList.remove('oculto');
    fillPropPanel(propById(id));
  }

  function fillPropPanel(prop) {
    if (!prop) return;
    setText('mp-kind', 'Estructura');
    var lab = document.getElementById('mp-label'); lab.value = prettyFile(prop.file); lab.disabled = true;
    var est = document.getElementById('mp-estado'); est.textContent = 'decorativo'; est.className = 'mapa-panel-v';
    setText('mp-bind', prop.file);
    setText('mp-visto', 'escala ' + (prop.scale || 1).toFixed(2) + ' · rot ' + (prop.rot || 0) + 'gr');
    setText('mp-metric', M.mode === 'editar' ? 'usa los controles de abajo' : 'modo Editar para ajustar');
    document.getElementById('mp-alert').classList.add('oculto');
    document.getElementById('mp-bindbox').classList.add('oculto');
    document.getElementById('mp-dist').classList.add('oculto');
    showXform(M.mode === 'editar', 'prop');
  }

  function deg(v) { return (v || 0) * Math.PI / 180; }

  function applyXform(o, d) {
    if (!o) return;
    o.rotation.set(deg(d.rx), deg(d.ry != null ? d.ry : d.rot), deg(d.rz));
    o.position.y = d.ey || 0;
  }

  function selData() {
    if (M.selProp) return { t: 'prop', d: propById(M.selProp), o: M.propObj[M.selProp] };
    if (M.selWall) return { t: 'wall', d: wallById(M.selWall), o: M.wallObj[M.selWall] };
    if (M.sel) return { t: 'node', d: nodeById(M.sel), o: M.nodeObj[M.sel] };
    return null;
  }

  function refreshSelPanel() {
    if (M.selProp) fillPropPanel(propById(M.selProp));
    else if (M.selWall) fillWallPanel(wallById(M.selWall));
    else if (M.sel) fillPanel(nodeById(M.sel));
  }

  function rotateAxis(key, ddeg) {
    var s = selData(); if (!s || s.t === 'wall' || !s.d) return;
    pushUndo();
    var cur = s.d[key] != null ? s.d[key] : (key === 'ry' ? (s.d.rot || 0) : 0);
    s.d[key] = ((cur + ddeg) % 360 + 360) % 360;
    if (key === 'ry') s.d.rot = s.d[key];
    applyXform(s.o, s.d); markDirty(); refreshSelPanel();
  }

  function elevate(dd) {
    var s = selData(); if (!s || s.t === 'wall' || !s.d) return;
    pushUndo();
    s.d.ey = Math.max(0, Math.min(60, (s.d.ey || 0) + dd));
    applyXform(s.o, s.d); markDirty(); refreshSelPanel();
  }

  function rotateSelected() { rotateAxis('ry', 45); }

  function setAxisAbs(key, val) {
    var s = selData(); if (!s || s.t === 'wall' || !s.d) return;
    pushUndo();
    s.d[key] = ((val % 360) + 360) % 360;
    if (key === 'ry') s.d.rot = s.d[key];
    applyXform(s.o, s.d); markDirty(); refreshSelPanel();
  }

  function setElevAbs(val) {
    var s = selData(); if (!s || s.t === 'wall' || !s.d) return;
    pushUndo();
    s.d.ey = Math.max(0, Math.min(60, val));
    applyXform(s.o, s.d); markDirty(); refreshSelPanel();
  }

  function setScaleAbs(val) {
    var s = selData(); if (!s || !s.d || !(val > 0)) return;
    var cur = s.t === 'wall' ? (s.d.h || WALL_H) : (s.d.scale || 1);
    scaleSelected(val / cur);
  }

  function onXformInput(ev) {
    var t = ev.target; if (t.tagName !== 'INPUT') return;
    var v = parseFloat(t.value); if (isNaN(v)) return;
    var k = t.dataset.k;
    if (k === 'sc') setScaleAbs(v);
    else if (k === 'ey') setElevAbs(v);
    else setAxisAbs(k, v);
  }

  function syncXform() {
    var s = selData(); if (!s || !s.d) return;
    var d = s.d, wall = s.t === 'wall';
    setVal('mp-in-rx', wall ? 0 : (d.rx || 0));
    setVal('mp-in-ry', wall ? 0 : (d.ry != null ? d.ry : (d.rot || 0)));
    setVal('mp-in-rz', wall ? 0 : (d.rz || 0));
    setVal('mp-in-ey', wall ? 0 : (d.ey || 0));
    setVal('mp-in-sc', wall ? (d.h || WALL_H) : (d.scale || 1));
  }

  function setVal(id, v) {
    var el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = Math.round(v * 100) / 100;
  }

  function scaleSelected(f) {
    if (M.selWall) {
      pushUndo();
      var w = wallById(M.selWall); w.h = Math.max(1, Math.min(14, (w.h || WALL_H) * f));
      refreshWallObj(w); fillWallPanel(w); markDirty(); return;
    }
    if (M.selProp) {
      pushUndo();
      var p = propById(M.selProp); p.scale = Math.max(0.2, Math.min(6, (p.scale || 1) * f));
      var g = M.propObj[p.id]; if (g.userData.model) g.userData.model.scale.setScalar(p.scale * PROP_SCALE);
      fillPropPanel(p); markDirty(); return;
    }
    if (M.sel) {
      var n = nodeById(M.sel); if (!n) return;
      pushUndo();
      n.scale = Math.max(0.4, Math.min(4, (n.scale || 1) * f));
      var ng = M.nodeObj[n.id]; if (ng.userData.model) ng.userData.model.scale.multiplyScalar(f);
      markDirty(); refreshSelPanel();
    }
  }

  function prettyFile(f) { return String(f).split('/').pop().replace(/\.glb$/i, '').replace(/-/g, ' '); }
  function clearArmedProp() { M.armedProp = null; }

  function clickCable(id) {
    if (!id) { M.cableArming = false; M.cableFrom = null; setArmedCable(false); hint(''); return; }
    if (!M.cableFrom) { M.cableFrom = id; hint('Cable: clic en el equipo destino'); return; }
    if (id !== M.cableFrom) {
      pushUndo();
      var bus = document.getElementById('mapa-bus-sel').value;
      var cable = { from: M.cableFrom, to: id, bus: bus };
      M.layout.cables.push(cable); addCableObj(cable); refreshStatuses(); markDirty();
    }
    M.cableFrom = null; M.cableArming = false; setArmedCable(false); hint('');
  }

  function deleteSelected() {
    if (!(M.selWall || M.selProp || M.sel)) return;
    pushUndo();
    if (M.selWall) {
      M.layout.walls = (M.layout.walls || []).filter(function (w) { return w.id !== M.selWall; });
      M.selWall = null; closePanel(); rebuildScene(); markDirty(); return;
    }
    if (M.selProp) {
      M.layout.props = (M.layout.props || []).filter(function (p) { return p.id !== M.selProp; });
      M.selProp = null; closePanel(); rebuildScene(); markDirty(); return;
    }
    if (!M.sel) return;
    M.layout.cables = M.layout.cables.filter(function (c) { return c.from !== M.sel && c.to !== M.sel; });
    M.layout.nodes = M.layout.nodes.filter(function (n) { return n.id !== M.sel; });
    M.sel = null; closePanel(); rebuildScene(); markDirty();
  }

  function setMode(mode) {
    M.mode = mode; M.armedKind = null; M.armedProp = null; M.cableArming = false; M.cableFrom = null;
    M.wallArming = false; M.wallFrom = null;
    document.getElementById('mapa-modo-ver').classList.toggle('activo', mode === 'ver');
    document.getElementById('mapa-modo-editar').classList.toggle('activo', mode === 'editar');
    document.getElementById('mapa-edit-tools').classList.toggle('oculto', mode !== 'editar');
    document.getElementById('mapa-assets').classList.add('oculto');
    clearArmedPalette(); setArmedCable(false); setArmedWall(false);
    hint(mode === 'editar' ? 'Paleta/Assets/Pared para colocar; arrastra para mover todo' : '');
  }

  function setArmedWall(on) { document.getElementById('mapa-tool-wall').classList.toggle('armado', !!on); }

  /* ── panel de detalle ────────────────────────────────── */

  function selectNode(id) {
    M.sel = id; M.selAgent = null; clearDistLines();
    var node = nodeById(id); if (!node) return;
    document.getElementById('mapa-panel').classList.remove('oculto');
    fillPanel(node);
  }

  function closePanel() {
    M.sel = null; M.selAgent = null; M.selProp = null; M.selWall = null; clearDistLines();
    document.getElementById('mapa-panel').classList.add('oculto');
  }

  function fillPanel(node) {
    if (!node) return;
    var k = KINDS[node.kind] || KINDS.io;
    setText('mp-kind', k.label);
    var lab = document.getElementById('mp-label');
    lab.value = node.label || k.label; lab.disabled = M.mode !== 'editar';
    var s = nodeStatus(node);
    setStatusText('mp-estado', s.st);
    setText('mp-bind', node.bind && node.bind.type
      ? (BUSES[node.bind.type] ? BUSES[node.bind.type].label : node.bind.type) + ' · ' + node.bind.key
      : 'sin enlazar');
    setText('mp-visto', s.det && s.det.found ? fmtAgo(s.det.vistoMs) : '--');
    setText('mp-metric', metricText(node, s));
    document.getElementById('mp-dist').classList.add('oculto');
    showXform(M.mode === 'editar', 'node');
    fillAlert(node);
    fillBindBox(node);
  }

  function metricText(node, s) {
    if (!s.det || !s.det.found) return '--';
    if (node.bind.type === 'ble') return s.det.rssi + ' dBm';
    return (s.det.traffic || 0) + ' tramas (buffer)';
  }

  function fillAlert(node) {
    var box = document.getElementById('mp-alert');
    var a = alertFor(node);
    box.classList.toggle('oculto', !a);
    if (a) box.textContent = (a.nivel || 'ALERTA') + ': ' + a.mensaje;
  }

  function setStatusText(id, st) {
    var labels = { activo: 'Activo', inactivo: 'Inactivo', libre: 'Sin enlazar', alerta: 'Alerta' };
    var cls = { activo: 'ok', inactivo: 'warn', libre: '', alerta: 'crit' };
    var el = document.getElementById(id);
    el.textContent = labels[st] || st; el.className = 'mapa-panel-v ' + (cls[st] || '');
  }

  /* ── binding UI ──────────────────────────────────────── */

  function fillBindBox(node) {
    var boxEl = document.getElementById('mp-bindbox');
    boxEl.classList.toggle('oculto', M.mode !== 'editar' || node.kind === 'edge');
    if (M.mode !== 'editar') return;
    var type = node.bind ? node.bind.type : '';
    document.getElementById('mp-bind-type').value = type || '';
    fillBindKeys(type, node.bind ? node.bind.key : '');
  }

  function fillBindKeys(type, current) {
    var sel = document.getElementById('mp-bind-key');
    sel.innerHTML = '';
    bindOptions(type).forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.label;
      if (String(o.value) === String(current)) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function bindOptions(type) {
    if (type === 'ble') return M.live.ble.map(function (d) {
      return { value: d.mac, label: d.mac + (d.nombre ? ' (' + d.nombre + ')' : '') }; });
    if (type === 'modbus') return uniq(M.live.modbus.map(function (r) { return r.slave; }))
      .map(function (s) { return { value: s, label: 'Esclavo ' + s }; });
    if (type === 'can') return uniq(M.live.can.map(function (r) { return r.id; }))
      .map(function (i) { return { value: i, label: 'ID ' + i }; });
    return [];
  }

  function onBindTypeChange() {
    var node = nodeById(M.sel); if (!node) return;
    pushUndo();
    var type = document.getElementById('mp-bind-type').value;
    node.bind = { type: type, key: '' };
    fillBindKeys(type, ''); applyBindKey(true); markDirty();
  }

  function applyBindKey(skipUndo) {
    var node = nodeById(M.sel); if (!node) return;
    if (skipUndo !== true) pushUndo();
    var key = document.getElementById('mp-bind-key').value;
    node.bind.key = key; refreshStatuses(); fillPanel(node); markDirty();
  }

  /* ── persistencia ────────────────────────────────────── */

  function loadLayout() {
    fetch('/api/map/layout').then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { adopt(j); })
      .catch(function () { adopt(localLayout()); });
  }

  function adopt(j) {
    var fl = (j && j.floor) ? j.floor : { wm: 72, dm: 72 };
    applyFloorSize(fl.wm, fl.dm);
    if (!j || !j.nodes || !j.nodes.length) { M.layout = demoLayout(); markDirty(); }
    else { M.layout = normalize(j); M.dirty = false; saveState(''); }
    rebuildEnvironment(); rebuildScene(); updateFloorUi(); fitView();
  }

  function normalize(j) {
    return { v: 1, floor: floorMeters(),
      nodes: (j.nodes || []).map(function (n, i) {
        return { id: n.id || 'n' + i, kind: KINDS[n.kind] ? n.kind : 'io',
          x: clampCell(Math.round(n.x || 0), GRIDX), z: clampCell(Math.round(n.z || 0), GRIDZ),
          rot: n.rot || 0, rx: n.rx || 0, ry: n.ry != null ? n.ry : (n.rot || 0), rz: n.rz || 0,
          ey: n.ey || 0, scale: n.scale || 1, label: n.label || '', bind: n.bind || { type: '', key: '' } }; }),
      props: (j.props || []).filter(function (p) { return p.file; }).map(function (p, i) {
        return { id: p.id || 'p' + i, file: p.file, x: p.x || 0, z: p.z || 0,
          rot: p.rot || 0, rx: p.rx || 0, ry: p.ry != null ? p.ry : (p.rot || 0), rz: p.rz || 0,
          ey: p.ey || 0, scale: p.scale || 1 }; }),
      walls: (j.walls || []).filter(function (w) { return w.x1 != null && w.x2 != null; }).map(function (w, i) {
        return { id: w.id || 'w' + i, x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2, h: w.h || WALL_H }; }),
      cables: (j.cables || []).filter(function (c) { return c.from && c.to; }) };
  }

  function applyFloorFromUi() {
    var wm = parseInt(document.getElementById('mapa-floor-w').value, 10);
    var dm = parseInt(document.getElementById('mapa-floor-d').value, 10);
    if (!wm || !dm) return;
    pushUndo();
    applyFloorSize(wm, dm); M.layout.floor = floorMeters();
    rebuildEnvironment(); rebuildScene(); markDirty(); updateFloorUi();
  }

  function updateFloorUi() {
    var f = floorMeters();
    var w = document.getElementById('mapa-floor-w'), d = document.getElementById('mapa-floor-d');
    if (w) w.value = f.wm; if (d) d.value = f.dm;
    var el = document.getElementById('mapa-floor-m2'); if (el) el.textContent = (f.wm * f.dm) + ' m2';
  }

  function saveLayout() {
    var body = JSON.stringify(M.layout);
    fetch('/api/map/layout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) { M.dirty = false; saveState('guardado en el Edge', 'ok'); }
        else { saveState('error: ' + (res && res.error || 'desconocido'), 'err'); }
      })
      .catch(function () {
        try { localStorage.setItem('edge_map_layout', body); M.dirty = false; saveState('guardado local (sin Edge)', 'ok'); }
        catch (e) { saveState('no se pudo guardar', 'err'); }
      });
  }

  function localLayout() { try { return JSON.parse(localStorage.getItem('edge_map_layout')); } catch (e) { return null; } }
  function markDirty() { M.dirty = true; saveState('cambios sin guardar', 'dirty'); }

  function pushUndo() {
    if (!M.layout) return;
    M.undo.push(JSON.stringify(M.layout));
    if (M.undo.length > 40) M.undo.shift();
  }

  function undo() {
    if (!M.undo.length) { saveState('nada que deshacer'); return; }
    M.layout = JSON.parse(M.undo.pop());
    if (M.layout.floor) applyFloorSize(M.layout.floor.wm, M.layout.floor.dm);
    closePanel(); rebuildEnvironment(); rebuildScene(); updateFloorUi();
    M.dirty = true; saveState('accion deshecha', 'dirty');
  }

  function saveState(txt, cls) {
    var el = document.getElementById('mapa-save-state');
    if (!el) return; el.textContent = txt || ''; el.className = 'mapa-save-state ' + (cls || '');
  }

  /* ── layout demo (primer arranque / modo local) ──────── */

  function demoLayout() {
    return { v: 1, floor: { wm: 72, dm: 72 },
      nodes: [
        { id: 'edge', kind: 'edge', x: 18, z: 18, label: 'Edge101', rot: 0, bind: { type: '', key: '' } },
        { id: 'plc-prod', kind: 'plc', x: 9, z: 9, label: 'PLC Produccion', rot: 0, bind: { type: 'modbus', key: '3' } },
        { id: 'motor-prod', kind: 'motor', x: 5, z: 13, label: 'Motor Bomba', rot: 0, bind: { type: 'can', key: '0x181' } },
        { id: 'sensor-prod', kind: 'sensor', x: 13, z: 6, label: 'Sensor Temp', rot: 0, bind: { type: 'ble', key: '55:44:33:22:11:00' } },
        { id: 'io-prod', kind: 'io', x: 6, z: 6, label: 'Remota I/O Prod', rot: 0, bind: { type: 'modbus', key: '1' } },
        { id: 'plc-srv', kind: 'plc', x: 27, z: 9, label: 'PLC Servidores', rot: 0, bind: { type: 'modbus', key: '5' } },
        { id: 'io-srv', kind: 'io', x: 31, z: 6, label: 'Gabinete I/O', rot: 0, bind: { type: 'modbus', key: '2' } },
        { id: 'hmi-srv', kind: 'hmi', x: 31, z: 13, label: 'HMI Servidores', rot: 180, bind: { type: '', key: '' } },
        { id: 'plc-alm', kind: 'plc', x: 9, z: 27, label: 'PLC Almacen', rot: 0, bind: { type: 'modbus', key: '7' } },
        { id: 'io-alm', kind: 'io', x: 6, z: 31, label: 'Remota Almacen', rot: 0, bind: { type: 'modbus', key: '12' } },
        { id: 'sensor-alm', kind: 'sensor', x: 13, z: 31, label: 'Sensor Puerta', rot: 0, bind: { type: 'ble', key: 'DE:AD:BE:EF:00:01' } },
        { id: 'plc-ctrl', kind: 'plc', x: 27, z: 27, label: 'PLC Control', rot: 0, bind: { type: 'can', key: '0x583' } },
        { id: 'hmi-ctrl', kind: 'hmi', x: 31, z: 27, label: 'HMI Control', rot: 180, bind: { type: '', key: '' } },
        { id: 'vfd-ctrl', kind: 'vfd', x: 27, z: 31, label: 'Variador', rot: 0, bind: { type: 'can', key: '0x701' } }
      ],
      cables: [
        { from: 'edge', to: 'plc-prod', bus: 'modbus' },
        { from: 'edge', to: 'plc-srv', bus: 'modbus' },
        { from: 'edge', to: 'plc-alm', bus: 'modbus' },
        { from: 'edge', to: 'plc-ctrl', bus: 'can' },
        { from: 'edge', to: 'hmi-ctrl', bus: 'ethernet' },
        { from: 'plc-prod', to: 'motor-prod', bus: 'can' },
        { from: 'plc-prod', to: 'sensor-prod', bus: 'ble' },
        { from: 'plc-prod', to: 'io-prod', bus: 'modbus' },
        { from: 'plc-srv', to: 'io-srv', bus: 'modbus' },
        { from: 'plc-srv', to: 'hmi-srv', bus: 'ethernet' },
        { from: 'plc-alm', to: 'io-alm', bus: 'modbus' },
        { from: 'plc-alm', to: 'sensor-alm', bus: 'ble' },
        { from: 'plc-ctrl', to: 'hmi-ctrl', bus: 'ethernet' },
        { from: 'plc-ctrl', to: 'vfd-ctrl', bus: 'can' }
      ],
      walls: [
        { id: 'wp1', x1: 0, z1: 0, x2: 36, z2: 0, h: WALL_H },
        { id: 'wp2', x1: 36, z1: 0, x2: 36, z2: 36, h: WALL_H },
        { id: 'wp3', x1: 36, z1: 36, x2: 0, z2: 36, h: WALL_H },
        { id: 'wp4', x1: 0, z1: 36, x2: 0, z2: 0, h: WALL_H },
        { id: 'wh1', x1: 0, z1: 18, x2: 16, z2: 18, h: WALL_H },
        { id: 'wh2', x1: 20, z1: 18, x2: 36, z2: 18, h: WALL_H },
        { id: 'wv1', x1: 18, z1: 0, x2: 18, z2: 16, h: WALL_H },
        { id: 'wv2', x1: 18, z1: 20, x2: 18, z2: 36, h: WALL_H }
      ],
      props: [
        { id: 'b1', file: 'city/building-c.glb', x: 8, z: -6, rot: 0, scale: 1.1 },
        { id: 'b2', file: 'city/building-a.glb', x: 20, z: -6, rot: 0, scale: 1 },
        { id: 'b3', file: 'city/building-l.glb', x: 42, z: 10, rot: 90, scale: 1 },
        { id: 'b4', file: 'city/building-q.glb', x: 42, z: 26, rot: 90, scale: 1 },
        { id: 'b5', file: 'city/building-h.glb', x: -6, z: 12, rot: 270, scale: 1 },
        { id: 'b6', file: 'city/building-e.glb', x: -6, z: 26, rot: 270, scale: 1 },
        { id: 'b7', file: 'city/building-m.glb', x: 14, z: 42, rot: 180, scale: 1 },
        { id: 'b8', file: 'city/building-g.glb', x: 28, z: 42, rot: 180, scale: 1 },
        { id: 't1', file: 'city/detail-tank.glb', x: 24, z: 4, rot: 0, scale: 1 },
        { id: 'ch1', file: 'city/chimney-medium.glb', x: 4, z: 4, rot: 0, scale: 1 }
      ] };
  }

  /* ── datos en vivo ───────────────────────────────────── */

  function fetchLive() {
    if (!M.visible) return;
    pull('/api/ble/devices', 'ble', window.MOCK_BLE);
    pull('/api/modbus', 'modbus', window.MOCK_MODBUS);
    pull('/api/can', 'can', window.MOCK_CAN);
    pull('/api/alerts', 'alerts', window.MOCK_ALERTAS);
  }

  function pull(url, key, mock) {
    fetch(url).then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) { M.live[key] = d || []; refreshStatuses(); })
      .catch(function () { if (mock) { M.live[key] = mock; refreshStatuses(); } });
  }

  /* ── dispositivos BLE moviles (simulacion) ───────────── */

  function initAgents() {
    if (M.agents.length || !M.ready) return;
    AGENTS_SEED.forEach(function (s) {
      var a = { mac: s.mac, name: s.name, color: s.color, speed: s.speed,
        pos: randInside(), target: randInside(), obj: buildAgent(s) };
      a.obj.position.copy(a.pos);
      a.obj.traverse(function (o) { o.userData.agentId = a.mac; });
      M.gl.scene.add(a.obj); M.agents.push(a);
    });
  }

  function randInside() {
    var lx = (GRIDX * CELL) / 2 - CELL, lz = (GRIDZ * CELL) / 2 - CELL;
    return new THREE.Vector3((Math.random() * 2 - 1) * lx, 0, (Math.random() * 2 - 1) * lz);
  }

  function buildAgent(s) {
    var g = new THREE.Group();
    var body = cyl(0.5, 0.62, 1.4, s.color, { emissive: s.color, ei: 0.22 });
    body.position.y = 0.9; g.add(body);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 16), mat(s.color, { emissive: s.color, ei: 0.3 }));
    head.position.y = 1.9; head.castShadow = true; g.add(head);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 8, 24),
      new THREE.MeshStandardMaterial({ color: s.color, emissive: s.color, emissiveIntensity: 0.9 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
    var lab = makeLabel(s.name, hexCss(s.color), 0.5); lab.position.y = 3; g.add(lab);
    return g;
  }

  function updateAgents(dt) {
    M.agents.forEach(function (a) {
      var d = a.target.clone().sub(a.pos); var len = d.length();
      if (len < 0.6) { a.target = randInside(); return; }
      d.normalize(); a.pos.addScaledVector(d, Math.min(a.speed * dt, len));
      a.obj.position.copy(a.pos); a.obj.rotation.y = Math.atan2(d.x, d.z);
    });
  }

  function rssiFromMeters(m) {
    var r = -40 - 23 * Math.log10(Math.max(0.3, m));  // path-loss log: A=40dBm@1m, n=2.3
    return Math.max(-99, Math.min(-30, Math.round(r)));
  }

  function agentDistances(a) {
    var out = M.layout.nodes.map(function (n) {
      var w = gridToWorld(n.x, n.z);
      var dx = a.pos.x - w.x, dz = a.pos.z - w.z;
      var meters = Math.sqrt(dx * dx + dz * dz) * MPU;
      return { id: n.id, label: n.label || (KINDS[n.kind] || KINDS.io).label,
        isEdge: n.kind === 'edge', color: (KINDS[n.kind] || KINDS.io).color,
        meters: meters, rssi: rssiFromMeters(meters) };
    });
    out.sort(function (p, q) { return p.meters - q.meters; });
    return out;
  }

  function agentByMac(mac) { return M.agents.filter(function (a) { return a.mac === mac; })[0]; }

  function pickAgent(ev) {
    if (!M.agents.length) return null;
    M.gl.ray.setFromCamera(ndc(ev), M.gl.camera);
    var objs = M.agents.map(function (a) { return a.obj; });
    var hit = M.gl.ray.intersectObjects(objs, true)[0];
    return hit ? hit.object.userData.agentId : null;
  }

  function selectAgent(mac) {
    M.sel = null; M.selAgent = mac;
    document.getElementById('mapa-panel').classList.remove('oculto');
    var a = agentByMac(mac); if (a) buildDistLines(a);
    fillAgentPanel();
  }

  function fillAgentPanel() {
    var a = agentByMac(M.selAgent); if (!a) return;
    setText('mp-kind', 'Dispositivo BLE movil');
    var lab = document.getElementById('mp-label'); lab.value = a.name; lab.disabled = true;
    setStatusText('mp-estado', 'activo');
    setText('mp-bind', 'BLE · ' + a.mac);
    setText('mp-visto', 'en movimiento');
    var dists = agentDistances(a);
    var edge = dists.filter(function (d) { return d.isEdge; })[0];
    setText('mp-metric', edge ? edge.rssi + ' dBm al Edge' : '--');
    document.getElementById('mp-alert').classList.add('oculto');
    document.getElementById('mp-bindbox').classList.add('oculto');
    showXform(false);
    renderDistList(dists);
  }

  function renderDistList(dists) {
    var box = document.getElementById('mp-dist'); box.classList.remove('oculto');
    var html = '<div class="mapa-panel-dist-h">Distancia a equipos (tiempo real)</div>';
    dists.forEach(function (d) {
      html += '<div class="mapa-dist-row"><span class="mapa-dist-name ' + (d.isEdge ? 'edge' : '') + '">'
        + '<span class="mapa-leg-dot" style="background:' + hexCss(d.color) + '"></span>' + escapeTxt(d.label)
        + '</span><span class="mapa-dist-val"><strong>' + d.meters.toFixed(1) + ' m</strong> · '
        + d.rssi + ' dBm</span></div>';
    });
    box.innerHTML = html;
  }

  function makeLine(color) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.75 }));
  }

  function buildDistLines(a) {
    clearDistLines();
    var all = agentDistances(a);
    var pick = all.slice(0, 4);
    var edge = all.filter(function (d) { return d.isEdge; })[0];
    if (edge && pick.filter(function (d) { return d.isEdge; }).length === 0) pick.push(edge);
    pick.forEach(function (d) {
      var line = makeLine(d.color);
      var label = makeLabel(d.meters.toFixed(1) + ' m', hexCss(d.color), 0.42);
      M.gl.scene.add(line); M.gl.scene.add(label);
      M.distLines.push({ line: line, label: label, targetId: d.id });
    });
  }

  function clearDistLines() {
    M.distLines.forEach(function (l) { M.gl.scene.remove(l.line); M.gl.scene.remove(l.label); });
    M.distLines = [];
  }

  function updateDistLines() {
    var a = agentByMac(M.selAgent); if (!a) return;
    M.distLines.forEach(function (l) {
      var n = nodeById(l.targetId); if (!n) return;
      var w = gridToWorld(n.x, n.z);
      var arr = l.line.geometry.attributes.position.array;
      arr[0] = a.pos.x; arr[1] = 1.0; arr[2] = a.pos.z;
      arr[3] = w.x; arr[4] = 1.2; arr[5] = w.z;
      l.line.geometry.attributes.position.needsUpdate = true;
      l.label.position.set((a.pos.x + w.x) / 2, 2.1, (a.pos.z + w.z) / 2);
    });
  }

  function rebuildDistLabels() {
    var a = agentByMac(M.selAgent); if (!a) return;
    M.distLines.forEach(function (l) {
      var n = nodeById(l.targetId); if (!n) return;
      var w = gridToWorld(n.x, n.z);
      var dx = a.pos.x - w.x, dz = a.pos.z - w.z;
      var m = Math.sqrt(dx * dx + dz * dz) * MPU;
      M.gl.scene.remove(l.label);
      l.label = makeLabel(m.toFixed(1) + ' m', hexCss((KINDS[n.kind] || KINDS.io).color), 0.42);
      M.gl.scene.add(l.label);
    });
  }

  function updateSelection() {
    if (M.selAgent) {
      updateDistLines();
      if (M.frame % 12 === 0) fillAgentPanel();
      if (M.frame % 30 === 0) rebuildDistLabels();
    } else if (M.sel && M.frame % 30 === 0) {
      fillPanel(nodeById(M.sel));
    }
  }

  /* ── paleta y leyenda ────────────────────────────────── */

  function buildPalette() {
    var box = document.getElementById('mapa-palette'); if (!box) return;
    Object.keys(KINDS).filter(function (k) { return k !== 'edge'; }).forEach(function (k) {
      var b = document.createElement('button');
      b.className = 'mapa-pal-btn'; b.dataset.kind = k;
      b.innerHTML = '<span class="mapa-pal-swatch" style="background:' + hexCss(KINDS[k].color) + '"></span>' + KINDS[k].label;
      b.addEventListener('click', function () { armPalette(k, b); });
      box.appendChild(b);
    });
  }

  function toggleWall() {
    clearArmedPalette(); clearArmedProp(); setArmedCable(false); M.cableArming = false; M.cableFrom = null;
    document.getElementById('mapa-assets').classList.add('oculto');
    if (M.mode !== 'editar') setMode('editar');
    M.wallArming = !M.wallArming; M.wallFrom = null; setArmedWall(M.wallArming);
    hint(M.wallArming ? 'Pared: clic en el extremo inicial (Esc para salir)' : '');
  }

  function armPalette(kind, btn) {
    var same = M.armedKind === kind;
    clearArmedPalette(); clearArmedProp(); setArmedCable(false); M.cableArming = false; M.cableFrom = null;
    M.wallArming = false; setArmedWall(false);
    document.getElementById('mapa-assets').classList.add('oculto');
    M.armedKind = same ? null : kind;
    if (!same) { btn.classList.add('armado'); hint('Clic en el piso para colocar ' + KINDS[kind].label); }
    else hint('');
  }

  function clearArmedPalette() {
    M.armedKind = null;
    var btns = document.querySelectorAll('.mapa-pal-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('armado');
  }

  function setArmedCable(on) { document.getElementById('mapa-tool-cable').classList.toggle('armado', !!on); }

  function buildLegend() {
    var box = document.getElementById('mapa-legend'); if (!box) return;
    var html = '<span class="mapa-leg-item"><strong style="color:var(--text)">Estado:</strong></span>';
    html += legDot('Activo', ST.activo) + legDot('Inactivo', ST.inactivo) +
      legDot('Sin enlazar', ST.libre) + legDot('Alerta', ST.alerta);
    html += '<span class="mapa-leg-item" style="margin-left:.5rem"><strong style="color:var(--text)">Buses:</strong></span>';
    Object.keys(BUSES).forEach(function (b) { html += legLine(BUSES[b].label, BUSES[b].color); });
    box.innerHTML = html;
  }

  function legDot(label, color) {
    return '<span class="mapa-leg-item"><span class="mapa-leg-dot" style="background:' + hexCss(color) + '"></span>' + label + '</span>';
  }
  function legLine(label, color) {
    return '<span class="mapa-leg-item"><span class="mapa-leg-line" style="background:' + hexCss(color) + '"></span>' + label + '</span>';
  }

  /* ── biblioteca de assets ────────────────────────────── */

  function openAssets() {
    if (M.mode !== 'editar') setMode('editar');
    var ov = document.getElementById('mapa-assets'); ov.classList.toggle('oculto');
    if (!ov.classList.contains('oculto')) loadManifest();
  }

  function loadManifest() {
    if (M.manifest) { renderAssets(); return; }
    fetch('/models/manifest.json').then(function (r) { return r.json(); })
      .then(function (m) { M.manifest = m; renderAssets(); })
      .catch(function () { M.manifest = { factory: [], city: [] }; renderAssets(); });
  }

  function renderAssets() {
    var box = document.getElementById('mapa-assets-list'); if (!box) return;
    var q = (document.getElementById('mapa-assets-q').value || '').toLowerCase();
    var html = '';
    ['city', 'factory'].forEach(function (cat) {
      var items = (M.manifest[cat] || []).filter(function (f) { return f.toLowerCase().indexOf(q) >= 0; });
      if (!items.length) return;
      html += '<div class="mapa-assets-cat">' + (cat === 'city' ? 'Estructuras (city)' : 'Equipos y partes (factory)') + ' — ' + items.length + '</div>';
      html += '<div class="mapa-assets-grid">';
      items.forEach(function (f) {
        html += '<button class="mapa-asset" data-file="' + cat + '/' + f + '">' + escapeTxt(prettyFile(f)) + '</button>';
      });
      html += '</div>';
    });
    box.innerHTML = html || '<div class="rssi-empty">Sin resultados</div>';
    var btns = box.querySelectorAll('.mapa-asset');
    for (var i = 0; i < btns.length; i++) btns[i].addEventListener('click', onAssetClick);
  }

  function onAssetClick(ev) { armProp(ev.currentTarget.dataset.file); }

  function armProp(file) {
    clearArmedPalette(); setArmedCable(false); M.cableArming = false;
    M.wallArming = false; setArmedWall(false);
    M.armedProp = file;
    document.getElementById('mapa-assets').classList.add('oculto');
    hint('Clic en el piso para colocar: ' + prettyFile(file));
  }

  /* ── utilidades ──────────────────────────────────────── */

  function nodeById(id) { return M.layout.nodes.filter(function (n) { return n.id === id; })[0]; }
  function newId() { return 'n' + (M.layout.nodes.length) + '_' + Math.floor(M.clock * 1000 % 100000); }
  function uniq(arr) { var o = {}; return arr.filter(function (v) { if (o[v]) return false; o[v] = 1; return true; }); }
  function hexCss(c) { return '#' + ('000000' + c.toString(16)).slice(-6); }
  function escapeTxt(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  function showXform(on, type) {
    var el = document.getElementById('mp-xform'); if (!el) return;
    el.classList.toggle('oculto', !on);
    var wall = type === 'wall';
    ['rx', 'ry', 'rz', 'ey'].forEach(function (k) {
      document.getElementById('mp-xrow-' + k).classList.toggle('oculto', wall);
    });
    document.getElementById('mp-xk-sc').textContent = wall ? 'Altura' : 'Escala';
    if (on) syncXform();
  }

  function onXform(ev) {
    var b = ev.target.closest ? ev.target.closest('button') : ev.target;
    if (!b) return;
    if (b.id === 'mp-xdel') { deleteSelected(); return; }
    var ds = b.dataset;
    if (ds.rx) rotateAxis('rx', +ds.rx);
    else if (ds.ry) rotateAxis('ry', +ds.ry);
    else if (ds.rz) rotateAxis('rz', +ds.rz);
    else if (ds.ey) elevate(+ds.ey);
    else if (ds.sc) scaleSelected(+ds.sc);
  }
  function glFail() { var el = document.getElementById('mapa-gl-fail'); if (el) el.classList.remove('oculto'); }

  function fmtAgo(ms) {
    if (ms < 1000) return 'ahora';
    if (ms < 60000) return 'hace ' + Math.floor(ms / 1000) + 's';
    if (ms < 3600000) return 'hace ' + Math.floor(ms / 60000) + 'm';
    return 'hace ' + Math.floor(ms / 3600000) + 'h';
  }

  function resize() { syncSize(); }

  function syncSize() {
    if (!M.ready) return;
    var c = M.gl.canvas, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width === Math.floor(w * M.gl.renderer.getPixelRatio()) &&
        c.height === Math.floor(h * M.gl.renderer.getPixelRatio())) return;
    M.gl.renderer.setSize(w, h, false);
    M.gl.camera.aspect = w / h; M.gl.camera.updateProjectionMatrix();
  }

  /* ── visibilidad / ciclo de vida ─────────────────────── */

  function onSection() {
    var planta = (window.location.hash || '').indexOf('planta') >= 0;
    if (planta && !M.visible) enter();
    else if (!planta && M.visible) leave();
  }

  function enter() {
    if (!M.ready && !initGL()) return;
    M.visible = true;
    if (!M.layout) loadLayout();
    resize();
    fetchLive();
    if (!M.pollTimer) M.pollTimer = setInterval(fetchLive, 4000);
    if (!M.raf) loop();
  }

  function leave() {
    M.visible = false;
    if (M.pollTimer) { clearInterval(M.pollTimer); M.pollTimer = null; }
  }

  /* ── init ────────────────────────────────────────────── */

  function wireUi() {
    document.getElementById('mapa-modo-ver').addEventListener('click', function () { setMode('ver'); });
    document.getElementById('mapa-modo-editar').addEventListener('click', function () { setMode('editar'); });
    document.getElementById('mapa-tool-cable').addEventListener('click', function () {
      clearArmedPalette(); clearArmedProp(); M.wallArming = false; setArmedWall(false);
      M.cableArming = !M.cableArming; M.cableFrom = null;
      setArmedCable(M.cableArming); hint(M.cableArming ? 'Cable: clic en el equipo origen' : '');
    });
    document.getElementById('mapa-tool-wall').addEventListener('click', toggleWall);
    document.getElementById('mapa-floor-apply').addEventListener('click', applyFloorFromUi);
    document.getElementById('mapa-tool-borrar').addEventListener('click', deleteSelected);
    document.getElementById('mapa-undo').addEventListener('click', undo);
    document.getElementById('mp-xform').addEventListener('click', onXform);
    document.getElementById('mp-xform').addEventListener('change', onXformInput);
    document.getElementById('mapa-tool-assets').addEventListener('click', openAssets);
    document.getElementById('mapa-assets-close').addEventListener('click', function () { document.getElementById('mapa-assets').classList.add('oculto'); });
    document.getElementById('mapa-assets-q').addEventListener('input', renderAssets);
    document.getElementById('mapa-guardar').addEventListener('click', saveLayout);
    document.getElementById('mapa-panel-x').addEventListener('click', closePanel);
    document.getElementById('mapa-zoom-in').addEventListener('click', function () { M.cam.dist = Math.max(30, M.cam.dist - 16); });
    document.getElementById('mapa-zoom-out').addEventListener('click', function () { M.cam.dist = Math.min(800, M.cam.dist + 16); });
    document.getElementById('mapa-zoom-fit').addEventListener('click', fitView);
    document.getElementById('mp-bind-type').addEventListener('change', onBindTypeChange);
    document.getElementById('mp-bind-key').addEventListener('change', function () { applyBindKey(); });
    document.getElementById('mp-label').addEventListener('input', onLabelEdit);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', function () { if (M.visible) resize(); });
    window.addEventListener('hashchange', onSection);
  }

  function onLabelEdit() {
    var node = nodeById(M.sel); if (!node || M.mode !== 'editar') return;
    node.label = document.getElementById('mp-label').value; setNodeLabel(node); markDirty();
  }

  function onKey(ev) {
    if (!M.visible) return;
    if (ev.key === 'Escape') {
      clearArmedPalette(); clearArmedProp(); M.cableArming = false; M.cableFrom = null;
      M.wallArming = false; M.wallFrom = null; setArmedWall(false);
      setArmedCable(false); document.getElementById('mapa-assets').classList.add('oculto'); hint('');
    }
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'z' || ev.key === 'Z')) {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      ev.preventDefault(); undo(); return;
    }
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (M.mode !== 'editar') return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') deleteSelected();
    else if (ev.key === 'r' || ev.key === 'R') rotateSelected();
    else if (ev.key === '[') scaleSelected(0.85);
    else if (ev.key === ']') scaleSelected(1.18);
  }

  function hint(t) { var el = document.getElementById('mapa-hint'); if (el) el.textContent = t || ''; }

  function start() {
    if (!document.getElementById('mapa-canvas')) return;
    buildPalette(); buildLegend(); wireUi(); onSection();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

})();
