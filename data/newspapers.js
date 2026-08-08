/**
 * 配達プラン作成ウィザード「新聞(配布媒体)の指定」用のデモ一覧。
 * 実際の新聞購読データ(町丁目単位のカバー率)は提供されていないため、
 * ここでの選択は表示・保存のみ行われ、分析結果には影響しない
 * (js/deliveryPlan.js のコメント・画面注記を参照)。
 */
const SAMPLE_NEWSPAPERS = [
  { id: "np_asahi", name: "朝日新聞" },
  { id: "np_yomiuri", name: "読売新聞" },
  { id: "np_mainichi", name: "毎日新聞" },
  { id: "np_nikkei", name: "日本経済新聞" },
  { id: "np_sankei", name: "産経新聞" },
  { id: "np_tokyo", name: "東京新聞" },
  { id: "np_local", name: "地域紙・タウン誌" },
];
