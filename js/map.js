/**
 * Leaflet 地図まわり(表示・検索・商圏図形の描画・町丁目境界表示)を担当するモジュール。
 * OpenStreetMap のタイル・Nominatim ジオコーダを使用する。
 */
const AppMap = (() => {
  let map;
  let osmLayer, satLayer;
  let searchMarker = null;

  // --- 商圏図形の状態 ---
  let mode = null; // 'circle' | 'polygon' | 'time' | 'area' | null
  let circleLayer = null;
  let circleCenter = null;
  let circleRadiusM = 500;

  let polygonPoints = [];
  let polygonLine = null;
  let polygonVertexLayer = null;
  let polygonFinal = null;

  let timeOrigin = null;
  let timeLayer = null;
  let timeShapeGeoJson = null; // 所要時間モードの実ジオメトリ(交差判定用)

  let trainOrigin = null;
  let trainLayer = null;
  let trainShapeGeoJson = null; // 電車商圏モードの実ジオメトリ(交差判定用)

  let selectedCityCodes = new Set(); // 「市区町村」モードでの選択(市区町村コード)
  let selectedMultiStoreIds = new Set(); // 「多店舗分析」モードでの選択(店舗ID)

  // --- 町丁目・字境界レイヤー ---
  let boundaryLayerGroup = null;
  let boundaryLayersByKey = new Map(); // KEY_CODE -> Leaflet layer
  let renderedFeatures = [];
  let selectedAreaKeyCodes = new Set(); // 「地域」モードでの選択(現在UIからは非公開、内部的には維持)
  let fillOpacityRatio = 0.65; // 透明度スライダーで調整(ポリゴン塗りつぶしの不透明度)
  let lastColorByKeyCode = new Map();
  let lastApplyOpts = {};

  // --- 店舗管理用の補助レイヤー ---
  let storeMarkersLayer = null;
  let storeCirclesLayer = null;
  let oneShotClickHandler = null;

  // --- 簡易 pub/sub ---
  const listeners = {};
  function on(evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
  }
  function off(evt, fn) {
    if (!listeners[evt]) return;
    listeners[evt] = listeners[evt].filter((f) => f !== fn);
  }
  function emit(evt, payload) {
    (listeners[evt] || []).forEach((fn) => fn(payload));
  }

  function init(elId) {
    map = L.map(elId, { zoomControl: true }).setView([35.681236, 139.767125], 15); // 東京駅

    osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      crossOrigin: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    satLayer = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, crossOrigin: true, attribution: "Tiles &copy; Esri" }
    );

    L.control.layers(
      { "地図": osmLayer, "航空写真": satLayer },
      {},
      { position: "topright", collapsed: true }
    ).addTo(map);

    L.control.scale({ imperial: false }).addTo(map);

    map.doubleClickZoom.disable();
    map.on("click", onMapClick);
    map.on("dblclick", onDoubleClickFinishPolygon);

    boundaryLayerGroup = L.layerGroup().addTo(map);
    storeCirclesLayer = L.layerGroup().addTo(map);
    storeMarkersLayer = L.layerGroup().addTo(map);

    return map;
  }

  function getMap() {
    return map;
  }

  // ---------------- 検索 (Nominatim) ----------------
  async function geocodeSearch(query) {
    if (!query || !query.trim()) return [];
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=0&limit=8&q=" +
      encodeURIComponent(query);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("検索に失敗しました");
    const data = await res.json();
    return data.map((d) => ({
      label: d.display_name,
      lat: parseFloat(d.lat),
      lon: parseFloat(d.lon),
    }));
  }

  function flyTo(lat, lon, zoom = 16) {
    if (searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.marker([lat, lon]).addTo(map);
    map.setView([lat, lon], zoom, { animate: true });
  }

  function getMapBoundsBbox() {
    const b = map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  function onMoveEnd(fn) {
    map.on("moveend", fn);
  }

  // ---------------- モード管理 ----------------
  function setMode(newMode) {
    mode = newMode;
    clearShape();
  }

  function clearShape() {
    if (circleLayer) { map.removeLayer(circleLayer); circleLayer = null; }
    circleCenter = null;

    if (polygonLine) { map.removeLayer(polygonLine); polygonLine = null; }
    if (polygonVertexLayer) { map.removeLayer(polygonVertexLayer); polygonVertexLayer = null; }
    if (polygonFinal) { map.removeLayer(polygonFinal); polygonFinal = null; }
    polygonPoints = [];

    if (timeLayer) { map.removeLayer(timeLayer); timeLayer = null; }
    timeOrigin = null;
    timeShapeGeoJson = null;

    if (trainLayer) { map.removeLayer(trainLayer); trainLayer = null; }
    trainOrigin = null;
    trainShapeGeoJson = null;

    selectedAreaKeyCodes.clear();
    selectedCityCodes.clear();
    selectedMultiStoreIds.clear();

    emit("shapeCleared");
  }

  function clearAreaSelection() {
    selectedAreaKeyCodes.clear();
    emit("areaSelectionChanged", getCurrentShapeInfo());
  }

  /** 「市区町村」モード: 選択された市区町村コードの一覧を設定する(featureの取得・描画は呼び出し側が行う) */
  function setCitySelection(codes) {
    selectedCityCodes = new Set(codes);
    emit("citySelectionChanged", getCurrentShapeInfo());
  }

  /** 「多店舗分析」モード: 選択された店舗IDの一覧を設定する(featureの取得・描画は呼び出し側が行う) */
  function setMultiStoreSelection(ids) {
    selectedMultiStoreIds = new Set(ids);
    emit("multiStoreSelectionChanged", getCurrentShapeInfo());
  }

  function setCircleRadius(meters) {
    circleRadiusM = meters;
    if (circleLayer && circleCenter) {
      circleLayer.setRadius(meters);
      emit("shapeUpdated", getCurrentShapeInfo());
    }
  }

  function undoPolygonPoint() {
    if (polygonPoints.length === 0) return;
    polygonPoints.pop();
    redrawPolygonDraft();
  }

  // ---------------- 地図クリック処理 ----------------
  function placeCircleOrigin(latlng) {
    circleCenter = latlng;
    if (circleLayer) map.removeLayer(circleLayer);
    circleLayer = L.circle(circleCenter, {
      radius: circleRadiusM,
      color: "#1a73e8",
      weight: 2,
      fillOpacity: 0.15,
    }).addTo(map);
    emit("shapeUpdated", getCurrentShapeInfo());
  }

  function placeTimeOrigin(latlng) {
    timeOrigin = latlng;
    emit("timeOriginSet");
  }

  function placeTrainOrigin(latlng) {
    trainOrigin = latlng;
    buildTrainShape();
  }

  function onMapClick(e) {
    if (mode === "circle") {
      placeCircleOrigin(e.latlng);
    } else if (mode === "polygon") {
      if (polygonFinal) return; // 確定済みなら追加不可(リセットしてから)
      if (polygonPoints.length >= 3) {
        const first = polygonPoints[0];
        const distPx = map.latLngToContainerPoint(first).distanceTo(map.latLngToContainerPoint(e.latlng));
        if (distPx < 12) {
          finalizePolygon();
          return;
        }
      }
      polygonPoints.push(e.latlng);
      redrawPolygonDraft();
    } else if (mode === "time") {
      placeTimeOrigin(e.latlng);
    } else if (mode === "train") {
      placeTrainOrigin(e.latlng);
    }
  }

  /**
   * 地図をクリックしたのと同じ効果で起点を設定する(店舗を起点に選んだ場合などに利用)。
   * 現在のモードが circle/time/train でなければ何もしない。
   */
  function setOriginPoint(latlng) {
    if (mode === "circle") placeCircleOrigin(latlng);
    else if (mode === "time") placeTimeOrigin(latlng);
    else if (mode === "train") placeTrainOrigin(latlng);
  }

  function redrawPolygonDraft() {
    if (polygonLine) map.removeLayer(polygonLine);
    if (polygonVertexLayer) map.removeLayer(polygonVertexLayer);

    if (polygonPoints.length > 0) {
      polygonLine = L.polyline(polygonPoints, { color: "#1a73e8", weight: 2, dashArray: "4,4" }).addTo(map);
      polygonVertexLayer = L.layerGroup(
        polygonPoints.map((p) => L.circleMarker(p, { radius: 4, color: "#1a73e8", fillColor: "#fff", fillOpacity: 1 }))
      ).addTo(map);
    }
  }

  function finalizePolygon() {
    if (polygonLine) { map.removeLayer(polygonLine); polygonLine = null; }
    if (polygonVertexLayer) { map.removeLayer(polygonVertexLayer); polygonVertexLayer = null; }
    polygonFinal = L.polygon(polygonPoints, { color: "#1a73e8", weight: 2, fillOpacity: 0.15 }).addTo(map);
    emit("shapeUpdated", getCurrentShapeInfo());
  }

  function onDoubleClickFinishPolygon() {
    if (mode === "polygon" && polygonPoints.length >= 3 && !polygonFinal) {
      finalizePolygon();
    }
  }

  async function buildTimeShape(apiKey = "", travelMode = "walk", minutes = 10) {
    if (!timeOrigin) return;
    if (timeLayer) { map.removeLayer(timeLayer); timeLayer = null; }
    timeShapeGeoJson = await ShapeBuilders.time({
      lat: timeOrigin.lat,
      lon: timeOrigin.lng,
      mode: travelMode,
      minutes,
      apiKey,
    });
    const approx = !!timeShapeGeoJson.properties?.approx;
    timeLayer = L.geoJSON(timeShapeGeoJson, {
      style: { color: "#e37400", weight: 2, dashArray: approx ? "6,4" : null, fillOpacity: 0.15 },
    }).addTo(map);
    emit("shapeUpdated", getCurrentShapeInfo());
  }

  /** 電車商圏モード: Overpassで最寄り駅を検索し、徒歩圏+概算鉄道到達圏を描画する */
  async function buildTrainShape() {
    if (!trainOrigin) return;
    if (trainLayer) { map.removeLayer(trainLayer); trainLayer = null; }
    trainShapeGeoJson = null;
    emit("trainLoading");

    const gj = await ShapeBuilders.train({ lat: trainOrigin.lat, lon: trainOrigin.lng });
    trainShapeGeoJson = gj;
    trainLayer = L.geoJSON(gj, {
      style: { color: "#8e44ad", weight: 2, dashArray: gj.properties?.fallback ? "6,4" : null, fillOpacity: 0.15 },
    }).addTo(map);
    emit("shapeUpdated", getCurrentShapeInfo());
    emit("trainShapeReady", gj.properties);
  }

  // ---------------- 町丁目・字境界レイヤー ----------------
  /** 現在の範囲/選択方法に応じた町丁目・字featureを描画する(KEY_CODEで管理) */
  function renderBoundaryFeatures(features) {
    boundaryLayerGroup.clearLayers();
    boundaryLayersByKey = new Map();
    renderedFeatures = features;

    features.forEach((feature) => {
      const key = feature.properties?.KEY_CODE;
      const layer = L.geoJSON(feature, {
        style: () => ({ color: NO_CONDITION_BORDER, weight: 1.5, fillColor: NO_CONDITION_FILL, fillOpacity: 0.45 }),
      });
      const name = [feature.properties?.CITY_NAME, feature.properties?.S_NAME].filter(Boolean).join(" ");
      if (name) layer.bindTooltip(name, { sticky: true, className: "area-tooltip" });
      layer.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        if (mode === "area" && key) {
          if (selectedAreaKeyCodes.has(key)) selectedAreaKeyCodes.delete(key);
          else selectedAreaKeyCodes.add(key);
          emit("areaSelectionChanged", getCurrentShapeInfo());
        }
      });
      layer.addTo(boundaryLayerGroup);
      if (key) boundaryLayersByKey.set(key, layer);
    });

    refreshBoundaryStyles();
  }

  function getBoundaryFeatures() {
    return renderedFeatures;
  }

  /**
   * ランク(colorByKeyCode)と選択状態に応じて境界ポリゴンを塗り分ける。
   * colorByKeyCode が空(条件未選択)の場合は既定の薄い黄色/濃い黄色で表示する。
   * opts.fallbackFill/fallbackBorder を指定すると、ランキング自体は有効だが該当データが
   * 無いポリゴン(colorByKeyCodeに値が無い)の配色を差し替えられる(既定はグレー)。
   */
  function applyBoundaryColors(colorByKeyCode, opts = {}) {
    lastColorByKeyCode = colorByKeyCode;
    lastApplyOpts = opts;

    const fallbackFill = opts.fallbackFill ?? NO_CONDITION_FILL;
    const fallbackBorder = opts.fallbackBorder ?? NO_CONDITION_BORDER;
    const fallbackWeight = opts.fallbackFill ? 1 : 1.5;

    boundaryLayersByKey.forEach((layer, key) => {
      const fill = colorByKeyCode.get(key);
      layer.setStyle({
        fillColor: fill || fallbackFill,
        fillOpacity: fillOpacityRatio,
        color: selectedAreaKeyCodes.has(key) ? "#1a73e8" : fill ? NO_DATA_BORDER : fallbackBorder,
        weight: selectedAreaKeyCodes.has(key) ? 3 : fill ? 1 : fallbackWeight,
      });
    });
  }

  function refreshBoundaryStyles() {
    applyBoundaryColors(new Map());
  }

  /** 「透明度」スライダーからポリゴン塗りつぶしの不透明度(0〜1)を設定し、即座に再描画する */
  function setFillOpacity(ratio) {
    fillOpacityRatio = Math.min(1, Math.max(0, ratio));
    applyBoundaryColors(lastColorByKeyCode, lastApplyOpts);
  }

  // ---------------- 現在の図形情報取得 ----------------
  function getCurrentShapeInfo() {
    if (mode === "circle" && circleCenter) {
      const gj = turf.circle([circleCenter.lng, circleCenter.lat], circleRadiusM / 1000, { steps: 64, units: "kilometers" });
      return { mode, geojson: gj };
    }
    if (mode === "polygon" && polygonFinal) {
      const gj = polygonFinal.toGeoJSON();
      return { mode, geojson: gj };
    }
    if (mode === "time" && timeShapeGeoJson) {
      return { mode, geojson: timeShapeGeoJson };
    }
    if (mode === "train" && trainShapeGeoJson) {
      return { mode, geojson: trainShapeGeoJson };
    }
    if (mode === "area") {
      return { mode, selectedKeyCodes: Array.from(selectedAreaKeyCodes) };
    }
    if (mode === "city") {
      return { mode, selectedCityCodes: Array.from(selectedCityCodes) };
    }
    if (mode === "multiStore") {
      return { mode, selectedStoreIds: Array.from(selectedMultiStoreIds) };
    }
    return { mode, geojson: null };
  }

  function isShapeReady() {
    const info = getCurrentShapeInfo();
    if (info.mode === "area") return info.selectedKeyCodes.length > 0;
    if (info.mode === "city") return info.selectedCityCodes.length > 0;
    if (info.mode === "multiStore") return info.selectedStoreIds.length > 0;
    return !!info.geojson;
  }

  /** 現在の商圏指定方法に応じた「集計対象のfeature一覧」を返す(main.js/deliveryPlan.js で共通利用) */
  function getActiveFeatures() {
    const info = getCurrentShapeInfo();
    if (info.mode === "area") {
      const selected = new Set(info.selectedKeyCodes || []);
      return renderedFeatures.filter((f) => selected.has(f.properties?.KEY_CODE));
    }
    return renderedFeatures;
  }

  // ---------------- 店舗管理レイヤー(新規) ----------------
  /** 登録店舗のマーカーを描画する。groupsById: Map<groupId, Group> */
  function renderStoreMarkers(stores, groupsById, opts = {}) {
    storeMarkersLayer.clearLayers();
    const showLabels = !!opts.showLabels;
    stores.forEach((s) => {
      const g = groupsById.get(s.groupId);
      const color = g?.color || "#d81f2a";
      const marker = L.circleMarker([s.lat, s.lon], {
        radius: g?.pointSize || 8,
        color: "#fff",
        weight: g?.borderWidth ?? 2,
        fillColor: color,
        fillOpacity: 1,
      });
      marker.bindTooltip(s.name, showLabels ? { permanent: true, direction: "top", className: "store-label" } : { sticky: true });
      marker.addTo(storeMarkersLayer);
    });
  }

  /** 登録店舗を中心とした円商圏をまとめて描画する */
  function renderStoreCircles(stores, groupsById, opts = {}) {
    storeCirclesLayer.clearLayers();
    stores.forEach((s) => {
      const g = groupsById.get(s.groupId);
      const color = g?.color || "#d81f2a";
      const radius = opts.radiusOverride ?? s.radius ?? 500;
      L.circle([s.lat, s.lon], { radius, color, weight: g?.borderWidth ?? 2, fillOpacity: 0.1 }).addTo(storeCirclesLayer);
    });
  }

  function clearStoreLayers() {
    storeMarkersLayer.clearLayers();
    storeCirclesLayer.clearLayers();
  }

  /** 次の1回だけの地図クリックを取得する(店舗の位置指定などに利用、既存の商圏モードとは独立) */
  function enableOneShotPlacement(cb) {
    if (oneShotClickHandler) map.off("click", oneShotClickHandler);
    oneShotClickHandler = (e) => {
      oneShotClickHandler = null;
      cb(e.latlng);
    };
    map.once("click", oneShotClickHandler);
  }

  return {
    init,
    getMap,
    on,
    off,
    geocodeSearch,
    flyTo,
    getMapBoundsBbox,
    onMoveEnd,
    setMode,
    clearShape,
    clearAreaSelection,
    setCitySelection,
    setMultiStoreSelection,
    setCircleRadius,
    setOriginPoint,
    undoPolygonPoint,
    onDoubleClickFinishPolygon,
    buildTimeShape,
    buildTrainShape,
    renderBoundaryFeatures,
    getBoundaryFeatures,
    getActiveFeatures,
    applyBoundaryColors,
    setFillOpacity,
    getCurrentShapeInfo,
    isShapeReady,
    renderStoreMarkers,
    renderStoreCircles,
    clearStoreLayers,
    enableOneShotPlacement,
  };
})();
