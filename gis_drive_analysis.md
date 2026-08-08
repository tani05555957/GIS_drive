# GIS DRIVE アプリケーション解析

## 1. 概要
「GIS DRIVE」は Google マップ上で「商圏(ビジネスエリア)」を設定し、その範囲内の世帯属性などを分析・レポート出力するための業務用 Web GIS ツールです。URL パス `/jpmdgisweb/nicomap/displayMap/0` からアクセスするサーバーサイドレンダリング構成で、ログイン必須のページです。

## 2. 全体アーキテクチャ
- サーバー側: `/jpmdgisweb/` 配下でページ・静的リソースを配信(フレームワークは不明だが URL 構造から Python/Django 系の可能性)。
- クライアント側: jQuery ベースの古典的な多ファイル構成(SPA フレームワークは使用せず、複数の .js を個別ロード)。
- 地図表示: Google Maps JavaScript API(drawing ライブラリ付き)を利用。
- レイアウト: jquery.layout.js によりサイドパネルとマップ領域をリサイズ可能な2ペイン構成にしている。
- レポート機能: html2canvas で地図画面をキャプチャし、画像化してレポートやメール送信に利用している。

## 3. 使用ライブラリ / 外部リソース
| ライブラリ | 用途 |
|---|---|
| Google Maps JavaScript API | 地図表示・ジオコーディング・図形描画 |
| jQuery 1.7.1 | DOM操作全般 |
| jQuery UI 1.10.4 | スライダー等のUIパーツ |
| jquery.layout.js | パネルの可変レイアウト |
| html2canvas 0.4.1 | 画面キャプチャ(レポート/画像出力用) |
| Font Awesome | アイコン表示 |
| Google Fonts (Roboto等) | フォント |

## 4. 画面構成(UI)
- 左サイドパネル「商圏設定」
  - 検索ボックス(住所・駅・ランドマーク検索)
  - 商圏の指定方法選択: 円形 / 多角形 / 所要時間 / 地域
  - 「条件を選択」ボタン(形状選択後に活性化し、詳細条件パネルを開く)
  - 現在選択中の部数(件数)表示
  - ログアウトリンク
- 右側マップエリア
  - 地図/航空写真切替、全画面表示、ストリートビュー、ズーム等の標準 Google Maps コントロール

## 5. フロントエンドの主要ファイルと役割

### mapControl.js(約73関数・最大のファイル)
地図操作と商圏計算のコア。機能別に分類すると:
- 住所検索/ジオコーディング: codeAddress, searchAddress, searchAddressFromCache, checkGeocodingCache, getDefaultMapLatLng
- 図形描画(商圏設定): drawPolygon, drawCircle, getDrawingPolygonPoints, getDrawingDrivePolygonPoints, mapDraggable, showCircle, showPoly, showDrive, showDistance, showTime, showDistanceType, showTimeType, calculateDistances
- サーバー通信(商圏データ取得/登録): ajaxRequestGetData4Circle, ajaxRequestGetData4Polygon, ajaxRequestGetData4PolygonConfirm, ajaxRequestGetData4Delete, ajaxRequestAddPolygon, createXmlHttpRequest
- 集計・可視化: displayRankTable, setRankTableData, rankGroupCheck, setcolorPolygon, getCityWard, setCityWard
- レポート/出力: fnDownloadMarketAreaReport, fnDownloadSegmentAreaDownload, fndownloadPostingPlanReport, sendemailReport, postToImgur(html2canvasの画像をImgurにアップロードしレポートに埋め込む用途と推測)
- キャッシュ利用: displayMapFromCache

### panel.js
サイドパネルの状態管理・UIリセット系。
- resetPanel, resetSelectType, resetDriveMode, resetCarOption: 選択条件のリセット
- zenkaku_hankaku_convert: 検索文字列の全角/半角統一
- rgbToHex: 色分け表示用のカラー変換
- スライダー(所要時間の距離指定など)の slide / change イベント処理

### address_matching.js
商圏内の世帯属性による絞り込み(セグメント条件)を担当。
- checkSexage(性別・年代), checkMarriage(婚姻), checkFamily(家族構成), checkHouse(住居形態), checkIncome(収入), checkSaving(貯蓄), checkSubscription(購読等)といった属性ごとのチェック関数群
- bigclass_click, searchCondition_click, checkboxToggle: 条件カテゴリの開閉・選択操作

### script.js
アプリ共通のUIユーティリティ。
- showEditPopup, showPopupWin, closePopup: ポップアップ制御
- changeSection, goBack: 画面/セクション遷移
- disableoptions, enableoptions: フォーム部品の有効/無効化
- setHeaderColor: ヘッダー配色
- window.onbeforeunload: 離脱時の確認ダイアログ

### GeoJSON.js
GeoJSON ジオメトリを Google Maps のオーバーレイ図形に変換する小規模な汎用ユーティリティ(_geometryToGoogleMaps, _ccw など)。

## 6. 推測される主要機能一覧
1. 住所・駅・ランドマークによる地点検索と地図表示
2. 商圏の指定(円形/多角形/移動時間(徒歩・自転車・車)/行政区域単位)
3. 商圏内世帯の属性条件によるセグメント抽出(性別年代・婚姻・家族構成・住居・収入・貯蓄など)
4. ランク別集計結果の色分けポリゴン表示・件数表示
5. 商圏レポート/セグメントエリア/ポスティング計画のダウンロード出力
6. レポートのメール送信
7. 地図キャッシュを利用した表示高速化
8. ログイン/ログアウトによるアクセス制御

## 7. 制約・注記
- 本解析はブラウザから取得可能なクライアント側コード(HTML/JS/通信ログ)の範囲に限定しており、サーバー側の実装(認証方式・DB構造・API仕様の詳細)は含みません。
- 実際の商圏設定フローの一部(住所検索後の挙動など)は、ログイン後のセッション状態やデータ登録状況に依存するため、確認できた範囲での推測を含みます。
