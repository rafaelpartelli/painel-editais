// Utilitarios: formatacao pt-BR, normalizacao de texto e criacao segura de DOM.
export const fmtInt = new Intl.NumberFormat("pt-BR");
export const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const fmtBRLc = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const fmtData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const fmtHora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

export const UF_NOME = {
  AC: "Acre", AL: "Alagoas", AM: "Amazonas", AP: "Amapá", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MG: "Minas Gerais", MS: "Mato Grosso do Sul",
  MT: "Mato Grosso", PA: "Pará", PB: "Paraíba", PE: "Pernambuco", PI: "Piauí", PR: "Paraná",
  RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RO: "Rondônia", RR: "Roraima",
  RS: "Rio Grande do Sul", SC: "Santa Catarina", SE: "Sergipe", SP: "São Paulo", TO: "Tocantins",
};

export const CATEGORIAS = {
  medicamentos: "Medicamentos",
  material_hospitalar: "Material hospitalar",
  equipamentos: "Equipamentos",
  servicos_saude: "Serviços de saúde",
  transporte_sanitario: "Transporte sanitário",
  alimentacao_nutricao: "Nutrição",
  ti_saude: "TI e saúde digital",
  obras_saude: "Obras em saúde",
  orgao_saude: "Órgão de saúde (objeto genérico)",
};

export const norm = (s) => (s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function data(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? fmtData.format(d) : "não informada";
}
export function dataHora(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? `${fmtData.format(d)} às ${fmtHora.format(d)}` : "não informada";
}

// Dias de calendario entre hoje e a data (0 = hoje, negativo = ja passou)
export function diasAte(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return null;
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 86400000);
}

export function urlSegura(u) {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
  } catch { return null; }
}

// Cria elementos sem innerHTML: o conteudo vem de fonte externa e nunca e interpretado como HTML.
export function h(tag, attrs, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) el.append(f.nodeType ? f : document.createTextNode(String(f)));
  return el;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Escala em 5 classes por quantis (somente valores > 0). Classe 0 = sem edital.
export function escala(valores) {
  const v = valores.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return { cls: () => 0, faixas: [] };
  const cortes = [1, 2, 3, 4].map((i) => v[Math.min(v.length - 1, Math.floor((v.length * i) / 5))]);
  const cls = (x) => (x > 0 ? 1 + cortes.filter((c) => x >= c).length : 0);
  const faixas = {};
  for (const x of v) { const c = cls(x); (faixas[c] ||= [x, x]); faixas[c][0] = Math.min(faixas[c][0], x); faixas[c][1] = Math.max(faixas[c][1], x); }
  return { cls, faixas: Object.entries(faixas).map(([c, [a, b]]) => ({ c: +c, a, b })) };
}

export function baixarCsv(nome, linhas) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const corpo = "﻿" + linhas.map((l) => l.map(esc).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([corpo], { type: "text/csv;charset=utf-8" }));
  const a = h("a", { href: url, download: nome });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
