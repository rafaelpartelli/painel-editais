#!/usr/bin/env python3
"""Robo de editais: coleta contratacoes com propostas abertas na API de Consulta
do PNCP e grava JSON estatico por UF para o painel (sem servidor, sem banco).

Somente biblioteca padrao do Python (3.9+). Nenhuma credencial: a API de
Consulta do PNCP e publica.

Uso:
  python3 robo/coletar_editais.py                  # todas as UFs, escopo do config.json
  python3 robo/coletar_editais.py --uf ES,MG       # so algumas UFs
  python3 robo/coletar_editais.py --escopo todos   # sem filtro de saude
  python3 robo/coletar_editais.py --base-url http://127.0.0.1:8765/api/consulta/v1  # testes

Saidas (pasta dados/):
  uf/<UF>.json   editais abertos da UF (campos enxutos)
  resumo.json    totais por UF, por modalidade e por municipio (alimenta os mapas)
  meta.json      data/hora da coleta, escopo, UFs com erro, fonte
"""
import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BASE_PADRAO = "https://pncp.gov.br/api/consulta/v1"
PORTAL = "https://pncp.gov.br/app/editais"
FUSO = timezone(timedelta(hours=-3))  # Brasilia

UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
       "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"]

# Tabela de modalidades do PNCP (Lei 14.133/2021), usada so se a API nao trouxer o nome.
MODALIDADES = {1: "Leilão eletrônico", 2: "Diálogo competitivo", 3: "Concurso",
               4: "Concorrência eletrônica", 5: "Concorrência presencial",
               6: "Pregão eletrônico", 7: "Pregão presencial", 8: "Dispensa",
               9: "Inexigibilidade", 10: "Manifestação de interesse",
               11: "Pré-qualificação", 12: "Credenciamento", 13: "Leilão presencial"}

ESFERAS = {"F": "Federal", "E": "Estadual", "M": "Municipal", "D": "Distrital", "N": "Não se aplica"}


def norm(txt):
    txt = unicodedata.normalize("NFKD", txt or "")
    return "".join(c for c in txt if not unicodedata.combining(c)).lower()


def carregar_config():
    with open(os.path.join(RAIZ, "robo", "config.json"), encoding="utf-8") as fp:
        return json.load(fp)


class Classificador:
    """Marca cada edital com categorias de saude a partir do objeto e do nome do orgao."""

    def __init__(self, cfg):
        self.cats = {nome: re.compile(r"\b(?:" + "|".join(norm(t) for t in termos) + r")", re.I)
                     for nome, termos in cfg["categorias"].items()}
        self.orgao = re.compile(r"\b(?:" + "|".join(norm(t) for t in cfg["orgaos_saude"]) + r")", re.I)
        self.obra = re.compile(r"\b(?:" + "|".join(norm(t) for t in cfg["obra_termos"]) + r")", re.I)
        self.local = re.compile(r"\b(?:" + "|".join(norm(t) for t in cfg["obra_locais_saude"]) + r")", re.I)

    def categorias(self, objeto, orgao):
        o, g = norm(objeto), norm(orgao)
        achadas = [nome for nome, rx in self.cats.items() if rx.search(o)]
        if self.obra.search(o) and self.local.search(o):
            achadas.append("obras_saude")
        if not achadas and self.orgao.search(g):
            achadas.append("orgao_saude")
        return sorted(set(achadas))


def pegar(url, tentativas=5, timeout=60):
    """GET com tentativas, backoff e respeito a Retry-After (HTTP 429/5xx)."""
    espera = 2.0
    ultimo = None
    for i in range(tentativas):
        req = urllib.request.Request(url, headers={"Accept": "application/json",
                                                   "User-Agent": "partelli-editais/1.0 (+https://partelli.pro)"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                corpo = r.read().decode("utf-8")
                if r.status == 204 or not corpo.strip():
                    return {"data": [], "totalPaginas": 0}
                return json.loads(corpo)
        except urllib.error.HTTPError as e:
            ultimo = e
            if e.code in (429, 500, 502, 503, 504):
                ra = e.headers.get("Retry-After")
                time.sleep(float(ra) if ra and ra.isdigit() else espera)
                espera = min(espera * 2, 60)
                continue
            detalhe = e.read().decode("utf-8", "replace")[:300]
            raise RuntimeError(f"HTTP {e.code} em {url}: {detalhe}") from e
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            ultimo = e
            time.sleep(espera)
            espera = min(espera * 2, 60)
    raise RuntimeError(f"Falha apos {tentativas} tentativas em {url}: {ultimo}")


def buscar_uf(base, uf, hoje, tam_pagina, pausa, modalidade=None):
    """Percorre todas as paginas de contratacoes/proposta de uma UF."""
    itens, pagina, total_pag, total_reg = [], 1, 1, None
    while pagina <= total_pag:
        params = {"dataFinal": hoje, "uf": uf, "pagina": pagina, "tamanhoPagina": tam_pagina}
        if modalidade:
            params["codigoModalidadeContratacao"] = modalidade
        corpo = pegar(f"{base}/contratacoes/proposta?" + urllib.parse.urlencode(params))
        itens.extend(corpo.get("data") or [])
        total_pag = int(corpo.get("totalPaginas") or 0)
        total_reg = corpo.get("totalRegistros", total_reg)
        pagina += 1
        time.sleep(pausa)
    # diagnostico: compara o que a API disse que existe com o que foi baixado
    aviso = "" if total_reg in (None, len(itens)) else "  <<< DIVERGENCIA"
    print(f"  [{uf}] API informou {total_reg} registros em {total_pag} pagina(s); baixados {len(itens)}{aviso}", flush=True)
    return itens


def buscar_uf_com_plano_b(base, uf, hoje, tam_pagina, pausa):
    """Tenta sem modalidade; se a API exigir, percorre cada modalidade."""
    try:
        return buscar_uf(base, uf, hoje, tam_pagina, pausa)
    except RuntimeError as e:
        if "HTTP 400" not in str(e):
            raise
        print(f"  [{uf}] API pediu modalidade; varrendo as {len(MODALIDADES)} modalidades", flush=True)
        todos = []
        for cod in MODALIDADES:
            todos.extend(buscar_uf(base, uf, hoje, tam_pagina, pausa, modalidade=cod))
        return todos


def num(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def normalizar(bruto, cls, agora_iso):
    org = bruto.get("orgaoEntidade") or {}
    uni = bruto.get("unidadeOrgao") or {}
    cnpj, ano, seq = org.get("cnpj"), bruto.get("anoCompra"), bruto.get("sequencialCompra")
    mod_id = bruto.get("modalidadeId")
    objeto = (bruto.get("objetoCompra") or "").strip()
    razao = (org.get("razaoSocial") or "").strip()
    cats = cls.categorias(objeto, razao + " " + (uni.get("nomeUnidade") or ""))
    ibge = uni.get("codigoIbge")
    return {
        "id": bruto.get("numeroControlePNCP") or f"{cnpj}-{ano}-{seq}",
        "uf": uni.get("ufSigla"),
        "municipio": uni.get("municipioNome"),
        "ibge": str(ibge) if ibge else None,
        "orgao": razao,
        "unidade": uni.get("nomeUnidade"),
        "esfera": ESFERAS.get(org.get("esferaId"), org.get("esferaId")),
        "objeto": objeto,
        "modalidade": bruto.get("modalidadeNome") or MODALIDADES.get(mod_id),
        "modalidade_id": mod_id,
        "disputa": bruto.get("modoDisputaNome"),
        "srp": bool(bruto.get("srp")),
        "situacao": bruto.get("situacaoCompraNome"),
        "valor": num(bruto.get("valorTotalEstimado")),
        "numero": bruto.get("numeroCompra"),
        "ano": ano,
        "processo": bruto.get("processo"),
        "publicado": bruto.get("dataPublicacaoPncp"),
        "abertura": bruto.get("dataAberturaProposta"),
        "encerramento": bruto.get("dataEncerramentoProposta"),
        "link": f"{PORTAL}/{cnpj}/{ano}/{seq}" if cnpj and ano and seq else None,
        "origem": bruto.get("linkSistemaOrigem"),
        "cat": cats,
        "visto": agora_iso[:10],
    }


def ainda_aberto(ed, agora):
    enc = ed.get("encerramento")
    if not enc:
        return True
    try:
        dt = datetime.fromisoformat(enc.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=FUSO)
        return dt >= agora
    except ValueError:
        return True


def ler_json(caminho, padrao):
    try:
        with open(caminho, encoding="utf-8") as fp:
            return json.load(fp)
    except (OSError, json.JSONDecodeError):
        return padrao


def gravar_json(caminho, obj):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    tmp = caminho + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fp:
        json.dump(obj, fp, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, caminho)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--uf", help="lista separada por virgula (padrao: todas)")
    ap.add_argument("--escopo", choices=["saude", "todos"])
    ap.add_argument("--saida", default=os.path.join(RAIZ, "dados"))
    ap.add_argument("--base-url", default=BASE_PADRAO)
    ap.add_argument("--pausa", type=float, default=0.4, help="segundos entre paginas")
    ap.add_argument("--tam-pagina", type=int)
    a = ap.parse_args()

    cfg = carregar_config()
    escopo = a.escopo or cfg.get("escopo", "saude")
    tam = a.tam_pagina or cfg.get("tamanho_pagina", 50)
    ufs = [u.strip().upper() for u in a.uf.split(",")] if a.uf else UFS
    cls = Classificador(cfg)
    agora = datetime.now(FUSO)
    agora_iso = agora.isoformat(timespec="seconds")
    # dataFinal da consulta de propostas abertas e um LIMITE: traz o que encerra ate essa data.
    # Por isso usamos uma janela a frente (padrao 180 dias), e nao a data de hoje.
    hoje = (agora + timedelta(days=cfg.get("janela_dias", 180))).strftime("%Y%m%d")
    print(f"Propostas abertas com encerramento ate {hoje}", flush=True)

    meta_ant = ler_json(os.path.join(a.saida, "meta.json"), {})
    erros, resumo_uf = {}, {}
    modal_nac, cat_nac = {}, {}

    for uf in ufs:
        arq = os.path.join(a.saida, "uf", f"{uf}.json")
        anterior = {e["id"]: e for e in ler_json(arq, {}).get("editais", [])}
        print(f"[{uf}] coletando...", flush=True)
        try:
            brutos = buscar_uf_com_plano_b(a.base_url, uf, hoje, tam, a.pausa)
        except RuntimeError as e:
            erros[uf] = str(e)[:300]
            print(f"[{uf}] ERRO: {e}", file=sys.stderr, flush=True)
            # preserva o ultimo arquivo bom; nao zera a UF por falha de rede
            if anterior:
                resumo_uf[uf] = ler_json(os.path.join(a.saida, "resumo.json"), {}).get("ufs", {}).get(uf)
            continue

        editais, vistos = [], set()
        for b in brutos:
            ed = normalizar(b, cls, agora_iso)
            if ed["id"] in vistos or not ainda_aberto(ed, agora):
                continue
            vistos.add(ed["id"])
            if escopo == "saude" and not ed["cat"]:
                continue
            if ed["id"] in anterior:
                ed["visto"] = anterior[ed["id"]].get("visto", ed["visto"])
            editais.append(ed)
        editais.sort(key=lambda e: (e.get("encerramento") or "9999"))

        muns = {}
        for e in editais:
            m = muns.setdefault(e["ibge"] or "sem", {"n": 0, "valor": 0.0, "nome": e["municipio"]})
            m["n"] += 1
            m["valor"] += e["valor"] or 0
            modal_nac[e["modalidade"]] = modal_nac.get(e["modalidade"], 0) + 1
            for c in e["cat"]:
                cat_nac[c] = cat_nac.get(c, 0) + 1
        resumo_uf[uf] = {
            "n": len(editais),
            "novos": sum(1 for e in editais if e["visto"] == agora_iso[:10]),  # vistos pela 1a vez hoje
            "valor": round(sum(e["valor"] or 0 for e in editais), 2),
            "municipios": {k: {"n": v["n"], "valor": round(v["valor"], 2), "nome": v["nome"]}
                           for k, v in muns.items()},
        }
        gravar_json(arq, {"uf": uf, "atualizado_em": agora_iso, "editais": editais})
        print(f"[{uf}] {len(editais)} editais ({len(brutos)} brutos)", flush=True)

    resumo_uf = {k: v for k, v in resumo_uf.items() if v}
    ant_resumo = ler_json(os.path.join(a.saida, "resumo.json"), {}).get("ufs", {})
    for uf, v in ant_resumo.items():          # UFs nao tocadas nesta rodada continuam
        resumo_uf.setdefault(uf, v)
    gravar_json(os.path.join(a.saida, "resumo.json"), {
        "atualizado_em": agora_iso, "ufs": resumo_uf,
        "modalidades": dict(sorted(modal_nac.items(), key=lambda x: -x[1])),
        "categorias": dict(sorted(cat_nac.items(), key=lambda x: -x[1]))})
    gravar_json(os.path.join(a.saida, "meta.json"), {
        "atualizado_em": agora_iso, "escopo": escopo,
        "fonte": "PNCP, API de Consulta (pncp.gov.br)",
        "demo": a.base_url != BASE_PADRAO,   # base diferente do PNCP = dados de teste, o painel avisa
        "ufs_com_erro": erros,
        "ultima_rodada_completa": agora_iso if not erros and len(ufs) == len(UFS)
        else meta_ant.get("ultima_rodada_completa")})

    if erros:
        print(f"Concluido com erro em {len(erros)} UF(s): {', '.join(erros)}", file=sys.stderr)
        # Falha total (nenhuma UF coletada) derruba o job; falha parcial nao.
        sys.exit(2 if len(erros) == len(ufs) else 0)


if __name__ == "__main__":
    main()
