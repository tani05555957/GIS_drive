/**
 * 店舗管理機能(新規)。
 * 店舗・グループを localStorage に永続化し、地図上への一括描画(マーカー・円商圏)を行う。
 * 配達プランウィザード(js/deliveryPlan.js)は StoreManager.getStores()/getGroups() を
 * 直接参照して「店舗を起点にした商圏」の元データとして利用する。
 */
const StoreManager = (() => {
  const STORES_KEY = "gd_stores_v1";
  const GROUPS_KEY = "gd_store_groups_v1";

  let stores = [];
  let groups = [];
  let els = {};
  let editingStoreId = null;
  let editingGroupId = null;
  let pendingLinkedArea = null; // { name, code } | null (フォーム編集中の紐づいたエリア)
  let pendingGeocodeSource = null; // 'gsi' | 'nominatim' | 'manual' | null

  function uid() {
    return "id_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function loadData() {
    try {
      stores = JSON.parse(localStorage.getItem(STORES_KEY) || "[]");
    } catch (e) {
      stores = [];
    }
    try {
      groups = JSON.parse(localStorage.getItem(GROUPS_KEY) || "[]");
    } catch (e) {
      groups = [];
    }
    if (groups.length === 0) {
      groups.push({
        id: uid(),
        name: "既定グループ",
        color: "#d81f2a",
        borderWidth: 2,
        icon: "fa-shop",
        pointSize: 8,
        shared: false,
      });
      persistGroups();
    }
  }

  function persistStores() {
    localStorage.setItem(STORES_KEY, JSON.stringify(stores));
  }
  function persistGroups() {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  }

  function getStores() {
    return stores;
  }
  function getGroups() {
    return groups;
  }
  function getGroupsById() {
    return new Map(groups.map((g) => [g.id, g]));
  }
  function getStoreById(id) {
    return stores.find((s) => s.id === id);
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(
      d.getHours()
    ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  // ---------------- 初期化・DOM ----------------
  function init() {
    els = {
      window: document.getElementById("store-mgr-window"),
      min: document.getElementById("store-mgr-min"),
      close: document.getElementById("store-mgr-close"),
      tabList: document.getElementById("store-tab-list"),
      tabGroups: document.getElementById("store-tab-groups"),
      panelList: document.getElementById("store-panel-list"),
      panelGroups: document.getElementById("store-panel-groups"),

      addBtn: document.getElementById("store-add-btn"),
      form: document.getElementById("store-form"),
      formNo: document.getElementById("store-form-no"),
      formName: document.getElementById("store-form-name"),
      formGroup: document.getElementById("store-form-group"),
      formAddress: document.getElementById("store-form-address"),
      formAddressSearch: document.getElementById("store-form-address-search"),
      formPickMap: document.getElementById("store-form-pick-map"),
      formLat: document.getElementById("store-form-lat"),
      formLon: document.getElementById("store-form-lon"),
      formArea: document.getElementById("store-form-area"),
      formCount: document.getElementById("store-form-count"),
      formRadius: document.getElementById("store-form-radius"),
      formRadiusVal: document.getElementById("store-form-radius-val"),
      formSave: document.getElementById("store-form-save"),
      formCancel: document.getElementById("store-form-cancel"),
      tableBody: document.getElementById("store-table-body"),

      csvImportBtn: document.getElementById("store-csv-import-btn"),
      csvExportBtn: document.getElementById("store-csv-export-btn"),
      csvTemplateBtn: document.getElementById("store-csv-template-btn"),
      csvInput: document.getElementById("store-csv-input"),

      drawRadius: document.getElementById("store-draw-radius"),
      drawRadiusVal: document.getElementById("store-draw-radius-val"),
      drawBtn: document.getElementById("store-draw-btn"),
      applyAllBtn: document.getElementById("store-apply-all-btn"),
      labelToggle: document.getElementById("store-label-toggle"),

      groupAddBtn: document.getElementById("group-add-btn"),
      groupForm: document.getElementById("group-form"),
      groupFormName: document.getElementById("group-form-name"),
      groupFormColor: document.getElementById("group-form-color"),
      groupFormBorder: document.getElementById("group-form-border"),
      groupFormIcon: document.getElementById("group-form-icon"),
      groupFormSize: document.getElementById("group-form-size"),
      groupFormShared: document.getElementById("group-form-shared"),
      groupFormSave: document.getElementById("group-form-save"),
      groupFormCancel: document.getElementById("group-form-cancel"),
      groupTableBody: document.getElementById("group-table-body"),
    };

    loadData();
    wireWindowChrome();
    wireTabs();
    wireStoreForm();
    wireGroupForm();
    wireDrawControls();
    wireCsv();
    els.formRadius.addEventListener("input", () => {
      els.formRadiusVal.textContent = els.formRadius.value;
    });
    els.drawRadius.addEventListener("input", () => {
      els.drawRadiusVal.textContent = els.drawRadius.value;
    });

    renderGroupSelect();
    renderStoreTable();
    renderGroupTable();

    document.getElementById("header-store-btn").addEventListener("click", open);
  }

  function open() {
    els.window.classList.remove("hidden");
    els.window.classList.remove("minimized");
  }
  /** ウィンドウを隠すだけで、編集中のフォーム状態は保持する(地図で位置指定する間の一時退避用) */
  function hide() {
    els.window.classList.add("hidden");
  }
  function close() {
    hide();
    hideStoreForm();
    hideGroupForm();
  }

  function wireWindowChrome() {
    els.close.addEventListener("click", close);
    els.min.addEventListener("click", () => els.window.classList.toggle("minimized"));
  }

  function wireTabs() {
    els.tabList.addEventListener("click", () => switchTab("list"));
    els.tabGroups.addEventListener("click", () => switchTab("groups"));
  }
  function switchTab(tab) {
    els.tabList.classList.toggle("active", tab === "list");
    els.tabGroups.classList.toggle("active", tab === "groups");
    els.panelList.classList.toggle("hidden", tab !== "list");
    els.panelGroups.classList.toggle("hidden", tab !== "groups");
  }

  // ---------------- 店舗フォーム ----------------
  function wireStoreForm() {
    els.addBtn.addEventListener("click", () => showStoreForm(null));
    els.formCancel.addEventListener("click", hideStoreForm);
    els.formSave.addEventListener("click", saveStoreForm);
    els.formAddressSearch.addEventListener("click", async () => {
      const q = els.formAddress.value.trim();
      if (!q) return;
      els.formAddressSearch.disabled = true;
      try {
        const result = await AppMap.geocodeAddress(q);
        if (result) {
          els.formLat.value = result.lat.toFixed(6);
          els.formLon.value = result.lon.toFixed(6);
          pendingGeocodeSource = result.source;
          await updateLinkedAreaDisplay(result.lat, result.lon);
        } else {
          alert("該当する住所が見つかりませんでした");
        }
      } catch (err) {
        alert("検索エラー: " + err.message);
      } finally {
        els.formAddressSearch.disabled = false;
      }
    });
    els.formPickMap.addEventListener("click", () => {
      hide();
      AppMap.enableOneShotPlacement((latlng) => {
        open();
        els.formLat.value = latlng.lat.toFixed(6);
        els.formLon.value = latlng.lng.toFixed(6);
        pendingGeocodeSource = "manual";
        updateLinkedAreaDisplay(latlng.lat, latlng.lng);
      });
    });
  }

  /** 緯度経度から紐づく市区町村(レイヤ)をオフライン境界データで判定し、フォーム表示・保存用状態を更新する */
  async function updateLinkedAreaDisplay(lat, lon) {
    pendingLinkedArea = null;
    els.formArea.value = "判定中...";
    try {
      const area = await BoundaryLoader.findMunicipalityAtPoint(lat, lon);
      if (area) {
        pendingLinkedArea = { name: `${area.prefName || ""}${area.name || ""}`, code: area.code };
        els.formArea.value = pendingLinkedArea.name;
      } else {
        els.formArea.value = "該当エリアなし(範囲外)";
      }
    } catch (e) {
      els.formArea.value = "判定できませんでした";
    }
  }

  function showStoreForm(id) {
    editingStoreId = id;
    const s = id ? getStoreById(id) : null;
    renderGroupSelect();
    els.formNo.value = s?.storeNo || "";
    els.formName.value = s?.name || "";
    els.formGroup.value = s?.groupId || groups[0]?.id || "";
    els.formAddress.value = s?.address || "";
    els.formLat.value = s?.lat != null ? s.lat.toFixed(6) : "";
    els.formLon.value = s?.lon != null ? s.lon.toFixed(6) : "";
    els.formCount.value = s?.distributionCount ?? 0;
    els.formRadius.value = s?.radius ?? 500;
    els.formRadiusVal.textContent = els.formRadius.value;
    pendingLinkedArea = s?.linkedAreaName ? { name: s.linkedAreaName, code: s.linkedAreaCode } : null;
    pendingGeocodeSource = s?.geocodeSource || null;
    els.formArea.value = pendingLinkedArea?.name || "";
    els.form.classList.remove("hidden");
  }
  function hideStoreForm() {
    els.form.classList.add("hidden");
    editingStoreId = null;
    pendingLinkedArea = null;
    pendingGeocodeSource = null;
  }

  function saveStoreForm() {
    const storeNo = els.formNo.value.trim();
    const name = els.formName.value.trim();
    const lat = parseFloat(els.formLat.value);
    const lon = parseFloat(els.formLon.value);
    if (!storeNo) {
      alert("店舗番号を入力してください");
      return;
    }
    if (!name) {
      alert("店舗名を入力してください");
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      alert("緯度・経度が未設定です。住所検索または地図で位置を指定してください");
      return;
    }
    const now = new Date().toISOString();
    const fields = {
      storeNo,
      name,
      groupId: els.formGroup.value,
      address: els.formAddress.value.trim(),
      lat,
      lon,
      distributionCount: Number(els.formCount.value) || 0,
      radius: Number(els.formRadius.value) || 500,
      linkedAreaName: pendingLinkedArea?.name || null,
      linkedAreaCode: pendingLinkedArea?.code || null,
      geocodeSource: pendingGeocodeSource,
      updatedAt: now,
    };
    if (editingStoreId) {
      const s = getStoreById(editingStoreId);
      Object.assign(s, fields);
    } else {
      stores.push({ id: uid(), ...fields, createdAt: now });
    }
    persistStores();
    renderStoreTable();
    hideStoreForm();
  }

  function deleteStore(id) {
    if (!confirm("この店舗を削除しますか?")) return;
    stores = stores.filter((s) => s.id !== id);
    persistStores();
    renderStoreTable();
  }

  function renderGroupSelect() {
    els.formGroup.innerHTML = groups.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
  }

  function renderStoreTable() {
    const groupsMap = getGroupsById();
    els.tableBody.innerHTML = stores
      .map((s) => {
        const g = groupsMap.get(s.groupId);
        return `<tr>
          <td><input type="checkbox" class="store-row-check" data-id="${s.id}"></td>
          <td>${escapeHtml(s.storeNo || "-")}</td>
          <td>${escapeHtml(s.name)}</td>
          <td>${(s.distributionCount || 0).toLocaleString()}</td>
          <td>${(s.radius || 0).toLocaleString()}m</td>
          <td title="${escapeHtml(s.address || "")}">${escapeHtml(s.address || "-")}</td>
          <td>${escapeHtml(s.linkedAreaName || (s.lat != null ? "-" : "未取得"))}</td>
          <td>${fmtDate(s.updatedAt)}</td>
          <td class="actions">
            <i class="fa-solid fa-pen" data-act="edit" data-id="${s.id}" title="編集"></i>
            <i class="fa-solid fa-trash" data-act="del" data-id="${s.id}" title="削除"></i>
          </td>
        </tr>`;
      })
      .join("");

    els.tableBody.querySelectorAll('[data-act="edit"]').forEach((el) =>
      el.addEventListener("click", () => showStoreForm(el.dataset.id))
    );
    els.tableBody.querySelectorAll('[data-act="del"]').forEach((el) =>
      el.addEventListener("click", () => deleteStore(el.dataset.id))
    );
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------------- グループフォーム ----------------
  function wireGroupForm() {
    els.groupAddBtn.addEventListener("click", () => showGroupForm(null));
    els.groupFormCancel.addEventListener("click", hideGroupForm);
    els.groupFormSave.addEventListener("click", saveGroupForm);
  }

  function showGroupForm(id) {
    editingGroupId = id;
    const g = id ? groups.find((x) => x.id === id) : null;
    els.groupFormName.value = g?.name || "";
    els.groupFormColor.value = g?.color || "#d81f2a";
    els.groupFormBorder.value = g?.borderWidth ?? 2;
    els.groupFormIcon.value = g?.icon || "fa-shop";
    els.groupFormSize.value = g?.pointSize ?? 8;
    els.groupFormShared.checked = !!g?.shared;
    els.groupForm.classList.remove("hidden");
  }
  function hideGroupForm() {
    els.groupForm.classList.add("hidden");
    editingGroupId = null;
  }

  function saveGroupForm() {
    const name = els.groupFormName.value.trim();
    if (!name) {
      alert("グループ名を入力してください");
      return;
    }
    if (editingGroupId) {
      const g = groups.find((x) => x.id === editingGroupId);
      Object.assign(g, {
        name,
        color: els.groupFormColor.value,
        borderWidth: Number(els.groupFormBorder.value) || 1,
        icon: els.groupFormIcon.value,
        pointSize: Number(els.groupFormSize.value) || 8,
        shared: els.groupFormShared.checked,
      });
    } else {
      groups.push({
        id: uid(),
        name,
        color: els.groupFormColor.value,
        borderWidth: Number(els.groupFormBorder.value) || 1,
        icon: els.groupFormIcon.value,
        pointSize: Number(els.groupFormSize.value) || 8,
        shared: els.groupFormShared.checked,
      });
    }
    persistGroups();
    renderGroupTable();
    renderGroupSelect();
    renderStoreTable();
    hideGroupForm();
  }

  function deleteGroup(id) {
    if (groups.length <= 1) {
      alert("最後の1グループは削除できません");
      return;
    }
    if (!confirm("このグループを削除しますか?(所属する店舗は既定グループに移動します)")) return;
    const fallback = groups.find((g) => g.id !== id).id;
    stores.forEach((s) => {
      if (s.groupId === id) s.groupId = fallback;
    });
    groups = groups.filter((g) => g.id !== id);
    persistGroups();
    persistStores();
    renderGroupTable();
    renderGroupSelect();
    renderStoreTable();
  }

  function renderGroupTable() {
    els.groupTableBody.innerHTML = groups
      .map(
        (g) => `<tr>
          <td><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${g.color};"></span></td>
          <td>${escapeHtml(g.name)}</td>
          <td>${g.shared ? "共有" : "-"}</td>
          <td class="actions">
            <i class="fa-solid fa-pen" data-act="edit" data-id="${g.id}" title="編集"></i>
            <i class="fa-solid fa-trash" data-act="del" data-id="${g.id}" title="削除"></i>
          </td>
        </tr>`
      )
      .join("");
    els.groupTableBody.querySelectorAll('[data-act="edit"]').forEach((el) =>
      el.addEventListener("click", () => showGroupForm(el.dataset.id))
    );
    els.groupTableBody.querySelectorAll('[data-act="del"]').forEach((el) =>
      el.addEventListener("click", () => deleteGroup(el.dataset.id))
    );
  }

  // ---------------- 地図への描画 ----------------
  function wireDrawControls() {
    els.drawBtn.addEventListener("click", () => {
      const checked = Array.from(els.tableBody.querySelectorAll(".store-row-check:checked")).map((cb) => cb.dataset.id);
      if (checked.length === 0) {
        alert("描画する店舗にチェックを入れてください");
        return;
      }
      const targets = stores.filter((s) => checked.includes(s.id));
      const radiusOverride = Number(els.drawRadius.value) || undefined;
      AppMap.renderStoreCircles(targets, getGroupsById(), { radiusOverride });
      AppMap.renderStoreMarkers(targets, getGroupsById(), { showLabels: els.labelToggle.checked });
    });
    els.applyAllBtn.addEventListener("click", () => {
      AppMap.renderStoreCircles(stores, getGroupsById(), {});
      AppMap.renderStoreMarkers(stores, getGroupsById(), { showLabels: els.labelToggle.checked });
    });
    els.labelToggle.addEventListener("change", () => {
      AppMap.renderStoreMarkers(stores, getGroupsById(), { showLabels: els.labelToggle.checked });
    });
  }

  // ---------------- CSV取込・エクスポート ----------------
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 簡易CSVパーサー(ダブルクオート内のカンマ・改行に対応)。js/statsData.js のパーサーと同等の実装 */
  function parseCsvSimple(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        field = "";
        if (!(row.length === 1 && row[0] === "")) rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  /** UTF-8として妥当ならUTF-8、そうでなければShift_JISとして読む(Excel等どちらの保存形式にも対応) */
  function decodeCsvBuffer(buf) {
    let text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    if (text.includes("�")) {
      text = new TextDecoder("shift-jis", { fatal: false }).decode(buf);
    }
    return text.replace(/^﻿/, "");
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
  function tsCompact() {
    return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  }

  function wireCsv() {
    els.csvImportBtn.addEventListener("click", () => els.csvInput.click());
    els.csvInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      await importStoresFromCsv(file);
    });
    els.csvTemplateBtn.addEventListener("click", downloadCsvTemplate);
    els.csvExportBtn.addEventListener("click", exportStoresCsv);
  }

  function downloadCsvTemplate() {
    const header = ["店舗番号", "店舗名", "住所", "配布部数"];
    const example = ["1001", "千代田店", "東京都千代田区丸の内1-1-1", "3000"];
    const content = [header, example].map((r) => r.map(csvEscape).join(",")).join("\n");
    downloadCsv(content, "店舗取込フォーマット.csv");
  }

  async function importStoresFromCsv(file) {
    const buf = await file.arrayBuffer();
    const text = decodeCsvBuffer(buf);
    const rows = parseCsvSimple(text);
    if (rows.length < 2) {
      alert("CSVにデータ行がありません");
      return;
    }
    const headers = rows[0].map((h) => h.trim());
    const idxNo = headers.indexOf("店舗番号");
    const idxName = headers.indexOf("店舗名");
    const idxAddr = headers.indexOf("住所");
    const idxCount = headers.indexOf("配布部数");
    if (idxNo < 0 || idxName < 0 || idxAddr < 0) {
      alert("CSVヘッダーに「店舗番号」「店舗名」「住所」の列が必要です");
      return;
    }
    const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
    if (dataRows.length === 0) {
      alert("CSVにデータ行がありません");
      return;
    }
    if (
      !confirm(
        `${dataRows.length}件の店舗を取込みます。住所のジオコーディングのため時間がかかる場合があります。よろしいですか?`
      )
    ) {
      return;
    }

    els.csvImportBtn.disabled = true;
    els.csvImportBtn.textContent = "取込中... 0 / " + dataRows.length;
    const defaultGroupId = groups[0]?.id || "";
    let okCount = 0;
    let ngCount = 0;
    const ngRows = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const storeNo = (row[idxNo] || "").trim();
      const name = (row[idxName] || "").trim();
      const address = (row[idxAddr] || "").trim();
      const count = idxCount >= 0 ? Number(row[idxCount]) || 0 : 0;
      els.csvImportBtn.textContent = `取込中... ${i + 1} / ${dataRows.length}`;

      if (!storeNo || !name || !address) {
        ngCount++;
        ngRows.push(`${i + 2}行目: 店舗番号・店舗名・住所のいずれかが未入力です`);
        continue;
      }

      let geo = null;
      try {
        geo = await AppMap.geocodeAddress(address);
      } catch (e) {
        geo = null;
      }

      if (!geo || geo.level !== "town") {
        ngCount++;
        ngRows.push(
          `${i + 2}行目 (${storeNo} ${name}): ` +
            (geo
              ? "町字エラー(市区町村・都道府県レベルまでしか判定できなかったため除外しました)"
              : "住所からジオコーディングできませんでした")
        );
        await sleep(200);
        continue;
      }

      okCount++;
      const now = new Date().toISOString();
      const store = {
        id: uid(),
        storeNo,
        name,
        groupId: defaultGroupId,
        address,
        lat: geo.lat,
        lon: geo.lon,
        distributionCount: count,
        radius: 500,
        geocodeSource: geo.source,
        linkedAreaName: null,
        linkedAreaCode: null,
        createdAt: now,
        updatedAt: now,
      };
      try {
        const area = await BoundaryLoader.findMunicipalityAtPoint(geo.lat, geo.lon);
        if (area) {
          store.linkedAreaName = `${area.prefName || ""}${area.name || ""}`;
          store.linkedAreaCode = area.code;
        }
      } catch (e) {
        // エリア判定に失敗しても緯度経度は保持する
      }

      stores.push(store);
      await sleep(200); // 外部APIへの連続リクエストを避けるためのウェイト
    }

    persistStores();
    renderStoreTable();
    els.csvImportBtn.disabled = false;
    els.csvImportBtn.innerHTML = '<i class="fa-solid fa-file-arrow-up"></i> CSVから取込';

    let msg = `取込完了: 成功 ${okCount}件 / 町字エラー等で除外 ${ngCount}件`;
    if (ngRows.length > 0) {
      msg += "\n\n" + ngRows.slice(0, 20).join("\n");
      if (ngRows.length > 20) msg += `\n...他${ngRows.length - 20}件`;
    }
    alert(msg);
  }

  function exportStoresCsv() {
    if (stores.length === 0) {
      alert("エクスポートする店舗がありません");
      return;
    }
    const groupsMap = getGroupsById();
    const sourceLabel = { gsi: "国土地理院", nominatim: "OpenStreetMap", manual: "地図で指定" };
    const header = [
      "店舗番号",
      "店舗名",
      "グループ",
      "住所",
      "緯度",
      "経度",
      "配布部数",
      "半径(m)",
      "紐づいたエリア",
      "ジオコーディング方式",
      "更新日時",
    ];
    const lines = [header.map(csvEscape).join(",")];
    stores.forEach((s) => {
      const g = groupsMap.get(s.groupId);
      const cells = [
        s.storeNo || "",
        s.name || "",
        g?.name || "",
        s.address || "",
        s.lat != null ? s.lat : "",
        s.lon != null ? s.lon : "",
        s.distributionCount || 0,
        s.radius || 0,
        s.linkedAreaName || "",
        s.geocodeSource ? sourceLabel[s.geocodeSource] || s.geocodeSource : "未取得",
        fmtDate(s.updatedAt),
      ];
      lines.push(cells.map(csvEscape).join(","));
    });
    downloadCsv(lines.join("\n"), `店舗一覧_${tsCompact()}.csv`);
  }

  return {
    init,
    open,
    close,
    getStores,
    getGroups,
    getGroupsById,
    getStoreById,
  };
})();
