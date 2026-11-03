# Guia do zero: Painel de Editais no GitHub e em partelli.pro/editais

Conta GitHub: `rafaelpartelli`. Computador: o Server (terminal). Tempo estimado: 40 a 60 minutos. Em cada passo há uma linha "Deu certo se".

## Passo 0. Conferir o computador

```bash
git --version
python3 --version
```
Deu certo se: os dois mostram versão (Python 3.9 ou maior). Se faltar algum:
```bash
sudo apt update && sudo apt install -y git python3
```

## Passo 1. Conferir a pasta do projeto

```bash
ls -a /home/rafael/Documentos/Site_partelli/site_editais
```
Deu certo se: aparecem `index.html`, `css`, `js`, `mapas`, `robo`, `dados`, `README.md` e `GUIA_GITHUB.md`.

## Passo 2. Criar o repositório vazio

1. Abra https://github.com/new (logado como rafaelpartelli).
2. Repository name: `painel-editais`. Visibilidade: **Public**.
3. Não marque README, .gitignore nem licença. Clique em **Create repository**.

Deu certo se: aparece a página do repositório vazio, com instruções de "quick setup".

## Passo 3. Criar o token de acesso

1. GitHub, foto do perfil, **Settings**, **Developer settings**, **Personal access tokens**, **Fine-grained tokens**, **Generate new token**.
2. Nome: `painel-editais-server`. Validade: 90 dias.
3. Repository access: **Only select repositories**, escolha `painel-editais`.
4. Permissions, Repository permissions: **Contents** = Read and write; **Workflows** = Read and write.
5. **Generate token** e copie o código (começa com `github_pat_`). Ele aparece só uma vez.

Se Contents e Workflows não aparecerem: confira que "Repository access" está em **Only select repositories** (e não "Public repositories") e use o botão **+ Add permissions** para abrir a lista.

Alternativa simples, token clássico: **Developer settings**, **Personal access tokens**, **Tokens (classic)**, **Generate new token (classic)**, validade 30 dias, marque **repo** e **workflow**. Esse token alcança todos os seus repositórios (inclusive o `roboms`): use validade curta e apague quando terminar os testes.

Regra: o token não vai para arquivo do projeto, e-mail ou conversa. Se vazar, apague em Settings e crie outro.

## Passo 4. Colocar o arquivo de agendamento no lugar

O `coletar.yml` já está na pasta do projeto (`/home/rafael/Documentos/Site_partelli/site_editais/coletar.yml`). Mova para o lugar que o GitHub exige:
```bash
cd /home/rafael/Documentos/Site_partelli/site_editais
mkdir -p .github/workflows
mv coletar.yml .github/workflows/coletar.yml
ls .github/workflows
```
Deu certo se: o último comando mostra `coletar.yml` e o arquivo não está mais na raiz da pasta.

## Passo 5. Enviar o projeto ao GitHub

```bash
cd /home/rafael/Documentos/Site_partelli/site_editais
git config --global user.name  "Rafael Partelli"
git config --global user.email "SEU_EMAIL_DO_GITHUB"
git init
git branch -M main
git add .
git commit -m "Painel de editais de saúde: primeira versão"
git remote add origin https://github.com/rafaelpartelli/painel-editais.git
git push -u origin main
```
Quando pedir **Username**: `rafaelpartelli`. Em **Password**: cole o token do passo 3 (o texto não aparece enquanto você cola).

Deu certo se: ao atualizar a página do repositório no GitHub aparecem as pastas e o arquivo `.github/workflows/coletar.yml`.

## Passo 6. Liberar o robô para gravar os dados

No repositório: **Settings**, **Actions**, **General**, role até **Workflow permissions**, marque **Read and write permissions**, **Save**.

## Passo 7. Primeira coleta (teste só com o ES)

1. Aba **Actions**. Se aparecer um aviso, clique em **I understand my workflows, go ahead and enable them**.
2. Na lista da esquerda: **Coletar editais do PNCP**, depois **Run workflow**.
3. No campo `uf` digite `ES` e clique no botão verde **Run workflow**.
4. Aguarde alguns minutos e atualize a página.

Deu certo se: a execução termina com marca verde, aparece um commit "dados: coleta PNCP" feito por `robo-editais` e a pasta `dados/uf/ES.json` existe.

Se deu erro (marca vermelha): abra a execução, clique em **coletar**, copie as últimas 30 linhas do log e envie para mim. Não tente consertar sozinho.

## Passo 8. Coleta nacional

Repita o passo 7 com o campo `uf` **vazio**. Ela percorre as 27 UFs.

Deu certo se: `dados/meta.json` mostra `"demo":false` e `"ufs_com_erro":{}`, e existem 27 arquivos em `dados/uf/`.

Aviso: depois que o robô grava no GitHub, seu computador fica desatualizado. Antes de qualquer novo envio, rode `git pull`.

## Passo 9. Publicar em partelli.pro/editais (Hostinger)

1. hPanel, **Sites**, `partelli.pro`, **Avançado**, **Git** (o nome do menu pode variar um pouco).
2. Repositório: `https://github.com/rafaelpartelli/painel-editais.git`. Ramo: `main`. Pasta de instalação: `editais`.
3. **Criar**, depois **Implantar**.
4. Na mesma tela, copie o endereço do **webhook** (implantação automática). No GitHub: repositório, **Settings**, **Webhooks**, **Add webhook**: cole em Payload URL, Content type `application/json`, evento **Just the push event**, **Add webhook**.

Deu certo se: `https://partelli.pro/editais` abre o painel. A pasta `editais` deve estar vazia antes da primeira implantação. O site da raiz não é alterado.

## Passo 10. Conferência final

- A faixa laranja "DADOS DE DEMONSTRAÇÃO" não aparece.
- A data de atualização no topo é de hoje.
- O mapa do Brasil mostra os 27 estados coloridos; clicar em um estado abre o mapa dos municípios.
- Abrir um edital no PNCP e comparar objeto, órgão e prazo com o card.
- Testar no celular.

## Plano B: robô no Server (se o PNCP bloquear o GitHub)

Sintoma: a execução falha com erro de conexão ou HTTP 403 em todas as UFs.
```bash
cd /home/rafael/Documentos/Site_partelli/site_editais
git config --global credential.helper store   # guarda o token neste computador
chmod +x robo/rodar_local.sh
./robo/rodar_local.sh                         # teste manual (pede o token na primeira vez)
crontab -e
```
Linha para colocar no cron:
```
15 8,17 * * * /home/rafael/Documentos/Site_partelli/site_editais/robo/rodar_local.sh >> /home/rafael/Documentos/Site_partelli/site_editais/robo.log 2>&1
```
Depois, desative o agendamento do GitHub: aba Actions, **Coletar editais do PNCP**, menu **...**, **Disable workflow**.

## Problemas comuns

| Mensagem | Causa | O que fazer |
|---|---|---|
| `refusing to allow a Personal Access Token to create or update workflow` | Token sem permissão Workflows | Refazer o token (passo 3) |
| `Authentication failed` ou `403` no push | Token errado, vencido ou de outro repositório | Gerar novo token |
| `Process completed with exit code 2` | Nenhuma UF coletada (rede ou bloqueio) | Plano B |
| `HTTP 400` no log | Parâmetro recusado pela API | Enviar o log para ajuste |
| `HTTP 429` no log | Limite de requisições | Rodar de novo mais tarde |
| Página "Ainda não há dados coletados" | Coleta ainda não rodou ou não foi publicada | Passos 7 a 9 |
