/**
 * 統計データ(統計データ/*.csv)の指標カテゴリ定義。
 *
 * CSVの列は「KEY_CODE_住所コード」等の基礎列に続き、人口(20歳未満)以降に
 * 37個の実数値指標列が並ぶ(国勢調査・推計年収・推計貯蓄・自動車保有など)。
 * ここではそれらを意味のまとまり(カテゴリ)ごとにグルーピングし、
 * 「条件を選択」パネルのチェックボックスと、割合計算の分母(base)を定義する。
 *
 * base: "population" → カテゴリ内の選択肢合計を人口総数で割る(年代など)
 *       "households" → カテゴリ内の選択肢合計を統計上世帯数で割る(それ以外すべて)
 *
 * header は js/statsData.js がCSVヘッダー行から列位置を特定するための前方一致キー。
 * 実データのCSVで列名や並び順が変わっても、この前方一致文字列さえ含まれていれば
 * 自動的に対応する列を検出する。
 */
const STAT_CATEGORIES = [
  {
    key: "age",
    label: "年代",
    base: "population",
    options: [
      { key: "under20", label: "20歳未満", header: "人口（20歳未満）" },
      { key: "age20s", label: "20代", header: "人口（20代）" },
      { key: "age30s", label: "30代", header: "人口（30代）" },
      { key: "age40s", label: "40代", header: "人口（40代）" },
      { key: "age50s", label: "50代", header: "人口（50代）" },
      { key: "age60s", label: "60代", header: "人口（60代）" },
      { key: "age70over", label: "70歳以上", header: "人口（70歳以上）" },
    ],
  },
  {
    key: "household_size",
    label: "世帯人数",
    base: "households",
    options: [
      { key: "hh1", label: "1人世帯", header: "1人世帯" },
      { key: "hh2", label: "2人世帯", header: "2人世帯" },
      { key: "hh3", label: "3人世帯", header: "3人世帯" },
      { key: "hh4", label: "4人世帯", header: "4人世帯" },
      { key: "hh5plus", label: "5人以上世帯", header: "5人以上世帯" },
    ],
  },
  {
    key: "family_type",
    label: "世帯類型",
    base: "households",
    options: [
      { key: "nuclear", label: "核家族世帯", header: "一般世帯数（核家族世帯）" },
      { key: "couple_only", label: "夫婦のみの世帯", header: "一般世帯数（夫婦のみの世帯）" },
      { key: "three_gen", label: "3世代世帯", header: "一般世帯数（3世代世帯）" },
    ],
  },
  {
    key: "tenure",
    label: "住宅所有の関係",
    base: "households",
    options: [
      { key: "owned", label: "持ち家", header: "一般世帯数（持ち家）" },
      { key: "public_rental", label: "公営・都市再生機構・公社の借家", header: "一般世帯数（公営" },
      { key: "private_rental", label: "民営の借家", header: "一般世帯数（民営の借家）" },
      { key: "company_housing", label: "給与住宅", header: "一般世帯数（給与住宅）" },
    ],
  },
  {
    key: "dwelling_type",
    label: "住宅の建て方",
    base: "households",
    options: [
      { key: "detached", label: "一戸建", header: "主世帯数（一戸建）" },
      { key: "apt_low", label: "共同住宅1・2階建", header: "主世帯数（共同住宅1" },
      { key: "apt_high", label: "共同住宅3階建以上", header: "主世帯数（共同住宅3" },
    ],
  },
  {
    key: "car",
    label: "自動車保有台数",
    base: "households",
    options: [
      { key: "domestic", label: "国産車", header: "国産車台数" },
      { key: "kei", label: "軽自動車", header: "軽自動車台数" },
      { key: "imported", label: "輸入車", header: "輸入車台数" },
    ],
  },
  {
    key: "income",
    label: "推計世帯年収",
    base: "households",
    options: [
      { key: "inc_under300", label: "300万円未満", header: "推計世帯（年収300万未満" },
      { key: "inc_300_500", label: "300〜500万円", header: "推計世帯（年収300-500万未満" },
      { key: "inc_500_700", label: "500〜700万円", header: "推計世帯（年収500-700万未満" },
      { key: "inc_700_1000", label: "700〜1000万円", header: "推計世帯（年収700-1000万未満" },
      { key: "inc_over1000", label: "1000万円以上", header: "推計世帯（年収1000万以上" },
    ],
  },
  {
    key: "saving",
    label: "推計世帯貯蓄額",
    base: "households",
    options: [
      { key: "sav_under300", label: "300万円未満", header: "推計世帯（貯蓄300万未満" },
      { key: "sav_300_500", label: "300〜500万円", header: "推計世帯（貯蓄300-500万未満" },
      { key: "sav_500_1000", label: "500〜1000万円", header: "推計世帯（貯蓄500-1000万未満" },
      { key: "sav_1000_2000", label: "1000〜2000万円", header: "推計世帯（貯蓄1000-2000万未満" },
      { key: "sav_over2000", label: "2000万円以上", header: "推計世帯（貯蓄2000万以上" },
    ],
  },
  {
    key: "business_area",
    label: "事業所・面積",
    base: "households",
    options: [
      { key: "business_count", label: "全産業事業所数", header: "全産業事業所数" },
      { key: "area_sqm", label: "面積(㎡)", header: "面積（" },
    ],
  },
];

/** CSVの基礎列(KEY_CODE・配達可能箇所数・統計上世帯数・人口総数)の前方一致キー */
const STAT_BASE_COLUMNS = {
  keyCode: "KEY_CODE_住所コード",
  statHouseholds: "KEY_CODE_統計上世帯数",
  deliverable: "配達可能箇所数",
  population: "人口総数",
};

/** 読み込む統計データCSVのパス(必要に応じて他都道府県のCSVに差し替え可能) */
const STAT_CSV_PATH = "統計データ/Q_Keycode_13東京都.csv";

/**
 * 2軸ランキング(クロス表示)用バイバリエート配色(3段階×3段階)。
 * BIVARIATE_COLORS[軸A段階(0低〜2高)][軸B段階(0低〜2高)]。
 * 軸Aの段階ごとに色相(低=青系/中=緑系/高=ピンク系)を分け、軸Bの段階に応じて
 * 薄い→濃いのグラデーションにする(既存の商圏分析マップのクロス集計表示に準拠)。
 */
const BIVARIATE_COLORS = [
  ["#bfe0f5", "#5fa8dc", "#1c4f9c"],
  ["#e6e6a8", "#c3d92c", "#5a9c2f"],
  ["#f7c6df", "#e0399e", "#a01458"],
];

/** 条件未選択時のポリゴン既定配色(薄い黄色/濃い黄色) */
const NO_CONDITION_FILL = "#fef9c3";
const NO_CONDITION_BORDER = "#ca8a04";
/** 条件選択中だが該当統計データが無いポリゴンの配色(中立グレー) */
const NO_DATA_FILL = "#dfe3e8";
const NO_DATA_BORDER = "#8a8f98";
