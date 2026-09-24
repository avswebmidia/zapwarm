const API_BASE = (window.location.origin === 'null' || window.location.origin.includes('file://')) ? 'http://169.58.10.190:8080' : window.location.origin;
const GLOBAL_API_KEY = 'SUA_SENHA_GLOBAL_AQUI';

async function apiFetch(endpoint, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    const text = await response.text();
    try { return text ? JSON.parse(text) : {}; }
    catch (e) { return { success: false, error: 'Resposta inválida', raw: text }; }
}

async function loadInstances() {
    try {
        const res = await apiFetch('/instance/list');
        const listEl = document.getElementById('instances-list');
        listEl.innerHTML = '';
        if (!res.success || !res.instances || res.instances.length === 0) {
            listEl.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-gray-400">Nenhuma instância encontrada. Crie uma nova!</td></tr>`;
            document.getElementById('count-total').innerText = 0;
            document.getElementById('count-open').innerText = 0;
            document.getElementById('count-closed').innerText = 0;
            return;
        }
        let total = res.instances.length, open = 0, closed = 0;
        res.instances.forEach(inst => {
            const instanceName = inst.instance || inst.name || '';
            const instanceToken = inst.token || '';
            const status = inst.status || 'close';
            const isConnected = status === 'connected' || inst.connected === true;
            let statusBadge = '';
            if (isConnected) {
                statusBadge = `<span class="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold flex items-center w-fit gap-1.5"><span class="w-2 h-2 bg-green-500 rounded-full"></span> OPEN</span>`;
                open++;
            } else if (status === 'connecting' || status === 'qrcode' || status === 'pairing_code') {
                statusBadge = `<span class="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-bold flex items-center w-fit gap-1.5"><span class="w-2 h-2 bg-yellow-500 rounded-full"></span> AGUARDANDO</span>`;
                closed++;
            } else {
                statusBadge = `<span class="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold flex items-center w-fit gap-1.5"><span class="w-2 h-2 bg-red-500 rounded-full"></span> CLOSE</span>`;
                closed++;
            }
            let phoneDisplay = isConnected ? `<span class="text-gray-600 font-medium">${inst.phone || inst.name || 'Conectado'}</span>` : `<span class="text-gray-400 italic">Não conectado</span>`;
            listEl.innerHTML += `
                <tr class="hover:bg-gray-50 transition-colors group">
                    <td class="py-4 px-6 font-semibold text-gray-700 flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                            <i class="fa-brands fa-whatsapp text-xl"></i>
                        </div>
                        ${instanceName}
                    </td>
                    <td class="py-4 px-6">${statusBadge}</td>
                    <td class="py-4 px-6 text-sm">${phoneDisplay}</td>
                    <td class="py-4 px-6 text-right space-x-2">
                        ${!isConnected ? `<button onclick="connectInstance('${instanceName}', '${instanceToken}')" class="text-primary hover:bg-primary hover:text-white font-medium transition-colors border border-primary px-4 py-1.5 rounded-lg text-xs shadow-sm">Conectar (QR)</button>` : ''}
                        <button onclick="configBot('${instanceName}', '${instanceToken}')" class="text-gray-400 hover:text-emerald-500 transition-colors ml-2 bg-gray-50 hover:bg-emerald-50 w-8 h-8 rounded" title="Configurar IA"><i class="fa-solid fa-robot"></i></button>
                        <button onclick="deleteInstance('${instanceName}', '${instanceToken}')" class="text-gray-400 hover:text-red-500 transition-colors ml-1 bg-gray-50 hover:bg-red-50 w-8 h-8 rounded" title="Excluir"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            `;
        });
        document.getElementById('count-total').innerText = total;
        document.getElementById('count-open').innerText = open;
        document.getElementById('count-closed').innerText = closed;
    } catch (error) {
        console.error(error);
        document.getElementById('instances-list').innerHTML = `<tr><td colspan="4" class="text-center py-8 text-red-400">Erro ao carregar instâncias da API.</td></tr>`;
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
    try {
        const res = await apiFetch('/bot/config', { headers: { instance: name, token: token } });
        if (res.success && res.config) currentConfig = res.config;
    } catch (e) {}
    const { value: formValues } = await Swal.fire({
        title: `Configurar IA - ${name}`,
        html: `<div class="text-left mt-4">
            <label class="flex items-center gap-2 mb-4 text-sm font-bold">
                <input type="checkbox" id="bot-active" class="w-5 h-5 text-emerald-600 rounded" ${currentConfig.active ? 'checked' : ''}>
                Ativar Robô ChatGPT
            </label>
            <textarea id="bot-prompt" class="w-full h-32 p-3 border rounded-lg text-sm">${currentConfig.prompt || ''}</textarea>
        </div>`,
        focusConfirm: false, showCancelButton: true,
        confirmButtonText: 'Salvar', cancelButtonText: 'Cancelar',
        preConfirm: () => ({ active: document.getElementById('bot-active').checked, prompt: document.getElementById('bot-prompt').value })
    });
    if (formValues) {
        Swal.fire({ title: 'Salvando...', didOpen: () => Swal.showLoading() });
        const saveRes = await apiFetch('/bot/config', { method: 'POST', headers: { instance: name, token: token }, body: JSON.stringify(formValues) });
        if (saveRes.success) Swal.fire('IA Configurada!', formValues.active ? 'Bot ativo.' : 'Bot desligado.', 'success');
        else Swal.fire('Erro', saveRes.error || 'Falha.', 'error');
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
    if (document.getElementById('qr-modal').classList.contains('hidden')) loadInstances();
}, 15000);
