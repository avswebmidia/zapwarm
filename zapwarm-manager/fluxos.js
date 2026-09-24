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

                <!-- IMAGEM -->
                <div class="bg-orange-50 p-3 rounded-lg border border-orange-200 mt-3 mb-3">
                    <label class="flex items-center gap-2 text-sm font-bold text-orange-800 mb-2 cursor-pointer">
                        <input type="checkbox" ${no.image ? 'checked' : ''}
                               onchange="toggleImagem('${nomeNo}', this.checked)"
                               class="w-4 h-4 accent-orange-600">
                        🖼️ Este nó envia IMAGEM
                    </label>
                    <div id="imagem-config-${nomeNo}" style="display:${no.image ? 'block' : 'none'};">
                        <label class="block text-xs font-bold text-orange-800 mb-1">URL DA IMAGEM</label>
                        <input type="text" value="${no.image || ''}" placeholder="https://exemplo.com/foto.jpg"
                               onchange="atualizarImagem('${nomeNo}', this.value)"
                               class="w-full p-2 border border-orange-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white mb-2">
                        <label class="block text-xs font-bold text-orange-800 mb-1">LEGENDA (opcional)</label>
                        <input type="text" value="${no.imageCaption || ''}" placeholder="Deixe em branco para usar o texto do nó"
                               onchange="atualizarImagemCaption('${nomeNo}', this.value)"
                               class="w-full p-2 border border-orange-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white">
                        ${no.image ? `<div style="margin-top:8px;"><img src="${no.image}" style="max-width:120px;max-height:80px;border-radius:6px;border:1px solid #fed7aa;" onerror="this.style.display='none'"></div>` : ''}
                    </div>
                </div>

                <div class="bg-blue-50 p-3 rounded-lg border border-blue-200">
                    <label class="flex items-center gap-2 text-sm font-bold text-blue-800 mb-2 cursor-pointer">
                        <input type="checkbox" ${no.pix ? 'checked' : ''}
                               onchange="togglePix('${nomeNo}', this.checked)"
                               class="w-4 h-4 accent-blue-600">
                        💰 Este nó gera cobrança PIX
                    </label>
                    <div id="pix-config-${nomeNo}" style="display:${no.pix ? 'block' : 'none'};">
                        <label class="block text-xs font-bold text-blue-800 mb-1">VALOR (R$)</label>
                        <input type="number" step="0.01" min="0.01" value="${no.pix ? no.pix.amount : ''}" placeholder="Ex: 99.90"
                               onchange="atualizarPix('${nomeNo}', 'amount', this.value)"
                               class="w-full p-2 border border-blue-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white mb-2">
                        <label class="block text-xs font-bold text-blue-800 mb-1">DESCRIÇÃO (opcional)</label>
                        <input type="text" value="${no.pix ? (no.pix.description || '') : ''}" placeholder="Ex: Plano Mensal"
                               onchange="atualizarPix('${nomeNo}', 'description', this.value)"
                               class="w-full p-2 border border-blue-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                    </div>
                </div>

                <!-- EDITOR DE LISTA NATIVA -->
                <div class="bg-purple-50 p-3 rounded-lg border border-purple-200 mt-3">
                    <label class="flex items-center gap-2 text-sm font-bold text-purple-800 mb-2 cursor-pointer">
                        <input type="checkbox" ${no.list ? 'checked' : ''}
                               onchange="toggleList('${nomeNo}', this.checked)"
                               class="w-4 h-4 accent-purple-600">
                        📋 Este nó envia LISTA NATIVA (catálogo)
                    </label>
                    <div id="list-config-${nomeNo}" style="display:${no.list ? 'block' : 'none'};">
                        <label class="flex items-center gap-2 text-xs font-bold text-purple-800 mb-3 cursor-pointer bg-purple-100 p-2 rounded">
                            <input type="checkbox" ${no.listFromCatalogo ? 'checked' : ''}
                                   onchange="toggleListFromCatalogo('${nomeNo}', this.checked)"
                                   class="w-4 h-4 accent-purple-600">
                            📦 PUXAR DO CATÁLOGO (editar em Pedidos → Catálogo)
                        </label>

                        <div id="list-manual-${nomeNo}" style="display:${no.listFromCatalogo ? 'none' : 'block'};">
                        <label class="block text-xs font-bold text-purple-800 mb-1">TEXTO DO BOTÃO</label>
                        <input type="text" value="${no.list ? (no.list.buttonText || '') : ''}" placeholder="Ex: Ver Cardápio 📂" maxlength="20"
                               onchange="atualizarList('${nomeNo}', 'buttonText', this.value)"
                               class="w-full p-2 border border-purple-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white mb-3">

                        <div class="text-xs font-bold text-purple-800 mb-2">SEÇÕES E ITENS</div>
                        <div id="list-secoes-${nomeNo}">
                            ${(no.list && no.list.sections ? no.list.sections : []).map((sec, si) => `
                                <div class="bg-white border border-purple-200 rounded p-2 mb-2">
                                    <div class="flex items-center gap-2 mb-2">
                                        <input type="text" value="${sec.title || ''}" placeholder="Título da seção" maxlength="24"
                                               onchange="atualizarSecao('${nomeNo}', ${si}, 'title', this.value)"
                                               class="flex-1 p-1 border border-purple-200 rounded text-xs">
                                        <button onclick="removeSecao('${nomeNo}', ${si})" class="text-red-500 hover:text-red-700 text-xs" title="Remover seção">
                                            <i class="fa-solid fa-trash"></i>
                                        </button>
                                    </div>
                                    ${(sec.rows || []).map((row, ri) => `
                                        <div class="bg-purple-50 border border-purple-100 rounded p-2 mb-1">
                                            <div class="flex gap-1 mb-1">
                                                <input type="text" value="${row.title || ''}" placeholder="Título" maxlength="24"
                                                       onchange="atualizarItemLista('${nomeNo}', ${si}, ${ri}, 'title', this.value)"
                                                       class="flex-1 p-1 border rounded text-xs" style="border-color:#e9d5ff;">
                                                <button onclick="removeItemLista('${nomeNo}', ${si}, ${ri})" class="text-red-400 hover:text-red-600 text-xs">
                                                    <i class="fa-solid fa-xmark"></i>
                                                </button>
                                            </div>
                                            <input type="text" value="${row.description || ''}" placeholder="Descrição (ex: R$ 60)" maxlength="72"
                                                   onchange="atualizarItemLista('${nomeNo}', ${si}, ${ri}, 'description', this.value)"
                                                   class="w-full p-1 border rounded text-xs mb-1" style="border-color:#e9d5ff;">
                                            <input type="text" value="${row.id || ''}" placeholder="ID (ex: pizza_calabresa)"
                                                   onchange="atualizarItemLista('${nomeNo}', ${si}, ${ri}, 'id', this.value)"
                                                   class="w-full p-1 border rounded text-xs mb-1 font-mono" style="border-color:#e9d5ff;">
                                            <input type="text" value="${row.next || ''}" placeholder="next (próximo nó)"
                                                   onchange="atualizarItemLista('${nomeNo}', ${si}, ${ri}, 'next', this.value)"
                                                   class="w-full p-1 border rounded text-xs font-mono" style="border-color:#e9d5ff;">
                                        </div>
                                    `).join('')}
                                    <button onclick="addItemLista('${nomeNo}', ${si})" class="text-xs text-purple-600 hover:text-purple-800 mt-1">
                                        <i class="fa-solid fa-plus"></i> Adicionar item
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                        <button onclick="addSecao('${nomeNo}')" class="text-xs text-purple-600 hover:text-purple-800 mt-2 font-bold">
                            <i class="fa-solid fa-plus"></i> Adicionar seção
                        </button>
                        </div><!-- /list-manual -->
                    </div>
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
            if (fluxoAtual && fluxoAtual[value]) return 'Esse nó já existe';
            return null;
        }
    }).then((result) => {
        if (result.isConfirmed) {
            // Garantir que fluxoAtual existe
            if (!fluxoAtual || typeof fluxoAtual !== 'object') {
                fluxoAtual = {
                    inicio: {
                        title: '🎯 Menu Principal',
                        text: 'Olá! Como podemos te ajudar?',
                        footer: 'AVS Infotec',
                        buttons: [
                            { id: 'voltar', text: '↩️ Voltar', next: 'inicio' }
                        ]
                    }
                };
                console.log('[fluxos] fluxoAtual inicializado automaticamente');
            }
            
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


// ============================================================
// FUNÇÕES PIX
// ============================================================
function togglePix(nomeNo, ativo) {
    if (!fluxoAtual[nomeNo]) return;
    if (ativo) {
        if (!fluxoAtual[nomeNo].pix) {
            fluxoAtual[nomeNo].pix = { amount: 0, description: '' };
        }
    } else {
        delete fluxoAtual[nomeNo].pix;
    }
    renderizarFluxo();
}

function atualizarPix(nomeNo, campo, valor) {
    if (!fluxoAtual[nomeNo]) return;
    if (!fluxoAtual[nomeNo].pix) fluxoAtual[nomeNo].pix = {};
    fluxoAtual[nomeNo].pix[campo] = campo === 'amount' ? parseFloat(valor) : valor;
}


// ============================================================
// IMPORTAR FLUXO
// ============================================================
async function importarFluxo() {
    const { value: jsonText } = await Swal.fire({
        title: '📥 Importar Fluxo',
        html: `
            <div style="text-align:left;">
                <p style="font-size:13px;color:#6b7280;margin-bottom:12px;">
                    Cole o JSON do fluxo OU selecione um arquivo <code>.json</code>:
                </p>
                <input type="file" id="import-file" accept=".json,application/json" 
                       style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;margin-bottom:12px;">
                <textarea id="import-json" placeholder="Ou cole o JSON aqui..." 
                          style="width:100%;height:200px;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;font-family:monospace;box-sizing:border-box;resize:vertical;"></textarea>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '📥 Importar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#10b981',
        didOpen: () => {
            const fileInput = document.getElementById('import-file');
            const textarea = document.getElementById('import-json');
            
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    textarea.value = ev.target.result;
                };
                reader.readAsText(file);
            });
        },
        preConfirm: () => {
            const textarea = document.getElementById('import-json');
            const text = textarea.value.trim();
            if (!text) {
                Swal.showValidationMessage('Cole o JSON ou selecione um arquivo');
                return false;
            }
            try {
                const parsed = JSON.parse(text);
                if (typeof parsed !== 'object' || Array.isArray(parsed)) {
                    Swal.showValidationMessage('JSON deve ser um objeto de nós');
                    return false;
                }
                return parsed;
            } catch (e) {
                Swal.showValidationMessage('JSON inválido: ' + e.message);
                return false;
            }
        }
    });
    
    if (!jsonText) return;
    
    // Confirmação
    const confirm = await Swal.fire({
        title: 'Substituir fluxo atual?',
        html: `O fluxo atual será <strong>substituído</strong> por <strong>${Object.keys(jsonText).length} nó(s)</strong>.<br><br>Você precisa clicar em <strong>Salvar</strong> depois para persistir.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sim, importar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#f59e0b'
    });
    
    if (confirm.isConfirmed) {
        fluxoAtual = jsonText;
        renderizarFluxo();
        Swal.fire({
            icon: 'success',
            title: 'Importado!',
            text: 'Não esqueça de clicar em Salvar para persistir.',
            timer: 3000,
            showConfirmButton: true,
            confirmButtonText: 'OK'
        });
    }
}

// ============================================================
// EXPORTAR FLUXO
// ============================================================
function exportarFluxo() {
    if (!fluxoAtual || Object.keys(fluxoAtual).length === 0) {
        Swal.fire('Atenção', 'Nenhum fluxo carregado para exportar.', 'warning');
        return;
    }
    
    // Criar o JSON formatado
    const json = JSON.stringify(fluxoAtual, null, 2);
    
    // Criar o nome do arquivo com timestamp
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const nomeArquivo = `fluxo-${nomeFluxo || 'export'}-${timestamp}.json`;
    
    // Criar blob e link de download
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Notificação
    Swal.fire({
        icon: 'success',
        title: '📤 Exportado!',
        html: `Arquivo: <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:12px;">${nomeArquivo}</code><br><br>Verifique a pasta de downloads.`,
        timer: 3000,
        showConfirmButton: false
    });
}

// ============================================================
// EDITOR DE LISTA NATIVA
// ============================================================
function toggleList(nomeNo, ativo) {
    if (!fluxoAtual[nomeNo]) return;
    if (ativo) {
        if (!fluxoAtual[nomeNo].list) {
            fluxoAtual[nomeNo].list = {
                buttonText: 'Ver Opções',
                sections: [{
                    title: 'Seção 1',
                    rows: [{ id: 'item_1', title: 'Item 1', description: 'Descrição', next: nomeNo }]
                }]
            };
        }
    } else {
        delete fluxoAtual[nomeNo].list;
    }
    renderizarFluxo();
}

function atualizarList(nomeNo, campo, valor) {
    if (!fluxoAtual[nomeNo]) return;
    if (!fluxoAtual[nomeNo].list) fluxoAtual[nomeNo].list = { sections: [] };
    fluxoAtual[nomeNo].list[campo] = valor;
}

function addSecao(nomeNo) {
    if (!fluxoAtual[nomeNo]) return;
    if (!fluxoAtual[nomeNo].list) fluxoAtual[nomeNo].list = { buttonText: 'Ver Opções', sections: [] };
    if (!fluxoAtual[nomeNo].list.sections) fluxoAtual[nomeNo].list.sections = [];
    const n = fluxoAtual[nomeNo].list.sections.length + 1;
    fluxoAtual[nomeNo].list.sections.push({
        title: 'Seção ' + n,
        rows: [{ id: 'item_' + n + '_1', title: 'Item 1', description: 'Descrição', next: nomeNo }]
    });
    renderizarFluxo();
}

function removeSecao(nomeNo, si) {
    if (!fluxoAtual[nomeNo]?.list?.sections) return;
    fluxoAtual[nomeNo].list.sections.splice(si, 1);
    renderizarFluxo();
}

function atualizarSecao(nomeNo, si, campo, valor) {
    if (!fluxoAtual[nomeNo]?.list?.sections?.[si]) return;
    fluxoAtual[nomeNo].list.sections[si][campo] = valor;
}

function addItemLista(nomeNo, si) {
    if (!fluxoAtual[nomeNo]?.list?.sections?.[si]) return;
    if (!fluxoAtual[nomeNo].list.sections[si].rows) fluxoAtual[nomeNo].list.sections[si].rows = [];
    const n = fluxoAtual[nomeNo].list.sections[si].rows.length + 1;
    fluxoAtual[nomeNo].list.sections[si].rows.push({
        id: 'item_' + (si + 1) + '_' + n,
        title: 'Item ' + n,
        description: 'Descrição',
        next: nomeNo
    });
    renderizarFluxo();
}

function removeItemLista(nomeNo, si, ri) {
    if (!fluxoAtual[nomeNo]?.list?.sections?.[si]?.rows) return;
    fluxoAtual[nomeNo].list.sections[si].rows.splice(ri, 1);
    renderizarFluxo();
}

function atualizarItemLista(nomeNo, si, ri, campo, valor) {
    if (!fluxoAtual[nomeNo]?.list?.sections?.[si]?.rows?.[ri]) return;
    fluxoAtual[nomeNo].list.sections[si].rows[ri][campo] = valor;
}

// ============================================================
// LISTA DINÂMICA (do catálogo)
// ============================================================
function toggleListFromCatalogo(nomeNo, ativo) {
    if (!fluxoAtual[nomeNo]) return;
    if (ativo) {
        fluxoAtual[nomeNo].listFromCatalogo = true;
        // ✅ IMPORTANTE: remove o `list` antigo (hardcoded) pra não conflitar
        delete fluxoAtual[nomeNo].list;
        if (!fluxoAtual[nomeNo].listButtonText) {
            fluxoAtual[nomeNo].listButtonText = 'Ver Catálogo 📂';
        }
        console.log('✅ listFromCatalogo ATIVADO em', nomeNo, '- list antigo removido');
    } else {
        delete fluxoAtual[nomeNo].listFromCatalogo;
    }
    renderizarFluxo();
}

// ============================================================
// CAMPO DE IMAGEM (v5 - SEM EMOJIS, ASCII puro)
// ============================================================
function toggleImagem(nomeNo, ativo) {
    if (!fluxoAtual[nomeNo]) return;
    if (ativo) {
        fluxoAtual[nomeNo].image = fluxoAtual[nomeNo].image || '';
    } else {
        delete fluxoAtual[nomeNo].image;
        delete fluxoAtual[nomeNo].imageCaption;
    }
    var div = document.getElementById('imagem-config-' + nomeNo);
    if (div) {
        div.style.display = ativo ? 'block' : 'none';
    } else {
        renderizarFluxo();
    }
}

function atualizarImagem(nomeNo, valor) {
    if (!fluxoAtual[nomeNo]) return;
    if (valor && valor.trim()) {
        fluxoAtual[nomeNo].image = valor.trim();
    } else {
        delete fluxoAtual[nomeNo].image;
    }
}

function atualizarImagemCaption(nomeNo, valor) {
    if (!fluxoAtual[nomeNo]) return;
    if (valor && valor.trim()) {
        fluxoAtual[nomeNo].imageCaption = valor.trim();
    } else {
        delete fluxoAtual[nomeNo].imageCaption;
    }
}
