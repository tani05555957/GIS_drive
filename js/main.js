/**
 * アプリ全体の結線: 地図・パネル・境界データ・属性データ・レポート機能を接続する。
 */
document.addEventListener("DOMContentLoaded", () => {
  AppMap.init("map");
  Panel.init();
  StoreManager.init();
  CustomerManager.init();
  DeliveryPlan.init();

  // 初期表示: サンプル属性データ(千代田区の実KEY_CODEベース、配達プランの指標ツリー用)を読み込み
  DataStore.loadSegmentTable(SAMPLE_SEGMENT_TABLE);

  // 「条件を選択」のランキングに使う実統計データ(統計データ/*.csv)を読み込む
  Panel.setStatsCsvStatus("統計データを読み込み中…");
  StatsData.loadFromUrl(STAT_CSV_PATH)
    .then(() => {
      Panel.setStatsCsvStatus("");
      recompute();
    })
    .catch((err) => {
      Panel.setStatsCsvStatus(`統計データの読み込みに失敗しました: ${err.message}`);
    });

  Panel.wireSearch();

  Panel.onSelectionsChanged(() => recompute());
  Panel.wireReportButton(() => DeliveryPlan.exportReportBundle());
  Panel.wireReset();

  let boundaryRequestId = 0;

  /**
   * 複数の図形(円・所要時間・電車の各ポイント、多店舗分析の各店舗)それぞれについて交差する
   * 町丁目・字featureを取得し、KEY_CODEで重複排除しつつ統合する(同一条件で複数商圏を作成する場合に使用)。
   */
  async function unionFeaturesForShapes(shapes) {
    const seen = new Map();
    let anyTooBroad = false;
    for (const shape of shapes) {
      const result = await BoundaryLoader.getFeaturesIntersectingShape(shape);
      if (result.tooBroad) {
        anyTooBroad = true;
        continue;
      }
      result.features.forEach((f) => seen.set(f.properties.KEY_CODE, f));
    }
    return { features: Array.from(seen.values()), anyTooBroad };
  }

  /** 現在の商圏作成方法の範囲に応じて、必要な町丁目・字境界だけを読み込んで描画する */
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
    } else if (info.mode === "city") {
      if (info.selectedCityCodes.length === 0) {
        AppMap.renderBoundaryFeatures([]);
        Panel.setBoundaryStatus("");
      } else {
        Panel.setBoundaryStatus("町丁目境界を読み込み中…");
        const features = await BoundaryLoader.getFeaturesForMunicipalities(info.selectedCityCodes);
        if (requestId !== boundaryRequestId) return;
        AppMap.renderBoundaryFeatures(features);
        Panel.setBoundaryStatus(`${features.length.toLocaleString()} 町丁目・字を表示中(市区町村 ${info.selectedCityCodes.length}件)`);
      }
    } else if (info.mode === "multiStore") {
      if (info.selectedStoreIds.length === 0) {
        AppMap.renderBoundaryFeatures([]);
        Panel.setBoundaryStatus("");
      } else {
        Panel.setBoundaryStatus("町丁目境界を読み込み中…");
        const storeList = info.selectedStoreIds.map((id) => StoreManager.getStoreById(id)).filter(Boolean);
        const shapeType = Panel.getMultiStoreShapeType();
        let shapes;
        if (shapeType === "time") {
          const opts = Panel.getMultiStoreTimeOptions();
          shapes = await Promise.all(
            storeList.map((s) => ShapeBuilders.time({ lat: s.lat, lon: s.lon, mode: opts.mode, minutes: opts.minutes, apiKey: opts.apiKey }))
          );
        } else if (shapeType === "train") {
          shapes = await Promise.all(storeList.map((s) => ShapeBuilders.train({ lat: s.lat, lon: s.lon })));
        } else {
          const radius = Panel.getMultiStoreRadius();
          shapes = storeList.map((store) => ShapeBuilders.circle(store.lat, store.lon, radius));
        }
        if (requestId !== boundaryRequestId) return;
        const { features, anyTooBroad } = await unionFeaturesForShapes(shapes);
        if (requestId !== boundaryRequestId) return;
        AppMap.renderBoundaryFeatures(features);
        Panel.setBoundaryStatus(
          anyTooBroad
            ? `一部の店舗は範囲が広すぎるため除外されました。${features.length.toLocaleString()} 町丁目・字を表示中`
            : `${features.length.toLocaleString()} 町丁目・字を表示中(店舗 ${info.selectedStoreIds.length}件)`
        );
      }
    } else if (["circle", "time", "train"].includes(info.mode) && info.geojsonList) {
      if (info.geojsonList.length === 0) {
        AppMap.renderBoundaryFeatures([]);
        Panel.setBoundaryStatus("");
      } else {
        Panel.setBoundaryStatus("町丁目境界を読み込み中…");
        const { features, anyTooBroad } = await unionFeaturesForShapes(info.geojsonList);
        if (requestId !== boundaryRequestId) return;
        AppMap.renderBoundaryFeatures(features);
        Panel.setBoundaryStatus(
          anyTooBroad
            ? `一部のポイントは範囲が広すぎるため除外されました。${features.length.toLocaleString()} 町丁目・字を表示中`
            : `${features.length.toLocaleString()} 町丁目・字を表示中(ポイント ${info.geojsonList.length}件)`
        );
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
    const features = AppMap.getActiveFeatures();
    const selections = Panel.getSelections();

    let totalHouseholds = 0;
    let totalPopulation = 0;
    features.forEach((f) => {
      const record = StatsData.getRecord(f.properties?.KEY_CODE);
      if (!record) return;
      totalHouseholds += record.statHouseholds;
      totalPopulation += record.population;
    });
    Panel.updateResult({ areas: features.length, households: totalHouseholds, population: totalPopulation });
    Panel.updateZoneSummary(features);

    const rank = RankEngine.compute(features, selections, StatsData.getCategories());
    if (rank.mode === "none") {
      AppMap.applyBoundaryColors(rank.colorByKeyCode);
      Panel.clearRankLegend();
    } else if (rank.mode === "bivariate") {
      AppMap.applyBoundaryColors(rank.colorByKeyCode, { fallbackFill: NO_DATA_FILL, fallbackBorder: NO_DATA_BORDER });
      Panel.updateBivariateLegend(rank.legend.catALabel, rank.legend.catBLabel, rank.legend.colors, rank.legend.cellPercent);
    } else {
      AppMap.applyBoundaryColors(rank.colorByKeyCode, { fallbackFill: NO_DATA_FILL, fallbackBorder: NO_DATA_BORDER });
      Panel.updateRankLegend(rank.legend.breaks, rank.legend.colors, rank.legend.unitLabel, rank.legend.format);
    }

    // 予算通数の指定(数値変更で自動反映)。有効な場合はヘッダーの商圏サマリーもこちらの選択結果に連動する
    DeliveryPlan.refreshBudgetSelection();
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
  AppMap.on("citySelectionChanged", () => {
    Panel.setConditionEnabled(AppMap.isShapeReady());
    debouncedRefresh();
  });
  AppMap.on("multiStoreSelectionChanged", () => {
    Panel.setConditionEnabled(AppMap.isShapeReady());
    debouncedRefresh();
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
