#!/usr/bin/env python3
"""Converte as malhas geojson (IBGE, via tbrugz/geodata-br, ja simplificadas com
mapshaper) em caminhos SVG leves: mapas/brasil.json e mapas/uf/<UF>.json.

Uso: python3 scripts/gerar_mapas.py <pasta_com_states.geojson_e_mun_geojs-XX-mun.geojson>
Rode so quando quiser regenerar os mapas. O robo de editais nao depende disto.
"""
import json
import math
import os
import sys

UFS = {
    "11": ("RO", "Rondônia"), "12": ("AC", "Acre"), "13": ("AM", "Amazonas"),
    "14": ("RR", "Roraima"), "15": ("PA", "Pará"), "16": ("AP", "Amapá"),
    "17": ("TO", "Tocantins"), "21": ("MA", "Maranhão"), "22": ("PI", "Piauí"),
    "23": ("CE", "Ceará"), "24": ("RN", "Rio Grande do Norte"), "25": ("PB", "Paraíba"),
    "26": ("PE", "Pernambuco"), "27": ("AL", "Alagoas"), "28": ("SE", "Sergipe"),
    "29": ("BA", "Bahia"), "31": ("MG", "Minas Gerais"), "32": ("ES", "Espírito Santo"),
    "33": ("RJ", "Rio de Janeiro"), "35": ("SP", "São Paulo"), "41": ("PR", "Paraná"),
    "42": ("SC", "Santa Catarina"), "43": ("RS", "Rio Grande do Sul"),
    "50": ("MS", "Mato Grosso do Sul"), "51": ("MT", "Mato Grosso"), "52": ("GO", "Goiás"),
    "53": ("DF", "Distrito Federal"),
}


def rings(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    return geom["coordinates"]


def bbox(feats):
    xs, ys = [], []
    for f in feats:
        for poly in rings(f["geometry"]):
            for ring in poly:
                for x, y in ring:
                    xs.append(x)
                    ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def make_proj(feats, largura):
    x0, y0, x1, y1 = bbox(feats)
    k = math.cos(math.radians((y0 + y1) / 2))
    w = (x1 - x0) * k
    h = (y1 - y0)
    esc = largura / w
    altura = h * esc

    def proj(x, y):
        return (x - x0) * k * esc, (y1 - y) * esc

    return proj, round(largura, 1), round(altura, 1)


def path(geom, proj):
    partes = []
    for poly in rings(geom):
        for ring in poly:
            pts = [proj(x, y) for x, y in ring]
            # remove pontos repetidos apos arredondar
            ult = None
            seg = []
            for px, py in pts:
                p = (round(px, 1), round(py, 1))
                if p != ult:
                    seg.append(p)
                    ult = p
            if len(seg) < 3:
                continue
            partes.append("M" + "L".join(f"{a:g},{b:g}" for a, b in seg) + "Z")
    return "".join(partes)


def centro(geom, proj):
    """Centroide (area ponderada) do maior poligono, em coordenadas projetadas."""
    melhor, area_max = None, -1
    for poly in rings(geom):
        ring = [proj(x, y) for x, y in poly[0]]
        a = cx = cy = 0.0
        for (xa, ya), (xb, yb) in zip(ring, ring[1:] + ring[:1]):
            c = xa * yb - xb * ya
            a += c
            cx += (xa + xb) * c
            cy += (ya + yb) * c
        if abs(a) > area_max and a != 0:
            area_max = abs(a)
            melhor = (cx / (3 * a), cy / (3 * a))
    return melhor or (0, 0)


def main(pasta):
    saida = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "mapas")
    os.makedirs(os.path.join(saida, "uf"), exist_ok=True)

    estados = json.load(open(os.path.join(pasta, "states.geojson"), encoding="utf-8"))["features"]
    proj, w, h = make_proj(estados, 1000)
    lista = []
    for f in estados:
        uf, nome = UFS[str(f["properties"]["uf"])]
        cx, cy = centro(f["geometry"], proj)
        lista.append({"uf": uf, "nome": nome, "d": path(f["geometry"], proj),
                      "cx": round(cx, 1), "cy": round(cy, 1)})
    lista.sort(key=lambda e: e["uf"])
    with open(os.path.join(saida, "brasil.json"), "w", encoding="utf-8") as fp:
        json.dump({"viewBox": f"0 0 {w:g} {h:g}", "estados": lista}, fp, ensure_ascii=False, separators=(",", ":"))

    for cod, (uf, nome) in UFS.items():
        arq = os.path.join(pasta, f"mun_geojs-{cod}-mun.geojson")
        feats = json.load(open(arq, encoding="utf-8"))["features"]
        proj, w, h = make_proj(feats, 800)
        muns = [{"id": str(f["properties"]["id"]), "nome": f["properties"]["name"],
                 "d": path(f["geometry"], proj)} for f in feats]
        with open(os.path.join(saida, "uf", f"{uf}.json"), "w", encoding="utf-8") as fp:
            json.dump({"uf": uf, "nome": nome, "viewBox": f"0 0 {w:g} {h:g}", "municipios": muns},
                      fp, ensure_ascii=False, separators=(",", ":"))
    print("ok")


if __name__ == "__main__":
    main(sys.argv[1])
