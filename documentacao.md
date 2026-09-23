# Documentação PRO - Zapwarm API
*(Atualizada com base no núcleo principal `server.js`)*

Esta documentação descreve todos os superpoderes reais da sua API. Ao contrário da versão básica, o seu núcleo principal opera como um verdadeiro **Gateway SaaS**, permitindo a criação de infinitas instâncias com tokens de segurança individuais e recursos complexos de gestão de mensagens, grupos e perfil.

---

## Autenticação (Multi-Tenant)

Diferente de APIs com apenas uma senha global, o seu servidor possui uma arquitetura SaaS profissional. 
1. Ao **criar** uma instância, a API **gera um `token` exclusivo de segurança** para ela.
2. Para usar as rotas (enviar mensagens, criar grupos, etc.), você deve enviar **sempre** dois Headers na requisição:
   - `instance: NOME_DA_INSTANCIA`
   - `token: TOKEN_GERADO_NA_CRIACAO`

---

## 1. Gerenciamento de Instâncias (Conexão)

### 1.1. Criar Instância
Cria o espaço da instância e gera o token de segurança dela.
- **Endpoint:** `POST /instance/create`
- **Body:** `{ "instance": "nome_da_instancia" }`
- **Retorno:** Retorna o `token` que você precisará guardar para usar nos Headers depois.

### 1.2. Criar Instância e Conectar via Código (Sem QR)
Permite parear o WhatsApp do cliente sem precisar ler QR Code, apenas recebendo um código no app do WhatsApp.
- **Endpoint:** `POST /instance/create-with-number`
- **Body:** `{ "instance": "nome", "phoneNumber": "5511999999999" }`

### 1.3. Ler QR Code e Status
- **Pegar QR Code:** `GET /instance/qrcode`
- **Pegar Código de Pareamento:** `GET /instance/get-pairing-code`
- **Verificar Status:** `GET /instance/status`
- **Desconectar / Sair do Celular:** `DELETE /instance/logout`

*(**Atenção:** Em todas estas rotas abaixo, você precisa mandar os Headers `instance` e `token`)*

---

## 2. Envio de Mensagens

Todas as rotas de mensagem aceitam o Header e o Body com as informações do envio.

- **Mensagem de Texto:** `POST /message/send-text`
  Body: `{ "number": "55...", "text": "Sua mensagem" }`
  
- **Enviar Imagem:** `POST /message/send-image`
  Body: `{ "number": "55...", "image": "URL_OU_BASE64", "caption": "Legenda" }`
  
- **Enviar Áudio (Voice/PTT):** `POST /message/send-audio`
- **Enviar Vídeo:** `POST /message/send-video`
- **Enviar Documento / PDF:** `POST /message/send-document`
- **Enviar Figurinha (Sticker):** `POST /message/send-sticker`
- **Enviar Contato (vCard):** `POST /message/send-contact`
- **Enviar Localização (GPS):** `POST /message/send-location`
- **Enviar Enquete (Poll):** `POST /message/send-poll`

---

## 3. Gestão de Chats (Bate-Papo)

Sua API permite gerenciar as conversas que já aconteceram, como se estivesse com o celular aberto!

- **Listar todas as Conversas:** `GET /chat/list`
- **Puxar Histórico de Mensagens de um Chat:** `GET /chat/messages`
- **Marcar como Lida (Visualizar Azulzinho):** `POST /chat/read`
- **Apagar Chat para Mim:** `POST /chat/delete`

---

## 4. Gestão do Perfil do WhatsApp

Sim, sua API consegue editar as informações do próprio chip remotamente!

- **Ver meu Perfil:** `GET /profile/me`
- **Mudar Nome no WhatsApp:** `POST /profile/update-name`
- **Mudar Foto de Perfil:** `POST /profile/update-picture`
- **Mudar o Status (Recado):** `POST /profile/update-status`

---

## 5. Gerenciador Completo de Grupos

Sua API é poderosa para disparo e gestão de comunidades em grupos!

- **Listar meus Grupos:** `GET /group/list`
- **Criar um Grupo Novo:** `POST /group/create`
- **Adicionar Participante:** `POST /group/add-participant`
- **Remover Participante:** `POST /group/remove-participant`
- **Promover para Admin:** `POST /group/promote`
- **Rebaixar de Admin:** `POST /group/demote`
- **Mudar Foto do Grupo:** `POST /group/update-picture`
- **Mudar Nome do Grupo:** `POST /group/update-name`
- **Pegar o Link de Convite do Grupo:** `GET /group/invite-link`

---

## Dica: Painel Oculto Integrado
Você sabia? O próprio código principal `server.js` possui um painel HTML de documentação e teste integrado na rota `GET /docs`. Basta abrir no navegador quando o servidor estiver rodando!
