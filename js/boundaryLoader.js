/**
 * boundaries/ 配下の町丁目・字境界データ(市区町村ごとのGeoJSON、全国327MB)を
 * 必要な範囲だけ遅延読み込みするモジュール。
 *
 * 起動時に軽量な data/boundaries_index.json (各市区町村ファイルのbboxのみ、約250KB)を読み込み、
 * 商圏の範囲と bbox が交差する市区町村ファイルだけを boundaries/{pref}/{code}.geojson から
 * 必要になった時点で fetch してキャッシュする。
 *
 * fetch() を使うため、index.html を file:// で直接開いた場合はブラウザのセキュリティ制限で
 * 動作しない。ローカルサーバー(例: `python -m http.server`)経由で開く必要がある。
 */
const BoundaryLoader = (() => {
  let index = [];
  let indexPromise = null;
  const cityCache = new Map(); // code -> Promise<Feature[]>

  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch("data/boundaries_index.json")
        .then((res) => {
          if (!res.ok) throw new Error("boundaries_index.json の読み込みに失敗しました");
          return res.json();
        })
        .then((data) => {
          index = data;
          return data;
        });
    }
    return indexPromise;
  }

  function bboxIntersects(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  }

  function findCandidates(bbox) {
    return index.filter((entry) => bboxIntersects(entry.bbox, bbox));
  }

  function loadMunicipality(entry) {
    if (!cityCache.has(entry.code)) {
      const promise = fetch(`boundaries/${entry.pref}/${entry.code}.geojson`)
        .then((res) => {
          if (!res.ok) throw new Error(`${entry.code}.geojson の読み込みに失敗しました`);
          return res.json();
        })
        .then((fc) => fc.features || []);
      cityCache.set(entry.code, promise);
    }
    return cityCache.get(entry.code);
  }

  /**
   * 指定bbox(経度緯度)と交差する市区町村の町丁目・字features全てを返す。
   * 該当市区町村数が maxMunicipalities を超える場合は読み込みを行わず tooBroad:true を返す
   * (広域ズームアウト状態での大量フェッチ・フリーズを防止するため)。
   */
  async function getFeaturesInBbox(bbox, maxMunicipalities = 12) {
    await loadIndex();
    const candidates = findCandidates(bbox);
    if (candidates.length === 0) {
      return { features: [], tooBroad: false, candidateCount: 0 };
    }
    if (candidates.length > maxMunicipalities) {
      return { features: [], tooBroad: true, candidateCount: candidates.length };
    }
    const groups = await Promise.all(candidates.map(loadMunicipality));
    return { features: groups.flat(), tooBroad: false, candidateCount: candidates.length };
  }

  /** 図形(GeoJSON Polygon/円)と実際に交差する町丁目・字featureのみを返す */
  async function getFeaturesIntersectingShape(shapeGeoJson, maxMunicipalities = 12) {
    const bbox = turf.bbox(shapeGeoJson);
    const result = await getFeaturesInBbox(bbox, maxMunicipalities);
    if (result.tooBroad || result.features.length === 0) return result;
    const filtered = result.features.filter((f) => {
      try {
        return turf.booleanIntersects(f, shapeGeoJson);
      } catch (e) {
        return false;
      }
    });
    return { features: filtered, tooBroad: false, candidateCount: result.candidateCount };
  }

  return { loadIndex, getFeaturesInBbox, getFeaturesIntersectingShape };
})();
