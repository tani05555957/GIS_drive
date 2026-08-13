/**
 * Leaflet 地図まわり(表示・検索・商圏図形の描画・町丁目境界表示)を担当するモジュール。
 * OpenStreetMap のタイル・Nominatim ジオコーダを使用する。
 */
const AppMap = (() => {
  let map;
  let osmLayer, satLayer;
  let searchMarker = null;

  // --- 商圏図形の状態 ---
  let mode = null; // 'circle' | 'polygon' | 'time' | 'train' | 'area' | 'city' | 'multiStore' | null

  // --- 起点ポイント(円・所要時間・電車で共通、商圏作成方法の指定前からマップクリックで設定可能) ---
  let originPoints = []; // L.LatLng[]
  let originMarkersLayer = null;

  let circleLayersGroup = null;
  let circleGeojsons = []; // originPoints と対応する turf.circle の配列
  let circleRadiusM = 500;

  let polygonPoints = [];
  let polygonLine = null;
  let polygonVertexLayer = null;
  let polygonFinal = null;

  let timeLayersGroup = null;
  let timeGeojsons = []; // 所要時間モードの実ジオメトリ配列(交差判定用)
  let lastTimeParams = { apiKey: "", mode: "walk", minutes: 10 };

  let trainLayersGroup = null;
  let trainGeojsons = []; // 電車商圏モードの実ジオメトリ配列(交差判定用)

  let selectedCityCodes = new Set(); // 「市区町村」モードでの選択(市区町村コード)
  let selectedMultiStoreIds = new Set(); // 「多店舗分析」モードでの選択(店舗ID)

  // --- 町丁目・字境界レイヤー ---
  let boundaryLayerGroup = null;
  let boundaryLayersByKey = new Map(); // KEY_CODE -> Leaflet layer
  let renderedFeatures = [];
  let selectedAreaKeyCodes = new Set(); // 「地域」モードでの選択(現在UIからは非公開、内部的には維持)
  let fillOpacityRatio = 0.5; // 透明度スライダーで調整(ポリゴン塗りつぶしの不透明度、既定50%)
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

    originMarkersLayer = L.layerGroup().addTo(map);
    circleLayersGroup = L.layerGroup().addTo(map);
    timeLayersGroup = L.layerGroup().addTo(map);
    trainLayersGroup = L.layerGroup().addTo(map);

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
  /**
   * 商圏作成方法を切り替える。円/時間/電車のジオメトリ・任意商圏・地域/市区町村/多店舗の選択状態はクリアするが、
   * 起点ポイント(originPoints)はモードをまたいで保持する(同じポイントを別の作成方法でも使い回せるようにするため)。
   */
  function setMode(newMode) {
    mode = newMode;
    clearShape();
    if ((mode === "circle" || mode === "time" || mode === "train") && originPoints.length > 0) {
      rebuildActiveOriginShape();
    } else {
      emit("shapeCleared");
    }
  }

  function clearShape() {
    circleLayersGroup.clearLayers();
    circleGeojsons = [];

    if (polygonLine) { map.removeLayer(polygonLine); polygonLine = null; }
    if (polygonVertexLayer) { map.removeLayer(polygonVertexLayer); polygonVertexLayer = null; }
    if (polygonFinal) { map.removeLayer(polygonFinal); polygonFinal = null; }
    polygonPoints = [];

    timeLayersGroup.clearLayers();
    timeGeojsons = [];

    trainLayersGroup.clearLayers();
    trainGeojsons = [];

    selectedAreaKeyCodes.clear();
    selectedCityCodes.clear();
    selectedMultiStoreIds.clear();
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

  function getCitySelection() {
    return new Set(selectedCityCodes);
  }

  /** 「多店舗分析」モード: 選択された店舗IDの一覧を設定する(featureの取得・描画は呼び出し側が行う) */
  function setMultiStoreSelection(ids) {
    selectedMultiStoreIds = new Set(ids);
    emit("multiStoreSelectionChanged", getCurrentShapeInfo());
  }

  function setCircleRadius(meters) {
    circleRadiusM = meters;
    if (mode === "circle") rebuildCircles();
  }

  function undoPolygonPoint() {
    if (polygonPoints.length === 0) return;
    polygonPoints.pop();
    redrawPolygonDraft();
  }

  // ---------------- 起点ポイント(円・所要時間・電車で共通) ----------------
  function redrawOriginMarkers() {
    originMarkersLayer.clearLayers();
    const showNumbers = originPoints.length > 1;
    originPoints.forEach((p, i) => {
      const marker = L.circleMarker(p, { radius: 6, weight: 2, color: "#1a73e8", fillColor: "#fff", fillOpacity: 1 });
      if (showNumbers) marker.bindTooltip(String(i + 1), { permanent: true, direction: "top", className: "area-tooltip" });
      marker.addTo(originMarkersLayer);
    });
  }

  function rebuildActiveOriginShape() {
    if (mode === "circle") rebuildCircles();
    else if (mode === "time") buildTimeShape(lastTimeParams.apiKey, lastTimeParams.mode, lastTimeParams.minutes);
    else if (mode === "train") buildTrainShape();
  }

  function clearOriginShapes() {
    circleLayersGroup.clearLayers();
    circleGeojsons = [];
    timeLayersGroup.clearLayers();
    timeGeojsons = [];
    trainLayersGroup.clearLayers();
    trainGeojsons = [];
  }

  /** 起点ポイントを置き換える(通常クリック・店舗選択で使用) */
  function setOriginPoints(latlngs) {
    originPoints = latlngs.slice();
    redrawOriginMarkers();
    if (originPoints.length === 0) clearOriginShapes();
    else rebuildActiveOriginShape();
    emit("originPointsChanged", getOriginPoints());
  }

  /** 起点ポイントを追加する(Shift+クリックで使用) */
  function addOriginPoint(latlng) {
    originPoints.push(latlng);
    redrawOriginMarkers();
    rebuildActiveOriginShape();
    emit("originPointsChanged", getOriginPoints());
  }

  function clearOriginPoints() {
    originPoints = [];
    redrawOriginMarkers();
    clearOriginShapes();
    emit("originPointsChanged", getOriginPoints());
  }

  function getOriginPoints() {
    return originPoints.map((p) => ({ lat: p.lat, lng: p.lng }));
  }

  /**
   * 地図をクリックしたのと同じ効果で起点を設定する(店舗を起点に選んだ場合などに利用)。
   * 通常クリックと同様、既存の起点ポイントをすべて置き換える。
   */
  function setOriginPoint(latlng) {
    setOriginPoints([latlng]);
  }

  // ---------------- 地図クリック処理 ----------------
  function onMapClick(e) {
    // 店舗位置指定など、単発クリック待ち(enableOneShotPlacement)が有効な間は商圏系のクリック処理を行わない
    if (oneShotClickHandler) return;
    if (mode === "polygon") {
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
    } else if (mode === "city") {
      emit("cityPointClick", { latlng: e.latlng, shiftKey: !!e.originalEvent?.shiftKey });
    } else if (mode === "circle" || mode === "time" || mode === "train" || mode === null) {
      // 商圏作成方法を選ぶ前でもポイントを配置できるようにする(mode === null を含む)
      if (e.originalEvent?.shiftKey) addOriginPoint(e.latlng);
      else setOriginPoints([e.latlng]);
    }
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

  /** 起点ポイント全点に対して円を再構築する */
  function rebuildCircles() {
    circleLayersGroup.clearLayers();
    circleGeojsons = originPoints.map((p) => turf.circle([p.lng, p.lat], circleRadiusM / 1000, { steps: 64, units: "kilometers" }));
    circleGeojsons.forEach((gj) => {
      L.geoJSON(gj, { style: { color: "#1a73e8", weight: 2, fillOpacity: 0.15 } }).addTo(circleLayersGroup);
    });
    emit("shapeUpdated", getCurrentShapeInfo());
  }

  /** 起点ポイント全点に対して所要時間圏を再構築する(同一条件で複数商圏を同時作成) */
  async function buildTimeShape(apiKey = "", travelMode = "walk", minutes = 10) {
    lastTimeParams = { apiKey, mode: travelMode, minutes };
    if (originPoints.length === 0) {
      timeLayersGroup.clearLayers();
      timeGeojsons = [];
      return;
    }
    const results = await Promise.all(
      originPoints.map((p) => ShapeBuilders.time({ lat: p.lat, lon: p.lng, mode: travelMode, minutes, apiKey }))
    );
    timeGeojsons = results;
    timeLayersGroup.clearLayers();
    results.forEach((gj) => {
      const approx = !!gj.properties?.approx;
      L.geoJSON(gj, {
        style: { color: "#e37400", weight: 2, dashArray: approx ? "6,4" : null, fillOpacity: 0.15 },
      }).addTo(timeLayersGroup);
    });
    emit("shapeUpdated", getCurrentShapeInfo());
  }

  /** 電車商圏モード: 起点ポイント全点についてOverpassで最寄り駅を検索し、徒歩圏+概算鉄道到達圏を描画する */
  async function buildTrainShape() {
    if (originPoints.length === 0) {
      trainLayersGroup.clearLayers();
      trainGeojsons = [];
      return;
    }
    emit("trainLoading");

    const results = await Promise.all(originPoints.map((p) => ShapeBuilders.train({ lat: p.lat, lon: p.lng })));
    trainGeojsons = results;
    trainLayersGroup.clearLayers();
    results.forEach((gj) => {
      L.geoJSON(gj, {
        style: { color: "#8e44ad", weight: 2, dashArray: gj.properties?.fallback ? "6,4" : null, fillOpacity: 0.15 },
      }).addTo(trainLayersGroup);
    });
    emit("shapeUpdated", getCurrentShapeInfo());
    emit("trainShapeReady", results[results.length - 1]?.properties);
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
        // area/city モード以外(circle/time/train等)では、ポリゴン上のクリックも起点ポイント配置に
        // 使えるよう、ここではイベントを止めずに地図クリックへ伝播させる。
        if (mode === "area" && key) {
          L.DomEvent.stopPropagation(e);
          if (selectedAreaKeyCodes.has(key)) selectedAreaKeyCodes.delete(key);
          else selectedAreaKeyCodes.add(key);
          emit("areaSelectionChanged", getCurrentShapeInfo());
        } else if (mode === "city") {
          L.DomEvent.stopPropagation(e);
          const cityCode = (feature.properties?.PREF || "") + (feature.properties?.CITY || "");
          if (cityCode) emit("cityBoundaryClick", { cityCode, shiftKey: !!e.originalEvent?.shiftKey });
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
   * opts.hiddenKeyCodes(Set)を指定すると、該当ポリゴンは境界線を残したまま塗りつぶしだけ
   * 完全透明にする(予算通数の指定で「選外」になった町丁目の表示用)。
   */
  function applyBoundaryColors(colorByKeyCode, opts = {}) {
    lastColorByKeyCode = colorByKeyCode;
    lastApplyOpts = opts;

    const fallbackFill = opts.fallbackFill ?? NO_CONDITION_FILL;
    const fallbackBorder = opts.fallbackBorder ?? NO_CONDITION_BORDER;
    const fallbackWeight = opts.fallbackFill ? 1 : 1.5;
    const hiddenKeyCodes = opts.hiddenKeyCodes;

    boundaryLayersByKey.forEach((layer, key) => {
      const fill = colorByKeyCode.get(key);
      layer.setStyle({
        fillColor: fill || fallbackFill,
        fillOpacity: hiddenKeyCodes && hiddenKeyCodes.has(key) ? 0 : fillOpacityRatio,
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
    if (mode === "circle") {
      return { mode, geojsonList: circleGeojsons.slice() };
    }
    if (mode === "polygon" && polygonFinal) {
      const gj = polygonFinal.toGeoJSON();
      return { mode, geojson: gj };
    }
    if (mode === "time") {
      return { mode, geojsonList: timeGeojsons.slice() };
    }
    if (mode === "train") {
      return { mode, geojsonList: trainGeojsons.slice() };
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
    if (info.mode === "circle" || info.mode === "time" || info.mode === "train") return (info.geojsonList || []).length > 0;
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

  /**
   * 逆引き分析(ReverseLookup)の結果を、現在の商圏として直接反映する。
   * 通常の図形(円/所要時間/電車)交差判定を経由せず、算出済みのfeature一覧をそのまま表示・集計対象にする。
   * ユーザーが半径・起点等を変更すれば、通常のshapeUpdatedフローで自動的に上書きされる。
   */
  function applyReverseLookupResult(features) {
    renderBoundaryFeatures(features);
    emit("reverseLookupApplied", features.length);
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
    getCitySelection,
    setMultiStoreSelection,
    setCircleRadius,
    setOriginPoint,
    setOriginPoints,
    addOriginPoint,
    clearOriginPoints,
    getOriginPoints,
    undoPolygonPoint,
    onDoubleClickFinishPolygon,
    buildTimeShape,
    buildTrainShape,
    renderBoundaryFeatures,
    getBoundaryFeatures,
    getActiveFeatures,
    applyBoundaryColors,
    applyReverseLookupResult,
    setFillOpacity,
    getCurrentShapeInfo,
    isShapeReady,
    renderStoreMarkers,
    renderStoreCircles,
    clearStoreLayers,
    enableOneShotPlacement,
  };
})();
