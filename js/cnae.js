// Ponte entre a atividade da empresa (CNAE) e os temas de edital do painel.
// TABELA INICIAL, por classe (4 primeiros digitos) ou divisao (2 digitos). Precisa de revisao e de medicao
// de acerto com empresas reais. O resultado e uma aproximacao: CNAE nao e objeto de licitacao.
const POR_CLASSE = {
  "2121": ["medicamentos"], "2123": ["medicamentos"],
  "2660": ["equipamentos"], "3250": ["material_hospitalar", "equipamentos"],
  "4644": ["medicamentos"], "4645": ["material_hospitalar", "equipamentos"],
  "4771": ["medicamentos"], "4773": ["material_hospitalar"],
  "5620": ["alimentacao_nutricao"],
  "6201": ["ti_saude"], "6202": ["ti_saude"], "6203": ["ti_saude"], "6204": ["ti_saude"],
  "6209": ["ti_saude"], "6311": ["ti_saude"],
  "8610": ["servicos_saude"], "8621": ["transporte_sanitario", "servicos_saude"],
  "8630": ["servicos_saude"], "8640": ["servicos_saude"], "8650": ["servicos_saude"],
  "8660": ["servicos_saude", "ti_saude"], "8690": ["servicos_saude"],
};
const POR_DIVISAO = { "41": ["obras_saude"], "42": ["obras_saude"], "43": ["obras_saude"] };

export function temasDoCnae(codigo) {
  const c = String(codigo || "").replace(/\D/g, "").padStart(7, "0");
  return POR_CLASSE[c.slice(0, 4)] || POR_DIVISAO[c.slice(0, 2)] || [];
}

/** @returns {{temas:string[], mapeados:number, total:number}} */
export function temasDosCnaes(cnaes) {
  const temas = new Set();
  let mapeados = 0;
  for (const c of cnaes) {
    const t = temasDoCnae(c.codigo);
    if (t.length) mapeados++;
    t.forEach((x) => temas.add(x));
  }
  return { temas: [...temas], mapeados, total: cnaes.length };
}
