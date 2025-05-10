// ── IMPORTS ────────────────────────────────────────────────────────────────
// Three.js som ES-module
import * as THREE        from './libs/three/build/three.module.js';
// Exempel-moduler
import { GLTFLoader }    from './libs/three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from './libs/three/examples/jsm/controls/OrbitControls.js';
import { Sky }           from './libs/three/examples/jsm/objects/Sky.js';
// Cannon-ES (fysik)
import * as CANNON       from './libs/cannon-es/dist/cannon-es.js';
// Ammo.js WASM‐init
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
const ORIGIN       = new CANNON.Vec3(0,0,0);

// ── INIT WHEN Ammo WASM READY ─────────────────────────────────────────────
AmmoInit().then(Ammo => {
  window.Ammo = Ammo;
  init();
});

// ── INIT-FUNKTION ─────────────────────────────────────────────────────────
async function init(){
  clock = new THREE.Clock();

  // Scen, kamera, renderer
  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 3e4);
  camera.position.set(0,8,35);
  renderer = new THREE.WebGLRenderer({antialias:true, canvas:document.getElementById('c')});
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.7;

  // OrbitControls
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.05;
  orbit.minDistance   = 5;
  orbit.maxDistance   = 250;
  orbit.enabled       = false;

  // Sky
  const sky = new Sky();
  sky.scale.setScalar(2e4);
  scene.add(sky);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI/2.4, Math.PI/2);
  Object.assign(sky.material.uniforms, {
    turbidity:      { value:10 },
    rayleigh:       { value:2 },
    mieCoefficient: { value:0.004 },
    mieDirectionalG:{ value:0.8 },
    sunPosition:    { value:sunDir }
  });
  const sunLight = new THREE.DirectionalLight(0xffffff,4);
  sunLight.position.copy(sunDir.multiplyScalar(500));
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048,2048);
  const s = 250;
  sunLight.shadow.camera.left   = -s;
  sunLight.shadow.camera.right  =  s;
  sunLight.shadow.camera.top    =  s;
  sunLight.shadow.camera.bottom = -s;
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0xffffff,0.35));

  // Cannon-ES world
  world = new CANNON.World({ gravity:new CANNON.Vec3(0,-9.81,0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  const tarmacMat = new CANNON.Material('tarmac');
  world.addContactMaterial(new CANNON.ContactMaterial(tarmacMat, tarmacMat, {
    friction:0.5, restitution:0
  }));

  // Runway
  const runHalf = new CANNON.Vec3(25,0.2,600);
  runwayBody = new CANNON.Body({
    mass:0, shape:new CANNON.Box(runHalf),
    material:tarmacMat, position:new CANNON.Vec3(0,runHalf.y,0)
  });
  world.addBody(runwayBody);
  const runMesh = new THREE.Mesh(
    new THREE.BoxGeometry(runHalf.x*2,runHalf.y*2,runHalf.z*2),
    new THREE.MeshStandardMaterial({color:0x414141,roughness:0.7})
  );
  runMesh.position.copy(runwayBody.position);
  runMesh.receiveShadow = true;
  scene.add(runMesh);

  // Ground
  const gMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(8000,8000),
    new THREE.MeshStandardMaterial({color:0x305e26,roughness:0.93})
  );
  gMesh.rotation.x = -Math.PI/2;
  gMesh.receiveShadow = true;
  scene.add(gMesh);
  const gBody = new CANNON.Body({
    mass:0, shape:new CANNON.Plane(), material:tarmacMat
  });
  gBody.quaternion.setFromEuler(-Math.PI/2,0,0);
  world.addBody(gBody);

  // Ladda jet‐modell
  try {
    planeMesh = await loadGLB('source/F152.glb');
    planeMesh.scale.set(1.6,1.6,1.6);
    planeMesh.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; }});
    scene.add(planeMesh);
    const half = new CANNON.Vec3(2.5,0.8,7);
    planeBody = new CANNON.Body({
      mass:MASS, shape:new CANNON.Box(half),
      material:tarmacMat, angularDamping:0.7, linearDamping:0.1
    });
    world.addBody(planeBody);
  } catch(e) {
    console.error('Error loading jet',e);
    overlay.textContent = 'Error loading jet. Se konsol.';
    return;
  }

  // Eventlisteners & start
  window.addEventListener('resize',onResize);
  document.addEventListener('keydown',onKeyDown);
  document.addEventListener('keyup',onKeyUp);
  document.getElementById('reset').addEventListener('click',reset);
  reset();
  overlay.remove();
  animate();
}

// ── ÖVRIGA FUNKTIONER ──────────────────────────────────────────────────────
async function loadGLB(url){
  const loader = new GLTFLoader();
  return new Promise((res,rej)=>
    loader.load(url, gltf=>res(gltf.scene),undefined,rej)
  );
}

function reset(){
  throttle=0;
  planeBody.velocity.setZero();
  planeBody.angularVelocity.setZero();
  const y0 = runwayBody.position.y + planeBody.shapes[0].halfExtents.y + 0.8;
  planeBody.position.set(0,y0,-runwayBody.shapes[0].halfExtents.z+50);
  planeBody.quaternion.setFromEuler(0,Math.PI,0);
  planeMesh.position.copy(planeBody.position);
  planeMesh.quaternion.copy(planeBody.quaternion);
}

function onKeyDown(e){
  keys[e.key.toLowerCase()] = true;
  if(e.key==='r') reset();
  if(e.key==='h') helpBox.style.display = helpBox.style.display===''?'none':'';
  if(e.key==='o') orbit.enabled = !orbit.enabled;
}

function onKeyUp(e){
  keys[e.key.toLowerCase()] = false;
}

function onResize(){
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
}

function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(),0.025);

  // Throttle
  if(keys['w']) throttle = Math.min(1, throttle + dt*0.5);
  if(keys['s']) throttle = Math.max(0, throttle - dt*0.5);
  planeBody.applyLocalForce(new CANNON.Vec3(0,0,-MAX_THRUST*throttle),ORIGIN);

  // Aerodynamik
  const speed = planeBody.velocity.length();
  if(speed>0.5){
    const L = 0.5*RHO*speed*speed*WING_AREA*CL;
    planeBody.applyLocalForce(new CANNON.Vec3(0,L,0),ORIGIN);
    const D = 0.5*RHO*speed*speed*WING_AREA*CD;
    const dv = planeBody.velocity.clone();
    if(dv.lengthSquared()>1e-9){
      dv.normalize().scale(-D,dv);
      planeBody.applyForce(dv, planeBody.position);
    }
  }

  // Controls
  const tq = new CANNON.Vec3();
  if(keys['arrowup'])    tq.x -= TORQUE_PITCH*dt;
  if(keys['arrowdown'])  tq.x += TORQUE_PITCH*dt;
  if(keys['arrowleft'])  tq.z += TORQUE_ROLL*dt;
  if(keys['arrowright']) tq.z -= TORQUE_ROLL*dt;
  if(keys['a'])          tq.y += TORQUE_YAW*dt;
  if(keys['d'])          tq.y -= TORQUE_YAW*dt;
  if(tq.lengthSquared()>1e-9){
    planeBody.applyTorque(planeBody.vectorToWorldFrame(tq));
  } else {
    planeBody.torque.setZero();
  }

  world.step(1/60, dt, 3);

  // Sync mesh
  planeMesh.position.copy(planeBody.position);
  planeMesh.quaternion.copy(planeBody.quaternion);

  // Kamera
  if(orbit.enabled){
    orbit.target.copy(planeMesh.position);
    orbit.update();
  } else {
    const off = new THREE.Vector3(0,6,30).applyQuaternion(planeMesh.quaternion);
    camera.position.lerp(planeMesh.position.clone().add(off),0.1);
    camera.lookAt(planeMesh.position.x, planeMesh.position.y+2, planeMesh.position.z);
  }

  // HUD
  const alt = planeBody.position.y - (
    Math.abs(planeBody.position.x - runwayBody.position.x) < runwayBody.shapes[0].halfExtents.x &&
    Math.abs(planeBody.position.z - runwayBody.position.z) < runwayBody.shapes[0].halfExtents.z
      ? runwayBody.position.y + runwayBody.shapes[0].halfExtents.y : 0
  );
  hud.textContent = `ALT: ${alt.toFixed(0)} m\nSPD: ${(speed*3.6).toFixed(0)} km/h\nTHR: ${(throttle*100).toFixed(0)} %`;

  renderer.render(scene, camera);
}
