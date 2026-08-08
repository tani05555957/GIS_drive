/**
 * デモ用のダミー属性データ(千代田区の実在する町丁目コードに対する疑似セグメント内訳)。
 * 起動直後の地図中心(東京駅周辺)にある実際の boundaries/13/13101.geojson の町丁目と
 * KEY_CODE で対応しており、「条件を選択」機能をすぐに試せるようにするためのサンプル。
 *
 * 実データが提供されたら、左パネルの「属性データ読み込み」から差し替えてください。
 * スキーマは js/dataStore.js 冒頭のコメントを参照。
 */
const SAMPLE_SEGMENT_TABLE = (() => {
  // [key_code, S_NAME(参考), SETAI(実際の境界データの世帯数と合わせてある)]
  const AREAS = [
    ["131010560", "三番町", 1710],
    ["131010110", "一番町", 1697],
    ["13101018002", "富士見二丁目", 1628],
    ["13101041002", "岩本町二丁目", 1386],
    ["131010570", "四番町", 1188],
    ["13101046001", "東神田一丁目", 1037],
    ["13101021001", "神田神保町一丁目", 950],
    ["13101019002", "飯田橋二丁目", 812],
    ["131010550", "二番町", 770],
    ["13101021002", "神田神保町二丁目", 763],
    ["13101046002", "東神田二丁目", 757],
    ["13101017001", "九段北一丁目", 732],
    ["13101034002", "外神田二丁目", 724],
    ["131010310", "神田多町", 704],
    ["13101033001", "神田須田町一丁目", 704],
    ["131010590", "六番町", 670],
    ["13101008001", "平河町一丁目", 610],
    ["13101041001", "岩本町一丁目", 585],
    ["13101032002", "神田淡路町二丁目", 540],
    ["13101016004", "九段南四丁目", 539],
  ];

  const sexageKeys = ["male_10s","male_20s","male_30s","male_40s","male_50s","male_60over","female_10s","female_20s","female_30s","female_40s","female_50s","female_60over"];
  const marriageKeys = ["single","married"];
  const familyKeys = ["single_person","couple","couple_with_child","single_parent","three_gen"];
  const housingKeys = ["owned_house","owned_apartment","rented_house","rented_apartment"];
  const incomeKeys = ["under300","300_500","500_800","800_1000","over1000"];
  const savingKeys = ["under100","100_500","500_1000","over1000"];

  // 簡易な疑似乱数(実行ごとに同じ結果になるよう seed 固定)
  let seed = 42;
  function rand() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  function distributeTotal(total, keys) {
    const weights = keys.map(() => rand() + 0.2);
    const wsum = weights.reduce((a, b) => a + b, 0);
    const dist = {};
    keys.forEach((k, i) => (dist[k] = Math.round((weights[i] / wsum) * total)));
    return dist;
  }

  return AREAS.map(([key_code, , setai]) => ({
    key_code,
    population: Math.round(setai * (1.6 + rand() * 0.8)),
    segments: {
      sexage: distributeTotal(setai, sexageKeys),
      marriage: distributeTotal(setai, marriageKeys),
      family: distributeTotal(setai, familyKeys),
      housing: distributeTotal(setai, housingKeys),
      income: distributeTotal(setai, incomeKeys),
      saving: distributeTotal(setai, savingKeys),
    },
  }));
})();
