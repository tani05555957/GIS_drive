/**
 * 左サイドパネルの UI 状態管理(形状選択・条件パネル開閉・リセット等)。
 * 地図描画そのものは AppMap (map.js) に委譲する。
 */
const Panel = (() => {
  let els = {};
  let currentShape = null;

  function init() {
    els = {
      searchInput: document.getElementById("search-input"),
      searchBtn: document.getElementById("search-btn"),
      searchResults: document.getElementById("search-results"),

      shapeSelect: document.getElementById("shape-select"),
      optCircle: document.getElementById("opt-circle"),
      optPolygon: document.getElementById("opt-polygon"),
      optTime: document.getElementById("opt-time"),
      optTrain: document.getElementById("opt-train"),
      optArea: document.getElementById("opt-area"),
      trainStatus: document.getElementById("train-status"),

      circleRadius: document.getElementById("circle-radius"),
      circleRadiusVal: document.getElementById("circle-radius-val"),
      polygonUndo: document.getElementById("polygon-undo"),

      timeMode: document.getElementById("time-mode"),
      timeMinutes: document.getElementById("time-minutes"),
      timeMinutesVal: document.getElementById("time-minutes-val"),
      orsApiKey: document.getElementById("ors-api-key"),

      areaClear: document.getElementById("area-clear"),

      conditionBtn: document.getElementById("condition-btn"),
      segmentPanel: document.getElementById("segment-panel"),
      segmentGroups: document.getElementById("segment-groups"),

      resultAreas: document.getElementById("result-areas"),
      resultHouseholds: document.getElementById("result-households"),
      resultPopulation: document.getElementById("result-population"),
      rankLegend: document.getElementById("rank-legend"),

      statsFile: document.getElementById("stats-file"),
      statsStatus: document.getElementById("stats-status"),
      boundaryStatus: document.getElementById("boundary-status"),

      reportBtn: document.getElementById("report-btn"),
      resetBtn: document.getElementById("reset-btn"),
    };

    buildSegmentGroups();
    wireShapeButtons();
    wireCircleOptions();
    wirePolygonOptions();
    wireTimeOptions();
    wireTrainOptions();
    wireAreaOptions();
    wireConditionToggle();
  }

  // ---------------- 形状選択ボタン ----------------
  function wireShapeButtons() {
    els.shapeSelect.querySelectorAll(".shape-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const shape = btn.dataset.shape;
        selectShape(shape === currentShape ? null : shape);
      });
    });
  }

  function selectShape(shape) {
    currentShape = shape;

    els.shapeSelect.querySelectorAll(".shape-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.shape === shape);
    });
    [els.optCircle, els.optPolygon, els.optTime, els.optTrain, els.optArea].forEach((el) => el.classList.add("hidden"));

    resetConditionPanel();

    if (shape === "circle") {
      els.optCircle.classList.remove("hidden");
    } else if (shape === "polygon") {
      els.optPolygon.classList.remove("hidden");
    } else if (shape === "time") {
      els.optTime.classList.remove("hidden");
    } else if (shape === "train") {
      els.optTrain.classList.remove("hidden");
      els.trainStatus.textContent = "";
    } else if (shape === "area") {
      els.optArea.classList.remove("hidden");
    }

    AppMap.setMode(shape);
    setConditionEnabled(false);
    emitResultReset();
  }

  // ---------------- 円形 ----------------
  function wireCircleOptions() {
    els.circleRadius.addEventListener("input", () => {
      const v = Number(els.circleRadius.value);
      els.circleRadiusVal.textContent = v;
      AppMap.setCircleRadius(v);
    });
  }

  // ---------------- 多角形 ----------------
  function wirePolygonOptions() {
    els.polygonUndo.addEventListener("click", () => AppMap.undoPolygonPoint());
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
  }

  // ---------------- 電車商圏(新規) ----------------
  function wireTrainOptions() {
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

  // ---------------- 地域 ----------------
  function wireAreaOptions() {
    els.areaClear.addEventListener("click", () => AppMap.clearAreaSelection());
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
    SEGMENT_CONFIG.forEach((cat) => {
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
      if (e.target.matches('input[type="checkbox"]')) fn(getSelections());
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
    els.rankLegend.classList.add("hidden");
    els.rankLegend.innerHTML = "";
  }

  function updateRankLegend(breaks, colors, unitLabel) {
    if (!breaks || breaks.length === 0) {
      els.rankLegend.classList.add("hidden");
      els.rankLegend.innerHTML = "";
      return;
    }
    const rows = [];
    const bounds = [0, ...breaks, Infinity];
    for (let i = colors.length - 1; i >= 0; i--) {
      const lo = Math.round(bounds[i]);
      const hi = bounds[i + 1] === Infinity ? "" : ` 〜 ${Math.round(bounds[i + 1]).toLocaleString()}`;
      rows.push(
        `<div class="rank-legend-row"><span class="rank-swatch" style="background:${colors[i]}"></span><span>${lo.toLocaleString()}${hi} ${unitLabel}</span></div>`
      );
    }
    els.rankLegend.innerHTML = `<div style="font-weight:700;margin-bottom:4px;">ランク別色分け</div>${rows.join("")}`;
    els.rankLegend.classList.remove("hidden");
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
      if (onReset) onReset();
    });
  }

  function wireReportButton(onReport) {
    els.reportBtn.addEventListener("click", onReport);
  }

  return {
    init,
    wireSearch,
    setConditionEnabled,
    getSelections,
    onSelectionsChanged,
    updateResult,
    emitResultReset,
    updateRankLegend,
    wireStatsFile,
    setBoundaryStatus,
    wireReset,
    wireReportButton,
  };
})();
