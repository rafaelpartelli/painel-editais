// Painel de Editais de Saude: mapa Brasil/UF + filtros + lista. Sem framework, sem build.
import {
  fmtInt, fmtBRL, fmtBRLc, UF_NOME, CATEGORIAS, norm, data, dataHora, diasAte, urlSegura,
  h, debounce, escala, baixarCsv,
} from "./util.js";
import { desenhar } from "./mapa.js";

const $ = (id) => document.getElementById(id);
const PADRAO = { uf: "", mun: "", q: "", mod: "", cat: "", esf: "", prazo: "", vmin: "", srp: false, novo: false, ord: "encerramento", m: "n" };
const S = { ...PADRAO, limite: 30 };

let meta, resumo, brasil;
const dados = new Map();      // uf -> editais[]
const carregando = new Map(); // uf -> Promise
const mapasUF = new Map();
const falhas = new Set();
let tokenMapa = 0;

const reduzido = matchMedia("(prefers-reduced-motion: reduce)").matches;

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
      const lista = (j?.editais || []).map((e) => {
        e._b = norm([e.objeto, e.orgao, e.municipio, e.unidade, e.modalidade, e.processo, `${e.numero || ""}/${e.ano || ""}`].join(" "));
        return e;
      });
      dados.set(uf, lista);
    })
    .catch((err) => { console.error(err); falhas.add(uf); dados.set(uf, []); });
  carregando.set(uf, p);
  p.then(() => { atualizarProgresso(); renderLista(); });
  return p;
}

async function carregarTodas() {
  const fila = Object.keys(resumo.ufs).filter((u) => !carregando.has(u));
  const pool = Array.from({ length: 6 }, async () => { while (fila.length) await carregarUF(fila.shift()); });
  await Promise.all(pool);
}

async function carregarMapaUF(uf) {
  if (!mapasUF.has(uf)) mapasUF.set(uf, getJSON(`mapas/uf/${uf}.json`));
  return mapasUF.get(uf);
}

/* ---------- estado e URL ---------- */
function lerHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  Object.assign(S, PADRAO, { limite: 30 });
  for (const k of Object.keys(PADRAO)) {
    if (!p.has(k)) continue;
    S[k] = typeof PADRAO[k] === "boolean" ? p.get(k) === "1" : p.get(k);
  }
  if (S.uf && !UF_NOME[S.uf]) S.uf = "";
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
  $("fUf").value = S.uf; $("fQ").value = S.q; $("fMod").value = S.mod; $("fCat").value = S.cat; $("fEsf").value = S.esf;
  $("fPrazo").value = S.prazo; $("fVmin").value = S.vmin; $("fSrp").checked = S.srp; $("fNovo").checked = S.novo;
  $("fOrd").value = S.ord;
  document.querySelector(`input[name=metrica][value=${S.m}]`).checked = true;
}

/* ---------- agregados ---------- */
function totais() {
  const zero = { n: 0, valor: 0, novos: 0, municipios: {} };
  if (S.uf) return resumo.ufs[S.uf] || zero;
  const t = { ...zero, municipios: {} };
  for (const [uf, r] of Object.entries(resumo.ufs)) {
    t.n += r.n; t.valor += r.valor; t.novos += r.novos;
    for (const k of Object.keys(r.municipios)) t.municipios[`${uf}${k}`] = 1;
  }
  return t;
}

const medida = (r) => (r ? (S.m === "valor" ? r.valor : r.n) : 0);
const fmtMedida = (v) => (S.m === "valor" ? fmtBRLc.format(v) : fmtInt.format(v));

/* ---------- cabecalho de atualizacao e KPIs ---------- */
function renderUpd() {
  const caixa = $("upd");
  caixa.replaceChildren(
    h("span", null, "Dados do PNCP atualizados em ", h("b", null, dataHora(meta.atualizado_em))),
    h("span", null, meta.escopo === "saude" ? "Escopo: licitações de saúde" : "Escopo: todas as áreas"),
  );
  $("avisoDemo").hidden = !meta.demo;
  const erro = $("erro");
  const msgs = [];
  const sem = Object.keys(meta.ufs_com_erro || {});
  if (sem.length) msgs.push(`Não foi possível atualizar ${sem.join(", ")} na última coleta. Esses estados mostram a coleta anterior.`);
  const idade = (Date.now() - new Date(meta.atualizado_em)) / 36e5;
  if (!meta.demo && idade > 48) msgs.push("A última coleta tem mais de 2 dias. Confira o prazo no PNCP antes de participar.");
  erro.hidden = !msgs.length;
  erro.textContent = msgs.join(" ");
}

function renderKpis() {
  const t = totais();
  const onde = S.uf ? `em ${UF_NOME[S.uf]}` : "no Brasil";
  $("kN").textContent = fmtInt.format(t.n);
  $("kNs").textContent = `propostas abertas ${onde}`;
  $("kV").textContent = fmtBRLc.format(t.valor);
  const nm = Object.keys(t.municipios).filter((k) => !k.endsWith("sem")).length;
  $("kM").textContent = fmtInt.format(nm);
  $("kMs").textContent = S.uf ? "com ao menos um edital aberto" : "em todo o país";
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
  ul.replaceChildren(h("li", null, h("i", { class: "c0", style: "background:var(--c0)" }), "Sem edital"));
  for (const f of esc.faixas) {
    const txt = f.a === f.b ? fmtMedida(f.a) : `${fmtMedida(f.a)} a ${fmtMedida(f.b)}`;
    ul.append(h("li", null, h("i", { style: `background:var(--c${f.c})` }), txt));
  }
}

async function renderMapa() {
  const meu = ++tokenMapa;
  const svg = $("mapa");
  if (!S.uf) {
    $("tMapa").textContent = "Mapa do Brasil";
    $("dica").textContent = "Clique em um estado para ver os municípios e os editais. Use Tab e Enter para navegar pelo teclado.";
    const esc = escala(brasil.estados.map((e) => medida(resumo.ufs[e.uf])));
    const itens = brasil.estados.map((e) => {
      const r = resumo.ufs[e.uf];
      const n = r?.n || 0;
      return {
        key: e.uf, nome: e.nome, d: e.d, cx: e.cx, cy: e.cy, rotulo: e.uf, c: esc.cls(medida(r)),
        aria: `${e.nome}: ${fmtInt.format(n)} editais abertos${r?.valor ? `, ${fmtBRLc.format(r.valor)} estimados` : ""}`,
        linha: `${fmtInt.format(n)} editais${r?.valor ? ` · ${fmtBRLc.format(r.valor)}` : ""}`,
      };
    });
    legenda(esc);
    desenhar(svg, { viewBox: brasil.viewBox, modo: "brasil", itens, selecionado: "", onSelect: (uf) => escolherUF(uf), onTip: mostrarTip });
    svg.setAttribute("aria-label", "Mapa do Brasil com os estados coloridos pelo total de editais abertos");
  } else {
    $("tMapa").textContent = `Mapa de ${UF_NOME[S.uf]}, por município`;
    $("dica").textContent = "Clique em um município para filtrar os editais. Clique de novo para limpar.";
    let m;
    try { m = await carregarMapaUF(S.uf); } catch (e) { console.error(e); $("erro").hidden = false; $("erro").textContent = "Não foi possível carregar o mapa do estado."; return; }
    if (meu !== tokenMapa) return;
    const r = resumo.ufs[S.uf];
    const mp = r?.municipios || {};
    const esc = escala(m.municipios.map((x) => medida(mp[x.id])));
    const itens = m.municipios.map((x) => {
      const q = mp[x.id];
      return {
        key: x.id, nome: x.nome, d: x.d, c: esc.cls(medida(q)),
        aria: `${x.nome}: ${fmtInt.format(q?.n || 0)} editais abertos`,
        linha: `${fmtInt.format(q?.n || 0)} editais${q?.valor ? ` · ${fmtBRLc.format(q.valor)}` : ""}`,
      };
    });
    legenda(esc);
    desenhar(svg, { viewBox: m.viewBox, modo: "uf", itens, selecionado: S.mun, onSelect: (id) => escolherMun(id), onTip: mostrarTip });
    svg.setAttribute("aria-label", `Mapa de ${UF_NOME[S.uf]} com os municípios coloridos pelo total de editais abertos`);
    $("kMs").textContent = `de ${fmtInt.format(m.municipios.length)} municípios do estado`;
  }
  renderCrumbs();
}

function renderCrumbs() {
  const c = $("crumbs");
  c.replaceChildren(h("button", { class: "btn sec sm", type: "button", onclick: () => escolherUF(""), disabled: !S.uf }, "Brasil"));
  if (S.uf) c.append("›", h("span", null, UF_NOME[S.uf]));
}

function renderRank() {
  const ol = $("rank");
  $("btnVoltar").hidden = !S.uf;
  if (!S.uf) {
    $("tRank").textContent = "Ranking de estados";
    const linhas = Object.entries(UF_NOME).map(([uf, nome]) => ({ uf, nome, v: medida(resumo.ufs[uf]), n: resumo.ufs[uf]?.n || 0 }));
    linhas.sort((a, b) => b.v - a.v || a.nome.localeCompare(b.nome, "pt-BR"));
    const max = Math.max(1, ...linhas.map((l) => l.v));
    ol.replaceChildren(...linhas.map((l) => h("li", null,
      h("button", { type: "button", onclick: () => escolherUF(l.uf), "aria-label": `${l.nome}: ${fmtInt.format(l.n)} editais abertos. Ver estado.` },
        h("span", { class: "u" }, l.uf),
        h("span", null, h("span", { class: "nm" }, l.nome), h("span", { class: "bar" }, h("i", { style: `width:${(l.v / max) * 100}%` }))),
        h("span", { class: "n" }, fmtMedida(l.v))))));
  } else {
    $("tRank").textContent = `Municípios de ${S.uf}`;
    const mp = resumo.ufs[S.uf]?.municipios || {};
    const linhas = Object.entries(mp).filter(([k]) => k !== "sem").map(([id, q]) => ({ id, nome: q.nome || id, v: medida(q), n: q.n }));
    linhas.sort((a, b) => b.v - a.v || a.nome.localeCompare(b.nome, "pt-BR"));
    const max = Math.max(1, ...linhas.map((l) => l.v));
    if (!linhas.length) { ol.replaceChildren(h("li", { class: "vazio" }, "Nenhum município com edital aberto neste estado na última coleta.")); return; }
    ol.replaceChildren(...linhas.map((l, i) => h("li", null,
      h("button", { type: "button", "aria-pressed": String(S.mun === l.id), onclick: () => escolherMun(l.id), "aria-label": `${l.nome}: ${fmtInt.format(l.n)} editais abertos` },
        h("span", { class: "u" }, `${i + 1}º`),
        h("span", null, h("span", { class: "nm", style: "color:var(--text);font-weight:600" }, l.nome), h("span", { class: "bar" }, h("i", { style: `width:${(l.v / max) * 100}%` }))),
        h("span", { class: "n" }, fmtMedida(l.v))))));
  }
}

/* ---------- navegacao ---------- */
function trocarVisao(fn) {
  const rodar = () => { fn(); return renderMapa(); };
  if (document.startViewTransition && !reduzido) document.startViewTransition(rodar);
  else rodar();
}

function escolherUF(uf) {
  if (uf === S.uf) return;
  S.uf = uf; S.mun = ""; S.limite = 30;
  $("fUf").value = uf;
  if (uf) carregarUF(uf);
  gravarHash(true);
  trocarVisao(() => { renderKpis(); renderRank(); renderChips(); renderLista(); });
  $("tMapa").setAttribute("tabindex", "-1");
  $("tMapa").focus({ preventScroll: true });
}

function escolherMun(id) {
  S.mun = S.mun === id ? "" : id; S.limite = 30;
  gravarHash(false);
  renderMapa(); renderRank(); renderChips(); renderLista();
}

/* ---------- filtros e lista ---------- */
function filtrados() {
  const base = S.uf ? dados.get(S.uf) || [] : [...dados.values()].flat();
  const tokens = norm(S.q).split(/\s+/).filter(Boolean);
  const vmin = S.vmin === "" ? null : Number(S.vmin);
  const hoje = meta.atualizado_em.slice(0, 10);
  const lista = base.filter((e) => {
    if (S.mun && e.ibge !== S.mun) return false;
    if (S.mod && e.modalidade !== S.mod) return false;
    if (S.cat && !e.cat.includes(S.cat)) return false;
    if (S.esf && e.esfera !== S.esf) return false;
    if (S.srp && !e.srp) return false;
    if (S.novo && e.visto !== hoje) return false;
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

function atualizarProgresso() {
  const alvo = S.uf ? [S.uf] : Object.keys(resumo.ufs);
  const ok = alvo.filter((u) => dados.has(u)).length;
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
  const hoje = meta.atualizado_em.slice(0, 10);
  const novo = e.visto === hoje;
  return h("li", { class: `ed${novo ? " novo" : ""}` },
    h("div", { class: "ed-top" },
      novo && h("span", { class: "tag novo" }, "Novo"),
      e.modalidade && h("span", { class: "tag mod" }, e.modalidade),
      e.esfera && h("span", { class: "tag" }, e.esfera),
      e.srp && h("span", { class: "tag" }, "Registro de preços"),
      ...e.cat.filter((c) => c !== "orgao_saude").slice(0, 2).map((c) => h("span", { class: "tag" }, CATEGORIAS[c] || c))),
    h("h3", null, e.objeto || "Objeto não informado"),
    h("p", { class: "org" }, `${e.orgao || "Órgão não informado"} · ${e.municipio || "Município não informado"}/${e.uf || ""}`),
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
  const alvo = S.uf ? [S.uf] : Object.keys(resumo.ufs);
  const incompleto = alvo.some((u) => !dados.has(u));
  const nome = S.mun ? (resumo.ufs[S.uf]?.municipios?.[S.mun]?.nome || "município") : S.uf ? UF_NOME[S.uf] : "Brasil";
  $("tRes").textContent = `Editais: ${nome}`;
  const soma = lista.reduce((s, e) => s + (e.valor || 0), 0);
  $("resSub").textContent = `${fmtInt.format(lista.length)} ${lista.length === 1 ? "edital" : "editais"} · valor estimado somado ${fmtBRL.format(soma)}`;
  ul.replaceChildren(...lista.slice(0, S.limite).map(cartao));
  if (!lista.length) {
    ul.replaceChildren(h("li", { class: "vazio" },
      incompleto ? "Carregando editais..." : h("span", null, h("b", null, "Nenhum edital encontrado. "), "Remova algum filtro, amplie o prazo ou escolha outro território no mapa.")));
  }
  const mais = $("btnMais");
  mais.hidden = lista.length <= S.limite;
  mais.textContent = `Mostrar mais (${fmtInt.format(lista.length - S.limite)} restantes)`;
}

function renderChips() {
  const defs = [
    ["uf", S.uf && `Estado: ${UF_NOME[S.uf]}`, () => escolherUF("")],
    ["mun", S.mun && `Município: ${resumo.ufs[S.uf]?.municipios?.[S.mun]?.nome || S.mun}`, () => escolherMun(S.mun)],
    ["q", S.q && `Busca: ${S.q}`], ["mod", S.mod && `Modalidade: ${S.mod}`],
    ["cat", S.cat && `Tema: ${CATEGORIAS[S.cat]}`], ["esf", S.esf && `Esfera: ${S.esf}`],
    ["prazo", S.prazo && `Propostas em até ${S.prazo === "1" ? "1 dia" : S.prazo + " dias"}`],
    ["vmin", S.vmin !== "" && `Valor mínimo: ${fmtBRL.format(Number(S.vmin))}`],
    ["srp", S.srp && "Registro de preços"], ["novo", S.novo && "Somente novos"],
  ];
  $("chips").replaceChildren(...defs.filter(([, t]) => t).map(([k, t, fn]) =>
    h("span", { class: "chip" }, t, h("button", { type: "button", "aria-label": `Remover filtro: ${t}`, onclick: fn || (() => { limparCampo(k); }) }, "×"))));
}

function limparCampo(k) {
  S[k] = PADRAO[k]; S.limite = 30;
  sincronizarControles(); gravarHash(false); renderChips(); renderLista();
}

function aoFiltrar() {
  S.limite = 30;
  gravarHash(false); renderChips(); renderLista();
}

/* ---------- detalhe, CSV ---------- */
function abrirDetalhe(e) {
  $("dlgT").textContent = `${e.modalidade || "Contratação"} ${e.numero ? `nº ${e.numero}` : ""}`.trim();
  const origem = urlSegura(e.origem);
  const linha = (k, v) => v ? [h("dt", null, k), h("dd", null, v)] : [];
  $("dlgB").replaceChildren(
    h("p", { class: "obj" }, e.objeto || "Objeto não informado"),
    h("dl", null,
      ...linha("Órgão", e.orgao), ...linha("Unidade", e.unidade),
      ...linha("Local", `${e.municipio || ""}/${e.uf || ""}`), ...linha("Esfera", e.esfera),
      ...linha("Valor estimado", valorTxt(e)), ...linha("Modo de disputa", e.disputa),
      ...linha("Processo", e.processo), ...linha("Situação", e.situacao),
      ...linha("Publicação no PNCP", dataHora(e.publicado)), ...linha("Início das propostas", dataHora(e.abertura)),
      ...linha("Fim das propostas", dataHora(e.encerramento)),
      ...linha("Temas", e.cat.map((c) => CATEGORIAS[c] || c).join(", ")), ...linha("Registro de preços", e.srp ? "Sim" : "Não")));
  $("dlgF").replaceChildren(
    e.link && h("a", { class: "btn", href: e.link, target: "_blank", rel: "noopener noreferrer", "data-conv": "editais_dialogo_pncp" }, "Abrir edital no PNCP ↗"),
    origem && h("a", { class: "btn sec", href: origem, target: "_blank", rel: "noopener noreferrer" }, "Sistema de origem ↗"),
    h("a", { class: "btn sec", href: `https://partelli.pro/#contato`, "data-conv": "editais_analise" }, "Pedir análise deste edital"));
  $("dlg").showModal();
}

function exportarCsv() {
  const l = filtrados();
  const cab = ["UF", "Município", "Órgão", "Esfera", "Modalidade", "Número", "Objeto", "Valor estimado (R$)", "Publicação", "Propostas até", "Temas", "Link PNCP"];
  baixarCsv(`editais-${S.uf || "brasil"}-${meta.atualizado_em.slice(0, 10)}.csv`, [cab, ...l.map((e) => [
    e.uf, e.municipio, e.orgao, e.esfera, e.modalidade, `${e.numero || ""}`, e.objeto,
    e.valor != null ? String(e.valor).replace(".", ",") : "", data(e.publicado), data(e.encerramento),
    e.cat.map((c) => CATEGORIAS[c] || c).join(", "), e.link || ""])]);
}

/* ---------- inicializacao ---------- */
function preencherSelects() {
  for (const [uf, nome] of Object.entries(UF_NOME)) $("fUf").append(h("option", { value: uf }, `${nome} (${uf})`));
  for (const m of Object.keys(resumo.modalidades || {})) $("fMod").append(h("option", { value: m }, m));
  for (const [k, v] of Object.entries(CATEGORIAS)) if (!resumo.categorias || resumo.categorias[k]) $("fCat").append(h("option", { value: k }, v));
}

function ligarEventos() {
  const ligar = (id, chave, tipo = "change", cond = (v) => v) => $(id).addEventListener(tipo, (ev) => { S[chave] = cond(ev.target.type === "checkbox" ? ev.target.checked : ev.target.value); aoFiltrar(); });
  $("fQ").addEventListener("input", debounce((ev) => { S.q = ev.target.value.trim(); aoFiltrar(); }, 200));
  $("fUf").addEventListener("change", (ev) => escolherUF(ev.target.value));
  ligar("fMod", "mod"); ligar("fCat", "cat"); ligar("fEsf", "esf"); ligar("fPrazo", "prazo");
  ligar("fSrp", "srp"); ligar("fNovo", "novo"); ligar("fOrd", "ord");
  $("fVmin").addEventListener("input", debounce((ev) => { S.vmin = ev.target.value; aoFiltrar(); }, 250));
  $("btnLimpar").addEventListener("click", () => { const uf = S.uf, m = S.m; Object.assign(S, PADRAO, { uf, m, limite: 30 }); sincronizarControles(); aoFiltrar(); renderMapa(); renderRank(); });
  $("btnMais").addEventListener("click", () => { S.limite += 30; renderLista(); });
  $("btnVoltar").addEventListener("click", () => escolherUF(""));
  $("btnCsv").addEventListener("click", exportarCsv);
  $("dlgX").addEventListener("click", () => $("dlg").close());
  $("dlg").addEventListener("click", (ev) => { if (ev.target === $("dlg")) $("dlg").close(); });
  document.querySelectorAll("input[name=metrica]").forEach((r) => r.addEventListener("change", () => { S.m = r.value; gravarHash(false); renderMapa(); renderRank(); }));
  addEventListener("popstate", () => { lerHash(); sincronizarControles(); if (S.uf) carregarUF(S.uf); renderTudo(); });
}

function renderTudo() {
  renderUpd(); renderKpis(); renderRank(); renderChips(); renderLista();
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
  sincronizarControles();
  ligarEventos();
  if (S.uf) carregarUF(S.uf);
  await renderTudo();
  carregarTodas();
}

iniciar();
