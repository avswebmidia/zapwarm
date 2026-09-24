// ============================================================
// AGENTES DE IA - Multi-agentes
// ============================================================
console.log('[agentes.js] Carregado');
let agentesCache = [];
let instanciasCache = [];

async function carregarAgentes() {
    const list = document.getElementById('agentes-list');
    if (!list) return;

    try {
        const res = await apiFetch('/agentes/list');

        if (!res.success || !res.agentes || res.agentes.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:48px 16px;background:#fff;border-radius:16px;border:2px dashed #e2e8f0;">' +
                '<i class="fa-solid fa-robot" style="font-size:48px;color:#cbd5e1;margin-bottom:12px;"></i>' +
                '<p style="color:#64748b;margin-bottom:16px;">Nenhum agente criado ainda.</p>' +
                '<button onclick="criarAgente()" class="btn btn-primary" style="margin:0 auto;">' +
                '<i class="fa-solid fa-plus"></i> Criar meu primeiro agente</button></div>';
            agentesCache = [];
            return;
        }

        agentesCache = res.agentes;

        list.innerHTML = res.agentes.map(function(a) {
            const atribuidoA = a.instancias && a.instancias.length > 0;
            const instanciasTxt = atribuidoA
                ? a.instancias.map(function(i) { return '<span class="badge-atribuido"><i class="fa-solid fa-check"></i> ' + i + '</span>'; }).join(' ')
                : '<span style="color:#94a3b8;font-size:12px;">Nao atribuido</span>';

            const promptPreview = (a.prompt || '').substring(0, 120) + ((a.prompt || '').length > 120 ? '...' : '');

            return '<div class="agente-card ' + (atribuidoA ? 'atribuido' : '') + '">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">' +
                    '<div style="flex:1;min-width:200px;">' +
                        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">' +
                            '<div style="width:40px;height:40px;border-radius:50%;background:' + (atribuidoA ? '#d1fae5' : '#f1f5f9') + ';color:' + (atribuidoA ? '#10b981' : '#94a3b8') + ';display:flex;align-items:center;justify-content:center;font-size:18px;">' +
                                '<i class="fa-solid fa-robot"></i></div>' +
                            '<div>' +
                                '<div style="font-weight:700;font-size:16px;color:#1e293b;">' + a.nome + '</div>' +
                                '<div style="font-size:11px;color:#94a3b8;">ID: ' + a.id + '</div>' +
                            '</div>' +
                        '</div>' +
                        '<p style="font-size:13px;color:#64748b;margin:8px 0;line-height:1.5;">' + promptPreview + '</p>' +
                        '<div style="margin-top:12px;">' +
                            '<span style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;">Atribuido a:</span>' +
                            '<div style="margin-top:6px;">' + instanciasTxt + '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                        '<button onclick="editarAgente(\'' + a.id + '\')" class="btn btn-secondary" style="padding:8px 12px;font-size:12px;min-height:36px;" title="Editar">' +
                            '<i class="fa-solid fa-pen"></i></button>' +
                        '<button onclick="duplicarAgente(\'' + a.id + '\')" class="btn btn-secondary" style="padding:8px 12px;font-size:12px;min-height:36px;" title="Duplicar">' +
                            '<i class="fa-solid fa-copy"></i></button>' +
                        '<button onclick="deletarAgente(\'' + a.id + '\', \'' + a.nome + '\')" class="btn btn-secondary" style="padding:8px 12px;font-size:12px;min-height:36px;color:#ef4444;" title="Excluir">' +
                            '<i class="fa-solid fa-trash"></i></button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    } catch (e) {
        console.error(e);
        list.innerHTML = '<div style="text-align:center;padding:32px;color:#ef4444;">Erro: ' + e.message + '</div>';
    }
}

async function carregarInstancias() {
    const list = document.getElementById('instancias-list');
    if (!list) return;

    // ✅ FIX: garante que os agentes estao carregados antes de renderizar o select
    if (!agentesCache || agentesCache.length === 0) {
        console.log('[carregarInstancias] agentesCache vazio — recarregando...');
        try {
            const agRes = await apiFetch('/agentes/list');
            if (agRes.success && agRes.agentes) {
                agentesCache = agRes.agentes;
                console.log('[carregarInstancias] agentes recarregados:', agentesCache.length);
            }
        } catch (e) {
            console.warn('[carregarInstancias] erro ao recarregar agentes:', e.message);
        }
    }

    try {
        const res = await apiFetch('/instance/list');

        if (!res.success || !res.instances || res.instances.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:32px;background:#fff;border-radius:16px;color:#94a3b8;">Nenhuma instancia encontrada.</div>';
            return;
        }

        instanciasCache = res.instances;

        const atribuicoes = {};
        for (let i = 0; i < res.instances.length; i++) {
            const inst = res.instances[i];
            try {
                const atrRes = await apiFetch('/agentes/atribuicao/' + inst.instance);
                atribuicoes[inst.instance] = atrRes.agenteId || null;
            } catch (e) {
                atribuicoes[inst.instance] = null;
            }
        }

        list.innerHTML = res.instances.map(function(inst) {
            const agenteId = atribuicoes[inst.instance];
            const agente = agentesCache.find(function(a) { return a.id === agenteId; });
            const isConnected = inst.connected || inst.status === 'connected';

            const opcoes = agentesCache.map(function(a) {
                return '<option value="' + a.id + '"' + (a.id === agenteId ? ' selected' : '') + '>' + a.nome + '</option>';
            }).join('');

            return '<div class="agente-card">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;">' +
                    '<div style="display:flex;align-items:center;gap:12px;">' +
                        '<div style="width:40px;height:40px;border-radius:50%;background:' + (isConnected ? '#d1fae5' : '#f1f5f9') + ';color:' + (isConnected ? '#10b981' : '#94a3b8') + ';display:flex;align-items:center;justify-content:center;font-size:18px;">' +
                            '<i class="fa-brands fa-whatsapp"></i></div>' +
                        '<div>' +
                            '<div style="font-weight:700;font-size:15px;color:#1e293b;">' + inst.instance + '</div>' +
                            '<div style="font-size:11px;color:' + (isConnected ? '#10b981' : '#94a3b8') + ';">' +
                                (isConnected ? '&#9679; Conectada' : '&#9675; Desconectada') + '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                        '<select id="select-atr-' + inst.instance + '" style="padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;min-width:200px;">' +
                            '<option value="">Sem agente (usa config padrao)</option>' + opcoes +
                        '</select>' +
                        '<button onclick="atribuirAgente(\'' + inst.instance + '\')" class="btn btn-primary" style="padding:8px 14px;font-size:12px;min-height:36px;">' +
                            '<i class="fa-solid fa-check"></i> Atribuir</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    } catch (e) {
        console.error(e);
        list.innerHTML = '<div style="text-align:center;padding:32px;color:#ef4444;">Erro: ' + e.message + '</div>';
    }
}

async function criarAgente() {
    const result = await Swal.fire({
        title: 'Novo Agente IA',
        width: 640,
        html:
            '<div style="text-align:left;">' +
                '<label style="display:block;font-size:12px;font-weight:700;color:#374151;margin-bottom:6px;">NOME DO AGENTE</label>' +
                '<input type="text" id="agente-nome" placeholder="Ex: Sofia - Atendimento" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:16px;">' +
                '<label style="display:block;font-size:12px;font-weight:700;color:#374151;margin-bottom:6px;">PROMPT (Comportamento da IA)</label>' +
                '<textarea id="agente-prompt" placeholder="Ex: Voce e a Sofia, atendente da AVS Infotec..." style="width:100%;height:200px;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-family:monospace;box-sizing:border-box;resize:vertical;"></textarea>' +
            '</div>',
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Criar Agente',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#10b981',
        preConfirm: function() {
            const nome = document.getElementById('agente-nome').value.trim();
            const prompt = document.getElementById('agente-prompt').value.trim();
            if (!nome) { Swal.showValidationMessage('Informe um nome'); return false; }
            if (!prompt) { Swal.showValidationMessage('Informe o prompt'); return false; }
            return { nome: nome, prompt: prompt };
        }
    });

    if (!result.value) return;

    Swal.fire({ title: 'Criando...', allowOutsideClick: false, didOpen: function() { Swal.showLoading(); } });

    try {
        const res = await apiFetch('/agentes/create', {
            method: 'POST',
            body: JSON.stringify(result.value)
        });

        if (res.success) {
            Swal.fire('Criado!', 'Agente "' + result.value.nome + '" criado.', 'success');
            await carregarAgentes();
            await carregarInstancias();
        } else {
            Swal.fire('Erro', res.error || 'Falha', 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

async function editarAgente(id) {
    const agente = agentesCache.find(function(a) { return a.id === id; });
    if (!agente) return;

    const result = await Swal.fire({
        title: 'Editar Agente',
        width: 640,
        html:
            '<div style="text-align:left;">' +
                '<label style="display:block;font-size:12px;font-weight:700;color:#374151;margin-bottom:6px;">NOME</label>' +
                '<input type="text" id="agente-nome" value="' + agente.nome.replace(/"/g, '&quot;') + '" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:16px;">' +
                '<label style="display:block;font-size:12px;font-weight:700;color:#374151;margin-bottom:6px;">PROMPT</label>' +
                '<textarea id="agente-prompt" style="width:100%;height:200px;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-family:monospace;box-sizing:border-box;resize:vertical;">' + agente.prompt.replace(/</g, '&lt;') + '</textarea>' +
            '</div>',
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Salvar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#10b981',
        preConfirm: function() {
            const nome = document.getElementById('agente-nome').value.trim();
            const prompt = document.getElementById('agente-prompt').value.trim();
            if (!nome || !prompt) { Swal.showValidationMessage('Nome e prompt obrigatorios'); return false; }
            return { nome: nome, prompt: prompt };
        }
    });

    if (!result.value) return;

    Swal.fire({ title: 'Salvando...', allowOutsideClick: false, didOpen: function() { Swal.showLoading(); } });

    try {
        const res = await apiFetch('/agentes/' + id, {
            method: 'POST',
            body: JSON.stringify(result.value)
        });

        if (res.success) {
            Swal.fire('Salvo!', 'Agente atualizado.', 'success');
            await carregarAgentes();
            await carregarInstancias();
        } else {
            Swal.fire('Erro', res.error || 'Falha', 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

async function duplicarAgente(id) {
    const agente = agentesCache.find(function(a) { return a.id === id; });
    if (!agente) return;

    Swal.fire({ title: 'Duplicando...', allowOutsideClick: false, didOpen: function() { Swal.showLoading(); } });

    try {
        const res = await apiFetch('/agentes/create', {
            method: 'POST',
            body: JSON.stringify({ nome: agente.nome + ' (copia)', prompt: agente.prompt })
        });

        if (res.success) {
            Swal.fire('Duplicado!', 'Agente copiado.', 'success');
            await carregarAgentes();
            await carregarInstancias();
        } else {
            Swal.fire('Erro', res.error || 'Falha', 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

async function deletarAgente(id, nome) {
    const confirm = await Swal.fire({
        title: 'Excluir agente?',
        html: 'O agente <strong>' + nome + '</strong> sera removido.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sim, excluir',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#ef4444'
    });

    if (!confirm.isConfirmed) return;

    Swal.fire({ title: 'Excluindo...', allowOutsideClick: false, didOpen: function() { Swal.showLoading(); } });

    try {
        const res = await apiFetch('/agentes/' + id, { method: 'DELETE' });

        if (res.success) {
            Swal.fire('Excluido!', 'Agente removido.', 'success');
            await carregarAgentes();
            await carregarInstancias();
        } else {
            Swal.fire('Erro', res.error || 'Falha', 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

async function atribuirAgente(instance) {
    const select = document.getElementById('select-atr-' + instance);
    const agenteIdRaw = select.value;
    // ✅ Se vazio, envia null (backend entende como desatribuir)
    const agenteId = agenteIdRaw && agenteIdRaw.trim() !== '' ? agenteIdRaw : null;

    Swal.fire({ title: agenteId ? 'Atribuindo...' : 'Removendo...', allowOutsideClick: false, didOpen: function() { Swal.showLoading(); } });

    try {
        const res = await apiFetch('/agentes/atribuir', {
            method: 'POST',
            body: JSON.stringify({ instance: instance, agenteId: agenteId })
        });

        if (res.success) {
            Swal.fire({
                icon: 'success',
                title: agenteId ? 'Atribuido!' : 'Removido!',
                timer: 2000,
                showConfirmButton: false
            });
            await carregarAgentes();
            await carregarInstancias();
        } else {
            Swal.fire('Erro', res.error || 'Falha', 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

// Inicializacao
carregarAgentes().then(function() { carregarInstancias(); });

// Auto-refresh
setInterval(function() {
    if (document.hidden) return;
    if (document.querySelector('.swal2-container')) return;
    carregarAgentes();
}, 15000);

// ============================================================
// CHAVE GROQ GLOBAL (Modelo A)
// ============================================================
async function carregarGroqGlobal() {
    const statusEl = document.getElementById('groq-status');
    if (!statusEl) return;

    try {
        const res = await apiFetch('/bot/groq-global');
        if (res.hasKey) {
            const srcLabel = res.source === 'panel' ? 'painel' : 'env (.env)';
            statusEl.innerHTML =
                '<span style="color:#10b981;">✅ Configurada</span> ' +
                '<span style="font-size:11px;color:#94a3b8;">(' + srcLabel + ')</span> ' +
                '<code style="font-size:11px;background:#f1f5f9;padding:2px 6px;border-radius:4px;color:#334155;">' + (res.maskedKey || '') + '</code>';
        } else {
            statusEl.innerHTML = '<span style="color:#ef4444;">❌ Nenhuma chave configurada</span>';
        }
    } catch (e) {
        statusEl.innerHTML = '<span style="color:#ef4444;">Erro: ' + e.message + '</span>';
    }
}

async function salvarGroqGlobal() {
    const key = (document.getElementById('groq-key').value || '').trim();
    if (!key) return Swal.fire('Erro', 'Cole a chave Groq', 'error');
    if (!key.startsWith('gsk_')) return Swal.fire('Erro', 'A chave deve começar com "gsk_"', 'error');

    Swal.fire({ title: 'Salvando...', allowOutsideClick: false, didOpen: function() { Swal.showLoading(); } });

    try {
        const res = await apiFetch('/bot/groq-global', {
            method: 'POST',
            body: JSON.stringify({ apiKey: key })
        });

        if (res.success) {
            Swal.fire({ icon: 'success', title: 'Chave salva!', timer: 1500, showConfirmButton: false });
            document.getElementById('groq-key').value = '';
            await carregarGroqGlobal();
        } else {
            Swal.fire('Erro', res.error || 'Falha ao salvar', 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

async function removerGroqGlobal() {
    const conf = await Swal.fire({
        title: 'Remover chave global?',
        text: 'O sistema voltará a usar a chave do .env (se existir).',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Remover',
        cancelButtonText: 'Cancelar'
    });
    if (!conf.isConfirmed) return;

    try {
        const res = await apiFetch('/bot/groq-global', { method: 'DELETE' });
        if (res.success) {
            Swal.fire({ icon: 'success', title: 'Removida!', timer: 1500, showConfirmButton: false });
            await carregarGroqGlobal();
        } else {
            Swal.fire('Erro', res.error || 'Falha', 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

// Carrega ao abrir a página
setTimeout(carregarGroqGlobal, 1500);

// ============================================================
// CHAVE GROQ GLOBAL
// ============================================================
async function carregarGroqGlobal() {
    const statusEl = document.getElementById('groq-status');
    if (!statusEl) return;

    try {
        const res = await apiFetch('/bot/groq-global');
        if (res.hasKey) {
            const srcLabel = res.source === 'panel' ? 'desta instância' : 'global (.env)';
            statusEl.innerHTML = '<span style="color:#10b981;">✅ ' + (res.maskedKey || '') + '</span> <span style="color:#94a3b8;font-weight:400;">(' + srcLabel + ')</span>';
        } else {
            statusEl.innerHTML = '<span style="color:#ef4444;">Nenhuma chave</span>';
        }
    } catch (e) {
        statusEl.innerHTML = '<span style="color:#ef4444;">Erro: ' + e.message + '</span>';
    }
}

async function salvarGroqGlobal() {
    const key = (document.getElementById('groq-key').value || '').trim();
    if (!key) return Swal.fire('Erro', 'Cole a chave Groq', 'error');
    if (!key.startsWith('gsk_')) return Swal.fire('Erro', 'A chave deve começar com "gsk_"', 'error');

    Swal.fire({ title: 'Salvando...', allowOutsideClick: false, didOpen: function() { Swal.showLoading(); } });

    try {
        const res = await apiFetch('/bot/groq-global', {
            method: 'POST',
            body: JSON.stringify({ apiKey: key })
        });

        if (res.success) {
            Swal.fire({ icon: 'success', title: 'Chave salva!', timer: 1500, showConfirmButton: false });
            document.getElementById('groq-key').value = '';
            await carregarGroqGlobal();
        } else {
            Swal.fire('Erro', res.error || 'Falha ao salvar', 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

async function removerGroqGlobal() {
    const conf = await Swal.fire({
        title: 'Remover chave global?',
        text: 'O sistema voltará a usar a chave do .env (se existir).',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Remover',
        cancelButtonText: 'Cancelar'
    });
    if (!conf.isConfirmed) return;

    try {
        const res = await apiFetch('/bot/groq-global', { method: 'DELETE' });
        if (res.success) {
            Swal.fire({ icon: 'success', title: 'Removida!', timer: 1500, showConfirmButton: false });
            await carregarGroqGlobal();
        } else {
            Swal.fire('Erro', res.error || 'Falha', 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

// Carrega ao abrir a página
setTimeout(carregarGroqGlobal, 1500);

// ============================================================
// ABRIR MODAL "CONFIGURAR IA" DA 1ª INSTÂNCIA (botão 🤖)
// ============================================================
function abrirConfigBotGlobal() {
    if (!instanciasCache || instanciasCache.length === 0) {
        Swal.fire('Aviso', 'Nenhuma instância disponível. Crie uma instância primeiro.', 'info');
        return;
    }
    const inst = instanciasCache[0];
    const name = inst.instance || inst.name;
    const token = inst.token;
    if (!name || !token) {
        Swal.fire('Erro', 'Instância sem nome/token', 'error');
        return;
    }
    // Chama a função configBot do app.js
    if (typeof configBot === 'function') {
        configBot(name, token);
    } else {
        Swal.fire('Erro', 'Função configBot não disponível (app.js não carregado?)', 'error');
    }
}
