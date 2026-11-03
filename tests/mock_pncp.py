#!/usr/bin/env python3
"""Servidor de TESTE que imita o formato da API de Consulta do PNCP.
Todos os registros sao sinteticos e marcados com [DEMONSTRACAO]; servem apenas para
testar o robo e o painel sem rede. Nunca publique a saida deste servidor.

Uso: python3 tests/mock_pncp.py 8765
"""
import hashlib
import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OBJETOS = [
    "[DEMONSTRAÇÃO] Registro de preços para aquisição de medicamentos da atenção básica",
    "[DEMONSTRAÇÃO] Aquisição de material médico-hospitalar e insumos hospitalares",
    "[DEMONSTRAÇÃO] Contratação de empresa para serviços de plantão médico em pronto atendimento",
    "[DEMONSTRAÇÃO] Aquisição de equipamentos médicos: monitor multiparâmetro e desfibrilador",
    "[DEMONSTRAÇÃO] Reforma e ampliação de Unidade Básica de Saúde",
    "[DEMONSTRAÇÃO] Serviço de transporte sanitário e ambulância para o município",
    "[DEMONSTRAÇÃO] Fornecimento de gases medicinais e oxigênio hospitalar",
    "[DEMONSTRAÇÃO] Sistema de prontuário eletrônico e gestão em saúde",
    "[DEMONSTRAÇÃO] Aquisição de material de escritório para a prefeitura",
    "[DEMONSTRAÇÃO] Contratação de exames laboratoriais e reagentes",
]
MODS = [(6, "Pregão eletrônico"), (4, "Concorrência eletrônica"), (8, "Dispensa"),
        (12, "Credenciamento"), (9, "Inexigibilidade")]
ESF = ["M", "M", "M", "E", "F"]


def municipios(uf):
    cods = {"RO": 11, "AC": 12, "AM": 13, "RR": 14, "PA": 15, "AP": 16, "TO": 17, "MA": 21, "PI": 22,
            "CE": 23, "RN": 24, "PB": 25, "PE": 26, "AL": 27, "SE": 28, "BA": 29, "MG": 31, "ES": 32,
            "RJ": 33, "SP": 35, "PR": 41, "SC": 42, "RS": 43, "MS": 50, "MT": 51, "GO": 52, "DF": 53}
    arq = f"/tmp/geo/geodata-br/geojson/geojs-{cods[uf]}-mun.json"
    with open(arq, encoding="utf-8") as fp:
        return [(f["properties"]["id"], f["properties"]["name"]) for f in json.load(fp)["features"]]


def gerar(uf):
    rnd = random.Random(uf)
    muns = municipios(uf)
    n = max(8, int(len(muns) * 0.9))
    agora = datetime.now(timezone(timedelta(hours=-3)))
    saida = []
    for i in range(n):
        ibge, nome = rnd.choice(muns)
        mod = rnd.choice(MODS)
        esf = rnd.choice(ESF)
        cnpj = str(10_000_000_000_000 + rnd.randint(0, 9_999_999_999_999))
        seq, ano = rnd.randint(1, 900), 2026
        pub = agora - timedelta(days=rnd.randint(0, 9), hours=rnd.randint(0, 20))
        enc = agora + timedelta(days=rnd.randint(1, 25), hours=rnd.randint(0, 8))
        saida.append({
            "numeroControlePNCP": f"DEMO-{cnpj}-1-{seq:06d}/{ano}-{hashlib.md5((uf+str(i)).encode()).hexdigest()[:4]}",
            "anoCompra": ano, "sequencialCompra": seq, "numeroCompra": f"{rnd.randint(1, 300)}/{ano}",
            "processo": f"{rnd.randint(1, 900)}/{ano}",
            "objetoCompra": rnd.choice(OBJETOS),
            "valorTotalEstimado": None if rnd.random() < 0.08 else round(rnd.uniform(15_000, 4_500_000), 2),
            "modalidadeId": mod[0], "modalidadeNome": mod[1], "modoDisputaNome": "Aberto",
            "srp": rnd.random() < 0.4, "situacaoCompraNome": "Divulgada no PNCP",
            "dataPublicacaoPncp": pub.isoformat(timespec="seconds"),
            "dataAberturaProposta": (pub + timedelta(days=1)).isoformat(timespec="seconds"),
            "dataEncerramentoProposta": enc.isoformat(timespec="seconds"),
            "linkSistemaOrigem": "https://exemplo.invalid/demo",
            "orgaoEntidade": {"cnpj": cnpj, "razaoSocial": f"[DEMO] {'Fundo Municipal de Saúde de ' + nome if esf == 'M' else 'Secretaria de Estado da Saúde ' + uf}",
                              "esferaId": esf},
            "unidadeOrgao": {"ufSigla": uf, "municipioNome": nome, "codigoIbge": ibge,
                             "nomeUnidade": "Unidade demonstração"},
        })
    return saida


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if not u.path.endswith("/contratacoes/proposta"):
            self.send_error(404)
            return
        uf = q.get("uf", [""])[0]
        pag, tam = int(q.get("pagina", ["1"])[0]), int(q.get("tamanhoPagina", ["50"])[0])
        todos = gerar(uf)
        fatia = todos[(pag - 1) * tam: pag * tam]
        corpo = json.dumps({"data": fatia, "totalRegistros": len(todos),
                            "totalPaginas": -(-len(todos) // tam), "numeroPagina": pag,
                            "paginasRestantes": 0, "empty": not fatia}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(corpo)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
