const API_BASE = (window.location.origin === 'null' || window.location.origin.includes('file://')) ? 'http://169.58.10.190:8080' : window.location.origin;
const GLOBAL_API_KEY = '222562055';

// ============================================================
// AUTENTICAÇÃO - API Key
// ============================================================
function getApiKey() {
    // 1. localStorage
    let key = localStorage.getItem('zapwarm_api_key');
    if (key) return key;

    // 2. sessionStorage
    key = sessionStorage.getItem('zapwarm_api_key');
    if (key) {
        localStorage.setItem('zapwarm_api_key', key);
        return key;
    }

    // 3. URL (?key=xxx)
    const urlParams = new URLSearchParams(window.location.search);
    key = urlParams.get('key');
    if (key) {
        localStorage.setItem('zapwarm_api_key', key);
        sessionStorage.setItem('zapwarm_api_key', key);
        // Limpa a chave da URL
        window.history.replaceState({}, '', window.location.pathname);
        return key;
    }

    console.warn('[getApiKey] Nenhuma chave encontrada');
    return null;
}

async function apiFetch(endpoint, options = {}) {
    const apiKey = getApiKey();

    // Se não tem chave, vai direto para o login (só se não estiver no login)
    if (!apiKey && !window.location.pathname.includes('login')) {
        console.warn('[apiFetch] Sem chave, redirecionando para login');
        window.location.href = '/manager/login.html';
        return { success: false, error: 'Não autenticado' };
    }

    const headers = {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey || '',
        ...options.headers
    };

    const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });

    // Tratamento de 401
    if (response.status === 401) {
        console.error('[apiFetch] 401 em', endpoint);
        // Se está em página autenticada e recebeu 401, volta para login
        if (!window.location.pathname.includes('login')) {
            console.warn('[apiFetch] Chave rejeitada, voltando para login');
            localStorage.removeItem('zapwarm_api_key');
            sessionStorage.removeItem('zapwarm_api_key');
            window.location.href = '/manager/login.html';
        }
        return { success: false, error: 'Não autenticado', status: 401 };
    }

    const text = await response.text();
    try { return text ? JSON.parse(text) : {}; }
    catch (e) { return { success: false, error: 'Resposta inválida', raw: text }; }
}

async function loadInstances() {
    const listEl = document.getElementById('instances-list');
    if (!listEl) return;

    try {
        const res = await apiFetch('/instance/list');
        listEl.innerHTML = '';

        if (!res.success || !res.instances || res.instances.length === 0) {
            listEl.innerHTML = '<div style="text-align:center; padding:48px 16px; color:#94a3b8;">Nenhuma instância encontrada. Crie uma nova!</div>';
            const c1 = document.getElementById('count-total');
            const c2 = document.getElementById('count-open');
            const c3 = document.getElementById('count-closed');
            if (c1) c1.innerText = 0;
            if (c2) c2.innerText = 0;
            if (c3) c3.innerText = 0;
            return;
        }

        let total = res.instances.length;
        let open = 0;
        let closed = 0;

        res.instances.forEach(inst => {
            const instanceName = inst.instance || inst.name || '';
            const instanceToken = inst.token || '';
            const status = inst.status || 'close';
            const isConnected = status === 'connected' || inst.connected === true;

            let statusClass = 'close';
            let statusText = 'CLOSE';
            if (isConnected) {
                statusClass = 'open';
                statusText = 'OPEN';
                open++;
            } else if (status === 'connecting' || status === 'qrcode' || status === 'pairing_code') {
                statusClass = 'waiting';
                statusText = 'AGUARDANDO';
                closed++;
            } else {
                closed++;
            }

            const phoneDisplay = isConnected
                ? '<span style="color:#475569; font-weight:500;">' + (inst.phone || inst.name || 'Conectado') + '</span>'
                : '<span style="color:#94a3b8; font-style:italic;">Não conectado</span>';

            const connectBtn = !isConnected
                ? '<button onclick="connectInstance(\'' + instanceName + '\', \'' + instanceToken + '\')" class="btn btn-primary" style="min-height:38px; padding:8px 16px; font-size:13px;">Conectar QR</button>'
                : '';

            // ✅ HTML com <div class="table-row"> e <div class="table-cell">
            listEl.innerHTML += '<div class="table-row">' +
                '<div class="table-cell" data-label="Instância">' +
                    '<div class="instance-name">' +
                        '<div class="instance-avatar"><i class="fa-brands fa-whatsapp"></i></div>' +
                        '<span>' + instanceName + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="table-cell" data-label="Status">' +
                    '<span class="status-badge ' + statusClass + '">' +
                        '<span class="status-dot"></span>' +
                        statusText +
                    '</span>' +
                '</div>' +
                '<div class="table-cell" data-label="Número">' +
                    phoneDisplay +
                '</div>' +
                '<div class="table-cell actions-cell">' +
                    connectBtn +
                    '<button onclick="configBot(\'' + instanceName + '\', \'' + instanceToken + '\')" class="btn-icon success" title="Configurar IA">' +
                        '<i class="fa-solid fa-robot"></i>' +
                    '</button>' +
                    '<button onclick="deleteInstance(\'' + instanceName + '\', \'' + instanceToken + '\')" class="btn-icon danger" title="Excluir">' +
                        '<i class="fa-solid fa-trash"></i>' +
                    '</button>' +
                '</div>' +
            '</div>';
        });

        const c1 = document.getElementById('count-total');
        const c2 = document.getElementById('count-open');
        const c3 = document.getElementById('count-closed');
        if (c1) c1.innerText = total;
        if (c2) c2.innerText = open;
        if (c3) c3.innerText = closed;
    } catch (error) {
        console.error(error);
        listEl.innerHTML = '<div style="text-align:center; padding:48px 16px; color:#dc2626;">Erro ao carregar instâncias da API.</div>';
    }
}

async function openCreateModal() {
    const { value: name } = await Swal.fire({
        title: 'Nova Instância',
        input: 'text',
        inputLabel: 'Nome da Conexão (sem espaços)',
        inputPlaceholder: 'Ex: SuporteVendas',
        showCancelButton: true,
        confirmButtonText: 'Criar',
        cancelButtonText: 'Cancelar',
        inputValidator: (value) => {
            if (!value) return 'Informe um nome!';
            if (!/^[a-zA-Z0-9_-]+$/.test(value)) return 'Use apenas letras, números, - e _';
            return null;
        }
    });
    if (name) {
        Swal.fire({ title: 'Criando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const res = await apiFetch('/instance/create', { method: 'POST', body: JSON.stringify({ instance: name }) });
        if (res.success) {
            Swal.fire('Sucesso!', 'Instância criada.', 'success');
            loadInstances();
            setTimeout(() => { connectInstance(res.instance || name, res.token || ''); }, 1200);
        } else {
            Swal.fire('Erro', res.error || 'Falha ao criar.', 'error');
        }
    }
}

async function connectInstance(name, token) {
    const modal = document.getElementById('qr-modal');
    const loading = document.getElementById('qr-loading');
    const img = document.getElementById('qr-image');
    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    img.classList.add('hidden');
    img.src = '';
    if (window.qrCheckInterval) { clearInterval(window.qrCheckInterval); window.qrCheckInterval = null; }
    let tentativas = 0;
    const MAX_TENTATIVAS = 60;
    async function buscarQr() {
        try {
            const res = await apiFetch(`/instance/qrcode?instance=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}`, { headers: { instance: name, token: token } });
            if (res.success && res.instance && res.instance.state === 'open') return { conectado: true };
            const dataUrl = res.base64 || res.code;
            if (res.success && dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:image')) {
                img.onload = () => { loading.classList.add('hidden'); img.classList.remove('hidden'); };
                img.src = dataUrl;
                return { conectado: false, qr: true };
            }
            return { conectado: false, qr: false, erro: res.error };
        } catch (e) { return { conectado: false, qr: false, erro: e.message }; }
    }
    await buscarQr();
    window.qrCheckInterval = setInterval(async () => {
        tentativas++;
        try {
            const statusRes = await apiFetch('/instance/status', { headers: { instance: name, token: token } });
            const state = statusRes.instance?.state || statusRes.status;
            if (statusRes.success && state === 'connected') {
                clearInterval(window.qrCheckInterval); window.qrCheckInterval = null;
                closeQrModal();
                Swal.fire('Conectado!', 'WhatsApp pareado com sucesso.', 'success');
                loadInstances();
                return;
            }
            await buscarQr();
            if (tentativas >= MAX_TENTATIVAS) {
                clearInterval(window.qrCheckInterval); window.qrCheckInterval = null;
                closeQrModal();
                Swal.fire('Tempo esgotado', 'Não foi possível conectar.', 'warning');
            }
        } catch (e) {}
    }, 4000);
}

function closeQrModal() {
    document.getElementById('qr-modal').classList.add('hidden');
    if (window.qrCheckInterval) { clearInterval(window.qrCheckInterval); window.qrCheckInterval = null; }
}

async function configBot(name, token) {
    Swal.fire({ title: 'Carregando IA...', didOpen: () => Swal.showLoading() });

    let currentConfig = { active: false, prompt: '' };
    let keyInfo = { hasKey: false, source: 'none', maskedKey: null };
    let pesquisaConfig = { enabled: false, mensagem: '', timeoutMinutos: 30 };

    try {
        const [cfgRes, keyRes, pesqRes] = await Promise.all([
            apiFetch('/bot/config', { headers: { instance: name, token: token } }),
            apiFetch('/bot/apikey', { headers: { instance: name, token: token } }),
            apiFetch('/bot/pesquisa', { headers: { instance: name, token: token } }).catch(() => ({}))
        ]);
        if (cfgRes.success && cfgRes.config) currentConfig = cfgRes.config;
        if (keyRes.success) keyInfo = keyRes;
        if (pesqRes.success && pesqRes.config) pesquisaConfig = pesqRes.config;
    } catch (e) {
        console.warn('[configBot] Erro:', e);
    }

    const keyStatus = keyInfo.hasKey
        ? '<span style="color:#10b981; font-weight:bold;">Ativa</span> <span style="font-size:11px; color:#666;">(' + (keyInfo.source === 'instance' ? 'desta instancia' : 'global') + ')</span>'
        : '<span style="color:#ef4444; font-weight:bold;">Nao configurada</span>';

    const maskedDisplay = keyInfo.maskedKey
        ? 'Chave atual: <code style="background:#f3f4f6; padding:2px 6px; border-radius:4px; font-family:monospace;">' + keyInfo.maskedKey + '</code>'
        : 'Nenhuma chave configurada ainda.';

    const { value: formValues } = await Swal.fire({
        title: 'Configurar IA - ' + name,
        width: 700,
        html:
            '<div style="text-align:left; margin-top:16px;">' +

                '<div style="background:#f9fafb; padding:16px; border-radius:12px; border:1px solid #e5e7eb; margin-bottom:16px;">' +
                    '<label style="display:flex; align-items:center; gap:10px; font-size:14px; font-weight:bold; color:#374151; margin-bottom:12px; cursor:pointer;">' +
                        '<input type="checkbox" id="bot-active" style="width:20px; height:20px; accent-color:#10b981;" ' + (currentConfig.active ? 'checked' : '') + '>' +
                        'Ativar Robo IA (Groq)' +
                    '</label>' +
                    '<label style="display:block; font-size:12px; font-weight:bold; color:#6b7280; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">Prompt / Comportamento da IA:</label>' +
                    '<textarea id="bot-prompt" style="width:100%; height:140px; padding:12px; border:1px solid #d1d5db; border-radius:8px; font-size:13px; font-family:monospace; box-sizing:border-box; resize:vertical;" placeholder="Ex: Voce e a Sofia...">' + (currentConfig.prompt || '') + '</textarea>' +
                '</div>' +

                '<div style="background:#f9fafb; padding:16px; border-radius:12px; border:1px solid #e5e7eb; margin-bottom:16px;">' +
                    '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">' +
                        '<label style="font-size:14px; font-weight:bold; color:#374151;">Chave API Groq:</label>' +
                        '<div style="font-size:12px;">' + keyStatus + '</div>' +
                    '</div>' +
                    '<div style="font-size:12px; color:#6b7280; margin-bottom:8px;">' + maskedDisplay + '</div>' +
                    '<input type="text" id="bot-apikey" style="width:100%; padding:10px; border:1px solid #d1d5db; border-radius:8px; font-size:13px; font-family:monospace; box-sizing:border-box;" placeholder="Cole aqui a nova chave gsk_...">' +
                    '<div style="font-size:11px; color:#9ca3af; margin-top:6px;">Deixe em branco para manter. Obtenha uma gratis em <a href="https://console.groq.com/keys" target="_blank" style="color:#10b981; text-decoration:underline;">console.groq.com/keys</a></div>' +
                '</div>' +

                '<div style="background:#fffbeb; padding:16px; border-radius:12px; border:1px solid #fde68a; margin-bottom:16px;">' +
                    '<label style="display:flex; align-items:center; gap:10px; font-size:14px; font-weight:bold; color:#92400e; margin-bottom:12px; cursor:pointer;">' +
                        '<input type="checkbox" id="pesquisa-enabled" style="width:20px; height:20px; accent-color:#f59e0b;" ' + (pesquisaConfig.enabled ? 'checked' : '') + '>' +
                        'Enviar pesquisa de avaliacao apos o atendimento' +
                    '</label>' +
                    '<div style="margin-bottom:12px;">' +
                        '<label style="display:block; font-size:12px; font-weight:bold; color:#92400e; margin-bottom:6px;">Tempo de inatividade (minutos):</label>' +
                        '<input type="number" id="pesquisa-timeout" min="1" max="1440" value="' + (pesquisaConfig.timeoutMinutos || 30) + '" style="width:100%; padding:10px; border:1px solid #fde68a; border-radius:8px; font-size:13px; box-sizing:border-box; background:#fff;">' +
                    '</div>' +
                    '<div>' +
                        '<label style="display:block; font-size:12px; font-weight:bold; color:#92400e; margin-bottom:6px;">Mensagem da pesquisa:</label>' +
                        '<textarea id="pesquisa-mensagem" style="width:100%; height:60px; padding:10px; border:1px solid #fde68a; border-radius:8px; font-size:13px; box-sizing:border-box; resize:vertical; background:#fff;">' + (pesquisaConfig.mensagem || 'Ola! Como voce avalia nosso atendimento?') + '</textarea>' +
                    '</div>' +
                '</div>' +

                '<div style="font-size:11px; background:#eff6ff; border-left:4px solid #3b82f6; padding:10px 12px; border-radius:4px; color:#1e40af;">' +
                    'Todas as alteracoes sao salvas no servidor.' +
                '</div>' +
            '</div>',
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Salvar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#6b7280',
        preConfirm: () => {
            return {
                active: document.getElementById('bot-active').checked,
                prompt: document.getElementById('bot-prompt').value,
                apiKey: document.getElementById('bot-apikey').value.trim(),
                pesquisaEnabled: document.getElementById('pesquisa-enabled').checked,
                pesquisaTimeout: parseInt(document.getElementById('pesquisa-timeout').value) || 30,
                pesquisaMensagem: document.getElementById('pesquisa-mensagem').value
            };
        }
    });

    if (!formValues) return;

    Swal.fire({ title: 'Salvando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        const saveRes = await apiFetch('/bot/config', {
            method: 'POST',
            headers: { instance: name, token: token },
            body: JSON.stringify({ active: formValues.active, prompt: formValues.prompt })
        });
        if (!saveRes.success) throw new Error(saveRes.error || 'Falha ao salvar config');

        if (formValues.apiKey) {
            const keyRes = await apiFetch('/bot/apikey', {
                method: 'POST',
                headers: { instance: name, token: token },
                body: JSON.stringify({ apiKey: formValues.apiKey })
            });
            if (!keyRes.success) throw new Error(keyRes.error || 'Falha ao salvar chave');
        }

        const pesqRes = await apiFetch('/bot/pesquisa', {
            method: 'POST',
            headers: { instance: name, token: token },
            body: JSON.stringify({
                enabled: formValues.pesquisaEnabled,
                mensagem: formValues.pesquisaMensagem,
                timeoutMinutos: formValues.pesquisaTimeout
            })
        });

        Swal.fire({
            icon: 'success',
            title: 'Salvo!',
            html: '<p>' + (formValues.active ? 'IA ATIVADA' : 'IA DESLIGADA') + '</p>' +
                  (formValues.pesquisaEnabled ? '<p style="color:#f59e0b;">Pesquisa ativada (' + formValues.pesquisaTimeout + ' min)</p>' : '') +
                  (formValues.apiKey ? '<p style="color:#10b981;">Chave Groq atualizada</p>' : ''),
            timer: 2000,
            showConfirmButton: false
        });
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

async function deleteInstance(name, token) {
    const result = await Swal.fire({
        title: 'Tem certeza?', text: "Isso vai apagar a sessão!",
        icon: 'warning', showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Sim, excluir!', cancelButtonText: 'Cancelar'
    });
    if (result.isConfirmed) {
        Swal.fire({ title: 'Excluindo...', didOpen: () => Swal.showLoading() });
        const res = await apiFetch('/instance/logout', { method: 'DELETE', headers: { instance: name, token: token } });
        if (res.success) { Swal.fire('Excluído!', 'Conexão encerrada.', 'success'); loadInstances(); }
        else Swal.fire('Erro', res.error || 'Falha.', 'error');
    }
}

function openAIAgents() {
    Swal.fire({ title: 'Agentes de IA', html: '<p class="text-sm text-gray-600">Clique no ícone do robô na linha da instância para configurar.</p>', icon: 'info' });
}

loadInstances();
setInterval(() => {
    const qrModal = document.getElementById('qr-modal');
    const listEl = document.getElementById('instances-list');
    // Só recarrega se estiver na página de instâncias E o modal estiver fechado
    if (listEl && (!qrModal || qrModal.classList.contains('hidden'))) {
        loadInstances();
    }
}, 15000);


// ============================================================
// MENU HAMBÚRGUER MOBILE
// ============================================================
function toggleSidebar() {
    try {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        
        if (!sidebar) {
            console.warn('[toggleSidebar] .sidebar não encontrado');
            return;
        }
        
        sidebar.classList.toggle('open');
        
        if (overlay) {
            overlay.classList.toggle('open');
        }
    } catch (e) {
        console.error('[toggleSidebar] Erro:', e);
    }
}

function closeSidebar() {
    try {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('open');
    } catch (e) {
        console.error('[closeSidebar] Erro:', e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) overlay.addEventListener('click', closeSidebar);
});


// ============================================================
// LOGOUT
// ============================================================
function logout() {
    if (confirm('Deseja sair do painel?')) {
        // Limpar localStorage e sessionStorage
        localStorage.removeItem('zapwarm_api_key');
        sessionStorage.removeItem('zapwarm_api_key');

        // Limpar cookie no servidor
        fetch('/auth/logout', { method: 'POST' }).finally(() => {
            // Limpar cookie no cliente também
            document.cookie = 'zapwarm_key=; Max-Age=0; Path=/';
            window.location.href = '/manager/login.html';
        });
    }
}


// ============================================================
// AUTENTICAÇÃO - API Key
// ============================================================
if (typeof getApiKey === 'undefined') {
    window.getApiKey = function() {
        // 1. localStorage
        let key = localStorage.getItem('zapwarm_api_key');
        if (key) return key;
        
        // 2. sessionStorage
        key = sessionStorage.getItem('zapwarm_api_key');
        if (key) {
            localStorage.setItem('zapwarm_api_key', key);
            return key;
        }
        
        // 3. URL (?key=xxx)
        const urlParams = new URLSearchParams(window.location.search);
        key = urlParams.get('key');
        if (key) {
            localStorage.setItem('zapwarm_api_key', key);
            sessionStorage.setItem('zapwarm_api_key', key);
            window.history.replaceState({}, '', window.location.pathname);
            return key;
        }
        
        console.warn('[getApiKey] Nenhuma chave encontrada');
        return null;
    };
}

// ============================================================
// LOGOUT
// ============================================================
if (typeof window.logout === 'undefined') {
    window.logout = function() {
        if (confirm('Deseja sair do painel?')) {
            localStorage.removeItem('zapwarm_api_key');
            sessionStorage.removeItem('zapwarm_api_key');
            window.location.href = '/manager/login.html';
        }
    };
}

// ============================================================
// MENU HAMBÚRGUER
// ============================================================
if (typeof window.toggleSidebar === 'undefined') {
    window.toggleSidebar = function() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        if (sidebar) sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('open');
    };
}

if (typeof window.closeSidebar === 'undefined') {
    window.closeSidebar = function() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('open');
    };
}
