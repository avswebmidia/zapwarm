require('dotenv').config();
const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { Server } = require('socket.io');
const http = require('http');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  isJidGroup,
  isJidUser,
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSIONS_DIR = path.join(__dirname, 'sessions');

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, instance, token, authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

const instances = new Map();
const webhooks = new Map();

// --- INÍCIO IA ---
const OpenAI = require('openai');
const hasOpenAI = !!process.env.OPENAI_API_KEY;
const openai = hasOpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const botConfigs = new Map(); // Guarda o prompt de cada instância
const botMemory = new Map();  // Guarda o histórico de conversas
// --- FIM IA ---

function sanitizeInstanceName(name) {
  if (!name || typeof name !== 'string') return null;
  const clean = name.replace(/[^a-zA-Z0-9_-]/g, '');
  return clean || null;
}

function generateToken() {
  return Buffer.from(`${Date.now()}-${Math.random()}`).toString('base64');
}

function normalizeJid(number) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) throw new Error('Número inválido');
  return `${digits}@s.whatsapp.net`;
}

function instanceDir(name) {
  return path.join(SESSIONS_DIR, name);
}

function configPath(name) {
  return path.join(instanceDir(name), 'config.json');
}

function saveConfig(name, config) {
  fs.mkdirSync(instanceDir(name), { recursive: true });
  fs.writeFileSync(configPath(name), JSON.stringify(config, null, 2));
}

function loadConfig(name) {
  const file = configPath(name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function getInstance(req) {
  const name = req.headers.instance;
  const token = req.headers.token || req.headers.authorization;

  if (!name) {
    const err = new Error('Header instance é obrigatório');
    err.status = 400;
    throw err;
  }

  const data = instances.get(name);
  if (!data) {
    const err = new Error('Instância não encontrada');
    err.status = 404;
    throw err;
  }

  if (data.token !== token) {
    const err = new Error('Token inválido');
    err.status = 401;
    throw err;
  }

  if (!data.sock) {
    const err = new Error('Socket não inicializado');
    err.status = 500;
    throw err;
  }

  return data;
}

// ============================================
// FUNÇÕES DE INSTÂNCIA
// ============================================

async function startInstance(name, token, phoneNumber = null) {
  fs.mkdirSync(instanceDir(name), { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(instanceDir(name));
  const { version } = await fetchLatestBaileysVersion();

  const data = {
    instance: name,
    token,
    sock: null,
    qr: null,
    pairingCode: null,
    status: 'connecting',
    phone: null,
    displayName: null,
    lastUpdate: new Date().toISOString(),
  };

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('ZapBulk API'),
    markOnlineOnConnect: true,
    syncFullHistory: false,
  });

  data.sock = sock;
  instances.set(name, data);

  sock.ev.on('creds.update', saveCreds);

  // --- LÓGICA DE INTELIGÊNCIA ARTIFICIAL (BOT NATIVO) ---
  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;
    for (const msg of m.messages) {
      if (!msg.message || msg.key.fromMe) continue;
      
      const config = botConfigs.get(name);
      if (!config || !config.active || !config.prompt) continue;

      const remoteJid = msg.key.remoteJid;
      if (remoteJid.includes('@g.us')) continue; // Ignora grupos

      // Extrai o texto da mensagem
      const textMessage = msg.message.conversation || 
                          msg.message.extendedTextMessage?.text || 
                          msg.message.imageMessage?.caption || '';
      
      if (!textMessage) continue;

      try {
        let reply = '';

        if (hasOpenAI && openai) {
          // Inicializa memória se não existir
          if (!botMemory.has(remoteJid)) {
            botMemory.set(remoteJid, [{ role: 'system', content: config.prompt }]);
          }

          const history = botMemory.get(remoteJid);
          history.push({ role: 'user', content: textMessage });

          // Mantém apenas as últimas 20 mensagens
          if (history.length > 21) {
            history.splice(1, history.length - 21);
          }

          console.log(`🤖 [${name}] Respondendo IA para ${remoteJid}...`);
          
          const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: history,
          });

          reply = completion.choices[0].message.content;
          history.push({ role: 'assistant', content: reply });
        } else {
          // FLUXO FIXO (Menu Numérico Padrão)
          console.log(`🤖 [${name}] Respondendo Menu Numérico para ${remoteJid}...`);
          const userMsg = textMessage.trim();
          
          if (userMsg === '1') {
            reply = "Você escolheu *Falar com Atendente*. Um de nossos humanos já vai te responder, aguarde um instante!";
          } else if (userMsg === '2') {
            reply = "Você escolheu *Fazer um Pedido*. Acesse nosso cardápio online aqui: https://seucardapio.com";
          } else if (userMsg === '3') {
            reply = "Nosso horário de funcionamento é das 18h às 23h, de terça a domingo.";
          } else {
            // Menu principal
            reply = `Olá! O sistema de Inteligência Artificial não está configurado. Este é um menu automático:\n\nDigite a opção desejada:\n*1.* Falar com Atendente\n*2.* Fazer um Pedido\n*3.* Horário de Funcionamento`;
          }
        }

        // Envia a resposta simulando digitação
        await sock.presenceSubscribe(remoteJid);
        await sock.sendPresenceUpdate('composing', remoteJid);
        await new Promise(r => setTimeout(r, 2000));
        await sock.sendPresenceUpdate('paused', remoteJid);
        await sock.sendMessage(remoteJid, { text: reply });

      } catch (err) {
        console.error(`❌ [${name}] Erro no Bot:`, err.message);
      }
    }
  });
  // --- FIM IA ---

  if (phoneNumber) {
    setTimeout(async () => {
      try {
        const cleanNumber = phoneNumber.replace(/\D/g, '');
        console.log(`🔐 [${name}] Gerando código para ${cleanNumber}...`);
        const code = await sock.requestPairingCode(cleanNumber);
        data.pairingCode = code;
        data.status = 'pairing_code';
        data.lastUpdate = new Date().toISOString();
        instances.set(name, data);
        console.log(`✅ [${name}] Código de pareamento: ${code}`);
      } catch (error) {
        console.error(`❌ [${name}] Erro ao gerar código:`, error.message);
        data.status = 'pairing_error';
        data.error = error.message;
        instances.set(name, data);
      }
    }, 3000);
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;
    data.lastUpdate = new Date().toISOString();

    if (qr && !phoneNumber) {
      data.qr = await QRCode.toDataURL(qr);
      data.status = 'qrcode';
      instances.set(name, data);
    }

    if (connection === 'open') {
      data.status = 'connected';
      data.qr = null;
      data.pairingCode = null;
      
      if (sock.user) {
        data.phone = (sock.user.id || '').split(':')[0].split('@')[0];
        data.displayName = sock.user.name || null;
      }

      saveConfig(name, {
        token,
        createdAt: new Date().toISOString(),
        phone: data.phone,
      });

      console.log(`✅ [${name}] WhatsApp conectado!`);
      instances.set(name, data);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;

      if (code === DisconnectReason.loggedOut) {
        data.status = 'logged_out';
        data.sock = null;
        console.log(`❌ [${name}] Logout detectado.`);
        instances.set(name, data);
        return;
      }

      data.status = 'reconnecting';
      console.log(`🔄 [${name}] Reconectando...`);
      instances.set(name, data);

      setTimeout(() => {
        startInstance(name, token).catch((err) => {
          console.error(`Erro ao reconectar ${name}:`, err.message);
        });
      }, 3000);
    }
  });

  return data;
}

async function loadSavedInstances() {
  const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const config = loadConfig(entry.name);
    if (!config?.token) continue;

    try {
      console.log(`🔄 Carregando instância ${entry.name}`);
      await startInstance(entry.name, config.token);
    } catch (error) {
      console.error(`Erro ao carregar ${entry.name}:`, error.message);
    }
  }
}

// ============================================
// DOCUMENTAÇÃO HTML (Z-API Style)
// ============================================

app.use('/manager', express.static(path.join(__dirname, '../zapwarm-manager')));

app.get('/', (req, res) => {
  res.redirect('/manager');
});

app.get('/docs', (req, res) => {
  const baseUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;
  
  const html = `
<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ZapBulk API - Documentação Completa</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; background: #f5f5f5; color: #333; display: flex; min-height: 100vh; }
        
        /* Sidebar */
        .sidebar { width: 280px; background: #1a1a1a; color: #fff; padding: 20px 0; position: fixed; height: 100vh; overflow-y: auto; flex-shrink: 0; z-index: 1000; }
        .sidebar-header { padding: 0 20px 20px; border-bottom: 1px solid #333; }
        .sidebar-header h1 { font-size: 20px; font-weight: 700; color: #00d084; }
        .sidebar-header p { font-size: 12px; color: #888; margin-top: 5px; }
        .sidebar-nav { padding: 20px 0; }
        .sidebar-nav .nav-section { padding: 0 20px; margin-bottom: 10px; }
        .sidebar-nav .nav-section h3 { font-size: 12px; text-transform: uppercase; color: #666; letter-spacing: 1px; margin-bottom: 10px; }
        .sidebar-nav .nav-item { display: block; padding: 8px 20px; color: #ccc; text-decoration: none; font-size: 14px; transition: all 0.2s; cursor: pointer; border-left: 3px solid transparent; }
        .sidebar-nav .nav-item:hover { background: #333; color: #fff; }
        .sidebar-nav .nav-item.active { background: #333; color: #00d084; border-left-color: #00d084; }
        
        /* Main Content */
        .main-content { margin-left: 280px; flex: 1; padding: 40px 60px; max-width: 1200px; }
        .section { display: none; animation: fadeIn 0.3s ease; }
        .section.active { display: block; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        
        .section h1 { font-size: 32px; margin-bottom: 10px; color: #1a1a1a; }
        .section h2 { font-size: 24px; margin: 30px 0 15px; color: #1a1a1a; }
        .section h3 { font-size: 18px; margin: 20px 0 10px; color: #333; }
        .section p { line-height: 1.6; color: #555; margin-bottom: 15px; }
        .section .description { background: #fff; padding: 20px; border-radius: 8px; border-left: 4px solid #00d084; margin-bottom: 20px; }
        
        /* Endpoint Cards */
        .endpoint { background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 20px; overflow: hidden; }
        .endpoint-header { padding: 15px 20px; display: flex; align-items: center; gap: 15px; background: #f8f9fa; border-bottom: 1px solid #e9ecef; }
        .method { padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        .method.get { background: #61affe; color: #fff; }
        .method.post { background: #49cc90; color: #fff; }
        .method.put { background: #fca130; color: #fff; }
        .method.delete { background: #f93e3e; color: #fff; }
        .path { font-family: 'Consolas', 'Monaco', monospace; font-size: 14px; color: #333; flex: 1; }
        .endpoint-body { padding: 20px; }
        .endpoint-body .description-text { font-size: 14px; color: #555; margin-bottom: 15px; }
        
        /* Code Blocks */
        .code-block { background: #1a1a1a; color: #f8f9fa; padding: 15px; border-radius: 6px; overflow-x: auto; font-family: 'Consolas', 'Monaco', monospace; font-size: 13px; margin: 10px 0; }
        .code-block .comment { color: #6a9955; }
        .code-block .string { color: #ce9178; }
        .code-block .keyword { color: #569cd6; }
        .code-block .function { color: #dcdcaa; }
        
        /* Tables */
        .table-container { overflow-x: auto; margin: 15px 0; }
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        table th { background: #f8f9fa; padding: 12px 15px; text-align: left; font-weight: 600; border-bottom: 2px solid #e9ecef; }
        table td { padding: 10px 15px; border-bottom: 1px solid #e9ecef; }
        table tr:hover { background: #f8f9fa; }
        
        /* Badges */
        .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
        .badge.required { background: #ffebee; color: #c62828; }
        .badge.optional { background: #e8f5e9; color: #2e7d32; }
        
        /* Base URL */
        .base-url { background: #e3f2fd; padding: 10px 15px; border-radius: 6px; font-family: monospace; margin-bottom: 20px; }
        
        @media (max-width: 768px) {
            .sidebar { width: 100%; height: auto; position: relative; padding: 10px 0; }
            .main-content { margin-left: 0; padding: 20px; }
        }
    </style>
</head>
<body>
    <!-- Sidebar -->
    <div class="sidebar">
        <div class="sidebar-header">
            <h1>🚀 ZapBulk API</h1>
            <p>v2.0.0 • Documentação Completa</p>
        </div>
        
        <nav class="sidebar-nav">
            <div class="nav-section">
                <h3>Primeiros Passos</h3>
                <a class="nav-item active" onclick="showSection('introduction')">📖 Introdução</a>
                <a class="nav-item" onclick="showSection('authentication')">🔐 Autenticação</a>
            </div>
            
            <div class="nav-section">
                <h3>Instâncias</h3>
                <a class="nav-item" onclick="showSection('instances')">📱 Gerenciamento</a>
            </div>
            
            <div class="nav-section">
                <h3>Mensagens</h3>
                <a class="nav-item" onclick="showSection('messages')">💬 Envio</a>
            </div>
            
            <div class="nav-section">
                <h3>Chat Controller</h3>
                <a class="nav-item" onclick="showSection('chat')">💭 Conversas</a>
            </div>
            
            <div class="nav-section">
                <h3>Perfil</h3>
                <a class="nav-item" onclick="showSection('profile')">👤 Meu Perfil</a>
            </div>
            
            <div class="nav-section">
                <h3>Grupos</h3>
                <a class="nav-item" onclick="showSection('groups')">👥 Gerenciamento</a>
            </div>
            
            <div class="nav-section">
                <h3>Contatos</h3>
                <a class="nav-item" onclick="showSection('contacts')">📇 Contatos</a>
            </div>
            
            <div class="nav-section">
                <h3>Status</h3>
                <a class="nav-item" onclick="showSection('status')">📝 Status</a>
            </div>
            
            <div class="nav-section">
                <h3>Webhooks</h3>
                <a class="nav-item" onclick="showSection('webhooks')">🔗 Webhooks</a>
            </div>
            
            <div class="nav-section">
                <h3>Integrações</h3>
                <a class="nav-item" onclick="showSection('integrations')">🔌 Integrações</a>
            </div>
        </nav>
    </div>

    <!-- Main Content -->
    <div class="main-content">
        <!-- Introdução -->
        <section id="introduction" class="section active">
            <h1>📖 Introdução</h1>
            <div class="description">
                <p>Bem-vindo à <strong>ZapBulk API</strong>! API completa com todos os recursos do WhatsApp via Baileys.</p>
            </div>
            
            <h2>Base URL</h2>
            <div class="base-url">${baseUrl}</div>
            
            <h2>Features</h2>
            <ul>
                <li>✅ Múltiplas instâncias simultâneas</li>
                <li>✅ Conexão via QR Code ou Pairing Code</li>
                <li>✅ Envio de textos, imagens, vídeos, áudios, documentos, stickers</li>
                <li>✅ Gerenciamento de grupos (criar, adicionar, remover, promover, rebaixar)</li>
                <li>✅ Chat Controller (listar chats, ler mensagens, deletar)</li>
                <li>✅ Perfil (nome, foto, status)</li>
                <li>✅ Contatos (listar, verificar existência)</li>
                <li>✅ Status (postar, visualizar)</li>
                <li>✅ Webhooks para eventos em tempo real</li>
                <li>✅ Integrações completas</li>
            </ul>
        </section>

        <!-- Autenticação -->
        <section id="authentication" class="section">
            <h1>🔐 Autenticação</h1>
            
            <div class="description">
                <p>Todas as requisições requerem autenticação via headers.</p>
            </div>
            
            <h2>Headers Requeridos</h2>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Header</th>
                            <th>Descrição</th>
                            <th>Obrigatório</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><code>instance</code></td>
                            <td>Nome da instância</td>
                            <td><span class="badge required">Sim</span></td>
                        </tr>
                        <tr>
                            <td><code>token</code></td>
                            <td>Token de autenticação</td>
                            <td><span class="badge required">Sim</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>
            
            <h2>Exemplo</h2>
            <div class="code-block">
                <span class="comment"># Exemplo de requisição com autenticação</span>
                curl -X GET "${baseUrl}/instance/status" \\
                  -H "instance: minha_instancia" \\
                  -H "token: meu_token_aqui"
            </div>
        </section>

        <!-- Instâncias -->
        <section id="instances" class="section">
            <h1>📱 Instâncias</h1>
            
            <div class="description">
                <p>Gerencie suas instâncias do WhatsApp.</p>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/instance/create</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Criar nova instância via QR Code</strong>
                        <p>Gera um QR Code para concer o WhatsApp.</p>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/instance/create" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "instance": "meu_bot",
                            "phoneNumber": "5515999999999"
                          }'
                    </div>
                    
                    <h3>Body (JSON)</h3>
                    <div class="code-block">
                        {
                          <span class="string">"instance"</span>: <span class="string">"meu_bot"</span>,
                          <span class="string">"phoneNumber"</span>: <span class="string">"5515999999999"</span> <span class="comment">// opcional</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"instance"</span>: <span class="string">"meu_bot"</span>,
                          <span class="string">"token"</span>: <span class="string">"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."</span>,
                          <span class="string">"status"</span>: <span class="string">"qrcode"</span>,
                          <span class="string">"method"</span>: <span class="string">"qrcode"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/instance/create-with-number</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Criar instância via Pairing Code</strong>
                        <p>Gera um código de 6 dígitos para pareamento.</p>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/instance/create-with-number" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "instance": "meu_bot",
                            "phoneNumber": "5515999999999"
                          }'
                    </div>
                    
                    <h3>Body (JSON)</h3>
                    <div class="code-block">
                        {
                          <span class="string">"instance"</span>: <span class="string">"meu_bot"</span>,
                          <span class="string">"phoneNumber"</span>: <span class="string">"5515999999999"</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"instance"</span>: <span class="string">"meu_bot"</span>,
                          <span class="string">"token"</span>: <span class="string">"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."</span>,
                          <span class="string">"status"</span>: <span class="string">"pairing_code"</span>,
                          <span class="string">"method"</span>: <span class="string">"pairing_code"</span>,
                          <span class="string">"message"</span>: <span class="string">"Gerando código de pareamento para 5515999999999. Aguarde alguns segundos e use /instance/get-pairing-code"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/instance/qrcode</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Obter QR Code da instância</strong>
                        <p>Retorna a imagem do QR Code em PNG.</p>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X GET "${baseUrl}/instance/qrcode?instance=meu_bot&token=meu_token"
                    </div>
                    
                    <h3>Parâmetros</h3>
                    <div class="code-block">
                        <span class="comment"># Query params</span>
                        ?instance=meu_bot&token=meu_token
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        <span class="comment"># Imagem PNG do QR Code (binary)</span>
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/instance/get-pairing-code</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Obter código de pareamento</strong>
                        <p>Retorna o código de 6 dígitos para pareamento.</p>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X GET "${baseUrl}/instance/get-pairing-code?instance=meu_bot&token=meu_token"
                    </div>
                    
                    <h3>Parâmetros</h3>
                    <div class="code-block">
                        ?instance=meu_bot&token=meu_token
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"pairingCode"</span>: <span class="string">"123456"</span>,
                          <span class="string">"instance"</span>: <span class="string">"meu_bot"</span>,
                          <span class="string">"status"</span>: <span class="string">"pairing_code"</span>,
                          <span class="string">"instructions"</span>: <span class="string">"Digite 123456 no WhatsApp do número vinculado"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/instance/status</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Verificar status da instância</strong>
                        <p>Retorna o status atual da instância.</p>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X GET "${baseUrl}/instance/status" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token"
                    </div>
                    
                    <h3>Headers</h3>
                    <div class="code-block">
                        instance: meu_bot
                        token: meu_token
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"instance"</span>: <span class="string">"meu_bot"</span>,
                          <span class="string">"status"</span>: <span class="string">"connected"</span>,
                          <span class="string">"connected"</span>: <span class="keyword">true</span>,
                          <span class="string">"phone"</span>: <span class="string">"5515999999999"</span>,
                          <span class="string">"name"</span>: <span class="string">"Meu Nome"</span>,
                          <span class="string">"lastUpdate"</span>: <span class="string">"2024-01-01T00:00:00.000Z"</span>,
                          <span class="string">"hasPairingCode"</span>: <span class="keyword">false</span>,
                          <span class="string">"pairingCode"</span>: <span class="keyword">null</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/instance/list</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Listar instâncias</strong>
                        <p>Retorna todas as instâncias ativas.</p>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X GET "${baseUrl}/instance/list"
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"instances"</span>: [
                            {
                              <span class="string">"instance"</span>: <span class="string">"meu_bot"</span>,
                              <span class="string">"status"</span>: <span class="string">"connected"</span>,
                              <span class="string">"connected"</span>: <span class="keyword">true</span>,
                              <span class="string">"phone"</span>: <span class="string">"5515999999999"</span>,
                              <span class="string">"name"</span>: <span class="string">"Meu Nome"</span>
                            }
                          ]
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method delete">DELETE</span>
                    <span class="path">/instance/logout</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Desconectar instância</strong>
                        <p>Desconecta a instância do WhatsApp.</p>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X DELETE "${baseUrl}/instance/logout" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token"
                    </div>
                    
                    <h3>Headers</h3>
                    <div class="code-block">
                        instance: meu_bot
                        token: meu_token
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"message"</span>: <span class="string">"Instância desconectada com sucesso."</span>
                        }
                    </div>
                </div>
            </div>
        </section>

        <!-- Mensagens -->
        <section id="messages" class="section">
            <h1>💬 Mensagens</h1>
            
            <div class="description">
                <p>Envie todos os tipos de mensagens suportadas pelo WhatsApp.</p>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/message/send-text</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Enviar mensagem de texto</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/message/send-text" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "number": "5515999999999",
                            "text": "Olá mundo!"
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"number"</span>: <span class="string">"5515999999999"</span>,
                          <span class="string">"text"</span>: <span class="string">"Olá mundo!"</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"messageId"</span>: <span class="string">"123456789"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/message/send-image</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Enviar imagem</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/message/send-image" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "number": "5515999999999",
                            "image": "base64 ou URL",
                            "caption": "Legenda da imagem"
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"number"</span>: <span class="string">"5515999999999"</span>,
                          <span class="string">"image"</span>: <span class="string">"base64 ou URL"</span>,
                          <span class="string">"caption"</span>: <span class="string">"Legenda da imagem"</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"messageId"</span>: <span class="string">"123456789"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/message/send-audio</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Enviar áudio</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/message/send-audio" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "number": "5515999999999",
                            "audio": "base64 ou URL",
                            "duration": 10
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"number"</span>: <span class="string">"5515999999999"</span>,
                          <span class="string">"audio"</span>: <span class="string">"base64 ou URL"</span>,
                          <span class="string">"duration"</span>: <span class="number">10</span> <span class="comment">// opcional</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"messageId"</span>: <span class="string">"123456789"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/message/send-video</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Enviar vídeo</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/message/send-video" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "number": "5515999999999",
                            "video": "base64 ou URL",
                            "caption": "Legenda do vídeo",
                            "duration": 15
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"number"</span>: <span class="string">"5515999999999"</span>,
                          <span class="string">"video"</span>: <span class="string">"base64 ou URL"</span>,
                          <span class="string">"caption"</span>: <span class="string">"Legenda do vídeo"</span>,
                          <span class="string">"duration"</span>: <span class="number">15</span> <span class="comment">// opcional</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"messageId"</span>: <span class="string">"123456789"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/message/send-document</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Enviar documento</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/message/send-document" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "number": "5515999999999",
                            "document": "base64 ou URL",
                            "filename": "documento.pdf",
                            "mimetype": "application/pdf"
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"number"</span>: <span class="string">"5515999999999"</span>,
                          <span class="string">"document"</span>: <span class="string">"base64 ou URL"</span>,
                          <span class="string">"filename"</span>: <span class="string">"documento.pdf"</span>,
                          <span class="string">"mimetype"</span>: <span class="string">"application/pdf"</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"messageId"</span>: <span class="string">"123456789"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/message/send-sticker</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Enviar sticker</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/message/send-sticker" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "number": "5515999999999",
                            "sticker": "base64 ou URL"
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"number"</span>: <span class="string">"5515999999999"</span>,
                          <span class="string">"sticker"</span>: <span class="string">"base64 ou URL"</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"messageId"</span>: <span class="string">"123456789"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/message/send-contact</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Enviar contato</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/message/send-contact" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "number": "5515999999999",
                            "contact": {
                              "name": "João Silva",
                              "phone": "5515999999999"
                            }
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"number"</span>: <span class="string">"5515999999999"</span>,
                          <span class="string">"contact"</span>: {
                            <span class="string">"name"</span>: <span class="string">"João Silva"</span>,
                            <span class="string">"phone"</span>: <span class="string">"5515999999999"</span>
                          }
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"messageId"</span>: <span class="string">"123456789"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/message/send-location</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Enviar localização</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/message/send-location" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "number": "5515999999999",
                            "latitude": -23.550520,
                            "longitude": -46.633308,
                            "name": "São Paulo, SP",
                            "address": "Praça da Sé, 1"
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"number"</span>: <span class="string">"5515999999999"</span>,
                          <span class="string">"latitude"</span>: <span class="number">-23.550520</span>,
                          <span class="string">"longitude"</span>: <span class="number">-46.633308</span>,
                          <span class="string">"name"</span>: <span class="string">"São Paulo, SP"</span>,
                          <span class="string">"address"</span>: <span class="string">"Praça da Sé, 1"</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"messageId"</span>: <span class="string">"123456789"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/message/send-poll</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Enviar enquete</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/message/send-poll" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "number": "5515999999999",
                            "question": "Qual sua cor favorita?",
                            "options": ["Azul", "Vermelho", "Verde"]
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"number"</span>: <span class="string">"5515999999999"</span>,
                          <span class="string">"question"</span>: <span class="string">"Qual sua cor favorita?"</span>,
                          <span class="string">"options"</span>: [<span class="string">"Azul"</span>, <span class="string">"Vermelho"</span>, <span class="string">"Verde"</span>]
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"messageId"</span>: <span class="string">"123456789"</span>
                        }
                    </div>
                </div>
            </div>
        </section>

        <!-- Chat Controller -->
        <section id="chat" class="section">
            <h1>💭 Chat Controller</h1>
            
            <div class="description">
                <p>Gerencie conversas e interações.</p>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/chat/list</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Listar chats</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X GET "${baseUrl}/chat/list?limit=50" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token"
                    </div>
                    
                    <h3>Parâmetros</h3>
                    <div class="code-block">
                        ?limit=50 <span class="comment">// opcional</span>
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"chats"</span>: [
                            {
                              <span class="string">"id"</span>: <span class="string">"5515999999999@s.whatsapp.net"</span>,
                              <span class="string">"name"</span>: <span class="string">"João Silva"</span>,
                              <span class="string">"unreadCount"</span>: <span class="number">0</span>,
                              <span class="string">"lastMessage"</span>: <span class="string">"Olá!"</span>,
                              <span class="string">"timestamp"</span>: <span class="number">1700000000000</span>
                            }
                          ]
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/chat/messages</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Obter mensagens de um chat</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X GET "${baseUrl}/chat/messages?chatId=5515999999999@s.whatsapp.net&limit=20" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token"
                    </div>
                    
                    <h3>Parâmetros</h3>
                    <div class="code-block">
                        ?chatId=5515999999999@s.whatsapp.net&limit=20
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"messages"</span>: [
                            {
                              <span class="string">"id"</span>: <span class="string">"123456789"</span>,
                              <span class="string">"from"</span>: <span class="string">"5515999999999@s.whatsapp.net"</span>,
                              <span class="string">"text"</span>: <span class="string">"Olá mundo!"</span>,
                              <span class="string">"type"</span>: <span class="string">"text"</span>,
                              <span class="string">"timestamp"</span>: <span class="number">1700000000000</span>
                            }
                          ]
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/chat/read</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Marcar mensagens como lidas</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/chat/read" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "chatId": "5515999999999@s.whatsapp.net",
                            "messages": ["id1", "id2"]
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"chatId"</span>: <span class="string">"5515999999999@s.whatsapp.net"</span>,
                          <span class="string">"messages"</span>: [<span class="string">"id1"</span>, <span class="string">"id2"</span>]
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"message"</span>: <span class="string">"Mensagens marcadas como lidas"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/chat/delete</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Deletar mensagens</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/chat/delete" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "chatId": "5515999999999@s.whatsapp.net",
                            "messages": ["id1", "id2"]
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"chatId"</span>: <span class="string">"5515999999999@s.whatsapp.net"</span>,
                          <span class="string">"messages"</span>: [<span class="string">"id1"</span>, <span class="string">"id2"</span>]
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"message"</span>: <span class="string">"Mensagens deletadas"</span>
                        }
                    </div>
                </div>
            </div>
        </section>

        <!-- Perfil -->
        <section id="profile" class="section">
            <h1>👤 Perfil</h1>
            
            <div class="description">
                <p>Gerencie seu perfil do WhatsApp.</p>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/profile/me</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Obter informações do perfil</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X GET "${baseUrl}/profile/me" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token"
                    </div>
                    
                    <h3>Headers</h3>
                    <div class="code-block">
                        instance: meu_bot
                        token: meu_token
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"id"</span>: <span class="string">"5515999999999@s.whatsapp.net"</span>,
                          <span class="string">"name"</span>: <span class="string">"Meu Nome"</span>,
                          <span class="string">"phone"</span>: <span class="string">"5515999999999"</span>,
                          <span class="string">"profilePicture"</span>: <span class="string">"https://profile-pic.url"</span>,
                          <span class="string">"status"</span>: <span class="string">"Disponível"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/profile/update-name</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Atualizar nome do perfil</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/profile/update-name" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "name": "Novo Nome"
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"name"</span>: <span class="string">"Novo Nome"</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"message"</span>: <span class="string">"Nome atualizado com sucesso"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/profile/update-picture</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Atualizar foto de perfil</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/profile/update-picture" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "picture": "base64 ou URL"
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"picture"</span>: <span class="string">"base64 ou URL"</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"message"</span>: <span class="string">"Foto de perfil atualizada"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/profile/update-status</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Atualizar status</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/profile/update-status" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "status": "Novo status"
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"status"</span>: <span class="string">"Novo status"</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"message"</span>: <span class="string">"Status atualizado"</span>
                        }
                    </div>
                </div>
            </div>
        </section>

        <!-- Grupos -->
        <section id="groups" class="section">
            <h1>👥 Grupos</h1>
            
            <div class="description">
                <p>Gerencie grupos do WhatsApp.</p>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/group/list</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Listar grupos</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X GET "${baseUrl}/group/list" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token"
                    </div>
                    
                    <h3>Headers</h3>
                    <div class="code-block">
                        instance: meu_bot
                        token: meu_token
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"groups"</span>: [
                            {
                              <span class="string">"id"</span>: <span class="string">"123456789@g.us"</span>,
                              <span class="string">"name"</span>: <span class="string">"Meu Grupo"</span>,
                              <span class="string">"participants"</span>: <span class="number">10</span>,
                              <span class="string">"owner"</span>: <span class="string">"5515999999999@s.whatsapp.net"</span>,
                              <span class="string">"createdAt"</span>: <span class="number">1700000000000</span>
                            }
                          ]
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/group/create</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Criar grupo</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/group/create" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "name": "Meu Grupo",
                            "participants": ["5515999999999", "5515999999998"]
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"name"</span>: <span class="string">"Meu Grupo"</span>,
                          <span class="string">"participants"</span>: [<span class="string">"5515999999999"</span>, <span class="string">"5515999999998"</span>]
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"groupId"</span>: <span class="string">"123456789@g.us"</span>,
                          <span class="string">"message"</span>: <span class="string">"Grupo criado com sucesso"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/group/add-participant</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Adicionar participante</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/group/add-participant" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "groupId": "123456789@g.us",
                            "participants": ["5515999999999"]
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"groupId"</span>: <span class="string">"123456789@g.us"</span>,
                          <span class="string">"participants"</span>: [<span class="string">"5515999999999"</span>]
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"result"</span>: {
                            <span class="string">"status"</span>: <span class="string">"success"</span>,
                            <span class="string">"participants"</span>: [<span class="string">"5515999999999@s.whatsapp.net"</span>]
                          }
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/group/remove-participant</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Remover participante</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/group/remove-participant" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "groupId": "123456789@g.us",
                            "participants": ["5515999999999"]
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"groupId"</span>: <span class="string">"123456789@g.us"</span>,
                          <span class="string">"participants"</span>: [<span class="string">"5515999999999"</span>]
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"result"</span>: {
                            <span class="string">"status"</span>: <span class="string">"success"</span>,
                            <span class="string">"participants"</span>: [<span class="string">"5515999999999@s.whatsapp.net"</span>]
                          }
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/group/promote</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Promover a admin</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/group/promote" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "groupId": "123456789@g.us",
                            "participant": "5515999999999"
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"groupId"</span>: <span class="string">"123456789@g.us"</span>,
                          <span class="string">"participant"</span>: <span class="string">"5515999999999"</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"result"</span>: {
                            <span class="string">"status"</span>: <span class="string">"success"</span>,
                            <span class="string">"participant"</span>: <span class="string">"5515999999999@s.whatsapp.net"</span>
                          }
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/group/demote</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Rebaixar admin</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/group/demote" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "groupId": "123456789@g.us",
                            "participant": "5515999999999"
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"groupId"</span>: <span class="string">"123456789@g.us"</span>,
                          <span class="string">"participant"</span>: <span class="string">"5515999999999"</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"result"</span>: {
                            <span class="string">"status"</span>: <span class="string">"success"</span>,
                            <span class="string">"participant"</span>: <span class="string">"5515999999999@s.whatsapp.net"</span>
                          }
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/group/update-picture</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Atualizar foto do grupo</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/group/update-picture" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "groupId": "123456789@g.us",
                            "picture": "base64 ou URL"
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"groupId"</span>: <span class="string">"123456789@g.us"</span>,
                          <span class="string">"picture"</span>: <span class="string">"base64 ou URL"</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"message"</span>: <span class="string">"Foto do grupo atualizada"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/group/update-name</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Atualizar nome do grupo</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/group/update-name" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "groupId": "123456789@g.us",
                            "name": "Novo Nome do Grupo"
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"groupId"</span>: <span class="string">"123456789@g.us"</span>,
                          <span class="string">"name"</span>: <span class="string">"Novo Nome do Grupo"</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"message"</span>: <span class="string">"Nome do grupo atualizado"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/group/invite-link</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Obter link de convite do grupo</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X GET "${baseUrl}/group/invite-link?groupId=123456789@g.us" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token"
                    </div>
                    
                    <h3>Parâmetros</h3>
                    <div class="code-block">
                        ?groupId=123456789@g.us
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"code"</span>: <span class="string">"ABCDEFGH"</span>,
                          <span class="string">"link"</span>: <span class="string">"https://chat.whatsapp.com/ABCDEFGH"</span>
                        }
                    </div>
                </div>
            </div>
        </section>

        <!-- Contatos -->
        <section id="contacts" class="section">
            <h1>📇 Contatos</h1>
            
            <div class="description">
                <p>Gerencie seus contatos do WhatsApp.</p>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/contact/list</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Listar contatos</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X GET "${baseUrl}/contact/list" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token"
                    </div>
                    
                    <h3>Headers</h3>
                    <div class="code-block">
                        instance: meu_bot
                        token: meu_token
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"contacts"</span>: [
                            {
                              <span class="string">"id"</span>: <span class="string">"5515999999999@s.whatsapp.net"</span>,
                              <span class="string">"name"</span>: <span class="string">"João Silva"</span>,
                              <span class="string">"number"</span>: <span class="string">"5515999999999"</span>,
                              <span class="string">"profilePicture"</span>: <span class="string">"https://profile-pic.url"</span>
                            }
                          ]
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/contact/check</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Verificar se número existe no WhatsApp</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X GET "${baseUrl}/contact/check?number=5515999999999" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token"
                    </div>
                    
                    <h3>Parâmetros</h3>
                    <div class="code-block">
                        ?number=5515999999999
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"number"</span>: <span class="string">"5515999999999"</span>,
                          <span class="string">"exists"</span>: <span class="keyword">true</span>,
                          <span class="string">"jid"</span>: <span class="string">"5515999999999@s.whatsapp.net"</span>
                        }
                    </div>
                </div>
            </div>
        </section>

        <!-- Status -->
        <section id="status" class="section">
            <h1>📝 Status</h1>
            
            <div class="description">
                <p>Gerencie seus status do WhatsApp.</p>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/status/send-text</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Postar status de texto</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/status/send-text" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "text": "Meu status do dia!",
                            "backgroundColor": "#FF0000",
                            "font": 1
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"text"</span>: <span class="string">"Meu status do dia!"</span>,
                          <span class="string">"backgroundColor"</span>: <span class="string">"#FF0000"</span>,
                          <span class="string">"font"</span>: <span class="number">1</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"messageId"</span>: <span class="string">"123456789"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/status/send-image</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Postar status de imagem</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/status/send-image" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "image": "base64 ou URL",
                            "caption": "Minha foto do dia"
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"image"</span>: <span class="string">"base64 ou URL"</span>,
                          <span class="string">"caption"</span>: <span class="string">"Minha foto do dia"</span>
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"messageId"</span>: <span class="string">"123456789"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/status/list</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Listar status dos contatos</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X GET "${baseUrl}/status/list" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token"
                    </div>
                    
                    <h3>Headers</h3>
                    <div class="code-block">
                        instance: meu_bot
                        token: meu_token
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"statuses"</span>: [
                            {
                              <span class="string">"from"</span>: <span class="string">"5515999999999@s.whatsapp.net"</span>,
                              <span class="string">"text"</span>: <span class="string">"Bom dia!"</span>,
                              <span class="string">"timestamp"</span>: <span class="number">1700000000000</span>,
                              <span class="string">"type"</span>: <span class="string">"text"</span>
                            }
                          ]
                        }
                    </div>
                </div>
            </div>
        </section>

        <!-- Webhooks -->
        <section id="webhooks" class="section">
            <h1>🔗 Webhooks</h1>
            
            <div class="description">
                <p>Configure webhooks para eventos em tempo real.</p>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/webhook/set</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Configurar webhook</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/webhook/set" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "url": "https://meu-webhook.com/endpoint",
                            "events": ["message", "status", "group"]
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"url"</span>: <span class="string">"https://meu-webhook.com/endpoint"</span>,
                          <span class="string">"events"</span>: [<span class="string">"message"</span>, <span class="string">"status"</span>, <span class="string">"group"</span>]
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"message"</span>: <span class="string">"Webhook configurado"</span>
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/webhook/get</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Obter configuração do webhook</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X GET "${baseUrl}/webhook/get" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token"
                    </div>
                    
                    <h3>Headers</h3>
                    <div class="code-block">
                        instance: meu_bot
                        token: meu_token
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"webhook"</span>: {
                            <span class="string">"url"</span>: <span class="string">"https://meu-webhook.com/endpoint"</span>,
                            <span class="string">"events"</span>: [<span class="string">"message"</span>, <span class="string">"status"</span>, <span class="string">"group"</span>]
                          }
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method delete">DELETE</span>
                    <span class="path">/webhook/remove</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Remover webhook</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X DELETE "${baseUrl}/webhook/remove" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token"
                    </div>
                    
                    <h3>Headers</h3>
                    <div class="code-block">
                        instance: meu_bot
                        token: meu_token
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"message"</span>: <span class="string">"Webhook removido"</span>
                        }
                    </div>
                </div>
            </div>
        </section>

        <!-- Integrações -->
        <section id="integrations" class="section">
            <h1>🔌 Integrações</h1>
            
            <div class="description">
                <p>Integre com serviços externos.</p>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method post">POST</span>
                    <span class="path">/integration/webhook-send</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Enviar webhook personalizado</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X POST "${baseUrl}/integration/webhook-send" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token" \\
                          -H "Content-Type: application/json" \\
                          -d '{
                            "url": "https://meu-webhook.com/endpoint",
                            "data": {
                              "key": "value"
                            }
                          }'
                    </div>
                    
                    <h3>Body</h3>
                    <div class="code-block">
                        {
                          <span class="string">"url"</span>: <span class="string">"https://meu-webhook.com/endpoint"</span>,
                          <span class="string">"data"</span>: {
                            <span class="string">"key"</span>: <span class="string">"value"</span>
                          }
                        }
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"result"</span>: {
                            <span class="string">"status"</span>: <span class="string">"ok"</span>,
                            <span class="string">"data"</span>: {}
                          }
                        }
                    </div>
                </div>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/integration/status</span>
                </div>
                <div class="endpoint-body">
                    <div class="description-text">
                        <strong>Status das integrações</strong>
                    </div>
                    
                    <h3>Curl</h3>
                    <div class="code-block">
                        curl -X GET "${baseUrl}/integration/status" \\
                          -H "instance: meu_bot" \\
                          -H "token: meu_token"
                    </div>
                    
                    <h3>Headers</h3>
                    <div class="code-block">
                        instance: meu_bot
                        token: meu_token
                    </div>
                    
                    <h3>Resposta</h3>
                    <div class="code-block">
                        {
                          <span class="string">"success"</span>: <span class="keyword">true</span>,
                          <span class="string">"instance"</span>: <span class="string">"meu_bot"</span>,
                          <span class="string">"status"</span>: <span class="string">"connected"</span>,
                          <span class="string">"connected"</span>: <span class="keyword">true</span>,
                          <span class="string">"phone"</span>: <span class="string">"5515999999999"</span>,
                          <span class="string">"name"</span>: <span class="string">"Meu Nome"</span>,
                          <span class="string">"webhook"</span>: <span class="keyword">true</span>,
                          <span class="string">"activeIntegrations"</span>: [<span class="string">"Webhooks"</span>, <span class="string">"Socket.io"</span>]
                        }
                    </div>
                </div>
            </div>
        </section>
    </div>

    <script>
        function showSection(sectionId) {
            // Hide all sections
            document.querySelectorAll('.section').forEach(section => {
                section.classList.remove('active');
            });
            
            // Show selected section
            document.getElementById(sectionId).classList.add('active');
            
            // Update sidebar
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            
            // Find and highlight the clicked item
            document.querySelectorAll('.nav-item').forEach(item => {
                if (item.getAttribute('onclick').includes(sectionId)) {
                    item.classList.add('active');
                }
            });
        }
    </script>
</body>
</html>
  `;
  
  res.send(html);
});

// ============================================
// ENDPOINTS FUNCIONAIS - INSTÂNCIAS
// ============================================

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/instance/create', async (req, res) => {
  try {
    const name = sanitizeInstanceName(req.body.instance);

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Nome da instância é obrigatório',
      });
    }

    if (instances.has(name)) {
      const existing = instances.get(name);
      return res.json({
        success: true,
        instance: name,
        token: existing.token,
        status: existing.status,
      });
    }

    const token = generateToken();
    const data = await startInstance(name, token);

    res.json({
      success: true,
      instance: name,
      token,
      status: data.status,
      method: 'qrcode'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post('/instance/create-with-number', async (req, res) => {
  try {
    const name = sanitizeInstanceName(req.body.instance);
    const phoneNumber = req.body.phoneNumber;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Nome da instância é obrigatório',
      });
    }

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Número de telefone é obrigatório',
      });
    }

    if (instances.has(name)) {
      const existing = instances.get(name);
      return res.json({
        success: true,
        instance: name,
        token: existing.token,
        status: existing.status,
        message: 'Instância já existe'
      });
    }

    const token = generateToken();
    const data = await startInstance(name, token, phoneNumber);

    setTimeout(() => {
      const updated = instances.get(name);
      if (updated && updated.pairingCode) {
        console.log(`📢 [${name}] Código disponível: ${updated.pairingCode}`);
      }
    }, 4000);

    res.json({
      success: true,
      instance: name,
      token,
      status: data.status,
      method: 'pairing_code',
      message: `Gerando código de pareamento para ${phoneNumber}. Aguarde alguns segundos e use /instance/get-pairing-code`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get('/instance/get-pairing-code', (req, res) => {
  const name = req.query.instance;
  const token = req.headers.token || req.headers.authorization || req.query.token;

  const data = instances.get(name);

  if (!data) {
    return res.status(404).json({ success: false, error: 'Instância não encontrada' });
  }

  if (data.token !== token) {
    return res.status(401).json({ success: false, error: 'Token inválido' });
  }

  if (data.pairingCode) {
    return res.json({
      success: true,
      pairingCode: data.pairingCode,
      instance: name,
      status: data.status,
      instructions: `Digite ${data.pairingCode} no WhatsApp do número vinculado`
    });
  }

  if (data.status === 'connected') {
    return res.status(400).json({ 
      success: false, 
      error: 'Instância já conectada' 
    });
  }

  if (data.status === 'pairing_error') {
    return res.status(500).json({ 
      success: false, 
      error: data.error || 'Erro ao gerar código de pareamento' 
    });
  }

  return res.status(404).json({ 
    success: false, 
    error: 'Código ainda não gerado. Aguarde alguns segundos e tente novamente.',
    status: data.status
  });
});

app.get('/instance/qrcode', (req, res) => {
  const name = req.query.instance;
  const token = req.headers.token || req.headers.authorization || req.query.token;

  const data = instances.get(name);

  if (!data) {
    return res.status(404).json({ success: false, error: 'Instância não encontrada' });
  }

  if (data.token !== token) {
    return res.status(401).json({ success: false, error: 'Token inválido' });
  }

  if (!data.qr) {
    if (data.status === 'connected') {
      return res.status(400).json({ success: false, error: 'Instância já conectada' });
    }
    return res.status(404).json({ success: false, error: 'QR code não disponível' });
  }

  const base64Data = data.qr.replace(/^data:image\/png;base64,/, '');
  const imageBuffer = Buffer.from(base64Data, 'base64');
  
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(imageBuffer);
});

app.get('/instance/status', (req, res) => {
  try {
    const data = getInstance(req);

    res.json({
      success: true,
      instance: data.instance,
      status: data.status,
      connected: data.status === 'connected',
      phone: data.phone,
      name: data.displayName,
      lastUpdate: data.lastUpdate,
      hasPairingCode: !!data.pairingCode,
      pairingCode: data.pairingCode || null
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.get('/instance/list', (req, res) => {
  const list = Array.from(instances.values()).map((item) => ({
    instance: item.instance,
    status: item.status,
    connected: item.status === 'connected',
    phone: item.phone,
    name: item.displayName,
  }));

  res.json({ success: true, instances: list });
});

app.delete('/instance/logout', async (req, res) => {
  try {
    const data = getInstance(req);

    try {
      await data.sock.logout();
    } catch (_) {}

    instances.delete(data.instance);

    res.json({ success: true, message: 'Instância desconectada com sucesso.' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINTS FUNCIONAIS - MENSAGENS
// ============================================

app.post('/message/send-text', async (req, res) => {
  try {
    const data = getInstance(req);
    const { number, text } = req.body;

    if (!number || !text) {
      return res.status(400).json({ success: false, error: 'number e text são obrigatórios' });
    }

    const result = await data.sock.sendMessage(normalizeJid(number), { text });

    res.json({ success: true, messageId: result.key.id });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/message/send-image', async (req, res) => {
  try {
    const data = getInstance(req);
    const { number, image, caption } = req.body;

    if (!number || !image) {
      return res.status(400).json({ success: false, error: 'number e image são obrigatórios' });
    }

    let imageBuffer;
    if (image.startsWith('http')) {
      const response = await fetch(image);
      imageBuffer = await response.buffer();
    } else if (image.startsWith('data:')) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else {
      imageBuffer = Buffer.from(image, 'base64');
    }

    const result = await data.sock.sendMessage(normalizeJid(number), {
      image: imageBuffer,
      caption: caption || ''
    });

    res.json({ success: true, messageId: result.key.id });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/message/send-audio', async (req, res) => {
  try {
    const data = getInstance(req);
    const { number, audio, duration } = req.body;

    if (!number || !audio) {
      return res.status(400).json({ success: false, error: 'number e audio são obrigatórios' });
    }

    let audioBuffer;
    if (audio.startsWith('http')) {
      const response = await fetch(audio);
      audioBuffer = await response.buffer();
    } else if (audio.startsWith('data:')) {
      const base64Data = audio.replace(/^data:audio\/\w+;base64,/, '');
      audioBuffer = Buffer.from(base64Data, 'base64');
    } else {
      audioBuffer = Buffer.from(audio, 'base64');
    }

    const result = await data.sock.sendMessage(normalizeJid(number), {
      audio: audioBuffer,
      mimetype: 'audio/mp4',
      ptt: false,
      seconds: duration || 10
    });

    res.json({ success: true, messageId: result.key.id });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/message/send-video', async (req, res) => {
  try {
    const data = getInstance(req);
    const { number, video, caption, duration } = req.body;

    if (!number || !video) {
      return res.status(400).json({ success: false, error: 'number e video são obrigatórios' });
    }

    let videoBuffer;
    if (video.startsWith('http')) {
      const response = await fetch(video);
      videoBuffer = await response.buffer();
    } else if (video.startsWith('data:')) {
      const base64Data = video.replace(/^data:video\/\w+;base64,/, '');
      videoBuffer = Buffer.from(base64Data, 'base64');
    } else {
      videoBuffer = Buffer.from(video, 'base64');
    }

    const result = await data.sock.sendMessage(normalizeJid(number), {
      video: videoBuffer,
      caption: caption || '',
      seconds: duration || 10
    });

    res.json({ success: true, messageId: result.key.id });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/message/send-document', async (req, res) => {
  try {
    const data = getInstance(req);
    const { number, document, filename, mimetype } = req.body;

    if (!number || !document) {
      return res.status(400).json({ success: false, error: 'number e document são obrigatórios' });
    }

    let documentBuffer;
    if (document.startsWith('http')) {
      const response = await fetch(document);
      documentBuffer = await response.buffer();
    } else if (document.startsWith('data:')) {
      const base64Data = document.replace(/^data:[^;]+;base64,/, '');
      documentBuffer = Buffer.from(base64Data, 'base64');
    } else {
      documentBuffer = Buffer.from(document, 'base64');
    }

    const result = await data.sock.sendMessage(normalizeJid(number), {
      document: documentBuffer,
      fileName: filename || 'documento.pdf',
      mimetype: mimetype || 'application/pdf'
    });

    res.json({ success: true, messageId: result.key.id });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/message/send-sticker', async (req, res) => {
  try {
    const data = getInstance(req);
    const { number, sticker } = req.body;

    if (!number || !sticker) {
      return res.status(400).json({ success: false, error: 'number e sticker são obrigatórios' });
    }

    let stickerBuffer;
    if (sticker.startsWith('http')) {
      const response = await fetch(sticker);
      stickerBuffer = await response.buffer();
    } else if (sticker.startsWith('data:')) {
      const base64Data = sticker.replace(/^data:image\/\w+;base64,/, '');
      stickerBuffer = Buffer.from(base64Data, 'base64');
    } else {
      stickerBuffer = Buffer.from(sticker, 'base64');
    }

    const result = await data.sock.sendMessage(normalizeJid(number), {
      sticker: stickerBuffer
    });

    res.json({ success: true, messageId: result.key.id });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/message/send-contact', async (req, res) => {
  try {
    const data = getInstance(req);
    const { number, contact } = req.body;

    if (!number || !contact) {
      return res.status(400).json({ success: false, error: 'number e contact são obrigatórios' });
    }

    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${contact.name}\nTEL:+${contact.phone}\nEND:VCARD`;

    const result = await data.sock.sendMessage(normalizeJid(number), {
      contacts: {
        displayName: contact.name,
        contacts: [
          {
            vcard
          }
        ]
      }
    });

    res.json({ success: true, messageId: result.key.id });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/message/send-location', async (req, res) => {
  try {
    const data = getInstance(req);
    const { number, latitude, longitude, name, address } = req.body;

    if (!number || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, error: 'number, latitude e longitude são obrigatórios' });
    }

    const result = await data.sock.sendMessage(normalizeJid(number), {
      location: {
        degreesLatitude: latitude,
        degreesLongitude: longitude,
        name: name || '',
        address: address || ''
      }
    });

    res.json({ success: true, messageId: result.key.id });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/message/send-poll', async (req, res) => {
  try {
    const data = getInstance(req);
    const { number, question, options } = req.body;

    if (!number || !question || !options || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ success: false, error: 'number, question e options (min 2) são obrigatórios' });
    }

    const result = await data.sock.sendMessage(normalizeJid(number), {
      poll: {
        name: question,
        values: options
      }
    });

    res.json({ success: true, messageId: result.key.id });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINTS FUNCIONAIS - CHAT CONTROLLER
// ============================================

app.get('/chat/list', async (req, res) => {
  try {
    const data = getInstance(req);
    const limit = parseInt(req.query.limit) || 50;

    const chats = [];
    const store = data.sock.store;
    
    if (store && store.chats) {
      for (const chat of store.chats.values()) {
        chats.push({
          id: chat.id,
          name: chat.name || chat.id,
          unreadCount: chat.unreadCount || 0,
          lastMessage: chat.messages?.last?.message?.conversation || '',
          timestamp: chat.lastTimestamp || null
        });
      }
    }

    res.json({ success: true, chats: chats.slice(0, limit) });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.get('/chat/messages', async (req, res) => {
  try {
    const data = getInstance(req);
    const { chatId } = req.query;
    const limit = parseInt(req.query.limit) || 20;

    if (!chatId) {
      return res.status(400).json({ success: false, error: 'chatId é obrigatório' });
    }

    const messages = [];
    const store = data.sock.store;

    if (store && store.messages && store.messages[chatId]) {
      for (const msg of store.messages[chatId].values()) {
        messages.push({
          id: msg.key.id,
          from: msg.key.remoteJid,
          text: msg.message?.conversation || '',
          type: msg.message?.conversation ? 'text' : 'other',
          timestamp: msg.messageTimestamp
        });
      }
    }

    res.json({ success: true, messages: messages.slice(-limit) });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/chat/read', async (req, res) => {
  try {
    const data = getInstance(req);
    const { chatId, messages } = req.body;

    if (!chatId || !messages || !Array.isArray(messages)) {
      return res.status(400).json({ success: false, error: 'chatId e messages são obrigatórios' });
    }

    for (const msgId of messages) {
      await data.sock.sendReadReceipt(chatId, msgId);
    }

    res.json({ success: true, message: 'Mensagens marcadas como lidas' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/chat/delete', async (req, res) => {
  try {
    const data = getInstance(req);
    const { chatId, messages } = req.body;

    if (!chatId || !messages || !Array.isArray(messages)) {
      return res.status(400).json({ success: false, error: 'chatId e messages são obrigatórios' });
    }

    for (const msgId of messages) {
      await data.sock.deleteMessage(chatId, { id: msgId });
    }

    res.json({ success: true, message: 'Mensagens deletadas' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINTS FUNCIONAIS - PERFIL
// ============================================

app.get('/profile/me', async (req, res) => {
  try {
    const data = getInstance(req);

    let profilePicture = null;
    try {
      const pic = await data.sock.profilePictureUrl(data.sock.user.id, 'image');
      profilePicture = pic;
    } catch (_) {}

    let status = null;
    try {
      const stat = await data.sock.fetchStatus(data.sock.user.id);
      status = stat?.status || null;
    } catch (_) {}

    res.json({
      success: true,
      id: data.sock.user.id,
      name: data.displayName || data.sock.user.name || null,
      phone: data.phone,
      profilePicture,
      status
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/profile/update-name', async (req, res) => {
  try {
    const data = getInstance(req);
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'name é obrigatório' });
    }

    await data.sock.updateProfileName(name);
    data.displayName = name;
    instances.set(data.instance, data);

    res.json({ success: true, message: 'Nome atualizado com sucesso' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/profile/update-picture', async (req, res) => {
  try {
    const data = getInstance(req);
    const { picture } = req.body;

    if (!picture) {
      return res.status(400).json({ success: false, error: 'picture é obrigatório' });
    }

    let pictureBuffer;
    if (picture.startsWith('http')) {
      const response = await fetch(picture);
      pictureBuffer = await response.buffer();
    } else if (picture.startsWith('data:')) {
      const base64Data = picture.replace(/^data:image\/\w+;base64,/, '');
      pictureBuffer = Buffer.from(base64Data, 'base64');
    } else {
      pictureBuffer = Buffer.from(picture, 'base64');
    }

    await data.sock.updateProfilePicture(data.sock.user.id, pictureBuffer);

    res.json({ success: true, message: 'Foto de perfil atualizada' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/profile/update-status', async (req, res) => {
  try {
    const data = getInstance(req);
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, error: 'status é obrigatório' });
    }

    await data.sock.updateProfileStatus(status);

    res.json({ success: true, message: 'Status atualizado' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINTS FUNCIONAIS - GRUPOS
// ============================================

app.get('/group/list', async (req, res) => {
  try {
    const data = getInstance(req);

    const groups = [];
    const store = data.sock.store;

    if (store && store.chats) {
      for (const chat of store.chats.values()) {
        if (isJidGroup(chat.id)) {
          const metadata = await data.sock.groupMetadata(chat.id).catch(() => null);
          groups.push({
            id: chat.id,
            name: metadata?.subject || chat.name || chat.id,
            participants: metadata?.participants?.length || 0,
            owner: metadata?.owner || null,
            createdAt: metadata?.creation || null
          });
        }
      }
    }

    res.json({ success: true, groups });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/group/create', async (req, res) => {
  try {
    const data = getInstance(req);
    const { name, participants } = req.body;

    if (!name || !participants || !Array.isArray(participants) || participants.length === 0) {
      return res.status(400).json({ success: false, error: 'name e participants são obrigatórios' });
    }

    const jids = participants.map(p => normalizeJid(p));
    const result = await data.sock.groupCreate(name, jids);

    res.json({ success: true, groupId: result.id, message: 'Grupo criado com sucesso' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/group/add-participant', async (req, res) => {
  try {
    const data = getInstance(req);
    const { groupId, participants } = req.body;

    if (!groupId || !participants || !Array.isArray(participants)) {
      return res.status(400).json({ success: false, error: 'groupId e participants são obrigatórios' });
    }

    const jids = participants.map(p => normalizeJid(p));
    const result = await data.sock.groupParticipantsUpdate(groupId, jids, 'add');

    res.json({ success: true, result });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/group/remove-participant', async (req, res) => {
  try {
    const data = getInstance(req);
    const { groupId, participants } = req.body;

    if (!groupId || !participants || !Array.isArray(participants)) {
      return res.status(400).json({ success: false, error: 'groupId e participants são obrigatórios' });
    }

    const jids = participants.map(p => normalizeJid(p));
    const result = await data.sock.groupParticipantsUpdate(groupId, jids, 'remove');

    res.json({ success: true, result });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/group/promote', async (req, res) => {
  try {
    const data = getInstance(req);
    const { groupId, participant } = req.body;

    if (!groupId || !participant) {
      return res.status(400).json({ success: false, error: 'groupId e participant são obrigatórios' });
    }

    const jid = normalizeJid(participant);
    const result = await data.sock.groupParticipantsUpdate(groupId, [jid], 'promote');

    res.json({ success: true, result });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/group/demote', async (req, res) => {
  try {
    const data = getInstance(req);
    const { groupId, participant } = req.body;

    if (!groupId || !participant) {
      return res.status(400).json({ success: false, error: 'groupId e participant são obrigatórios' });
    }

    const jid = normalizeJid(participant);
    const result = await data.sock.groupParticipantsUpdate(groupId, [jid], 'demote');

    res.json({ success: true, result });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/group/update-picture', async (req, res) => {
  try {
    const data = getInstance(req);
    const { groupId, picture } = req.body;

    if (!groupId || !picture) {
      return res.status(400).json({ success: false, error: 'groupId e picture são obrigatórios' });
    }

    let pictureBuffer;
    if (picture.startsWith('http')) {
      const response = await fetch(picture);
      pictureBuffer = await response.buffer();
    } else if (picture.startsWith('data:')) {
      const base64Data = picture.replace(/^data:image\/\w+;base64,/, '');
      pictureBuffer = Buffer.from(base64Data, 'base64');
    } else {
      pictureBuffer = Buffer.from(picture, 'base64');
    }

    await data.sock.updateProfilePicture(groupId, pictureBuffer);

    res.json({ success: true, message: 'Foto do grupo atualizada' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/group/update-name', async (req, res) => {
  try {
    const data = getInstance(req);
    const { groupId, name } = req.body;

    if (!groupId || !name) {
      return res.status(400).json({ success: false, error: 'groupId e name são obrigatórios' });
    }

    await data.sock.groupUpdateSubject(groupId, name);

    res.json({ success: true, message: 'Nome do grupo atualizado' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.get('/group/invite-link', async (req, res) => {
  try {
    const data = getInstance(req);
    const { groupId } = req.query;

    if (!groupId) {
      return res.status(400).json({ success: false, error: 'groupId é obrigatório' });
    }

    const code = await data.sock.groupInviteCode(groupId);
    const link = `https://chat.whatsapp.com/${code}`;

    res.json({ success: true, code, link });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINTS FUNCIONAIS - CONTATOS
// ============================================

app.get('/contact/list', async (req, res) => {
  try {
    const data = getInstance(req);

    const contacts = [];
    const store = data.sock.store;

    if (store && store.contacts) {
      for (const contact of store.contacts.values()) {
        if (isJidUser(contact.id)) {
          contacts.push({
            id: contact.id,
            name: contact.name || contact.verifiedName || contact.id.split('@')[0],
            number: contact.id.split('@')[0],
            profilePicture: contact.imgUrl || null
          });
        }
      }
    }

    res.json({ success: true, contacts });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.get('/contact/check', async (req, res) => {
  try {
    const data = getInstance(req);
    const { number } = req.query;

    if (!number) {
      return res.status(400).json({ success: false, error: 'number é obrigatório' });
    }

    const jid = normalizeJid(number);
    const exists = await data.sock.onWhatsApp(jid);

    res.json({ 
      success: true, 
      number, 
      exists: exists.length > 0,
      jid: exists[0]?.jid || null
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINTS FUNCIONAIS - STATUS
// ============================================

app.post('/status/send-text', async (req, res) => {
  try {
    const data = getInstance(req);
    const { text, backgroundColor, font } = req.body;

    if (!text) {
      return res.status(400).json({ success: false, error: 'text é obrigatório' });
    }

    const result = await data.sock.sendMessage(data.sock.user.id, {
      text,
      backgroundColor: backgroundColor || '#000000',
      font: font || 1
    });

    res.json({ success: true, messageId: result.key.id });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.post('/status/send-image', async (req, res) => {
  try {
    const data = getInstance(req);
    const { image, caption } = req.body;

    if (!image) {
      return res.status(400).json({ success: false, error: 'image é obrigatório' });
    }

    let imageBuffer;
    if (image.startsWith('http')) {
      const response = await fetch(image);
      imageBuffer = await response.buffer();
    } else if (image.startsWith('data:')) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else {
      imageBuffer = Buffer.from(image, 'base64');
    }

    const result = await data.sock.sendMessage(data.sock.user.id, {
      image: imageBuffer,
      caption: caption || ''
    });

    res.json({ success: true, messageId: result.key.id });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.get('/status/list', async (req, res) => {
  try {
    const data = getInstance(req);

    const statuses = [];
    const store = data.sock.store;

    if (store && store.status) {
      for (const status of store.status.values()) {
        statuses.push({
          from: status.key.remoteJid,
          text: status.message?.conversation || '',
          timestamp: status.messageTimestamp,
          type: status.message?.conversation ? 'text' : 'image'
        });
      }
    }

    res.json({ success: true, statuses });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINTS FUNCIONAIS - BOT IA
// ============================================

app.post('/bot/config', (req, res) => {
  try {
    const data = getInstance(req); // Autentica com Header instance e token
    const { active, prompt } = req.body;
    
    botConfigs.set(data.instance, {
      active: !!active,
      prompt: prompt || ''
    });

    // Limpa a memória antiga se o prompt for alterado
    for (let key of botMemory.keys()) {
       botMemory.delete(key);
    }

    res.json({ success: true, message: 'Bot IA configurado com sucesso!', config: botConfigs.get(data.instance) });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.get('/bot/config', (req, res) => {
  try {
    const data = getInstance(req);
    const config = botConfigs.get(data.instance) || { active: false, prompt: '' };
    res.json({ success: true, config });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINTS FUNCIONAIS - WEBHOOKS
// ============================================

app.post('/webhook/set', (req, res) => {
  try {
    const data = getInstance(req);
    const { url, events } = req.body;

    if (!url || !events || !Array.isArray(events)) {
      return res.status(400).json({ success: false, error: 'url e events são obrigatórios' });
    }

    webhooks.set(data.instance, { url, events });

    const sock = data.sock;
    
    if (events.includes('message')) {
      sock.ev.on('messages.upsert', async (messages) => {
        for (const msg of messages) {
          try {
            await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: 'message',
                data: {
                  from: msg.key.remoteJid,
                  text: msg.message?.conversation || '',
                  timestamp: msg.messageTimestamp
                }
              })
            });
          } catch (_) {}
        }
      });
    }

    res.json({ success: true, message: 'Webhook configurado' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.get('/webhook/get', (req, res) => {
  try {
    const data = getInstance(req);
    const config = webhooks.get(data.instance);

    if (!config) {
      return res.status(404).json({ success: false, error: 'Webhook não configurado' });
    }

    res.json({ success: true, webhook: config });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.delete('/webhook/remove', (req, res) => {
  try {
    const data = getInstance(req);
    const removed = webhooks.delete(data.instance);

    if (!removed) {
      return res.status(404).json({ success: false, error: 'Webhook não configurado' });
    }

    res.json({ success: true, message: 'Webhook removido' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINTS FUNCIONAIS - INTEGRAÇÕES
// ============================================

app.post('/integration/webhook-send', async (req, res) => {
  try {
    const data = getInstance(req);
    const { url, data: payload } = req.body;

    if (!url) {
      return res.status(400).json({ success: false, error: 'url é obrigatório' });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || { instance: data.instance, timestamp: Date.now() })
    });

    const result = await response.json();

    res.json({ success: true, result });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

app.get('/integration/status', (req, res) => {
  try {
    const data = getInstance(req);

    res.json({
      success: true,
      instance: data.instance,
      status: data.status,
      connected: data.status === 'connected',
      phone: data.phone,
      name: data.displayName,
      webhook: webhooks.has(data.instance),
      activeIntegrations: ['Webhooks', 'Socket.io']
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// ============================================
// WEBSOCKET
// ============================================

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log('🔌 Cliente conectado ao WebSocket');
  
  socket.on('pairing_request', async (data) => {
    const { instance, phoneNumber } = data;
    
    try {
      if (instances.has(instance)) {
        socket.emit('error', { message: 'Instância já existe' });
        return;
      }

      const { state, saveCreds } = await useMultiFileAuthState(instanceDir(instance));
      const { version } = await fetchLatestBaileysVersion();
      
      const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('ZapBulk API'),
      });
      
      sock.ev.on('creds.update', saveCreds);
      
      const cleanNumber = phoneNumber.replace(/\D/g, '');
      console.log(`🔐 [WebSocket] Gerando código para ${cleanNumber}...`);
      const code = await sock.requestPairingCode(cleanNumber);
      
      const token = generateToken();
      instances.set(instance, {
        instance,
        token,
        sock,
        pairingCode: code,
        status: 'pairing_code',
        phone: cleanNumber,
        lastUpdate: new Date().toISOString()
      });
      
      socket.emit('pairing_code', { 
        success: true, 
        code,
        instance,
        token
      });
      
      console.log(`✅ [WebSocket] Código gerado: ${code}`);
      
      sock.ev.on('connection.update', (update) => {
        if (update.connection === 'open') {
          const data = instances.get(instance);
          if (data) {
            data.status = 'connected';
            data.pairingCode = null;
            instances.set(instance, data);
          }
          socket.emit('connected', { instance });
          console.log(`✅ [${instance}] WhatsApp conectado via WebSocket!`);
        }
      });
      
    } catch (error) {
      console.error('❌ Erro WebSocket:', error.message);
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Cliente desconectado do WebSocket');
  });
});

// ============================================
// MIDDLEWARE DE ERRO
// ============================================

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, error: err.message });
});

// ============================================
// INICIALIZAÇÃO
// ============================================

server.listen(PORT, async () => {
  console.log('='.repeat(60));
  console.log(`🚀 ZapBulk Baileys API - Versão Completa`);
  console.log(`📡 Porta: ${PORT}`);
  console.log(`📖 Documentação: http://localhost:${PORT}/docs`);
  console.log('='.repeat(60));
  console.log(`📱 Recursos disponíveis:`);
  console.log(`   ✅ Instâncias (QR Code / Pairing Code)`);
  console.log(`   ✅ Mensagens (Texto, Imagem, Áudio, Vídeo, Documento, Sticker, Contato, Localização, Enquete)`);
  console.log(`   ✅ Chat Controller (Listar, Ler, Deletar)`);
  console.log(`   ✅ Perfil (Nome, Foto, Status)`);
  console.log(`   ✅ Grupos (Criar, Adicionar, Remover, Promover, Rebaixar, Foto, Nome, Link)`);
  console.log(`   ✅ Contatos (Listar, Verificar)`);
  console.log(`   ✅ Status (Texto, Imagem, Listar)`);
  console.log(`   ✅ Webhooks (Configurar, Ver, Remover)`);
  console.log(`   ✅ Integrações (Enviar, Status)`);
  console.log(`   ✅ WebSocket (Pairing Code)`);
  console.log('='.repeat(60));
  
  try {
    await loadSavedInstances();
    console.log(`✅ ${instances.size} instâncias carregadas`);
  } catch (error) {
    console.error('❌ Erro ao carregar instâncias:', error.message);
  }
});