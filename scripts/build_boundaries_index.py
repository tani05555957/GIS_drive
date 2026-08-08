"""
boundaries/ 配下の全市区町村GeoJSONをスキャンし、各ファイルの bbox (経度緯度の範囲) を
まとめた軽量インデックス data/boundaries_index.json を生成する。

ブラウザ側では、このインデックス(数百KB程度)だけを起動時に読み込み、
選択された商圏の範囲と bbox が交差する市区町村ファイルだけを
必要に応じて fetch する(全国327MBを一度に読み込まない)ことで実用的な速度を保つ。

実行: python scripts/build_boundaries_index.py
"""
import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOUNDARIES_DIR = os.path.join(BASE_DIR, "boundaries")
OUT_PATH = os.path.join(BASE_DIR, "data", "boundaries_index.json")

PREF_NAMES = {
    "01": "北海道", "02": "青森県", "03": "岩手県", "04": "宮城県", "05": "秋田県",
    "06": "山形県", "07": "福島県", "08": "茨城県", "09": "栃木県", "10": "群馬県",
    "11": "埼玉県", "12": "千葉県", "13": "東京都", "14": "神奈川県", "15": "新潟県",
    "16": "富山県", "17": "石川県", "18": "福井県", "19": "山梨県", "20": "長野県",
    "21": "岐阜県", "22": "静岡県", "23": "愛知県", "24": "三重県", "25": "滋賀県",
    "26": "京都府", "27": "大阪府", "28": "兵庫県", "29": "奈良県", "30": "和歌山県",
    "31": "鳥取県", "32": "島根県", "33": "岡山県", "34": "広島県", "35": "山口県",
    "36": "徳島県", "37": "香川県", "38": "愛媛県", "39": "高知県", "40": "福岡県",
    "41": "佐賀県", "42": "長崎県", "43": "熊本県", "44": "大分県", "45": "宮崎県",
    "46": "鹿児島県", "47": "沖縄県",
}


def iter_coords(geom):
    t = geom.get("type")
    coords = geom.get("coordinates")
    if t == "Point":
        yield coords
    elif t in ("MultiPoint", "LineString"):
        yield from coords
    elif t in ("MultiLineString", "Polygon"):
        for ring in coords:
            yield from ring
    elif t == "MultiPolygon":
        for poly in coords:
            for ring in poly:
                yield from ring
    elif t == "GeometryCollection":
        for g in geom.get("geometries", []):
            yield from iter_coords(g)


def bbox_of_feature_collection(fc):
    min_lon = min_lat = float("inf")
    max_lon = max_lat = float("-inf")
    for feature in fc.get("features", []):
        geom = feature.get("geometry")
        if not geom:
            continue
        for lon, lat, *_ in iter_coords(geom):
            if lon < min_lon: min_lon = lon
            if lon > max_lon: max_lon = lon
            if lat < min_lat: min_lat = lat
            if lat > max_lat: max_lat = lat
    return [min_lon, min_lat, max_lon, max_lat]


def main():
    entries = []
    pref_dirs = sorted(
        d for d in os.listdir(BOUNDARIES_DIR)
        if os.path.isdir(os.path.join(BOUNDARIES_DIR, d))
    )

    for pref in pref_dirs:
        pref_dir = os.path.join(BOUNDARIES_DIR, pref)
        index_path = os.path.join(pref_dir, "index.json")
        name_by_code = {}
        if os.path.isfile(index_path):
            with open(index_path, encoding="utf-8") as f:
                for item in json.load(f):
                    name_by_code[item["code"]] = item.get("name", item["code"])

        files = sorted(
            fn for fn in os.listdir(pref_dir)
            if fn.endswith(".geojson")
        )
        for fn in files:
            code = fn[:-len(".geojson")]
            path = os.path.join(pref_dir, fn)
            with open(path, encoding="utf-8") as f:
                fc = json.load(f)
            bbox = bbox_of_feature_collection(fc)
            if bbox[0] == float("inf"):
                continue  # 空ファイル
            entries.append({
                "pref": pref,
                "prefName": PREF_NAMES.get(pref, pref),
                "code": code,
                "name": name_by_code.get(code, code),
                "count": len(fc.get("features", [])),
                "bbox": [round(v, 6) for v in bbox],
            })
            print(f"{pref}/{fn}: {len(fc.get('features', []))} features")

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\n{len(entries)} municipalities indexed -> {OUT_PATH}")
    print(f"index size: {os.path.getsize(OUT_PATH) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
