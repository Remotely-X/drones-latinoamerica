(function () {
  const state = {
    webcam: null,
    running: false,
    paused: false,
    showContours: true,
    rafId: 0,
    lastFrameAt: performance.now(),
    frameIndex: 0,
    lastDetection: null,
    shapeTarget: "auto",
  };

  const $ = (selector) => document.querySelector(selector);

  const els = {
    video: $("#camera-video"),
    canvas: $("#output-canvas"),
    workCanvas: $("#work-canvas"),
    status: $("#demo-status"),
    shape: $("#detected-shape"),
    confidence: $("#detected-confidence"),
    position: $("#detected-position"),
    tracking: $("#tracking-status"),
    fps: $("#fps-value"),
    start: $("#start-camera"),
    pause: $("#pause-camera"),
    stop: $("#stop-camera"),
    switch: $("#switch-camera"),
    contours: $("#toggle-contours"),
    shapeButtons: document.querySelectorAll("[data-shape-target]"),
  };

  const setStatus = (message, tone = "") => {
    els.status.textContent = message;
    els.status.dataset.tone = tone;
  };

  const resetReadout = () => {
    els.shape.textContent = "Figura no reconocida";
    els.confidence.textContent = "0%";
    els.position.textContent = "-";
    els.tracking.textContent = "SIN SEGUIMIENTO";
  };

  const resizeCanvas = () => {
    const width = els.video.videoWidth || 960;
    const height = els.video.videoHeight || 540;
    if (els.canvas.width !== width || els.canvas.height !== height) {
      els.canvas.width = width;
      els.canvas.height = height;
    }
  };

  const getPixelInfo = (data, index) => {
    const pixel = index * 4;
    const r = data[pixel];
    const g = data[pixel + 1];
    const b = data[pixel + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return {
      gray: r * 0.299 + g * 0.587 + b * 0.114,
      saturation: max - min,
    };
  };

  const componentBounds = (points) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    points.forEach((point) => {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    });
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  };

  const collectComponents = (mask, width, height, minSize = 20) => {
    const visited = new Uint8Array(width * height);
    const components = [];
    const queue = [];

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const start = y * width + x;
        if (!mask[start] || visited[start]) {
          continue;
        }

        const points = [];
        queue.length = 0;
        queue.push({ x, y });
        visited[start] = 1;

        while (queue.length) {
          const point = queue.pop();
          points.push(point);
          const neighbors = [
            [point.x + 1, point.y],
            [point.x - 1, point.y],
            [point.x, point.y + 1],
            [point.x, point.y - 1],
          ];

          neighbors.forEach(([nx, ny]) => {
            if (nx <= 0 || ny <= 0 || nx >= width - 1 || ny >= height - 1) {
              return;
            }

            const next = ny * width + nx;
            if (mask[next] && !visited[next]) {
              visited[next] = 1;
              queue.push({ x: nx, y: ny });
            }
          });
        }

        if (points.length >= minSize) {
          components.push({ points, bounds: componentBounds(points) });
        }
      }
    }

    return components;
  };

  const findPaperRegion = (data, width, height) => {
    const brightMask = new Uint8Array(width * height);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const { gray, saturation } = getPixelInfo(data, index);
        brightMask[index] = gray > 128 && saturation < 82 ? 1 : 0;
      }
    }

    const components = collectComponents(brightMask, width, height, 900);
    const candidates = components
      .map((component) => {
        const { bounds } = component;
        const touchesBorder =
          bounds.x < 4 || bounds.y < 4 || bounds.x + bounds.width > width - 4 || bounds.y + bounds.height > height - 4;
        const aspect = bounds.width / Math.max(bounds.height, 1);
        const area = bounds.width * bounds.height;
        return { ...component, aspect, area, touchesBorder };
      })
      .filter((component) => {
        const { bounds, aspect, area, touchesBorder } = component;
        return (
          !touchesBorder &&
          area > width * height * 0.04 &&
          area < width * height * 0.72 &&
          bounds.width > width * 0.16 &&
          bounds.height > height * 0.14 &&
          aspect > 0.65 &&
          aspect < 2.9
        );
      })
      .sort((a, b) => b.area - a.area);

    if (candidates.length) {
      const bounds = candidates[0].bounds;
      const insetX = Math.round(bounds.width * 0.08);
      const insetY = Math.round(bounds.height * 0.1);
      return {
        x: Math.max(0, bounds.x + insetX),
        y: Math.max(0, bounds.y + insetY),
        width: Math.min(width - bounds.x, bounds.width - insetX * 2),
        height: Math.min(height - bounds.y, bounds.height - insetY * 2),
      };
    }

    return {
      x: Math.round(width * 0.18),
      y: Math.round(height * 0.18),
      width: Math.round(width * 0.64),
      height: Math.round(height * 0.64),
    };
  };

  const dilateMask = (mask, width, height) => {
    const out = new Uint8Array(mask.length);
    for (let y = 3; y < height - 3; y += 1) {
      for (let x = 3; x < width - 3; x += 1) {
        const index = y * width + x;
        if (!mask[index]) {
          continue;
        }

        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            out[(y + dy) * width + x + dx] = 1;
          }
        }
      }
    }
    return out;
  };

  const polygonScore = (points, bounds) => {
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const distances = points.map((point) => Math.hypot(point.x - centerX, point.y - centerY));
    const mean = distances.reduce((sum, value) => sum + value, 0) / Math.max(distances.length, 1);
    const variance = distances.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(distances.length, 1);
    const radialStd = Math.sqrt(variance) / Math.max(mean, 1);
    const edgeMargin = Math.max(3, Math.round(Math.min(bounds.width, bounds.height) * 0.14));
    const nearBoxEdge = points.filter((point) => {
      const px = Math.abs(point.x - bounds.x) < edgeMargin || Math.abs(point.x - (bounds.x + bounds.width)) < edgeMargin;
      const py = Math.abs(point.y - bounds.y) < edgeMargin || Math.abs(point.y - (bounds.y + bounds.height)) < edgeMargin;
      return px || py;
    }).length;

    return {
      radialStd,
      edgeScore: nearBoxEdge / Math.max(points.length, 1),
    };
  };

  const cross = (origin, a, b) => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);

  const convexHull = (points) => {
    if (points.length <= 3) {
      return points;
    }

    const step = Math.max(1, Math.floor(points.length / 1200));
    const sampled = points.filter((_, index) => index % step === 0).sort((a, b) => a.x - b.x || a.y - b.y);
    const lower = [];
    const upper = [];

    sampled.forEach((point) => {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
        lower.pop();
      }
      lower.push(point);
    });

    for (let i = sampled.length - 1; i >= 0; i -= 1) {
      const point = sampled[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
        upper.pop();
      }
      upper.push(point);
    }

    return lower.slice(0, -1).concat(upper.slice(0, -1));
  };

  const polygonArea = (points) => {
    let area = 0;
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      area += point.x * next.y - next.x * point.y;
    });
    return Math.abs(area) / 2;
  };

  const polygonPerimeter = (points) =>
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + Math.hypot(next.x - point.x, next.y - point.y);
    }, 0);

  const distanceToLine = (point, start, end) => {
    const numerator = Math.abs((end.y - start.y) * point.x - (end.x - start.x) * point.y + end.x * start.y - end.y * start.x);
    const denominator = Math.hypot(end.y - start.y, end.x - start.x);
    return denominator ? numerator / denominator : 0;
  };

  const simplifyHull = (points, epsilon) => {
    if (points.length <= 4) {
      return points;
    }

    let polygon = points.slice();
    let changed = true;
    while (changed && polygon.length > 3) {
      changed = false;
      for (let i = 0; i < polygon.length; i += 1) {
        const previous = polygon[(i - 1 + polygon.length) % polygon.length];
        const current = polygon[i];
        const next = polygon[(i + 1) % polygon.length];
        if (distanceToLine(current, previous, next) < epsilon) {
          polygon.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    return polygon;
  };

  const getShapeFeatures = (points, bounds) => {
    const hull = convexHull(points);
    const simplified = simplifyHull(hull, Math.max(bounds.width, bounds.height) * 0.075);
    const perimeter = polygonPerimeter(hull);
    const area = polygonArea(hull);
    const circularity = perimeter ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
    const { radialStd, edgeScore } = polygonScore(points, bounds);
    return {
      vertices: simplified.length,
      circularity,
      radialStd,
      edgeScore,
    };
  };

  const clamp01 = (value) => Math.max(0, Math.min(1, value));

  const closeness = (value, target, tolerance) => clamp01(1 - Math.abs(value - target) / tolerance);

  const chooseAutoShape = ({ aspect, density, vertices, circularity, radialStd, edgeScore }) => {
    const aspectSquare = closeness(aspect, 1, 0.42);
    const circleScore =
      aspectSquare * 0.32 +
      clamp01((circularity - 0.68) / 0.24) * 0.34 +
      clamp01((0.32 - radialStd) / 0.22) * 0.24 +
      (vertices >= 6 ? 0.1 : 0);
    const squareScore =
      aspectSquare * 0.34 +
      clamp01((0.84 - circularity) / 0.24) * 0.18 +
      clamp01((edgeScore - 0.46) / 0.24) * 0.28 +
      (vertices >= 4 && vertices <= 7 ? 0.2 : 0);
    const triangleScore =
      clamp01((6 - vertices) / 3) * 0.28 +
      clamp01((0.38 - density) / 0.24) * 0.24 +
      clamp01((edgeScore - 0.25) / 0.28) * 0.2 +
      clamp01((0.86 - circularity) / 0.34) * 0.16 +
      (aspect > 0.58 && aspect < 1.72 ? 0.12 : 0);
    const scores = [
      { label: "CÍRCULO", score: circleScore, confidence: 88 },
      { label: "CUADRADO", score: squareScore, confidence: 88 },
      { label: "TRIÁNGULO", score: triangleScore, confidence: 84 },
    ].sort((a, b) => b.score - a.score);
    const [best, next] = scores;

    if (best.label === "CUADRADO" && best.score < 0.78) {
      return null;
    }

    if (best.score < 0.68 || best.score - next.score < 0.08) {
      return null;
    }

    return {
      label: best.label,
      confidence: Math.min(97, best.confidence + Math.round((best.score - 0.68) * 22)),
    };
  };

  const targetLabel = {
    square: "CUADRADO",
    circle: "CÍRCULO",
    triangle: "TRIÁNGULO",
  };

  const classifyShape = (component, roi) => {
    const { bounds, points } = component;
    const aspect = bounds.width / Math.max(bounds.height, 1);
    const boxArea = bounds.width * bounds.height;
    const touchesRoiEdge =
      bounds.x <= roi.x + 4 ||
      bounds.y <= roi.y + 4 ||
      bounds.x + bounds.width >= roi.x + roi.width - 4 ||
      bounds.y + bounds.height >= roi.y + roi.height - 4;

    if (
      touchesRoiEdge ||
      bounds.width < 18 ||
      bounds.height < 18 ||
      boxArea < 900 ||
      boxArea > roi.width * roi.height * 0.38 ||
      aspect < 0.48 ||
      aspect > 2.1
    ) {
      return null;
    }

    const density = points.length / Math.max(boxArea, 1);
    if (density < 0.02 || density > 0.55) {
      return null;
    }

    const features = getShapeFeatures(points, bounds);
    const { radialStd, edgeScore, vertices, circularity } = features;
    let label = "";
    let confidence = 72;

    if (state.shapeTarget !== "auto") {
      label = targetLabel[state.shapeTarget] || "";
      const targetConfidence = {
        square: Math.abs(aspect - 1) < 0.48 && (edgeScore > 0.28 || vertices <= 6),
        circle: Math.abs(aspect - 1) < 0.52 && (radialStd < 0.38 || circularity > 0.52),
        triangle: vertices <= 6 && density < 0.34,
      };

      if (!targetConfidence[state.shapeTarget]) {
        return null;
      }

      confidence = 86;
    } else {
      const autoShape = chooseAutoShape({ aspect, density, vertices, circularity, radialStd, edgeScore });
      if (autoShape) {
        label = autoShape.label;
        confidence = autoShape.confidence;
      }
    }

    if (!label) {
      return null;
    }

    return {
      label,
      confidence: Math.min(98, confidence + Math.round(Math.min(points.length / 180, 6))),
      bounds,
      points,
      roi,
    };
  };

  const detectShape = () => {
    const width = 480;
    const height = Math.max(270, Math.round(width * (els.video.videoHeight / Math.max(els.video.videoWidth, 1))));
    els.workCanvas.width = width;
    els.workCanvas.height = height;

    const ctx = els.workCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(els.video, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const roi = findPaperRegion(data, width, height);
    const edgeMask = new Uint8Array(width * height);
    const margin = 8;
    let roiGrayTotal = 0;
    let roiSamples = 0;

    for (let y = Math.max(2, roi.y + margin); y < Math.min(height - 2, roi.y + roi.height - margin); y += 3) {
      for (let x = Math.max(2, roi.x + margin); x < Math.min(width - 2, roi.x + roi.width - margin); x += 3) {
        roiGrayTotal += getPixelInfo(data, y * width + x).gray;
        roiSamples += 1;
      }
    }

    const roiMean = roiGrayTotal / Math.max(roiSamples, 1);
    const inkThreshold = Math.max(72, Math.min(190, roiMean - 12));

    for (let y = Math.max(2, roi.y + margin); y < Math.min(height - 2, roi.y + roi.height - margin); y += 1) {
      for (let x = Math.max(2, roi.x + margin); x < Math.min(width - 2, roi.x + roi.width - margin); x += 1) {
        const index = y * width + x;
        const current = getPixelInfo(data, index);
        const left = getPixelInfo(data, y * width + x - 1);
        const right = getPixelInfo(data, y * width + x + 1);
        const top = getPixelInfo(data, (y - 1) * width + x);
        const bottom = getPixelInfo(data, (y + 1) * width + x);
        const gradient = Math.abs(right.gray - left.gray) + Math.abs(bottom.gray - top.gray);
        const isLine = (current.gray < inkThreshold && gradient > 4) || (gradient > 24 && current.gray < roiMean + 8);
        if (isLine && current.saturation < 118) {
          edgeMask[index] = 1;
        }
      }
    }

    const components = collectComponents(dilateMask(edgeMask, width, height), width, height, 28);
    let best = null;
    components.forEach((component) => {
      const candidate = classifyShape(component, roi);
      if (!candidate) {
        return;
      }

      const score = candidate.bounds.width * candidate.bounds.height;
      if (!best || score > best.bounds.width * best.bounds.height) {
        best = candidate;
      }
    });

    if (!best) {
      return null;
    }

    const scaleX = els.canvas.width / width;
    const scaleY = els.canvas.height / height;
    return {
      ...best,
      bounds: {
        x: Math.round(best.bounds.x * scaleX),
        y: Math.round(best.bounds.y * scaleY),
        width: Math.round(best.bounds.width * scaleX),
        height: Math.round(best.bounds.height * scaleY),
      },
      roi: {
        x: Math.round(best.roi.x * scaleX),
        y: Math.round(best.roi.y * scaleY),
        width: Math.round(best.roi.width * scaleX),
        height: Math.round(best.roi.height * scaleY),
      },
      points: best.points.map((point) => ({ x: Math.round(point.x * scaleX), y: Math.round(point.y * scaleY) })),
    };
  };

  const drawDetection = (ctx, detection) => {
    const { bounds, label, confidence } = detection;
    const centerX = Math.round(bounds.x + bounds.width / 2);
    const centerY = Math.round(bounds.y + bounds.height / 2);

    if (state.showContours) {
      ctx.save();
      ctx.setLineDash([8, 8]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(126, 211, 33, 0.45)";
      ctx.strokeRect(detection.roi.x, detection.roi.y, detection.roi.width, detection.roi.height);
      ctx.restore();

      ctx.fillStyle = "rgba(81, 210, 12, 0.72)";
      detection.points.forEach((point, index) => {
        if (index % 9 === 0) {
          ctx.fillRect(point.x, point.y, 2, 2);
        }
      });
    }

    ctx.lineWidth = 4;
    ctx.strokeStyle = "#51d20c";
    ctx.fillStyle = "rgba(81, 210, 12, 0.95)";
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.fillRect(bounds.x, Math.max(0, bounds.y - 34), Math.min(210, bounds.width + 58), 30);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px system-ui, sans-serif";
    ctx.fillText(`${label} ${confidence}%`, bounds.x + 10, Math.max(22, bounds.y - 12));

    ctx.beginPath();
    ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#51d20c";
    ctx.fill();

    els.shape.textContent = label;
    els.confidence.textContent = `${confidence}%`;
    els.position.textContent = `${centerX}, ${centerY}`;
    els.tracking.textContent = "SIGUIENDO";
  };

  const processFrame = () => {
    if (!state.running) {
      return;
    }

    if (state.paused) {
      state.rafId = requestAnimationFrame(processFrame);
      return;
    }

    resizeCanvas();
    const ctx = els.canvas.getContext("2d");
    ctx.drawImage(els.video, 0, 0, els.canvas.width, els.canvas.height);

    state.frameIndex += 1;
    if (state.frameIndex % 3 === 0) {
      state.lastDetection = detectShape();
    }

    if (state.lastDetection) {
      drawDetection(ctx, state.lastDetection);
    } else {
      resetReadout();
    }

    const now = performance.now();
    els.fps.textContent = String(Math.round(1000 / Math.max(now - state.lastFrameAt, 1)));
    state.lastFrameAt = now;
    state.rafId = requestAnimationFrame(processFrame);
  };

  const startDemo = async () => {
    try {
      els.start.disabled = true;
      setStatus("Solicitando permiso para usar la cámara...");
      state.webcam ||= new window.WebcamService(els.video);
      await state.webcam.start();
      state.running = true;
      state.paused = false;
      setStatus("Cámara activa. Muestra una hoja blanca con una figura dibujada en negro.", "ok");
      processFrame();
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
    state.lastDetection = null;
    resetReadout();
    els.start.disabled = false;
    els.pause.textContent = "Pausar";
    setStatus("Cámara detenida.");
  };

  els.start?.addEventListener("click", startDemo);
  els.pause?.addEventListener("click", () => {
    state.paused = !state.paused;
    els.pause.textContent = state.paused ? "Reanudar" : "Pausar";
    setStatus(state.paused ? "Procesamiento en pausa." : "Procesamiento activo.", state.paused ? "" : "ok");
  });
  els.stop?.addEventListener("click", stopDemo);
  els.switch?.addEventListener("click", async () => {
    try {
      await state.webcam?.switchCamera();
      setStatus("Cámara cambiada.", "ok");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
  els.contours?.addEventListener("change", () => {
    state.showContours = els.contours.checked;
  });
  els.shapeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.shapeTarget = button.dataset.shapeTarget || "auto";
      state.lastDetection = null;
      els.shapeButtons.forEach((item) => {
        const isActive = item === button;
        item.classList.toggle("is-active", isActive);
        item.setAttribute("aria-pressed", String(isActive));
      });
      setStatus(
        state.shapeTarget === "auto"
          ? "Modo automático activo. Muestra una figura clara dentro de la hoja."
          : `Modo ${button.textContent.trim()} activo. Muestra esa figura dentro de la hoja.`,
        "ok"
      );
    });
  });

  window.addEventListener("pagehide", stopDemo);
  window.addEventListener("beforeunload", stopDemo);
})();
