// ============================================================
// CARDÁPIO (dentro de pedidos.html)
// ============================================================
let cardapioAtual = { categorias: [] };
let instanciaAtual = null;

function mudarAba(aba) {
    document.getElementById('conteudo-pedidos').style.display = aba === 'pedidos' ? 'block' : 'none';
    document.getElementById('conteudo-cardapio').style.display = aba === 'cardapio' ? 'block' : 'none';
    document.getElementById('conteudo-pagamento').style.display = aba === 'pagamento' ? 'block' : 'none';
    ['pedidos', 'cardapio', 'pagamento'].forEach(a => {
        const btn = document.getElementById('tab-' + a);
        if (!btn) return;
        const ativo = a === aba;
        btn.style.borderBottomColor = ativo ? '#10b981' : 'transparent';
        btn.style.color = ativo ? '#10b981' : '#94a3b8';
    });
    if (aba === 'cardapio' && cardapioAtual.categorias.length === 0) {
        carregarCardapio();
    }
    if (aba === 'pagamento' && typeof carregarFormasPagamento === 'function') {
        carregarFormasPagamento();
    }
}

async function carregarCardapio() {
    try {
        // Pega instância (pro token, se necessário)
        const inst = await apiFetch('/instance/list');
        if (inst.success && inst.instances && inst.instances.length > 0) {
            instanciaAtual = inst.instances[0];
        }
        const res = await apiFetch('/cardapio');
        if (res.success && res.cardapio) {
            cardapioAtual = res.cardapio;
            renderizarCardapio();
        }
    } catch (e) {
        console.warn('Erro ao carregar cardápio:', e.message);
    }
}

function renderizarCardapio() {
    const lista = document.getElementById('cardapio-lista');
    if (!cardapioAtual.categorias || cardapioAtual.categorias.length === 0) {
        lista.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;">Nenhuma categoria no catálogo. Clique em "Nova Categoria".</div>';
        return;
    }

    lista.innerHTML = cardapioAtual.categorias.map((cat, ci) => `
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:14px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <input type="text" value="${cat.titulo || ''}" placeholder="Título da categoria"
                       onchange="atualizarCategoria(${ci}, 'titulo', this.value)"
                       style="flex:1;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;font-weight:700;">
                <input type="text" value="${cat.id || ''}" placeholder="ID (ex: pizzas)" disabled
                       style="width:120px;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;font-family:monospace;background:#f1f5f9;color:#94a3b8;">
                <button onclick="removerCategoria(${ci})" class="btn btn-secondary" style="padding:8px 12px;color:#ef4444;">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
            <div>
                ${(cat.itens || []).map((item, ii) => `
                    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px;">
                        <div style="display:grid;grid-template-columns:2fr 1fr 1.5fr 1fr 40px;gap:6px;align-items:center;">
                            <input type="text" value="${item.titulo || ''}" placeholder="Nome" onchange="atualizarItem(${ci}, ${ii}, 'titulo', this.value)"
                                   style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;">
                            <input type="number" value="${item.valor || 0}" step="0.01" placeholder="R$ 0,00" onchange="atualizarItem(${ci}, ${ii}, 'valor', parseFloat(this.value))"
                                   style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;">
                            <input type="text" value="${item.descricao || ''}" placeholder="Descrição" onchange="atualizarItem(${ci}, ${ii}, 'descricao', this.value)"
                                   style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;">
                            <input type="text" value="${item.next || ''}" placeholder="next (nó)" onchange="atualizarItem(${ci}, ${ii}, 'next', this.value)"
                                   style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;font-family:monospace;">
                            <button onclick="removerItem(${ci}, ${ii})" class="btn btn-secondary" style="padding:6px;color:#ef4444;">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div style="margin-top:6px;font-size:11px;color:#94a3b8;">
                            ID: <code>${item.id || '-'}</code>
                        </div>
                    </div>
                `).join('')}
                <button onclick="adicionarItem(${ci})" class="btn btn-secondary" style="padding:8px 14px;font-size:13px;">
                    <i class="fa-solid fa-plus"></i> Adicionar produto
                </button>
            </div>
        </div>
    `).join('');
}

function atualizarCategoria(ci, campo, valor) {
    cardapioAtual.categorias[ci][campo] = valor;
    // Atualiza o ID se mudou o título
    if (campo === 'titulo' && !cardapioAtual.categorias[ci].id) {
        cardapioAtual.categorias[ci].id = valor.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    }
}

function atualizarItem(ci, ii, campo, valor) {
    cardapioAtual.categorias[ci].itens[ii][campo] = valor;
    // Gera ID automático se não tem
    if (!cardapioAtual.categorias[ci].itens[ii].id) {
        const slug = (cardapioAtual.categorias[ci].itens[ii].titulo || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '_');
        cardapioAtual.categorias[ci].itens[ii].id = slug;
        renderizarCardapio();
    }
}

async function adicionarCategoria() {
    const { value: nome } = await Swal.fire({
        title: '📁 Nova Categoria',
        input: 'text',
        inputLabel: 'Nome da categoria',
        inputPlaceholder: 'Ex: Pizzas Doces, Bebidas, Sobremesas',
        showCancelButton: true,
        confirmButtonText: 'Criar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#10b981',
        inputValidator: (v) => !v || v.trim().length < 2 ? 'Digite um nome válido' : null
    });
    if (!nome) return;
    const id = nome.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
    cardapioAtual.categorias.push({ id, titulo: '🍽️ ' + nome.trim(), itens: [] });
    renderizarCardapio();
}

async function removerCategoria(ci) {
    const cat = cardapioAtual.categorias[ci];
    const nItens = (cat.itens || []).length;
    const conf = await Swal.fire({
        title: '🗑️ Remover categoria?',
        html: '<b>' + (cat.titulo || 'Categoria') + '</b><br><small>' + nItens + ' produto(s) será(ão) removido(s)</small>',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Remover',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#ef4444'
    });
    if (!conf.isConfirmed) return;
    cardapioAtual.categorias.splice(ci, 1);
    renderizarCardapio();
}

async function adicionarItem(ci) {
    const cat = cardapioAtual.categorias[ci];
    const { value: form } = await Swal.fire({
        title: '➕ Novo Produto',
        html:
            '<div style="text-align:left;font-size:13px;">' +
                '<label style="font-weight:700;color:#475569;">Nome</label>' +
                '<input id="swal-nome" class="swal2-input" placeholder="Ex: Calabresa" style="width:100%;margin:4px 0 12px;">' +
                '<label style="font-weight:700;color:#475569;">Preço (R$)</label>' +
                '<input id="swal-valor" type="number" step="0.01" class="swal2-input" placeholder="60.00" style="width:100%;margin:4px 0 12px;">' +
                '<label style="font-weight:700;color:#475569;">Descrição</label>' +
                '<input id="swal-desc" class="swal2-input" placeholder="R$ 60 (Grande)" style="width:100%;margin:4px 0 12px;">' +
                '<label style="font-weight:700;color:#475569;">Next (próximo nó)</label>' +
                '<input id="swal-next" class="swal2-input" placeholder="Ex: tam_calabresa" style="width:100%;margin:4px 0 0;font-family:monospace;">' +
            '</div>',
        width: 500,
        showCancelButton: true,
        confirmButtonText: 'Adicionar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#10b981',
        focusConfirm: false,
        preConfirm: () => {
            const nome = document.getElementById('swal-nome').value.trim();
            if (!nome) { Swal.showValidationMessage('Digite o nome'); return false; }
            return {
                nome,
                valor: parseFloat(document.getElementById('swal-valor').value) || 0,
                descricao: document.getElementById('swal-desc').value.trim(),
                next: document.getElementById('swal-next').value.trim()
            };
        }
    });
    if (!form) return;
    const id = (cat.id + '_' + form.nome).toLowerCase().replace(/[^a-z0-9]+/g, '_');
    cat.itens.push({
        id,
        titulo: form.nome,
        descricao: form.descricao || ('R$ ' + form.valor.toFixed(2)),
        valor: form.valor,
        next: form.next
    });
    renderizarCardapio();
}

async function removerItem(ci, ii) {
    const item = cardapioAtual.categorias[ci].itens[ii];
    const conf = await Swal.fire({
        title: '🗑️ Remover produto?',
        html: '<b>' + (item.titulo || 'Produto') + '</b>',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Remover',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#ef4444'
    });
    if (!conf.isConfirmed) return;
    cardapioAtual.categorias[ci].itens.splice(ii, 1);
    renderizarCardapio();
}

async function salvarCardapio() {
    Swal.fire({ title: 'Salvando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const res = await apiFetch('/cardapio', {
            method: 'POST',
            body: JSON.stringify({ cardapio: cardapioAtual })
        });
        if (res.success) {
            Swal.fire({ icon: 'success', title: 'Catálogo salvo!', timer: 1500, showConfirmButton: false });
            cardapioAtual = res.cardapio;
            renderizarCardapio();
        } else {
            Swal.fire('Erro', res.error || 'Falha', 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}
