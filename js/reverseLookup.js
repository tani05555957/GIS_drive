/**
 * 円・所要時間・電車商圏の「逆引き」(配達可能箇所数/統計上世帯数の目標値から範囲を決定する)を担当するモジュール。
 * 起点に近い町丁目から順に対象metricを積み上げ、目標値以上で最も目標値に近くなる組み合わせを返す。
 */
const ReverseLookup = (() => {
  function metricValue(record, metricKey) {
    if (!record) return 0;
    return metricKey === "statHouseholds" ? record.statHouseholds : record.deliverable;
  }

  /** 1地点から近い順に町丁目を組み合わせ、目標値以上で最も目標値に近い結果を返す */
  async function forPoint(latlng, targetValue, metricKey) {
    const near = await BoundaryLoader.getFeaturesNearPoint(latlng.lat, latlng.lng);
    const withDist = near.features
      .map((f) => {
        const c = turf.centroid(f).geometry.coordinates; // [lon, lat]
        const dist = ShapeBuilders.haversineM(latlng.lat, latlng.lng, c[1], c[0]);
        const record = StatsData.getRecord(f.properties?.KEY_CODE);
        return { feature: f, dist, value: metricValue(record, metricKey) };
      })
      .sort((a, b) => a.dist - b.dist);

    let cumulative = 0;
    const selected = [];
    for (const item of withDist) {
      selected.push(item.feature);
      cumulative += item.value;
      if (cumulative >= targetValue) break;
    }
    return { features: selected, total: cumulative, reached: cumulative >= targetValue };
  }

  /** 複数起点それぞれに forPoint を実行し、featureをKEY_CODEで統合して返す */
  async function forPoints(latlngs, targetValue, metricKey) {
    const seen = new Map();
    let allReached = true;
    let totalSum = 0;
    for (const latlng of latlngs) {
      const r = await forPoint(latlng, targetValue, metricKey);
      if (!r.reached) allReached = false;
      totalSum += r.total;
      r.features.forEach((f) => seen.set(f.properties.KEY_CODE, f));
    }
    return { features: Array.from(seen.values()), allReached, total: totalSum };
  }

  return { forPoint, forPoints };
})();
