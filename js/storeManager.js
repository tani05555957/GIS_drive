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
      formName: document.getElementById("store-form-name"),
      formGroup: document.getElementById("store-form-group"),
      formAddress: document.getElementById("store-form-address"),
      formAddressSearch: document.getElementById("store-form-address-search"),
      formPickMap: document.getElementById("store-form-pick-map"),
      formLat: document.getElementById("store-form-lat"),
      formLon: document.getElementById("store-form-lon"),
      formCount: document.getElementById("store-form-count"),
      formRadius: document.getElementById("store-form-radius"),
      formSave: document.getElementById("store-form-save"),
      formCancel: document.getElementById("store-form-cancel"),
      tableBody: document.getElementById("store-table-body"),

      drawRadius: document.getElementById("store-draw-radius"),
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
        const results = await AppMap.geocodeSearch(q);
        if (results.length > 0) {
          els.formLat.value = results[0].lat.toFixed(6);
          els.formLon.value = results[0].lon.toFixed(6);
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
      });
    });
  }

  function showStoreForm(id) {
    editingStoreId = id;
    const s = id ? getStoreById(id) : null;
    renderGroupSelect();
    els.formName.value = s?.name || "";
    els.formGroup.value = s?.groupId || groups[0]?.id || "";
    els.formAddress.value = s?.address || "";
    els.formLat.value = s?.lat != null ? s.lat.toFixed(6) : "";
    els.formLon.value = s?.lon != null ? s.lon.toFixed(6) : "";
    els.formCount.value = s?.distributionCount ?? 0;
    els.formRadius.value = s?.radius ?? 500;
    els.form.classList.remove("hidden");
  }
  function hideStoreForm() {
    els.form.classList.add("hidden");
    editingStoreId = null;
  }

  function saveStoreForm() {
    const name = els.formName.value.trim();
    const lat = parseFloat(els.formLat.value);
    const lon = parseFloat(els.formLon.value);
    if (!name) {
      alert("店舗名を入力してください");
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      alert("緯度・経度が未設定です。住所検索または地図で位置を指定してください");
      return;
    }
    const now = new Date().toISOString();
    if (editingStoreId) {
      const s = getStoreById(editingStoreId);
      Object.assign(s, {
        name,
        groupId: els.formGroup.value,
        address: els.formAddress.value.trim(),
        lat,
        lon,
        distributionCount: Number(els.formCount.value) || 0,
        radius: Number(els.formRadius.value) || 500,
        updatedAt: now,
      });
    } else {
      stores.push({
        id: uid(),
        name,
        groupId: els.formGroup.value,
        address: els.formAddress.value.trim(),
        lat,
        lon,
        distributionCount: Number(els.formCount.value) || 0,
        radius: Number(els.formRadius.value) || 500,
        createdAt: now,
        updatedAt: now,
      });
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
          <td>${escapeHtml(s.name)}</td>
          <td>${(s.distributionCount || 0).toLocaleString()}</td>
          <td>${(s.radius || 0).toLocaleString()}m</td>
          <td title="${escapeHtml(s.address || "")}">${escapeHtml(s.address || "-")}</td>
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
