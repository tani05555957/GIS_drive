/**
 * 左サイドパネルの UI 状態管理(商圏作成方法・条件パネル開閉・リセット等)。
 * 地図描画そのものは AppMap (map.js) に、新聞/指標/予算通数/保存等の分析ロジックは
 * DeliveryPlan (js/deliveryPlan.js) に委譲する。
 */
const Panel = (() => {
  let els = {};
  let currentShape = null;
  let cityUIBuilt = false;
  let prevSummary = null; // { deliverable, statHouseholds } — 直前の商圏サマリー(増減表示用)
  let rankWindowManuallyClosed = false; // ランキングウィンドウをユーザーが閉じた場合、再表示を抑制する

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function init() {
    els = {
      summaryDeliverable: document.getElementById("summary-deliverable"),
      summaryDeliverableDelta: document.getElementById("summary-deliverable-delta"),
      summaryStatHouseholds: document.getElementById("summary-stat-households"),
      summaryStatHouseholdsDelta: document.getElementById("summary-stat-households-delta"),
      statsCsvStatus: document.getElementById("stats-csv-status"),

      searchInput: document.getElementById("search-input"),
      searchBtn: document.getElementById("search-btn"),
      searchResults: document.getElementById("search-results"),

      shapeSelect: document.getElementById("shape-select"),
      optCity: document.getElementById("opt-city"),
      optCircle: document.getElementById("opt-circle"),
      optTrain: document.getElementById("opt-train"),
      optTime: document.getElementById("opt-time"),
      optPolygon: document.getElementById("opt-polygon"),
      optMultiStore: document.getElementById("opt-multistore"),
      trainStatus: document.getElementById("train-status"),

      cityPrefSelect: document.getElementById("city-pref-select"),
      cityChecklist: document.getElementById("city-checklist"),

      circleOriginStore: document.getElementById("circle-origin-store"),
      circleRadius: document.getElementById("circle-radius"),
      circleRadiusVal: document.getElementById("circle-radius-val"),

      trainOriginStore: document.getElementById("train-origin-store"),

      timeOriginStore: document.getElementById("time-origin-store"),
      timeMode: document.getElementById("time-mode"),
      timeMinutes: document.getElementById("time-minutes"),
      timeMinutesVal: document.getElementById("time-minutes-val"),
      orsApiKey: document.getElementById("ors-api-key"),

      polygonUndo: document.getElementById("polygon-undo"),

      multiStoreList: document.getElementById("multistore-list"),
      multiStoreRadius: document.getElementById("multistore-radius"),

      conditionBtn: document.getElementById("condition-btn"),
      segmentPanel: document.getElementById("segment-panel"),
      segmentGroups: document.getElementById("segment-groups"),

      resultAreas: document.getElementById("result-areas"),
      resultHouseholds: document.getElementById("result-households"),
      resultPopulation: document.getElementById("result-population"),
      rankLegend: document.getElementById("rank-legend"),
      rankWindow: document.getElementById("rank-window"),
      rankWindowClose: document.getElementById("rank-window-close"),
      fillOpacity: document.getElementById("fill-opacity"),
      fillOpacityVal: document.getElementById("fill-opacity-val"),

      statsFile: document.getElementById("stats-file"),
      statsStatus: document.getElementById("stats-status"),
      boundaryStatus: document.getElementById("boundary-status"),

      reportBtn: document.getElementById("report-btn"),
      resetBtn: document.getElementById("reset-btn"),
    };

    buildSegmentGroups();
    wireShapeButtons();
    wireCircleOptions();
    wireTrainOptions();
    wireTimeOptions();
    wirePolygonOptions();
    wireMultiStoreOptions();
    wireConditionToggle();
    wireOpacitySlider();
    wireRankWindow();
    AppMap.setFillOpacity(Number(els.fillOpacity.value) / 100);
  }

  // ---------------- 透明度スライダー ----------------
  function wireOpacitySlider() {
    els.fillOpacity.addEventListener("input", () => {
      const pct = Number(els.fillOpacity.value);
      els.fillOpacityVal.textContent = `${pct}%`;
      AppMap.setFillOpacity(pct / 100);
    });
  }

  // ---------------- ランキングウィンドウ(地図内フロート表示) ----------------
  function wireRankWindow() {
    els.rankWindowClose.addEventListener("click", () => {
      rankWindowManuallyClosed = true;
      els.rankWindow.classList.add("hidden");
    });
  }

  function showRankWindow() {
    if (rankWindowManuallyClosed) return;
    els.rankWindow.classList.remove("hidden");
  }

  function hideRankWindow() {
    els.rankWindow.classList.add("hidden");
  }

  // ---------------- 商圏作成方法ボタン ----------------
  function wireShapeButtons() {
    els.shapeSelect.querySelectorAll(".shape-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const shape = btn.dataset.shape;
        selectShape(shape === currentShape ? null : shape);
      });
    });
  }

  async function selectShape(shape) {
    currentShape = shape;

    els.shapeSelect.querySelectorAll(".shape-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.shape === shape);
    });
    [els.optCity, els.optCircle, els.optTrain, els.optTime, els.optPolygon, els.optMultiStore].forEach((el) =>
      el.classList.add("hidden")
    );

    resetConditionPanel();

    if (shape === "city") {
      els.optCity.classList.remove("hidden");
      await populateCityUI();
    } else if (shape === "circle") {
      els.optCircle.classList.remove("hidden");
      populateStoreDropdown(els.circleOriginStore);
    } else if (shape === "train") {
      els.optTrain.classList.remove("hidden");
      els.trainStatus.textContent = "";
      populateStoreDropdown(els.trainOriginStore);
    } else if (shape === "time") {
      els.optTime.classList.remove("hidden");
      populateStoreDropdown(els.timeOriginStore);
    } else if (shape === "polygon") {
      els.optPolygon.classList.remove("hidden");
    } else if (shape === "multiStore") {
      els.optMultiStore.classList.remove("hidden");
      populateMultiStoreList();
    }

    AppMap.setMode(shape);
    setConditionEnabled(false);
    emitResultReset();
  }

  /** 選択方法ボタンを外部(プラン複製の読み込みなど)から切り替えるためのAPI */
  async function selectShapeExternally(shape) {
    await selectShape(shape);
  }

  function getCurrentShape() {
    return currentShape;
  }

  // ---------------- 起点店舗セレクト(円・電車・所要時間で共通) ----------------
  function populateStoreDropdown(selectEl) {
    const stores = StoreManager.getStores();
    const prev = selectEl.value;
    selectEl.innerHTML =
      `<option value="">(地図をクリックして指定)</option>` +
      stores.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
    if (stores.some((s) => s.id === prev)) selectEl.value = prev;
  }

  function wireOriginStoreSelect(selectEl) {
    selectEl.addEventListener("change", () => {
      if (!selectEl.value) return;
      const store = StoreManager.getStoreById(selectEl.value);
      if (store) AppMap.setOriginPoint(L.latLng(store.lat, store.lon));
    });
  }

  // ---------------- 市区町村 ----------------
  async function populateCityUI() {
    if (!cityUIBuilt) {
      await BoundaryLoader.loadIndex();
      const entries = BoundaryLoader.getMunicipalityIndex();
      const prefMap = new Map();
      entries.forEach((e) => {
        if (!prefMap.has(e.pref)) prefMap.set(e.pref, e.prefName);
      });
      const prefList = Array.from(prefMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      els.cityPrefSelect.innerHTML = prefList.map(([code, name]) => `<option value="${code}">${name}</option>`).join("");
      els.cityPrefSelect.addEventListener("change", renderCityChecklist);
      cityUIBuilt = true;
    }
    renderCityChecklist();
  }

  function renderCityChecklist() {
    const entries = BoundaryLoader.getMunicipalityIndex();
    const pref = els.cityPrefSelect.value;
    const cities = entries.filter((e) => e.pref === pref).sort((a, b) => a.code.localeCompare(b.code));
    els.cityChecklist.innerHTML = cities
      .map((c) => `<label><input type="checkbox" class="city-check" value="${c.code}"> ${escapeHtml(c.name)}</label>`)
      .join("");
    els.cityChecklist.querySelectorAll(".city-check").forEach((cb) => cb.addEventListener("change", onCityCheckChange));
  }

  function onCityCheckChange() {
    const codes = Array.from(els.cityChecklist.querySelectorAll(".city-check:checked")).map((cb) => cb.value);
    AppMap.setCitySelection(codes);
  }

  function getCheckedCityCodes() {
    return Array.from(els.cityChecklist.querySelectorAll(".city-check:checked")).map((cb) => cb.value);
  }

  // ---------------- 円 ----------------
  function wireCircleOptions() {
    els.circleRadius.addEventListener("input", () => {
      const v = Number(els.circleRadius.value);
      els.circleRadiusVal.textContent = v;
      AppMap.setCircleRadius(v);
    });
    wireOriginStoreSelect(els.circleOriginStore);
  }

  // ---------------- 電車(新規) ----------------
  function wireTrainOptions() {
    wireOriginStoreSelect(els.trainOriginStore);
    AppMap.on("trainLoading", () => {
      els.trainStatus.textContent = "最寄り駅を検索中…";
    });
    AppMap.on("trainShapeReady", (props) => {
      if (props?.fallback) {
        els.trainStatus.textContent = "最寄り駅が見つからなかったため、近似円で表示しています。";
      } else if (props?.stationName) {
        els.trainStatus.textContent = `最寄り駅: ${props.stationName}(起点から約${props.distanceM}m)`;
      } else {
        els.trainStatus.textContent = "";
      }
    });
  }

  // ---------------- 所要時間 ----------------
  function wireTimeOptions() {
    let travelMode = "walk";

    function rebuildTimeShape() {
      AppMap.buildTimeShape(els.orsApiKey.value.trim(), travelMode, Number(els.timeMinutes.value));
    }

    els.timeMode.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        travelMode = btn.dataset.mode;
        els.timeMode.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
        rebuildTimeShape();
      });
    });
    els.timeMinutes.addEventListener("input", () => {
      els.timeMinutesVal.textContent = els.timeMinutes.value;
      rebuildTimeShape();
    });
    els.orsApiKey.addEventListener("change", rebuildTimeShape);

    AppMap.on("timeOriginSet", rebuildTimeShape);
    wireOriginStoreSelect(els.timeOriginStore);
  }

  // ---------------- 任意商圏(自由描画) ----------------
  function wirePolygonOptions() {
    els.polygonUndo.addEventListener("click", () => AppMap.undoPolygonPoint());
  }

  // ---------------- 多店舗分析 ----------------
  function wireMultiStoreOptions() {
    els.multiStoreRadius.addEventListener("change", () => {
      if (currentShape === "multiStore") onMultiStoreCheckChange();
    });
  }

  function populateMultiStoreList() {
    const stores = StoreManager.getStores();
    els.multiStoreList.innerHTML =
      stores
        .map((s) => `<label><input type="checkbox" class="multi-store-check" value="${s.id}"> ${escapeHtml(s.name)}</label>`)
        .join("") || "<div class='hint small'>店舗が登録されていません(先に店舗管理から登録してください)</div>";
    els.multiStoreList.querySelectorAll(".multi-store-check").forEach((cb) => cb.addEventListener("change", onMultiStoreCheckChange));
  }

  function onMultiStoreCheckChange() {
    const ids = Array.from(els.multiStoreList.querySelectorAll(".multi-store-check:checked")).map((cb) => cb.value);
    AppMap.setMultiStoreSelection(ids);
  }

  function getCheckedMultiStoreIds() {
    return Array.from(els.multiStoreList.querySelectorAll(".multi-store-check:checked")).map((cb) => cb.value);
  }

  function getMultiStoreRadius() {
    return Number(els.multiStoreRadius.value) || 500;
  }

  // ---------------- 検索 ----------------
  function wireSearch(onPick) {
    async function doSearch() {
      const q = els.searchInput.value;
      if (!q.trim()) return;
      els.searchResults.innerHTML = "";
      els.searchResults.classList.add("hidden");
      try {
        const results = await AppMap.geocodeSearch(q);
        if (results.length === 0) {
          els.searchResults.innerHTML = `<li>該当する場所が見つかりませんでした</li>`;
          els.searchResults.classList.remove("hidden");
          return;
        }
        results.forEach((r) => {
          const li = document.createElement("li");
          li.textContent = r.label;
          li.addEventListener("click", () => {
            AppMap.flyTo(r.lat, r.lon);
            els.searchResults.classList.add("hidden");
            if (onPick) onPick(r);
          });
          els.searchResults.appendChild(li);
        });
        els.searchResults.classList.remove("hidden");
      } catch (err) {
        els.searchResults.innerHTML = `<li>検索エラー: ${err.message}</li>`;
        els.searchResults.classList.remove("hidden");
      }
    }
    els.searchBtn.addEventListener("click", doSearch);
    els.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSearch();
    });
  }

  // ---------------- 条件を選択 ----------------
  function wireConditionToggle() {
    els.conditionBtn.addEventListener("click", () => {
      els.segmentPanel.classList.toggle("hidden");
    });
  }

  function setConditionEnabled(enabled) {
    els.conditionBtn.disabled = !enabled;
  }

  function resetConditionPanel() {
    els.segmentPanel.classList.add("hidden");
    els.segmentGroups.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = false));
  }

  function buildSegmentGroups() {
    els.segmentGroups.innerHTML = "";
    StatsData.getCategories().forEach((cat) => {
      const group = document.createElement("div");
      group.className = "segment-group";

      const header = document.createElement("div");
      header.className = "segment-group-header";
      header.innerHTML = `<span>${cat.label}</span><i class="fa-solid fa-chevron-down"></i>`;

      const body = document.createElement("div");
      body.className = "segment-group-body collapsed";

      cat.options.forEach((opt) => {
        const label = document.createElement("label");
        label.className = "segment-option";
        label.innerHTML = `<input type="checkbox" data-category="${cat.key}" data-option="${opt.key}"> ${opt.label}`;
        body.appendChild(label);
      });

      header.addEventListener("click", () => body.classList.toggle("collapsed"));
      group.appendChild(header);
      group.appendChild(body);
      els.segmentGroups.appendChild(group);
    });
  }

  function getSelections() {
    const selections = {};
    els.segmentGroups.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
      const cat = cb.dataset.category;
      (selections[cat] = selections[cat] || []).push(cb.dataset.option);
    });
    return selections;
  }

  function onSelectionsChanged(fn) {
    els.segmentGroups.addEventListener("change", (e) => {
      if (e.target.matches('input[type="checkbox"]')) {
        rankWindowManuallyClosed = false;
        fn(getSelections());
      }
    });
  }

  // ---------------- 集計結果表示 ----------------
  function updateResult({ areas, households, population }) {
    els.resultAreas.textContent = areas.toLocaleString();
    els.resultHouseholds.textContent = Math.round(households).toLocaleString();
    els.resultPopulation.textContent = Math.round(population).toLocaleString();
  }

  function emitResultReset() {
    updateResult({ areas: 0, households: 0, population: 0 });
    updateZoneSummary([]);
    rankWindowManuallyClosed = false;
    clearRankLegend();
  }

  function clearRankLegend() {
    els.rankLegend.classList.add("hidden");
    els.rankLegend.innerHTML = "";
    hideRankWindow();
  }

  function formatLegendValue(v, format) {
    if (format === "percent") return `${(v * 100).toFixed(1)}%`;
    if (format === "decimal") return v.toFixed(2);
    return Math.round(v).toLocaleString();
  }

  /** 1軸(単一比率)・3軸以上(標準化合計スコア)のランク別色分け凡例を表示する */
  function updateRankLegend(breaks, colors, unitLabel, format = "count") {
    if (!breaks || breaks.length === 0) {
      clearRankLegend();
      return;
    }
    const rows = [];
    const bounds = [-Infinity, ...breaks, Infinity];
    for (let i = colors.length - 1; i >= 0; i--) {
      const lo = bounds[i] === -Infinity ? "" : `${formatLegendValue(bounds[i], format)} 〜 `;
      const hi = bounds[i + 1] === Infinity ? "" : formatLegendValue(bounds[i + 1], format);
      rows.push(
        `<div class="rank-legend-row"><span class="rank-swatch" style="background:${colors[i]}"></span><span>${lo}${hi} ${unitLabel}</span></div>`
      );
    }
    els.rankLegend.innerHTML = `<div style="font-weight:700;margin-bottom:4px;">ランク別色分け</div>${rows.join("")}`;
    els.rankLegend.classList.remove("hidden");
    showRankWindow();
  }

  /** 2軸(バイバリエート/クロス表示)のランク別色分け凡例を3×3の円グラフ風グリッドで表示する */
  function updateBivariateLegend(catALabel, catBLabel, colors, cellPercent) {
    const rows = [];
    for (let a = 2; a >= 0; a--) {
      const cells = [];
      for (let b = 0; b < 3; b++) {
        const pct = cellPercent ? cellPercent[a][b] : 0;
        const size = Math.round(Math.max(24, Math.min(50, 22 + pct * 0.85)));
        cells.push(
          `<div class="bivar-cell"><span class="bivar-circle" style="width:${size}px;height:${size}px;background:${colors[a][b]}">${pct.toFixed(0)}%</span></div>`
        );
      }
      rows.push(`<div class="bivar-row">${cells.join("")}</div>`);
    }
    els.rankLegend.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;">2軸ランキング(クロス表示)</div>
      <div class="bivar-legend">
        <div class="bivar-rowlabel">${escapeHtml(catALabel)}<i class="fa-solid fa-arrow-up"></i></div>
        <div class="bivar-main">
          <div class="bivar-grid">${rows.join("")}</div>
          <div class="bivar-collabel">${escapeHtml(catBLabel)}<i class="fa-solid fa-arrow-right"></i></div>
        </div>
      </div>
      <p class="hint small" style="margin-top:8px;">円の大きさ・数値は、表示中の商圏における統計上世帯数ベースの構成比(%)です。</p>
    `;
    els.rankLegend.classList.remove("hidden");
    showRankWindow();
  }

  // ---------------- 商圏サマリー(サイドバー上部・配達可能箇所数/統計上世帯数) ----------------
  function formatDelta(delta) {
    if (!delta) return "";
    const cls = delta > 0 ? "up" : "down";
    const sign = delta > 0 ? "+" : "";
    return `<span class="zone-summary-delta ${cls}">${sign}${Math.round(delta).toLocaleString()}</span>`;
  }

  /** 現在表示中の商圏ポリゴン(features)から配達可能箇所数・統計上世帯数の合計を集計し、増減付きで表示する */
  function updateZoneSummary(features) {
    let deliverable = 0;
    let statHouseholds = 0;
    (features || []).forEach((f) => {
      const record = StatsData.getRecord(f.properties?.KEY_CODE);
      if (!record) return;
      deliverable += record.deliverable;
      statHouseholds += record.statHouseholds;
    });

    els.summaryDeliverable.textContent = Math.round(deliverable).toLocaleString();
    els.summaryStatHouseholds.textContent = Math.round(statHouseholds).toLocaleString();

    if (prevSummary) {
      els.summaryDeliverableDelta.innerHTML = formatDelta(deliverable - prevSummary.deliverable);
      els.summaryStatHouseholdsDelta.innerHTML = formatDelta(statHouseholds - prevSummary.statHouseholds);
    } else {
      els.summaryDeliverableDelta.innerHTML = "";
      els.summaryStatHouseholdsDelta.innerHTML = "";
    }
    prevSummary = { deliverable, statHouseholds };
  }

  function setStatsCsvStatus(text) {
    if (els.statsCsvStatus) els.statsCsvStatus.textContent = text;
  }

  // ---------------- 属性データ状態表示 ----------------
  function wireStatsFile(onLoad) {
    els.statsFile.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const json = JSON.parse(reader.result);
          const count = DataStore.loadSegmentTable(json);
          els.statsStatus.textContent = `読み込み完了: ${file.name}(${count}件)`;
          if (onLoad) onLoad();
        } catch (err) {
          els.statsStatus.textContent = `読み込みエラー: ${err.message}`;
        }
      };
      reader.readAsText(file, "utf-8");
    });
  }

  function setBoundaryStatus(text) {
    els.boundaryStatus.textContent = text;
  }

  // ---------------- リセット ----------------
  function wireReset(onReset) {
    els.resetBtn.addEventListener("click", () => {
      selectShape(null);
      els.searchInput.value = "";
      els.searchResults.classList.add("hidden");
      els.orsApiKey.value = "";
      els.circleRadius.value = 500;
      els.circleRadiusVal.textContent = 500;
      els.timeMinutes.value = 10;
      els.timeMinutesVal.textContent = 10;
      els.circleOriginStore.value = "";
      els.trainOriginStore.value = "";
      els.timeOriginStore.value = "";
      if (typeof DeliveryPlan !== "undefined") DeliveryPlan.reset();
      if (onReset) onReset();
    });
  }

  function wireReportButton(onReport) {
    els.reportBtn.addEventListener("click", onReport);
  }

  return {
    init,
    wireSearch,
    selectShapeExternally,
    getCurrentShape,
    getCheckedCityCodes,
    getCheckedMultiStoreIds,
    getMultiStoreRadius,
    setConditionEnabled,
    getSelections,
    onSelectionsChanged,
    updateResult,
    emitResultReset,
    updateRankLegend,
    updateBivariateLegend,
    clearRankLegend,
    updateZoneSummary,
    setStatsCsvStatus,
    wireStatsFile,
    setBoundaryStatus,
    wireReset,
    wireReportButton,
  };
})();
