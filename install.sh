#!/bin/bash
# Instalador one-liner do Zapwarm
# Uso: curl -fsSL https://raw.githubusercontent.com/avswebmidia/zapwarm/main/install.sh | bash

set -e

REPO="https://github.com/avswebmidia/zapwarm.git"
INSTALL_PATH="${INSTALL_PATH:-/opt/zapwarm}"

echo "🚀 Instalando Zapwarm em $INSTALL_PATH..."

# Se não tem o instalador completo, baixa
if [ ! -f "/tmp/zapwarm-install.sh" ]; then
  curl -fsSL "https://raw.githubusercontent.com/avswebmidia/zapwarm/main/zapwarm-installer/install.sh" -o /tmp/zapwarm-install.sh
fi

bash /tmp/zapwarm-installer/install.sh
