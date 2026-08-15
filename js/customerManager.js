/**
 * 顧客データ管理機能。
 * CSV(顧客番号(任意)・郵便番号(任意)・住所(任意))を取り込み、郵便番号または住所を
 * ジオコーディングして緯度経度・紐づけレベル(町字/市区町村/都道府県/取得失敗)を付与し localStorage に保存する。
 * 顧客番号が空の行には 10000001 から始まる連番のユニークコードを自動付与する。
 * 市区町村・都道府県レベルまでしか判定できなかった住所は町字エラーとして取込対象から除外する
 * (js/storeManager.js の店舗CSV取込と同じ方針)。
 */
const CustomerManager = (() => {
  const CUSTOMERS_KEY = "gd_customers_v1";
  const NEXT_CODE_KEY = "gd_customers_next_code_v1";
  const START_CODE = 10000001;

  const LEVEL_LABEL = { town: "町字", city: "市区町村(エラー)", prefecture: "都道府県(エラー)", none: "未取得" };

  let customers = [];
  let nextCode = START_CODE;
  let els = {};

  function uid() {
    return "id_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function loadData() {
    try {
      customers = JSON.parse(localStorage.getItem(CUSTOMERS_KEY) || "[]");
    } catch (e) {
      customers = [];
    }
    const storedNext = Number(localStorage.getItem(NEXT_CODE_KEY));
    nextCode = Number.isFinite(storedNext) && storedNext >= START_CODE ? storedNext : START_CODE;
  }
  function persistCustomers() {
    localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customers));
  }
  function persistNextCode() {
    localStorage.setItem(NEXT_CODE_KEY, String(nextCode));
  }

  /** 顧客番号が未入力の行に付与する連番ユニークコード(10000001から)。二度と重複しないよう永続化する */
  function assignUniqueCode() {
    const code = String(nextCode);
    nextCode++;
    persistNextCode();
    return code;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(
      d.getHours()
    ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function tsCompact() {
    return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  }

  // ---------------- 初期化・DOM ----------------
  function init() {
    els = {
      window: document.getElementById("customer-mgr-window"),
      min: document.getElementById("customer-mgr-min"),
      close: document.getElementById("customer-mgr-close"),
      csvImportBtn: document.getElementById("customer-csv-import-btn"),
      csvExportBtn: document.getElementById("customer-csv-export-btn"),
      csvTemplateBtn: document.getElementById("customer-csv-template-btn"),
      csvInput: document.getElementById("customer-csv-input"),
      tableBody: document.getElementById("customer-table-body"),
      summary: document.getElementById("customer-summary"),
    };

    loadData();
    wireWindowChrome();
    wireCsv();
    renderTable();

    document.getElementById("header-customer-btn").addEventListener("click", open);
  }

  function open() {
    els.window.classList.remove("hidden");
    els.window.classList.remove("minimized");
  }
  function hide() {
    els.window.classList.add("hidden");
  }
  function wireWindowChrome() {
    els.close.addEventListener("click", hide);
    els.min.addEventListener("click", () => els.window.classList.toggle("minimized"));
  }

  function renderTable() {
    els.summary.textContent = `${customers.length.toLocaleString()} 件`;
    els.tableBody.innerHTML = customers
      .map(
        (c) => `<tr>
          <td>${escapeHtml(c.customerNo)}</td>
          <td>${escapeHtml(c.postalCode || "-")}</td>
          <td title="${escapeHtml(c.address || "")}">${escapeHtml(c.address || "-")}</td>
          <td>${LEVEL_LABEL[c.matchLevel] || "未取得"}</td>
          <td>${fmtDate(c.updatedAt)}</td>
          <td class="actions"><i class="fa-solid fa-trash" data-id="${c.id}" title="削除"></i></td>
        </tr>`
      )
      .join("");
    els.tableBody.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => deleteCustomer(el.dataset.id)));
  }

  function deleteCustomer(id) {
    if (!confirm("この顧客データを削除しますか?")) return;
    customers = customers.filter((c) => c.id !== id);
    persistCustomers();
    renderTable();
  }

  // ---------------- CSV取込・エクスポート(js/storeManager.js と同等のパーサー/エンコーディング処理) ----------------
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

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

  function wireCsv() {
    els.csvImportBtn.addEventListener("click", () => els.csvInput.click());
    els.csvInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      await importCustomersFromCsv(file);
    });
    els.csvTemplateBtn.addEventListener("click", downloadCsvTemplate);
    els.csvExportBtn.addEventListener("click", exportCustomersCsv);
  }

  function downloadCsvTemplate() {
    const header = ["顧客番号", "郵便番号", "住所"];
    const example = ["", "100-0005", "東京都千代田区丸の内1-1-1"];
    const content = [header, example].map((r) => r.map(csvEscape).join(",")).join("\n");
    downloadCsv(content, "顧客データ取込フォーマット.csv");
  }

  async function importCustomersFromCsv(file) {
    const buf = await file.arrayBuffer();
    const text = decodeCsvBuffer(buf);
    const rows = parseCsvSimple(text);
    if (rows.length < 2) {
      alert("CSVにデータ行がありません");
      return;
    }
    const headers = rows[0].map((h) => h.trim());
    const idxNo = headers.indexOf("顧客番号");
    const idxPostal = headers.indexOf("郵便番号");
    const idxAddr = headers.indexOf("住所");
    if (idxNo < 0 && idxPostal < 0 && idxAddr < 0) {
      alert("CSVヘッダーに「顧客番号」「郵便番号」「住所」のいずれかの列が必要です");
      return;
    }
    const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
    if (dataRows.length === 0) {
      alert("CSVにデータ行がありません");
      return;
    }
    if (
      !confirm(`${dataRows.length}件の顧客データを取込みます。ジオコーディングのため時間がかかる場合があります。よろしいですか?`)
    ) {
      return;
    }

    els.csvImportBtn.disabled = true;
    els.csvImportBtn.textContent = "取込中... 0 / " + dataRows.length;
    let okCount = 0;
    let geoErrorCount = 0;
    let skipCount = 0;
    const ngRows = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rawNo = idxNo >= 0 ? (row[idxNo] || "").trim() : "";
      const postalCode = idxPostal >= 0 ? (row[idxPostal] || "").trim() : "";
      const address = idxAddr >= 0 ? (row[idxAddr] || "").trim() : "";
      els.csvImportBtn.textContent = `取込中... ${i + 1} / ${dataRows.length}`;

      if (!rawNo && !postalCode && !address) {
        skipCount++;
        continue;
      }

      const customerNo = rawNo || assignUniqueCode();
      const now = new Date().toISOString();
      const customer = {
        id: uid(),
        customerNo,
        postalCode,
        address,
        lat: null,
        lon: null,
        geocodeSource: null,
        matchLevel: "none",
        linkedAreaName: null,
        linkedAreaCode: null,
        createdAt: now,
        updatedAt: now,
      };

      const query = address || postalCode;
      if (query) {
        let geo = null;
        try {
          geo = await AppMap.geocodeAddress(query);
        } catch (e) {
          geo = null;
        }
        if (geo && geo.level === "town") {
          customer.lat = geo.lat;
          customer.lon = geo.lon;
          customer.geocodeSource = geo.source;
          customer.matchLevel = "town";
          try {
            const area = await BoundaryLoader.findMunicipalityAtPoint(geo.lat, geo.lon);
            if (area) {
              customer.linkedAreaName = `${area.prefName || ""}${area.name || ""}`;
              customer.linkedAreaCode = area.code;
            }
          } catch (e) {
            // エリア判定に失敗しても緯度経度は保持する
          }
          okCount++;
        } else {
          geoErrorCount++;
          customer.matchLevel = geo ? geo.level : "none";
          ngRows.push(
            `${i + 2}行目 (${customerNo}): ` +
              (geo ? "町字エラー(市区町村・都道府県レベルまでしか判定できませんでした)" : "ジオコーディングできませんでした")
          );
        }
        await sleep(200); // 外部APIへの連続リクエストを避けるためのウェイト
      } else {
        okCount++; // 郵便番号・住所なし(顧客番号のみ)は正常に取込む
      }

      customers.push(customer);
    }

    persistCustomers();
    renderTable();
    els.csvImportBtn.disabled = false;
    els.csvImportBtn.innerHTML = '<i class="fa-solid fa-file-arrow-up"></i> CSVから取込';

    let msg = `取込完了: 成功 ${okCount}件 / 町字エラー等で読み込めなかった件数 ${geoErrorCount}件`;
    if (skipCount > 0) msg += ` / 全項目未入力のためスキップ ${skipCount}件`;
    if (ngRows.length > 0) {
      msg += "\n\n" + ngRows.slice(0, 20).join("\n");
      if (ngRows.length > 20) msg += `\n...他${ngRows.length - 20}件`;
    }
    alert(msg);
  }

  function exportCustomersCsv() {
    if (customers.length === 0) {
      alert("エクスポートする顧客データがありません");
      return;
    }
    const sourceLabel = { gsi: "国土地理院", nominatim: "OpenStreetMap" };
    const header = ["顧客番号", "郵便番号", "住所", "緯度", "経度", "紐づけレベル", "紐づいたエリア", "ジオコーディング方式", "更新日時"];
    const lines = [header.map(csvEscape).join(",")];
    customers.forEach((c) => {
      const cells = [
        c.customerNo,
        c.postalCode || "",
        c.address || "",
        c.lat != null ? c.lat : "",
        c.lon != null ? c.lon : "",
        LEVEL_LABEL[c.matchLevel] || "未取得",
        c.linkedAreaName || "",
        c.geocodeSource ? sourceLabel[c.geocodeSource] || c.geocodeSource : "",
        fmtDate(c.updatedAt),
      ];
      lines.push(cells.map(csvEscape).join(","));
    });
    downloadCsv(lines.join("\n"), `顧客データ_${tsCompact()}.csv`);
  }

  return {
    init,
    open,
    getCustomers: () => customers,
  };
})();
