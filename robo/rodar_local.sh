#!/usr/bin/env bash
# Plano B: roda o robô no seu computador (máquina "Server") e envia os dados ao Git.
# Use se o PNCP bloquear os servidores do GitHub. Agende no cron, por exemplo:
#   15 8,17 * * *  /home/rafael/robo_editais/robo/rodar_local.sh >> /home/rafael/robo_editais/robo.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
export TZ=America/Sao_Paulo

python3 robo/coletar_editais.py

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git add dados
  if git diff --cached --quiet; then
    echo "Sem mudanças nos dados."
  else
    git commit -m "dados: coleta PNCP $(date '+%d/%m/%Y %H:%M')"
    git push
  fi
fi
