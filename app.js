// app.js

// ── IMPORTS ────────────────────────────────────────────────────────────────
// Three.js som ES‐module
import * as THREE        from './libs/three/build/three.module.js';
// Tre exempel‐moduler
import { GLTFLoader }    from './libs/three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from './libs/three/examples/jsm/controls/OrbitControls.js';
import { Sky }           from './libs/three/examples/jsm/objects/Sky.js';
// Cannon-ES (fysik)
import * as CANNON       from './libs/cannon-es/dist/cannon-es.js';
// Ammo.js WASM-initialiserare
import AmmoInit          from './libs/ammo/builds/ammo.wasm.js';

// ── GLOBALA VARIABLER ─────────────────────────────────────────────────────
let scene, camera, renderer, clock, orbit;
let world, planeBody, planeMesh, runwayBody;
const hud     = document.getElementById('hud');
const overlay = document.getElementById('overlay');
const helpBox = document.getElementById('help');
const keys    = Object.create(null);
let throttle  = 0;

// Flygplanets fysik‐konstanter
const MASS         = 1.8e4;
const WING_AREA    = 60;
const MAX_THRUST   = 1.6e5;
const CL           = 0.9;
const CD           = 0.03;
const RHO          = 1.225;
const TORQUE_PITCH = 2.5e6;
const TORQUE_ROLL  = 3.2e6;
const TORQUE_YAW   = 1.2e6;

// En konstant noll‐punkt (återanvänds för lokala krafter)
const ORIGIN = new CANNON.Vec3(0, 0, 0);

// ── STARTA NÄR Ammo.js ÄR KLAR ────────────────────────────────────────────
AmmoInit().then(Ammo => {
  // “window.Ammo” används av load‐funktionen längre ner
  window.Ammo = Ammo;
  init();
});

// ── INITIALISERING ────────────────────────────────────────────────────────
async function init() {
  console.log("Initiera Ultra-Flight Sim v4 (F152 Jet)…");
  clock = new THREE.Clock();

  // Scen & kamera
  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 3e4);
  camera.position.set(0, 8, 35);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('c') });
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled    = true;
  renderer.toneMapping          = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.7;

  // OrbitControls (default avstängd)
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping   = true;
  orbit.dampingFactor   = 0.05;
  orbit.minDistance     = 5;
  orbit.maxDistance     = 250;
  orbit.enabled         = false;

  // Himmel (Sky)
  const sky = new Sky();
  sky.scale.setScalar(2e4);
  scene.add(sky);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI/2.4, Math.PI/2);
  Object.assign(sky.material.uniforms, {
    turbidity:       { value: 10 },
    rayleigh:        { value: 2 },
    mieCoefficient:  { value: 0.004 },
    mieDirectionalG: { value: 0.8 },
    sunPosition:     { value: sunDir }
  });
  const sunLight = new THREE.DirectionalLight(0xffffff, 4);
  sunLight.position.copy(sunDir.clone().multiplyScalar(500));
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far  = 1000;
  const s = 250;
  sunLight.shadow.camera.left   = -s;
  sunLight.shadow.camera.right  =  s;
  sunLight.shadow.camera.top    =  s;
  sunLight.shadow.camera.bottom = -s;
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  // CANNON‐värld
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  const tarmacMat = new CANNON.Material('tarmac');
  world.addContactMaterial(new CANNON.ContactMaterial(tarmacMat, tarmacMat, {
    friction:    0.5,
    restitution: 0
  }));

  // Bana (runway)
  const runHalf = new CANNON.Vec3(25, 0.2, 600);
  runwayBody = new CANNON.Body({
    mass:     0,
    shape:    new CANNON.Box(runHalf),
    material: tarmacMat,
    position: new CANNON.Vec3(0, runHalf.y, 0)
  });
  world.addBody(runwayBody);
  const runMesh = new THREE.Mesh(
    new THREE.BoxGeometry(runHalf.x*2, runHalf.y*2, runHalf.z*2),
    new THREE.MeshStandardMaterial({ color: 0x414141, roughness: 0.7 })
  );
  runMesh.position.copy(runwayBody.position);
  runMesh.receiveShadow = true;
  scene.add(runMesh);

  // Mark (plane)
  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000),
    new THREE.MeshStandardMaterial({ color: 0x305e26, roughness: 0.93 })
  );
  groundMesh.rotation.x = -Math.PI/2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
  const groundBody = new CANNON.Body({
    mass:  0,
    shape: new CANNON.Plane(),
    material: tarmacMat
  });
  groundBody.quaternion.setFromEuler(-Math.PI/2, 0, 0);
  world.addBody(groundBody);

  // Ladda in jet‐modellen
  try {
    planeMesh = await loadGLB('source/F152.glb');
    planeMesh.scale.set(1.6, 1.6, 1.6);
    planeMesh.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    scene.add(planeMesh);

    // Fysikkropp för planet
    const boxHalf = new CANNON.Vec3(2.5, 0.8, 7);
    planeBody = new CANNON.Body({
      mass: MASS,
      shape: new CANNON.Box(boxHalf),
      material: tarmacMat,
      angularDamping: 0.7,
      linearDamping:  0.1
    });
    world.addBody(planeBody);

  } catch (err) {
    console.error('Error loading F152.glb', err);
    overlay.textContent = 'Error loading jet. Check console.';
    return;
  }

  // Event‐listeners
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup',   onKeyUp);
  document.getElementById('reset').addEventListener('click', reset);

  // Startläge, ta bort overlay, börja loopen
  reset();
  overlay.remove();
  console.log('Init complete, starting loop');
  animate();
}

// ── Hjälpfunktioner ────────────────────────────────────────────────────────
async function loadGLB(url) {
  const loader = new GLTFLoader();
  return new Promise((res, rej) =>
    loader.load(url, gltf => res(gltf.scene), undefined, rej)
  );
}

function reset() {
  if (!planeBody || !runwayBody) return;
  throttle = 0;
  planeBody.velocity.setZero();
  planeBody.angularVelocity.setZero();
  const startY = runwayBody.position.y + planeBody.shapes[0].halfExtents.y + 0.5;
  planeBody.position.set(0, startY, -runwayBody.shapes[0].halfExtents.z + 50);
  planeBody.quaternion.setFromEuler(0, Math.PI, 0);

  if (planeMesh) {
    planeMesh.position.copy(planeBody.position);
    planeMesh.quaternion.copy(planeBody.quaternion);
  }
}

function onKeyDown(e) {
  keys[e.key.toLowerCase()] = true;
  if (e.key === 'r') reset();
  if (e.key === 'h') helpBox.style.display = helpBox.style.display === 'none' ? '' : 'none';
  if (e.key === 'o') orbit.enabled = !orbit.enabled;
}

function onKeyUp(e) {
  keys[e.key.toLowerCase()] = false;
}

function onWindowResize() {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.025);

  if (!planeBody || !planeMesh || !world) {
    return renderer.render(scene, camera);
  }

  // Throttle
  if (keys['w']) throttle = Math.min(1, throttle + dt * 0.5);
  if (keys['s']) throttle = Math.max(0, throttle - dt * 0.5);
  planeBody.applyLocalForce(new CANNON.Vec3(0, 0, -MAX_THRUST * throttle), ORIGIN);

  // Aerodynamik
  const speed = planeBody.velocity.length();
  if (speed > 0.5) {
    const lift = 0.5 * RHO * speed * speed * WING_AREA * CL;
    planeBody.applyLocalForce(new CANNON.Vec3(0, lift, 0), ORIGIN);

    const dragMag = 0.5 * RHO * speed * speed * WING_AREA * CD;
    const dragVec = planeBody.velocity.clone().normalize().scale(-dragMag, new CANNON.Vec3());
    planeBody.applyForce(dragVec, planeBody.position);
  }

  // Control torques
  const tq = new CANNON.Vec3();
  if (keys['arrowup'])   tq.x -= TORQUE_PITCH * dt;
  if (keys['arrowdown']) tq.x += TORQUE_PITCH * dt;
  if (keys['arrowleft']) tq.z += TORQUE_ROLL  * dt;
  if (keys['arrowright'])tq.z -= TORQUE_ROLL  * dt;
  if (keys['a'])         tq.y += TORQUE_YAW   * dt;
  if (keys['d'])         tq.y -= TORQUE_YAW   * dt;

  if (tq.lengthSquared() > 1e-9) {
    const worldTq = planeBody.vectorToWorldFrame(tq);
    planeBody.applyTorque(worldTq);
  } else {
    planeBody.torque.setZero();
  }

  world.step(1/60, dt, 3);

  // Sync Three‐mesh
  planeMesh.position.copy(planeBody.position);
  planeMesh.quaternion.copy(planeBody.quaternion);

  // Kamera‐uppdatering
  if (orbit.enabled) {
    orbit.target.copy(planeMesh.position);
    orbit.update();
  } else {
    const camOff = new THREE.Vector3(0, 6, 30)
      .applyQuaternion(planeMesh.quaternion);
    camera.position.lerp(planeMesh.position.clone().add(camOff), 0.1);
    camera.lookAt(planeMesh.position.x, planeMesh.position.y + 2, planeMesh.position.z);
  }

  // HUD
  const altitude = planeBody.position.y - (
    Math.abs(planeBody.position.x - runwayBody.position.x) < runwayBody.shapes[0].halfExtents.x &&
    Math.abs(planeBody.position.z - runwayBody.position.z) < runwayBody.shapes[0].halfExtents.z
      ? runwayBody.position.y + runwayBody.shapes[0].halfExtents.y
      : 0
  );
  hud.textContent = 
    `ALT: ${altitude.toFixed(0)} m\n` +
    `SPD: ${(planeBody.velocity.length() * 3.6).toFixed(0)} km/h\n` +
    `THR: ${(throttle * 100).toFixed(0)} %`;

  renderer.render(scene, camera);
}
