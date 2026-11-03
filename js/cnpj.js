// Consulta de CNPJ. O numero digitado fica so na memoria da pagina: nao e gravado, nem vai para a URL.
// A fonte e trocavel: basta reescrever buscarEmpresa() (ex.: apontar para a base aberta da Receita
// pre-processada pelo robo) que o restante do painel continua igual.
import { norm } from "./util.js";

const URL_BASE = "https://brasilapi.com.br/api/cnpj/v1/";

export class ErroCnpj extends Error {
  constructor(codigo) { super(codigo); this.codigo = codigo; }
}

export const limpar = (v) => (v || "").toUpperCase().replace(/[^0-9A-Z]/g, "");

// Mascara 00.000.000/0000-00 (aceita o CNPJ alfanumerico)
export function formatar(v) {
  const c = limpar(v).slice(0, 14);
  const p = [c.slice(0, 2), c.slice(2, 5), c.slice(5, 8), c.slice(8, 12), c.slice(12, 14)];
  return p[0] + (p[1] ? "." + p[1] : "") + (p[2] ? "." + p[2] : "") + (p[3] ? "/" + p[3] : "") + (p[4] ? "-" + p[4] : "");
}

// Digitos verificadores (modulo 11). Para letras, o valor e o codigo ASCII menos 48.
export function valido(v) {
  const c = limpar(v);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return false;
  const val = (ch) => ch.charCodeAt(0) - 48;
  const dig = (base, pesos) => {
    const s = [...base].reduce((acc, ch, i) => acc + val(ch) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dig(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dig(c.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return c.slice(12) === `${d1}${d2}`;
}

export function normalizarEmpresa(j) {
  const sec = Array.isArray(j.cnaes_secundarios) ? j.cnaes_secundarios : [];
  const porte = norm(`${j.porte || ""} ${j.descricao_porte || ""}`);
  const cnae = (codigo, descricao) => ({ codigo: String(codigo ?? "").replace(/\D/g, ""), descricao: descricao || "" });
  return {
    cnpj: j.cnpj ? String(j.cnpj) : "",
    razao: j.razao_social || "",
    fantasia: j.nome_fantasia || "",
    uf: (j.uf || "").toUpperCase(),
    municipio: j.municipio || "",
    situacao: j.descricao_situacao_cadastral || "",
    porte: j.descricao_porte || j.porte || "",
    mepp: /micro|pequeno/.test(porte),
    principal: cnae(j.cnae_fiscal, j.cnae_fiscal_descricao),
    secundarios: sec.map((s) => cnae(s.codigo, s.descricao)).filter((s) => s.codigo && s.codigo !== "0"),
  };
}

export async function buscarEmpresa(cnpj, sinal) {
  let r;
  try {
    r = await fetch(URL_BASE + limpar(cnpj), { signal: sinal, headers: { Accept: "application/json" } });
  } catch (e) {
    throw new ErroCnpj(e.name === "AbortError" ? "tempo" : "indisponivel");
  }
  if (r.status === 404 || r.status === 400) throw new ErroCnpj("nao_encontrado");
  if (r.status === 429) throw new ErroCnpj("limite");
  if (!r.ok) throw new ErroCnpj("indisponivel");
  try { return normalizarEmpresa(await r.json()); } catch { throw new ErroCnpj("indisponivel"); }
}
