import express from 'express';
import qrcode from 'qrcode';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carregar .env nativamente
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    try {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = match[2] || '';
                value = value.trim().replace(/^['"]|['"]$/g, '');
                if (!process.env[key]) process.env[key] = value;
            }
        });
    } catch (e) {}
}

const app = express();

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, apikey, token, authorization, instance');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;
const API_KEY = process.env.AUTHENTICATION_API_KEY || 'ZapWarm@Segura2026MasterKey';
const WEBHOOK_URL = process.env.WEBHOOK_GLOBAL_URL || 'http://127.0.0.1/api/webhook.php';

const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

const instances = new Map();
const contactsCache = new Map();
const chatsCache = new Map();

// ============================================================
// STORE GLOBAL DE MENSAGENS (fora do initBaileys)
// ============================================================
const msgRetryStore = new Map();


// ============================================================
// STORE GLOBAL DE MENSAGENS
// ============================================================
function saveMessageToStore(msgId, msgObj) {
    if (!msgId || !msgObj) return;
    msgRetryStore.set(msgId, msgObj);
    if (msgRetryStore.size % 50 === 0) {
        try {
            const sessions = fs.readdirSync(SESSIONS_DIR);
            for (const instName of sessions) {
                const file = path.join(SESSIONS_DIR, instName, 'messages_store.json');
                const obj = {};
                const keys = Array.from(msgRetryStore.keys()).slice(-1000);
                for (const k of keys) obj[k] = msgRetryStore.get(k);
                try { fs.writeFileSync(file, JSON.stringify(obj)); } catch (e) {}
                break;
            }
        } catch (e) {}
    }
}

const logger = pino({ level: 'silent' });

// ============================================================
// AUTH
// ============================================================
function authMiddleware(req, res, next) {
    if (req.path === '/' || req.path === '/health') return next();
    const headerKey = req.headers['apikey'] || req.headers['token'] || req.query.apikey || req.headers['authorization']?.replace('Bearer ', '');
    if (API_KEY && headerKey && headerKey !== API_KEY) {
        return res.status(401).json({ success: false, error: 'Acesso não autorizado. Chave API inválida.' });
    }
    next();
}
app.use(authMiddleware);

// ============================================================
// ROTAS BASE
// ============================================================
app.get('/', (req, res) => {
    res.json({
        status: 'UP',
        service: 'ZapWarm Native WhatsApp API',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'UP',
        service: 'ZapWarm Native WhatsApp API',
        timestamp: new Date().toISOString()
    });
});

app.all(['/system/restart', '/system/reload'], (req, res) => {
    res.json({ success: true, message: 'Reiniciando motor Baileys via PM2...' });
    setTimeout(() => process.exit(0), 500);
});

// ============================================================
// WEBHOOK
// ============================================================
async function sendWebhook(instanceName, event, data) {
    if (process.env.WEBHOOK_GLOBAL_ENABLED === 'false') return;

    const eventKey = 'WEBHOOK_EVENTS_' + event.toUpperCase().replace(/\./g, '_');
    if (process.env[eventKey] === 'false') return;

    const payload = {
        instance: instanceName,
        event: event,
        data: data,
        timestamp: new Date().toISOString()
    };
    const body = JSON.stringify(payload);

    const targetUrls = [
        'http://zapwarm.com.br/api/webhook.php',
        'http://127.0.0.1/api/webhook.php',
        'http://localhost/api/webhook.php'
    ];
    if (process.env.WEBHOOK_GLOBAL_URL && !targetUrls.includes(process.env.WEBHOOK_GLOBAL_URL)) {
        targetUrls.unshift(process.env.WEBHOOK_GLOBAL_URL);
    }

    const timeoutMs = parseInt(process.env.WEBHOOK_REQUEST_TIMEOUT_MS) || 15000;
    const headers = {
        'Content-Type': 'application/json',
        'Host': 'zapwarm.com.br',
        'User-Agent': 'ZapWarm-Baileys-Webhook/1.0'
    };

    for (const url of targetUrls) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: body,
                signal: AbortSignal.timeout(timeoutMs)
            });
            if (res.ok) break;
        } catch (e) {}
    }
}

// ============================================================
// INIT BAILEYS
// ============================================================
async function initBaileys(instanceName) {
    const sessionPath = path.join(SESSIONS_DIR, instanceName);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    let version;
    try {
        const v = await fetchLatestBaileysVersion();
        if (v && v.version) version = v.version;
    } catch (e) {}

    const contactsStoreFile = path.join(sessionPath, 'contacts_store.json');
    const chatsStoreFile = path.join(sessionPath, 'chats_store.json');

    const existing = instances.get(instanceName);
    if (existing?.socket) {
        try {
            if (existing.state === 'open') return existing;
            existing.socket.end();
        } catch (e) {}
    }

    const msgRetryCounterCache = {
        _map: new Map(),
        get(key) { return this._map.get(key); },
        set(key, val) { this._map.set(key, val); },
        del(key) { this._map.delete(key); },
        flushAll() { this._map.clear(); }
    };

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: state,
        browser: ['ZapWarm MultiDevice', 'Chrome', '120.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        msgRetryCounterCache,
        getMessage: async (key) => {
            if (key?.id && msgRetryStore.has(key.id)) {
                const stored = msgRetryStore.get(key.id);
                return stored?.message || stored;
            }
            return undefined;
        }
    });

    if (!contactsCache.has(instanceName)) contactsCache.set(instanceName, new Map());
    if (!chatsCache.has(instanceName)) chatsCache.set(instanceName, new Map());

    const instContacts = contactsCache.get(instanceName);
    const instChats = chatsCache.get(instanceName);

    try {
        if (fs.existsSync(contactsStoreFile)) {
            const raw = JSON.parse(fs.readFileSync(contactsStoreFile, 'utf-8'));
            for (const c of raw) {
                if (c && c.id) instContacts.set(c.id, c);
            }
        }
    } catch (e) {}

    try {
        if (fs.existsSync(chatsStoreFile)) {
            const rawChats = JSON.parse(fs.readFileSync(chatsStoreFile, 'utf-8'));
            for (const ch of rawChats) {
                if (ch && ch.id) instChats.set(ch.id, ch);
            }
        }
    } catch (e) {}

    const saveContactsToDisk = () => {
        try {
            const arr = Array.from(instContacts.values());
            fs.writeFileSync(contactsStoreFile, JSON.stringify(arr, null, 2));
        } catch (e) {}
    };

    const saveChatsToDisk = () => {
        try {
            const arr = Array.from(instChats.values());
            fs.writeFileSync(chatsStoreFile, JSON.stringify(arr, null, 2));
        } catch (e) {}
    };

    const instanceObj = {
        socket: sock,
        qr: null,
        state: 'connecting',
        info: null
    };

    instances.set(instanceName, instanceObj);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('contacts.upsert', (contacts) => {
        for (const c of contacts) {
            if (c.id) {
                const existingC = instContacts.get(c.id) || {};
                instContacts.set(c.id, { ...existingC, ...c });
            }
        }
        saveContactsToDisk();
    });

    sock.ev.on('contacts.update', (updates) => {
        for (const u of updates) {
            if (u.id) {
                const existingU = instContacts.get(u.id) || {};
                instContacts.set(u.id, { ...existingU, ...u });
            }
        }
        saveContactsToDisk();
    });

    sock.ev.on('messaging-history.set', ({ contacts, chats }) => {
        if (contacts) {
            for (const c of contacts) {
                if (c.id) {
                    const existingC = instContacts.get(c.id) || {};
                    instContacts.set(c.id, { ...existingC, ...c });
                }
            }
            saveContactsToDisk();
        }
        if (chats) {
            for (const ch of chats) {
                if (ch.id) instChats.set(ch.id, ch);
            }
            saveChatsToDisk();
        }
    });

    sock.ev.on('chats.upsert', (chats) => {
        for (const ch of chats) {
            if (ch.id) instChats.set(ch.id, ch);
        }
        saveChatsToDisk();
    });

    sock.ev.on('messages.upsert', async (m) => {
        for (const msg of (m.messages || [])) {
            if (msg.key?.id && msg.message) {
                saveMessageToStore(msg.key.id, msg.message);
            }
            const remoteJid = msg.key?.remoteJid;
            const pushName = msg.pushName;
            if (remoteJid && !remoteJid.includes('@g.us') && !remoteJid.includes('@lid') && !remoteJid.includes('@broadcast')) {
                if (!instContacts.has(remoteJid)) {
                    instContacts.set(remoteJid, { id: remoteJid, name: pushName, notify: pushName });
                    saveContactsToDisk();
                } else if (pushName && !instContacts.get(remoteJid).name) {
                    instContacts.get(remoteJid).name = pushName;
                    instContacts.get(remoteJid).notify = pushName;
                    saveContactsToDisk();
                }
            }

            if (remoteJid && !remoteJid.includes('@g.us') && !remoteJid.includes('@broadcast') && !remoteJid.includes('@newsletter')) {
                sendWebhook(instanceName, 'messages.upsert', msg);
            }
        }
    });

    sock.ev.on('messages.update', (updates) => {
        sendWebhook(instanceName, 'messages.update', updates);
    });

    sock.ev.on('message-receipt.update', (receipts) => {
        sendWebhook(instanceName, 'message-receipt.update', receipts);
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            try {
                const qrBase64 = await qrcode.toDataURL(qr);
                instanceObj.qr = qrBase64;
                instanceObj.state = 'connecting';
                sendWebhook(instanceName, 'qrcode.updated', { qrcode: qrBase64 });
            } catch (err) {}
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            instanceObj.state = 'close';
            instanceObj.qr = null;

            if (!shouldReconnect) {
                sendWebhook(instanceName, 'connection.update', { state: 'close', reason: statusCode });
                try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (e) {}
                instances.delete(instanceName);
                contactsCache.delete(instanceName);
                chatsCache.delete(instanceName);
            } else {
                setTimeout(() => initBaileys(instanceName), 3000);
            }
        } else if (connection === 'open') {
            instanceObj.state = 'open';
            instanceObj.qr = null;
            instanceObj.info = sock.user;
            sendWebhook(instanceName, 'connection.update', {
                state: 'open',
                user: sock.user
            });

            setTimeout(() => {
                const count = instContacts.size;
                sendWebhook(instanceName, 'contacts.count_updated', {
                    instance: instanceName,
                    totalContacts: count
                });
            }, 5000);
        }
    });

    return instanceObj;
}

// ============================================================
// INSTÂNCIAS
// ============================================================
app.get('/instance/fetchInstances', (req, res) => {
    const list = [];
    for (const [name, inst] of instances.entries()) {
        list.push({
            instanceName: name,
            state: inst.state,
            user: inst.info || null
        });
    }
    res.json({
        success: true,
        api: 'ZapWarm Native API v1.0',
        totalInstances: list.length,
        instances: list
    });
});

app.get('/instance/list', (req, res) => {
    const list = [];
    for (const [name, inst] of instances.entries()) {
        list.push({
            name: name,
            status: inst.state,
            user: inst.info || null
        });
    }
    res.json({ success: true, instances: list });
});

// ============================================================
// CONTATOS
// ============================================================
app.all(['/chat/findContacts/:instanceName', '/chat/findContacts', '/contact/fetchContacts/:instanceName', '/contact/list', '/instance/contacts/:instanceName'], (req, res) => {
    const instanceName = (req.params.instanceName || req.query.instance || req.body?.instance || req.headers.instance || '').toLowerCase();
    if (!instanceName) {
        return res.status(400).json({ success: false, error: 'O nome da instância é obrigatório.' });
    }

    const instContacts = contactsCache.get(instanceName) || new Map();
    const instChats = chatsCache.get(instanceName) || new Map();
    const diskFile = path.join(SESSIONS_DIR, instanceName, 'contacts_store.json');
    const diskChatsFile = path.join(SESSIONS_DIR, instanceName, 'chats_store.json');

    try {
        if (fs.existsSync(diskFile)) {
            const diskContacts = JSON.parse(fs.readFileSync(diskFile, 'utf-8'));
            for (const c of diskContacts) {
                if (c && c.id) instContacts.set(c.id, c);
            }
        }
    } catch (e) {}

    try {
        if (fs.existsSync(diskChatsFile)) {
            const diskChats = JSON.parse(fs.readFileSync(diskChatsFile, 'utf-8'));
            for (const ch of diskChats) {
                if (ch && ch.id) instChats.set(ch.id, ch);
            }
        }
    } catch (e) {}

    const result = [];
    const seen = new Set();

    for (const [id, c] of instContacts.entries()) {
        if (!id || id.includes('@g.us') || id.includes('@lid') || id.includes('@broadcast') || id.includes('@newsletter')) continue;
        const phone = id.split('@')[0].replace(/\D/g, '');
        if (phone.length >= 10 && !seen.has(phone)) {
            seen.add(phone);
            result.push({
                id: id,
                remoteJid: id,
                phone: phone,
                name: c.name || c.notify || c.verifiedName || c.pushName || `+${phone}`,
                pushName: c.pushName || c.name || c.notify || ''
            });
        }
    }

    for (const [id, ch] of instChats.entries()) {
        if (!id || id.includes('@g.us') || id.includes('@lid') || id.includes('@broadcast') || id.includes('@newsletter')) continue;
        const phone = id.split('@')[0].replace(/\D/g, '');
        if (phone.length >= 10 && !seen.has(phone)) {
            seen.add(phone);
            result.push({
                id: id,
                remoteJid: id,
                phone: phone,
                name: ch.name || `+${phone}`,
                pushName: ch.name || ''
            });
        }
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || result.length;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedResult = result.slice(startIndex, endIndex);

    sendWebhook(instanceName, 'contacts.count_updated', {
        instance: instanceName,
        totalContacts: result.length
    });

    res.json({
        success: true,
        instance: instanceName,
        total: result.length,
        contacts: paginatedResult,
        data: paginatedResult
    });
});

// ============================================================
// WEBHOOK FIND / SET
// ============================================================
app.all(['/webhook/find/:instanceName', '/webhook/find'], (req, res) => {
    res.json({
        enabled: true,
        url: WEBHOOK_URL,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE']
    });
});

app.all(['/webhook/set/:instanceName', '/webhook/set'], (req, res) => {
    if (req.body?.url) {
        process.env.WEBHOOK_URL = req.body.url;
    }
    res.json({ success: true, message: 'Webhook updated successfully' });
});

// ============================================================
// RESOLVE JID
// ============================================================
async function resolveTargetJid(sock, number) {
    if (!number) return null;
    let clean = number.toString().replace(/\D/g, '');
    if (!clean) return null;
    if (clean.includes('@')) return clean;

    try {
        const results = await sock.onWhatsApp(clean);
        if (results && results.length > 0 && results[0].exists && results[0].jid) {
            return results[0].jid;
        }
    } catch (e) {}

    return `${clean}@s.whatsapp.net`;
}

// ============================================================
// BOTÕES
// ============================================================
app.post(['/message/sendButtons/:instanceName', '/message/send-buttons'], async (req, res) => {
    const instanceName = (req.params.instanceName || req.body.instance || req.headers.instance || '').toLowerCase();
    const number = req.body.number || req.body.phone;
    const text = req.body.text || req.body.caption;
    const footer = req.body.footerText || req.body.footer || '';
    const buttons = req.body.buttons || [];

    const inst = instances.get(instanceName);
    if (!inst || inst.state !== 'open') {
        return res.status(400).json({ success: false, error: 'Instância WhatsApp não está conectada.' });
    }

    const jid = await resolveTargetJid(inst.socket, number);
    if (!jid) {
        return res.status(400).json({ success: false, error: 'Número de telefone inválido.' });
    }

    try {
        await inst.socket.presenceSubscribe(jid);
    } catch (e) {}

    try {
        const sent = await inst.socket.sendMessage(jid, {
            text: text,
            footer: footer,
            buttons: buttons.map((b, i) => ({
                buttonId: b.buttonId || `btn_${i}`,
                buttonText: { displayText: b.buttonText?.displayText || b.displayText || b.buttonText || `Opção ${i+1}` },
                type: 1
            })),
            headerType: 1
        });
        res.json({ success: true, key: sent.key });
    } catch (e) {
        try {
            const fallbackText = text + '\n\n' + buttons.map((b, i) => `*${i+1}.* ${b.buttonText?.displayText || b.displayText || b.buttonText}`).join('\n') + (footer ? `\n\n_${footer}_` : '');
            const sent = await inst.socket.sendMessage(jid, { text: fallbackText });
            res.json({ success: true, key: sent.key });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    }
});

// ============================================================
// CRIAR INSTÂNCIA
// ============================================================
app.post('/instance/create', async (req, res) => {
    const instanceName = req.body.instanceName || req.body.instance || req.body.instanceId;
    if (!instanceName) {
        return res.status(400).json({ success: false, error: 'O nome da instância é obrigatório.' });
    }

    const cleanName = instanceName.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();

    try {
        if (!instances.has(cleanName)) {
            await initBaileys(cleanName);
        }
        res.json({
            success: true,
            instance: {
                instanceName: cleanName,
                status: 'created'
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// CONECTAR / QR
// ============================================================
app.get(['/instance/connect/:instanceName', '/instance/qrcode'], async (req, res) => {
    const instanceName = (req.params.instanceName || req.query.instance || req.headers.instance || '').toLowerCase();
    if (!instanceName) {
        return res.status(400).json({ success: false, error: 'Instância não informada' });
    }

    let inst = instances.get(instanceName);
    if (!inst) {
        inst = await initBaileys(instanceName);
    }

    if (inst.state === 'open') {
        return res.json({
            success: true,
            instance: {
                state: 'open',
                user: inst.info
            }
        });
    }

    res.json({
        success: true,
        base64: inst.qr,
        code: inst.qr,
        instance: {
            state: inst.state
        }
    });
});

// ============================================================
// STATUS
// ============================================================
app.get(['/instance/connectionState/:instanceName', '/instance/status'], (req, res) => {
    const instanceName = (req.params.instanceName || req.query.instance || req.headers.instance || '').toLowerCase();
    const inst = instances.get(instanceName);
    if (!inst) {
        return res.json({
            success: true,
            instance: { state: 'close' }
        });
    }

    res.json({
        success: true,
        instance: {
            state: inst.state,
            user: inst.info
        }
    });
});

// ============================================================
// ENVIAR TEXTO
// ============================================================
app.post(['/message/sendText/:instanceName', '/message/send-text'], async (req, res) => {
    const instanceName = (req.params.instanceName || req.body.instance || req.headers.instance || '').toLowerCase();
    const number = req.body.number || req.body.phone;
    const textMessage = req.body.textMessage || req.body.text || req.body.message;
    const options = req.body.options || {};

    const inst = instances.get(instanceName);
    if (!inst || inst.state !== 'open') {
        return res.status(400).json({ success: false, error: 'Instância WhatsApp não está conectada.' });
    }

    const text = typeof textMessage === 'object' ? textMessage.text : textMessage;
    if (!number || !text) {
        return res.status(400).json({ success: false, error: 'Número e mensagem são obrigatórios.' });
    }

    let jid;
    try {
        const cleanNumber = number.toString().replace(/\D/g, '');
        const results = await inst.socket.onWhatsApp(cleanNumber);
        if (results && results.length > 0 && results[0].exists && results[0].jid) {
            jid = results[0].jid;
        } else {
            jid = `${cleanNumber}@s.whatsapp.net`;
        }
    } catch (e) {
        jid = `${number.toString().replace(/\D/g, '')}@s.whatsapp.net`;
    }

    try {
        // Handshake Signal
        try {
            await inst.socket.presenceSubscribe(jid);
            await new Promise(r => setTimeout(r, 1200));
        } catch (subErr) {
            console.warn(`[${instanceName}] presenceSubscribe falhou:`, subErr.message);
        }

        // Digitação humana
        try {
            const charCount = text.length;
            const typingDuration = Math.max(3500, Math.min(18000, charCount * 80 + Math.random() * 2000));

            await inst.socket.sendPresenceUpdate('composing', jid);

            if (typingDuration > 8000) {
                await new Promise(r => setTimeout(r, typingDuration * 0.4));
                await inst.socket.sendPresenceUpdate('paused', jid);
                await new Promise(r => setTimeout(r, 700 + Math.random() * 800));
                await inst.socket.sendPresenceUpdate('composing', jid);
                await new Promise(r => setTimeout(r, typingDuration * 0.5));
            } else {
                await new Promise(r => setTimeout(r, typingDuration));
            }

            await inst.socket.sendPresenceUpdate('paused', jid);
            await new Promise(r => setTimeout(r, 400));
        } catch (pErr) {
            console.warn(`[${instanceName}] Erro na presença:`, pErr.message);
        }

        // Enviar
        const sent = await inst.socket.sendMessage(jid, { text: text });

        // Salvar mensagem (função GLOBAL agora)
        if (sent?.key?.id && sent?.message) {
            saveMessageToStore(sent.key.id, sent.message);
        }

        res.json({
            success: true,
            key: sent.key,
            message: sent.message
        });
    } catch (error) {
        console.error(`[${instanceName}] Erro ao enviar texto:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// ENVIAR MÍDIA
// ============================================================
app.post(['/message/sendMedia/:instanceName', '/message/send-media', '/message/send-image', '/message/send-audio', '/message/send-document'], async (req, res) => {
    const instanceName = (req.params.instanceName || req.body.instance || req.headers.instance || '').toLowerCase();
    const number = req.body.number || req.body.phone;
    const mediaMessage = req.body.mediaMessage || req.body;
    const options = req.body.options || {};

    const inst = instances.get(instanceName);
    if (!inst || inst.state !== 'open') {
        return res.status(400).json({ success: false, error: 'Instância WhatsApp não está conectada.' });
    }

    const jid = await resolveTargetJid(inst.socket, number);
    if (!jid) {
        return res.status(400).json({ success: false, error: 'Número não identificado no WhatsApp.' });
    }

    try {
        await inst.socket.presenceSubscribe(jid);
        await new Promise(r => setTimeout(r, 1200));
    } catch (e) {}

    try {
        const payload = {};
        const mediaUrl = mediaMessage.media || mediaMessage.url || mediaMessage.image || mediaMessage.audio || mediaMessage.document;
        const mediaType = mediaMessage.mediatype || (req.path.includes('image') ? 'image' : (req.path.includes('audio') ? 'audio' : 'document'));

        if (mediaType === 'image') {
            try {
                await inst.socket.sendPresenceUpdate('composing', jid);
                await new Promise(r => setTimeout(r, options.delay || 3500));
                await inst.socket.sendPresenceUpdate('paused', jid);
                await new Promise(r => setTimeout(r, 600));
            } catch (e) {}
            payload.image = { url: mediaUrl };
            if (mediaMessage.caption) payload.caption = mediaMessage.caption;
        } else if (mediaType === 'audio') {
            const recordingDuration = options.delay || (Math.floor(Math.random() * 4000) + 4000);
            try {
                await inst.socket.sendPresenceUpdate('recording', jid);
                await new Promise(r => setTimeout(r, recordingDuration));
                await inst.socket.sendPresenceUpdate('paused', jid);
                await new Promise(r => setTimeout(r, 600));
            } catch (e) {}
            payload.audio = { url: mediaUrl };
            payload.mimetype = 'audio/mp4';
            payload.ptt = true;
        } else if (mediaType === 'document') {
            payload.document = { url: mediaUrl };
            payload.mimetype = 'application/pdf';
            if (mediaMessage.caption) payload.fileName = mediaMessage.caption;
        }

        const sent = await inst.socket.sendMessage(jid, payload);
        if (sent?.key?.id && sent?.message) {
            saveMessageToStore(sent.key.id, sent.message);
        }

        res.json({ success: true, key: sent.key, mediaType: mediaType });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// LOGOUT / DELETE
// ============================================================
app.delete(['/instance/logout/:instanceName', '/instance/logout'], async (req, res) => {
    const instanceName = (req.params.instanceName || req.query.instance || req.headers.instance || '').toLowerCase();
    const inst = instances.get(instanceName);
    if (inst) {
        try { await inst.socket.logout(); } catch (e) {}
        instances.delete(instanceName);
        contactsCache.delete(instanceName);
        chatsCache.delete(instanceName);
    }
    const sessionPath = path.join(SESSIONS_DIR, instanceName);
    try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (e) {}
    res.json({ success: true });
});

app.delete(['/instance/delete/:instanceName', '/instance/delete'], async (req, res) => {
    const instanceName = (req.params.instanceName || req.query.instance || req.headers.instance || '').toLowerCase();
    const inst = instances.get(instanceName);
    if (inst) {
        try { await inst.socket.end(); } catch (e) {}
        instances.delete(instanceName);
        contactsCache.delete(instanceName);
        chatsCache.delete(instanceName);
    }
    const sessionPath = path.join(SESSIONS_DIR, instanceName);
    try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (e) {}
    res.json({ success: true });
});

// ============================================================
// RESTAURAR SESSÕES
// ============================================================
if (fs.existsSync(SESSIONS_DIR)) {
    fs.readdir(SESSIONS_DIR, (err, files) => {
        if (!err && files) {
            files.forEach(folder => {
                const fullPath = path.join(SESSIONS_DIR, folder);
                if (fs.statSync(fullPath).isDirectory()) {
                    initBaileys(folder).catch(() => {});
                }
            });
        }
    });
}

app.listen(PORT, '0.0.0.0', () => {
    console.log('=========================================');
    console.log('🚀 ZapWarm Native WhatsApp API Ativa!');
    console.log(`📡 Porta: ${PORT}`);
    console.log(`🔑 Chave Mestre: ${API_KEY}`);
    console.log('=========================================');
});