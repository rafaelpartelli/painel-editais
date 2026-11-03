# Painel de Editais de Saúde

Painel estático para clientes pesquisarem licitações abertas por estado e município, com dados da API de Consulta do PNCP. Sem servidor e sem banco: um robô grava arquivos JSON e a página os lê.

## Como funciona

1. `robo/coletar_editais.py` consulta `contratacoes/proposta` do PNCP para as 27 UFs, filtra o escopo de saúde (`robo/config.json`) e grava `dados/uf/<UF>.json`, `dados/resumo.json` e `dados/meta.json`.
2. A página (`index.html`, `js/`, `css/`) lê esses arquivos e desenha o mapa do Brasil e o mapa de cada estado (`mapas/`).
3. Se uma UF falhar na coleta, o robô mantém o arquivo anterior daquela UF e registra o erro em `meta.json` (a página avisa).

## Publicar

**Opção A, GitHub + Hostinger (recomendada).**
1. Crie o repositório e envie esta pasta.
2. Em *Actions*, rode "Coletar editais do PNCP" uma vez (`Run workflow`) e confira se `dados/` foi preenchido. Depois ele roda sozinho às 08:15 e 17:15 (Brasília).
3. Na Hostinger (hPanel), conecte o repositório em *Git* e ative a implantação automática para a pasta do site com pasta de instalação `editais`, para abrir em `partelli.pro/editais`. Cada coleta gera um commit e a Hostinger publica sozinha.

**Opção B, robô no seu computador.** Se o PNCP recusar as conexões do GitHub (mesmo padrão dos robôs do DOU e do InvestSUS), agende `robo/rodar_local.sh` no cron da máquina Server. O restante do fluxo é igual.

## Testar sem rede

```
python3 tests/mock_pncp.py 8765 &
python3 robo/coletar_editais.py --base-url http://127.0.0.1:8765/api/consulta/v1 --saida /tmp/dados_demo
```
Dados gerados com `--base-url` diferente do PNCP recebem `demo: true` e a página exibe a faixa "DADOS DE DEMONSTRAÇÃO". Nunca publique essa saída.

## Filtros, região e empresa (CNPJ)

- **Região e estado:** os seletores e o mapa filtram a lista, os totais, o ranking e o mapa. Escolher um estado limpa a região.
- **Mapa da busca:** com qualquer filtro ativo e os dados carregados, o mapa passa a colorir só o que passa pelos filtros.
- **Empresa:** o campo de CNPJ consulta o cadastro no navegador (`js/cnpj.js`, hoje via BrasilAPI), converte os CNAEs em temas (`js/cnae.js`, tabela inicial a revisar) e aplica estado e temas. O CNPJ não é guardado nem vai para a URL.
- **Trocar a fonte do CNPJ:** reescreva `buscarEmpresa()` em `js/cnpj.js` (por exemplo, para ler uma base da Receita pré-processada pelo robô). O restante do painel não muda.
- **Aviso de LGPD:** o número digitado é enviado do navegador do usuário ao serviço de consulta. O texto da página informa isso.

## Ajustes comuns

- Todas as áreas (não só saúde): `"escopo": "todos"` em `robo/config.json`.
- Palavras-chave e temas: `robo/config.json`.
- Regenerar mapas: `scripts/gerar_mapas.py` (malha municipal do IBGE, via tbrugz/geodata-br, simplificada com mapshaper).

## Pontos a validar na primeira coleta real

Construído a partir da documentação pública e testado só contra um servidor de simulação:
- tamanho máximo de página e limite de requisições da API (o robô trata HTTP 429 com espera);
- se a consulta sem `codigoModalidadeContratacao` é aceita (há plano B que percorre as 13 modalidades);
- nomes exatos dos campos de retorno (o robô usa `.get` e não quebra se algum faltar).

## Privacidade e limites

Sem cookies, sem rastreador e sem coleta de dados pessoais. Os dados dos editais são públicos e de responsabilidade dos órgãos. O painel não substitui a leitura do edital oficial.
