/**
 * 統計データCSV(統計データ/*.csv、Shift_JIS)の読み込み・解析・KEY_CODEインデックス化を担当するモジュール。
 * js/statsConfig.js の STAT_CATEGORIES / STAT_BASE_COLUMNS を使って列位置を特定する。
 *
 * boundaries/ 側の KEY_CODE(住所コード)と、CSVの「KEY_CODE_住所コード」列が一致する前提。
 */
const StatsData = (() => {
  let recordsByKeyCode = new Map();
  let loaded = false;
  let loadError = null;

  /** 簡易CSVパーサー(ダブルクオート内のカンマ・改行に対応) */
  function parseCsv(text) {
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

  function findColumnIndex(headers, prefix) {
    return headers.findIndex((h) => h.startsWith(prefix));
  }

  function buildColumnIndex(headers) {
    const idx = {
      keyCode: findColumnIndex(headers, STAT_BASE_COLUMNS.keyCode),
      statHouseholds: findColumnIndex(headers, STAT_BASE_COLUMNS.statHouseholds),
      deliverable: findColumnIndex(headers, STAT_BASE_COLUMNS.deliverable),
      population: findColumnIndex(headers, STAT_BASE_COLUMNS.population),
      options: new Map(), // optionKey -> column index
    };
    STAT_CATEGORIES.forEach((cat) => {
      cat.options.forEach((opt) => {
        idx.options.set(opt.key, findColumnIndex(headers, opt.header));
      });
    });
    return idx;
  }

  function toNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function buildRecords(rows, colIndex) {
    const map = new Map();
    if (colIndex.keyCode < 0) return map;
    rows.forEach((row) => {
      const keyCode = row[colIndex.keyCode];
      if (!keyCode) return;
      const values = {};
      colIndex.options.forEach((colIdx, optKey) => {
        values[optKey] = colIdx >= 0 ? toNumber(row[colIdx]) : 0;
      });
      map.set(keyCode, {
        keyCode,
        statHouseholds: colIndex.statHouseholds >= 0 ? toNumber(row[colIndex.statHouseholds]) : 0,
        deliverable: colIndex.deliverable >= 0 ? toNumber(row[colIndex.deliverable]) : 0,
        population: colIndex.population >= 0 ? toNumber(row[colIndex.population]) : 0,
        values,
      });
    });
    return map;
  }

  function loadFromText(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error("CSVにデータ行がありません");
    const headers = rows[0];
    const colIndex = buildColumnIndex(headers);
    if (colIndex.keyCode < 0) throw new Error("KEY_CODE列が見つかりません");
    recordsByKeyCode = buildRecords(rows.slice(1), colIndex);
    loaded = true;
    loadError = null;
    return recordsByKeyCode.size;
  }

  async function loadFromUrl(url) {
    try {
      const res = await fetch(encodeURI(url));
      if (!res.ok) throw new Error(`統計データの取得に失敗しました(${res.status})`);
      const buf = await res.arrayBuffer();
      const text = new TextDecoder("shift-jis").decode(buf);
      const count = loadFromText(text);
      return count;
    } catch (err) {
      loadError = err;
      loaded = false;
      throw err;
    }
  }

  /** ユーザーがCSVファイルを差し替えた場合(File API)の読み込み */
  function loadFromArrayBuffer(buf) {
    const text = new TextDecoder("shift-jis").decode(buf);
    return loadFromText(text);
  }

  function isLoaded() {
    return loaded;
  }
  function getLoadError() {
    return loadError;
  }
  function getRecordCount() {
    return recordsByKeyCode.size;
  }
  function getRecord(keyCode) {
    return keyCode ? recordsByKeyCode.get(keyCode) : undefined;
  }
  function getCategories() {
    return STAT_CATEGORIES;
  }

  /** カテゴリの分母(base)値を取得する(population=人口総数 / households=統計上世帯数) */
  function getCategoryBase(record, category) {
    if (!record) return 0;
    return category.base === "population" ? record.population : record.statHouseholds;
  }

  /**
   * カテゴリ内で選択された選択肢の合計を分母で割った比率を返す。
   * 選択肢が無い、または分母が0の場合は null(計算不能)。
   */
  function getCategoryRatio(record, category, selectedOptionKeys) {
    if (!record || !selectedOptionKeys || selectedOptionKeys.length === 0) return null;
    const base = getCategoryBase(record, category);
    if (!base) return null;
    const sum = selectedOptionKeys.reduce((s, k) => s + (record.values[k] || 0), 0);
    return sum / base;
  }

  return {
    loadFromUrl,
    loadFromArrayBuffer,
    isLoaded,
    getLoadError,
    getRecordCount,
    getRecord,
    getCategories,
    getCategoryBase,
    getCategoryRatio,
  };
})();
