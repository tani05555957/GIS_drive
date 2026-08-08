/**
 * 属性統計データ(性別年代・婚姻・家族構成など)の保持・集計を担当するモジュール。
 *
 * 世帯数の基礎値・ジオメトリは boundaries/ の町丁目・字境界データ(properties.SETAI, KEY_CODE)から
 * 直接得られるため、このモジュールが保持するのは KEY_CODE(9桁の町丁目・字コード)をキーにした
 * 属性内訳(セグメント)テーブルのみ。左パネルの「属性データ読み込み」から差し替える。
 *
 * 期待するJSON形式(配列。boundaries側の "KEY_CODE" と一致させること):
 * [
 *   {
 *     "key_code": "011010200",
 *     "population": 320,                 // 任意。無ければ人口集計は0のまま
 *     "segments": {
 *       "sexage":  { "male_20s": 12, "female_20s": 10, ... },
 *       "marriage":{ "single": 40, "married": 60 },
 *       ...  // SEGMENT_CONFIG のカテゴリ・選択肢キーと対応させる
 *     }
 *   },
 *   ...
 * ]
 */
const DataStore = (() => {
  let segmentByKeyCode = new Map();

  function loadSegmentTable(records) {
    if (!Array.isArray(records)) {
      throw new Error("配列形式のJSONではありません");
    }
    const map = new Map();
    records.forEach((r) => {
      if (r && r.key_code) map.set(String(r.key_code), r);
    });
    segmentByKeyCode = map;
    return segmentByKeyCode.size;
  }

  function hasSegmentData() {
    return segmentByKeyCode.size > 0;
  }

  /** 境界データ側(SETAI)から世帯数を取得 */
  function getHouseholds(feature) {
    return Number(feature.properties?.SETAI) || 0;
  }

  function categoryTotal(record, categoryKey) {
    const seg = record?.segments?.[categoryKey];
    if (!seg) return 0;
    return Object.values(seg).reduce((a, b) => a + (Number(b) || 0), 0);
  }

  /**
   * 選択された条件(selections: { categoryKey: [optionKey, ...] })に基づき、
   * この Feature(町丁目・字)の世帯数推定値を返す。
   * 各カテゴリの「選択肢合計 / カテゴリ全体合計」比率を独立事象とみなして掛け合わせる近似計算。
   * 属性データが読み込まれていない、またはそのカテゴリで何も選択していない場合は
   * そのカテゴリを比率1として無視する(=世帯数の絞り込みを行わない)。
   */
  function estimateHouseholds(feature, selections) {
    const baseHouseholds = getHouseholds(feature);
    if (baseHouseholds === 0) return 0;

    const record = segmentByKeyCode.get(feature.properties?.KEY_CODE);
    let ratio = 1;
    for (const categoryKey of Object.keys(selections || {})) {
      const selectedKeys = selections[categoryKey];
      if (!selectedKeys || selectedKeys.length === 0) continue;
      if (!record) continue;

      const seg = record.segments?.[categoryKey];
      const total = categoryTotal(record, categoryKey);
      if (!seg || total === 0) continue;

      const selectedSum = selectedKeys.reduce((sum, k) => sum + (Number(seg[k]) || 0), 0);
      ratio *= selectedSum / total;
    }
    return baseHouseholds * ratio;
  }

  function estimatePopulation(feature, selections) {
    const record = segmentByKeyCode.get(feature.properties?.KEY_CODE);
    const basePopulation = Number(record?.population) || 0;
    const baseHouseholds = getHouseholds(feature);
    if (basePopulation === 0 || baseHouseholds === 0) return 0;
    const filteredHouseholds = estimateHouseholds(feature, selections);
    return basePopulation * (filteredHouseholds / baseHouseholds);
  }

  /** 分位(quantile)ベースでランク分けし、値からランク index (0..n-1) を求める関数を返す */
  function classifyByQuantile(valueMap, rankCount) {
    const values = Array.from(valueMap.values()).filter((v) => v > 0).sort((a, b) => a - b);
    if (values.length === 0) return { breaks: [], rankOf: () => -1 };

    const breaks = [];
    for (let i = 1; i < rankCount; i++) {
      const idx = Math.floor((values.length * i) / rankCount);
      breaks.push(values[Math.min(idx, values.length - 1)]);
    }

    function rankOf(v) {
      if (v <= 0) return -1;
      for (let i = 0; i < breaks.length; i++) {
        if (v <= breaks[i]) return i;
      }
      return rankCount - 1;
    }

    return { breaks, rankOf };
  }

  /**
   * 配達プランウィザードの「指標」表示用。categoryKey "census" は population/households を
   * 特別扱いし、それ以外は record.segments[categoryKey][leafKey] を返す。
   * 対応するデータが無い場合は null(=データ未提供)を返す。
   */
  function getIndicatorValue(feature, categoryKey, leafKey) {
    if (categoryKey === "census") {
      if (leafKey === "households") return getHouseholds(feature);
      if (leafKey === "population") {
        const record = segmentByKeyCode.get(feature.properties?.KEY_CODE);
        return record && record.population != null ? Number(record.population) : null;
      }
      return null;
    }
    const record = segmentByKeyCode.get(feature.properties?.KEY_CODE);
    const seg = record?.segments?.[categoryKey];
    if (!seg || seg[leafKey] === undefined) return null;
    return Number(seg[leafKey]) || 0;
  }

  return {
    loadSegmentTable,
    hasSegmentData,
    getHouseholds,
    estimateHouseholds,
    estimatePopulation,
    classifyByQuantile,
    getIndicatorValue,
  };
})();
