(() => {
"use strict";

const MIN_SURFACE_CLEARANCE = 2.5;
const keys = new Set();
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
function totalRings(){ return ringRoute.length; }

// Cinco países y varias ciudades de Latinoamérica. Las alturas fallback solo se usan
// si Google todavía no ha podido devolver la altura fotorealista del punto inicial.
const LOCATIONS = {
  "Venezuela": [
    { name:"Lechería (Anzoátegui)", lat:10.1886, lon:-64.7025, fallbackGround:5, spawnHeadingDeg:90, routeProfile:"lecheriaUrban" },
    { name:"Caracas", lat:10.4910, lon:-66.9020, fallbackGround:930 },
    { name:"Maracaibo", lat:10.6545, lon:-71.6400, fallbackGround:30 },
    { name:"Valencia", lat:10.1621, lon:-68.0077, fallbackGround:470 }
  ],
  "Colombia": [
    { name:"Bogotá", lat:4.6486, lon:-74.0780, fallbackGround:2640 },
    { name:"Medellín", lat:6.2442, lon:-75.5812, fallbackGround:1495 },
    { name:"Cartagena", lat:10.4010, lon:-75.5144, fallbackGround:12 }
  ],
  "México": [
    { name:"Ciudad de México", lat:19.4326, lon:-99.1332, fallbackGround:2240 },
    { name:"Guadalajara", lat:20.6736, lon:-103.3440, fallbackGround:1560 },
    { name:"Monterrey", lat:25.6866, lon:-100.3161, fallbackGround:540 }
  ],
  "Argentina": [
    { name:"Buenos Aires", lat:-34.6037, lon:-58.3816, fallbackGround:25 },
    { name:"Córdoba", lat:-31.4201, lon:-64.1888, fallbackGround:390 },
    { name:"Mendoza", lat:-32.8895, lon:-68.8458, fallbackGround:760 }
  ],
  "Brasil": [
    { name:"São Paulo", lat:-23.5505, lon:-46.6333, fallbackGround:760 },
    { name:"Río de Janeiro", lat:-22.9068, lon:-43.1729, fallbackGround:20 },
    { name:"Brasilia", lat:-15.7939, lon:-47.8828, fallbackGround:1170 }
  ]
};

// Rutas locales en metros ENU (x=este, y=norte).
// En Lechería la ruta está diseñada para avanzar SOBRE LA CIUDAD, no hacia el mar.
// El primer aro queda exactamente a 200 m delante del dron.
const ROUTE_PROFILES = {
  default: [
    {x:0,    y:200,  z:0},
    {x:85,   y:340,  z:0},
    {x:20,   y:495,  z:0},
    {x:-105, y:650,  z:0},
    {x:-45,  y:825,  z:0},
    {x:100,  y:1000, z:0},
    {x:225,  y:1180, z:0},
    {x:90,   y:1380, z:0}
  ],
  lecheriaUrban: [
    {x:200,  y:0,    z:0},
    {x:340,  y:75,   z:0},
    {x:480,  y:25,   z:0},
    {x:610,  y:-65,  z:0},
    {x:735,  y:-20,  z:0},
    {x:845,  y:95,   z:0},
    {x:950,  y:145,  z:0},
    {x:1050, y:40,   z:0}
  ]
};
let ringRoute = ROUTE_PROFILES.default.map(p => ({...p}));
let spawnHeading = 0;
let placementMode = "auto";
let manualRingSpecs = [];
let loadingProgress = 0;

function applyRouteProfile() {
  const profileName = selectedCity?.routeProfile || "default";
  const profile = ROUTE_PROFILES[profileName] || ROUTE_PROFILES.default;
  ringRoute = profile.map(p => ({...p}));
  spawnHeading = Cesium.Math.toRadians(Number(selectedCity?.spawnHeadingDeg) || 0);
}

function setLoadingProgress(value, text) {
  loadingProgress = clamp(Number(value) || 0, 0, 100);
  if (ui.loadingProgressFill) ui.loadingProgressFill.style.width = `${loadingProgress}%`;
  if (ui.loadingProgressText) ui.loadingProgressText.textContent = `${Math.round(loadingProgress)}%`;
  if (text && ui.loadingText) ui.loadingText.textContent = text;
}

function offsetLatLon(lat, lon, eastMeters, northMeters) {
  const dLat = northMeters / 111320;
  const dLon = eastMeters / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  return { lat: lat + dLat, lon: lon + dLon };
}

function defaultManualRingSpec(index = 0) {
  const city = currentLocation();
  const heading = (Number(city?.spawnHeadingDeg) || 0) * Math.PI / 180;
  const distance = 200 + index * 150;
  const lateral = index === 0 ? 0 : ((index % 2 === 0 ? 1 : -1) * 45 * Math.ceil(index / 2));
  const east = Math.sin(heading) * distance + Math.cos(heading) * lateral;
  const north = Math.cos(heading) * distance - Math.sin(heading) * lateral;
  const ll = offsetLatLon(city.lat, city.lon, east, north);
  return { lat:Number(ll.lat.toFixed(6)), lon:Number(ll.lon.toFixed(6)), agl:75 };
}

function resetManualRingSpecs() {
  manualRingSpecs = [defaultManualRingSpec(0)];
  renderManualRingRows();
}

function renderManualRingRows() {
  if (!ui.manualRingList) return;
  ui.manualRingList.innerHTML = manualRingSpecs.map((r, i) => `
    <div class="manual-ring-row">
      <span>${i+1}</span>
      <input type="number" step="0.000001" data-ring="${i}" data-field="lat" value="${Number(r.lat).toFixed(6)}" />
      <input type="number" step="0.000001" data-ring="${i}" data-field="lon" value="${Number(r.lon).toFixed(6)}" />
      <input type="number" step="1" min="10" max="1000" data-ring="${i}" data-field="agl" value="${Math.round(Number(r.agl)||75)}" />
      <button type="button" data-remove-ring="${i}" title="Eliminar aro">✕</button>
    </div>`).join('');
}

function updatePlacementModeUI() {
  placementMode = ui.placementMode?.value || "auto";
  if (ui.autoPlacementPanel) ui.autoPlacementPanel.hidden = placementMode !== "auto";
  if (ui.manualPlacementPanel) ui.manualPlacementPanel.hidden = placementMode !== "manual";
  if (placementMode === "manual" && manualRingSpecs.length === 0) resetManualRingSpecs();
}

function buildAutomaticRoute(count) {
  applyRouteProfile();
  const base = ringRoute.map(p => ({...p}));
  const result = [];
  for (let i=0; i<count; i++) {
    if (i < base.length) { result.push({...base[i]}); continue; }
    const a = result[result.length-1];
    const b = result[result.length-2] || {x:0,y:0,z:0};
    result.push({x:a.x+(a.x-b.x), y:a.y+(a.y-b.y), z:0});
  }
  ringRoute = result;
}

function collectPlacementConfig() {
  placementMode = ui.placementMode?.value || "auto";
  if (placementMode === "auto") {
    const count = clamp(parseInt(ui.autoRingCount?.value || "8",10) || 8, 1, 20);
    buildAutomaticRoute(count);
    return;
  }
  if (!manualRingSpecs.length) resetManualRingSpecs();
  manualRingSpecs = manualRingSpecs.map(r => ({
    lat: Number(r.lat), lon: Number(r.lon), agl: clamp(Number(r.agl)||75, 10, 1000)
  })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon));
  if (!manualRingSpecs.length) throw new Error("Agrega al menos un aro manual con latitud y longitud válidas.");
}

function manualSpecsToLocalRoute() {
  if (placementMode !== "manual" || !origin || !enuTransform) return;
  const inverse = Cesium.Matrix4.inverseTransformation(enuTransform, new Cesium.Matrix4());
  ringRoute = manualRingSpecs.map(spec => {
    const fixed = Cesium.Cartesian3.fromDegrees(spec.lon, spec.lat, originAbsoluteHeight);
    const local = Cesium.Matrix4.multiplyByPoint(inverse, fixed, new Cesium.Cartesian3());
    return {x:local.x, y:local.y, z:spec.agl, manualAgl:spec.agl, manualLat:spec.lat, manualLon:spec.lon};
  });
}

// Los aros se colocan bajos, pero cada uno se eleva automáticamente si hay edificios debajo.
const RING_HEIGHT_OFFSETS = [0, 2, -2, 3, 0, 2, -1, 1];
const RING_LOW_TARGET_AGL = 75;
const RING_BUILDING_CLEARANCE = 4; // separación visual mínima sobre la azotea

const ui = {
  setup: document.getElementById("setup"),
  loading: document.getElementById("loading"),
  hud: document.getElementById("hud"),
  apiKey: document.getElementById("apiKey"),
  rememberKey: document.getElementById("rememberKey"),
  countrySelect: document.getElementById("countrySelect"),
  citySelect: document.getElementById("citySelect"),
  startHeight: document.getElementById("startHeight"),
  placementMode: document.getElementById("placementMode"),
  autoRingCount: document.getElementById("autoRingCount"),
  autoPlacementPanel: document.getElementById("autoPlacementPanel"),
  manualPlacementPanel: document.getElementById("manualPlacementPanel"),
  addRingBtn: document.getElementById("addRingBtn"),
  manualRingList: document.getElementById("manualRingList"),
  quality: document.getElementById("quality"),
  startBtn: document.getElementById("startBtn"),
  setupError: document.getElementById("setupError"),
  locationHint: document.getElementById("locationHint"),
  loadingTitle: document.getElementById("loadingTitle"),
  loadingText: document.getElementById("loadingText"),
  loadingProgressFill: document.getElementById("loadingProgressFill"),
  loadingProgressText: document.getElementById("loadingProgressText"),
  coords: document.getElementById("coords"),
  cityHud: document.getElementById("cityHud"),
  altitude: document.getElementById("altitude"),
  speed: document.getElementById("speed"),
  objective: document.getElementById("objective"),
  progress: document.getElementById("progress"),
  soundBtn: document.getElementById("soundBtn"),
  cameraBtn: document.getElementById("cameraBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  centerMessage: document.getElementById("centerMessage"),
  headingNeedle: document.getElementById("headingNeedle"),
  targetNeedle: document.getElementById("targetNeedle"),
  compassHeading: document.getElementById("compassHeading"),
  targetBearing: document.getElementById("targetBearing"),
  mapViewBtn: document.getElementById("mapViewBtn"),
  routeView: document.getElementById("routeView"),
  routeMapCity: document.getElementById("routeMapCity"),
  routeMapStatus: document.getElementById("routeMapStatus"),
  fitRouteBtn: document.getElementById("fitRouteBtn"),
  closeMapBtn: document.getElementById("closeMapBtn"),
  qualityStatus: document.getElementById("qualityStatus"),
  miniRouteCanvas: document.getElementById("miniRouteCanvas"),
  crosshair: document.querySelector(".crosshair")
};

const saved = localStorage.getItem("droneLatamGoogleApiKey") || localStorage.getItem("droneCaracasGoogleApiKey");
if (saved) {
  ui.apiKey.value = saved;
  ui.rememberKey.checked = true;
}

let viewer = null;
let tileset = null;
let selectedCity = LOCATIONS.Venezuela[0];
let startAgl = 150;
let originAbsoluteHeight = 0;
let origin = null;
let enuTransform = null;
let enuRotation = null;
let enuUp = null;
let drone = { x:0, y:0, z:0, vx:0, vy:0, vz:0, heading:0, yawRate:0, pitch:0, roll:0 };
let droneParts = [];
let droneBillboard = null;
let ringEntities = [];
let currentRing = 0;
let cameraMode = 0;
let running = false;
let soundOn = true;
let audioCtx = null, rotorOsc = null, rotorGain = null;
let groundAbsoluteHeight = 0;
let lastGroundSampleAt = 0;
let heightAboveSurface = null;
let lastHudMapUpdateAt = 0;
let mapViewOpen = false;
let spawnAssistUntil = 0;
let spawnGroundLockUntil = 0;

// Mapa Leaflet a pantalla completa
let miniMap = null;
let miniDroneMarker = null;
let miniRingMarkers = [];
let miniRouteLine = null;
let miniTargetLine = null;
let miniRouteBounds = null;

function populateCountries() {
  ui.countrySelect.innerHTML = "";
  Object.keys(LOCATIONS).forEach(country => {
    const opt = document.createElement("option");
    opt.value = country;
    opt.textContent = country;
    ui.countrySelect.appendChild(opt);
  });
  ui.countrySelect.value = "Venezuela";
  populateCities();
}

function populateCities() {
  const list = LOCATIONS[ui.countrySelect.value] || [];
  ui.citySelect.innerHTML = "";
  list.forEach((city, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = city.name;
    ui.citySelect.appendChild(opt);
  });
  ui.citySelect.value = "0";
  updateLocationHint();
}

function updateLocationHint() {
  const list = LOCATIONS[ui.countrySelect.value] || [];
  const city = list[Number(ui.citySelect.value) || 0] || list[0];
  if (!city) return;
  const mode = (ui.placementMode?.value || "auto") === "manual" ? `Manual · ${manualRingSpecs.length || 1} aro(s)` : `Automático · ${Number(ui.autoRingCount?.value) || 8} aro(s)`;
  ui.locationHint.textContent = `${ui.countrySelect.value} · ${city.name} · Inicio aprox. ${Number(ui.startHeight.value) || 150} m sobre la superficie · ${mode}`;
}

populateCountries();
resetManualRingSpecs();
updatePlacementModeUI();
ui.countrySelect.addEventListener("change", () => { populateCities(); resetManualRingSpecs(); updateLocationHint(); });
ui.citySelect.addEventListener("change", () => { resetManualRingSpecs(); updateLocationHint(); });
ui.startHeight.addEventListener("input", updateLocationHint);
ui.placementMode?.addEventListener("change", () => { updatePlacementModeUI(); updateLocationHint(); });
ui.autoRingCount?.addEventListener("input", updateLocationHint);
ui.addRingBtn?.addEventListener("click", () => { manualRingSpecs.push(defaultManualRingSpec(manualRingSpecs.length)); renderManualRingRows(); });
ui.manualRingList?.addEventListener("input", (event) => {
  const input = event.target.closest('input[data-ring]');
  if (!input) return;
  const idx = Number(input.dataset.ring);
  const field = input.dataset.field;
  if (!manualRingSpecs[idx]) return;
  manualRingSpecs[idx][field] = Number(input.value);
});
ui.manualRingList?.addEventListener("click", (event) => {
  const button = event.target.closest('button[data-remove-ring]');
  if (!button) return;
  const idx = Number(button.dataset.removeRing);
  manualRingSpecs.splice(idx,1);
  if (!manualRingSpecs.length) manualRingSpecs.push(defaultManualRingSpec(0));
  renderManualRingRows();
});

function showError(message) {
  ui.setupError.hidden = false;
  ui.setupError.textContent = message;
}

function currentLocation() {
  const list = LOCATIONS[ui.countrySelect.value] || LOCATIONS.Venezuela;
  return list[Number(ui.citySelect.value) || 0] || list[0];
}

async function startGame() {
  const apiKey = ui.apiKey.value.trim();
  if (!apiKey) {
    showError("Pega primero tu Google Maps Platform API key.");
    return;
  }
  ui.setupError.hidden = true;

  if (ui.rememberKey.checked) {
    localStorage.setItem("droneLatamGoogleApiKey", apiKey);
  } else {
    localStorage.removeItem("droneLatamGoogleApiKey");
    localStorage.removeItem("droneCaracasGoogleApiKey");
  }

  selectedCity = currentLocation();
  applyRouteProfile();
  collectPlacementConfig();
  startAgl = Cesium.Math.clamp(Number(ui.startHeight.value) || 150, 30, 500);
  ui.loadingTitle.textContent = `Cargando ${selectedCity.name} fotorealista…`;
  setLoadingProgress(4, "Preparando ciudad y ruta…");
  ui.setup.hidden = true;
  ui.loading.hidden = false;

  try {
    setLoadingProgress(12, "Iniciando motor 3D y conectando con Google…");
    await initViewer(apiKey);
    if (placementMode === "manual") manualSpecsToLocalRoute();

    setLoadingProgress(48, placementMode === "manual" ? "Calculando alturas manuales sobre el terreno…" : "Buscando alturas seguras para los aros…");
    await calibrateRingAltitudes();

    setLoadingProgress(68, "Construyendo dron, aros y navegación…");
    buildDrone();
    buildRings();
    initMiniMap();
    await waitForInitialSceneReady();

    cameraMode = 0;
    ui.cameraBtn.textContent = "🎥 Tercera persona";
    setDroneVisibility(true);
    if (ui.crosshair) ui.crosshair.style.top = "63%";
    resetMission();
    spawnAssistUntil = performance.now() + 1800;
    spawnGroundLockUntil = performance.now() + 3500;
    startAudio();

    setLoadingProgress(100, "Listo para despegar.");
    ui.loading.hidden = true;
    ui.hud.hidden = false;
    ui.cityHud.textContent = `${ui.countrySelect.value} · ${selectedCity.name}`;
    ui.routeMapCity.textContent = `${selectedCity.name} · ${ui.countrySelect.value}`;
    updateRouteMapStatus();
    updateQualityStatus();
    running = true;
    frame.last = 0;
    requestAnimationFrame(frame);
  } catch (err) {
    console.error(err);
    destroyRuntime();
    setLoadingProgress(0, "No se pudo completar la carga.");
    ui.loading.hidden = true;
    ui.setup.hidden = false;
    showError(
      "No se pudieron cargar los Google Photorealistic 3D Tiles. Verifica Map Tiles API, facturación y la API key. " +
      "Detalle: " + (err?.message || err)
    );
  }
}

async function initViewer(apiKey) {
  Cesium.Ion.defaultAccessToken = undefined;

  viewer = new Cesium.Viewer("cesiumContainer", {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
    fullscreenButton: false,
    vrButton: false,
    baseLayer: false,
    globe: false,
    skyBox: new Cesium.SkyBox({
      sources: {
        positiveX: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_px.jpg"),
        negativeX: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_mx.jpg"),
        positiveY: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_py.jpg"),
        negativeY: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_my.jpg"),
        positiveZ: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_pz.jpg"),
        negativeZ: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_mz.jpg")
      }
    }),
    requestRenderMode: false,
    msaaSamples: 4
  });

  // Cámara del juego: bloqueamos controles nativos de Cesium para que no peleen con W/A/S/D.
  viewer.scene.screenSpaceCameraController.enableInputs = false;
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#98c9e5");
  viewer.scene.highDynamicRange = true;
  viewer.scene.fog.enabled = false; // imagen más limpia y nítida cerca del suelo
  viewer.scene.debugShowFramesPerSecond = false;
  viewer.scene.postProcessStages.fxaa.enabled = true;

  const quality = Number(ui.quality.value) || 8;
  const url = "https://tile.googleapis.com/v1/3dtiles/root.json?key=" + encodeURIComponent(apiKey);
  tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
    showCreditsOnScreen: true,
    maximumScreenSpaceError: quality,
    dynamicScreenSpaceError: false,
    foveatedScreenSpaceError: false,
    skipLevelOfDetail: false,
    preferLeaves: true,
    preloadFlightDestinations: true,
    cacheBytes: 536870912,
    maximumCacheOverflowBytes: 536870912
  });
  viewer.scene.primitives.add(tileset);

  // Estas opciones priorizan detalle incluso mientras se mueve la cámara.
  if ("cullRequestsWhileMoving" in tileset) tileset.cullRequestsWhileMoving = false;
  if ("progressiveResolutionHeightFraction" in tileset) tileset.progressiveResolutionHeightFraction = 0.0;

  // Colocamos primero la cámara sobre la ciudad para que Cesium/Google puedan resolver el terreno.
  const tempHeight = selectedCity.fallbackGround + 1600;
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(selectedCity.lon, selectedCity.lat, tempHeight),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-58),
      roll: 0
    }
  });

  ui.loadingText.textContent = `Midiendo la superficie real de ${selectedCity.name}…`;
  groundAbsoluteHeight = await sampleSurfaceHeight(selectedCity.lon, selectedCity.lat, selectedCity.fallbackGround);
  // El origen local está EXACTAMENTE en el suelo estimado. Por eso z=150 significa 150 m sobre el suelo.
  originAbsoluteHeight = groundAbsoluteHeight;

  origin = Cesium.Cartesian3.fromDegrees(selectedCity.lon, selectedCity.lat, originAbsoluteHeight);
  enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  enuRotation = Cesium.Matrix4.getMatrix3(enuTransform, new Cesium.Matrix3());
  enuUp = Cesium.Matrix3.getColumn(enuRotation, 2, new Cesium.Cartesian3());

  // Vista inicial alineada con la dirección de despegue de cada ciudad.
  const sh0 = Math.sin(spawnHeading), ch0 = Math.cos(spawnHeading);
  const firstView = localToFixed(-sh0*85 - ch0*45, -ch0*85 + sh0*45, 45);
  const target = localToFixed(sh0*220, ch0*220, 85);
  lookFromTo(firstView, target);
}

async function waitForInitialSceneReady() {
  if (!viewer || !tileset) return;
  return new Promise(resolve => {
    const started = performance.now();
    let stable = 0;
    function check() {
      if (!viewer || !tileset) return resolve();
      const loaded = !!tileset.tilesLoaded;
      stable = loaded ? stable + 1 : 0;
      const elapsed = performance.now() - started;
      const pct = loaded ? 88 + Math.min(10, stable) : 72 + Math.min(14, elapsed / 700);
      setLoadingProgress(pct, loaded ? "Mostrando edificios y texturas finales…" : "Cargando edificios y texturas…");
      if (stable >= 8 || elapsed > 12000) return resolve();
      requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  });
}

async function sampleSurfaceHeight(lon, lat, fallback) {
  if (!viewer?.scene?.sampleHeightSupported) return fallback;
  try {
    const meterLat = 1 / 111320;
    const meterLon = 1 / (111320 * Math.max(0.2, Math.cos(Cesium.Math.toRadians(lat))));
    // Muestreamos un área amplia para evitar que una azotea sea confundida con el suelo.
    const offsets = [
      [0,0],[30,0],[-30,0],[0,30],[0,-30],
      [60,0],[-60,0],[0,60],[0,-60],
      [45,45],[-45,45],[45,-45],[-45,-45],
      [90,0],[-90,0],[0,90],[0,-90]
    ];
    const points = offsets.map(([east,north]) =>
      Cesium.Cartographic.fromDegrees(lon + east*meterLon, lat + north*meterLat, 0)
    );
    const sampled = await viewer.scene.sampleHeightMostDetailed(points);
    const heights = (sampled || []).map(p => p?.height).filter(Number.isFinite).sort((a,b)=>a-b);
    if (!heights.length) return fallback;

    // Priorizamos alturas cercanas al nivel conocido de la ciudad y valores bajos (calles/terreno).
    const plausible = heights.filter(h => Math.abs(h - fallback) <= 120);
    const pool = plausible.length >= 3 ? plausible : heights;
    const lowIndex = Math.min(pool.length - 1, Math.floor(pool.length * 0.18));
    const candidate = pool[lowIndex];

    // No permitimos un salto grande respecto del nivel aproximado: eso normalmente sería una azotea/malla errónea.
    if (Math.abs(candidate - fallback) > 160) return fallback;
    return candidate;
  } catch (err) {
    console.warn("No se pudo muestrear superficie detallada; se usa altura aproximada.", err);
    return fallback;
  }
}

async function findRoofAnchorNearRing(x, y, searchRadius, lockForwardDistance=false, ringIndex=0) {
  if (!viewer?.scene?.sampleHeightSupported || !origin) {
    return { x, y, height: originAbsoluteHeight };
  }

  try {
    const candidates = [];

    if (lockForwardDistance) {
      // ARO 1: conserva exactamente la distancia hacia delante (200 m).
      // Solo busca una azotea ligeramente a izquierda/derecha de esa línea.
      const basis = ringBasis(ringIndex);
      const lateralOffsets = [0, -searchRadius*0.5, searchRadius*0.5, -searchRadius, searchRadius];
      lateralOffsets.forEach(side => {
        candidates.push({
          x: x + basis.sx * side,
          y: y + basis.sy * side,
          distance: Math.abs(side)
        });
      });
    } else {
      // Los demás aros pueden desplazarse un poco dentro de su zona nominal
      // para quedar realmente sobre una azotea, no en medio de una avenida.
      const steps = [-1, -0.5, 0, 0.5, 1];
      for (const gx of steps) {
        for (const gy of steps) {
          const dx = gx * searchRadius;
          const dy = gy * searchRadius;
          if (Math.hypot(dx,dy) > searchRadius * 1.15) continue;
          candidates.push({ x:x+dx, y:y+dy, distance:Math.hypot(dx,dy) });
        }
      }
    }

    const cartographics = candidates.map(cand => {
      const fixed = localToFixed(cand.x, cand.y, 0);
      const carto = Cesium.Cartographic.fromCartesian(fixed);
      carto.height = 0;
      return carto;
    });

    const sampled = await viewer.scene.sampleHeightMostDetailed(cartographics);
    const valid = [];
    for (let i=0; i<candidates.length; i++) {
      const h = sampled?.[i]?.height;
      if (Number.isFinite(h)) valid.push({ ...candidates[i], height:h });
    }
    if (!valid.length) return { x, y, height: originAbsoluteHeight };

    const heights = valid.map(v=>v.height).sort((a,b)=>a-b);
    const median = heights[Math.floor(heights.length/2)];
    const q75 = heights[Math.min(heights.length-1, Math.floor(heights.length*0.75))];

    // Preferimos superficies claramente elevadas respecto del entorno (azoteas),
    // pero sin saltar innecesariamente a una torre lejana.
    let roofCandidates = valid.filter(v => v.height >= Math.max(median + 2.0, q75 - 1.0));
    if (!roofCandidates.length) roofCandidates = valid;

    roofCandidates.sort((a,b) => {
      const scoreA = a.height - a.distance * 0.10;
      const scoreB = b.height - b.distance * 0.10;
      return scoreB - scoreA;
    });

    return roofCandidates[0];
  } catch (err) {
    console.warn("No se pudo buscar una azotea para el aro; se conserva su posición nominal.", err);
    return { x, y, height: originAbsoluteHeight };
  }
}

async function sampleExactSurfaceAtLocal(x, y, fallback) {
  if (!viewer?.scene?.sampleHeightSupported || !origin) return fallback;
  try {
    const fixed = localToFixed(x,y,0);
    const carto = Cesium.Cartographic.fromCartesian(fixed);
    carto.height = 0;
    const result = await viewer.scene.sampleHeightMostDetailed([carto]);
    const h = result?.[0]?.height;
    return Number.isFinite(h) ? h : fallback;
  } catch (_) { return fallback; }
}

async function calibrateRingAltitudes() {
  for (let i=0; i<ringRoute.length; i++) {
    const ring = ringRoute[i];

    if (placementMode === "manual") {
      // Manual: NO mueve la latitud/longitud escrita por el usuario.
      // La altura introducida se interpreta como metros sobre la superficie local.
      const exactSurface = await sampleExactSurfaceAtLocal(ring.x, ring.y, originAbsoluteHeight);
      const surfaceLocal = exactSurface - originAbsoluteHeight;
      ring.z = surfaceLocal + clamp(Number(ring.manualAgl ?? ring.z) || 75, 10, 1000);
      continue;
    }

    // Automático: puede desplazar ligeramente el aro para encontrar una azotea segura.
    const isFirst = i === 0;
    const anchor = await findRoofAnchorNearRing(
      ring.x,
      ring.y,
      isFirst ? 24 : 40,
      isFirst,
      i
    );
    ring.x = anchor.x;
    ring.y = anchor.y;
    const roofLocal = anchor.height - originAbsoluteHeight;
    const extra = Math.max(0, RING_HEIGHT_OFFSETS[i] || 0);
    ring.z = roofLocal + RING_RADIUS + RING_BUILDING_CLEARANCE + extra;
  }
}

function localToFixed(x, y, z) {
  return Cesium.Matrix4.multiplyByPoint(
    enuTransform,
    new Cesium.Cartesian3(x, y, z),
    new Cesium.Cartesian3()
  );
}

function fixedToLatLon(position) {
  const c = Cesium.Cartographic.fromCartesian(position);
  return [Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude)];
}

function surfaceExclusions() {
  const excluded = [];
  droneParts.forEach(p => excluded.push(p.entity));
  if (droneBillboard) excluded.push(droneBillboard);
  ringEntities.forEach(r => {
    if (r.tube) excluded.push(r.tube);
    if (r.line) excluded.push(r.line);
    if (r.halo) excluded.push(r.halo);
    if (r.label) excluded.push(r.label);
    if (r.center) excluded.push(r.center);
  });
  return excluded;
}

function updateGroundSample(nowMs) {
  if (!viewer?.scene?.sampleHeightSupported || !origin) return;
  // Al despegar, mantenemos bloqueado el suelo inicial unos segundos para garantizar 150 m AGL reales en el HUD.
  if (nowMs < spawnGroundLockUntil) return;
  if (nowMs - lastGroundSampleAt < 250) return;
  lastGroundSampleAt = nowMs;

  try {
    const p = localToFixed(drone.x, drone.y, drone.z);
    const c = Cesium.Cartographic.fromCartesian(p);
    c.height = 0;
    const h = viewer.scene.sampleHeight(c, surfaceExclusions(), 2.0);
    if (Number.isFinite(h)) groundAbsoluteHeight = h;
  } catch (_) {
    // Conserva la última altura conocida mientras terminan de cargar los tiles.
  }
}

function rotate2D(x, y, heading) {
  const s = Math.sin(heading), c = Math.cos(heading);
  return { x: x*c + y*s, y: -x*s + y*c };
}

function addPart(kind, localOffset, dims, color) {
  const options = {
    position: localToFixed(drone.x, drone.y, drone.z),
    orientation: Cesium.Quaternion.IDENTITY,
    show: true
  };

  if (kind === "box") {
    options.box = {
      dimensions: new Cesium.Cartesian3(dims[0], dims[1], dims[2]),
      material: Cesium.Color.fromCssColorString(color),
      shadows: Cesium.ShadowMode.DISABLED
    };
  } else if (kind === "cylinder") {
    options.cylinder = {
      length: dims[2],
      topRadius: dims[0],
      bottomRadius: dims[1],
      material: Cesium.Color.fromCssColorString(color),
      shadows: Cesium.ShadowMode.DISABLED
    };
  }

  const entity = viewer.entities.add(options);
  droneParts.push({ entity, localOffset });
}

function droneSvgDataUri() {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="180" height="110" viewBox="0 0 180 110">
    <defs>
      <filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity=".8"/></filter>
      <linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f8fb"/><stop offset="1" stop-color="#647886"/></linearGradient>
    </defs>
    <g filter="url(#s)">
      <g stroke="#1a232a" stroke-width="10" stroke-linecap="round">
        <path d="M75 53 L37 29"/><path d="M105 53 L143 29"/><path d="M75 58 L37 84"/><path d="M105 58 L143 84"/>
      </g>
      <g fill="none" stroke="#e8f4fb" stroke-width="5" opacity=".95">
        <ellipse cx="30" cy="23" rx="25" ry="9"/><ellipse cx="150" cy="23" rx="25" ry="9"/>
        <ellipse cx="30" cy="88" rx="25" ry="9"/><ellipse cx="150" cy="88" rx="25" ry="9"/>
      </g>
      <rect x="66" y="39" width="48" height="34" rx="12" fill="url(#b)" stroke="#17242d" stroke-width="4"/>
      <rect x="79" y="65" width="22" height="17" rx="7" fill="#101820" stroke="#70d9ff" stroke-width="3"/>
      <circle cx="73" cy="51" r="4" fill="#ff5252"/><circle cx="107" cy="51" r="4" fill="#5dff8a"/>
    </g>
  </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function buildDrone() {
  // Modelo 3D simple pero grande para tercera persona.
  addPart("box", {x:0,y:0,z:0}, [3.4,5.1,1.35], "#d9e4ea");
  addPart("box", {x:0,y:1.1,z:0.65}, [2.1,1.9,0.72], "#536977");
  addPart("box", {x:-2.8,y:0,z:0.08}, [4.3,0.38,0.32], "#202a31");
  addPart("box", {x: 2.8,y:0,z:0.08}, [4.3,0.38,0.32], "#202a31");
  addPart("box", {x:0,y:-2.8,z:0.08}, [0.38,4.3,0.32], "#202a31");
  addPart("box", {x:0,y: 2.8,z:0.08}, [0.38,4.3,0.32], "#202a31");

  [[-4.6,0],[4.6,0],[0,-4.6],[0,4.6]].forEach(([x,y]) => {
    addPart("cylinder", {x,y,z:0.22}, [2.05,2.05,0.11], "#12171b");
    addPart("cylinder", {x,y,z:0.08}, [0.40,0.40,0.72], "#3d464b");
  });
  addPart("cylinder", {x:0,y:2.65,z:-0.68}, [0.44,0.44,0.85], "#0e1317");
  addPart("box", {x:-0.9,y:2.35,z:0.28}, [0.32,0.34,0.24], "#ff4f4f");
  addPart("box", {x: 0.9,y:2.35,z:0.28}, [0.32,0.34,0.24], "#65ff8d");

  // Marcador siempre visible: evita que el dron desaparezca contra texturas oscuras o detrás de un tile.
  droneBillboard = viewer.entities.add({
    position: localToFixed(0,0,0),
    billboard: {
      image: droneSvgDataUri(),
      width: 112,
      height: 68,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: new Cesium.NearFarScalar(8, 1.2, 300, 0.45),
      pixelOffset: new Cesium.Cartesian2(0, 8),
      rotation: 0
    },
    show: true
  });
}

function setDroneVisibility(visible) {
  droneParts.forEach(part => part.entity.show = visible);
  if (droneBillboard) droneBillboard.show = visible;
}

function updateDroneParts() {
  const center = localToFixed(drone.x, drone.y, drone.z);
  const q = Cesium.Transforms.headingPitchRollQuaternion(
    center,
    new Cesium.HeadingPitchRoll(drone.heading, drone.pitch, drone.roll)
  );

  droneParts.forEach(part => {
    const o = rotate2D(part.localOffset.x, part.localOffset.y, drone.heading);
    part.entity.position = localToFixed(drone.x + o.x, drone.y + o.y, drone.z + part.localOffset.z);
    part.entity.orientation = q;
  });
  if (droneBillboard) {
    droneBillboard.position = center;
    // En tercera persona la cámara YA gira junto con el dron.
    // Rotar además el billboard por el heading hacía que pareciera acostado/de lado.
    // Se mantiene derecho en pantalla mientras el modelo 3D conserva el giro físico real.
    droneBillboard.billboard.rotation = 0;
  }
}

const RING_RADIUS = 33; // +50% respecto a V6
const RING_PASS_RADIUS = 22.5;
const RING_PLANE_TOLERANCE = 2.2;

function ringBasis(index) {
  const ring = ringRoute[index];
  const previous = index === 0 ? {x:0,y:0,z:0} : ringRoute[index-1];
  let dx = ring.x - previous.x;
  let dy = ring.y - previous.y;

  // Si dos puntos coincidieran, usa la dirección hacia el siguiente.
  if (Math.hypot(dx,dy) < 0.001 && index < ringRoute.length - 1) {
    dx = ringRoute[index+1].x - ring.x;
    dy = ringRoute[index+1].y - ring.y;
  }

  const len = Math.max(0.001, Math.hypot(dx,dy));
  const nx = dx / len; // normal horizontal del plano del aro = dirección de vuelo
  const ny = dy / len;
  return {
    nx, ny,
    sx: ny,   // eje horizontal dentro del aro
    sy: -nx
  };
}

function verticalRingPoints(index, radius=RING_RADIUS, segments=96) {
  const ring = ringRoute[index];
  const basis = ringBasis(index);
  const pts = [];
  for (let i=0;i<=segments;i++) {
    const a = i / segments * Math.PI * 2;
    const side = Math.cos(a) * radius;
    const up = Math.sin(a) * radius;
    pts.push(localToFixed(
      ring.x + basis.sx * side,
      ring.y + basis.sy * side,
      ring.z + up
    ));
  }
  return pts;
}

function tubeShape(radius=1.35, segments=14) {
  const shape = [];
  for (let i=0;i<segments;i++) {
    const a = i / segments * Math.PI * 2;
    shape.push(new Cesium.Cartesian2(Math.cos(a)*radius, Math.sin(a)*radius));
  }
  return shape;
}

function ringSvgDataUri(active, number) {
  const stroke = active ? "#ffe600" : "#ff8a24";
  const glow = active ? "#fff27a" : "#ffad55";
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220">
    <defs>
      <filter id="g" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="${active ? 9 : 6}" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <circle cx="110" cy="110" r="78" fill="rgba(0,0,0,0.02)" stroke="${glow}" stroke-width="${active ? 19 : 14}" opacity=".36" filter="url(#g)"/>
    <circle cx="110" cy="110" r="78" fill="none" stroke="#111820" stroke-width="${active ? 16 : 12}" opacity=".9"/>
    <circle cx="110" cy="110" r="78" fill="none" stroke="${stroke}" stroke-width="${active ? 11 : 8}" filter="url(#g)"/>
    <circle cx="110" cy="110" r="63" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="2" opacity=".8"/>
    <circle cx="110" cy="31" r="22" fill="#071018" stroke="${stroke}" stroke-width="4"/>
    <text x="110" y="41" text-anchor="middle" font-family="Segoe UI,Arial" font-size="28" font-weight="900" fill="#ffffff">${number}</text>
  </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function ringSvgDataUriDone(number) {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220">
    <defs><filter id="g"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <circle cx="110" cy="110" r="78" fill="none" stroke="#46f28d" stroke-width="11" filter="url(#g)"/>
    <circle cx="110" cy="110" r="63" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="2"/>
    <path d="M72 111l24 24 53-58" fill="none" stroke="#eafff2" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="110" cy="31" r="22" fill="#071018" stroke="#46f28d" stroke-width="4"/>
    <text x="110" y="41" text-anchor="middle" font-family="Segoe UI,Arial" font-size="28" font-weight="900" fill="#ffffff">${number}</text>
  </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function buildRings() {
  ringEntities = [];
  ringRoute.forEach((ring, i) => {
    const positions = verticalRingPoints(i);
    const active = i === 0;
    const color = active ? Cesium.Color.YELLOW : Cesium.Color.ORANGE;

    // Aro físico 3D: tubo grueso, no un simple punto.
    const tube = viewer.entities.add({
      polylineVolume: {
        positions,
        shape: tubeShape(active ? 2.0 : 1.55),
        material: color.withAlpha(active ? 0.98 : 0.90),
        cornerType: Cesium.CornerType.ROUNDED,
        shadows: Cesium.ShadowMode.DISABLED
      }
    });

    // Halo luminoso adicional. arcType NONE mantiene la geometría local exacta.
    const line = viewer.entities.add({
      polyline: {
        positions,
        width: active ? 12 : 7,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: active ? 0.55 : 0.32,
          color: color.withAlpha(0.98)
        }),
        depthFailMaterial: new Cesium.PolylineGlowMaterialProperty({
          glowPower: active ? 0.65 : 0.40,
          color: color.withAlpha(0.98)
        })
      }
    });

    // Aro 2D de respaldo siempre visible. Así nunca vuelve a quedar solo un punto.
    const halo = viewer.entities.add({
      position: localToFixed(ring.x, ring.y, ring.z),
      billboard: {
        image: ringSvgDataUri(active, i+1),
        width: active ? 190 : 132,
        height: active ? 190 : 132,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(50, 1.25, 5000, 0.72)
      }
    });

    const center = viewer.entities.add({
      position: localToFixed(ring.x, ring.y, ring.z),
      point: {
        pixelSize: active ? 8 : 5,
        color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });

    const label = viewer.entities.add({
      position: localToFixed(ring.x, ring.y, ring.z + RING_RADIUS + 7),
      label: {
        text: `ARO ${i+1}`,
        font: active ? "900 30px Segoe UI" : "900 22px Segoe UI",
        fillColor: active ? Cesium.Color.YELLOW : Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 6,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -8),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(20, 1.25, 5000, 0.62)
      }
    });

    ringEntities.push({ tube, line, halo, label, center });
  });
  updateRingStyles();
}

function desiredSpawnLocalZ() {
  return startAgl;
}

function resetMission() {
  drone.x = 0;
  drone.y = 0;
  drone.z = startAgl;
  drone.vx = drone.vy = drone.vz = 0;
  drone.heading = spawnHeading;
  drone.yawRate = 0;
  drone.pitch = 0;
  drone.roll = 0;
  currentRing = 0;
  groundAbsoluteHeight = originAbsoluteHeight;
  spawnGroundLockUntil = performance.now() + 3500;
  updateRingStyles();
  updateDroneParts();
  updateMiniMapMarkers(true);
  drawMiniRouteCanvas();
  updateCamera();
  showMessage(`DESPEGUE · ${Math.round(startAgl)} m SOBRE EL SUELO · AROS SOBRE AZOTEAS · ARO 1 A ~200 m`, 3000);
}

function updateRingStyles() {
  ringEntities.forEach((re, i) => {
    const active = i === currentRing;
    const done = i < currentRing;
    const future = i > currentRing;

    re.tube.show = true;
    re.line.show = true;
    re.halo.show = true;
    re.label.show = true;
    re.center.show = true;

    const color = done ? Cesium.Color.LIME : (active ? Cesium.Color.YELLOW : Cesium.Color.ORANGE);
    re.tube.polylineVolume.material = color.withAlpha(active ? 0.98 : 0.88);
    re.line.polyline.width = active ? 12 : 7;
    re.line.polyline.material = new Cesium.PolylineGlowMaterialProperty({
      glowPower: active ? 0.58 : 0.30,
      color: color.withAlpha(0.98)
    });
    re.line.polyline.depthFailMaterial = new Cesium.PolylineGlowMaterialProperty({
      glowPower: active ? 0.68 : 0.38,
      color: color.withAlpha(0.98)
    });
    re.halo.billboard.image = done ? ringSvgDataUriDone(i+1) : ringSvgDataUri(active, i+1);
    re.halo.billboard.width = active ? 190 : 132;
    re.halo.billboard.height = active ? 190 : 132;
    re.center.point.pixelSize = active ? 8 : 5;
    re.center.point.color = color;
    re.label.label.text = done ? `ARO ${i+1} ✓` : (active ? `ARO ${i+1} · OBJETIVO` : `ARO ${i+1}`);
    re.label.label.fillColor = done ? Cesium.Color.LIME : (active ? Cesium.Color.YELLOW : Cesium.Color.WHITE);
    re.label.label.font = active ? "900 30px Segoe UI" : "900 22px Segoe UI";

    // Los siguientes siguen visibles, pero con menos protagonismo que el objetivo.
    if (future) {
      re.halo.billboard.scaleByDistance = new Cesium.NearFarScalar(50, 0.95, 5000, 0.58);
    } else {
      re.halo.billboard.scaleByDistance = new Cesium.NearFarScalar(50, 1.25, 5000, 0.72);
    }
  });
  updateMiniMapRingStyles();
  updateRouteMapStatus();
}

function distanceToRing(ring) {
  const dx = ring.x - drone.x, dy = ring.y - drone.y, dz = ring.z - drone.z;
  return Math.hypot(dx, dy, dz);
}

function ringPlaneDistance(point, ring, basis) {
  return (point.x-ring.x)*basis.nx + (point.y-ring.y)*basis.ny;
}

function ringRadialDistance(point, ring, basis) {
  const lateral = (point.x-ring.x)*basis.sx + (point.y-ring.y)*basis.sy;
  const vertical = point.z-ring.z;
  return Math.hypot(lateral, vertical);
}

function completeCurrentRing() {
  currentRing++;
  beep(880, 0.16);
  if (currentRing >= ringRoute.length) {
    showMessage("¡MISIÓN COMPLETADA!", 5000);
  } else {
    showMessage(`ARO ${currentRing} SUPERADO · SIGUE AL ARO ${currentRing+1}`, 1800);
  }
  updateRingStyles();
}

function checkRings(previousPosition) {
  if (currentRing >= ringRoute.length) return;

  const ring = ringRoute[currentRing];
  const basis = ringBasis(currentRing);
  const currentPosition = {x:drone.x, y:drone.y, z:drone.z};
  const previous = previousPosition || currentPosition;

  // Ahora NO cuenta solo por pasar cerca.
  // Debe tocar/cruzar de verdad el plano del aro y hacerlo dentro del hueco útil.
  const s0 = ringPlaneDistance(previous, ring, basis);
  const s1 = ringPlaneDistance(currentPosition, ring, basis);
  const crossedPlane = (s0 <= 0 && s1 >= 0) || (s0 >= 0 && s1 <= 0);

  if (crossedPlane && Math.abs(s0 - s1) > 1e-6) {
    const t = Cesium.Math.clamp(s0 / (s0 - s1), 0, 1);
    const hit = {
      x: previous.x + (currentPosition.x-previous.x)*t,
      y: previous.y + (currentPosition.y-previous.y)*t,
      z: previous.z + (currentPosition.z-previous.z)*t
    };
    if (ringRadialDistance(hit, ring, basis) <= RING_PASS_RADIUS) {
      completeCurrentRing();
      return;
    }
  }

  // Respaldo SOLO si el dron está prácticamente en el mismo plano del aro
  // y realmente dentro del hueco; ya no basta con pasar cerca.
  if (Math.abs(s1) <= RING_PLANE_TOLERANCE && ringRadialDistance(currentPosition, ring, basis) <= RING_PASS_RADIUS) {
    completeCurrentRing();
  }
}

function updatePhysics(dt) {
  // Controles estilo dron según la referencia del usuario:
  // ↑/↓ avanzar-retroceder, ←/→ girar, A/D roll lateral,
  // W/S subir-bajar, SHIFT turbo y SPACE freno.
  const turbo = keys.has("ShiftLeft") || keys.has("ShiftRight");
  const braking = keys.has("Space");
  const accel = turbo ? 42 : 24;
  const maxSpeed = turbo ? 46 : 25;

  let forward = 0, strafe = 0, vertical = 0, yaw = 0;
  if (keys.has("ArrowUp")) forward += 1;
  if (keys.has("ArrowDown")) forward -= 1;
  if (keys.has("KeyD")) strafe += 1;
  if (keys.has("KeyA")) strafe -= 1;
  if (keys.has("KeyW")) vertical += 1;
  if (keys.has("KeyS")) vertical -= 1;
  if (keys.has("ArrowRight")) yaw += 1;
  if (keys.has("ArrowLeft")) yaw -= 1;

  // Giro más progresivo y natural, menos brusco.
  const targetYawRate = yaw * 0.88;
  drone.yawRate += (targetYawRate - drone.yawRate) * Math.min(1, dt * 2.15);
  if (!yaw) drone.yawRate *= Math.pow(0.34, dt);
  drone.heading += drone.yawRate * dt;

  const sh = Math.sin(drone.heading), ch = Math.cos(drone.heading);
  const ax = (sh * forward + ch * strafe) * accel;
  const ay = (ch * forward - sh * strafe) * accel;

  drone.vx += ax * dt;
  drone.vy += ay * dt;
  drone.vz += vertical * accel * 0.72 * dt;

  if (braking) {
    // Freno progresivo fuerte, sin invertir el movimiento.
    const brake = Math.pow(0.003, dt);
    drone.vx *= brake;
    drone.vy *= brake;
    drone.vz *= brake;
  } else {
    const drag = Math.pow(0.16, dt);
    if (!forward && !strafe) { drone.vx *= drag; drone.vy *= drag; }
    if (!vertical) drone.vz *= Math.pow(0.08, dt);
  }

  const horizontalSpeed = Math.hypot(drone.vx, drone.vy);
  if (horizontalSpeed > maxSpeed) {
    const k = maxSpeed / horizontalSpeed;
    drone.vx *= k;
    drone.vy *= k;
  }
  drone.vz = Cesium.Math.clamp(drone.vz, -12, 12);

  drone.x += drone.vx * dt;
  drone.y += drone.vy * dt;
  drone.z += drone.vz * dt;

  // Descenso real: el límite inferior sigue la geometría fotorealista muestreada.
  const surfaceZ = groundAbsoluteHeight - originAbsoluteHeight;
  const minZ = surfaceZ + MIN_SURFACE_CLEARANCE;
  if (drone.z < minZ) {
    drone.z = minZ;
    if (drone.vz < 0) drone.vz = 0;
  }
  drone.z = Math.min(drone.z, 1800);

  const targetRoll = -strafe * 0.34 - drone.yawRate * 0.10;
  const targetPitch = forward * 0.24;
  drone.roll += (targetRoll - drone.roll) * Math.min(1, dt*5);
  drone.pitch += (targetPitch - drone.pitch) * Math.min(1, dt*5);
}

function lookFromTo(eye, target) {
  const dir = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.subtract(target, eye, new Cesium.Cartesian3()),
    new Cesium.Cartesian3()
  );
  viewer.camera.setView({
    destination: eye,
    orientation: { direction: dir, up: enuUp }
  });
}

function updateCamera() {
  const sh = Math.sin(drone.heading), ch = Math.cos(drone.heading);
  let eyeLocal, targetLocal;

  if (cameraMode === 0) {
    // Cámara detrás y un poco arriba: el dron ocupa un tamaño visible y deja ver la ruta.
    eyeLocal = {
      x: drone.x - sh*24,
      y: drone.y - ch*24,
      z: drone.z + 9.5
    };
    targetLocal = {
      x: drone.x + sh*16,
      y: drone.y + ch*16,
      z: drone.z - 2.5
    };
  } else {
    eyeLocal = {
      x: drone.x + sh*2.8,
      y: drone.y + ch*2.8,
      z: drone.z + 0.35
    };
    targetLocal = {
      x: drone.x + sh*95,
      y: drone.y + ch*95,
      z: drone.z - Math.sin(drone.pitch)*20
    };
  }

  lookFromTo(
    localToFixed(eyeLocal.x, eyeLocal.y, eyeLocal.z),
    localToFixed(targetLocal.x, targetLocal.y, targetLocal.z)
  );
}

function normalizeDegrees(deg) {
  return ((deg % 360) + 360) % 360;
}

function cardinalFor(deg) {
  const labels = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return labels[Math.round(normalizeDegrees(deg) / 45) % 8];
}

function updateCompass() {
  const headingDeg = normalizeDegrees(Cesium.Math.toDegrees(drone.heading));
  ui.headingNeedle.style.transform = `rotate(${headingDeg}deg)`;
  ui.compassHeading.textContent = `${cardinalFor(headingDeg)} · ${String(Math.round(headingDeg)).padStart(3,"0")}°`;

  if (currentRing < ringRoute.length) {
    const ring = ringRoute[currentRing];
    const dx = ring.x - drone.x;
    const dy = ring.y - drone.y;
    const bearingDeg = normalizeDegrees(Cesium.Math.toDegrees(Math.atan2(dx, dy)));
    ui.targetNeedle.style.opacity = "1";
    ui.targetNeedle.style.transform = `rotate(${bearingDeg}deg)`;
    ui.targetBearing.textContent = `OBJ · ${String(Math.round(bearingDeg)).padStart(3,"0")}°`;
  } else {
    ui.targetNeedle.style.opacity = "0";
    ui.targetBearing.textContent = "OBJ · COMPLETADO";
  }
}

function autoCalibrateSpawnHeight(nowMs) {
  if (nowMs > spawnAssistUntil) return;
  const desired = startAgl;
  const diff = desired - drone.z;
  if (Math.abs(diff) < 0.05) {
    drone.z = desired;
    return;
  }
  drone.z += diff * 0.32;
  drone.vz *= 0.35;
}

function drawMiniRouteCanvas() {
  const canvas = ui.miniRouteCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);

  ctx.fillStyle = '#07131b';
  ctx.fillRect(0,0,w,h);

  ctx.strokeStyle = 'rgba(120,180,210,0.18)';
  ctx.lineWidth = 1;
  for (let x=20; x<w; x+=42) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for (let y=20; y<h; y+=42) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

  const points = [{x:0,y:0}, ...ringRoute.map(r => ({x:r.x,y:r.y}))];
  const allX = points.map(p=>p.x).concat([drone.x]);
  const allY = points.map(p=>p.y).concat([drone.y]);
  const minX = Math.min(...allX), maxX = Math.max(...allX);
  const minY = Math.min(...allY), maxY = Math.max(...allY);
  const pad = 26;
  const spanX = Math.max(1, maxX-minX), spanY = Math.max(1, maxY-minY);
  const scale = Math.min((w-pad*2)/spanX, (h-pad*2)/spanY);
  const ox = pad + (w-pad*2-spanX*scale)/2;
  const oy = pad + (h-pad*2-spanY*scale)/2;
  const proj = p => ({ x: ox + (p.x-minX)*scale, y: h - (oy + (p.y-minY)*scale) });
  const pr = points.map(proj);
  const droneP = proj({x:drone.x,y:drone.y});

  for (let i=0; i<pr.length-1; i++) {
    ctx.beginPath();
    ctx.moveTo(pr[i].x, pr[i].y);
    ctx.lineTo(pr[i+1].x, pr[i+1].y);
    if (i < currentRing) {
      ctx.strokeStyle = '#44e58f';
      ctx.lineWidth = 3.8;
    } else if (i === currentRing) {
      ctx.strokeStyle = '#ffd84d';
      ctx.lineWidth = 3.5;
    } else {
      ctx.strokeStyle = 'rgba(240,245,248,0.72)';
      ctx.lineWidth = 2.1;
    }
    ctx.stroke();
  }

  // ring markers
  for (let i=1; i<pr.length; i++) {
    const p = pr[i];
    let fill = 'rgba(230,235,240,0.95)', stroke = '#0a1218';
    if (i-1 < currentRing) fill = '#44e58f';
    else if (i-1 === currentRing) fill = '#ffd84d';
    else fill = '#dfe8ee';
    ctx.beginPath();
    ctx.arc(p.x,p.y, i-1===currentRing ? 6.5 : 4.6, 0, Math.PI*2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.fillStyle = '#f5fbff';
    ctx.font = 'bold 10px Segoe UI';
    ctx.fillText(String(i), p.x+7, p.y-7);
  }

  if (currentRing < ringRoute.length) {
    const targetP = pr[currentRing+1];
    ctx.beginPath();
    ctx.moveTo(droneP.x, droneP.y);
    ctx.lineTo(targetP.x, targetP.y);
    ctx.strokeStyle = 'rgba(255,216,77,0.45)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6,5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // drone arrow
  ctx.save();
  ctx.translate(droneP.x, droneP.y);
  ctx.rotate(-drone.heading);
  ctx.beginPath();
  ctx.moveTo(0,-10);
  ctx.lineTo(7,8);
  ctx.lineTo(0,4);
  ctx.lineTo(-7,8);
  ctx.closePath();
  ctx.fillStyle = '#4fdcff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.restore();
}

function updateHud(nowMs) {
  const p = localToFixed(drone.x, drone.y, drone.z);
  const c = Cesium.Cartographic.fromCartesian(p);
  const lat = Cesium.Math.toDegrees(c.latitude);
  const lon = Cesium.Math.toDegrees(c.longitude);
  const absoluteAlt = c.height;

  heightAboveSurface = Number.isFinite(groundAbsoluteHeight) ? Math.max(0, absoluteAlt - groundAbsoluteHeight) : null;
  ui.coords.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  ui.altitude.textContent = heightAboveSurface === null
    ? `Altura: ${Math.round(absoluteAlt)} m s.n.m.`
    : `Sobre superficie: ${Math.round(heightAboveSurface)} m · Alt. abs.: ${Math.round(absoluteAlt)} m`;
  ui.speed.textContent = `Velocidad: ${(Math.hypot(drone.vx,drone.vy,drone.vz)*3.6).toFixed(0)} km/h`;
  ui.progress.textContent = `${Math.min(currentRing,totalRings())} / ${totalRings()} aros`;
  updateCompass();

  if (currentRing < ringRoute.length) {
    const d = distanceToRing(ringRoute[currentRing]);
    ui.objective.textContent = `ARO ${currentRing+1} · ${Math.max(0,Math.round(d))} m`;
  } else {
    ui.objective.textContent = "MISIÓN COMPLETADA";
  }

  if (nowMs - lastHudMapUpdateAt > 100) {
    lastHudMapUpdateAt = nowMs;
    updateMiniMapMarkers(false);
    updateRouteMapStatus();
    drawMiniRouteCanvas();
  }
}

function updateQualityStatus() {
  const q = Number(ui.quality.value) || 8;
  ui.qualityStatus.textContent = q <= 8 ? "DETALLE 3D ALTO" : q <= 12 ? "DETALLE 3D EQUILIBRADO" : "MODO RÁPIDO";
}

function updateRouteMapStatus() {
  if (!ui.routeMapStatus) return;
  if (currentRing < ringRoute.length) {
    const d = distanceToRing(ringRoute[currentRing]);
    ui.routeMapStatus.textContent = `ARO ${currentRing+1} · ${Math.max(0,Math.round(d))} m · objetivo actual`;
  } else {
    ui.routeMapStatus.textContent = `MISIÓN COMPLETADA · ${totalRings()} / ${totalRings()} aros`;
  }
}

function setMapView(open) {
  if (!running && open) return;
  mapViewOpen = Boolean(open);
  keys.clear();
  ui.routeView.hidden = !mapViewOpen;
  ui.mapViewBtn.textContent = mapViewOpen ? "🚁 Volver al vuelo" : "🗺 Mapa de ruta";
  if (mapViewOpen) {
    updateRouteMapStatus();
    setTimeout(() => {
      if (!miniMap) return;
      miniMap.invalidateSize();
      if (miniRouteBounds) miniMap.fitBounds(miniRouteBounds, { animate:false, padding:[70,70] });
    }, 60);
  }
}

function toggleMapView() {
  setMapView(!mapViewOpen);
}

function initMiniMap() {
  destroyMiniMap();
  if (!window.L) return;

  miniMap = L.map("routeMap", {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }).addTo(miniMap);

  const startLatLon = fixedToLatLon(localToFixed(0,0,0));
  const routeLatLngs = [startLatLon];
  ringRoute.forEach(r => routeLatLngs.push(fixedToLatLon(localToFixed(r.x,r.y,r.z))));

  miniRouteLine = L.polyline(routeLatLngs, {
    color: "#4fcfff",
    weight: 3,
    opacity: 0.8,
    dashArray: "7 7"
  }).addTo(miniMap);

  miniRingMarkers = ringRoute.map((ring, i) => {
    const ll = fixedToLatLon(localToFixed(ring.x, ring.y, ring.z));
    const icon = makeRingIcon(i, i === 0 ? "active" : "future");
    return L.marker(ll, { icon, keyboard:false, zIndexOffset: i === 0 ? 1000 : 200 }).addTo(miniMap);
  });

  miniDroneMarker = L.marker(startLatLon, {
    icon: L.divIcon({ className:"", html:'<div class="drone-marker"></div>', iconSize:[26,26], iconAnchor:[13,13] }),
    keyboard:false,
    zIndexOffset:2000
  }).addTo(miniMap);

  miniTargetLine = L.polyline([startLatLon, routeLatLngs[1]], {
    color: "#ffe34d",
    weight: 3,
    opacity: 0.95
  }).addTo(miniMap);

  miniRouteBounds = L.latLngBounds(routeLatLngs).pad(0.16);
  miniMap.fitBounds(miniRouteBounds, { animate:false, padding:[70,70] });
  setTimeout(() => miniMap?.invalidateSize(), 80);
}

function makeRingIcon(index, state) {
  if (!window.L) return null;
  return L.divIcon({
    className: "",
    html: `<div class="ring-marker ${state}">${index+1}</div>`,
    iconSize: state === "active" ? [38,38] : [30,30],
    iconAnchor: state === "active" ? [19,19] : [15,15]
  });
}

function updateMiniMapRingStyles() {
  if (!miniMap || !window.L) return;
  miniRingMarkers.forEach((marker, i) => {
    const state = i < currentRing ? "done" : i === currentRing ? "active" : "future";
    marker.setIcon(makeRingIcon(i, state));
    marker.setZIndexOffset(state === "active" ? 1200 : state === "done" ? 100 : 300);
  });
}

function updateMiniMapMarkers(force) {
  if (!miniMap || !miniDroneMarker || !origin) return;
  const droneLatLon = fixedToLatLon(localToFixed(drone.x,drone.y,drone.z));
  miniDroneMarker.setLatLng(droneLatLon);

  const arrow = miniDroneMarker.getElement()?.querySelector(".drone-marker");
  if (arrow) arrow.style.transform = `rotate(${normalizeDegrees(Cesium.Math.toDegrees(drone.heading))}deg)`;

  if (miniTargetLine) {
    if (currentRing < ringRoute.length) {
      const r = ringRoute[currentRing];
      const targetLatLon = fixedToLatLon(localToFixed(r.x,r.y,r.z));
      miniTargetLine.setLatLngs([droneLatLon, targetLatLon]);
    } else {
      miniTargetLine.setLatLngs([]);
    }
  }

  if (force && miniRouteBounds) miniMap.fitBounds(miniRouteBounds, { animate:false, padding:[70,70] });
}

function destroyMiniMap() {
  mapViewOpen = false;
  if (ui.routeView) ui.routeView.hidden = true;
  if (ui.mapViewBtn) ui.mapViewBtn.textContent = "🗺 Mapa de ruta";
  if (miniMap) {
    miniMap.remove();
    miniMap = null;
  }
  miniDroneMarker = null;
  miniRingMarkers = [];
  miniRouteLine = null;
  miniTargetLine = null;
  miniRouteBounds = null;
}

function frame(t) {
  if (!running || !viewer || viewer.isDestroyed()) return;
  if (!frame.last) frame.last = t;
  const dt = Math.min(0.05, (t - frame.last)/1000);
  frame.last = t;

  const previousPosition = {x:drone.x, y:drone.y, z:drone.z};

  if (!mapViewOpen) {
    updateGroundSample(t);
    autoCalibrateSpawnHeight(t);
    updatePhysics(dt);
    updateDroneParts();
    updateCamera();
    checkRings(previousPosition);
  }

  updateHud(t);
  updateAudio();
  requestAnimationFrame(frame);
}

function showMessage(text, ms=1500) {
  ui.centerMessage.textContent = text;
  ui.centerMessage.hidden = false;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => ui.centerMessage.hidden = true, ms);
}

function startAudio() {
  if (!soundOn || audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    rotorOsc = audioCtx.createOscillator();
    rotorGain = audioCtx.createGain();
    rotorOsc.type = "sawtooth";
    rotorOsc.frequency.value = 76;
    rotorGain.gain.value = 0.025;
    rotorOsc.connect(rotorGain).connect(audioCtx.destination);
    rotorOsc.start();
  } catch (_) {}
}

function updateAudio() {
  if (!audioCtx || !rotorOsc || !rotorGain) return;
  const s = Math.hypot(drone.vx,drone.vy,drone.vz);
  rotorOsc.frequency.setTargetAtTime(72 + s*1.4, audioCtx.currentTime, 0.08);
  rotorGain.gain.setTargetAtTime(soundOn ? 0.022 + Math.min(0.02,s/1800) : 0, audioCtx.currentTime, 0.08);
}

function beep(freq, duration) {
  if (!soundOn || !audioCtx) return;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.frequency.value = freq;
  o.type = "sine";
  g.gain.value = 0.08;
  o.connect(g).connect(audioCtx.destination);
  o.start();
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
  o.stop(audioCtx.currentTime + duration);
}

function toggleCamera() {
  cameraMode = (cameraMode + 1) % 2;
  const thirdPerson = cameraMode === 0;
  ui.cameraBtn.textContent = thirdPerson ? "🎥 Tercera persona" : "👁 FPV";
  setDroneVisibility(thirdPerson);
  // En tercera persona, el + queda justo delante del dron; en FPV vuelve al centro.
  if (ui.crosshair) ui.crosshair.style.top = thirdPerson ? "63%" : "50%";
}

function destroyRuntime() {
  running = false;
  frame.last = 0;
  destroyMiniMap();
  if (viewer && !viewer.isDestroyed()) viewer.destroy();
  viewer = null;
  tileset = null;
  droneParts = [];
  droneBillboard = null;
  ringEntities = [];
  origin = null;
  enuTransform = null;
  enuRotation = null;
  enuUp = null;
  groundAbsoluteHeight = 0;
  originAbsoluteHeight = 0;
  heightAboveSurface = null;
  lastGroundSampleAt = 0;
}

window.addEventListener("keydown", e => {
  if (["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code)) e.preventDefault();

  if (e.code === "KeyM" && !e.repeat && running) {
    toggleMapView();
    return;
  }
  if (e.code === "Escape" && !e.repeat && mapViewOpen) {
    setMapView(false);
    return;
  }
  if (mapViewOpen) return;

  keys.add(e.code);
  if (["KeyW","KeyA","KeyS","KeyD","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space","ShiftLeft","ShiftRight"].includes(e.code)) spawnAssistUntil = Math.min(spawnAssistUntil, performance.now() + 1200);
  if (e.code === "KeyC" && !e.repeat) toggleCamera();
  if (e.code === "KeyR" && !e.repeat && running) resetMission();
});
window.addEventListener("keyup", e => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());

ui.startBtn.addEventListener("click", startGame);
ui.apiKey.addEventListener("keydown", e => { if (e.key === "Enter") startGame(); });
ui.cameraBtn.addEventListener("click", toggleCamera);
ui.soundBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  if (soundOn) startAudio();
  ui.soundBtn.textContent = soundOn ? "🔊 Sonido ON" : "🔇 Sonido OFF";
});
ui.mapViewBtn.addEventListener("click", toggleMapView);
ui.closeMapBtn.addEventListener("click", () => setMapView(false));
ui.fitRouteBtn.addEventListener("click", () => {
  if (miniMap && miniRouteBounds) {
    miniMap.invalidateSize();
    miniMap.fitBounds(miniRouteBounds, { animate:true, padding:[70,70] });
  }
});
ui.settingsBtn.addEventListener("click", () => {
  destroyRuntime();
  ui.hud.hidden = true;
  ui.setup.hidden = false;
});

})();
