/**
 * セグメント条件(属性)定義。
 * 実際の統計データを読み込む際は、各 Feature の properties.segments 以下に
 * ここで定義した category / option の key と同じ構造で件数を持たせてください。
 *
 * 例: properties.segments.sexage.male_30s = 123
 *
 * 実データのカテゴリ構成が異なる場合は、このファイルを合わせて編集すれば
 * UI・集計ロジックともに自動的に追従します。
 */
const SEGMENT_CONFIG = [
  {
    key: "sexage",
    label: "性別・年代",
    options: [
      { key: "male_10s", label: "男性 10代" },
      { key: "male_20s", label: "男性 20代" },
      { key: "male_30s", label: "男性 30代" },
      { key: "male_40s", label: "男性 40代" },
      { key: "male_50s", label: "男性 50代" },
      { key: "male_60over", label: "男性 60代以上" },
      { key: "female_10s", label: "女性 10代" },
      { key: "female_20s", label: "女性 20代" },
      { key: "female_30s", label: "女性 30代" },
      { key: "female_40s", label: "女性 40代" },
      { key: "female_50s", label: "女性 50代" },
      { key: "female_60over", label: "女性 60代以上" },
    ],
  },
  {
    key: "marriage",
    label: "婚姻",
    options: [
      { key: "single", label: "未婚" },
      { key: "married", label: "既婚" },
    ],
  },
  {
    key: "family",
    label: "家族構成",
    options: [
      { key: "single_person", label: "単身世帯" },
      { key: "couple", label: "夫婦のみ" },
      { key: "couple_with_child", label: "夫婦+子" },
      { key: "single_parent", label: "ひとり親+子" },
      { key: "three_gen", label: "三世代" },
    ],
  },
  {
    key: "housing",
    label: "住居形態",
    options: [
      { key: "owned_house", label: "持家(戸建)" },
      { key: "owned_apartment", label: "持家(集合)" },
      { key: "rented_house", label: "賃貸(戸建)" },
      { key: "rented_apartment", label: "賃貸(集合)" },
    ],
  },
  {
    key: "income",
    label: "世帯年収",
    options: [
      { key: "under300", label: "300万円未満" },
      { key: "300_500", label: "300〜500万円" },
      { key: "500_800", label: "500〜800万円" },
      { key: "800_1000", label: "800〜1000万円" },
      { key: "over1000", label: "1000万円以上" },
    ],
  },
  {
    key: "saving",
    label: "貯蓄額",
    options: [
      { key: "under100", label: "100万円未満" },
      { key: "100_500", label: "100〜500万円" },
      { key: "500_1000", label: "500〜1000万円" },
      { key: "over1000", label: "1000万円以上" },
    ],
  },
];

/** 移動手段ごとの想定速度 (km/h) — 所要時間モードの近似円計算に使用 */
const TRAVEL_SPEED_KMH = {
  walk: 4.8,
  bike: 15,
  car: 30,
};

/** ランク(色分け)段階数と配色 */
const RANK_COLORS = ["#e8f0fe", "#aecbfa", "#669df6", "#4285f4", "#1a56d6"];
