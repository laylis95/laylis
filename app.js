<!DOCTYPE html>
<html lang="sv">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>3D Flygsimulator - Tangentbordskontroller</title>
    <style>
        body { margin: 0; overflow: hidden; font-family: 'Inter', sans-serif; background-color: #000; color: white; }
        canvas { display: block; }
        #info {
            position: absolute;
            top: 10px;
            width: 100%;
            text-align: center;
            font-size: 16px;
            z-index: 10;
        }
        /* UI Element Styling */
        .ui-element {
            position: absolute;
            background-color: rgba(0, 0, 0, 0.5);
            padding: 8px 12px;
            border-radius: 5px;
            font-size: 18px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            z-index: 10;
        }
        #airspeed-indicator { top: 40px; left: 20px; }
        /* Borttagen CSS för joystick och throttle */
        #crash-message {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: rgba(255, 0, 0, 0.7);
            color: white;
            padding: 20px;
            border-radius: 10px;
            font-size: 24px;
            font-weight: bold;
            z-index: 100;
            display: none; 
            text-align: center;
        }
    </style>
    <script type="importmap">
    {
      "imports": {
        "three": "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js",
        "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/"
      }
    }
    </script>
</head>
<body>
    <div id="info">W/S: Gas | A/D: Roll | Piltangenter Upp/Ner: Pitch | Mus: Kamera</div>
    <div id="airspeed-indicator" class="ui-element">
        Hastighet: <span id="airspeed-value">0</span> knop
    </div>
    <div id="crash-message">KRASCH!</div>

    <script type="module">
        import * as THREE from 'three';
        import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
        import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
        import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
        import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'; 
        import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
        import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

        let scene, camera, renderer, controls;
        let airplane; 
        let composer; 
        let airspeedValueElement, infoElement, crashMessageElement;
        // Borttagna joystick- och throttle-specifika variabler
        
        // Tangentbordsinput-status
        const keyStates = {};

        // Behåller throttleValue för gaspådrag, styrs nu av W/S
        let throttleValue = 0.0; // Starta med ingen gas
        const THROTTLE_INCREMENT = 0.02; // Hur mycket gasen ändras per tryck/frame
        const THROTTLE_DECREMENT_RATE = 0.01; // Hur snabbt gasen minskar om ingen tangent hålls nere

        // Behåller joystickInputX och joystickInputY för styrning, styrs nu av A/D och pilar
        let controlInputX = 0; // För Roll (A/D)
        let controlInputY = 0; // För Pitch (Upp/Ner Pilar)
        const CONTROL_INCREMENT = 0.05; // Hur mycket styrningen ändras per frame när tangent hålls nere
        const CONTROL_DECREMENT_RATE = 0.08; // Hur snabbt styrningen återgår till neutral


        const MAX_SPEED_INTERNAL = 3.5; 
        const MIN_SPEED_INTERNAL = 0.0; 
        const SPEED_TO_KNOTS_MULTIPLIER = 50; 
        let currentSpeedInternal = MIN_SPEED_INTERNAL;

        const PITCH_SENSITIVITY = 0.7; // Justerad känslighet för tangentbord
        const ROLL_SENSITIVITY = 0.8;  // Justerad känslighet för tangentbord

        const chaseCameraOffset = new THREE.Vector3(0, 70, 280);
        const cameraLookAtOffset = new THREE.Vector3(0, 5, -15);
        const cameraSmoothSpeed = 2.0; 

        let exhaustParticles, exhaustGeometry, exhaustMaterial;
        const MAX_EXHAUST_PARTICLES = 200;
        const exhaustParticlesArray = [];
        let exhaustSpawnOffset = new THREE.Vector3(0, -0.5, -2.5); 

        let grassTexture, runwayTexture;
        let propellerObject; 
        
        let panelTexture1, panelTexture2B;

        const GRAVITY_ACCELERATION = 15.0;     
        let verticalSpeed = 0;                 
        const LIFT_FORCE_FACTOR = 35.0;       
        const MAX_PITCH_FOR_LIFT = Math.PI / 3.5; 
        const MIN_SPEED_FOR_LIFT = 0.5;        
        const VERTICAL_DRAG_COEFFICIENT = 0.3; 
        const FORWARD_DRAG_COEFFICIENT = 0.005; 
        const THRUST_POWER = 5.0;             
        const AIRPLANE_MASS = 1.0;             

        const GROUND_COLLISION_THRESHOLD_Y = 2.0; 
        const START_POSITION = new THREE.Vector3(0, 60, 0); 
        let isCrashed = false;

        function init() {
            infoElement = document.getElementById('info');
            crashMessageElement = document.getElementById('crash-message'); 
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x87ceeb);
            scene.fog = new THREE.Fog(0x87ceeb, 700, 7000); 

            camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000); 
            camera.position.set(0, 50, 150); 

            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            renderer.outputEncoding = THREE.sRGBEncoding; 
            document.body.appendChild(renderer.domElement);

            const ambientLight = new THREE.AmbientLight(0xffffff, 0.9); 
            scene.add(ambientLight);
            const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5); 
            directionalLight.position.set(250, 400, 300);
            directionalLight.castShadow = true;
            directionalLight.shadow.mapSize.width = 4096;
            directionalLight.shadow.mapSize.height = 4096;
            directionalLight.shadow.camera.near = 0.5;
            directionalLight.shadow.camera.far = 2000;
            directionalLight.shadow.camera.left = -1000;
            directionalLight.shadow.camera.right = 1000;
            directionalLight.shadow.camera.top = 1000;
            directionalLight.shadow.camera.bottom = -1000;
            scene.add(directionalLight);
            
            grassTexture = createProceduralTexture(64, '#3A5F0B', '#2E4A08', 0.1, 0.05);
            grassTexture.wrapS = THREE.RepeatWrapping; grassTexture.wrapT = THREE.RepeatWrapping;
            grassTexture.repeat.set(150, 150); 

            runwayTexture = createProceduralTexture(128, '#404040', '#303030', 0.05, 0.02);
            runwayTexture.wrapS = THREE.RepeatWrapping; runwayTexture.wrapT = THREE.RepeatWrapping;
            runwayTexture.repeat.set(5, 60);

            const groundGeometry = new THREE.PlaneGeometry(15000, 15000); 
            const groundMaterial = new THREE.MeshStandardMaterial({ map: grassTexture, side: THREE.DoubleSide, roughness: 0.95 });
            const ground = new THREE.Mesh(groundGeometry, groundMaterial);
            ground.rotation.x = -Math.PI / 2;
            ground.receiveShadow = true;
            scene.add(ground);

            createRunway();
            loadTexturesAndModel(); 
            initExhaustSystem();

            controls = new OrbitControls(camera, renderer.domElement); 
            controls.enableDamping = true; controls.dampingFactor = 0.05;

            airspeedValueElement = document.getElementById('airspeed-value');

            composer = new EffectComposer(renderer); 
            const renderPass = new RenderPass(scene, camera); 
            composer.addPass(renderPass);
            const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.7, 0.1); 
            composer.addPass(bloomPass);

            // Tangentbordslyssnare
            window.addEventListener('keydown', (event) => { keyStates[event.code] = true; });
            window.addEventListener('keyup', (event) => { keyStates[event.code] = false; });


            window.addEventListener('resize', onWindowResize, false);
        }

        function loadTexturesAndModel() {
            const textureLoader = new THREE.TextureLoader();
            const texturePath = 'https://raw.githubusercontent.com/laylis95/laylis/master/textures/';
            let texturesToLoad = 2; 
            let texturesLoaded = 0;

            function onTextureLoaded() {
                texturesLoaded++;
                if (texturesLoaded >= texturesToLoad) { 
                    console.log("Primära texturer laddade, fortsätter med modell.");
                    loadAirplaneModel(); 
                }
            }
            function onTextureError(textureName, err) {
                console.error(`Error loading ${textureName}:`, err);
                onTextureLoaded(); 
            }

            panelTexture2B = textureLoader.load(
                `${texturePath}F22_3_T_2B.png`, 
                (tex) => { tex.encoding = THREE.sRGBEncoding; tex.flipY = false; console.log('Panel Texture 2B loaded'); onTextureLoaded(); }, 
                undefined, 
                (err) => onTextureError('Panel Texture 2B', err)
            );

            panelTexture1 = textureLoader.load(
                `${texturePath}F22_4_T_1.png`, 
                (tex) => { tex.encoding = THREE.sRGBEncoding; tex.flipY = false; console.log('Panel Texture 1 loaded'); onTextureLoaded(); }, 
                undefined, 
                (err) => onTextureError('Panel Texture 1', err)
            );
        }


        function loadAirplaneModel() {
            const gltfLoaderInstance = new GLTFLoader(); 
            const airplaneModelURL = 'https://raw.githubusercontent.com/laylis95/laylis/master/source/F152.glb'; 
            
            gltfLoaderInstance.load(
                airplaneModelURL, 
                (gltf) => {
                    airplane = gltf.scene;
                    airplane.scale.set(15, 15, 15); 
                    airplane.position.copy(START_POSITION); 
                    
                    let materialNames = new Set();
                    airplane.traverse(function (child) {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;

                            if (child.material) {
                                materialNames.add(child.material.name);
                                if (panelTexture2B && (child.material.name.includes('Panel') || child.material.name.includes('Fuselage') || child.material.name.includes('Body'))) {
                                    if (child.material.map === null) { 
                                        child.material.map = panelTexture2B;
                                        child.material.needsUpdate = true;
                                    }
                                } else if (panelTexture1 && (child.material.name.includes('Wing') || child.material.name.includes('Tail'))) {
                                     if (child.material.map === null) {
                                        child.material.map = panelTexture1;
                                        child.material.needsUpdate = true;
                                     }
                                }
                            }

                            if (child.name.toLowerCase().includes('propeller') || child.name.toLowerCase().includes('prop_geo') || child.name.toLowerCase().includes('propeller_mesh')) {
                                propellerObject = child;
                            }
                        }
                    });
                    console.log("Material names found in model:", Array.from(materialNames));

                    scene.add(airplane);
                    infoElement.textContent = "W/S: Gas | A/D: Roll | Piltangenter Upp/Ner: Pitch | Mus: Kamera";
                    setupAirplaneDependents();
                },
                (xhr) => { 
                    const percentLoaded = (xhr.loaded / xhr.total * 100).toFixed(0);
                    infoElement.textContent = `Laddar flygplan: ${percentLoaded}%`;
                },
                (error) => {
                    console.error(`Ett fel inträffade vid laddning av F152 GLTF-modell från ${airplaneModelURL}:`, error);
                    infoElement.textContent = "Fel: Kunde inte ladda F152-flygplansmodell. Använder fallback.";
                    airplane = createFallbackAirplane(); 
                    scene.add(airplane);
                    setupAirplaneDependents();
                }
            );
        }
        
        function setupAirplaneDependents() {
            if (airplane) {
                 const initialLookAt = airplane.position.clone().add(new THREE.Vector3(0, 2, -20).applyQuaternion(airplane.quaternion));
                 controls.target.copy(initialLookAt); 
            }
        }

        function createFallbackAirplane() { 
            const group = new THREE.Group();
            const bodyMat = new THREE.MeshStandardMaterial({ color: "silver", metalness: 0.8, roughness: 0.4 });
            const fuselageGeo = new THREE.CylinderGeometry(0.5, 0.6, 5, 16); 
            const fuselage = new THREE.Mesh(fuselageGeo, bodyMat);
            fuselage.rotation.z = Math.PI / 2; fuselage.castShadow = true; fuselage.receiveShadow = true;
            group.add(fuselage);
            group.scale.set(10,10,10); 
            group.position.copy(START_POSITION); 
            return group;
        }
        
        function createProceduralTexture(size, color1, color2, noiseAmount1, noiseAmount2) {
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const context = canvas.getContext('2d');
            context.fillStyle = color1;
            context.fillRect(0, 0, size, size);
            for (let i = 0; i < size * size * 0.5; i++) {
                context.fillStyle = `rgba(0,0,0,${Math.random() * noiseAmount1})`;
                context.beginPath(); context.arc(Math.random() * size, Math.random() * size, Math.random() * 1.5, 0, Math.PI * 2); context.fill();
                context.fillStyle = `rgba(255,255,255,${Math.random() * noiseAmount2})`;
                context.beginPath(); context.arc(Math.random() * size, Math.random() * size, Math.random() * 1, 0, Math.PI * 2); context.fill();
            }
            const texture = new THREE.CanvasTexture(canvas);
            texture.needsUpdate = true;
            texture.encoding = THREE.sRGBEncoding; 
            return texture;
        }

        // Borttagen setupControls då den inte längre behövs för touch-kontroller
        // function setupControls() { ... }

        function handleKeyboardInput(deltaTime) {
            // Hantera gaspådrag (W/S)
            if (keyStates['KeyW']) {
                throttleValue += THROTTLE_INCREMENT;
            } else if (keyStates['KeyS']) {
                throttleValue -= THROTTLE_INCREMENT;
            } else {
                 // Låt gasen sakta minska om ingen gas-tangent hålls nere
                throttleValue -= THROTTLE_DECREMENT_RATE * deltaTime;
            }
            throttleValue = Math.max(0.0, Math.min(1.0, throttleValue)); // Kläm mellan 0 och 1

            // Hantera Roll (A/D)
            if (keyStates['KeyA']) {
                controlInputX -= CONTROL_INCREMENT;
            } else if (keyStates['KeyD']) {
                controlInputX += CONTROL_INCREMENT;
            } else {
                // Återgå sakta till neutral om ingen roll-tangent hålls nere
                if (controlInputX > CONTROL_DECREMENT_RATE * deltaTime) controlInputX -= CONTROL_DECREMENT_RATE * deltaTime;
                else if (controlInputX < -CONTROL_DECREMENT_RATE * deltaTime) controlInputX += CONTROL_DECREMENT_RATE * deltaTime;
                else controlInputX = 0;
            }
            controlInputX = Math.max(-1.0, Math.min(1.0, controlInputX));

            // Hantera Pitch (Upp/Ner Pilar)
            if (keyStates['ArrowUp']) {
                controlInputY -= CONTROL_INCREMENT; // Nos ner (positiv X-rotation)
            } else if (keyStates['ArrowDown']) {
                controlInputY += CONTROL_INCREMENT; // Nos upp (negativ X-rotation)
            } else {
                 // Återgå sakta till neutral om ingen pitch-tangent hålls nere
                if (controlInputY > CONTROL_DECREMENT_RATE * deltaTime) controlInputY -= CONTROL_DECREMENT_RATE * deltaTime;
                else if (controlInputY < -CONTROL_DECREMENT_RATE * deltaTime) controlInputY += CONTROL_DECREMENT_RATE * deltaTime;
                else controlInputY = 0;
            }
            controlInputY = Math.max(-1.0, Math.min(1.0, controlInputY));
        }


        function createRunway() {
            const runwayLength = 2500; const runwayWidth = 90; const runwayThickness = 2;
            const runwayMaterial = new THREE.MeshStandardMaterial({ map: runwayTexture, roughness: 0.85, metalness: 0.1 });
            const runwayGeometry = new THREE.BoxGeometry(runwayWidth, runwayThickness, runwayLength);
            const runway = new THREE.Mesh(runwayGeometry, runwayMaterial);
            runway.position.y = runwayThickness / 2; runway.castShadow = true; runway.receiveShadow = true;
            scene.add(runway);
            const stripeLength = 40; const stripeWidth = 2; const stripeThickness = 0.2; const stripeGap = 30;
            const numStripes = Math.floor(runwayLength / (stripeLength + stripeGap));
            const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0 });
            for (let i = 0; i < numStripes; i++) {
                const stripe = new THREE.Mesh( new THREE.BoxGeometry(stripeWidth, stripeThickness, stripeLength), stripeMaterial );
                stripe.position.y = runwayThickness + stripeThickness / 2 + 0.01;
                stripe.position.z = -runwayLength / 2 + stripeLength / 2 + i * (stripeLength + stripeGap) + stripeGap/2;
                stripe.castShadow = true; stripe.receiveShadow = true; scene.add(stripe);
            }
            const lightRadius = 2.0; const lightHeight = 4.0; const lightSpacing = 70;
            const numSideLights = Math.floor(runwayLength / lightSpacing);
            const edgeLightMaterial = new THREE.MeshStandardMaterial({ color: 0x00aaff, emissive: 0x00aaff, emissiveIntensity: 2.0 }); 
            const thresholdLightRedMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff2222, emissiveIntensity: 2.0 });
            const thresholdLightGreenMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x22ff22, emissiveIntensity: 2.0 });
            for (let i = 0; i <= numSideLights; i++) {
                const zPos = -runwayLength / 2 + i * lightSpacing;
                const lightLeft = new THREE.Mesh(new THREE.SphereGeometry(lightRadius, 16, 16), edgeLightMaterial);
                lightLeft.position.set(-runwayWidth / 2 - lightRadius * 2.5, lightHeight / 2 + runwayThickness, zPos);
                lightLeft.castShadow = true; scene.add(lightLeft);
                const lightRight = new THREE.Mesh(new THREE.SphereGeometry(lightRadius, 16, 16), edgeLightMaterial);
                lightRight.position.set(runwayWidth / 2 + lightRadius * 2.5, lightHeight / 2 + runwayThickness, zPos);
                lightRight.castShadow = true; scene.add(lightRight);
            }
            const thresholdLightCount = Math.floor(runwayWidth / (lightRadius * 4));
            for(let i = 0; i < thresholdLightCount; i++) {
                const xPos = -runwayWidth/2 + lightRadius*2 + i * (lightRadius*4);
                const greenLight = new THREE.Mesh(new THREE.SphereGeometry(lightRadius,16,16), thresholdLightGreenMaterial);
                greenLight.position.set(xPos, lightHeight/2 + runwayThickness, -runwayLength/2 - lightRadius*3); scene.add(greenLight);
                const redLight = new THREE.Mesh(new THREE.SphereGeometry(lightRadius,16,16), thresholdLightRedMaterial);
                redLight.position.set(xPos, lightHeight/2 + runwayThickness, runwayLength/2 + lightRadius*3); scene.add(redLight);
            }
        }
        
        function initExhaustSystem() {
            exhaustGeometry = new THREE.BufferGeometry();
            const positions = new Float32Array(MAX_EXHAUST_PARTICLES * 3);
            exhaustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            exhaustMaterial = new THREE.PointsMaterial({ color: 0xbbbbbb, size: 0.3, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }); 
            exhaustParticles = new THREE.Points(exhaustGeometry, exhaustMaterial);
            exhaustParticles.frustumCulled = false; 
            scene.add(exhaustParticles);
        }

        function updateExhaustSystem(deltaTime) {
            if (!airplane) return; 

            for (let i = exhaustParticlesArray.length - 1; i >= 0; i--) {
                const particle = exhaustParticlesArray[i];
                particle.life -= deltaTime;
                if (particle.life <= 0) {
                    exhaustParticlesArray.splice(i, 1); 
                } else {
                    particle.position.addScaledVector(particle.velocity, deltaTime);
                    particle.opacity = (particle.life / particle.initialLife) * 0.6; 
                }
            }

            if (throttleValue > 0.15 && exhaustParticlesArray.length < MAX_EXHAUST_PARTICLES) { 
                const numNewParticles = Math.ceil(throttleValue * 2); 
                for (let i = 0; i < numNewParticles; i++) {
                    if (exhaustParticlesArray.length >= MAX_EXHAUST_PARTICLES) break;
                    const particle = { position: new THREE.Vector3(), velocity: new THREE.Vector3(), life: Math.random() * 0.6 + 0.2, initialLife: 0, opacity: 0.6 };
                    particle.initialLife = particle.life;
                    
                    const spawnPointWorld = airplane.localToWorld(exhaustSpawnOffset.clone());
                    particle.position.copy(spawnPointWorld);
                    
                    particle.position.x += (Math.random() - 0.5) * 0.3; 
                    particle.position.y += (Math.random() - 0.5) * 0.3;
                    particle.position.z += (Math.random() - 0.5) * 0.3;

                    const baseVelocity = airplane.getWorldDirection(new THREE.Vector3()).multiplyScalar(-currentSpeedInternal * 10 - 5); 
                    particle.velocity.copy(baseVelocity);
                    particle.velocity.x += (Math.random() - 0.5) * 5;
                    particle.velocity.y += (Math.random() - 0.5) * 5;
                    particle.velocity.z += (Math.random() - 0.5) * 5;
                    exhaustParticlesArray.push(particle);
                }
            }
            const positions = exhaustParticles.geometry.attributes.position.array;
            for (let i = 0; i < exhaustParticlesArray.length; i++) {
                const particle = exhaustParticlesArray[i];
                positions[i * 3] = particle.position.x;
                positions[i * 3 + 1] = particle.position.y;
                positions[i * 3 + 2] = particle.position.z;
            }
            if (exhaustParticlesArray.length > 0 && exhaustMaterial) {
                 exhaustMaterial.opacity = exhaustParticlesArray[0].opacity;
            } else if (exhaustMaterial) {
                 exhaustMaterial.opacity = 0;
            }

            exhaustParticles.geometry.attributes.position.needsUpdate = true;
            exhaustParticles.geometry.setDrawRange(0, exhaustParticlesArray.length); 
        }
        
        function checkCollisions() {
            if (!airplane || isCrashed) return; 

            if (airplane.position.y < GROUND_COLLISION_THRESHOLD_Y) {
                handleCrash();
            }
        }

        function handleCrash() {
            isCrashed = true;
            crashMessageElement.style.display = 'block'; 

            setTimeout(() => {
                if (airplane) {
                    airplane.position.copy(START_POSITION);
                    airplane.quaternion.set(0,0,0,1); 
                }
                currentSpeedInternal = MIN_SPEED_INTERNAL;
                verticalSpeed = 0; 
                throttleValue = 0.05; 
                // updateThrottleKnobVisual(); // Inte längre relevant med tangentbordskontroll
                
                crashMessageElement.style.display = 'none'; 
                isCrashed = false; 
            }, 2000); 
        }


        function onWindowResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            composer.setSize(window.innerWidth, window.innerHeight); 
            // Borttagen logik för joystick/throttle resize
        }

        const clock = new THREE.Clock();

        function animate() {
            requestAnimationFrame(animate);
            const deltaTime = clock.getDelta();

            handleKeyboardInput(deltaTime); // Hantera tangentbordsinput

            if (airplane && !isCrashed) { 
                if (propellerObject) {
                    const propellerSpeed = 0.1 + throttleValue * 2.5; 
                    propellerObject.rotation.z += propellerSpeed * deltaTime;
                }
                
                const forwardDrag = FORWARD_DRAG_COEFFICIENT * currentSpeedInternal * currentSpeedInternal;
                const forwardAcceleration = ( (throttleValue * THRUST_POWER) - forwardDrag ) / AIRPLANE_MASS;
                currentSpeedInternal += forwardAcceleration * deltaTime;
                currentSpeedInternal = Math.max(0, currentSpeedInternal); 


                if (airspeedValueElement) {
                    const displayedSpeed = currentSpeedInternal * SPEED_TO_KNOTS_MULTIPLIER;
                    airspeedValueElement.textContent = displayedSpeed.toFixed(0);
                }

                let liftAcceleration = 0;
                const pitch = airplane.rotation.x; 
                if (currentSpeedInternal > MIN_SPEED_FOR_LIFT) {
                    if (pitch < 0 && pitch > -MAX_PITCH_FOR_LIFT) { 
                        liftAcceleration = Math.pow(currentSpeedInternal / MAX_SPEED_INTERNAL, 2) * (-pitch / MAX_PITCH_FOR_LIFT) * LIFT_FORCE_FACTOR;
                        liftAcceleration = Math.min(liftAcceleration, GRAVITY_ACCELERATION * 2.5); 
                    }
                }
                
                const totalVerticalAcceleration = (liftAcceleration - GRAVITY_ACCELERATION);
                verticalSpeed += totalVerticalAcceleration * deltaTime;
                verticalSpeed *= (1 - VERTICAL_DRAG_COEFFICIENT * deltaTime);
                airplane.position.y += verticalSpeed * deltaTime; 

                // Använd controlInputX för roll och controlInputY för pitch
                airplane.rotateX(controlInputY * PITCH_SENSITIVITY * deltaTime); // controlInputY styr pitch
                airplane.rotateZ(-controlInputX * ROLL_SENSITIVITY * deltaTime); // controlInputX styr roll

                const forward = new THREE.Vector3(0, 0, -1); 
                forward.applyQuaternion(airplane.quaternion);
                airplane.position.addScaledVector(forward, currentSpeedInternal * deltaTime); 

                updateExhaustSystem(deltaTime); 
                checkCollisions(); 
            }
            
            if (airplane) {
                const targetPosition = airplane.position.clone().add(
                    chaseCameraOffset.clone().applyQuaternion(airplane.quaternion)
                );
                camera.position.lerp(targetPosition, Math.min(1.0, cameraSmoothSpeed * deltaTime));

                const lookAtTarget = airplane.position.clone().add(
                    cameraLookAtOffset.clone().applyQuaternion(airplane.quaternion)
                );
                
                controls.target.copy(lookAtTarget); 
                camera.lookAt(lookAtTarget);
            }


            controls.update(); 
            composer.render(deltaTime); 
        }
        
        init();
        // setupControls(); // Inte längre nödvändig
        animate();
        
    </script>
</body>
</html>
