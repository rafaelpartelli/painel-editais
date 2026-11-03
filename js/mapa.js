// Desenha o mapa (Brasil ou municipios de uma UF) em SVG, com acesso por mouse, toque e teclado.
const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/**
 * @param {SVGSVGElement} svg
 * @param {{viewBox:string, modo:'brasil'|'uf', itens:Array, selecionado?:string,
 *          onSelect:(key:string)=>void, onTip:(item:object|null, ev?:Event)=>void}} o
 * Cada item: {key, d, c (classe 0-5), aria, cx?, cy?, rotulo?}
 */
export function desenhar(svg, o) {
  svg.replaceChildren();
  svg.setAttribute("viewBox", o.viewBox);
  svg.classList.toggle("uf-view", o.modo === "uf");
  const porKey = new Map(o.itens.map((i) => [i.key, i]));

  const g = el("g", {});
  for (const i of o.itens) {
    const p = el("path", { d: i.d, class: `e c${i.c}${i.fora ? " fora" : ""}`, "data-k": i.key, "data-c": i.c, "aria-label": i.aria });
    if (i.c > 0 || o.modo === "brasil") { p.setAttribute("tabindex", "0"); p.setAttribute("role", "button"); }
    if (i.key === o.selecionado) { p.classList.add("sel"); p.setAttribute("aria-pressed", "true"); }
    else if (p.getAttribute("role")) p.setAttribute("aria-pressed", "false");
    g.append(p);
  }
  svg.append(g);

  // O traco da selecao precisa ficar por cima dos vizinhos
  const sel = g.querySelector(".sel");
  if (sel) g.append(sel);

  if (o.modo === "brasil") {
    const t = el("g", { "aria-hidden": "true" });
    for (const i of o.itens) {
      const x = el("text", { x: i.cx, y: i.cy });
      x.textContent = i.rotulo;
      t.append(x);
    }
    svg.append(t);
  }

  const alvo = (ev) => ev.target.closest?.("path.e");
  svg.onclick = (ev) => { const p = alvo(ev); if (p && (o.modo === "brasil" || p.dataset.c !== "0")) o.onSelect(p.dataset.k); };
  svg.onkeydown = (ev) => {
    const p = alvo(ev);
    if (p && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); o.onSelect(p.dataset.k); }
  };
  svg.onpointermove = (ev) => { const p = alvo(ev); o.onTip(p ? porKey.get(p.dataset.k) : null, ev); };
  svg.onpointerleave = () => o.onTip(null);
  svg.onfocusin = (ev) => { const p = alvo(ev); if (p) o.onTip(porKey.get(p.dataset.k), { focus: p }); };
  svg.onfocusout = () => o.onTip(null);
}
