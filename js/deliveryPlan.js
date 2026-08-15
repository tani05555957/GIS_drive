/**
 * 配達プラン作成機能(サイドバー統合版)。独立したウィザードウィンドウは持たず、
 * 以下をそれぞれサイドバー/アプリ起動前の開始ゲートに統合する。
 * - ①作成方法の指定 → アプリ表示前の開始ゲート(#start-gate)
 * - ②商圏作成方法の指定 → サイドバー(js/panel.js の商圏作成方法セクション)
 * - ③新聞購読率の指定 → サイドバー「条件を選択」パネルの属性条件の1カテゴリとして統合
 *   (js/statsConfig.js の STAT_CATEGORIES、実統計指標によるランキングは js/rankEngine.js が担う)
 * - ⑤予算通数の指定 → サイドバー独立セクション(分析開始・明細を含む)。RankEngine.getLast() が
 *   保持する「条件を選択」のランキング(scoreByKeyCode)上位から、指定通数に最も近くなるところまで
 *   町丁目を選び、選外の町丁目は境界を残したまま塗りを完全透明にする。
 * - 保存 → サイドバー独立ボタン
 * - レポート出力 → 既存の「レポート出力」ボタンに統合(main.js から exportReportBundle を呼ぶ)
 *
 * 実装上の簡略化(いずれもUI上に明記):
 * - 「任意商圏」で作成したプランは、描画したポリゴン形状そのものは複製時に復元されない(地図上で再度描画が必要)。
 */
const DeliveryPlan = (() => {
  const PLANS_KEY = "gd_delivery_plans_v1";

  let els = {};
  let planState = { id: null, createdAt: null };
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
      budgetCount: document.getElementById("budget-count"),
      selectAllTowns: document.getElementById("select-all-towns"),
      budgetModeDeliverable: document.getElementById("budget-mode-deliverable"),
      budgetModeHouseholds: document.getElementById("budget-mode-households"),
      budgetDeliverableTotal: document.getElementById("budget-deliverable-total"),
      budgetHouseholdsTotal: document.getElementById("budget-households-total"),
      excludeZero: document.getElementById("exclude-zero"),
      budgetTownCount: document.getElementById("budget-town-count"),

      analyzeBtn: document.getElementById("analyze-btn"),
      detailToggleBtn: document.getElementById("detail-toggle-btn"),
      detailPanel: document.getElementById("detail-panel"),
      detailTableBody: document.getElementById("detail-table-body"),
      detailCsvBtn: document.getElementById("detail-csv-btn"),

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

  // ---------------- ⑤ 予算通数・分析ロジック ----------------
  /**
   * 「条件を選択」で計算済みのランキング(RankEngine.getLast().scoreByKeyCode、値が大きいほど上位)の
   * 上位から順に、選んだ基準(配達可能箇所数/統計上世帯数)の累計が予算通数に最も近くなる
   * ところまで町丁目を採用する。ランキング対象外(データ無し)の町丁目は候補から除く。
   */
  function computeBudgetSelection(features) {
    const rank = RankEngine.getLast();
    const scoreByKeyCode = rank.scoreByKeyCode || new Map();
    const excludeZero = els.excludeZero.checked;
    const useDeliverable = els.budgetModeDeliverable.checked;
    const selectAll = els.selectAllTowns.checked;
    const budget = Number(els.budgetCount.value) || 0;

    const allRows = features
      .map((f) => {
        const key = f.properties?.KEY_CODE;
        const record = StatsData.getRecord(key);
        return {
          feature: f,
          key,
          deliverable: record?.deliverable || 0,
          statHouseholds: record?.statHouseholds || 0,
          score: scoreByKeyCode.get(key),
        };
      })
      .filter((r) => r.score != null);

    const metricOf = (r) => (useDeliverable ? r.deliverable : r.statHouseholds);
    const candidates = allRows.filter((r) => !excludeZero || metricOf(r) > 0).sort((a, b) => b.score - a.score);

    let selected;
    if (selectAll) {
      selected = candidates;
    } else {
      let cumulative = 0;
      let bestK = 0;
      let bestDiff = Math.abs(budget);
      candidates.forEach((row, i) => {
        cumulative += metricOf(row);
        const diff = Math.abs(cumulative - budget);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestK = i + 1;
        }
      });
      selected = candidates.slice(0, bestK);
    }

    const totals = selected.reduce(
      (acc, r) => {
        acc.deliverable += r.deliverable;
        acc.households += r.statHouseholds;
        return acc;
      },
      { deliverable: 0, households: 0 }
    );

    return { rows: selected, allRows, totals, townCount: selected.length };
  }

  function updateBudgetDisplay(totals, townCount) {
    els.budgetDeliverableTotal.textContent = `${Math.round(totals.deliverable).toLocaleString()} 箇所`;
    els.budgetHouseholdsTotal.textContent = `${Math.round(totals.households).toLocaleString()} 世帯`;
    els.budgetTownCount.textContent = String(townCount);
  }

  function runAnalysis() {
    const features = AppMap.getActiveFeatures();
    if (features.length === 0) {
      alert("商圏が設定されていません。商圏作成方法を選択し、範囲を指定してください。");
      return;
    }
    const rank = RankEngine.getLast();
    if (rank.mode === "none") {
      alert("先に「条件を選択」でランキングに使う指標を選択してください。");
      return;
    }
    const selection = computeBudgetSelection(features);
    lastAnalysis = selection;

    const selectedKeys = new Set(selection.rows.map((r) => r.key));
    const hiddenKeyCodes = new Set();
    features.forEach((f) => {
      const key = f.properties?.KEY_CODE;
      if (key && !selectedKeys.has(key)) hiddenKeyCodes.add(key);
    });
    AppMap.applyBoundaryColors(rank.colorByKeyCode, {
      fallbackFill: NO_DATA_FILL,
      fallbackBorder: NO_DATA_BORDER,
      hiddenKeyCodes,
    });

    updateBudgetDisplay(selection.totals, selection.townCount);
    if (!els.detailPanel.classList.contains("hidden")) renderDetailTable();
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

  function renderDetailTable() {
    els.detailTableBody.innerHTML = lastAnalysis.rows
      .map((r) => {
        const f = r.feature;
        const name = [f.properties?.CITY_NAME, f.properties?.S_NAME].filter(Boolean).join(" ") || f.properties?.KEY_CODE || "-";
        return `<tr>
          <td>${escapeHtml(name)}</td>
          <td>${Math.round(r.deliverable).toLocaleString()}</td>
          <td>${Math.round(r.statHouseholds).toLocaleString()}</td>
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
    const header = ["町丁目", "KEY_CODE", "配達可能箇所数", "統計上世帯数"];
    const lines = [header.map(csvEscape).join(",")];
    lastAnalysis.rows.forEach((r) => {
      const f = r.feature;
      const name = [f.properties?.CITY_NAME, f.properties?.S_NAME].filter(Boolean).join(" ");
      const cells = [name, r.key, Math.round(r.deliverable), Math.round(r.statHouseholds)];
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
      circleRadius: Number(document.getElementById("circle-radius")?.value) || 500,
      timeMode: document.querySelector("#time-mode .seg-btn.active")?.dataset.mode || "walk",
      timeMinutes: Number(document.getElementById("time-minutes")?.value) || 10,
      multiStoreIds: Panel.getCheckedMultiStoreIds(),
      multiRadius: Panel.getMultiStoreRadius(),
      budget: {
        count: Number(els.budgetCount.value) || 0,
        selectAll: els.selectAllTowns.checked,
        mode: els.budgetModeHouseholds.checked ? "households" : "deliverable",
        excludeZero: els.excludeZero.checked,
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
    } else if (state.zoneMethod === "time") {
      const modeBtn = document.querySelector(`#time-mode .seg-btn[data-mode="${state.timeMode || "walk"}"]`);
      if (modeBtn) modeBtn.click();
      const minutesInput = document.getElementById("time-minutes");
      if (minutesInput) {
        minutesInput.value = state.timeMinutes ?? 10;
        minutesInput.dispatchEvent(new Event("input"));
      }
    } else if (state.zoneMethod === "multiStore") {
      const multiRadius = document.getElementById("multistore-radius");
      if (multiRadius) multiRadius.value = state.multiRadius ?? 500;
      const multiList = document.getElementById("multistore-list");
      (state.multiStoreIds || []).forEach((id) => {
        const cb = multiList?.querySelector(`.multi-store-check[value="${id}"]`);
        if (cb) cb.checked = true;
      });
      Panel.syncMultiStoreSelectAll();
      AppMap.setMultiStoreSelection(Panel.getCheckedMultiStoreIds());
    }

    els.budgetCount.value = state.budget?.count ?? 50000;
    els.selectAllTowns.checked = !!state.budget?.selectAll;
    els.excludeZero.checked = state.budget?.excludeZero !== false;
    if (state.budget?.mode === "households") els.budgetModeHouseholds.checked = true;
    else els.budgetModeDeliverable.checked = true;
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
    els.budgetCount.value = 50000;
    els.selectAllTowns.checked = false;
    els.budgetModeDeliverable.checked = true;
    els.excludeZero.checked = true;
    updateBudgetDisplay({ deliverable: 0, households: 0 }, 0);
    lastAnalysis = null;
    els.detailPanel.classList.add("hidden");
    els.detailToggleBtn.textContent = "明細を表示";
  }

  function wireActions() {
    els.analyzeBtn.addEventListener("click", runAnalysis);
    els.detailToggleBtn.addEventListener("click", toggleDetail);
    els.detailCsvBtn.addEventListener("click", exportDetailCsv);
    els.saveBtn.addEventListener("click", savePlan);
  }

  return { init, reset, exportReportBundle };
})();
