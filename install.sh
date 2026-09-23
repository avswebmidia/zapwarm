#!/bin/bash

# ==========================================
# Instalador CLI - Zapwarm API + Manager
# ==========================================

# Cores para o terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

clear
echo -e "${GREEN}======================================================${NC}"
echo -e "${GREEN}   Bem-vindo ao instalador Zapwarm API & Manager!     ${NC}"
echo -e "${GREEN}======================================================${NC}"
echo ""

echo -e "${BLUE}Vamos configurar o seu ambiente:${NC}"
read -p "Digite o domínio para a API (ex: api.seudominio.com): " API_DOMAIN
read -p "Crie uma Senha Global para a API: " GLOBAL_API_KEY
read -p "Seu e-mail para o Certificado SSL (HTTPS): " SSL_EMAIL
echo ""
echo -e "${BLUE}--- Configuração de Inteligência Artificial ---${NC}"
echo -e "O sistema possui uma IA nativa (ChatGPT) para respostas automáticas."
read -p "Digite sua Chave API da OpenAI (Deixe VAZIO para usar apenas o Bot de Menu Numérico): " OPENAI_KEY

# Instalar Node.js, PM2, Nginx e Certbot no servidor
echo -e "${YELLOW}[*] Instalando dependências do sistema...${NC}"
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx
sudo npm install -g pm2

# Mover arquivos para o diretório de produção
echo -e "${YELLOW}[*] Copiando arquivos do sistema para /opt/zapwarm...${NC}"
mkdir -p /opt/zapwarm
cp -r . /opt/zapwarm/
cd /opt/zapwarm/zapwarm-api

# Gerar arquivo .env
cat <<EOF > .env
API_KEY=$GLOBAL_API_KEY
PORT=8080
OPENAI_API_KEY=$OPENAI_KEY
EOF

echo -e "${YELLOW}[*] Instalando bibliotecas da API...${NC}"
npm install

echo -e "${YELLOW}[*] Iniciando a API com PM2...${NC}"
pm2 start server.js --name "zapwarm-api"
pm2 save
pm2 startup

# Configurar Nginx (Proxy Reverso)
echo -e "${YELLOW}[*] Configurando o Nginx para o domínio $API_DOMAIN...${NC}"
cat <<EOF > /etc/nginx/sites-available/zapwarm-api
server {
    server_name $API_DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Ativar Nginx
ln -s /etc/nginx/sites-available/zapwarm-api /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx

# Gerar SSL com Certbot
if [ -n "$API_DOMAIN" ] && [ -n "$SSL_EMAIL" ]; then
    echo -e "${YELLOW}[*] Gerando Certificado SSL (HTTPS)...${NC}"
    certbot --nginx -d $API_DOMAIN --non-interactive --agree-tos -m $SSL_EMAIL
fi

echo -e "${GREEN}[+] Ambiente configurado com sucesso!${NC}"

echo ""
echo -e "${GREEN}======================================================${NC}"
echo -e "${GREEN}Sua API está ONLINE e rodando!${NC}"
echo -e "${YELLOW}URL da API: https://$API_DOMAIN${NC}"
echo -e "${YELLOW}Documentação Embutida: https://$API_DOMAIN/docs${NC}"
echo -e "${GREEN}======================================================${NC}"
