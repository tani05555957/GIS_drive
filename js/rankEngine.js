/**
 * 「条件を選択」で選ばれた指標カテゴリから、ポリゴンのランキング色分けを計算するモジュール。
 *
 * カテゴリ(年代・世帯人数・世帯類型など)単位を「軸」として扱う:
 * - 選択された軸が1つ  → その比率で5段階色分け(既存のランク配色)
 * - 選択された軸が2つ  → 2軸それぞれを3段階(低/中/高)に分け、3×3のバイバリエート配色
 * - 選択された軸が3つ以上 → 各軸の比率を標準化(z-score)して合計し、1つの合成スコアとして5段階色分け
 */
const RankEngine = (() => {
  /** カテゴリ内の選択肢合計/分母比率を、表示中featureごとに算出する */
  function buildRatioMap(features, category, selectedKeys) {
    const map = new Map();
    features.forEach((f) => {
      const key = f.properties?.KEY_CODE;
      if (!key) return;
      const record = StatsData.getRecord(key);
      const ratio = StatsData.getCategoryRatio(record, category, selectedKeys);
      if (ratio != null) map.set(key, ratio);
    });
    return map;
  }

  function standardize(valueMap) {
    const values = Array.from(valueMap.values());
    const n = values.length;
    const z = new Map();
    if (n === 0) return z;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
    const sd = Math.sqrt(variance);
    valueMap.forEach((v, k) => z.set(k, sd === 0 ? 0 : (v - mean) / sd));
    return z;
  }

  function compute(features, selections, categories) {
    const activeCats = categories.filter((cat) => (selections[cat.key] || []).length > 0);

    if (activeCats.length === 0) {
      return { mode: "none", colorByKeyCode: new Map() };
    }

    if (activeCats.length === 1) {
      const cat = activeCats[0];
      const valueMap = buildRatioMap(features, cat, selections[cat.key]);
      const { breaks, rankOf } = DataStore.classifyByQuantile(valueMap, RANK_COLORS.length);
      const colorByKeyCode = new Map();
      valueMap.forEach((v, key) => {
        const rank = rankOf(v);
        if (rank >= 0) colorByKeyCode.set(key, RANK_COLORS[rank]);
      });
      return {
        mode: "single",
        colorByKeyCode,
        legend: { breaks, colors: RANK_COLORS, unitLabel: `${cat.label}比率`, catLabel: cat.label, format: "percent" },
      };
    }

    if (activeCats.length === 2) {
      const [catA, catB] = activeCats;
      const valueMapA = buildRatioMap(features, catA, selections[catA.key]);
      const valueMapB = buildRatioMap(features, catB, selections[catB.key]);
      const { rankOf: rankOfA } = DataStore.classifyByQuantile(valueMapA, 3);
      const { rankOf: rankOfB } = DataStore.classifyByQuantile(valueMapB, 3);

      const colorByKeyCode = new Map();
      // セル(軸A段階×軸B段階)ごとの統計上世帯数の合計 → 商圏内世帯数に占める割合(%)を求める
      const cellWeight = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      let totalWeight = 0;
      features.forEach((f) => {
        const key = f.properties?.KEY_CODE;
        if (!key || !valueMapA.has(key) || !valueMapB.has(key)) return;
        const rA = rankOfA(valueMapA.get(key));
        const rB = rankOfB(valueMapB.get(key));
        if (rA < 0 || rB < 0) return;
        colorByKeyCode.set(key, BIVARIATE_COLORS[rA][rB]);

        const weight = StatsData.getRecord(key)?.statHouseholds || 0;
        cellWeight[rA][rB] += weight;
        totalWeight += weight;
      });
      const cellPercent = cellWeight.map((row) => row.map((w) => (totalWeight ? (w / totalWeight) * 100 : 0)));

      return {
        mode: "bivariate",
        colorByKeyCode,
        legend: { catALabel: catA.label, catBLabel: catB.label, colors: BIVARIATE_COLORS, cellPercent },
      };
    }

    // 3軸以上: 各軸の比率を標準化して合計 → 1つの合成スコアとして5段階色分け
    const zMaps = activeCats.map((cat) => standardize(buildRatioMap(features, cat, selections[cat.key])));
    const compositeMap = new Map();
    features.forEach((f) => {
      const key = f.properties?.KEY_CODE;
      if (!key) return;
      if (!zMaps.every((zm) => zm.has(key))) return;
      const sum = zMaps.reduce((s, zm) => s + zm.get(key), 0);
      compositeMap.set(key, sum);
    });
    // classifyByQuantile は 0 以下を「対象外」として扱うため、合成スコアを正の範囲にシフトする
    const shift = compositeMap.size ? Math.abs(Math.min(0, ...compositeMap.values())) + 1e-6 : 0;
    const shiftedMap = new Map();
    compositeMap.forEach((v, k) => shiftedMap.set(k, v + shift));

    const { breaks, rankOf } = DataStore.classifyByQuantile(shiftedMap, RANK_COLORS.length);
    const colorByKeyCode = new Map();
    shiftedMap.forEach((v, key) => {
      const rank = rankOf(v);
      if (rank >= 0) colorByKeyCode.set(key, RANK_COLORS[rank]);
    });

    return {
      mode: "composite",
      colorByKeyCode,
      legend: {
        breaks: breaks.map((b) => b - shift),
        colors: RANK_COLORS,
        unitLabel: `標準化スコア合計(${activeCats.length}軸)`,
        catLabels: activeCats.map((c) => c.label),
        format: "decimal",
      },
    };
  }

  return { compute };
})();
