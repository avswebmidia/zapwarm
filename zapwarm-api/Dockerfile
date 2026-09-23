FROM node:20-alpine

WORKDIR /app

# Instala git (necessário para dependências do Baileys)
RUN apk add --no-cache git

# Copia package.json
COPY package*.json ./

# Instala dependências
RUN npm install --omit=dev

# Copia todo o projeto
COPY . .

# Mostra os arquivos copiados (aparecerá no log do build)
RUN ls -la /app

# Cria pasta de sessões
RUN mkdir -p /app/sessions

# Expõe a porta
EXPOSE 3000

# Inicia diretamente o arquivo principal
CMD ["node", "server.js"]