(function () {
  const TFJS_URL = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
  const COCO_SSD_URL = "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js";
  const MODEL_PATH = "/models/object-detector/";

  const classLabels = {
    cup: "TAZA",
    car: "CARRO",
    truck: "CARRO",
    bus: "CARRO",
    airplane: "AVION",
  };

  const targetClasses = {
    auto: ["cup", "car", "truck", "bus", "airplane"],
    cup: ["cup"],
    car: ["car", "truck", "bus"],
    plane: ["airplane"],
  };

  const minScore = {
    cup: 0.46,
    car: 0.35,
    truck: 0.35,
    bus: 0.35,
    airplane: 0.35,
  };

  const state = {
    webcam: null,
    running: false,
    paused: false,
    rafId: 0,
    lastFrameAt: performance.now(),
    frameIndex: 0,
    objectTarget: "auto",
    detector: null,
    detectorLoading: null,
    detectorFailed: false,
    detecting: false,
    detections: [],
  };

  const $ = (selector) => document.querySelector(selector);

  const els = {
    video: $("#camera-video"),
    canvas: $("#output-canvas"),
    status: $("#demo-status"),
    object: $("#detected-object"),
    confidence: $("#detected-confidence"),
    position: $("#detected-position"),
    tracking: $("#tracking-status"),
    fps: $("#fps-value"),
    modelPath: $("#model-path"),
    start: $("#start-camera"),
    pause: $("#pause-camera"),
    stop: $("#stop-camera"),
    switch: $("#switch-camera"),
    loadModel: $("#load-model"),
    objectButtons: document.querySelectorAll("[data-object-target]"),
  };

  const setStatus = (message, tone = "") => {
    els.status.textContent = message;
    els.status.dataset.tone = tone;
  };

  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.ready === "true") {
          resolve();
          return;
        }

        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error(`No se pudo cargar ${src}`)), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => {
        script.dataset.ready = "true";
        resolve();
      };
      script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      document.head.appendChild(script);
    });

  const loadDetector = async () => {
    if (state.detector) {
      return state.detector;
    }

    if (state.detectorLoading) {
      return state.detectorLoading;
    }

    state.detectorFailed = false;
    setStatus("Cargando detector real de objetos en el navegador...", "warn");
    els.loadModel.disabled = true;
    els.loadModel.textContent = "Cargando modelo...";

    state.detectorLoading = (async () => {
      await loadScript(TFJS_URL);
      await loadScript(COCO_SSD_URL);

      if (!window.cocoSsd?.load) {
        throw new Error("El detector de objetos no quedo disponible en el navegador.");
      }

      state.detector = await window.cocoSsd.load({ base: "lite_mobilenet_v2" });
      setStatus("Modelo cargado. Detectando taza, carro y avion en tiempo real.", "ok");
      els.loadModel.textContent = "Modelo cargado";
      els.modelPath.textContent = "COCO-SSD navegador + " + MODEL_PATH;
      return state.detector;
    })();

    try {
      return await state.detectorLoading;
    } catch (error) {
      state.detectorFailed = true;
      state.detectorLoading = null;
      els.loadModel.disabled = false;
      els.loadModel.textContent = "Reintentar modelo";
      setStatus("No se pudo cargar el modelo. Revisa internet o vuelve a intentarlo.", "error");
      throw error;
    }
  };

  const resizeCanvas = () => {
    const width = els.video.videoWidth || 960;
    const height = els.video.videoHeight || 540;
    if (els.canvas.width !== width || els.canvas.height !== height) {
      els.canvas.width = width;
      els.canvas.height = height;
    }
  };

  const resetReadout = (message = "Sin deteccion") => {
    els.object.textContent = message;
    els.confidence.textContent = "-";
    els.position.textContent = "-";
    els.tracking.textContent = "BUSCANDO";
  };

  const allowedClasses = () => targetClasses[state.objectTarget] || targetClasses.auto;

  const mapPrediction = (prediction) => {
    const [x, y, width, height] = prediction.bbox;
    return {
      label: classLabels[prediction.class],
      sourceClass: prediction.class,
      confidence: Math.round(prediction.score * 100),
      bounds: {
        x,
        y,
        width,
        height,
      },
    };
  };

  const detectWithModel = async () => {
    if (!state.detector || state.detecting || !state.running || state.paused) {
      return;
    }

    state.detecting = true;
    try {
      const allowed = allowedClasses();
      const predictions = await state.detector.detect(els.video);
      state.detections = predictions
        .filter((prediction) => allowed.includes(prediction.class))
        .filter((prediction) => prediction.score >= (minScore[prediction.class] || 0.4))
        .map(mapPrediction)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3);
    } catch (error) {
      state.detectorFailed = true;
      setStatus("El detector fallo durante la lectura de la camara.", "error");
    } finally {
      state.detecting = false;
    }
  };

  const drawDetections = (ctx, detections) => {
    detections.forEach((detection) => {
      const { bounds, label, confidence } = detection;
      const centerX = Math.round(bounds.x + bounds.width / 2);
      const centerY = Math.round(bounds.y + bounds.height / 2);

      ctx.lineWidth = 4;
      ctx.strokeStyle = "#51d20c";
      ctx.fillStyle = "rgba(81, 210, 12, 0.95)";
      ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      ctx.fillRect(bounds.x, Math.max(0, bounds.y - 34), Math.min(230, bounds.width + 76), 30);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 18px system-ui, sans-serif";
      ctx.fillText(`${label} ${confidence}%`, bounds.x + 10, Math.max(22, bounds.y - 12));

      ctx.beginPath();
      ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#51d20c";
      ctx.fill();
    });

    const primary = detections[0];
    if (primary) {
      const centerX = Math.round(primary.bounds.x + primary.bounds.width / 2);
      const centerY = Math.round(primary.bounds.y + primary.bounds.height / 2);
      els.object.textContent = primary.label;
      els.confidence.textContent = `${primary.confidence}%`;
      els.position.textContent = `${centerX}, ${centerY}`;
      els.tracking.textContent = "DETECTADO";
    }
  };

  const drawFrame = () => {
    if (!state.running) {
      return;
    }

    if (!state.paused) {
      resizeCanvas();
      const ctx = els.canvas.getContext("2d");
      ctx.drawImage(els.video, 0, 0, els.canvas.width, els.canvas.height);

      state.frameIndex += 1;
      if (state.detector && state.frameIndex % 10 === 0) {
        detectWithModel();
      }

      if (state.detections.length) {
        drawDetections(ctx, state.detections);
      } else {
        resetReadout(state.detector ? "Sin taza, carro o avion" : "Cargando modelo...");
      }

      ctx.fillStyle = "rgba(5, 11, 15, 0.66)";
      ctx.fillRect(16, 16, Math.min(els.canvas.width - 32, 560), 86);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 18px system-ui, sans-serif";
      ctx.fillText(state.detector ? "Deteccion real activa" : "Cargando detector de objetos", 32, 48);
      ctx.font = "14px system-ui, sans-serif";
      ctx.fillText("Auto detecta taza, carro y avion. Modo actual: " + state.objectTarget.toUpperCase(), 32, 76);
    }

    const now = performance.now();
    els.fps.textContent = String(Math.min(60, Math.round(1000 / Math.max(now - state.lastFrameAt, 1))));
    state.lastFrameAt = now;
    state.rafId = requestAnimationFrame(drawFrame);
  };

  const startDemo = async () => {
    try {
      els.start.disabled = true;
      state.webcam ||= new window.WebcamService(els.video);
      await state.webcam.start();
      state.running = true;
      state.paused = false;
      setStatus("Camara activa. Cargando modelo para deteccion real...", "warn");
      drawFrame();
      loadDetector().catch(() => {
        state.detections = [];
      });
    } catch (error) {
      setStatus(error.message, "error");
      els.start.disabled = false;
    }
  };

  const stopDemo = () => {
    state.running = false;
    state.paused = false;
    cancelAnimationFrame(state.rafId);
    state.webcam?.stop();
    els.canvas.getContext("2d").clearRect(0, 0, els.canvas.width, els.canvas.height);
    state.detections = [];
    resetReadout("Camara detenida");
    els.start.disabled = false;
    els.pause.textContent = "Pausar";
    setStatus("Camara detenida.");
  };

  els.start?.addEventListener("click", startDemo);
  els.pause?.addEventListener("click", () => {
    state.paused = !state.paused;
    els.pause.textContent = state.paused ? "Reanudar" : "Pausar";
  });
  els.stop?.addEventListener("click", stopDemo);
  els.switch?.addEventListener("click", async () => {
    try {
      await state.webcam?.switchCamera();
      state.detections = [];
      setStatus("Camara cambiada.", "ok");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
  els.loadModel?.addEventListener("click", () => {
    loadDetector().catch(() => {});
  });
  els.objectButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.objectTarget = button.dataset.objectTarget || "auto";
      state.detections = [];
      els.objectButtons.forEach((item) => {
        const isActive = item === button;
        item.classList.toggle("is-active", isActive);
        item.setAttribute("aria-pressed", String(isActive));
      });
      setStatus(
        state.detector
          ? `Modo ${button.textContent.trim()} activo. Usando modelo real en navegador.`
          : `Modo ${button.textContent.trim()} activo. Cargando modelo real en navegador.`,
        state.detector ? "ok" : "warn"
      );
      if (!state.detector) {
        loadDetector().catch(() => {});
      }
    });
  });

  resetReadout("Camara detenida");
  els.modelPath.textContent = "COCO-SSD navegador + " + MODEL_PATH;
  window.addEventListener("pagehide", stopDemo);
  window.addEventListener("beforeunload", stopDemo);
})();
