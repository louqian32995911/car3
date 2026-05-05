const STORAGE_KEY = "private-car-public-use-records";
const SETTINGS_KEY = "private-car-public-use-settings";
const DEFAULT_CENTER = [120.7555, 30.7461];
const els = {
  map: document.querySelector("#map"),
  amapRoot: document.querySelector("#amapRoot"),
  trackingBadge: document.querySelector("#trackingBadge"),
  locationState: document.querySelector("#locationState"),
  fitRouteBtn: document.querySelector("#fitRouteBtn"),
  currentDistance: document.querySelector("#currentDistance"),
  currentAmount: document.querySelector("#currentAmount"),
  currentDuration: document.querySelector("#currentDuration"),
  trackToggleBtn: document.querySelector("#trackToggleBtn"),
  settingsBtn: document.querySelector("#settingsBtn"),
  historyBtn: document.querySelector("#historyBtn"),
  settingsDialog: document.querySelector("#settingsDialog"),
  historyDialog: document.querySelector("#historyDialog"),
  closeHistoryBtn: document.querySelector("#closeHistoryBtn"),
  replayCurrentBtn: document.querySelector("#replayCurrentBtn"),
  rateInput: document.querySelector("#rateInput"),
  amapKeyInput: document.querySelector("#amapKeyInput"),
  amapSecurityInput: document.querySelector("#amapSecurityInput"),
  saveSettingsBtn: document.querySelector("#saveSettingsBtn"),
  fromDate: document.querySelector("#fromDate"),
  toDate: document.querySelector("#toDate"),
  historyList: document.querySelector("#historyList"),
  recordTemplate: document.querySelector("#recordTemplate"),
};

const state = {
  settings: loadSettings(),
  records: loadRecords(),
  mapStyle: "normal",
  active: null,
  watchId: null,
  locateWatchId: null,
  map: null,
  amap: null,
  currentPolyline: null,
  currentMarker: null,
  selfMarker: null,
  lastPosition: null,
  hasAutoLocated: false,
  ignoredDriftCount: 0,
  replayTimer: null,
  isReplaying: false,
  fallbackTrack: [],
};

boot();

function boot() {
  if (els.rateInput) els.rateInput.value = state.settings.rate;
  bindEvents();
  renderStats();
  renderHistory();
  if (state.settings.amapKey) {
    loadAmap();
  }
}

function bindEvents() {
  els.trackToggleBtn.addEventListener("click", () => {
    if (state.isReplaying) {
      stopReplay();
      return;
    }
    if (state.active) endTracking();
    else startTracking();
  });
  els.settingsBtn?.addEventListener("click", () => {
    if (els.rateInput) els.rateInput.value = state.settings.rate;
    els.settingsDialog?.showModal();
  });
  els.historyBtn?.addEventListener("click", () => {
    renderHistory();
    els.historyDialog?.showModal();
  });
  els.closeHistoryBtn?.addEventListener("click", () => els.historyDialog?.close());
  els.replayCurrentBtn?.addEventListener("click", () => {
    if (state.active?.points.length) replayRoute(state.active.points);
  });
  els.fitRouteBtn.addEventListener("click", locateSelf);
  els.saveSettingsBtn?.addEventListener("click", saveSettings);
  [els.fromDate, els.toDate].forEach((el) => {
    el?.addEventListener("input", renderHistory);
  });
  window.addEventListener("resize", () => {
    state.map?.resize();
  });
}

function loadSettings() {
  const localConfig = window.PRIVATE_CAR_APP_CONFIG || {};
  const fallback = {
    rate: 1.2,
    amapKey: localConfig.amapKey || "",
    amapSecurity: localConfig.amapSecurity || "",
  };
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    return {
      ...fallback,
      rate: Number.isFinite(Number(stored.rate)) ? Number(stored.rate) : fallback.rate,
    };
  } catch {
    return fallback;
  }
}

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function persistRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
}

function saveSettings() {
  state.settings = {
    rate: Math.max(0, Number(els.rateInput?.value) || 0),
    amapKey: state.settings.amapKey,
    amapSecurity: state.settings.amapSecurity,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  renderStats();
  renderHistory();
  if (state.settings.amapKey) loadAmap(true);
  setLocationState("设置已保存");
}

function loadAmap(force = false) {
  if (state.amap && !force) return;
  const existing = document.querySelector("script[data-amap-loader]");
  if (existing) existing.remove();
  if (state.settings.amapSecurity) {
    window._AMapSecurityConfig = { securityJsCode: state.settings.amapSecurity };
  }
  window.onAMapApiError = (error) => {
    const message = error?.message || error?.info || error?.toString?.() || "高德地图认证失败";
    setLocationState(message);
  };
  const script = document.createElement("script");
  script.dataset.amapLoader = "true";
  const params = new URLSearchParams({
    v: "2.0",
    key: state.settings.amapKey,
  });
  script.src = `https://webapi.amap.com/maps?${params.toString()}`;
  script.onload = () => {
    state.amap = window.AMap;
    updateAutoMapStyle();
    state.map = new state.amap.Map("amapRoot", {
      center: DEFAULT_CENTER,
      zoom: 12,
      resizeEnable: true,
      viewMode: "2D",
      mapStyle: currentMapStyleUrl(),
      features: ["bg", "road", "building", "point"],
    });
    state.map.on("complete", () => {
      state.map.resize();
      state.map.setZoomAndCenter(12, DEFAULT_CENTER);
      setLocationState("高德地图已显示");
    });
    setLocationState("高德地图已就绪");
    window.setTimeout(() => {
      if (!state.map) return;
      const tileCount = els.amapRoot.querySelectorAll("img, canvas").length;
      if (!tileCount) {
        setLocationState("地图瓦片未显示，请检查高德 JSAPI 安全白名单和网络");
      }
    }, 3500);
    if (state.lastPosition) {
      updateSelfPosition(state.lastPosition, true);
    } else {
      autoLocateSelf();
    }
  };
  script.onerror = () => {
    setLocationState("高德地图加载失败，继续使用本地预览");
  };
  document.head.appendChild(script);
}

function applyMapStyle() {
  if (!state.map || !state.amap) return;
  state.map.setMapStyle(currentMapStyleUrl());
  window.setTimeout(() => {
    state.map?.resize();
    state.map?.setStatus({ animateEnable: true });
  }, 80);
}

function updateAutoMapStyle(point = state.lastPosition) {
  const reference = point || { lng: DEFAULT_CENTER[0], lat: DEFAULT_CENTER[1] };
  const nextStyle = isNightAt(reference.lat, reference.lng, new Date()) ? "light" : "normal";
  if (state.mapStyle !== nextStyle) {
    state.mapStyle = nextStyle;
    applyMapStyle();
  }
}

function currentMapStyleUrl() {
  const style = state.mapStyle || "normal";
  return `amap://styles/${style}`;
}

function isNightAt(lat, lng, date) {
  const times = getSunTimes(date, lat, lng);
  return date < times.sunrise || date >= times.sunset;
}

function getSunTimes(date, lat, lng) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const zenith = 90.833;
  return {
    sunrise: calculateSunTime(day, lat, lng, zenith, true),
    sunset: calculateSunTime(day, lat, lng, zenith, false),
  };
}

function calculateSunTime(date, lat, lng, zenith, isSunrise) {
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
  const lngHour = lng / 15;
  const t = dayOfYear + ((isSunrise ? 6 : 18) - lngHour) / 24;
  const meanAnomaly = 0.9856 * t - 3.289;
  let trueLongitude =
    meanAnomaly +
    1.916 * Math.sin(degreesToRadians(meanAnomaly)) +
    0.02 * Math.sin(degreesToRadians(2 * meanAnomaly)) +
    282.634;
  trueLongitude = normalizeDegrees(trueLongitude);

  let rightAscension = radiansToDegrees(
    Math.atan(0.91764 * Math.tan(degreesToRadians(trueLongitude))),
  );
  rightAscension = normalizeDegrees(rightAscension);
  const lQuadrant = Math.floor(trueLongitude / 90) * 90;
  const raQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension = (rightAscension + lQuadrant - raQuadrant) / 15;

  const sinDec = 0.39782 * Math.sin(degreesToRadians(trueLongitude));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosHour =
    (Math.cos(degreesToRadians(zenith)) - sinDec * Math.sin(degreesToRadians(lat))) /
    (cosDec * Math.cos(degreesToRadians(lat)));

  if (cosHour > 1 || cosHour < -1) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), isSunrise ? 6 : 18);
  }

  const hourAngle = isSunrise
    ? 360 - radiansToDegrees(Math.acos(cosHour))
    : radiansToDegrees(Math.acos(cosHour));
  const localMeanTime = hourAngle / 15 + rightAscension - 0.06571 * t - 6.622;
  const utcHour = normalizeHours(localMeanTime - lngHour);
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCMinutes(Math.round(utcHour * 60));
  return result;
}

function startTracking() {
  if (!navigator.geolocation) {
    setLocationState("当前浏览器不支持定位");
    return;
  }
  stopReplay({ keepRoute: false, silent: true });

  state.active = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    endedAt: "",
    points: [],
    distanceKm: 0,
    rate: Math.max(0, Number(els.rateInput?.value) || state.settings.rate || 0),
  };
  state.fallbackTrack = [];
  state.ignoredDriftCount = 0;
  clearMapRoute();
  setTracking(true);
  setLocationState("定位中");

  state.watchId = navigator.geolocation.watchPosition(
    handlePosition,
    (error) => setLocationState(locationErrorText(error)),
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 30000,
    },
  );
}

async function handlePosition(position) {
  if (!state.active) return;
  const point = await positionToPoint(position);
  if (!state.active) return;
  const previous = state.active.points.at(-1);
  if (previous && isDriftPoint(previous, point)) {
    state.ignoredDriftCount += 1;
    setLocationState(
      `已忽略漂移点 ${state.ignoredDriftCount} 个，当前精度约 ${point.accuracy || "-"} 米`,
    );
    return;
  }
  updateSelfPosition(point);
  if (previous) {
    const segment = distanceBetween(previous, point);
    if (segment < 0.005) {
      setLocationState(`定位中，精度约 ${point.accuracy || "-"} 米`);
      return;
    }
    state.active.distanceKm += segment;
  }
  state.active.points.push(point);
  state.fallbackTrack = state.active.points;
  drawRoute(state.active.points, { fit: state.active.points.length <= 2 });
  setLocationState(`${state.active.points.length}点 · ${point.accuracy || "-"}米`);
}

function isDriftPoint(previous, point) {
  const segmentKm = distanceBetween(previous, point);
  const seconds = Math.max(1, (new Date(point.timestamp) - new Date(previous.timestamp)) / 1000);
  const speedKmh = segmentKm / (seconds / 3600);
  const accuracy = Number(point.accuracy) || 999;

  if (accuracy > 100 && segmentKm > 0.05) return true;
  if (segmentKm > 1) return true;
  if (segmentKm > 0.2 && speedKmh > 120) return true;
  if (speedKmh > 180) return true;
  return false;
}

function locateSelf() {
  if (!navigator.geolocation) {
    setLocationState("当前浏览器不支持定位");
    return;
  }
  if (state.lastPosition) {
    updateSelfPosition(state.lastPosition, true);
    setLocationState("已回到当前位置");
  }
  if (state.locateWatchId !== null) {
    navigator.geolocation.clearWatch(state.locateWatchId);
    state.locateWatchId = null;
  }
  els.fitRouteBtn.classList.add("is-locating");
  if (!state.lastPosition) setLocationState("正在高精度定位");
  state.locateWatchId = navigator.geolocation.watchPosition(
    async (position) => {
      const point = await positionToPoint(position);
      updateSelfPosition(point, true);
      setLocationState(`已定位，精度约 ${point.accuracy || "-"} 米`);
      if (!point.accuracy || point.accuracy <= 10) {
        finishLocateWatch();
      }
    },
    (error) => {
      setLocationState(locationErrorText(error));
      finishLocateWatch();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 30000,
    },
  );
}

function autoLocateSelf() {
  if (state.hasAutoLocated) return;
  state.hasAutoLocated = true;
  locateSelf();
}

function finishLocateWatch() {
  if (state.locateWatchId !== null) {
    navigator.geolocation.clearWatch(state.locateWatchId);
    state.locateWatchId = null;
  }
  els.fitRouteBtn.classList.remove("is-locating");
}

async function positionToPoint(position) {
  const rawPoint = {
    lng: Number(position.coords.longitude.toFixed(6)),
    lat: Number(position.coords.latitude.toFixed(6)),
    rawLng: Number(position.coords.longitude.toFixed(6)),
    rawLat: Number(position.coords.latitude.toFixed(6)),
    accuracy: Math.round(position.coords.accuracy || 0),
    timestamp: new Date(position.timestamp).toISOString(),
  };
  const converted = await convertGpsToAmap(rawPoint);
  return converted || rawPoint;
}

function convertGpsToAmap(point) {
  if (!state.amap?.convertFrom) return Promise.resolve(null);
  return new Promise((resolve) => {
    state.amap.convertFrom([point.lng, point.lat], "gps", (status, result) => {
      if (status !== "complete" || !result?.locations?.length) {
        resolve(null);
        return;
      }
      const location = result.locations[0];
      resolve({
        ...point,
        lng: Number(location.lng.toFixed(6)),
        lat: Number(location.lat.toFixed(6)),
      });
    });
  });
}

function updateSelfPosition(point, shouldCenter = false) {
  state.lastPosition = point;
  updateAutoMapStyle(point);
  if (!state.map || !state.amap) {
    return;
  }
  const position = [point.lng, point.lat];
  if (!state.selfMarker) {
    state.selfMarker = new state.amap.Marker({
      position,
      anchor: "center",
      content: '<div class="self-location-dot" aria-label="当前位置"></div>',
      zIndex: 120,
    });
    state.map.add(state.selfMarker);
  } else {
    state.selfMarker.setPosition(position);
  }
  if (shouldCenter) {
    state.map.setZoomAndCenter(16, position);
  }
}

function endTracking() {
  if (!state.active) return;
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  state.active.endedAt = new Date().toISOString();
  state.active.distanceKm = calculateDistance(state.active.points);
  const record = {
    ...state.active,
    amount: amountFor(state.active.distanceKm, state.active.rate),
    screenshot: buildSnapshot(state.active.points),
    note: "",
  };
  state.records.unshift(record);
  persistRecords();
  state.fallbackTrack = record.points;
  drawRoute(record.points);
  state.active = null;
  setTracking(false);
  renderStats();
  renderHistory();
  setLocationState("本次轨迹已保存");
}

function setTracking(isTracking) {
  stopReplay({ keepRoute: true, silent: true });
  els.trackToggleBtn.classList.toggle("danger-button", isTracking);
  els.trackToggleBtn.classList.toggle("primary-button", !isTracking);
  els.trackToggleBtn.classList.remove("replay-button");
  els.trackingBadge.textContent = isTracking ? "结束" : "开始";
  els.trackingBadge.classList.toggle("is-live", isTracking);
  if (!isTracking) setLocationState("");
}

function renderStats() {
  if (!els.currentDistance || !els.currentAmount || !els.currentDuration) return;
  const target = state.active || { distanceKm: 0, rate: state.settings.rate, startedAt: "", endedAt: "" };
  const distance = state.active ? calculateDistance(target.points) : 0;
  const rate = state.active ? target.rate : state.settings.rate;
  els.currentDistance.textContent = `${distance.toFixed(2)} km`;
  els.currentAmount.textContent = formatMoney(amountFor(distance, rate));
  els.currentDuration.textContent = state.active
    ? formatDuration(new Date() - new Date(state.active.startedAt))
    : "00:00:00";
}

function renderHistory() {
  const records = filteredRecords();
  els.historyList.innerHTML = "";
  if (!records.length) {
    els.historyList.innerHTML = '<div class="empty-history">暂无符合条件的轨迹记录</div>';
    return;
  }
  records.forEach((record) => {
    const node = els.recordTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".record-shot").src = record.screenshot || buildSnapshot(record.points);
    node.querySelector(".record-date").textContent = formatDateTime(record.startedAt);
    node.querySelector(".record-amount").textContent = formatMoney(record.amount);
    node.querySelector(".record-meta").textContent = [
      `${record.distanceKm.toFixed(2)} 公里`,
      `${formatDuration(new Date(record.endedAt) - new Date(record.startedAt))}`,
      `${record.points.length} 个点`,
      `单价 ${record.rate.toFixed(2)} 元/公里`,
    ].join(" · ");
    const note = node.querySelector(".record-note");
    note.value = record.note || "";
    note.addEventListener("input", () => {
      const target = state.records.find((item) => item.id === record.id);
      if (target) {
        target.note = note.value;
        persistRecords();
      }
    });
    node.querySelector(".replay-btn").addEventListener("click", () => {
      els.historyDialog?.close();
      replayRoute(record.points);
    });
    node.querySelector(".delete-btn").addEventListener("click", () => deleteRecord(record.id));
    els.historyList.appendChild(node);
  });
}

function filteredRecords() {
  const from = els.fromDate?.value ? new Date(`${els.fromDate.value}T00:00:00`) : null;
  const to = els.toDate?.value ? new Date(`${els.toDate.value}T23:59:59`) : null;
  return state.records.filter((record) => {
    const start = new Date(record.startedAt);
    if (from && start < from) return false;
    if (to && start > to) return false;
    return true;
  });
}

function deleteRecord(id) {
  state.records = state.records.filter((record) => record.id !== id);
  persistRecords();
  renderHistory();
}

function drawRoute(points, options = {}) {
  const shouldFit = options.fit ?? true;
  if (!state.map || !state.amap || !points.length) return;
  const path = points.map((point) => [point.lng, point.lat]);
  if (!state.currentPolyline) {
    state.currentPolyline = new state.amap.Polyline({
      path,
      strokeColor: "#0f8a65",
      strokeWeight: 7,
      strokeOpacity: 0.9,
      lineJoin: "round",
      lineCap: "round",
    });
    state.map.add(state.currentPolyline);
  } else {
    state.currentPolyline.setPath(path);
  }
  const last = path.at(-1);
  if (!state.currentMarker) {
    state.currentMarker = new state.amap.Marker({ position: last, anchor: "center" });
    state.map.add(state.currentMarker);
  } else {
    state.currentMarker.setPosition(last);
  }
  if (shouldFit) {
    fitTrack(points);
  }
}

function clearMapRoute() {
  window.clearInterval(state.replayTimer);
  state.replayTimer = null;
  if (state.map && state.currentPolyline) state.map.remove(state.currentPolyline);
  if (state.map && state.currentMarker) state.map.remove(state.currentMarker);
  state.currentPolyline = null;
  state.currentMarker = null;
}

function fitTrack(points) {
  if (state.map && state.amap && points.length > 1) {
    state.map.setFitView([state.currentPolyline].filter(Boolean), false, [40, 40, 40, 40], 17);
  }
}

function replayRoute(points) {
  if (!points?.length) return;
  window.scrollTo({ top: 0, behavior: "smooth" });
  clearMapRoute();
  state.isReplaying = true;
  setReplayButton(true, "准备回放");
  if (points.length === 1) {
    updateSelfPosition(points[0], true);
    setLocationState("该记录只有 1 个轨迹点");
    stopReplay({ keepRoute: true, silent: true });
    return;
  }
  if (state.map && state.amap) {
    const previewLine = new state.amap.Polyline({
      path: points.map((point) => [point.lng, point.lat]),
      strokeOpacity: 0,
    });
    state.map.add(previewLine);
    state.map.setFitView([previewLine], false, [48, 48, 48, 48], 17);
    window.setTimeout(() => state.map?.remove(previewLine), 0);
  }
  let index = 1;
  drawRoute(points.slice(0, index), { fit: false });
  setLocationState(`回放中 1/${points.length}`);
  state.replayTimer = window.setInterval(() => {
    index += 1;
    drawRoute(points.slice(0, index), { fit: false });
    setLocationState(`回放中 ${index}/${points.length}`);
    if (index >= points.length) {
      stopReplay({ keepRoute: true, message: "轨迹回放完成" });
    }
  }, Math.max(180, Math.min(850, 8000 / points.length)));
}

function stopReplay(options = {}) {
  const { keepRoute = true, silent = false, message = "" } = options;
  if (state.replayTimer) {
    window.clearInterval(state.replayTimer);
    state.replayTimer = null;
  }
  if (!keepRoute) clearMapRoute();
  if (!state.isReplaying && !els.trackToggleBtn.classList.contains("replay-button")) return;
  state.isReplaying = false;
  setReplayButton(false);
  if (!silent) setLocationState(message || "");
}

function setReplayButton(isReplaying, info = "") {
  els.trackToggleBtn.classList.toggle("replay-button", isReplaying);
  els.trackToggleBtn.classList.toggle("primary-button", !isReplaying && !state.active);
  els.trackToggleBtn.classList.toggle("danger-button", Boolean(state.active));
  els.trackingBadge.textContent = isReplaying ? "回放中" : state.active ? "结束" : "开始";
  els.trackingBadge.classList.toggle("is-live", Boolean(state.active));
  if (isReplaying) setLocationState(info);
}

function drawFallback(points) {
  return;
  const canvas = els.fallbackMap;
  const rect = els.map.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * ratio));
  canvas.height = Math.max(280, Math.floor(rect.height * ratio));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  paintTrack(ctx, rect.width, rect.height, points, state.lastPosition);
}

function buildSnapshot(points) {
  const canvas = document.createElement("canvas");
  canvas.width = 520;
  canvas.height = 320;
  paintTrack(canvas.getContext("2d"), 520, 320, points);
  return canvas.toDataURL("image/png");
}

function paintTrack(ctx, width, height, points, selfPoint = null) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#dce9e3";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(255,255,255,0.62)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 42) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + height * 0.38, height);
    ctx.stroke();
  }
  for (let y = 28; y < height; y += 44) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y - width * 0.2);
    ctx.stroke();
  }
  const pointsToProject = selfPoint ? [...points, selfPoint] : points;
  if (!pointsToProject.length) return;
  const projectedAll = project(pointsToProject, width, height);
  const projected = projectedAll.slice(0, points.length);
  if (projected.length) {
    ctx.lineWidth = 7;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f8a65";
    ctx.beginPath();
    projected.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    drawDot(ctx, projected[0], "#1f6feb", "起");
    drawDot(ctx, projected.at(-1), "#b83d3d", "终");
  }
  if (selfPoint) {
    drawDot(ctx, projectedAll.at(-1), "#1677ff", "");
  }
}

function drawDot(ctx, point, color, label) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "700 12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, point.x, point.y);
}

function project(points, width, height) {
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const pad = 38;
  const lngRange = maxLng - minLng || 0.001;
  const latRange = maxLat - minLat || 0.001;
  return points.map((point) => ({
    x: pad + ((point.lng - minLng) / lngRange) * (width - pad * 2),
    y: height - pad - ((point.lat - minLat) / latRange) * (height - pad * 2),
  }));
}

function calculateDistance(points) {
  return points.reduce((total, point, index) => {
    if (index === 0) return 0;
    return total + distanceBetween(points[index - 1], point);
  }, 0);
}

function distanceBetween(a, b) {
  const earthRadiusKm = 6371.0088;
  const dLat = degreesToRadians(b.lat - a.lat);
  const dLng = degreesToRadians(b.lng - a.lng);
  const lat1 = degreesToRadians(a.lat);
  const lat2 = degreesToRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function radiansToDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function normalizeDegrees(degrees) {
  return ((degrees % 360) + 360) % 360;
}

function normalizeHours(hours) {
  return ((hours % 24) + 24) % 24;
}

function amountFor(distanceKm, rate) {
  return Number((distanceKm * rate).toFixed(2));
}

function formatMoney(value) {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function setLocationState(text) {
  els.locationState.textContent = text;
}

function locationErrorText(error) {
  const map = {
    1: "定位权限被拒绝",
    2: "暂时无法获取位置",
    3: "定位超时",
  };
  return map[error.code] || "定位失败";
}

function exportRecords(type) {
  const records = filteredRecords();
  if (!records.length) {
    setLocationState("没有可导出的记录");
    return;
  }
  if (type === "json") {
    downloadFile("私车公用轨迹记录.json", JSON.stringify(records, null, 2), "application/json");
    return;
  }
  const rows = [
    ["开始时间", "结束时间", "公里数", "补贴单价", "补贴金额", "轨迹点数", "备注"],
    ...records.map((record) => [
      formatDateTime(record.startedAt),
      formatDateTime(record.endedAt),
      record.distanceKm.toFixed(2),
      record.rate.toFixed(2),
      record.amount.toFixed(2),
      String(record.points.length),
      record.note || "",
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  downloadFile("私车公用轨迹记录.csv", `\ufeff${csv}`, "text/csv;charset=utf-8");
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
