// Painel de Editais de Saude: mapa Brasil/regiao/UF + filtros + empresa (CNPJ) + lista. Sem framework, sem build.
import {
  fmtInt, fmtBRL, fmtBRLc, UF_NOME, CATEGORIAS, REGIAO, regiaoDe, norm, data, dataHora, diasAte, urlSegura,
  h, debounce, escala, baixarCsv, ESFERA_H, modH, estiloH, resumirObjeto,
} from "./util.js";
import { desenhar } from "./mapa.js";
import { limpar, formatar, valido, buscarEmpresa, ErroCnpj } from "./cnpj.js";
import { temasDosCnaes } from "./cnae.js";

const $ = (id) => document.getElementById(id);
const PADRAO = { uf: "", reg: "", mun: "", q: "", mod: "", cat: "", t: "", esf: "", prazo: "", vmin: "", srp: false, novo: false, ate80: false, ord: "encerramento", m: "n" };
const S = { ...PADRAO, limite: 30 };
const TODAS_UF = Object.keys(UF_NOME);
const LIMITE_ME = 80000;

let meta, resumo, brasil;
let empresa = null;           // so na memoria; nunca vai para a URL nem para o disco
let pedidoCnpj = null;
const dados = new Map();      // uf -> editais[]
const carregando = new Map(); // uf -> Promise
const mapasUF = new Map();
const falhas = new Set();
let tokenMapa = 0;

const reduzido = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- territorio ---------- */
const ufsAtivas = () => (S.uf ? [S.uf] : S.reg ? REGIAO[S.reg] : TODAS_UF);
const temasSel = () => (S.t ? S.t.split(",").filter((t) => CATEGORIAS[t]) : []);
const filtroAtivo = () => !!(S.mod || S.cat || S.t || S.esf || S.prazo || S.vmin !== "" || S.srp || S.novo || S.ate80 || S.q);
const nomeTerritorio = () => (S.uf ? UF_NOME[S.uf] : S.reg ? `região ${S.reg}` : "Brasil");

/* ---------- carga de dados ---------- */
async function getJSON(url, opcional = false) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) {
    if (opcional && r.status === 404) return null;
    throw new Error(`${url}: HTTP ${r.status}`);
  }
  return r.json();
}

function carregarUF(uf) {
  if (carregando.has(uf)) return carregando.get(uf);
  const p = getJSON(`dados/uf/${uf}.json`, true)
    .then((j) => {
      dados.set(uf, (j?.editais || []).map((e) => {
        e._b = norm([e.objeto, e.orgao, e.municipio, e.unidade, e.modalidade, e.processo, `${e.numero || ""}/${e.ano || ""}`].join(" "));
        return e;
      }));
    })
    .catch((err) => { console.error(err); falhas.add(uf); dados.set(uf, []); });
  carregando.set(uf, p);
  p.then(() => { renderLista(); if (filtroAtivo()) atualizarPainel(); });
  return p;
}

async function carregarTodas() {
  const fila = [...ufsAtivas(), ...TODAS_UF].filter((u, i, a) => a.indexOf(u) === i && !carregando.has(u) && resumo.ufs[u]);
  const pool = Array.from({ length: 6 }, async () => { while (fila.length) await carregarUF(fila.shift()); });
  await Promise.all(pool);
}

const carregarMapaUF = (uf) => {
  if (!mapasUF.has(uf)) mapasUF.set(uf, getJSON(`mapas/uf/${uf}.json`));
  return mapasUF.get(uf);
};

/* ---------- estado e URL (o CNPJ nunca entra aqui) ---------- */
function lerHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  Object.assign(S, PADRAO, { limite: 30 });
  for (const k of Object.keys(PADRAO)) {
    if (!p.has(k)) continue;
    S[k] = typeof PADRAO[k] === "boolean" ? p.get(k) === "1" : p.get(k);
  }
  if (S.uf && !UF_NOME[S.uf]) S.uf = "";
  if (S.reg && !REGIAO[S.reg]) S.reg = "";
  if (S.uf) S.reg = "";
  if (!["n", "valor"].includes(S.m)) S.m = "n";
}

function gravarHash(empilhar) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(S)) {
    if (k === "limite" || v === PADRAO[k] || v === "" || v === false) continue;
    p.set(k, v === true ? "1" : v);
  }
  const url = p.toString() ? `#${p}` : location.pathname + location.search;
  history[empilhar ? "pushState" : "replaceState"](null, "", url);
}

function sincronizarControles() {
  $("fReg").value = S.reg; $("fUf").value = S.uf; $("fQ").value = S.q; $("fMod").value = S.mod; $("fCat").value = S.cat;
  $("fEsf").value = S.esf; $("fPrazo").value = S.prazo; $("fVmin").value = S.vmin; $("fSrp").checked = S.srp;
  $("fNovo").checked = S.novo; $("fOrd").value = S.ord;
  document.querySelector(`input[name=metrica][value=${S.m}]`).checked = true;
}

/* ---------- filtros ---------- */
function filtrados({ semMun = false } = {}) {
  const base = ufsAtivas().flatMap((u) => dados.get(u) || []);
  const tokens = norm(S.q).split(/\s+/).filter(Boolean);
  const vmin = S.vmin === "" ? null : Number(S.vmin);
  const hoje = meta.atualizado_em.slice(0, 10);
  const temas = temasSel();
  const lista = base.filter((e) => {
    if (!semMun && S.mun && e.ibge !== S.mun) return false;
    if (S.mod && e.modalidade !== S.mod) return false;
    if (S.cat && !e.cat.includes(S.cat)) return false;
    if (temas.length && !e.cat.some((c) => temas.includes(c))) return false;
    if (S.esf && e.esfera !== S.esf) return false;
    if (S.srp && !e.srp) return false;
    if (S.novo && e.visto !== hoje) return false;
    if (S.ate80 && !(e.valor != null && e.valor <= LIMITE_ME)) return false;
    if (vmin != null && !(e.valor != null && e.valor >= vmin)) return false;
    if (S.prazo) { const d = diasAte(e.encerramento); if (d == null || d < 0 || d > Number(S.prazo)) return false; }
    return tokens.every((t) => e._b.includes(t));
  });
  const chave = {
    encerramento: (a, b) => (a.encerramento || "9999").localeCompare(b.encerramento || "9999"),
    valor: (a, b) => (b.valor ?? -1) - (a.valor ?? -1),
    publicado: (a, b) => (b.publicado || "").localeCompare(a.publicado || ""),
  }[S.ord];
  return lista.sort(chave);
}

/** Totais por UF e municipio. Sem filtro: vem do resumo. Com filtro (e dados carregados): recalculado, e o mapa vira "mapa da busca". */
function agregados() {
  const alvo = ufsAtivas();
  if (!filtroAtivo() || !alvo.every((u) => dados.has(u))) return { fonte: "resumo", ufs: resumo.ufs };
  const hoje = meta.atualizado_em.slice(0, 10);
  const ufs = {};
  for (const e of filtrados({ semMun: true })) {
    const u = (ufs[e.uf] ||= { n: 0, valor: 0, novos: 0, municipios: {} });
    u.n++; u.valor += e.valor || 0; if (e.visto === hoje) u.novos++;
    const m = (u.municipios[e.ibge || "sem"] ||= { n: 0, valor: 0, nome: e.municipio });
    m.n++; m.valor += e.valor || 0;
  }
  return { fonte: "filtro", ufs };
}

const medida = (r) => (r ? (S.m === "valor" ? r.valor : r.n) : 0);
const fmtMedida = (v) => (S.m === "valor" ? fmtBRLc.format(v) : fmtInt.format(v));

/* ---------- cabecalho de atualizacao e KPIs ---------- */
function renderUpd() {
  $("upd").replaceChildren(
    h("span", null, "Dados do PNCP atualizados em ", h("b", null, dataHora(meta.atualizado_em))),
    h("span", null, meta.escopo === "saude" ? "Escopo: licitações de saúde" : "Escopo: todas as áreas"),
  );
  $("avisoDemo").hidden = !meta.demo;
  const msgs = [];
  const sem = Object.keys(meta.ufs_com_erro || {});
  if (sem.length) msgs.push(`Não foi possível atualizar ${sem.join(", ")} na última coleta. Esses estados mostram a coleta anterior.`);
  const idade = (Date.now() - new Date(meta.atualizado_em)) / 36e5;
  if (!meta.demo && idade > 48) msgs.push("A última coleta tem mais de 2 dias. Confira o prazo no PNCP antes de participar.");
  $("erro").hidden = !msgs.length;
  $("erro").textContent = msgs.join(" ");
}

function renderKpis() {
  const { fonte, ufs } = agregados();
  const alvo = ufsAtivas();
  const t = { n: 0, valor: 0, novos: 0, mun: 0 };
  for (const u of alvo) {
    const r = ufs[u];
    if (!r) continue;
    t.n += r.n; t.valor += r.valor; t.novos += r.novos;
    t.mun += Object.keys(r.municipios).filter((k) => k !== "sem").length;
  }
  const onde = S.uf ? `em ${UF_NOME[S.uf]}` : S.reg ? `na região ${S.reg}` : "no Brasil";
  $("kN").textContent = fmtInt.format(t.n);
  $("kNs").textContent = `${fonte === "filtro" ? "com os filtros atuais" : "propostas abertas"} ${onde}`;
  $("kV").textContent = fmtBRLc.format(t.valor);
  $("kM").textContent = fmtInt.format(t.mun);
  $("kMs").textContent = S.uf ? "com ao menos um edital aberto" : S.reg ? "na região" : "em todo o país";
  $("kNv").textContent = fmtInt.format(t.novos);
  $("kNvs").textContent = `vistos pela primeira vez em ${data(meta.atualizado_em)}`;
}

/* ---------- mapa e ranking ---------- */
function mostrarTip(item, ev) {
  const tip = $("tip");
  if (!item) { tip.hidden = true; return; }
  tip.replaceChildren(h("b", null, item.nome), item.linha);
  tip.hidden = false;
  const caixa = $("mapaBox").getBoundingClientRect();
  let x, y;
  if (ev?.focus) { const r = ev.focus.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
  else { x = ev.clientX; y = ev.clientY; }
  tip.style.left = `${Math.min(Math.max(x - caixa.left, 90), caixa.width - 90)}px`;
  tip.style.top = `${y - caixa.top}px`;
}

function legenda(esc) {
  const ul = $("legenda");
  ul.replaceChildren(h("li", null, h("i", { style: "background:var(--c0)" }), "Sem edital"));
  for (const f of esc.faixas) {
    const txt = f.a === f.b ? fmtMedida(f.a) : `${fmtMedida(f.a)} a ${fmtMedida(f.b)}`;
    ul.append(h("li", null, h("i", { style: `background:var(--c${f.c})` }), txt));
  }
}

async function renderMapa() {
  const meu = ++tokenMapa;
  const svg = $("mapa");
  const { fonte, ufs } = agregados();
  const aviso = filtroAtivo() && fonte === "resumo" ? " Carregando os editais para aplicar os filtros ao mapa." : (fonte === "filtro" ? " O mapa mostra apenas os editais que passam pelos filtros." : "");
  if (!S.uf) {
    const ativas = new Set(ufsAtivas());
    $("tMapa").textContent = S.reg ? `Mapa do Brasil: região ${S.reg}` : "Mapa do Brasil";
    $("dica").textContent = "Clique em um estado para ver os municípios e os editais. Use Tab e Enter para navegar pelo teclado." + aviso;
    const esc = escala(brasil.estados.filter((e) => ativas.has(e.uf)).map((e) => medida(ufs[e.uf])));
    const itens = brasil.estados.map((e) => {
      const r = ufs[e.uf];
      const n = r?.n || 0;
      const dentro = ativas.has(e.uf);
      return {
        key: e.uf, nome: e.nome, d: e.d, cx: e.cx, cy: e.cy, rotulo: e.uf, c: dentro ? esc.cls(medida(r)) : 0, fora: !dentro,
        aria: `${e.nome}: ${fmtInt.format(n)} editais${r?.valor ? `, ${fmtBRLc.format(r.valor)} estimados` : ""}${dentro ? "" : " (fora da região escolhida)"}`,
        linha: `${fmtInt.format(n)} editais${r?.valor ? ` · ${fmtBRLc.format(r.valor)}` : ""}`,
      };
    });
    legenda(esc);
    desenhar(svg, { viewBox: brasil.viewBox, modo: "brasil", itens, selecionado: "", onSelect: (uf) => escolherUF(uf), onTip: mostrarTip });
    svg.setAttribute("aria-label", "Mapa do Brasil com os estados coloridos pelo total de editais abertos");
  } else {
    $("tMapa").textContent = `Mapa de ${UF_NOME[S.uf]}, por município`;
    $("dica").textContent = "Clique em um município para filtrar os editais. Clique de novo para limpar." + aviso;
    let m;
    try { m = await carregarMapaUF(S.uf); } catch (e) { console.error(e); $("erro").hidden = false; $("erro").textContent = "Não foi possível carregar o mapa do estado."; return; }
    if (meu !== tokenMapa) return;
    const mp = ufs[S.uf]?.municipios || {};
    const esc = escala(m.municipios.map((x) => medida(mp[x.id])));
    const itens = m.municipios.map((x) => {
      const q = mp[x.id];
      return {
        key: x.id, nome: x.nome, d: x.d, c: esc.cls(medida(q)),
        aria: `${x.nome}: ${fmtInt.format(q?.n || 0)} editais`,
        linha: `${fmtInt.format(q?.n || 0)} editais${q?.valor ? ` · ${fmtBRLc.format(q.valor)}` : ""}`,
      };
    });
    legenda(esc);
    desenhar(svg, { viewBox: m.viewBox, modo: "uf", itens, selecionado: S.mun, onSelect: (id) => escolherMun(id), onTip: mostrarTip });
    svg.setAttribute("aria-label", `Mapa de ${UF_NOME[S.uf]} com os municípios coloridos pelo total de editais`);
    $("kMs").textContent = `de ${fmtInt.format(m.municipios.length)} municípios do estado`;
  }
  renderCrumbs();
}

function renderCrumbs() {
  const c = $("crumbs");
  c.replaceChildren(h("button", { class: "btn sec sm", type: "button", onclick: () => voltarBrasil(), disabled: !S.uf && !S.reg }, "Brasil"));
  if (S.reg) c.append("›", h("span", null, S.reg));
  if (S.uf) c.append("›", h("span", null, UF_NOME[S.uf]));
}

function renderRank() {
  const ol = $("rank");
  const { ufs } = agregados();
  $("btnVoltar").hidden = !S.uf && !S.reg;
  if (!S.uf) {
    $("tRank").textContent = S.reg ? `Estados: ${S.reg}` : "Ranking de estados";
    const linhas = ufsAtivas().map((uf) => ({ uf, nome: UF_NOME[uf], v: medida(ufs[uf]), n: ufs[uf]?.n || 0 }));
    linhas.sort((a, b) => b.v - a.v || a.nome.localeCompare(b.nome, "pt-BR"));
    const max = Math.max(1, ...linhas.map((l) => l.v));
    ol.replaceChildren(...linhas.map((l) => h("li", null,
      h("button", { type: "button", onclick: () => escolherUF(l.uf), "aria-label": `${l.nome}: ${fmtInt.format(l.n)} editais. Ver estado.` },
        h("span", { class: "u" }, l.uf),
        h("span", null, h("span", { class: "nm" }, l.nome), h("span", { class: "bar" }, h("i", { style: `width:${(l.v / max) * 100}%` }))),
        h("span", { class: "n" }, fmtMedida(l.v))))));
  } else {
    $("tRank").textContent = `Municípios de ${S.uf}`;
    const mp = ufs[S.uf]?.municipios || {};
    const linhas = Object.entries(mp).filter(([k]) => k !== "sem").map(([id, q]) => ({ id, nome: q.nome || id, v: medida(q), n: q.n }));
    linhas.sort((a, b) => b.v - a.v || a.nome.localeCompare(b.nome, "pt-BR"));
    const max = Math.max(1, ...linhas.map((l) => l.v));
    if (!linhas.length) { ol.replaceChildren(h("li", { class: "vazio" }, "Nenhum município com edital neste estado para o filtro atual.")); return; }
    ol.replaceChildren(...linhas.map((l, i) => h("li", null,
      h("button", { type: "button", "aria-pressed": String(S.mun === l.id), onclick: () => escolherMun(l.id), "aria-label": `${l.nome}: ${fmtInt.format(l.n)} editais` },
        h("span", { class: "u" }, `${i + 1}º`),
        h("span", null, h("span", { class: "nm", style: "color:var(--text);font-weight:600" }, l.nome), h("span", { class: "bar" }, h("i", { style: `width:${(l.v / max) * 100}%` }))),
        h("span", { class: "n" }, fmtMedida(l.v))))));
  }
}

const atualizarPainel = debounce(() => { renderKpis(); renderRank(); renderMapa(); }, 250);

/* ---------- navegacao ---------- */
function trocarVisao(fn) {
  const rodar = () => { fn(); return renderMapa(); };
  if (document.startViewTransition && !reduzido) document.startViewTransition(rodar);
  else rodar();
}

function renderTerritorio() {
  sincronizarControles(); renderKpis(); renderRank(); renderChips(); renderLista(); renderEmpresa();
}

function escolherUF(uf) {
  if (uf === S.uf) return;
  S.uf = uf; S.mun = ""; S.limite = 30;
  if (uf) S.reg = "";
  carregarTodas();
  gravarHash(true);
  trocarVisao(renderTerritorio);
  $("tMapa").setAttribute("tabindex", "-1");
  $("tMapa").focus({ preventScroll: true });
}

function escolherRegiao(reg) {
  S.reg = reg; S.uf = ""; S.mun = ""; S.limite = 30;
  carregarTodas();
  gravarHash(true);
  trocarVisao(renderTerritorio);
}

function voltarBrasil() {
  S.uf = ""; S.reg = ""; S.mun = ""; S.limite = 30;
  gravarHash(true);
  trocarVisao(renderTerritorio);
}

function escolherMun(id) {
  S.mun = S.mun === id ? "" : id; S.limite = 30;
  gravarHash(false);
  renderMapa(); renderRank(); renderChips(); renderLista();
}

/* ---------- lista ---------- */
function atualizarProgresso() {
  const alvo = ufsAtivas();
  const ok = alvo.filter((u) => dados.has(u) || !resumo.ufs[u]).length;
  $("prog").textContent = ok < alvo.length ? `Carregando editais dos estados: ${ok} de ${alvo.length}. A lista completa aparece em instantes.` : (falhas.size ? `Não foi possível carregar: ${[...falhas].join(", ")}.` : "");
}

function badgePrazo(iso) {
  const d = diasAte(iso);
  if (d == null) return h("span", { class: "prazo ok" }, "Prazo não informado");
  if (d < 0) return h("span", { class: "prazo bad" }, "Encerrado");
  if (d === 0) return h("span", { class: "prazo bad" }, "Encerra hoje");
  if (d === 1) return h("span", { class: "prazo bad" }, "Encerra amanhã");
  if (d <= 7) return h("span", { class: "prazo warn" }, `Encerra em ${d} dias`);
  return h("span", { class: "prazo ok" }, `${d} dias`);
}

const valorTxt = (e) => (e.valor != null ? fmtBRL.format(e.valor) : "Não informado");

function cartao(e) {
  const novo = e.visto === meta.atualizado_em.slice(0, 10);
  const mepp = empresa?.mepp && e.valor != null && e.valor <= LIMITE_ME;
  const resumo = resumirObjeto(e.objeto);
  const completo = (e.objeto || "").replace(/\s+/g, " ").trim();
  const mh = modH(e.modalidade);
  return h("li", { class: `ed${novo ? " novo" : ""}`, style: estiloH(ESFERA_H[e.esfera]) },
    h("div", { class: "ed-top" },
      novo && h("span", { class: "tag novo" }, "Novo"),
      e.esfera && h("span", { class: "tag esf" }, e.esfera),
      e.modalidade && h("span", { class: `tag mod${mh == null ? " sem" : ""}`, style: estiloH(mh) }, e.modalidade),
      e.srp && h("span", { class: "tag" }, "Registro de preços"),
      mepp && h("span", { class: "tag novo" }, "Até R$ 80 mil (ME/EPP)"),
      ...e.cat.filter((c) => c !== "orgao_saude").slice(0, 2).map((c) => h("span", { class: "tag" }, CATEGORIAS[c] || c))),
    h("div", { class: "contratante" },
      h("span", { class: "rot" }, "Contratante"),
      h("span", { class: "nome" }, e.orgao || "Órgão não informado"),
      h("span", { class: "loc" }, [e.unidade && e.unidade !== e.orgao ? e.unidade : "", `${e.municipio || "Município não informado"}/${e.uf || ""}`].filter(Boolean).join(" · "))),
    h("div", { class: "resumo" },
      h("span", { class: "rot" }, "Resumo do objeto"),
      h("p", null, resumo || "Objeto não informado")),
    completo && completo.length > resumo.length + 3 && h("details", { class: "completo" }, h("summary", null, "Ver objeto completo"), h("p", null, completo)),
    h("dl", { class: "kv" },
      h("div", null, h("dt", null, "Valor estimado"), h("dd", null, valorTxt(e))),
      h("div", null, h("dt", null, "Publicado em"), h("dd", null, data(e.publicado))),
      h("div", null, h("dt", null, "Propostas até"), h("dd", null, data(e.encerramento))),
      h("div", null, h("dt", null, "Prazo"), h("dd", null, badgePrazo(e.encerramento)))),
    h("div", { class: "acoes" },
      h("button", { class: "btn sm", type: "button", onclick: () => abrirDetalhe(e) }, "Ver detalhes"),
      e.link && h("a", { class: "btn sec sm", href: e.link, target: "_blank", rel: "noopener noreferrer", "data-conv": "editais_abrir_pncp" }, "Abrir no PNCP ↗")));
}

function renderLista() {
  atualizarProgresso();
  const lista = filtrados();
  const ul = $("lista");
  const incompleto = ufsAtivas().some((u) => !dados.has(u) && resumo.ufs[u]);
  const nome = S.mun ? (resumo.ufs[S.uf]?.municipios?.[S.mun]?.nome || "município") : nomeTerritorio();
  $("tRes").textContent = `Editais: ${nome}`;
  const soma = lista.reduce((s, e) => s + (e.valor || 0), 0);
  $("resSub").textContent = `${fmtInt.format(lista.length)} ${lista.length === 1 ? "edital" : "editais"} · valor estimado somado ${fmtBRL.format(soma)}`;
  ul.replaceChildren(...lista.slice(0, S.limite).map(cartao));
  if (!lista.length) {
    ul.replaceChildren(h("li", { class: "vazio" },
      incompleto ? "Carregando editais..." : h("span", null, h("b", null, "Nenhum edital encontrado. "), "Remova algum filtro, amplie o prazo ou escolha outro território no mapa.")));
  }
  const mais = $("btnMais");
  marcarLegCores();
  mais.hidden = lista.length <= S.limite;
  mais.textContent = `Mostrar mais (${fmtInt.format(lista.length - S.limite)} restantes)`;
}

function renderChips() {
  const temas = temasSel().map((t) => CATEGORIAS[t]).join(", ");
  const defs = [
    ["reg", S.reg && `Região: ${S.reg}`],
    ["uf", S.uf && `Estado: ${UF_NOME[S.uf]}`, () => { S.uf = ""; S.mun = ""; gravarHash(true); trocarVisao(renderTerritorio); }],
    ["mun", S.mun && `Município: ${resumo.ufs[S.uf]?.municipios?.[S.mun]?.nome || S.mun}`, () => escolherMun(S.mun)],
    ["q", S.q && `Busca: ${S.q}`], ["mod", S.mod && `Modalidade: ${S.mod}`],
    ["cat", S.cat && `Tema: ${CATEGORIAS[S.cat]}`], ["t", S.t && `Temas da empresa: ${temas}`],
    ["esf", S.esf && `Esfera: ${S.esf}`],
    ["prazo", S.prazo && `Propostas em até ${S.prazo === "1" ? "1 dia" : S.prazo + " dias"}`],
    ["vmin", S.vmin !== "" && `Valor mínimo: ${fmtBRL.format(Number(S.vmin))}`],
    ["srp", S.srp && "Registro de preços"], ["novo", S.novo && "Somente novos"],
    ["ate80", S.ate80 && "Valor total até R$ 80 mil"],
  ];
  $("chips").replaceChildren(...defs.filter(([, t]) => t).map(([k, t, fn]) =>
    h("span", { class: "chip" }, t, h("button", { type: "button", "aria-label": `Remover filtro: ${t}`, onclick: fn || (() => limparCampo(k)) }, "×"))));
}

function limparCampo(k) {
  S[k] = PADRAO[k]; S.limite = 30;
  if (k === "reg") S.mun = "";
  sincronizarControles(); gravarHash(false);
  if (k === "reg") { trocarVisao(renderTerritorio); return; }
  renderChips(); renderLista(); renderEmpresa(); atualizarPainel();
}

function aoFiltrar() {
  S.limite = 30;
  gravarHash(false); renderChips(); renderLista(); atualizarPainel();
}

/* ---------- empresa (CNPJ) ---------- */
const MSG_CNPJ = {
  nao_encontrado: "CNPJ não encontrado na base consultada. Confira o número ou escolha estado e temas manualmente.",
  limite: "O serviço de consulta atingiu o limite de uso. Tente de novo em alguns minutos ou escolha estado e temas manualmente.",
  tempo: "A consulta demorou demais. Tente de novo ou escolha estado e temas manualmente.",
  indisponivel: "Não foi possível consultar o CNPJ agora. Escolha estado e temas manualmente e tente de novo mais tarde.",
};

async function consultarCnpj(ev) {
  ev.preventDefault();
  const campo = $("fCnpj"), msg = $("cnpjMsg");
  const v = limpar(campo.value);
  if (!valido(v)) { msg.textContent = "CNPJ inválido. Confira os 14 caracteres e os dígitos finais."; campo.setAttribute("aria-invalid", "true"); return; }
  campo.removeAttribute("aria-invalid");
  pedidoCnpj?.abort();
  pedidoCnpj = new AbortController();
  const tempo = setTimeout(() => pedidoCnpj.abort(), 12000);
  $("btnCnpj").disabled = true;
  msg.textContent = "Consultando o CNPJ...";
  try {
    const emp = await buscarEmpresa(v, pedidoCnpj.signal);
    aplicarEmpresa(emp);
    msg.textContent = "";
  } catch (e) {
    msg.textContent = MSG_CNPJ[e instanceof ErroCnpj ? e.codigo : "indisponivel"];
  } finally {
    clearTimeout(tempo);
    $("btnCnpj").disabled = false;
  }
}

function aplicarEmpresa(emp) {
  empresa = emp;
  const r = temasDosCnaes([emp.principal, ...emp.secundarios]);
  empresa.temasAuto = r.temas;
  empresa.mapeados = r.mapeados;
  S.t = r.temas.join(",");
  S.ate80 = false; S.mun = ""; S.limite = 30;
  if (UF_NOME[emp.uf]) { S.uf = emp.uf; S.reg = ""; }
  carregarTodas();
  gravarHash(true);
  trocarVisao(renderTerritorio);
}

function removerEmpresa() {
  empresa = null; S.t = ""; S.ate80 = false; S.limite = 30;
  $("fCnpj").value = ""; $("cnpjMsg").textContent = "";
  gravarHash(false);
  renderChips(); renderLista(); renderEmpresa(); atualizarPainel();
}

function renderEmpresa() {
  const caixa = $("empResult");
  $("btnCnpjLimpar").hidden = !empresa;
  if (!empresa) { caixa.hidden = true; caixa.replaceChildren(); return; }
  const e = empresa;
  const ativa = norm(e.situacao).includes("ativa");
  const reg = regiaoDe(e.uf);
  const sel = new Set(temasSel());
  const escopo = (rotulo, ativo, fn) => h("button", { class: "btn sec sm", type: "button", "aria-pressed": String(ativo), onclick: fn }, rotulo);
  caixa.hidden = false;
  caixa.replaceChildren(...[
    h("div", { class: "emp-id" },
      h("b", null, e.razao || "Empresa"), e.fantasia && ` (${e.fantasia})`,
      h("span", { class: "emp-sub" }, `${formatar(e.cnpj)} · ${e.municipio || ""}/${e.uf || ""} · ${e.porte || "porte não informado"}`),
      e.situacao && h("span", { class: `tag${ativa ? "" : " warn"}` }, `Situação: ${e.situacao}`)),
    !ativa && e.situacao && h("p", { class: "emp-aviso" }, "A situação cadastral não é ativa. Uma empresa irregular não consegue ser habilitada em licitação."),
    h("p", { class: "emp-cnae" }, h("b", null, "Atividade principal: "), `${e.principal.codigo} ${e.principal.descricao}`,
      e.secundarios.length ? ` (e mais ${e.secundarios.length} atividades secundárias)` : ""),
    h("fieldset", { class: "emp-temas" },
      h("legend", null, e.mapeados ? "Temas de saúde ligados aos CNAEs (ajuste se precisar)" : "Nenhum CNAE tem equivalência na tabela de saúde. Escolha os temas manualmente"),
      ...Object.entries(CATEGORIAS).filter(([k]) => k !== "orgao_saude").map(([k, v]) =>
        h("label", { class: "chk" }, h("input", { type: "checkbox", checked: sel.has(k), onchange: (ev) => {
          const s = new Set(temasSel()); ev.target.checked ? s.add(k) : s.delete(k);
          S.t = [...s].join(","); S.limite = 30; gravarHash(false); renderChips(); renderLista(); atualizarPainel();
        } }), v))),
    h("div", { class: "emp-escopo", role: "group", "aria-label": "Onde procurar" },
      h("span", { class: "fl" }, "Onde procurar:"),
      UF_NOME[e.uf] && escopo(`Meu estado (${e.uf})`, S.uf === e.uf, () => escolherUF(e.uf)),
      reg && escopo(`Minha região (${reg})`, S.reg === reg && !S.uf, () => escolherRegiao(reg)),
      escopo("Brasil todo", !S.uf && !S.reg, voltarBrasil)),
    e.mepp && h("label", { class: "chk" }, h("input", { type: "checkbox", checked: S.ate80, onchange: (ev) => {
      S.ate80 = ev.target.checked; S.limite = 30; gravarHash(false); renderChips(); renderLista(); renderEmpresa(); atualizarPainel();
    } }), "Mostrar só editais de valor total até R$ 80 mil (referência para ME/EPP; a regra de exclusividade vale por item, confira o edital)"),
    h("p", { class: "emp-nota" }, "A aderência é uma aproximação: o CNAE descreve a atividade da empresa, não o objeto da licitação. O painel não verifica habilitação (certidões, cadastros, qualificação técnica).")
  ].filter(Boolean));
}

/* ---------- legenda de cores (tambem filtra) ---------- */
function montarLegCores() {
  const box = $("legCores");
  const alternar = (chave, valor) => { S[chave] = S[chave] === valor ? "" : valor; S.limite = 30; sincronizarControles(); aoFiltrar(); };
  const esf = Object.keys(ESFERA_H).map((n) => h("button", { type: "button", class: "tag esf", style: estiloH(ESFERA_H[n]), "data-esf": n, "aria-pressed": "false", onclick: () => alternar("esf", n) }, n));
  const mods = Object.keys(resumo.modalidades || {}).map((n) => { const mh = modH(n); return h("button", { type: "button", class: `tag mod${mh == null ? " sem" : ""}`, style: estiloH(mh), "data-mod": n, "aria-pressed": "false", onclick: () => alternar("mod", n) }, n); });
  box.replaceChildren(
    h("div", { class: "grp" }, h("span", { class: "t" }, "Esfera"), ...esf),
    h("div", { class: "grp" }, h("span", { class: "t" }, "Modalidade"), ...mods));
}
function marcarLegCores() {
  for (const b of $("legCores").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.esf ? S.esf === b.dataset.esf : S.mod === b.dataset.mod));
}

/* ---------- detalhe, CSV ---------- */
function abrirDetalhe(e) {
  $("dlgT").textContent = `${e.modalidade || "Contratação"} ${e.numero ? `nº ${e.numero}` : ""}`.trim();
  const origem = urlSegura(e.origem);
  const linha = (k, v) => v ? [h("dt", null, k), h("dd", null, v)] : [];
  $("dlgB").replaceChildren(
    h("div", { class: "resumo" }, h("span", { class: "rot" }, "Resumo do objeto"), h("p", null, resumirObjeto(e.objeto) || "Objeto não informado")),
    h("div", { class: "resumo" }, h("span", { class: "rot" }, "Objeto completo"), h("p", { class: "obj" }, e.objeto || "Objeto não informado")),
    h("dl", null,
      ...linha("Contratante", e.orgao), ...linha("Unidade", e.unidade),
      ...linha("Local", `${e.municipio || ""}/${e.uf || ""}`), ...linha("Esfera", e.esfera),
      ...linha("Valor estimado", valorTxt(e)), ...linha("Modo de disputa", e.disputa),
      ...linha("Processo", e.processo), ...linha("Situação", e.situacao),
      ...linha("Publicação no PNCP", dataHora(e.publicado)), ...linha("Início das propostas", dataHora(e.abertura)),
      ...linha("Fim das propostas", dataHora(e.encerramento)),
      ...linha("Temas", e.cat.map((c) => CATEGORIAS[c] || c).join(", ")), ...linha("Registro de preços", e.srp ? "Sim" : "Não")));
  $("dlgF").replaceChildren(...[
    e.link && h("a", { class: "btn", href: e.link, target: "_blank", rel: "noopener noreferrer", "data-conv": "editais_dialogo_pncp" }, "Abrir edital no PNCP ↗"),
    origem && h("a", { class: "btn sec", href: origem, target: "_blank", rel: "noopener noreferrer" }, "Sistema de origem ↗"),
    h("a", { class: "btn sec", href: "https://partelli.pro/#contato", "data-conv": "editais_analise" }, "Pedir análise deste edital"),
  ].filter(Boolean));
  $("dlg").showModal();
}

function exportarCsv() {
  const l = filtrados();
  const cab = ["UF", "Município", "Órgão", "Esfera", "Modalidade", "Número", "Objeto", "Valor estimado (R$)", "Publicação", "Propostas até", "Temas", "Link PNCP"];
  baixarCsv(`editais-${S.uf || S.reg || "brasil"}-${meta.atualizado_em.slice(0, 10)}.csv`.replace(/\s+/g, "-"), [cab, ...l.map((e) => [
    e.uf, e.municipio, e.orgao, e.esfera, e.modalidade, `${e.numero || ""}`, e.objeto,
    e.valor != null ? String(e.valor).replace(".", ",") : "", data(e.publicado), data(e.encerramento),
    e.cat.map((c) => CATEGORIAS[c] || c).join(", "), e.link || ""])]);
}

/* ---------- inicializacao ---------- */
function preencherSelects() {
  for (const r of Object.keys(REGIAO)) $("fReg").append(h("option", { value: r }, r));
  for (const [uf, nome] of Object.entries(UF_NOME)) $("fUf").append(h("option", { value: uf }, `${nome} (${uf})`));
  for (const m of Object.keys(resumo.modalidades || {})) $("fMod").append(h("option", { value: m }, m));
  montarLegCores();
  for (const [k, v] of Object.entries(CATEGORIAS)) if (!resumo.categorias || resumo.categorias[k]) $("fCat").append(h("option", { value: k }, v));
}

function ligarEventos() {
  const ligar = (id, chave) => $(id).addEventListener("change", (ev) => { S[chave] = ev.target.type === "checkbox" ? ev.target.checked : ev.target.value; aoFiltrar(); });
  $("fQ").addEventListener("input", debounce((ev) => { S.q = ev.target.value.trim(); aoFiltrar(); }, 200));
  $("fReg").addEventListener("change", (ev) => escolherRegiao(ev.target.value));
  $("fUf").addEventListener("change", (ev) => { if (ev.target.value) escolherUF(ev.target.value); else voltarBrasilMantendoRegiao(); });
  ligar("fMod", "mod"); ligar("fCat", "cat"); ligar("fEsf", "esf"); ligar("fPrazo", "prazo");
  ligar("fSrp", "srp"); ligar("fNovo", "novo"); ligar("fOrd", "ord");
  $("fVmin").addEventListener("input", debounce((ev) => { S.vmin = ev.target.value; aoFiltrar(); }, 250));
  $("btnLimpar").addEventListener("click", () => {
    const { uf, reg, m } = S;
    Object.assign(S, PADRAO, { uf, reg, m, limite: 30 });
    sincronizarControles(); gravarHash(false); renderChips(); renderLista(); renderEmpresa(); atualizarPainel();
  });
  $("btnMais").addEventListener("click", () => { S.limite += 30; renderLista(); });
  $("btnVoltar").addEventListener("click", voltarBrasil);
  $("btnCsv").addEventListener("click", exportarCsv);
  $("formCnpj").addEventListener("submit", consultarCnpj);
  $("fCnpj").addEventListener("input", (ev) => { ev.target.value = formatar(ev.target.value); });
  $("btnCnpjLimpar").addEventListener("click", removerEmpresa);
  $("dlgX").addEventListener("click", () => $("dlg").close());
  $("dlg").addEventListener("click", (ev) => { if (ev.target === $("dlg")) $("dlg").close(); });
  document.querySelectorAll("input[name=metrica]").forEach((r) => r.addEventListener("change", () => { S.m = r.value; gravarHash(false); renderMapa(); renderRank(); }));
  addEventListener("popstate", () => { lerHash(); carregarTodas(); renderTudo(); });
}

function voltarBrasilMantendoRegiao() {
  S.uf = ""; S.mun = ""; S.limite = 30;
  gravarHash(true);
  trocarVisao(renderTerritorio);
}

function renderTudo() {
  renderUpd();
  sincronizarControles();
  renderKpis(); renderRank(); renderChips(); renderLista(); renderEmpresa();
  return renderMapa();
}

async function iniciar() {
  try {
    [meta, resumo, brasil] = await Promise.all([getJSON("dados/meta.json"), getJSON("dados/resumo.json"), getJSON("mapas/brasil.json")]);
  } catch (e) {
    console.error(e);
    $("upd").textContent = "Ainda não há dados coletados.";
    $("erro").hidden = false;
    $("erro").textContent = "Os dados do PNCP ainda não foram publicados. Rode o robô de coleta (ou aguarde a próxima execução agendada) e recarregue a página.";
    return;
  }
  preencherSelects();
  lerHash();
  ligarEventos();
  carregarTodas();
  await renderTudo();
}

iniciar();
