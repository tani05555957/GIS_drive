/**
 * アプリ全体の結線: 地図・パネル・境界データ・属性データ・レポート機能を接続する。
 */
document.addEventListener("DOMContentLoaded", () => {
  AppMap.init("map");
  Panel.init();
  StoreManager.init();
  DeliveryPlan.init();

  // 初期表示: サンプル属性データ(千代田区の実KEY_CODEベース)を読み込み
  DataStore.loadSegmentTable(SAMPLE_SEGMENT_TABLE);

  Panel.wireSearch();

  Panel.wireStatsFile(() => recompute());
  Panel.onSelectionsChanged(() => recompute());
  Panel.wireReportButton(() => Report.captureAndDownload());
  Panel.wireReset();

  document.getElementById("header-home-btn").addEventListener("click", () => {
    AppMap.flyTo(35.681236, 139.767125, 15);
  });

  let boundaryRequestId = 0;

  /** 現在の商圏図形/地域モードの範囲に応じて、必要な町丁目・字境界だけを読み込んで描画する */
  async function refreshBoundaries() {
    const info = AppMap.getCurrentShapeInfo();
    const requestId = ++boundaryRequestId;

    if (info.mode === "area") {
      Panel.setBoundaryStatus("町丁目境界を読み込み中…");
      const bbox = AppMap.getMapBoundsBbox();
      const result = await BoundaryLoader.getFeaturesInBbox(bbox);
      if (requestId !== boundaryRequestId) return; // 新しいリクエストに追い越された

      if (result.tooBroad) {
        AppMap.renderBoundaryFeatures([]);
        Panel.setBoundaryStatus(`表示範囲が広すぎます(該当市区町村 ${result.candidateCount})。地図を拡大してください。`);
      } else {
        AppMap.renderBoundaryFeatures(result.features);
        Panel.setBoundaryStatus(`${result.features.length.toLocaleString()} 町丁目・字を表示中`);
      }
    } else if (info.mode && info.geojson) {
      Panel.setBoundaryStatus("町丁目境界を読み込み中…");
      const result = await BoundaryLoader.getFeaturesIntersectingShape(info.geojson);
      if (requestId !== boundaryRequestId) return;

      if (result.tooBroad) {
        AppMap.renderBoundaryFeatures([]);
        Panel.setBoundaryStatus(`選択範囲が広すぎます(該当市区町村 ${result.candidateCount})。範囲を狭めてください。`);
      } else {
        AppMap.renderBoundaryFeatures(result.features);
        Panel.setBoundaryStatus(`${result.features.length.toLocaleString()} 町丁目・字が範囲内にあります`);
      }
    } else {
      AppMap.renderBoundaryFeatures([]);
      Panel.setBoundaryStatus("");
    }

    recompute();
  }

  function recompute() {
    const info = AppMap.getCurrentShapeInfo();
    const rendered = AppMap.getBoundaryFeatures();

    let features;
    if (info.mode === "area") {
      const selected = new Set(info.selectedKeyCodes || []);
      features = rendered.filter((f) => selected.has(f.properties?.KEY_CODE));
    } else {
      features = rendered; // 既に選択範囲と交差する町丁目のみが描画されている
    }

    const selections = Panel.getSelections();
    let totalHouseholds = 0;
    let totalPopulation = 0;
    const valueByKeyCode = new Map();

    features.forEach((f) => {
      const key = f.properties?.KEY_CODE;
      const h = DataStore.estimateHouseholds(f, selections);
      const p = DataStore.estimatePopulation(f, selections);
      totalHouseholds += h;
      totalPopulation += p;
      if (key) valueByKeyCode.set(key, h);
    });

    Panel.updateResult({ areas: features.length, households: totalHouseholds, population: totalPopulation });

    const { breaks, rankOf } = DataStore.classifyByQuantile(valueByKeyCode, RANK_COLORS.length);
    const colorByKeyCode = new Map();
    valueByKeyCode.forEach((v, key) => {
      const rank = rankOf(v);
      if (rank >= 0) colorByKeyCode.set(key, RANK_COLORS[rank]);
    });
    AppMap.applyBoundaryColors(colorByKeyCode);
    Panel.updateRankLegend(breaks, RANK_COLORS, "世帯");
  }

  function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  const debouncedRefresh = debounce(refreshBoundaries, 350);

  AppMap.on("shapeUpdated", () => {
    Panel.setConditionEnabled(AppMap.isShapeReady());
    debouncedRefresh();
  });
  AppMap.on("areaSelectionChanged", () => {
    Panel.setConditionEnabled(AppMap.isShapeReady());
    recompute();
  });
  AppMap.on("shapeCleared", () => {
    Panel.setConditionEnabled(false);
    refreshBoundaries();
  });
  AppMap.onMoveEnd(
    debounce(() => {
      if (AppMap.getCurrentShapeInfo().mode === "area") refreshBoundaries();
    }, 400)
  );
});
