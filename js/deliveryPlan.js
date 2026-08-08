/**
 * 配達プラン作成ウィザード(新規・中核機能)。
 * 商圏作成方法(市区町村/店舗起点の円・電車・所要時間/任意商圏/多店舗分析)に応じて
 * 対象町丁目を集め、予算通数に基づく自動エリア選定を行う。
 *
 * 実装上の簡略化(いずれもUI上に明記):
 * - 「配達見込世帯数」は実データが無いため boundaries/ の世帯数(SETAI)をそのまま用いる。
 * - 「逆引き分析」は、対象町丁目全体の統計上世帯数から目標予算通数を満たす掛け率を逆算する簡易実装。
 * - 「新聞(配布媒体)」のカバー率は実データが提供されていないため選択状態の保存のみで結果には影響しない。
 * - ウィザードは左パネルの商圏指定(AppMap の mode)とは独立して動作し、同時併用は想定しない。
 */
const DeliveryPlan = (() => {
  const PLANS_KEY = "gd_delivery_plans_v1";

  let els = {};
  let planState = { id: null, createdAt: null, dirty: false, freePolygonGeoJSON: null, indicators: [] };
  let planTimeMode = "walk";
  let activeIndicatorIndex = -1;
  let lastAnalysis = null; // { rows, allRows, totals, townCount, shapeGeoJson, allFeatures }
  let cityUIReady = false;

  function uid() {
    return "id_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function tsCompact() {
    return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  }
  function tsReadable(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(
      d.getHours()
    ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function defaultPlanName() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `配達プラン_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  // ---------------- 初期化 ----------------
  function init() {
    els = {
      window: document.getElementById("plan-window"),
      min: document.getElementById("plan-min"),
      close: document.getElementById("plan-close"),
      nameInput: document.getElementById("plan-name-input"),

      methodNew: document.getElementById("plan-method-new"),
      methodCopy: document.getElementById("plan-method-copy"),
      copyArea: document.getElementById("plan-copy-area"),
      copySearch: document.getElementById("plan-copy-search"),
      copyList: document.getElementById("plan-copy-list"),

      zoneMethod: document.getElementById("plan-zone-method"),
      overlapRate: document.getElementById("plan-overlap-rate"),

      prefSelect: document.getElementById("plan-pref-select"),
      cityList: document.getElementById("plan-city-list"),

      storeSelectCircle: document.getElementById("plan-store-select-circle"),
      circleRadius: document.getElementById("plan-circle-radius"),
      storeSelectTrain: document.getElementById("plan-store-select-train"),
      storeSelectTime: document.getElementById("plan-store-select-time"),
      timeModeSeg: document.getElementById("plan-time-mode"),
      timeMinutes: document.getElementById("plan-time-minutes"),

      freeDrawBtn: document.getElementById("plan-free-draw-btn"),
      freeStatus: document.getElementById("plan-free-status"),

      multiStoreList: document.getElementById("plan-multi-store-list"),
      multiRadius: document.getElementById("plan-multi-radius"),

      newspaperList: document.getElementById("plan-newspaper-list"),
      coverageRate: document.getElementById("plan-coverage-rate"),

      indicatorTree: document.getElementById("plan-indicator-tree"),
      indicatorSelected: document.getElementById("plan-indicator-selected"),
      indicatorUp: document.getElementById("plan-indicator-up"),
      indicatorDown: document.getElementById("plan-indicator-down"),

      budgetCount: document.getElementById("plan-budget-count"),
      selectAllTowns: document.getElementById("plan-select-all-towns"),
      budgetModeEstimate: document.getElementById("plan-budget-mode-estimate"),
      budgetModeStatistical: document.getElementById("plan-budget-mode-statistical"),
      budgetEstimateHouseholds: document.getElementById("plan-budget-estimate-households"),
      excludeZero: document.getElementById("plan-exclude-zero"),
      budgetStatisticalHouseholds: document.getElementById("plan-budget-statistical-households"),
      budgetMultiplier: document.getElementById("plan-budget-multiplier"),
      budgetBaseHouseholds: document.getElementById("plan-budget-base-households"),
      budgetTownCount: document.getElementById("plan-budget-town-count"),

      detailPanel: document.getElementById("plan-detail-panel"),
      detailTableBody: document.getElementById("plan-detail-table-body"),
      detailCsvBtn: document.getElementById("plan-detail-csv-btn"),

      reverseBtn: document.getElementById("plan-reverse-btn"),
      detailBtn: document.getElementById("plan-detail-btn"),
      mapSelectBtn: document.getElementById("plan-map-select-btn"),
      analyzeBtn: document.getElementById("plan-analyze-btn"),
      saveBtn: document.getElementById("plan-save-btn"),
      reportBtn: document.getElementById("plan-report-btn"),
      cancelBtn: document.getElementById("plan-cancel-btn"),

      body: document.querySelector("#plan-window .fw-body"),
    };

    els.nameInput.value = defaultPlanName();
    renderIndicatorTree();
    renderNewspaperList();
    wireChrome();
    wireCreateMethod();
    wireZoneMethod();
    wireIndicatorControls();
    wireFreeDraw();
    wireActions();
    els.body.addEventListener("input", () => (planState.dirty = true));
    els.body.addEventListener("change", () => (planState.dirty = true));

    document.getElementById("open-plan-btn").addEventListener("click", open);
    document.getElementById("header-plan-btn").addEventListener("click", open);

    updateZoneSubVisibility();
  }

  function open() {
    els.window.classList.remove("hidden");
    els.window.classList.remove("minimized");
  }
  function close() {
    els.window.classList.add("hidden");
  }
  function wireChrome() {
    els.close.addEventListener("click", cancelPlan);
    els.min.addEventListener("click", () => els.window.classList.toggle("minimized"));
  }

  // ---------------- ① 作成方法 ----------------
  function wireCreateMethod() {
    els.methodNew.addEventListener("change", () => els.copyArea.classList.add("hidden"));
    els.methodCopy.addEventListener("change", () => {
      els.copyArea.classList.toggle("hidden", !els.methodCopy.checked);
      if (els.methodCopy.checked) renderCopyList();
    });
    els.copySearch.addEventListener("input", renderCopyList);
  }

  function loadSavedPlans() {
    try {
      return JSON.parse(localStorage.getItem(PLANS_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }
  function persistSavedPlans(plans) {
    localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
  }

  function renderCopyList() {
    const q = els.copySearch.value.trim().toLowerCase();
    const plans = loadSavedPlans()
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    els.copyList.innerHTML =
      plans
        .map((p) => `<li data-id="${p.id}">${escapeHtml(p.name)} <span class="hint small">(${tsReadable(p.updatedAt)})</span></li>`)
        .join("") || "<li>該当する保存済みプランがありません</li>";
    els.copyList.classList.remove("hidden");
    els.copyList.querySelectorAll("li[data-id]").forEach((li) => li.addEventListener("click", () => duplicatePlan(li.dataset.id)));
  }

  async function duplicatePlan(id) {
    const plan = loadSavedPlans().find((p) => p.id === id);
    if (!plan) return;
    await applyPlanState(plan.state);
    els.nameInput.value = `${plan.name}(複製)`;
    planState.id = null;
    planState.createdAt = null;
    els.methodNew.checked = true;
    els.copyArea.classList.add("hidden");
  }

  // ---------------- ② 商圏作成方法 ----------------
  function wireZoneMethod() {
    els.zoneMethod.addEventListener("change", () => updateZoneSubVisibility());
    els.timeModeSeg.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        planTimeMode = btn.dataset.mode;
        els.timeModeSeg.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
      });
    });
  }

  async function updateZoneSubVisibility() {
    const method = els.zoneMethod.value;
    ["city", "storeCircle", "storeTrain", "storeTime", "freePolygon", "multiStore"].forEach((m) => {
      document.getElementById(`plan-zone-${m}`).classList.toggle("hidden", m !== method);
    });
    if (method === "city") await populateCityUI();
    if (method === "storeCircle" || method === "storeTrain" || method === "storeTime") populateStoreSelects();
    if (method === "multiStore") populateMultiStoreList();
  }

  async function populateCityUI() {
    if (!cityUIReady) {
      await BoundaryLoader.loadIndex();
      const entries = BoundaryLoader.getMunicipalityIndex();
      const prefMap = new Map();
      entries.forEach((e) => {
        if (!prefMap.has(e.pref)) prefMap.set(e.pref, e.prefName);
      });
      const prefList = Array.from(prefMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      els.prefSelect.innerHTML = prefList.map(([code, name]) => `<option value="${code}">${name}</option>`).join("");
      els.prefSelect.addEventListener("change", renderCityChecklist);
      cityUIReady = true;
    }
    renderCityChecklist();
  }
  function renderCityChecklist() {
    const entries = BoundaryLoader.getMunicipalityIndex();
    const pref = els.prefSelect.value;
    const cities = entries.filter((e) => e.pref === pref).sort((a, b) => a.code.localeCompare(b.code));
    els.cityList.innerHTML = cities
      .map((c) => `<label><input type="checkbox" class="city-check" value="${c.code}"> ${escapeHtml(c.name)}</label>`)
      .join("");
  }
  function getCheckedCityCodes() {
    return Array.from(els.cityList.querySelectorAll(".city-check:checked")).map((cb) => cb.value);
  }

  function populateStoreSelects() {
    const stores = StoreManager.getStores();
    const optionsHtml =
      stores.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("") ||
      `<option value="">(店舗が登録されていません)</option>`;
    [els.storeSelectCircle, els.storeSelectTrain, els.storeSelectTime].forEach((sel) => {
      const prev = sel.value;
      sel.innerHTML = optionsHtml;
      if (stores.some((s) => s.id === prev)) sel.value = prev;
    });
  }
  function populateMultiStoreList() {
    const stores = StoreManager.getStores();
    els.multiStoreList.innerHTML =
      stores
        .map((s) => `<label><input type="checkbox" class="multi-store-check" value="${s.id}"> ${escapeHtml(s.name)}</label>`)
        .join("") || "<div class='hint small'>店舗が登録されていません(先に店舗管理から登録してください)</div>";
  }
  function getCheckedMultiStoreIds() {
    return Array.from(els.multiStoreList.querySelectorAll(".multi-store-check:checked")).map((cb) => cb.value);
  }
  function getSelectedStoreForMethod(method) {
    const sel = method === "storeCircle" ? els.storeSelectCircle : method === "storeTrain" ? els.storeSelectTrain : els.storeSelectTime;
    return sel.value ? StoreManager.getStoreById(sel.value) : null;
  }

  // ---------------- 任意商圏(地図で描画) ----------------
  function wireFreeDraw() {
    els.freeDrawBtn.addEventListener("click", startFreePolygonDraw);
  }
  function startFreePolygonDraw() {
    AppMap.clearShape();
    AppMap.setMode("polygon");
    els.window.classList.add("minimized");
    els.freeStatus.textContent = "地図上をクリックして頂点を追加し、始点付近をクリックまたはダブルクリックで確定してください。";
    const handler = (info) => {
      if (info && info.mode === "polygon" && info.geojson) {
        AppMap.off("shapeUpdated", handler);
        planState.freePolygonGeoJSON = info.geojson;
        planState.dirty = true;
        els.freeStatus.textContent = "商圏を設定しました";
        els.window.classList.remove("minimized");
        open();
      }
    };
    AppMap.on("shapeUpdated", handler);
  }

  // ---------------- ③ 新聞(配布媒体) ----------------
  function renderNewspaperList() {
    els.newspaperList.innerHTML = (typeof SAMPLE_NEWSPAPERS !== "undefined" ? SAMPLE_NEWSPAPERS : [])
      .map((np) => `<label><input type="checkbox" class="np-check" value="${np.id}"> ${escapeHtml(np.name)}</label>`)
      .join("");
  }

  // ---------------- ④ 指標の指定 ----------------
  function renderIndicatorTree() {
    els.indicatorTree.innerHTML = STAT_INDICATOR_TREE.map(
      (cat) => `
      <div class="indicator-cat">
        <div class="indicator-cat-header" data-cat="${cat.key}">
          <span>${escapeHtml(cat.label)}</span>
          ${cat.provided ? "" : '<span class="not-provided-badge">データ未提供</span>'}
        </div>
        <div class="indicator-leaf-list collapsed" data-cat-body="${cat.key}">
          ${cat.leaves
            .map(
              (leaf) =>
                `<div class="indicator-leaf-row" data-cat="${cat.key}" data-leaf="${leaf.key}"><span>${escapeHtml(
                  leaf.label
                )}</span><i class="fa-solid fa-plus"></i></div>`
            )
            .join("")}
        </div>
      </div>`
    ).join("");

    els.indicatorTree.querySelectorAll(".indicator-cat-header").forEach((h) => {
      h.addEventListener("click", () => {
        document.querySelector(`[data-cat-body="${h.dataset.cat}"]`).classList.toggle("collapsed");
      });
    });
    els.indicatorTree.querySelectorAll(".indicator-leaf-row").forEach((row) => {
      row.addEventListener("click", () => addIndicator(row.dataset.cat, row.dataset.leaf));
    });
  }

  function addIndicator(categoryKey, leafKey) {
    const cat = STAT_INDICATOR_TREE.find((c) => c.key === categoryKey);
    const leaf = cat.leaves.find((l) => l.key === leafKey);
    if (planState.indicators.some((i) => i.categoryKey === categoryKey && i.leafKey === leafKey)) return;
    planState.indicators.push({ categoryKey, leafKey, label: `${cat.label} / ${leaf.label}`, provided: cat.provided });
    planState.dirty = true;
    renderSelectedIndicators();
  }

  function renderSelectedIndicators() {
    els.indicatorSelected.innerHTML = planState.indicators
      .map(
        (ind, i) => `
      <div class="indicator-selected-row ${i === activeIndicatorIndex ? "active" : ""}" data-idx="${i}">
        <span>${escapeHtml(ind.label)}${ind.provided ? "" : ' <span class="hint small">(データ未提供)</span>'}</span>
        <i class="fa-solid fa-xmark" data-remove="${i}" title="削除"></i>
      </div>`
      )
      .join("");
    els.indicatorSelected.querySelectorAll(".indicator-selected-row").forEach((row) => {
      row.addEventListener("click", () => {
        activeIndicatorIndex = Number(row.dataset.idx);
        renderSelectedIndicators();
      });
    });
    els.indicatorSelected.querySelectorAll("[data-remove]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        planState.indicators.splice(Number(el.dataset.remove), 1);
        activeIndicatorIndex = -1;
        renderSelectedIndicators();
      });
    });
  }

  function wireIndicatorControls() {
    els.indicatorUp.addEventListener("click", () => moveIndicator(-1));
    els.indicatorDown.addEventListener("click", () => moveIndicator(1));
  }
  function moveIndicator(delta) {
    if (activeIndicatorIndex < 0) return;
    const newIndex = activeIndicatorIndex + delta;
    if (newIndex < 0 || newIndex >= planState.indicators.length) return;
    const [item] = planState.indicators.splice(activeIndicatorIndex, 1);
    planState.indicators.splice(newIndex, 0, item);
    activeIndicatorIndex = newIndex;
    renderSelectedIndicators();
  }

  // ---------------- ⑤ 予算通数・分析ロジック ----------------
  // 予算通数まわりのラジオ・チェックボックスは分析実行時(runAnalysis/computeBudgetSelection)に
  // 直接値を参照するため、専用の change ハンドラは不要。

  async function resolveCandidates() {
    const method = els.zoneMethod.value;

    if (method === "city") {
      const codes = getCheckedCityCodes();
      if (codes.length === 0) throw new Error("市区町村を選択してください");
      const features = await BoundaryLoader.getFeaturesForMunicipalities(codes);
      return { features, shapeGeoJson: null };
    }

    if (method === "storeCircle" || method === "storeTrain" || method === "storeTime") {
      const store = getSelectedStoreForMethod(method);
      if (!store) throw new Error("起点店舗を選択してください(店舗管理から先に登録してください)");
      let shape;
      if (method === "storeCircle") {
        shape = ShapeBuilders.circle(store.lat, store.lon, Number(els.circleRadius.value) || 500);
      } else if (method === "storeTrain") {
        shape = await ShapeBuilders.train({ lat: store.lat, lon: store.lon });
      } else {
        shape = await ShapeBuilders.time({
          lat: store.lat,
          lon: store.lon,
          mode: planTimeMode,
          minutes: Number(els.timeMinutes.value) || 10,
        });
      }
      const result = await BoundaryLoader.getFeaturesIntersectingShape(shape);
      if (result.tooBroad) throw new Error(`範囲が広すぎます(該当市区町村 ${result.candidateCount})。範囲を狭めてください。`);
      return { features: result.features, shapeGeoJson: shape };
    }

    if (method === "freePolygon") {
      if (!planState.freePolygonGeoJSON) throw new Error("「地図選択」から任意商圏を描画してください");
      const result = await BoundaryLoader.getFeaturesIntersectingShape(planState.freePolygonGeoJSON);
      if (result.tooBroad) throw new Error(`範囲が広すぎます(該当市区町村 ${result.candidateCount})。範囲を狭めてください。`);
      return { features: result.features, shapeGeoJson: planState.freePolygonGeoJSON };
    }

    if (method === "multiStore") {
      const storeIds = getCheckedMultiStoreIds();
      if (storeIds.length === 0) throw new Error("対象店舗を選択してください");
      const radius = Number(els.multiRadius.value) || 500;
      const seen = new Map();
      for (const id of storeIds) {
        const store = StoreManager.getStoreById(id);
        if (!store) continue;
        const shape = ShapeBuilders.circle(store.lat, store.lon, radius);
        const result = await BoundaryLoader.getFeaturesIntersectingShape(shape);
        if (result.tooBroad) continue;
        result.features.forEach((f) => seen.set(f.properties.KEY_CODE, f));
      }
      return { features: Array.from(seen.values()), shapeGeoJson: null };
    }

    throw new Error("不明な商圏作成方法です");
  }

  /** 配達見込世帯数は実データが無いため boundaries/ の世帯数(SETAI)を基礎値として用いる */
  function computeBudgetSelection(features) {
    const excludeZero = els.excludeZero.checked;
    const useStatistical = els.budgetModeStatistical.checked;
    const multiplier = (Number(els.budgetMultiplier.value) || 0) / 100;
    const selectAll = els.selectAllTowns.checked;
    const budget = Number(els.budgetCount.value) || 0;

    const allRows = features.map((f) => {
      const households = DataStore.getHouseholds(f);
      return { feature: f, households, estimateHouseholds: households, statisticalHouseholds: households * multiplier };
    });

    let candidates = allRows.filter((r) => !excludeZero || r.households > 0);
    candidates = candidates.slice().sort((a, b) => b.households - a.households);

    let selected;
    if (selectAll) {
      selected = candidates;
    } else {
      selected = [];
      let cumulative = 0;
      for (const row of candidates) {
        if (cumulative >= budget) break;
        selected.push(row);
        cumulative += useStatistical ? row.statisticalHouseholds : row.estimateHouseholds;
      }
    }

    const totals = selected.reduce(
      (acc, r) => {
        acc.estimate += r.estimateHouseholds;
        acc.statistical += r.statisticalHouseholds;
        acc.base += r.households;
        return acc;
      },
      { estimate: 0, statistical: 0, base: 0 }
    );

    return { rows: selected, allRows, totals, townCount: selected.length };
  }

  function updateBudgetDisplay(totals, townCount) {
    els.budgetEstimateHouseholds.textContent = `${Math.round(totals.estimate).toLocaleString()} 世帯`;
    els.budgetStatisticalHouseholds.textContent = `${Math.round(totals.statistical).toLocaleString()} 世帯`;
    els.budgetBaseHouseholds.textContent = `${Math.round(totals.base).toLocaleString()} 世帯`;
    els.budgetTownCount.textContent = String(townCount);
  }

  function setBusy(busy) {
    els.analyzeBtn.disabled = busy;
    els.analyzeBtn.textContent = busy ? "分析中…" : "分析開始";
  }

  async function runAnalysis() {
    try {
      setBusy(true);
      const { features, shapeGeoJson } = await resolveCandidates();
      const selection = computeBudgetSelection(features);
      lastAnalysis = { ...selection, shapeGeoJson, allFeatures: features };

      AppMap.renderBoundaryFeatures(features);
      const colorByKeyCode = new Map();
      selection.rows.forEach((r) => colorByKeyCode.set(r.feature.properties.KEY_CODE, "#2e7d32"));
      AppMap.applyBoundaryColors(colorByKeyCode);
      AppMap.renderPlanShape(shapeGeoJson);

      updateBudgetDisplay(selection.totals, selection.townCount);
      planState.dirty = true;
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * 簡易「逆引き分析」: 対象町丁目全体の統計上世帯数(掛け率適用前)から、
   * 予算通数を満たすために必要な掛け率を逆算して自動入力する。
   */
  async function reverseAnalysis() {
    try {
      setBusy(true);
      const { features } = await resolveCandidates();
      const excludeZero = els.excludeZero.checked;
      const rows = features.filter((f) => !excludeZero || DataStore.getHouseholds(f) > 0);
      const baseTotal = rows.reduce((sum, f) => sum + DataStore.getHouseholds(f), 0);
      const budget = Number(els.budgetCount.value) || 0;
      if (baseTotal <= 0) {
        alert("対象エリアの世帯数が0のため、掛け率を逆算できません");
        return;
      }
      const neededMultiplier = Math.min(200, Math.max(0, (budget / baseTotal) * 100));
      els.budgetMultiplier.value = neededMultiplier.toFixed(1);
      els.budgetModeStatistical.checked = true;
      await runAnalysis();
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  // ---------------- 明細 ----------------
  function toggleDetail() {
    if (!lastAnalysis) {
      alert("先に「分析開始」を実行してください");
      return;
    }
    const showing = !els.detailPanel.classList.contains("hidden");
    if (showing) {
      els.detailPanel.classList.add("hidden");
      return;
    }
    renderDetailTable();
    els.detailPanel.classList.remove("hidden");
  }

  function detailIndicatorText(f) {
    if (planState.indicators.length === 0) return "-";
    return planState.indicators
      .map((ind) => {
        const v = DataStore.getIndicatorValue(f, ind.categoryKey, ind.leafKey);
        return `${ind.label}: ${v == null ? "データ未提供" : Math.round(v).toLocaleString()}`;
      })
      .join(" / ");
  }

  function renderDetailTable() {
    els.detailTableBody.innerHTML = lastAnalysis.rows
      .map((r) => {
        const f = r.feature;
        const name = [f.properties?.CITY_NAME, f.properties?.S_NAME].filter(Boolean).join(" ") || f.properties?.KEY_CODE || "-";
        return `<tr>
          <td>${escapeHtml(name)}</td>
          <td>${Math.round(r.households).toLocaleString()}</td>
          <td>${Math.round(r.statisticalHouseholds).toLocaleString()}</td>
          <td>${escapeHtml(detailIndicatorText(f))}</td>
        </tr>`;
      })
      .join("");
  }

  function csvEscape(v) {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCsv(content, filename) {
    const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  function exportDetailCsv() {
    if (!lastAnalysis) {
      alert("先に「分析開始」を実行してください");
      return;
    }
    const header = ["町丁目", "KEY_CODE", "世帯数", "統計上世帯数", ...planState.indicators.map((i) => i.label)];
    const lines = [header.map(csvEscape).join(",")];
    lastAnalysis.rows.forEach((r) => {
      const f = r.feature;
      const name = [f.properties?.CITY_NAME, f.properties?.S_NAME].filter(Boolean).join(" ");
      const cells = [name, f.properties?.KEY_CODE, Math.round(r.households), Math.round(r.statisticalHouseholds)];
      planState.indicators.forEach((ind) => {
        const v = DataStore.getIndicatorValue(f, ind.categoryKey, ind.leafKey);
        cells.push(v == null ? "" : Math.round(v));
      });
      lines.push(cells.map(csvEscape).join(","));
    });
    downloadCsv(lines.join("\n"), `配達プラン明細_${tsCompact()}.csv`);
  }

  // ---------------- 地図選択 ----------------
  function onMapSelect() {
    const method = els.zoneMethod.value;
    if (method === "freePolygon") {
      startFreePolygonDraw();
    } else if (method === "city") {
      els.prefSelect.focus();
      els.prefSelect.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (method === "storeCircle" || method === "storeTrain" || method === "storeTime") {
      const sel = method === "storeCircle" ? els.storeSelectCircle : method === "storeTrain" ? els.storeSelectTrain : els.storeSelectTime;
      sel.focus();
      sel.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (method === "multiStore") {
      els.multiStoreList.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // ---------------- 保存・複製用シリアライズ ----------------
  function serializePlanState() {
    return {
      zoneMethod: els.zoneMethod.value,
      overlapRate: Number(els.overlapRate.value) || 0,
      prefCode: els.prefSelect.value,
      selectedCities: getCheckedCityCodes(),
      storeCircleId: els.storeSelectCircle.value,
      circleRadius: Number(els.circleRadius.value) || 500,
      storeTrainId: els.storeSelectTrain.value,
      storeTimeId: els.storeSelectTime.value,
      timeMode: planTimeMode,
      timeMinutes: Number(els.timeMinutes.value) || 10,
      freePolygonGeoJSON: planState.freePolygonGeoJSON,
      multiStoreIds: getCheckedMultiStoreIds(),
      multiRadius: Number(els.multiRadius.value) || 500,
      newspapers: Array.from(els.newspaperList.querySelectorAll(".np-check:checked")).map((cb) => cb.value),
      coverageRate: Number(els.coverageRate.value) || 100,
      indicators: planState.indicators,
      budget: {
        count: Number(els.budgetCount.value) || 0,
        selectAll: els.selectAllTowns.checked,
        mode: els.budgetModeStatistical.checked ? "statistical" : "estimate",
        excludeZero: els.excludeZero.checked,
        multiplier: Number(els.budgetMultiplier.value) || 0,
      },
    };
  }

  async function applyPlanState(state) {
    els.zoneMethod.value = state.zoneMethod || "city";
    els.overlapRate.value = state.overlapRate ?? 0;
    await updateZoneSubVisibility();

    if (state.prefCode) {
      els.prefSelect.value = state.prefCode;
      renderCityChecklist();
    }
    (state.selectedCities || []).forEach((code) => {
      const cb = els.cityList.querySelector(`.city-check[value="${code}"]`);
      if (cb) cb.checked = true;
    });

    if (state.storeCircleId) els.storeSelectCircle.value = state.storeCircleId;
    els.circleRadius.value = state.circleRadius ?? 500;
    if (state.storeTrainId) els.storeSelectTrain.value = state.storeTrainId;
    if (state.storeTimeId) els.storeSelectTime.value = state.storeTimeId;
    planTimeMode = state.timeMode || "walk";
    els.timeModeSeg.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === planTimeMode));
    els.timeMinutes.value = state.timeMinutes ?? 10;

    planState.freePolygonGeoJSON = state.freePolygonGeoJSON || null;
    els.freeStatus.textContent = planState.freePolygonGeoJSON ? "商圏が設定済みです" : "未描画";

    (state.multiStoreIds || []).forEach((id) => {
      const cb = els.multiStoreList.querySelector(`.multi-store-check[value="${id}"]`);
      if (cb) cb.checked = true;
    });
    els.multiRadius.value = state.multiRadius ?? 500;

    (state.newspapers || []).forEach((id) => {
      const cb = els.newspaperList.querySelector(`.np-check[value="${id}"]`);
      if (cb) cb.checked = true;
    });
    els.coverageRate.value = state.coverageRate ?? 100;

    planState.indicators = (state.indicators || []).slice();
    activeIndicatorIndex = -1;
    renderSelectedIndicators();

    els.budgetCount.value = state.budget?.count ?? 10000;
    els.selectAllTowns.checked = !!state.budget?.selectAll;
    els.excludeZero.checked = state.budget?.excludeZero !== false;
    els.budgetMultiplier.value = state.budget?.multiplier ?? 70;
    if (state.budget?.mode === "statistical") els.budgetModeStatistical.checked = true;
    else els.budgetModeEstimate.checked = true;
  }

  // ---------------- 保存・レポート出力・キャンセル ----------------
  function savePlan() {
    const name = els.nameInput.value.trim() || defaultPlanName();
    const plans = loadSavedPlans();
    const nowIso = new Date().toISOString();
    const snapshot = {
      id: planState.id || uid(),
      name,
      createdAt: planState.createdAt || nowIso,
      updatedAt: nowIso,
      state: serializePlanState(),
    };
    const idx = plans.findIndex((p) => p.id === snapshot.id);
    if (idx >= 0) plans[idx] = snapshot;
    else plans.push(snapshot);
    persistSavedPlans(plans);
    planState.id = snapshot.id;
    planState.createdAt = snapshot.createdAt;
    planState.dirty = false;
    alert(`プラン「${name}」を保存しました`);
  }

  function exportReport() {
    if (!lastAnalysis) {
      alert("先に「分析開始」を実行してください");
      return;
    }
    exportDetailCsv();
    if (typeof Report !== "undefined") Report.captureAndDownload();
  }

  function cancelPlan() {
    if (planState.dirty && !confirm("保存されていない変更があります。破棄してよろしいですか?")) return;
    AppMap.clearPlanShape();
    AppMap.renderBoundaryFeatures([]);
    lastAnalysis = null;
    els.detailPanel.classList.add("hidden");
    planState.dirty = false;
    close();
  }

  function wireActions() {
    els.reverseBtn.addEventListener("click", reverseAnalysis);
    els.detailBtn.addEventListener("click", toggleDetail);
    els.detailCsvBtn.addEventListener("click", exportDetailCsv);
    els.mapSelectBtn.addEventListener("click", onMapSelect);
    els.analyzeBtn.addEventListener("click", runAnalysis);
    els.saveBtn.addEventListener("click", savePlan);
    els.reportBtn.addEventListener("click", exportReport);
    els.cancelBtn.addEventListener("click", cancelPlan);
  }

  return { init, open, close };
})();
