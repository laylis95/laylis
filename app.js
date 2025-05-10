// Vänta in Ammo.js WASM
Ammo().then(function(AmmoLib) {
  window.Ammo = AmmoLib;

  // 1) Scen, kamera, renderer
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({canvas});
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 1000);
  camera.position.set(0,5,15);

  // 2) OrbitControls
  const controls = new THREE.OrbitControls(camera, renderer.domElement);

  // 3) Fysik
  const physics = new PhysicsEngine();
  physics.init();
  physics.setGravity(-9.82);

  // 4) Skapa golv
  physics.addStaticPlane(new THREE.Vector3(0,1,0), 0);

  // 5) Skapa ditt plan/”jet”
  // ... koda din mesh + rigidbody som tidigare …

  // 6) Resize‐hantering
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // 7) Animationsloop
  (function animate(){
    requestAnimationFrame(animate);
    physics.step();
    physics.syncMeshes();
    controls.update();
    renderer.render(scene, camera);
  })();
});

// PhysicsEngine‐klass (samma du redan har)
class PhysicsEngine {
  /* … din tidigare PhysicsEngine‐kod … */
}
