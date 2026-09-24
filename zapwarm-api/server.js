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
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, instance, token, authorization, apikey');
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
const botConfigs = new Map();
const botMemory = new Map();
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
  const name = req.headers.instance || req.query.instance || req.body?.instance;
  const token = req.headers.token || req.headers.authorization || req.query.token;

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
      if (remoteJid.includes('@g.us')) continue;

      const textMessage = msg.message.conversation ||
                          msg.message.extendedTextMessage?.text ||
                          msg.message.imageMessage?.caption || '';

      if (!textMessage) continue;

      try {
        let reply = '';

        if (hasOpenAI && openai) {
          if (!botMemory.has(remoteJid)) {
            botMemory.set(remoteJid, [{ role: 'system', content: config.prompt }]);
          }

          const history = botMemory.get(remoteJid);
          history.push({ role: 'user', content: textMessage });

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
          console.log(`🤖 [${name}] Respondendo Menu Numérico para ${remoteJid}...`);
          const userMsg = textMessage.trim();

          if (userMsg === '1') {
            reply = "Você escolheu *Falar com Atendente*. Um de nossos humanos já vai te responder, aguarde um instante!";
          } else if (userMsg === '2') {
            reply = "Você escolheu *Fazer um Pedido*. Acesse nosso cardápio online aqui: https://seucardapio.com";
          } else if (userMsg === '3') {
            reply = "Nosso horário de funcionamento é das 18h às 23h, de terça a domingo.";
          } else {
            reply = `Olá! O sistema de Inteligência Artificial não está configurado. Este é um menu automático:\n\nDigite a opção desejada:\n*1.* Falar com Atendente\n*2.* Fazer um Pedido\n*3.* Horário de Funcionamento`;
          }
        }

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
      // Gera data URL: "data:image/png;base64,..."
      data.qr = await QRCode.toDataURL(qr);
      data.status = 'qrcode';
      instances.set(name, data);
      console.log(`📱 [${name}] QR Code atualizado`);
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
// MANAGER ESTÁTICO
// ============================================

app.use('/manager', express.static(path.join(__dirname, '../zapwarm-manager')));

app.get('/', (req, res) => {
  res.redirect('/manager');
});

// ============================================
// HEALTH
// ============================================

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ============================================
// INSTÂNCIAS
// ============================================

app.post('/instance/create', async (req, res) => {
  try {
    const name = sanitizeInstanceName(req.body.instance || req.body.instanceName);
    const phoneNumber = req.body.phoneNumber;

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
    const data = await startInstance(name, token, phoneNumber || null);

    res.json({
      success: true,
      instance: name,
      token,
      status: data.status,
      method: phoneNumber ? 'pairing_code' : 'qrcode'
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

    if (!name || !phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Nome e número são obrigatórios',
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
    return res.status(400).json({ success: false, error: 'Instância já conectada' });
  }

  return res.status(404).json({
    success: false,
    error: 'Código ainda não gerado. Aguarde alguns segundos.',
    status: data.status
  });
});

// ------------------------------------------------------------
// QR CODE — RETORNA JSON COM base64 (formato esperado pelo frontend)
// ------------------------------------------------------------
app.get('/instance/qrcode', (req, res) => {
  const name = req.query.instance;
  const token = req.headers.token || req.headers.authorization || req.query.token;

  if (!name) {
    return res.status(400).json({ success: false, error: 'instance é obrigatório' });
  }

  const data = instances.get(name);

  if (!data) {
    return res.status(404).json({ success: false, error: 'Instância não encontrada' });
  }

  if (data.token !== token) {
    return res.status(401).json({ success: false, error: 'Token inválido' });
  }

  if (data.status === 'connected') {
    return res.json({
      success: true,
      instance: { state: 'open', user: data.sock?.user || null },
      message: 'Instância já conectada'
    });
  }

  if (!data.qr) {
    return res.status(404).json({
      success: false,
      error: 'QR code ainda não disponível. Aguarde alguns segundos.',
      instance: { state: data.status }
    });
  }

  res.json({
    success: true,
    instance: { state: data.status },
    base64: data.qr,   // data URL: "data:image/png;base64,..."
    code: data.qr
  });
});

app.get('/instance/status', (req, res) => {
  try {
    const data = getInstance(req);

    res.json({
      success: true,
      instance: {
        instance: data.instance,
        state: data.status,
        status: data.status,
        connected: data.status === 'connected',
        phone: data.phone,
        name: data.displayName,
        user: data.sock?.user || null,
      },
      // Campos "legados" também no topo, para compatibilidade
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
    name: item.instance,
    token: item.token,
    status: item.status,
    connected: item.status === 'connected',
    phone: item.phone,
    displayName: item.displayName,
  }));

  res.json({ success: true, instances: list, total: list.length });
});

app.delete('/instance/logout', async (req, res) => {
  try {
    const data = getInstance(req);

    try { await data.sock.logout(); } catch (_) {}

    instances.delete(data.instance);

    // Remove pasta da sessão
    try {
      fs.rmSync(instanceDir(data.instance), { recursive: true, force: true });
    } catch (_) {}

    res.json({ success: true, message: 'Instância desconectada com sucesso.' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// ============================================
// MENSAGENS
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
      imageBuffer = Buffer.from(await response.arrayBuffer());
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
      audioBuffer = Buffer.from(await response.arrayBuffer());
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
      videoBuffer = Buffer.from(await response.arrayBuffer());
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
      documentBuffer = Buffer.from(await response.arrayBuffer());
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
      stickerBuffer = Buffer.from(await response.arrayBuffer());
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
        contacts: [{ vcard }]
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
// CHAT CONTROLLER
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
// PERFIL
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
      pictureBuffer = Buffer.from(await response.arrayBuffer());
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
// GRUPOS
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
      pictureBuffer = Buffer.from(await response.arrayBuffer());
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
// CONTATOS
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
// STATUS
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
      imageBuffer = Buffer.from(await response.arrayBuffer());
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
// BOT IA
// ============================================

app.post('/bot/config', (req, res) => {
  try {
    const data = getInstance(req);
    const { active, prompt } = req.body;

    botConfigs.set(data.instance, {
      active: !!active,
      prompt: prompt || ''
    });

    // Limpa memória antiga
    botMemory.clear();

    res.json({
      success: true,
      message: 'Bot IA configurado com sucesso!',
      config: botConfigs.get(data.instance)
    });
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
// WEBHOOKS
// ============================================

app.post('/webhook/set', (req, res) => {
  try {
    const data = getInstance(req);
    const { url, events } = req.body;

    if (!url || !events || !Array.isArray(events)) {
      return res.status(400).json({ success: false, error: 'url e events são obrigatórios' });
    }

    webhooks.set(data.instance, { url, events });

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
// INTEGRAÇÕES
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
  cors: { origin: "*", methods: ["GET", "POST"] }
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

      const token = generateToken();
      const instData = await startInstance(instance, token, phoneNumber);

      // Aguarda o código ficar pronto
      const check = setInterval(() => {
        const cur = instances.get(instance);
        if (cur && cur.pairingCode) {
          clearInterval(check);
          socket.emit('pairing_code', {
            success: true,
            code: cur.pairingCode,
            instance,
            token
          });
          console.log(`✅ [WebSocket] Código gerado: ${cur.pairingCode}`);
        } else if (cur && cur.status === 'connected') {
          clearInterval(check);
          socket.emit('connected', { instance });
        }
      }, 1000);

      // Timeout de 60s
      setTimeout(() => clearInterval(check), 60000);

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
  console.log(`🚀 ZapBulk Baileys API`);
  console.log(`📡 Porta: ${PORT}`);
  console.log('='.repeat(60));

  try {
    await loadSavedInstances();
    console.log(`✅ ${instances.size} instâncias carregadas`);
  } catch (error) {
    console.error('❌ Erro ao carregar instâncias:', error.message);
  }
});
