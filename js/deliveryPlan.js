/**
 * 配達プラン作成機能(サイドバー統合版)。独立したウィザードウィンドウは持たず、
 * 以下をそれぞれサイドバー/アプリ起動前の開始ゲートに統合する。
 * - ①作成方法の指定 → アプリ表示前の開始ゲート(#start-gate)
 * - ②商圏作成方法の指定 → サイドバー(js/panel.js の商圏作成方法セクション)
 * - ③新聞・④指標の指定 → サイドバー「条件を選択」パネルに統合
 * - ⑤予算通数の指定 → サイドバー独立セクション(分析開始・明細を含む)
 * - 逆引き分析・保存 → サイドバー独立ボタン
 * - レポート出力 → 既存の「レポート出力」ボタンに統合(main.js から exportReportBundle を呼ぶ)
 *
 * 実装上の簡略化(いずれもUI上に明記):
 * - 「配達見込世帯数」は実データが無いため boundaries/ の世帯数(SETAI)をそのまま用いる。
 * - 「逆引き分析」は、対象町丁目全体の統計上世帯数から目標予算通数を満たす掛け率を逆算する簡易実装。
 * - 「新聞(配布媒体)」のカバー率は実データが提供されていないため選択状態の保存のみで結果には影響しない。
 * - 「任意商圏」で作成したプランは、描画したポリゴン形状そのものは複製時に復元されない(地図上で再度描画が必要)。
 */
const DeliveryPlan = (() => {
  const PLANS_KEY = "gd_delivery_plans_v1";

  let els = {};
  let planState = { id: null, createdAt: null, indicators: [] };
  let activeIndicatorIndex = -1;
  let lastAnalysis = null; // { rows, allRows, totals, townCount }
  let selectedGatePlanId = null;

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

  // ---------------- 初期化 ----------------
  function init() {
    els = {
      newspaperList: document.getElementById("newspaper-list"),
      coverageRate: document.getElementById("coverage-rate"),

      indicatorTree: document.getElementById("indicator-tree"),
      indicatorSelected: document.getElementById("indicator-selected"),
      indicatorUp: document.getElementById("indicator-up"),
      indicatorDown: document.getElementById("indicator-down"),

      budgetCount: document.getElementById("budget-count"),
      selectAllTowns: document.getElementById("select-all-towns"),
      budgetModeEstimate: document.getElementById("budget-mode-estimate"),
      budgetModeStatistical: document.getElementById("budget-mode-statistical"),
      budgetEstimateHouseholds: document.getElementById("budget-estimate-households"),
      excludeZero: document.getElementById("exclude-zero"),
      budgetStatisticalHouseholds: document.getElementById("budget-statistical-households"),
      budgetMultiplier: document.getElementById("budget-multiplier"),
      budgetBaseHouseholds: document.getElementById("budget-base-households"),
      budgetTownCount: document.getElementById("budget-town-count"),

      analyzeBtn: document.getElementById("analyze-btn"),
      detailToggleBtn: document.getElementById("detail-toggle-btn"),
      detailPanel: document.getElementById("detail-panel"),
      detailTableBody: document.getElementById("detail-table-body"),
      detailCsvBtn: document.getElementById("detail-csv-btn"),

      reverseBtn: document.getElementById("reverse-btn"),
      saveNameInput: document.getElementById("save-plan-name"),
      saveBtn: document.getElementById("save-plan-btn"),

      gate: document.getElementById("start-gate"),
      gateMethodNew: document.getElementById("gate-method-new"),
      gateMethodCopy: document.getElementById("gate-method-copy"),
      gateCopyArea: document.getElementById("gate-copy-area"),
      gateCopySearch: document.getElementById("gate-copy-search"),
      gateCopyList: document.getElementById("gate-copy-list"),
      gateNameInput: document.getElementById("gate-name-input"),
      gateStartBtn: document.getElementById("gate-start-btn"),
    };

    els.saveNameInput.value = defaultPlanName();
    els.gateNameInput.value = defaultPlanName();

    renderIndicatorTree();
    renderNewspaperList();
    wireIndicatorControls();
    wireActions();
    wireStartGate();
  }

  // ---------------- 開始ゲート(①作成方法の指定) ----------------
  function wireStartGate() {
    els.gateMethodNew.addEventListener("change", () => els.gateCopyArea.classList.add("hidden"));
    els.gateMethodCopy.addEventListener("change", () => {
      els.gateCopyArea.classList.toggle("hidden", !els.gateMethodCopy.checked);
      if (els.gateMethodCopy.checked) renderGateCopyList();
    });
    els.gateCopySearch.addEventListener("input", renderGateCopyList);
    els.gateStartBtn.addEventListener("click", onGateStart);
  }

  function renderGateCopyList() {
    const q = els.gateCopySearch.value.trim().toLowerCase();
    const plans = loadSavedPlans()
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    els.gateCopyList.innerHTML =
      plans
        .map(
          (p) =>
            `<li data-id="${p.id}" class="${p.id === selectedGatePlanId ? "active" : ""}">${escapeHtml(p.name)} <span class="hint small">(${tsReadable(
              p.updatedAt
            )})</span></li>`
        )
        .join("") || "<li>該当する保存済みプランがありません</li>";
    els.gateCopyList.classList.remove("hidden");
    els.gateCopyList.querySelectorAll("li[data-id]").forEach((li) =>
      li.addEventListener("click", () => {
        selectedGatePlanId = li.dataset.id;
        const plan = loadSavedPlans().find((p) => p.id === selectedGatePlanId);
        if (plan) els.gateNameInput.value = `${plan.name}(複製)`;
        renderGateCopyList();
      })
    );
  }

  async function onGateStart() {
    els.gateStartBtn.disabled = true;
    try {
      if (els.gateMethodCopy.checked) {
        if (!selectedGatePlanId) {
          alert("複製する配達プランを一覧から選択してください");
          return;
        }
        const plan = loadSavedPlans().find((p) => p.id === selectedGatePlanId);
        if (plan) {
          await applyPlanState(plan.state);
          planState.id = null;
          planState.createdAt = null;
        }
      }
      els.saveNameInput.value = els.gateNameInput.value.trim() || defaultPlanName();

      els.gate.classList.add("hidden");
      document.getElementById("app-header").classList.remove("app-hidden");
      document.getElementById("app").classList.remove("app-hidden");
      const map = AppMap.getMap();
      if (map) setTimeout(() => map.invalidateSize(), 50);
    } finally {
      els.gateStartBtn.disabled = false;
    }
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
        els.indicatorTree.querySelector(`[data-cat-body="${h.dataset.cat}"]`).classList.toggle("collapsed");
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

  function runAnalysis() {
    const features = AppMap.getActiveFeatures();
    if (features.length === 0) {
      alert("商圏が設定されていません。商圏作成方法を選択し、範囲を指定してください。");
      return;
    }
    const selection = computeBudgetSelection(features);
    lastAnalysis = selection;

    const colorByKeyCode = new Map();
    selection.rows.forEach((r) => colorByKeyCode.set(r.feature.properties.KEY_CODE, "#2e7d32"));
    AppMap.applyBoundaryColors(colorByKeyCode);

    updateBudgetDisplay(selection.totals, selection.townCount);
    if (!els.detailPanel.classList.contains("hidden")) renderDetailTable();
  }

  /**
   * 簡易「逆引き分析」: 対象町丁目全体の統計上世帯数(掛け率適用前)から、
   * 予算通数を満たすために必要な掛け率を逆算して自動入力する。
   */
  function reverseAnalysis() {
    const features = AppMap.getActiveFeatures();
    if (features.length === 0) {
      alert("商圏が設定されていません。商圏作成方法を選択し、範囲を指定してください。");
      return;
    }
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
    runAnalysis();
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
      els.detailToggleBtn.textContent = "明細を表示";
      return;
    }
    renderDetailTable();
    els.detailPanel.classList.remove("hidden");
    els.detailToggleBtn.textContent = "明細を隠す";
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

  // ---------------- レポート出力(既存の「レポート出力」ボタンに統合) ----------------
  function exportReportBundle() {
    if (lastAnalysis) exportDetailCsv();
    if (typeof Report !== "undefined") Report.captureAndDownload();
  }

  // ---------------- 保存・複製用シリアライズ ----------------
  function serializePlanState() {
    const zoneMethod = Panel.getCurrentShape();
    return {
      zoneMethod,
      prefCode: document.getElementById("city-pref-select")?.value || "",
      selectedCities: Panel.getCheckedCityCodes(),
      circleOriginStoreId: document.getElementById("circle-origin-store")?.value || "",
      circleRadius: Number(document.getElementById("circle-radius")?.value) || 500,
      trainOriginStoreId: document.getElementById("train-origin-store")?.value || "",
      timeOriginStoreId: document.getElementById("time-origin-store")?.value || "",
      timeMode: document.querySelector("#time-mode .seg-btn.active")?.dataset.mode || "walk",
      timeMinutes: Number(document.getElementById("time-minutes")?.value) || 10,
      multiStoreIds: Panel.getCheckedMultiStoreIds(),
      multiRadius: Panel.getMultiStoreRadius(),
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
    if (state.zoneMethod === "polygon") {
      alert("「任意商圏」で作成したプランは描画形状を複製できません。複製後、地図上で商圏を再度描画してください。");
    }
    if (state.zoneMethod) await Panel.selectShapeExternally(state.zoneMethod);

    if (state.zoneMethod === "city") {
      const prefSelect = document.getElementById("city-pref-select");
      if (state.prefCode && prefSelect) {
        prefSelect.value = state.prefCode;
        prefSelect.dispatchEvent(new Event("change"));
      }
      const cityChecklist = document.getElementById("city-checklist");
      (state.selectedCities || []).forEach((code) => {
        const cb = cityChecklist?.querySelector(`.city-check[value="${code}"]`);
        if (cb) cb.checked = true;
      });
      AppMap.setCitySelection(Panel.getCheckedCityCodes());
    } else if (state.zoneMethod === "circle") {
      const radiusInput = document.getElementById("circle-radius");
      if (radiusInput) {
        radiusInput.value = state.circleRadius ?? 500;
        radiusInput.dispatchEvent(new Event("input"));
      }
      const originSelect = document.getElementById("circle-origin-store");
      if (state.circleOriginStoreId && originSelect) {
        originSelect.value = state.circleOriginStoreId;
        originSelect.dispatchEvent(new Event("change"));
      }
    } else if (state.zoneMethod === "train") {
      const originSelect = document.getElementById("train-origin-store");
      if (state.trainOriginStoreId && originSelect) {
        originSelect.value = state.trainOriginStoreId;
        originSelect.dispatchEvent(new Event("change"));
      }
    } else if (state.zoneMethod === "time") {
      const modeBtn = document.querySelector(`#time-mode .seg-btn[data-mode="${state.timeMode || "walk"}"]`);
      if (modeBtn) modeBtn.click();
      const minutesInput = document.getElementById("time-minutes");
      if (minutesInput) {
        minutesInput.value = state.timeMinutes ?? 10;
        minutesInput.dispatchEvent(new Event("input"));
      }
      const originSelect = document.getElementById("time-origin-store");
      if (state.timeOriginStoreId && originSelect) {
        originSelect.value = state.timeOriginStoreId;
        originSelect.dispatchEvent(new Event("change"));
      }
    } else if (state.zoneMethod === "multiStore") {
      const multiRadius = document.getElementById("multistore-radius");
      if (multiRadius) multiRadius.value = state.multiRadius ?? 500;
      const multiList = document.getElementById("multistore-list");
      (state.multiStoreIds || []).forEach((id) => {
        const cb = multiList?.querySelector(`.multi-store-check[value="${id}"]`);
        if (cb) cb.checked = true;
      });
      AppMap.setMultiStoreSelection(Panel.getCheckedMultiStoreIds());
    }

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

  // ---------------- 保存・リセット ----------------
  function savePlan() {
    const name = els.saveNameInput.value.trim() || defaultPlanName();
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
    alert(`プラン「${name}」を保存しました`);
  }

  function reset() {
    planState.indicators = [];
    activeIndicatorIndex = -1;
    renderSelectedIndicators();
    els.newspaperList.querySelectorAll(".np-check").forEach((cb) => (cb.checked = false));
    els.coverageRate.value = 100;
    els.budgetCount.value = 10000;
    els.selectAllTowns.checked = false;
    els.budgetModeEstimate.checked = true;
    els.excludeZero.checked = true;
    els.budgetMultiplier.value = 70;
    updateBudgetDisplay({ estimate: 0, statistical: 0, base: 0 }, 0);
    lastAnalysis = null;
    els.detailPanel.classList.add("hidden");
    els.detailToggleBtn.textContent = "明細を表示";
  }

  function wireActions() {
    els.analyzeBtn.addEventListener("click", runAnalysis);
    els.reverseBtn.addEventListener("click", reverseAnalysis);
    els.detailToggleBtn.addEventListener("click", toggleDetail);
    els.detailCsvBtn.addEventListener("click", exportDetailCsv);
    els.saveBtn.addEventListener("click", savePlan);
  }

  return { init, reset, exportReportBundle };
})();
