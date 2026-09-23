const API_BASE = window.location.origin; // Usa o domínio dinâmico (onde está hospedado)
// Na versão final, a Senha Global deve vir de um sistema de login
const GLOBAL_API_KEY = 'SUA_SENHA_GLOBAL_AQUI'; 

// Fetch helpers
async function apiFetch(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        'apikey': GLOBAL_API_KEY,
        ...options.headers
    };
    
    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers
    });
    
    return response.json();
}

// Carregar instâncias
async function loadInstances() {
    try {
        const res = await apiFetch('/instance/list');
        const listEl = document.getElementById('instances-list');
        listEl.innerHTML = '';

        if (!res.success || !res.data || res.data.length === 0) {
            listEl.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-gray-400">Nenhuma instância encontrada. Crie uma nova!</td></tr>`;
            return;
        }

        res.data.forEach(inst => {
            let statusBadge = '';
            if (inst.status === 'connected') {
                statusBadge = `<span class="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold flex items-center w-fit gap-1"><span class="w-1.5 h-1.5 bg-green-500 rounded-full"></span> OPEN</span>`;
            } else if (inst.status === 'connecting' || inst.status === 'qrcode') {
                statusBadge = `<span class="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-semibold flex items-center w-fit gap-1"><span class="w-1.5 h-1.5 bg-yellow-500 rounded-full"></span> AGUARDANDO</span>`;
            } else {
                statusBadge = `<span class="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold flex items-center w-fit gap-1"><span class="w-1.5 h-1.5 bg-red-500 rounded-full"></span> CLOSE</span>`;
            }

            listEl.innerHTML += `
                <tr class="hover:bg-gray-50 transition-colors">
                    <td class="py-4 px-6 font-medium text-gray-800 flex items-center gap-3">
                        <div class="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-gray-500">
                            <i class="fa-brands fa-whatsapp text-xl"></i>
                        </div>
                        ${inst.instance}
                    </td>
                    <td class="py-4 px-6">${statusBadge}</td>
                    <td class="py-4 px-6 text-xs text-gray-500 font-mono">${inst.token || '---'}</td>
                    <td class="py-4 px-6 text-right space-x-2">
                        ${inst.status !== 'connected' ? 
                            `<button onclick="connectInstance('${inst.instance}', '${inst.token}')" class="text-primary hover:text-emerald-700 font-medium transition-colors border border-primary px-3 py-1 rounded text-xs">Conectar (QR)</button>` 
                            : ''}
                        <button onclick="configBot('${inst.instance}', '${inst.token}')" class="text-emerald-500 hover:text-emerald-700 transition-colors ml-2" title="Configurar IA"><i class="fa-solid fa-robot text-lg"></i></button>
                        <button onclick="deleteInstance('${inst.instance}', '${inst.token}')" class="text-gray-400 hover:text-red-500 transition-colors ml-2" title="Excluir"><i class="fa-solid fa-trash text-lg"></i></button>
                    </td>
                </tr>
            `;
        });
    } catch (error) {
        console.error(error);
        document.getElementById('instances-list').innerHTML = `<tr><td colspan="4" class="text-center py-8 text-red-400">Erro ao carregar instâncias da API. Verifique se o servidor está rodando.</td></tr>`;
    }
}

// Criar nova instância
async function openCreateModal() {
    const { value: name } = await Swal.fire({
        title: 'Nova Instância',
        input: 'text',
        inputLabel: 'Nome da Conexão (sem espaços)',
        inputPlaceholder: 'Ex: SuporteVendas',
        showCancelButton: true,
        confirmButtonText: 'Criar',
        cancelButtonText: 'Cancelar'
    });

    if (name) {
        Swal.fire({ title: 'Criando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const res = await apiFetch('/instance/create', {
            method: 'POST',
            body: JSON.stringify({ instance: name })
        });

        if (res.success) {
            Swal.fire('Sucesso!', 'Instância criada.', 'success');
            loadInstances();
            // Abre o QR code automaticamente
            setTimeout(() => connectInstance(res.instance, res.token), 1000);
        } else {
            Swal.fire('Erro', res.error || 'Falha ao criar.', 'error');
        }
    }
}

// Conectar / Ver QR Code
async function connectInstance(name, token) {
    document.getElementById('qr-modal').classList.remove('hidden');
    document.getElementById('qr-loading').classList.remove('hidden');
    document.getElementById('qr-image').classList.add('hidden');

    try {
        const res = await apiFetch('/instance/qrcode', {
            headers: { instance: name, token: token }
        });

        if (res.success && res.base64) {
            document.getElementById('qr-loading').classList.add('hidden');
            document.getElementById('qr-image').src = res.base64;
            document.getElementById('qr-image').classList.remove('hidden');
            
            // Fica verificando se conectou
            const interval = setInterval(async () => {
                const statusRes = await apiFetch('/instance/status', { headers: { instance: name, token: token } });
                if (statusRes.success && statusRes.status === 'connected') {
                    clearInterval(interval);
                    closeQrModal();
                    Swal.fire('Conectado!', 'WhatsApp pareado com sucesso.', 'success');
                    loadInstances();
                }
            }, 3000);
            
            window.qrCheckInterval = interval; // Salva para limpar se fechar o modal
        } else {
            closeQrModal();
            Swal.fire('Aviso', res.message || res.error || 'Já está conectado ou erro ao buscar QR.', 'info');
        }
    } catch (e) {
        closeQrModal();
        Swal.fire('Erro', 'Falha na comunicação com a API.', 'error');
    }
}

function closeQrModal() {
    document.getElementById('qr-modal').classList.add('hidden');
    if (window.qrCheckInterval) clearInterval(window.qrCheckInterval);
}

// Configurar Robô IA
async function configBot(name, token) {
    // Primeiro puxa a config atual
    Swal.fire({ title: 'Carregando IA...', didOpen: () => Swal.showLoading() });
    const res = await apiFetch('/bot/config', { headers: { instance: name, token: token } });
    
    let currentConfig = { active: false, prompt: '' };
    if (res.success && res.config) {
        currentConfig = res.config;
    }

    const { value: formValues } = await Swal.fire({
        title: `Configurar Agente IA - ${name}`,
        html:
            `<div class="text-left mt-4">
                <label class="flex items-center gap-2 mb-4 text-sm font-bold text-gray-700">
                    <input type="checkbox" id="bot-active" class="w-5 h-5 text-emerald-600 rounded" ${currentConfig.active ? 'checked' : ''}>
                    Ativar Robô ChatGPT para esta conexão
                </label>
                <label class="block text-sm font-bold text-gray-700 mb-2">Comportamento da IA (Prompt):</label>
                <textarea id="bot-prompt" class="w-full h-32 p-3 border rounded-lg text-sm" placeholder="Ex: Você é um atendente de pizzaria. Seu nome é João. Você vende pizza de Calabresa.">${currentConfig.prompt || ''}</textarea>
            </div>`,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Salvar Configuração',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            return {
                active: document.getElementById('bot-active').checked,
                prompt: document.getElementById('bot-prompt').value
            }
        }
    });

    if (formValues) {
        Swal.fire({ title: 'Salvando...', didOpen: () => Swal.showLoading() });
        const saveRes = await apiFetch('/bot/config', {
            method: 'POST',
            headers: { instance: name, token: token },
            body: JSON.stringify(formValues)
        });

        if (saveRes.success) {
            Swal.fire('IA Configurada!', formValues.active ? 'O bot está acordado e operante.' : 'O bot foi desligado.', 'success');
        } else {
            Swal.fire('Erro', saveRes.error || 'Falha ao salvar.', 'error');
        }
    }
}

// Deletar instância
async function deleteInstance(name, token) {
    const result = await Swal.fire({
        title: 'Tem certeza?',
        text: "Isso vai desconectar o WhatsApp e apagar a sessão!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Sim, excluir!',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        Swal.fire({ title: 'Excluindo...', didOpen: () => Swal.showLoading() });
        const res = await apiFetch('/instance/logout', { // ou /instance/delete dependendo da sua API
            method: 'DELETE',
            headers: { instance: name, token: token }
        });

        if (res.success) {
            Swal.fire('Excluído!', 'Conexão encerrada.', 'success');
            loadInstances();
        } else {
            Swal.fire('Erro', res.error || 'Falha ao excluir.', 'error');
        }
    }
}

// Aba de Agentes IA (Para o menu lateral)
function openAIAgents() {
    Swal.fire({
        title: 'Agentes de IA Nativo',
        html: '<p class="text-sm text-gray-600 mb-4">O sistema gerencia automaticamente as mentes dos robôs. Para ativar a IA em um WhatsApp específico, clique no ícone do robô (<i class="fa-solid fa-robot text-emerald-500"></i>) na linha da instância!</p>',
        icon: 'info'
    });
}

// Iniciar
loadInstances();
