/**
 * 商圏図形(円・所要時間・電車)のジオメトリ生成を担当する純粋関数群。
 * 状態(Leafletレイヤーやモード)を持たないため、左パネルの商圏指定モード(map.js)からも
 * 店舗管理・配達プランウィザード(店舗を起点にした商圏)からも共通で利用できる。
 */
const ShapeBuilders = (() => {
  function circle(lat, lon, radiusM) {
    return turf.circle([lon, lat], radiusM / 1000, { steps: 64, units: "kilometers" });
  }

  /** 所要時間モード: ORS APIキーがあれば道路networkベースの等時間圏、無ければ近似円 */
  async function time({ lat, lon, mode = "walk", minutes = 10, apiKey = "" }) {
    if (apiKey) {
      try {
        const profile = { walk: "foot-walking", bike: "cycling-regular", car: "driving-car" }[mode] || "foot-walking";
        const res = await fetch(`https://api.openrouteservice.org/v2/isochrones/${profile}`, {
          method: "POST",
          headers: { Authorization: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            locations: [[lon, lat]],
            range: [minutes * 60],
            range_type: "time",
          }),
        });
        if (res.ok) {
          const gj = await res.json();
          if (gj.features && gj.features.length > 0) return gj.features[0];
        }
      } catch (err) {
        console.warn("ORS isochrone取得に失敗、近似円で代替します", err);
      }
    }
    const speed = TRAVEL_SPEED_KMH[mode] || TRAVEL_SPEED_KMH.walk;
    const radiusM = (speed * 1000 * minutes) / 60;
    const gj = circle(lat, lon, radiusM);
    gj.properties = { approx: true };
    return gj;
  }

  function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /**
   * 電車商圏: Overpass API(無償・キー不要)で起点付近の鉄道駅を検索し、
   * 「起点から最寄り駅までの徒歩円」+「駅を中心とした概算鉄道到達円」を合成した形状を返す。
   * 駅が見つからない/API失敗時は起点中心の近似円にフォールバックする。
   */
  async function train({ lat, lon, stationRadiusM = 1200, searchRadiusM = 3000 }) {
    try {
      const query = `[out:json][timeout:15];node["railway"="station"](around:${searchRadiusM},${lat},${lon});out body 20;`;
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: query,
      });
      if (res.ok) {
        const data = await res.json();
        const stations = (data.elements || []).filter((e) => e.lat != null && e.lon != null);
        if (stations.length > 0) {
          let nearest = null;
          let minDist = Infinity;
          stations.forEach((s) => {
            const d = haversineM(lat, lon, s.lat, s.lon);
            if (d < minDist) {
              minDist = d;
              nearest = s;
            }
          });
          if (nearest) {
            const walkCircle = circle(lat, lon, Math.max(minDist, 200));
            const stationCircle = circle(nearest.lat, nearest.lon, stationRadiusM);
            let unioned;
            try {
              unioned = turf.union(walkCircle, stationCircle);
            } catch (e) {
              unioned = stationCircle;
            }
            unioned.properties = {
              stationName: nearest.tags?.name || "最寄り駅",
              distanceM: Math.round(minDist),
              fallback: false,
            };
            return unioned;
          }
        }
      }
    } catch (err) {
      console.warn("Overpass取得に失敗、近似円で代替します", err);
    }
    const speed = TRAVEL_SPEED_KMH.walk;
    const radiusM = (speed * 1000 * 15) / 60; // 徒歩15分相当の近似円
    const gj = circle(lat, lon, radiusM);
    gj.properties = { stationName: null, distanceM: null, fallback: true };
    return gj;
  }

  return { circle, time, train, haversineM };
})();
