(() => {
  'use strict';

  const THREE = window.THREE;
  const $ = s => document.querySelector(s);
  const ui = {
    canvas: $('#game-canvas'), start: $('#start-screen'), startBtn: $('#start-button'), hud: $('#hud'),
    zone: $('#zone-name'), altitude: $('#altitude'), speed: $('#speed'), battery: $('#battery'), score: $('#score'),
    missionProgress: $('#mission-progress'), missionCount: $('#mission-count'), message: $('#message'), warning: $('#warning'),
    finish: $('#finish-screen'), finishScore: $('#finish-score'), restart: $('#restart-button'), error: $('#webgl-error'),
    soundBtn: $('#sound-button'), cameraBtn: $('#camera-button'), impactFlash: $('#impact-flash'),
    compassRose: $('#compass-rose'), compassHeading: $('#compass-heading'), targetBearing: $('#target-bearing')
  };

  let renderer, scene, camera, drone;
  const world = new THREE.Group();
  const propellers = [], rotorDiscs = [], rings = [], ringLabels = [], cars = [], colliders = [];
  const keys = new Set();
  const clock = new THREE.Clock();
  const velocity = new THREE.Vector3();
  const targetVelocity = new THREE.Vector3();
  const localInput = new THREE.Vector3();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const DRONE_RADIUS = 2.45;
  const DRONE_BOTTOM = 1.35;
  const BOUNDS = { minX: -390, maxX: 390, minZ: -225, maxZ: 205, maxY: 205 };
  const roadXs = [-245, -175, -105, -35, 40, 105, 165, 225, 285];
  const roadZs = [-115, -72, -28, 18, 62, 108, 158];

  // Ruta diseñada deliberadamente sobre avenidas/intersecciones despejadas.
  // Además, buildCaracas() reserva un perímetro alrededor de cada punto antes de generar edificios.
  const ringRoute = [
    [0, 24, 102], [38, 30, 82], [72, 33, 42], [112, 37, 8], [154, 42, -22],
    [202, 47, -18], [246, 52, 26], [202, 61, -78], [118, 76, -120], [32, 106, -154]
  ];

  let currentRing = 0, running = false, crashed = false, cameraMode = 'third';
  let score = 0, battery = 100, messageTimer = 0, impactCooldown = 0, batteryBeepTimer = 0;
  const checkpointPos = new THREE.Vector3(0, 18, 155);
  let checkpointYaw = 0;

  // Audio procedural 100% local.
  let audioCtx = null, masterGain = null, rotorGain = null, rotorOscA = null, rotorOscB = null;
  let windGain = null, windSource = null, soundEnabled = true;

  try {
    renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    console.error(e); ui.start.hidden = true; ui.error.hidden = false; return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x78afca);
  scene.fog = new THREE.FogExp2(0xa9cbd4, 0.00155);
  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1600);
  scene.add(world);

  buildSky();
  buildLights();
  buildCaracas();
  buildDrone();
  buildRings();
  resetGame();
  bind();
  animate();

  function mat(color, rough = 0.8, metal = 0.05) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  }
  function mesh(geo, material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function seededRandom(seed = 12345) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function buildSky() {
    const skyGeo = new THREE.SphereGeometry(900, 32, 18);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { topColor: { value: new THREE.Color(0x4e91bd) }, bottomColor: { value: new THREE.Color(0xd6e3dc) }, offset: { value: 18 }, exponent: { value: 0.72 } },
      vertexShader: 'varying vec3 vWorldPosition; void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vWorldPosition=wp.xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; varying vec3 vWorldPosition; void main(){ float h=normalize(vWorldPosition+vec3(0.0,offset,0.0)).y; float f=max(pow(max(h,0.0),exponent),0.0); gl_FragColor=vec4(mix(bottomColor,topColor,f),1.0); }'
    });
    scene.add(new THREE.Mesh(skyGeo, skyMat));

    const rand = seededRandom(6102);
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.48, depthWrite: false });
    for (let i = 0; i < 13; i++) {
      const cloud = new THREE.Group();
      for (let j = 0; j < 4 + Math.floor(rand() * 3); j++) {
        const puff = mesh(new THREE.SphereGeometry(10 + rand() * 13, 12, 8), cloudMat, (j - 2) * 12 + rand() * 8, rand() * 4, rand() * 8);
        puff.scale.y = 0.42 + rand() * 0.22; puff.castShadow = false; cloud.add(puff);
      }
      cloud.position.set(-380 + rand() * 760, 125 + rand() * 85, -360 + rand() * 470);
      world.add(cloud);
    }
  }

  function buildLights() {
    scene.add(new THREE.HemisphereLight(0xe9f6ff, 0x466044, 1.85));
    const sun = new THREE.DirectionalLight(0xffe8bd, 3.45);
    sun.position.set(-135, 225, 105); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -390; sun.shadow.camera.right = 390;
    sun.shadow.camera.top = 340; sun.shadow.camera.bottom = -340;
    sun.shadow.camera.near = 20; sun.shadow.camera.far = 720;
    scene.add(sun);
  }

  function createFacadeMaterials() {
    const palettes = [
      ['#c8c2b5','#375b6c','#e2ded2'], ['#d7d2c4','#466f7e','#eee8da'], ['#bdb6a9','#395967','#d7d0c3'],
      ['#d2bca3','#4c7180','#e4d2bd'], ['#b8c2c2','#345866','#d8dfdc'], ['#c8a993','#426776','#dbc5b4']
    ];
    return palettes.map((p, idx) => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 512;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0,0,256,512); grad.addColorStop(0,p[2]); grad.addColorStop(1,p[0]); g.fillStyle=grad; g.fillRect(0,0,256,512);
      for (let y=18;y<500;y+=34) {
        g.fillStyle='rgba(40,45,46,.12)'; g.fillRect(0,y+18,256,2);
        for (let x=12;x<250;x+=38) {
          g.fillStyle = ((x+y+idx*7)%4===0) ? 'rgba(244,205,128,.68)' : p[1];
          g.fillRect(x,y,23,13);
          g.fillStyle='rgba(255,255,255,.18)'; g.fillRect(x+2,y+2,8,2);
        }
      }
      g.fillStyle='rgba(255,255,255,.18)'; g.fillRect(0,0,10,512);
      const tex = new THREE.CanvasTexture(c);
      if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
      return new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.72, metalness: 0.06 });
    });
  }

  function buildCaracas() {
    const facadeMats = createFacadeMaterials();
    const rand = seededRandom(918273);

    // Caracas se organiza como un valle largo este-oeste: Ávila al norte,
    // colinas al sur, río Guaire y autopista recorriendo el centro.
    const ground = mesh(new THREE.PlaneGeometry(1120, 860), mat(0x687d58, 1, 0), 0, -1.3, 0);
    ground.rotation.x = -Math.PI / 2; world.add(ground);

    // Waraira Repano / El Ávila, ahora con una silueta más alta y puntiaguda para verse como una montaña real.
    buildMountainRidge(-305, 1120, 250, 80, 16, 0x1d5337, 1.68);
    buildMountainRidge(-258, 1110, 154, 74, 12, 0x2d6b43, 1.02);
    buildAvilaPeaks();
    addMountainVegetation(rand);
    buildSouthHills(rand);

    // Bruma típica del valle al pie del Ávila.
    const haze = mesh(new THREE.PlaneGeometry(1080, 160), new THREE.MeshBasicMaterial({ color: 0xc9dadd, transparent: true, opacity: 0.16, depthWrite: false }), 0, 94, -214);
    world.add(haze);

    buildRoads(rand);
    buildGuaireAndHighway(rand);

    // Barrios urbanos reconocibles por densidad/altura. No representan catastro exacto,
    // pero sí la silueta y relación espacial real de Caracas.
    buildUrbanDistrict('Centro', -245, -35, 115, 150, 58, facadeMats, rand, 1.05);
    buildUrbanDistrict('Parque Central', -128, -12, 92, 130, 70, facadeMats, rand, 1.18);
    buildUrbanDistrict('Sabana Grande', -32, 34, 120, 120, 48, facadeMats, rand, 0.95);
    buildUrbanDistrict('Chacao', 92, -2, 112, 125, 67, facadeMats, rand, 1.18);
    buildUrbanDistrict('Altamira', 153, -38, 84, 104, 72, facadeMats, rand, 1.28);
    buildUrbanDistrict('La Castellana', 180, -100, 116, 82, 66, facadeMats, rand, 1.08);
    buildUrbanDistrict('Los Palos Grandes', 238, -38, 92, 125, 58, facadeMats, rand, 0.98);
    buildUrbanDistrict('Las Mercedes', 152, 112, 150, 74, 42, facadeMats, rand, 0.82);
    buildUrbanDistrict('El Rosal', 92, 72, 86, 72, 58, facadeMats, rand, 1.06);

    // Vivienda densa sobre las laderas, rasgo visual esencial de Caracas.
    buildHillsideBarrios(rand);

    buildCaracasLandmarks(facadeMats, rand);
    buildParksAndTrees(rand);
    buildHelipad();

    addLabel('WARAIRA REPANO · EL ÁVILA', 0, 171, -238, 0xffffff, 55);
    addLabel('PARQUE CENTRAL', -126, 135, -15, 0xffefb8, 48);
    addLabel('PLAZA VENEZUELA', -56, 55, 70, 0xffffff, 38);
    addLabel('CHACAO', 94, 83, 0, 0xffffff, 43);
    addLabel('ALTAMIRA', 155, 71, -37, 0xffffff, 48);
    addLabel('PARQUE DEL ESTE', 282, 45, 60, 0xffffff, 36);
  }

  function buildUrbanDistrict(name, cx, cz, width, depth, baseHeight, facadeMats, rand, density=1) {
    const stepX = 22, stepZ = 24;
    const minX = cx-width/2, maxX = cx+width/2, minZ = cz-depth/2, maxZ = cz+depth/2;
    for(let x=minX; x<=maxX; x+=stepX){
      for(let z=minZ; z<=maxZ; z+=stepZ){
        if(rand() > Math.min(.93, .68*density)) continue;
        const px=x+(rand()-.5)*5.5, pz=z+(rand()-.5)*6.5;
        const w=10+rand()*9, d=11+rand()*11;
        if(!canPlaceBuilding(px,pz,w,d)) continue;
        let h=12+Math.pow(rand(),.62)*baseHeight*density;
        if(name==='Altamira'||name==='Chacao'||name==='Parque Central') h*=1.1;
        addBuilding(px,pz,w,h,d,facadeMats[Math.floor(rand()*facadeMats.length)],rand);
        if(h>42 && rand()>.48) addBalconies(px,pz,w,h,d);
      }
    }
  }

  function canPlaceBuilding(x, z, w, d) {
    const margin = 7;
    // Corredores viales principales. Más orgánicos que la vieja cuadrícula uniforme.
    const corridors = [
      {a:[-380,62],b:[380,55],r:17}, // autopista
      {a:[-360,-26],b:[350,-34],r:11}, // Libertador / eje central
      {a:[-330,-73],b:[330,-68],r:9}, // Francisco de Miranda aprox.
      {a:[-320,108],b:[330,103],r:8},
      {a:[-245,-155],b:[-245,175],r:8},{a:[-175,-160],b:[-175,185],r:7},
      {a:[-105,-155],b:[-105,185],r:7},{a:[-35,-155],b:[-35,185],r:7},
      {a:[40,-155],b:[40,185],r:7},{a:[105,-155],b:[105,185],r:8},
      {a:[165,-155],b:[165,185],r:8},{a:[225,-155],b:[225,185],r:7},{a:[285,-145],b:[285,180],r:7}
    ];
    for(const c of corridors) if(distancePointToSegment(x,z,c.a[0],c.a[1],c.b[0],c.b[1]) < c.r + Math.max(w,d)*.34 + margin) return false;
    for (const p of ringRoute) if (Math.hypot(x-p[0],z-p[2]) < 22 + Math.max(w,d)*.32) return false;
    if (Math.hypot(x, z-155) < 27) return false;
    // Reservas de plazas/parques/landmarks.
    const reserves=[[-128,-15,48],[-56,70,38],[155,-37,34],[282,60,58],[-152,116,58],[16,-149,25],[-225,-25,34]];
    for(const r of reserves) if(Math.hypot(x-r[0],z-r[1])<r[2]+Math.max(w,d)*.25)return false;
    return true;
  }

  function distancePointToSegment(px,pz,ax,az,bx,bz){
    const vx=bx-ax,vz=bz-az,wx=px-ax,wz=pz-az,l2=vx*vx+vz*vz;
    const t=l2?THREE.MathUtils.clamp((wx*vx+wz*vz)/l2,0,1):0;
    return Math.hypot(px-(ax+t*vx),pz-(az+t*vz));
  }

  function addBalconies(x,z,w,h,d){
    const balconyMat=mat(0xc8c4b9,.9,.02);
    const railMat=mat(0x50585b,.45,.25);
    const floors=Math.min(7,Math.floor(h/9));
    for(let i=1;i<=floors;i++){
      if(i%2===0)continue;
      const y=i*h/(floors+1);
      const slab=mesh(new THREE.BoxGeometry(w*.72,.22,1.05),balconyMat,x,y,z-d/2-.54);slab.castShadow=false;world.add(slab);
      const rail=mesh(new THREE.BoxGeometry(w*.72,.52,.08),railMat,x,y+.34,z-d/2-1.05);rail.castShadow=false;world.add(rail);
    }
  }

  function buildAvilaPeaks(){
    const rockMat=mat(0x315f3e,1,0);
    const peaks=[[-248,-258,118,86,0.88],[-116,-276,154,108,1.02],[18,-288,184,124,1.12],[146,-272,148,102,0.96],[264,-252,122,88,0.82]];
    for(const [x,z,h,r,s] of peaks){
      const peak=mesh(new THREE.ConeGeometry(r,h,12,5),rockMat,x,h*.46,z);
      peak.scale.z=s; peak.rotation.y=Math.PI/12; peak.castShadow=false; peak.receiveShadow=true; world.add(peak);
    }
  }

  function buildSouthHills(rand){
    const hillMat=mat(0x496e45,1,0);
    for(let i=0;i<8;i++){
      const x=-360+i*105+(rand()-.5)*25;
      const hill=mesh(new THREE.SphereGeometry(86+rand()*28,18,10),hillMat,x,-58-rand()*18,252+rand()*26);
      hill.scale.set(1.35,.62,.72);hill.receiveShadow=true;hill.castShadow=false;world.add(hill);
    }
  }

  function buildHillsideBarrios(rand){
    const houseColors=[0xd8c39e,0xb96c53,0xd8d2bf,0xa55d49,0xc89f75,0xe0c996,0x9e765d];
    const clusters=[[-300,165,125],[-215,174,115],[-100,185,105],[25,185,95],[315,154,80]];
    for(const [cx,cz,count] of clusters){
      for(let i=0;i<count;i++){
        const x=cx+(rand()-.5)*105,z=cz+(rand()-.5)*55;
        if(nearRingRoute(x,z,16)||Math.hypot(x,z-155)<25)continue;
        const y=Math.max(0,(z-145)*.13)+rand()*2;
        const w=4+rand()*4,d=4+rand()*4,h=3.4+rand()*5;
        const b=mesh(new THREE.BoxGeometry(w,h,d),mat(houseColors[Math.floor(rand()*houseColors.length)],.96,0),x,y+h/2,z);world.add(b);
        if(rand()>.7){const roof=mesh(new THREE.ConeGeometry(Math.max(w,d)*.7,2.1,4),mat(0x765144,1,0),x,y+h+1,z);roof.rotation.y=Math.PI/4;world.add(roof);}
      }
    }
  }

  function buildCaracasLandmarks(facadeMats,rand){
    buildParqueCentral(facadeMats[4]);
    buildCentroSimonBolivar(facadeMats[1]);
    buildPlazaVenezuela();
    buildAltamiraPlaza();
    buildUCV(facadeMats[2]);
    buildParqueDelEste(rand);
    buildTorrePrevisora(facadeMats[3]);
    buildCableCar();
    buildHotelHumboldt();
  }

  function buildParqueCentral(facadeMat){
    // Torres gemelas de Parque Central: altas, estrechas y con nervaduras verticales.
    for(const x of [-143,-113]){
      const h=126,w=24,d=27;
      const b=mesh(new THREE.BoxGeometry(w,h,d),facadeMat,x,h/2,-15);world.add(b);addCollider(x,h/2,-15,w,h,d,'Torre de Parque Central');
      const rib=mat(0x5d6c70,.45,.28);
      for(let k=-2;k<=2;k++){
        const r=mesh(new THREE.BoxGeometry(1.05,h*.94,d+1.1),rib,x+k*4.6,h*.49,-15);r.castShadow=false;world.add(r);
      }
      const crown=mesh(new THREE.BoxGeometry(w*.86,5.4,d*.82),mat(0x737d80,.45,.24),x,h+2.7,-15);world.add(crown);
    }
    // Basamento cultural/urbano.
    for(const [x,z,w,d,h] of [[-128,8,86,24,11],[-153,16,34,22,15],[-101,14,32,20,13]]){
      const b=mesh(new THREE.BoxGeometry(w,h,d),facadeMat,x,h/2,z);world.add(b);addCollider(x,h/2,z,w,h,d,'Complejo Parque Central');
    }
  }

  function buildCentroSimonBolivar(facadeMat){
    for(const x of [-236,-211]){
      const h=71,w=18,d=25;
      const b=mesh(new THREE.BoxGeometry(w,h,d),facadeMat,x,h/2,-26);world.add(b);addCollider(x,h/2,-26,w,h,d,'Torres del Centro Simón Bolívar');
      for(let y=10;y<h;y+=11){const band=mesh(new THREE.BoxGeometry(w+.5,.38,d+.5),mat(0xd7d4c6,.8,.02),x,y,-26);band.castShadow=false;world.add(band);}
    }
    const podium=mesh(new THREE.BoxGeometry(66,10,35),facadeMat,-223,5,-5);world.add(podium);addCollider(-223,5,-5,66,10,35,'Centro Simón Bolívar');
  }

  function buildPlazaVenezuela(){
    const x=-56,z=70;
    const plaza=mesh(new THREE.CylinderGeometry(30,30,.55,64),mat(0xb7b2a4,1,0),x,-.18,z);world.add(plaza);
    const pool=mesh(new THREE.CylinderGeometry(17,17,.45,64),mat(0x4f9bb1,.34,.08),x,.1,z);world.add(pool);
    const basin=mesh(new THREE.TorusGeometry(17,.7,8,64),mat(0xd9d3c3,.85,0),x,.52,z);basin.rotation.x=Math.PI/2;world.add(basin);
    for(let i=0;i<14;i++){
      const a=i/14*Math.PI*2,r=8+(i%2)*4;
      const jet=mesh(new THREE.CylinderGeometry(.08,.12,5+(i%3)*2,5),new THREE.MeshBasicMaterial({color:0xb9ecff,transparent:true,opacity:.62}),x+Math.cos(a)*r,3,z+Math.sin(a)*r);world.add(jet);
    }
  }

  function buildAltamiraPlaza(){
    const x=155,z=-37;
    const plaza=mesh(new THREE.CylinderGeometry(27,27,.65,64),mat(0xc6c0af,1,0),x,-.12,z);world.add(plaza);
    const green=mesh(new THREE.CylinderGeometry(20,20,.35,64),mat(0x5f8d58,1,0),x,.16,z);world.add(green);
    const ob=mesh(new THREE.CylinderGeometry(1.7,4.2,50,5),mat(0xe0d8c6,.7,.04),x,25,z);ob.rotation.y=Math.PI/5;world.add(ob);addCollider(x,25,z,8.5,50,8.5,'Obelisco de Altamira');
    for(let i=0;i<12;i++){const a=i/12*Math.PI*2;addTree(x+Math.cos(a)*23,z+Math.sin(a)*23,.7);}
  }

  function buildUCV(facadeMat){
    const cx=-152,cz=116;
    const lawn=mesh(new THREE.BoxGeometry(110,.3,68),mat(0x5d8a53,1,0),cx,-.16,cz);world.add(lawn);
    for(const [x,z,w,d,h] of [[-180,105,42,14,10],[-137,107,54,15,9],[-168,135,34,16,8],[-122,136,46,14,9]]){
      const b=mesh(new THREE.BoxGeometry(w,h,d),facadeMat,x,h/2,z);world.add(b);addCollider(x,h/2,z,w,h,d,'Ciudad Universitaria de Caracas');
    }
    const aula=mesh(new THREE.CylinderGeometry(15,18,8,32),mat(0xc7b28e,.8,.02),-151,4.2,121);world.add(aula);addCollider(-151,4.2,121,36,8,36,'Aula Magna UCV');
    const dome=mesh(new THREE.SphereGeometry(14,24,12),mat(0x887965,.8,.03),-151,8,121);dome.scale.y=.42;world.add(dome);
    // Estadio estilizado.
    const stadium=mesh(new THREE.TorusGeometry(29,5.4,10,48),mat(0xb7b4a7,.95,0),-204,1.7,145);stadium.rotation.x=Math.PI/2;stadium.scale.z=.67;world.add(stadium);
    const field=mesh(new THREE.CylinderGeometry(22,22,.25,48),mat(0x4f874a,1,0),-204,.04,145);field.scale.z=.7;world.add(field);
  }

  function buildParqueDelEste(rand){
    const cx=286,cz=62;
    const park=mesh(new THREE.BoxGeometry(112,.35,126),mat(0x447b46,1,0),cx,-.15,cz);world.add(park);
    const pond=mesh(new THREE.CylinderGeometry(18,18,.3,48),mat(0x4a8ba1,.36,.04),304,.08,72);pond.scale.z=.62;world.add(pond);
    for(let i=0;i<62;i++)addTree(cx-48+rand()*96,cz-55+rand()*110,.55+rand()*.8);
    // Senderos claros.
    for(const z of [30,64,96])world.add(mesh(new THREE.BoxGeometry(94,.12,2.1),mat(0xc7b996,1,0),cx,.12,z));
  }

  function buildTorrePrevisora(facadeMat){
    const x=-12,z=68,h=83;
    const geo=new THREE.CylinderGeometry(11,14,h,8);
    const t=mesh(geo,facadeMat,x,h/2,z);t.rotation.y=Math.PI/8;world.add(t);addCollider(x,h/2,z,27,h,27,'Torre La Previsora');
    const crown=mesh(new THREE.CylinderGeometry(8,10,4,8),mat(0x727c80,.42,.28),x,h+2,z);crown.rotation.y=Math.PI/8;world.add(crown);
  }

  function buildHotelHumboldt(){
    const x=18,z=-278,y=terrainHeightAt(x,z)+7;
    const base=mesh(new THREE.CylinderGeometry(13,16,7,28),mat(0xd7d3c4,.9,.02),x,y,z);world.add(base);
    const tower=mesh(new THREE.CylinderGeometry(7.2,8.4,50,28),mat(0xbfc9c6,.55,.16),x,y+28,z);world.add(tower);
    const cap=mesh(new THREE.CylinderGeometry(9.2,9.2,4.2,28),mat(0x58676d,.35,.28),x,y+55,z);world.add(cap);
    addLabel('HOTEL HUMBOLDT',x,y+70,z,0xffffff,32);
  }

  function buildMountainRidge(baseZ, width, depth, segX, segZ, color, intensity) {
    const verts = [], indices = [], cols = segX + 1;
    for (let z = 0; z <= segZ; z++) {
      const dz = z / segZ;
      for (let x = 0; x <= segX; x++) {
        const tx = x / segX, px = -width / 2 + tx * width, pz = baseZ + (dz - 0.5) * depth;
        const large = 0.60 + 0.22 * Math.sin(tx * Math.PI * 4.2 + 0.4) + 0.13 * Math.sin(tx * Math.PI * 10.1);
        const peak = Math.max(0.16, large) * 125 * intensity;
        const depthShape = Math.pow(0.22 + 0.78 * dz, 1.3);
        const fine = (Math.sin(x * 1.7 + z * 2.1) + Math.cos(x * 0.66 - z * 1.2)) * 4.8 * intensity;
        const py = Math.max(0, peak * depthShape + fine - (1 - dz) * 18);
        verts.push(px, py - 1, pz);
      }
    }
    for (let z = 0; z < segZ; z++) for (let x = 0; x < segX; x++) {
      const a = z * cols + x, b = a + 1, c = a + cols, d = c + 1; indices.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); geo.setIndex(indices); geo.computeVertexNormals();
    const ridge = new THREE.Mesh(geo, mat(color, 1, 0)); ridge.receiveShadow = true; ridge.castShadow = true; world.add(ridge);
  }

  function terrainHeightAt(x, z) {
    // Frente del Ávila: pared más empinada y con picos marcados para una silueta montañosa real.
    if (z <= -148) {
      const depth = THREE.MathUtils.clamp((-z - 148) / 150, 0, 1);
      const ridge = 96
        + 34 * Math.sin((x + 110) * 0.014)
        + 24 * Math.sin(x * 0.031 + 0.9)
        + 13 * Math.cos(x * 0.058)
        + 22 * Math.exp(-Math.pow((x - 18) / 90, 2))
        + 14 * Math.exp(-Math.pow((x + 120) / 110, 2));
      return Math.max(0, Math.pow(depth, 1.18) * ridge);
    }
    // Colinas del sur, más bajas; dan la sensación de valle cerrado.
    if (z >= 172) {
      const d = THREE.MathUtils.clamp((z - 172) / 58, 0, 1);
      return Math.max(0, Math.pow(d, 1.4) * (24 + 9 * Math.sin(x * 0.022) + 6 * Math.cos(x * 0.049)));
    }
    return 0;
  }

  function addMountainVegetation(rand) {
    const treeMat = mat(0x2d6844, 1, 0);
    for (let i = 0; i < 160; i++) {
      const x = -440 + rand() * 880, z = -168 - rand() * 145;
      const y = terrainHeightAt(x, z);
      if (y < 8) continue;
      const crown = mesh(new THREE.ConeGeometry(2 + rand() * 2.4, 6 + rand() * 6, 7), treeMat, x, y + 3, z);
      crown.castShadow = false; world.add(crown);
    }
  }

  function buildRoads(rand) {
    const roadMat = mat(0x30363a, 0.98, 0), sidewalkMat = mat(0xa7a69d, 1, 0), stripeMat = mat(0xe7e0c8, 0.92, 0);

    // Ejes longitudinales principales del valle.
    addRoadPath([[-380,-72],[-230,-70],[-60,-67],[110,-69],[270,-65],[380,-58]],15,roadMat,sidewalkMat,stripeMat);
    addRoadPath([[-380,-28],[-210,-25],[-40,-30],[130,-34],[300,-31],[380,-28]],18,roadMat,sidewalkMat,stripeMat);
    addRoadPath([[-370,106],[-210,108],[-30,111],[150,105],[330,103],[380,106]],13,roadMat,sidewalkMat,stripeMat);

    // Avenidas norte-sur con separaciones irregulares típicas de la trama real.
    for (const x of roadXs) {
      const len = x>260?310:360;
      const zc = x>260?25:15;
      world.add(mesh(new THREE.BoxGeometry(12,.7,len),roadMat,x,-.18,zc));
      for(let z=-155;z<=180;z+=21)world.add(mesh(new THREE.BoxGeometry(.25,.1,8),stripeMat,x,.23,z));
    }

    // Rotondas/plazas menores y cruces ensanchados.
    for(const [x,z,r] of [[-56,70,18],[155,-37,18],[98,18,13]]){
      const c=mesh(new THREE.CylinderGeometry(r,r,.35,48),roadMat,x,-.02,z);world.add(c);
      const ring=mesh(new THREE.TorusGeometry(r*.72,.45,8,48),stripeMat,x,.24,z);ring.rotation.x=Math.PI/2;world.add(ring);
    }

    // Tráfico urbano en varios corredores.
    const carColors = [0xb53b31,0xe4e0d2,0x315f7b,0x282d31,0xb78f3e,0x69767a,0x41634a];
    for (let i = 0; i < 46; i++) {
      const dir = i % 2 ? 1 : -1, laneZ = (i%3===0?-75:(i%3===1?-24:103)) + (dir>0?-2.5:2.5);
      const car = new THREE.Group();
      const body = mesh(new THREE.BoxGeometry(4.5,1.1,2.05),mat(carColors[i%carColors.length],.44,.16));
      const cab = mesh(new THREE.BoxGeometry(2.35,.72,1.84),mat(0x405865,.18,.5),-.12,.86,0);
      car.add(body,cab);car.position.set(-370+(i*43)%740,.9,laneZ);car.userData.speed=dir*(11+(i%7)*1.5);
      world.add(car);cars.push(car);
    }

    // Faroles de autopista/avenidas.
    const poleMat=mat(0x525b5e,.65,.35);
    for(let x=-340;x<=340;x+=47){
      for(const z of [-82,-17,94]){
        const pole=mesh(new THREE.CylinderGeometry(.1,.13,6.6,7),poleMat,x,3.3,z);world.add(pole);
        const lamp=mesh(new THREE.BoxGeometry(1.35,.22,.34),mat(0xe2d4a6,.35,.25),x+.55,6.4,z);world.add(lamp);
      }
    }
  }

  function addRoadPath(points,width,roadMat,sidewalkMat,stripeMat){
    for(let i=0;i<points.length-1;i++){
      const [ax,az]=points[i],[bx,bz]=points[i+1];
      const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz),mx=(ax+bx)/2,mz=(az+bz)/2,ang=Math.atan2(dz,dx);
      const road=mesh(new THREE.BoxGeometry(len,.72,width),roadMat,mx,-.18,mz);road.rotation.y=-ang;world.add(road);
      const s1=mesh(new THREE.BoxGeometry(len,.3,1),sidewalkMat,mx,.08,mz-width/2-1.1);s1.rotation.y=-ang;world.add(s1);
      const s2=mesh(new THREE.BoxGeometry(len,.3,1),sidewalkMat,mx,.08,mz+width/2+1.1);s2.rotation.y=-ang;world.add(s2);
      const stripe=mesh(new THREE.BoxGeometry(len*.94,.08,.35),stripeMat,mx,.22,mz);stripe.rotation.y=-ang;world.add(stripe);
    }
  }

  function buildGuaireAndHighway(rand){
    // Río Guaire: canal gris con cauce azul verdoso, paralelo a la autopista.
    const riverPts=[[-390,73],[-260,75],[-125,78],[5,74],[130,70],[260,72],[390,68]];
    const concrete=mat(0x8e918b,1,0),water=mat(0x3f7881,.28,.04);
    addRoadPath(riverPts,17,concrete,concrete,concrete);
    for(let i=0;i<riverPts.length-1;i++){
      const [ax,az]=riverPts[i],[bx,bz]=riverPts[i+1],dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz),mx=(ax+bx)/2,mz=(az+bz)/2,ang=Math.atan2(dz,dx);
      const r=mesh(new THREE.BoxGeometry(len,.2,8.2),water,mx,.06,mz);r.rotation.y=-ang;world.add(r);
    }
    // Autopista Gran Cacique Guaicaipuro, ligeramente al norte del río.
    const roadMat=mat(0x262d32,.98,0),line=mat(0xd7c24d,.86,0),side=mat(0x999b96,1,0);
    addRoadPath([[-390,56],[-245,58],[-90,59],[70,55],[225,52],[390,50]],25,roadMat,side,line);
    // Puentes y distribuidores visuales.
    for(const x of [-245,-105,40,165,285]){
      const bridge=mesh(new THREE.BoxGeometry(13,.9,42),roadMat,x,2.4,65);world.add(bridge);
      const p1=mesh(new THREE.BoxGeometry(1.6,5,3.2),side,x-4.5,.3,65),p2=mesh(new THREE.BoxGeometry(1.6,5,3.2),side,x+4.5,.3,65);world.add(p1,p2);
    }
  }

  function addBuilding(x, z, w, h, d, facadeMat, rand) {
    // Aceras/plataforma alrededor del edificio.
    const slab = mesh(new THREE.BoxGeometry(w + 3.2, .38, d + 3.2), mat(0xb6b3aa, 1, 0), x, .05, z); slab.castShadow = false; world.add(slab);
    const b = mesh(new THREE.BoxGeometry(w, h, d), facadeMat, x, h / 2 + .25, z); world.add(b);
    addCollider(x, h / 2 + .25, z, w, h, d, 'Edificio');

    // Cornisa y equipos de azotea.
    const roof = mesh(new THREE.BoxGeometry(w * .78, 1.2 + rand() * 1.2, d * .68), mat(0x777a76,.82,.12), x + (rand()-.5)*1.2, h + 1.0, z); world.add(roof);
    if (h > 35 && rand() > .42) {
      const tank = mesh(new THREE.CylinderGeometry(1.2,1.2,1.7,12),mat(0x7c8585,.55,.25),x+(rand()-.5)*w*.35,h+2.5,z+(rand()-.5)*d*.3); world.add(tank);
    }
    if (h > 48 && rand() > .64) {
      const ah = 7 + rand() * 9;
      const ant = mesh(new THREE.CylinderGeometry(.1,.16,ah,7),mat(0x51575b,.55,.5),x,h+ah/2+1.4,z); world.add(ant);
      addCollider(x,h+ah/2+1.4,z,.65,ah,.65,'Antena');
    }
  }

  function addTower(x, z, w, h, facadeMat, name) {
    const b = mesh(new THREE.BoxGeometry(w,h,w),facadeMat,x,h/2,z); world.add(b); addCollider(x,h/2,z,w,h,w,name);
    const crown = mesh(new THREE.BoxGeometry(w*.78,5,w*.78),mat(0x778183,.45,.24),x,h+2.5,z); world.add(crown);
  }

  function addLowComplex(x,z,facadeMat) {
    for (let i=0;i<3;i++) {
      const w=28+i*4,d=20,h=9+i*3,px=x+(i-1)*18,pz=z+i*7;
      const b=mesh(new THREE.BoxGeometry(w,h,d),facadeMat,px,h/2,pz); world.add(b); addCollider(px,h/2,pz,w,h,d,'Complejo urbano');
    }
  }

  function buildCableCar() {
    const pts=[new THREE.Vector3(18,12,-132),new THREE.Vector3(18,54,-190),new THREE.Vector3(18,118,-245),new THREE.Vector3(18,158,-278)];
    const curve=new THREE.CatmullRomCurve3(pts);const geo=new THREE.BufferGeometry().setFromPoints(curve.getPoints(100));
    const line1=new THREE.Line(geo,new THREE.LineBasicMaterial({color:0x303638,transparent:true,opacity:.92}));world.add(line1);
    const offsetPts=pts.map(p=>p.clone().add(new THREE.Vector3(2.2,0,0)));const curve2=new THREE.CatmullRomCurve3(offsetPts);world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve2.getPoints(100)),new THREE.LineBasicMaterial({color:0x303638,transparent:true,opacity:.92})));
    for(const p of pts.slice(0,-1)){
      const tower=mesh(new THREE.BoxGeometry(2.1,22,2.1),mat(0x626b6f,.66,.33),p.x,p.y-8,p.z);world.add(tower);addCollider(p.x,p.y-8,p.z,3.2,22,3.2,'Torre del teleférico');
      const cross=mesh(new THREE.BoxGeometry(8,.6,.65),mat(0x626b6f,.66,.33),p.x,p.y+2,p.z);world.add(cross);
    }
    for(const [t,color] of [[.34,0xb94136],[.58,0xe5d6b1],[.76,0x3f6f83]]){
      const p=curve.getPoint(t);const cabin=mesh(new THREE.BoxGeometry(5.6,4.1,4.7),mat(color,.38,.25),p.x,p.y-2.2,p.z);world.add(cabin);
    }
  }

  function buildParksAndTrees(rand) {
    for(let i=0;i<210;i++){
      const x=-365+rand()*730,z=-155+rand()*330;
      if(nearAnyRoad(x,z,7)||nearRingRoute(x,z,15)||Math.hypot(x,z-155)<22||Math.hypot(x-286,z-62)<72)continue;
      if(rand()>.55)addTree(x,z,.48+rand()*.72);
    }
    // Parque Los Caobos, visualmente entre centro y Plaza Venezuela.
    const park=mesh(new THREE.BoxGeometry(68,.34,48),mat(0x4f7f4d,1,0),-92,-.14,50);world.add(park);
    for(let i=0;i<24;i++)addTree(-121+rand()*58,31+rand()*38,.65+rand()*.6);
  }

  function nearAnyRoad(x,z,extra=0){
    return roadXs.some(v=>Math.abs(x-v)<10+extra) || roadZs.some(v=>Math.abs(z-v)<10+extra);
  }
  function nearRingRoute(x,z,r){ return ringRoute.some(p=>Math.hypot(x-p[0],z-p[2])<r); }

  function addTree(x,z,s=1){
    const trunk=mesh(new THREE.CylinderGeometry(.35*s,.48*s,4.2*s,8),mat(0x6f5236,1,0),x,2.1*s,z); trunk.castShadow=true; world.add(trunk);
    const crown=mesh(new THREE.IcosahedronGeometry(2.5*s,1),mat(0x3f814d,1,0),x,5.3*s,z); world.add(crown);
  }

  function buildHelipad(){
    const pad=mesh(new THREE.CylinderGeometry(15,15,.65,48),mat(0x3b4448,.92,.03),0,-.25,155); world.add(pad);
    const hr=mesh(new THREE.TorusGeometry(8.3,.55,8,48),new THREE.MeshBasicMaterial({color:0xf1edde}),0,.15,155); hr.rotation.x=Math.PI/2; world.add(hr);
    const h1=mesh(new THREE.BoxGeometry(1.1,.08,10),new THREE.MeshBasicMaterial({color:0xf1edde}),0,.55,155); world.add(h1);
    const h2=mesh(new THREE.BoxGeometry(7,.08,1.1),new THREE.MeshBasicMaterial({color:0xf1edde}),0,.55,155); world.add(h2);
  }

  function addLabel(text,x,y,z,color=0xffffff,size=52){
    const c=document.createElement('canvas');c.width=512;c.height=128;const g=c.getContext('2d');g.clearRect(0,0,512,128);g.font=`900 ${size}px Segoe UI,Arial`;g.textAlign='center';g.textBaseline='middle';g.lineWidth=7;g.strokeStyle='rgba(10,30,40,.72)';g.strokeText(text,256,64);g.fillStyle='#'+new THREE.Color(color).getHexString();g.fillText(text,256,64);
    const tex=new THREE.CanvasTexture(c);if('colorSpace'in tex&&THREE.SRGBColorSpace)tex.colorSpace=THREE.SRGBColorSpace;const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));sp.scale.set(48,12,1);sp.position.set(x,y,z);world.add(sp);
  }

  function addCollider(x,y,z,w,h,d,name='Obstáculo'){
    const min=new THREE.Vector3(x-w/2,y-h/2,z-d/2),max=new THREE.Vector3(x+w/2,y+h/2,z+d/2);
    colliders.push({box:new THREE.Box3(min,max),name});
  }

  function buildDrone() {
    drone = new THREE.Group(); scene.add(drone);
    const carbon=mat(0x161d21,.2,.68), metal=mat(0x545d60,.24,.76), shell=mat(0x30393e,.28,.48);
    const glass=new THREE.MeshStandardMaterial({color:0x173d50,roughness:.05,metalness:.62,transparent:true,opacity:.94});

    const body=mesh(new THREE.BoxGeometry(2.45,.62,3.05),shell);drone.add(body);
    const top=mesh(new THREE.SphereGeometry(1.08,22,14),carbon,0,.3,0);top.scale.set(1.04,.42,1.28);drone.add(top);
    const nose=mesh(new THREE.SphereGeometry(.72,20,14),carbon,0,-.04,-1.55);nose.scale.set(1,.72,.84);drone.add(nose);
    const gimbal=mesh(new THREE.CylinderGeometry(.28,.28,.42,12),metal,0,-.61,-1.18);gimbal.rotation.z=Math.PI/2;drone.add(gimbal);
    const cam=mesh(new THREE.SphereGeometry(.48,18,12),glass,0,-.93,-1.30);cam.scale.set(1,.9,.85);drone.add(cam);
    const lens=mesh(new THREE.CylinderGeometry(.19,.24,.16,16),mat(0x05090b,.04,.82),0,-.94,-1.70);lens.rotation.x=Math.PI/2;drone.add(lens);

    const armGeo=new THREE.BoxGeometry(3.95,.21,.27);
    for(const z of [-.96,.96]) drone.add(mesh(armGeo,carbon,0,.15,z));
    const rotorMat=mat(0x0d1214,.1,.76);
    const blurMat=new THREE.MeshBasicMaterial({color:0x273238,transparent:true,opacity:.13,depthWrite:false,side:THREE.DoubleSide});
    const rotors=[[-1.92,-.96,0xff453a],[1.92,-.96,0xff453a],[-1.92,.96,0x48ef68],[1.92,.96,0x48ef68]];
    for(const [x,z,ledColor] of rotors){
      drone.add(mesh(new THREE.CylinderGeometry(.32,.37,.42,14),metal,x,.42,z));
      const p1=mesh(new THREE.BoxGeometry(2.55,.035,.11),rotorMat,x,.72,z),p2=mesh(new THREE.BoxGeometry(.11,.035,2.55),rotorMat,x,.72,z);drone.add(p1,p2);propellers.push(p1,p2);
      const disc=mesh(new THREE.CircleGeometry(1.43,36),blurMat,x,.705,z);disc.rotation.x=-Math.PI/2;drone.add(disc);rotorDiscs.push(disc);
      drone.add(mesh(new THREE.SphereGeometry(.105,10,8),new THREE.MeshStandardMaterial({color:ledColor,emissive:ledColor,emissiveIntensity:3.2}),x,.18,z));
    }
    for(const x of [-.85,.85]){
      drone.add(mesh(new THREE.CylinderGeometry(.075,.075,1.1,8),carbon,x,-.75,0));
      const skid=mesh(new THREE.CylinderGeometry(.075,.075,2.15,8),carbon,x,-1.25,0);skid.rotation.x=Math.PI/2;drone.add(skid);
    }
    drone.position.set(0,18,155);
  }

  function buildRings(){
    ringRoute.forEach((base,i)=>{
      const p=new THREE.Vector3(base[0],base[1],base[2]);
      // Validación extra: si una estructura añadida manualmente ocupa el espacio, elevamos el aro por encima.
      makeRingPositionSafe(p,11.5);
      const geo=new THREE.TorusGeometry(8.5,.68,12,52);
      const material=new THREE.MeshStandardMaterial({color:i===0?0xffc53d:0xe5f3f5,emissive:i===0?0xff8200:0x356d84,emissiveIntensity:i===0?2.4:.6,roughness:.24,metalness:.34,transparent:true,opacity:.92});
      const ring=new THREE.Mesh(geo,material); ring.position.copy(p); ring.castShadow=true; ring.userData.index=i;
      const prev=i===0?new THREE.Vector3(0,18,155):new THREE.Vector3(...ringRoute[i-1]);
      const next=i<ringRoute.length-1?new THREE.Vector3(...ringRoute[i+1]):p.clone().add(new THREE.Vector3(0,0,-30));
      const dir=next.clone().sub(prev); ring.rotation.y=Math.atan2(dir.x,dir.z); scene.add(ring);rings.push(ring);
      const label=createRingNumber(i+1);label.position.set(p.x,p.y+12.7,p.z);scene.add(label);ringLabels.push(label);
      const beam=mesh(new THREE.CylinderGeometry(.07,.07,Math.max(2,p.y-1),6),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.085}),p.x,p.y/2,p.z);scene.add(beam);
    });
  }

  function makeRingPositionSafe(p,radius){
    let highest=0;
    for(const c of colliders){
      const b=c.box;
      const cx=THREE.MathUtils.clamp(p.x,b.min.x,b.max.x),cz=THREE.MathUtils.clamp(p.z,b.min.z,b.max.z);
      if(Math.hypot(p.x-cx,p.z-cz)<radius && p.y-radius<b.max.y && p.y+radius>b.min.y) highest=Math.max(highest,b.max.y);
    }
    const terrain=terrainHeightAt(p.x,p.z);
    highest=Math.max(highest,terrain);
    if(highest>0 && p.y-radius<highest+3) p.y=highest+radius+5;
  }

  function createRingNumber(number){
    const c=document.createElement('canvas');c.width=256;c.height=256;const g=c.getContext('2d');g.clearRect(0,0,256,256);g.beginPath();g.arc(128,128,82,0,Math.PI*2);g.fillStyle='rgba(11,28,38,.9)';g.fill();g.lineWidth=11;g.strokeStyle='#ffffff';g.stroke();g.font='900 116px Segoe UI,Arial';g.textAlign='center';g.textBaseline='middle';g.fillStyle='#ffffff';g.fillText(String(number),128,136);
    const tex=new THREE.CanvasTexture(c);if('colorSpace'in tex&&THREE.SRGBColorSpace)tex.colorSpace=THREE.SRGBColorSpace;const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));sp.scale.set(10.3,10.3,1);return sp;
  }

  function bind(){
    ui.startBtn.addEventListener('click',()=>{ensureAudio();ui.start.hidden=true;ui.hud.hidden=false;running=true;clock.start();showMessage('¡Despegue autorizado! El aro Nº 1 está justo al frente.');});
    ui.restart.addEventListener('click',()=>{ensureAudio();ui.finish.hidden=true;ui.hud.hidden=false;resetGame();running=true;});
    if(ui.soundBtn)ui.soundBtn.addEventListener('click',toggleSound);
    if(ui.cameraBtn)ui.cameraBtn.addEventListener('click',toggleCamera);
    addEventListener('keydown',e=>{
      const k=e.key.toLowerCase();keys.add(k);if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(k))e.preventDefault();
      if(k==='r')resetGame(); if(k==='f')toggleFullscreen(); if(k==='m')toggleSound(); if(k==='c')toggleCamera();
    });
    addEventListener('keyup',e=>keys.delete(e.key.toLowerCase())); addEventListener('blur',()=>keys.clear()); addEventListener('resize',resize);
  }

  function resetGame(){
    currentRing=0;score=0;battery=100;crashed=false;velocity.set(0,0,0);targetVelocity.set(0,0,0);checkpointPos.set(0,18,155);checkpointYaw=0;
    drone.position.copy(checkpointPos);drone.rotation.set(0,0,0);drone.visible=cameraMode==='third';
    rings.forEach((r,i)=>{
      r.visible=true;
      ringLabels[i].visible=true;
      r.scale.setScalar(i===0?1.28:1);
      ringLabels[i].scale.setScalar(i===0?12.6:10.3);
      r.material.color.set(i===0?0xffc53d:0xe5f3f5);
      r.material.emissive.set(i===0?0xff8200:0x356d84);
      r.material.emissiveIntensity=i===0?2.4:.6;
      ringLabels[i].material.opacity=i===0?1:.76;
    });
    ui.warning.hidden=true;ui.impactFlash.classList.remove('on');updateHud(0);snapCamera();updateAudio(0,false);updateCompass();
  }

  function animate(){
    requestAnimationFrame(animate);const dt=Math.min(.04,Math.max(.001,clock.getDelta()||.016));
    if(running)update(dt);else updateTraffic(dt*.35);
    renderer.render(scene,camera);
  }

  function update(dt){
    if(crashed)return;
    impactCooldown=Math.max(0,impactCooldown-dt);batteryBeepTimer=Math.max(0,batteryBeepTimer-dt);
    const turbo=keys.has('shift');const maxHorizontal=turbo?30:20;const maxVertical=turbo?12:8.5;
    localInput.set(0,0,0);
    if(keys.has('arrowup'))localInput.z-=1;if(keys.has('arrowdown'))localInput.z+=1;
    if(keys.has('a'))localInput.x-=1;if(keys.has('d'))localInput.x+=1;
    if(keys.has('arrowleft'))drone.rotation.y+=1.18*dt;if(keys.has('arrowright'))drone.rotation.y-=1.18*dt;

    const horizontalInput=new THREE.Vector3(localInput.x,0,localInput.z);
    if(horizontalInput.lengthSq()>0)horizontalInput.normalize().multiplyScalar(maxHorizontal);
    horizontalInput.applyAxisAngle(Y_AXIS,drone.rotation.y);
    targetVelocity.x=horizontalInput.x;targetVelocity.z=horizontalInput.z;
    targetVelocity.y=0;if(keys.has('w'))targetVelocity.y+=maxVertical;if(keys.has('s'))targetVelocity.y-=maxVertical;
    if(keys.has(' ')||keys.has('spacebar')){targetVelocity.multiplyScalar(.12);velocity.multiplyScalar(Math.exp(-7*dt));}

    // Inercia: acelera rápido al mandar una orden, desacelera más lentamente al soltar.
    const response=horizontalInput.lengthSq()>0?3.0:1.25;const a=1-Math.exp(-response*dt);
    velocity.x=THREE.MathUtils.lerp(velocity.x,targetVelocity.x,a);velocity.z=THREE.MathUtils.lerp(velocity.z,targetVelocity.z,a);
    velocity.y=THREE.MathUtils.lerp(velocity.y,targetVelocity.y,1-Math.exp(-3.2*dt));
    if(velocity.length()>36)velocity.setLength(36);

    moveWithCollisions(dt);

    // Inclinación visual según velocidad local (pitch/roll).
    const localVel=velocity.clone().applyAxisAngle(Y_AXIS,-drone.rotation.y);
    const targetRoll=THREE.MathUtils.clamp(-localVel.x/Math.max(1,maxHorizontal)*.34,-.36,.36);
    const targetPitch=THREE.MathUtils.clamp(localVel.z/Math.max(1,maxHorizontal)*.28,-.30,.30);
    drone.rotation.z=THREE.MathUtils.lerp(drone.rotation.z,targetRoll,1-Math.exp(-5.2*dt));
    drone.rotation.x=THREE.MathUtils.lerp(drone.rotation.x,targetPitch,1-Math.exp(-5.2*dt));

    const speed=velocity.length();
    propellers.forEach((p,i)=>p.rotation.y+=(turbo?69:48+speed*.55)*dt*(i%2?1:-1));
    rotorDiscs.forEach(d=>{d.material.opacity=turbo?.22:.13+Math.min(.07,speed/350);});

    battery=Math.max(0,battery-dt*(turbo?.25:.075));
    if(battery<20&&batteryBeepTimer<=0){playBatteryBeep();batteryBeepTimer=5.5;}
    if(battery<=0){velocity.y=THREE.MathUtils.lerp(velocity.y,-5,1-Math.exp(-.8*dt));}

    updateTraffic(dt);checkRing();updateCamera(dt);updateHud(speed);updateZone();updateAudio(speed,turbo);updateCompass();
    rings.forEach((r,i)=>{
      if(r.visible){
        r.rotation.z+=dt*(i%2?.16:-.16);
        const pulse=1+Math.sin(performance.now()*.003+i)*.035;
        const activeBoost=i===currentRing?1.28:1;
        r.scale.setScalar(pulse*activeBoost);
        if(ringLabels[i]) ringLabels[i].scale.setScalar(i===currentRing?12.6:10.3);
      }
    });
  }

  function moveWithCollisions(dt){
    const startSpeed=velocity.length();let hit=null;
    const axes=['x','y','z'];
    for(const axis of axes){
      const old=drone.position[axis];drone.position[axis]+=velocity[axis]*dt;
      const c=collisionAt(drone.position);
      if(c){drone.position[axis]=old;hit=hit||c;velocity[axis]*=-.18;}
    }
    drone.position.x=THREE.MathUtils.clamp(drone.position.x,BOUNDS.minX,BOUNDS.maxX);
    drone.position.z=THREE.MathUtils.clamp(drone.position.z,BOUNDS.minZ,BOUNDS.maxZ);
    drone.position.y=Math.min(drone.position.y,BOUNDS.maxY);
    if(hit){
      if(startSpeed>17.5)handleCrash(hit.name,startSpeed);
      else if(impactCooldown<=0){impactCooldown=.55;score=Math.max(0,score-20);showMessage(`Impacto con ${hit.name} · -20 puntos`);playImpactSound(Math.min(1,startSpeed/18));flashImpact(false);}
    }
  }

  function collisionAt(pos){
    if(pos.x<=BOUNDS.minX||pos.x>=BOUNDS.maxX||pos.z<=BOUNDS.minZ||pos.z>=BOUNDS.maxZ)return{name:'límite de vuelo'};
    const ground=terrainHeightAt(pos.x,pos.z);
    if(pos.y-DRONE_BOTTOM<=ground+1.0)return{name:ground>2?'El Ávila':'el suelo'};
    for(const c of colliders)if(sphereBoxIntersect(pos,DRONE_RADIUS,c.box))return c;
    return null;
  }

  function sphereBoxIntersect(center,radius,box){
    const x=Math.max(box.min.x,Math.min(center.x,box.max.x));const y=Math.max(box.min.y,Math.min(center.y,box.max.y));const z=Math.max(box.min.z,Math.min(center.z,box.max.z));
    const dx=center.x-x,dy=center.y-y,dz=center.z-z;return dx*dx+dy*dy+dz*dz<radius*radius;
  }

  function handleCrash(name,speed){
    if(crashed)return;crashed=true;running=false;velocity.set(0,0,0);score=Math.max(0,score-100);ui.warning.textContent=`DRON IMPACTADO · ${name.toUpperCase()} · ${Math.round(speed*3.6)} km/h`;ui.warning.hidden=false;playImpactSound(1);flashImpact(true);updateAudio(0,false);
    setTimeout(()=>{drone.position.copy(checkpointPos);drone.rotation.set(0,checkpointYaw,0);velocity.set(0,0,0);ui.warning.hidden=true;ui.impactFlash.classList.remove('on');crashed=false;running=true;snapCamera();showMessage('Reanudando desde el último punto seguro · -100 puntos');},1500);
  }

  function flashImpact(strong){
    ui.impactFlash.style.background=strong?'rgba(255,35,20,.46)':'rgba(255,100,40,.25)';ui.impactFlash.classList.add('on');setTimeout(()=>ui.impactFlash.classList.remove('on'),strong?420:160);
  }

  function updateTraffic(dt){
    for(const car of cars){car.position.x+=car.userData.speed*dt;if(car.userData.speed>0&&car.position.x>355)car.position.x=-355;if(car.userData.speed<0&&car.position.x<-355)car.position.x=355;}
  }

  function checkRing(){
    if(currentRing>=rings.length)return;const r=rings[currentRing];const dist=drone.position.distanceTo(r.position);
    if(dist<7.8){
      r.visible=false;ringLabels[currentRing].visible=false;currentRing++;const bonus=120+Math.round(battery);score+=bonus;playRingChime(currentRing);checkpointPos.copy(drone.position);checkpointYaw=drone.rotation.y;
      showMessage(`Aro ${currentRing}/${rings.length} superado · +${bonus} puntos`);
      if(currentRing<rings.length){const n=rings[currentRing];n.material.color.set(0xffc53d);n.material.emissive.set(0xff8200);n.material.emissiveIntensity=2.4;ringLabels[currentRing].material.opacity=1;ringLabels[currentRing].scale.setScalar(12.6);}else finishGame();
    }
  }

  function finishGame(){running=false;score+=Math.round(battery*20);updateAudio(0,false);playFinishChime();ui.hud.hidden=true;ui.finishScore.textContent=`Puntuación final: ${score.toLocaleString('es-VE')} · Batería restante: ${Math.round(battery)}%`;ui.finish.hidden=false;}

  function showMessage(text){ui.message.textContent=text;ui.message.hidden=false;clearTimeout(messageTimer);messageTimer=setTimeout(()=>ui.message.hidden=true,1850);}

  function toggleCamera(){cameraMode=cameraMode==='third'?'fpv':'third';drone.visible=cameraMode==='third';if(ui.cameraBtn)ui.cameraBtn.textContent=cameraMode==='third'?'🎥 Tercera persona':'🥽 Vista FPV';snapCamera();showMessage(cameraMode==='third'?'Cámara: tercera persona':'Cámara: FPV desde el dron');}

  function updateCamera(dt){
    const speed=velocity.length();camera.fov=THREE.MathUtils.lerp(camera.fov,cameraMode==='fpv'?72+Math.min(8,speed*.18):62+Math.min(7,speed*.16),1-Math.exp(-3*dt));camera.updateProjectionMatrix();
    if(cameraMode==='fpv'){
      const eye=drone.position.clone().add(new THREE.Vector3(0,-.18,-1.72).applyAxisAngle(Y_AXIS,drone.rotation.y));camera.position.lerp(eye,1-Math.exp(-12*dt));
      const look=drone.position.clone().add(new THREE.Vector3(0,-.12,-45).applyAxisAngle(Y_AXIS,drone.rotation.y));camera.lookAt(look);
    }else{
      const backDistance=10.2+Math.min(4.0,speed*.11);const back=new THREE.Vector3(0,4.4,backDistance).applyAxisAngle(Y_AXIS,drone.rotation.y);const target=drone.position.clone().add(back);camera.position.lerp(target,1-Math.exp(-4.2*dt));
      const look=drone.position.clone().add(new THREE.Vector3(0,.25,-13).applyAxisAngle(Y_AXIS,drone.rotation.y));camera.lookAt(look);
    }
  }

  function snapCamera(){
    if(cameraMode==='fpv'){camera.position.copy(drone.position).add(new THREE.Vector3(0,-.18,-1.72).applyAxisAngle(Y_AXIS,drone.rotation.y));camera.lookAt(drone.position.clone().add(new THREE.Vector3(0,-.12,-45).applyAxisAngle(Y_AXIS,drone.rotation.y)));}
    else{camera.position.copy(drone.position).add(new THREE.Vector3(0,4.4,10.2).applyAxisAngle(Y_AXIS,drone.rotation.y));camera.lookAt(drone.position.clone().add(new THREE.Vector3(0,.25,-12).applyAxisAngle(Y_AXIS,drone.rotation.y)));}
  }

  function updateHud(speed){ui.altitude.textContent=`${Math.max(0,Math.round(drone.position.y-terrainHeightAt(drone.position.x,drone.position.z)))} m`;ui.speed.textContent=`${Math.round(speed*3.6)} km/h`;ui.battery.textContent=`${Math.round(battery)}%`;ui.score.textContent=score.toLocaleString('es-VE');ui.missionCount.textContent=`${currentRing} / ${rings.length} aros`;ui.missionProgress.style.width=`${currentRing/rings.length*100}%`;}

  function updateZone(){
    const x=drone.position.x,z=drone.position.z,y=drone.position.y;let name='Valle de Caracas';
    if(z<-155||y>125)name='Waraira Repano · El Ávila';
    else if(x<-190&&z<35)name='Centro de Caracas';
    else if(x>-175&&x<-88&&z<32)name='Parque Central';
    else if(x>-95&&x<10&&z>35&&z<105)name='Plaza Venezuela · Sabana Grande';
    else if(x>45&&x<135&&z>-55&&z<55)name='Chacao';
    else if(x>125&&x<190&&z>-70&&z<10)name='Altamira';
    else if(x>135&&x<235&&z<-68)name='La Castellana';
    else if(x>190&&x<275&&z>-65&&z<35)name='Los Palos Grandes';
    else if(x>245&&z>5&&z<125)name='Parque del Este';
    else if(x<-95&&z>92)name='Ciudad Universitaria · UCV';
    else if(z>100)name='Sur del valle';
    ui.zone.textContent=name;
  }

  function normalizeDeg(d){return((d%360)+360)%360;}
  function cardinal(deg){const dirs=['N','NE','E','SE','S','SO','O','NO'];return dirs[Math.round(normalizeDeg(deg)/45)%8];}
  function updateCompass(){
    const heading=normalizeDeg(-THREE.MathUtils.radToDeg(drone.rotation.y));
    if(ui.compassRose)ui.compassRose.style.transform=`rotate(${-heading}deg)`;
    if(ui.compassHeading)ui.compassHeading.textContent=`${String(Math.round(heading)).padStart(3,'0')}° ${cardinal(heading)}`;
    if(ui.targetBearing){if(currentRing<rings.length){const t=rings[currentRing].position,dx=t.x-drone.position.x,dz=t.z-drone.position.z;const bearing=normalizeDeg(THREE.MathUtils.radToDeg(Math.atan2(dx,-dz)));ui.targetBearing.textContent=`OBJ ${String(Math.round(bearing)).padStart(3,'0')}°`;}else ui.targetBearing.textContent='OBJ COMPLETADO';}
  }

  // ---------------- AUDIO ----------------
  function ensureAudio(){
    if(!soundEnabled)return;if(audioCtx){if(audioCtx.state==='suspended')audioCtx.resume();return;}const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;audioCtx=new AC();masterGain=audioCtx.createGain();masterGain.gain.value=.5;masterGain.connect(audioCtx.destination);
    const rotorFilter=audioCtx.createBiquadFilter();rotorFilter.type='lowpass';rotorFilter.frequency.value=1050;rotorFilter.Q.value=.75;rotorGain=audioCtx.createGain();rotorGain.gain.value=.065;rotorGain.connect(rotorFilter);rotorFilter.connect(masterGain);rotorOscA=audioCtx.createOscillator();rotorOscA.type='sawtooth';rotorOscA.frequency.value=86;rotorOscA.connect(rotorGain);rotorOscA.start();rotorOscB=audioCtx.createOscillator();rotorOscB.type='triangle';rotorOscB.frequency.value=172;rotorOscB.connect(rotorGain);rotorOscB.start();
    const length=audioCtx.sampleRate*2,buffer=audioCtx.createBuffer(1,length,audioCtx.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<length;i++)data[i]=Math.random()*2-1;windSource=audioCtx.createBufferSource();windSource.buffer=buffer;windSource.loop=true;const filter=audioCtx.createBiquadFilter();filter.type='bandpass';filter.frequency.value=640;filter.Q.value=.38;windGain=audioCtx.createGain();windGain.gain.value=0;windSource.connect(filter);filter.connect(windGain);windGain.connect(masterGain);windSource.start();updateSoundButton();
  }

  function updateAudio(speed,turbo){if(!audioCtx||!masterGain||!soundEnabled)return;const t=audioCtx.currentTime,n=Math.min(1,speed/30);rotorGain.gain.setTargetAtTime(running?.055+n*.052+(turbo?.018:0):.016,t,.1);rotorOscA.frequency.setTargetAtTime(82+n*54+(turbo?22:0),t,.08);rotorOscB.frequency.setTargetAtTime(164+n*92+(turbo?42:0),t,.08);windGain.gain.setTargetAtTime(running?n*.075+(turbo?.025:0):0,t,.13);}

  function playTone(freq,start,duration,volume=.12,type='sine'){if(!audioCtx||!soundEnabled)return;const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(.001,start);g.gain.exponentialRampToValueAtTime(volume,start+.015);g.gain.exponentialRampToValueAtTime(.001,start+duration);o.connect(g);g.connect(masterGain);o.start(start);o.stop(start+duration+.03);}
  function playRingChime(n){if(!audioCtx||!soundEnabled)return;const now=audioCtx.currentTime;playTone(650+n*8,now,.28,.15);playTone(880+n*8,now+.08,.3,.14);}
  function playFinishChime(){if(!audioCtx||!soundEnabled)return;const now=audioCtx.currentTime;[523,659,784,1047].forEach((f,i)=>playTone(f,now+i*.12,.38,.14));}
  function playBatteryBeep(){if(!audioCtx||!soundEnabled)return;const now=audioCtx.currentTime;playTone(980,now,.12,.08,'square');playTone(980,now+.18,.12,.08,'square');}
  function playImpactSound(strength=.7){if(!audioCtx||!soundEnabled)return;const now=audioCtx.currentTime;playTone(90,now,.34,.12+strength*.12,'sawtooth');playTone(55,now+.02,.42,.10+strength*.13,'triangle');}

  function toggleSound(){soundEnabled=!soundEnabled;if(soundEnabled){ensureAudio();if(masterGain)masterGain.gain.setTargetAtTime(.5,audioCtx.currentTime,.05);}else if(masterGain&&audioCtx)masterGain.gain.setTargetAtTime(.0001,audioCtx.currentTime,.04);updateSoundButton();}
  function updateSoundButton(){if(!ui.soundBtn)return;ui.soundBtn.textContent=soundEnabled?'🔊 Sonido':'🔇 Sonido';ui.soundBtn.setAttribute('aria-pressed',String(soundEnabled));}

  function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
  async function toggleFullscreen(){try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch(e){console.warn(e);}}
})();
