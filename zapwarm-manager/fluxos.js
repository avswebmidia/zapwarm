// ============================================================
// EDITOR DE FLUXOS
// ============================================================
let fluxoAtual = null;
let nomeFluxo = 'padrao';
let instanciaAtual = null;
let tokenAtual = null;

async function carregarFluxosDisponiveis() {
    try {
        const res = await apiFetch('/bot/fluxo/list');
        const select = document.getElementById('flow-select');
        select.innerHTML = '';
        if (!res.success || !res.flows || res.flows.length === 0) {
            select.innerHTML = '<option value="">Nenhum fluxo</option>';
            return;
        }
        res.flows.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.name;
            opt.textContent = `${f.name} (${f.nodes.length} nós)`;
            select.appendChild(opt);
        });
        select.value = res.flows[0].name;
        nomeFluxo = res.flows[0].name;
    } catch (e) {
        console.error(e);
    }
}

async function carregarInstancias() {
    try {
        const res = await apiFetch('/instance/list');
        const select = document.getElementById('instance-select');
        select.innerHTML = '<option value="">Selecione...</option>';
        if (!res.success || !res.instances) return;
        res.instances.forEach(inst => {
            const opt = document.createElement('option');
            opt.value = JSON.stringify({ name: inst.instance, token: inst.token });
            opt.textContent = inst.instance;
            select.appendChild(opt);
        });
    } catch (e) { console.error(e); }
}

async function carregarFluxo(nome) {
    const editor = document.getElementById('flow-editor');
    editor.innerHTML = '<div class="text-center py-12 text-gray-400 col-span-full"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2"></i><br>Carregando...</div>';
    
    try {
        const res = await apiFetch('/bot/fluxo/' + nome);
        if (!res.success || !res.flow) {
            editor.innerHTML = '<div class="text-center py-12 text-red-400 col-span-full">Fluxo não encontrado</div>';
            return;
        }
        fluxoAtual = res.flow;
        renderizarFluxo();
    } catch (e) {
        editor.innerHTML = `<div class="text-center py-12 text-red-400 col-span-full">Erro: ${e.message}</div>`;
    }
}

function renderizarFluxo() {
    const editor = document.getElementById('flow-editor');
    editor.className = 'grid grid-cols-1 xl:grid-cols-2 gap-6';
    editor.innerHTML = '';
    
    Object.entries(fluxoAtual).forEach(([nomeNo, no]) => {
        const card = document.createElement('div');
        card.className = 'bg-white rounded-xl shadow-sm border-2 ' + (nomeNo === 'inicio' ? 'border-emerald-400' : 'border-gray-200') + ' p-6 flex flex-col';
        
        card.innerHTML = `
            <div class="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-bold px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full uppercase tracking-wide">${nomeNo}</span>
                    ${nomeNo === 'inicio' ? '<span class="text-xs text-emerald-600 font-bold"><i class="fa-solid fa-star"></i> INICIAL</span>' : ''}
                </div>
                <button onclick="deletarNo('${nomeNo}')" class="text-gray-400 hover:text-red-500 transition-colors p-1" title="Deletar nó">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
            
            <div class="space-y-3 mb-5">
                <div>
                    <label class="block text-xs font-bold text-gray-500 mb-1">TÍTULO</label>
                    <input type="text" value="${(no.title || '').replace(/"/g, '&quot;')}" placeholder="Ex: 🎯 Menu Principal"
                           onchange="atualizarNo('${nomeNo}', 'title', this.value)"
                           class="w-full p-2.5 border border-gray-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary">
                </div>
                
                <div>
                    <label class="block text-xs font-bold text-gray-500 mb-1">TEXTO DA MENSAGEM</label>
                    <textarea placeholder="Digite o texto que o cliente vai receber..." 
                              onchange="atualizarNo('${nomeNo}', 'text', this.value)"
                              rows="4"
                              class="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary resize-none">${no.text || ''}</textarea>
                </div>
                
                <div>
                    <label class="block text-xs font-bold text-gray-500 mb-1">RODAPÉ (opcional)</label>
                    <input type="text" value="${(no.footer || '').replace(/"/g, '&quot;')}" placeholder="Ex: AVS Infotec"
                           onchange="atualizarNo('${nomeNo}', 'footer', this.value)"
                           class="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary">
                </div>
            </div>
            
            <div class="border-t pt-4 mt-auto">
                <div class="flex items-center justify-between mb-3">
                    <span class="text-xs font-bold text-gray-500">🔘 BOTÕES (máx 3)</span>
                    <span class="text-xs text-gray-400">${(no.buttons || []).length}/3</span>
                </div>
                
                <div class="space-y-2 mb-3">
                    ${(no.buttons || []).map((btn, i) => `
                        <div class="bg-gray-50 rounded-lg p-3 space-y-2">
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-bold text-gray-400 w-6">#${i + 1}</span>
                                <input type="text" value="${(btn.text || '').replace(/"/g, '&quot;')}" placeholder="Texto do botão"
                                       onchange="atualizarBotao('${nomeNo}', ${i}, 'text', this.value)"
                                       class="flex-1 p-2 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                                <button onclick="removerBotao('${nomeNo}', ${i})" class="text-gray-400 hover:text-red-500 p-1.5" title="Remover botão">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                            </div>
                            <div class="flex items-center gap-2 pl-8">
                                <input type="text" value="${(btn.id || '').replace(/"/g, '&quot;')}" placeholder="id"
                                       onchange="atualizarBotao('${nomeNo}', ${i}, 'id', this.value)"
                                       class="w-32 p-1.5 border border-gray-200 rounded text-xs font-mono text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary/50">
                                <span class="text-gray-400 text-xs"><i class="fa-solid fa-arrow-right"></i></span>
                                <input type="text" value="${(btn.next || '').replace(/"/g, '&quot;')}" placeholder="irá para..."
                                       onchange="atualizarBotao('${nomeNo}', ${i}, 'next', this.value)"
                                       class="flex-1 p-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                <button onclick="adicionarBotao('${nomeNo}')" 
                        class="w-full text-xs text-primary hover:bg-emerald-50 py-2.5 rounded-lg border-2 border-dashed border-emerald-300 hover:border-primary transition-colors font-bold">
                    <i class="fa-solid fa-plus"></i> Adicionar Botão
                </button>
            </div>
        `;
        
        editor.appendChild(card);
    });
}

function atualizarNo(nomeNo, campo, valor) {
    if (!fluxoAtual[nomeNo]) return;
    fluxoAtual[nomeNo][campo] = valor;
}

function atualizarBotao(nomeNo, index, campo, valor) {
    if (!fluxoAtual[nomeNo]?.buttons?.[index]) return;
    fluxoAtual[nomeNo].buttons[index][campo] = valor;
}

function adicionarBotao(nomeNo) {
    if (!fluxoAtual[nomeNo]) return;
    if (!fluxoAtual[nomeNo].buttons) fluxoAtual[nomeNo].buttons = [];
    if (fluxoAtual[nomeNo].buttons.length >= 3) {
        Swal.fire('Limite', 'O WhatsApp permite no máximo 3 botões por mensagem.', 'warning');
        return;
    }
    fluxoAtual[nomeNo].buttons.push({ id: 'novo_botao', text: 'Novo Botão', next: nomeNo });
    renderizarFluxo();
}

function removerBotao(nomeNo, index) {
    if (!fluxoAtual[nomeNo]?.buttons) return;
    fluxoAtual[nomeNo].buttons.splice(index, 1);
    renderizarFluxo();
}

function adicionarNo() {
    Swal.fire({
        title: 'Novo Nó',
        input: 'text',
        inputLabel: 'Nome do nó (sem espaços)',
        inputPlaceholder: 'Ex: suporte',
        showCancelButton: true,
        confirmButtonText: 'Criar',
        cancelButtonText: 'Cancelar',
        inputValidator: (value) => {
            if (!value) return 'Informe um nome';
            if (!/^[a-z0-9_]+$/i.test(value)) return 'Use apenas letras, números e _';
            if (fluxoAtual[value]) return 'Esse nó já existe';
            return null;
        }
    }).then((result) => {
        if (result.isConfirmed) {
            fluxoAtual[result.value] = {
                title: '🎯 Novo Menu',
                text: 'Digite uma mensagem aqui...',
                footer: 'AVS Infotec',
                buttons: [
                    { id: 'voltar', text: '↩️ Voltar', next: 'inicio' }
                ]
            };
            renderizarFluxo();
        }
    });
}

function deletarNo(nomeNo) {
    if (nomeNo === 'inicio') {
        Swal.fire('Erro', 'Não é possível deletar o nó "inicio".', 'error');
        return;
    }
    Swal.fire({
        title: 'Deletar nó?',
        text: `O nó "${nomeNo}" será removido do fluxo.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Deletar',
        cancelButtonText: 'Cancelar'
    }).then((result) => {
        if (result.isConfirmed) {
            delete fluxoAtual[nomeNo];
            renderizarFluxo();
        }
    });
}

async function salvarFluxo() {
    if (!fluxoAtual) return;
    Swal.fire({ title: 'Salvando...', didOpen: () => Swal.showLoading() });
    
    try {
        const res = await apiFetch('/bot/fluxo/' + nomeFluxo, {
            method: 'POST',
            body: JSON.stringify({ flow: fluxoAtual })
        });
        if (res.success) {
            Swal.fire('Salvo!', 'Fluxo atualizado com sucesso.', 'success');
        } else {
            Swal.fire('Erro', res.error || 'Falha ao salvar.', 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

async function toggleFlow() {
    if (!instanciaAtual || !tokenAtual) {
        Swal.fire('Atenção', 'Selecione uma instância primeiro.', 'warning');
        return;
    }
    
    try {
        const atual = await apiFetch('/bot/fluxo', { headers: { instance: instanciaAtual, token: tokenAtual } });
        const ativado = atual.config?.enabled || false;
        
        const res = await apiFetch('/bot/fluxo', {
            method: 'POST',
            headers: { instance: instanciaAtual, token: tokenAtual },
            body: JSON.stringify({ enabled: !ativado, flow: nomeFluxo })
        });
        
        if (res.success) {
            atualizarBotaoToggle(res.config.enabled);
            Swal.fire({
                icon: 'success',
                title: res.config.enabled ? 'Fluxo Ativado' : 'Fluxo Desativado',
                timer: 1500,
                showConfirmButton: false
            });
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

function atualizarBotaoToggle(ativado) {
    const btn = document.getElementById('toggle-btn');
    if (ativado) {
        btn.className = 'bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors';
        btn.innerHTML = '<i class="fa-solid fa-power-off"></i> Ativo';
    } else {
        btn.className = 'bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-bold transition-colors';
        btn.innerHTML = '<i class="fa-solid fa-power-off"></i> Ativar';
    }
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.getElementById('flow-select').addEventListener('change', (e) => {
    nomeFluxo = e.target.value;
    if (nomeFluxo) carregarFluxo(nomeFluxo);
});

document.getElementById('instance-select').addEventListener('change', async (e) => {
    try {
        const val = JSON.parse(e.target.value);
        instanciaAtual = val.name;
        tokenAtual = val.token;
        
        const res = await apiFetch('/bot/fluxo', { headers: { instance: instanciaAtual, token: tokenAtual } });
        atualizarBotaoToggle(res.config?.enabled || false);
    } catch (err) {}
});

(async () => {
    await carregarFluxosDisponiveis();
    await carregarInstancias();
    if (nomeFluxo) await carregarFluxo(nomeFluxo);
})();
