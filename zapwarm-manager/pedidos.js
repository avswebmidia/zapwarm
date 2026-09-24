// ============================================================
// PEDIDOS — CRM/ERP
// ============================================================
let pedidosCache = [];
let statsCache = {};

const STATUS_LABEL = {
    recebido: '📥 Recebido',
    em_preparo: '👨‍🍳 Em preparo',
    saiu_entrega: '🛵 Saiu p/ entrega',
    entregue: '✅ Entregue',
    cancelado: '❌ Cancelado'
};

const STATUS_ORDER = ['recebido', 'em_preparo', 'saiu_entrega', 'entregue', 'cancelado'];

function fmtMoney(v) {
    return 'R$ ' + (v || 0).toFixed(2).replace('.', ',');
}

function fmtData(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

async function carregarStats() {
    try {
        const res = await apiFetch('/pedidos/stats');
        if (!res.success) return;
        statsCache = res.stats;
        document.getElementById('kpi-hoje').textContent = res.stats.hoje || 0;
        document.getElementById('kpi-pendentes').textContent = res.stats.pendentes || 0;
        document.getElementById('kpi-entrega').textContent = res.stats.emEntrega || 0;
        document.getElementById('kpi-entregues').textContent = res.stats.entregues || 0;
        document.getElementById('kpi-fat').textContent = fmtMoney(res.stats.faturamentoHoje || 0);
    } catch (e) {
        console.warn('Erro stats:', e.message);
    }
}

async function carregarPedidos() {
    const list = document.getElementById('pedidos-list');
    list.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin text-2xl"></i><p>Carregando...</p></div>';
    try {
        const res = await apiFetch('/pedidos/list');
        if (!res.success) throw new Error(res.error || 'Falha');
        pedidosCache = res.pedidos || [];
        renderizarPedidos();
        await carregarStats();
    } catch (e) {
        list.innerHTML = '<div style="text-align:center;padding:32px;color:#ef4444;">Erro: ' + e.message + '</div>';
    }
}

function aplicarFiltros() {
    renderizarPedidos();
}

function renderizarPedidos() {
    const list = document.getElementById('pedidos-list');
    const busca = (document.getElementById('filtro-busca').value || '').toLowerCase().trim();
    const fStatus = document.getElementById('filtro-status').value;
    const fPg = document.getElementById('filtro-pg').value;

    let filtrados = pedidosCache.filter(p => {
        if (fStatus && p.status !== fStatus) return false;
        if (fPg && (p.pagamento?.status || 'pendente') !== fPg) return false;
        if (busca) {
            const blob = (p.id + ' ' + (p.cliente?.nome || '') + ' ' + (p.cliente?.telefone || '')).toLowerCase();
            if (!blob.includes(busca)) return false;
        }
        return true;
    });

    if (filtrados.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:48px 16px;background:#fff;border-radius:14px;border:2px dashed #e2e8f0;color:#94a3b8;"><i class="fa-solid fa-inbox text-3xl"></i><p style="margin-top:8px;">Nenhum pedido encontrado.</p></div>';
        return;
    }

    list.innerHTML = filtrados.map(p => {
        const statusCls = 's-' + p.status;
        const pgStatus = p.pagamento?.status || 'pendente';
        const pgCls = pgStatus === 'pago' ? 'pg-pago' : 'pg-pendente';
        const itens = (p.itens || []).map(i => i.qtd + 'x ' + i.nome).join(', ');
        return '<div class="pedido-row">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">' +
                '<div style="flex:1;min-width:200px;">' +
                    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                        '<strong style="font-size:15px;color:#1e293b;">' + p.id + '</strong>' +
                        '<span class="status-badge ' + statusCls + '">' + (STATUS_LABEL[p.status] || p.status) + '</span>' +
                        '<span class="status-badge ' + pgCls + '">💰 ' + pgStatus + '</span>' +
                    '</div>' +
                    '<div style="margin-top:6px;font-size:13px;color:#475569;">👤 ' + (p.cliente?.nome || '-') + ' • 📱 ' + (p.cliente?.telefone || '-') + '</div>' +
                    '<div style="margin-top:2px;font-size:12px;color:#94a3b8;">' + itens + '</div>' +
                    '<div style="margin-top:2px;font-size:12px;color:#94a3b8;">📍 ' + (p.endereco || '-') + '</div>' +
                '</div>' +
                '<div style="text-align:right;">' +
                    '<div style="font-size:18px;font-weight:800;color:#10b981;">' + fmtMoney(p.total) + '</div>' +
                    '<div style="font-size:11px;color:#94a3b8;">' + fmtData(p.criadoEm) + '</div>' +
                '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;">' +
                '<button onclick="verPedido(\'' + p.id + '\')" class="btn btn-secondary" style="padding:6px 12px;font-size:12px;min-height:32px;"><i class="fa-solid fa-eye"></i> Ver</button>' +
                proximoBotao(p) +
                '<button onclick="removerPedido(\'' + p.id + '\')" class="btn btn-secondary" style="padding:6px 12px;font-size:12px;min-height:32px;color:#ef4444;"><i class="fa-solid fa-trash"></i></button>' +
            '</div>' +
        '</div>';
    }).join('');
}

function proximoBotao(p) {
    const idx = STATUS_ORDER.indexOf(p.status);
    if (idx < 0 || idx >= 3) return '';
    const proximo = STATUS_ORDER[idx + 1];
    const labels = { em_preparo: '👨‍🍳 Preparar', saiu_entrega: '🛵 Enviar', entregue: '✅ Entregue' };
    const cores = { em_preparo: '#f59e0b', saiu_entrega: '#6366f1', entregue: '#10b981' };
    return '<button onclick="mudarStatus(\'' + p.id + '\',\'' + proximo + '\')" class="btn btn-primary" style="padding:6px 12px;font-size:12px;min-height:32px;background:' + cores[proximo] + ';">' + labels[proximo] + '</button>';
}

async function mudarStatus(id, status) {
    const conf = await Swal.fire({
        title: 'Mudar status?',
        html: 'Pedido <strong>' + id + '</strong><br>Novo status: <strong>' + (STATUS_LABEL[status] || status) + '</strong><br><br><small>O cliente será notificado no WhatsApp.</small>',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Confirmar',
        cancelButtonText: 'Cancelar'
    });
    if (!conf.isConfirmed) return;
    Swal.fire({ title: 'Atualizando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const res = await apiFetch('/pedidos/' + id + '/status', {
            method: 'POST',
            body: JSON.stringify({ status, notificar: true })
        });
        if (res.success) {
            Swal.fire({ icon: 'success', title: res.notificou ? 'Atualizado + cliente notificado!' : 'Atualizado!', timer: 1800, showConfirmButton: false });
            await carregarPedidos();
        } else {
            Swal.fire('Erro', res.error || 'Falha', 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

async function verPedido(id) {
    Swal.fire({ title: 'Carregando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const res = await apiFetch('/pedidos/' + id);
        if (!res.success) return Swal.fire('Erro', res.error, 'error');
        const p = res.pedido;
        const itensHtml = (p.itens || []).map(i => '<tr><td>' + i.qtd + 'x ' + i.nome + '</td><td style="text-align:right;">' + fmtMoney(i.valor * i.qtd) + '</td></tr>').join('');
        const histHtml = (p.historico || []).map(h => '<li>' + (STATUS_LABEL[h.status] || h.status) + ' — ' + fmtData(h.em) + '</li>').join('');
        Swal.fire({
            title: p.id + ' — ' + (p.cliente?.nome || 'Cliente'),
            width: 640,
            html:
                '<div style="text-align:left;font-size:13px;">' +
                    '<p><strong>📱 Telefone:</strong> ' + (p.cliente?.telefone || '-') + '</p>' +
                    '<p><strong>📍 Endereço:</strong> ' + (p.endereco || '-') + '</p>' +
                    '<p><strong>📦 Status:</strong> ' + (STATUS_LABEL[p.status] || p.status) + '</p>' +
                    '<p><strong>💰 Pagamento:</strong> ' + (p.pagamento?.status || 'pendente') + ' (' + (p.pagamento?.metodo || '-') + ')</p>' +
                    '<hr style="margin:12px 0;">' +
                    '<table style="width:100%;font-size:13px;">' + itensHtml + '</table>' +
                    '<hr style="margin:12px 0;">' +
                    '<p style="text-align:right;"><strong>Subtotal:</strong> ' + fmtMoney(p.subtotal) + '</p>' +
                    '<p style="text-align:right;"><strong>Taxa entrega:</strong> ' + fmtMoney(p.taxaEntrega) + '</p>' +
                    '<p style="text-align:right;font-size:16px;color:#10b981;"><strong>Total:</strong> ' + fmtMoney(p.total) + '</p>' +
                    '<hr style="margin:12px 0;">' +
                    '<p><strong>Histórico:</strong></p>' +
                    '<ul style="font-size:12px;color:#64748b;">' + histHtml + '</ul>' +
                '</div>',
            showCancelButton: true,
            confirmButtonText: 'Fechar',
            cancelButtonText: 'Marcar pago',
            cancelButtonColor: '#10b981'
        }).then(r => {
            if (r.dismiss === Swal.DismissReason.cancel) marcarPago(id);
        });
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

async function marcarPago(id) {
    Swal.fire({ title: 'Marcando como pago...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const res = await apiFetch('/pedidos/' + id + '/pagamento', {
            method: 'POST',
            body: JSON.stringify({ status: 'pago' })
        });
        if (res.success) {
            Swal.fire({ icon: 'success', title: 'Pago!', timer: 1500, showConfirmButton: false });
            await carregarPedidos();
        } else {
            Swal.fire('Erro', res.error, 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

async function removerPedido(id) {
    const conf = await Swal.fire({
        title: 'Remover pedido?',
        text: 'Essa ação não pode ser desfeita.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Remover',
        confirmButtonColor: '#ef4444',
        cancelButtonText: 'Cancelar'
    });
    if (!conf.isConfirmed) return;
    try {
        const res = await apiFetch('/pedidos/' + id, { method: 'DELETE' });
        if (res.success) {
            Swal.fire({ icon: 'success', title: 'Removido', timer: 1200, showConfirmButton: false });
            await carregarPedidos();
        } else {
            Swal.fire('Erro', res.error, 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

async function novoPedido() {
    Swal.fire({
        title: 'Novo Pedido',
        width: 640,
        html:
            '<div style="text-align:left;font-size:13px;">' +
                '<label style="font-weight:700;">Cliente</label>' +
                '<input id="np-nome" placeholder="Nome" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;margin:4px 0 10px;">' +
                '<label style="font-weight:700;">Telefone (com DDI)</label>' +
                '<input id="np-tel" placeholder="5515999999999" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;margin:4px 0 10px;">' +
                '<label style="font-weight:700;">Endereço</label>' +
                '<input id="np-end" placeholder="Rua, número, bairro" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;margin:4px 0 10px;">' +
                '<label style="font-weight:700;">Itens (um por linha: qtd|nome|valor)</label>' +
                '<textarea id="np-itens" style="width:100%;height:80px;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-family:monospace;margin:4px 0 10px;">1|Pizza Calabresa Grande|60\n1|Coca-Cola 2L|12</textarea>' +
                '<label style="font-weight:700;">Taxa de entrega (R$)</label>' +
                '<input id="np-taxa" type="number" value="5" step="0.01" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;margin:4px 0 10px;">' +
            '</div>',
        showCancelButton: true,
        confirmButtonText: 'Criar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const nome = document.getElementById('np-nome').value.trim();
            const tel = document.getElementById('np-tel').value.trim();
            const end = document.getElementById('np-end').value.trim();
            const taxa = parseFloat(document.getElementById('np-taxa').value) || 0;
            const linhas = document.getElementById('np-itens').value.split('\n').map(l => l.trim()).filter(Boolean);
            const itens = linhas.map(l => {
                const [qtd, nome, valor] = l.split('|');
                return { qtd: parseInt(qtd) || 1, nome: (nome || '').trim(), valor: parseFloat(valor) || 0 };
            });
            if (!nome || itens.length === 0) return Swal.showValidationMessage('Preencha cliente e itens');
            const subtotal = itens.reduce((s, i) => s + i.valor * i.qtd, 0);
            return { cliente: { nome, telefone: tel, remoteJid: tel ? tel + '@s.whatsapp.net' : '' }, itens, subtotal, taxaEntrega: taxa, total: subtotal + taxa, endereco: end };
        }
    }).then(async (r) => {
        if (!r.isConfirmed) return;
        try {
            const res = await apiFetch('/pedidos/create', { method: 'POST', body: JSON.stringify(r.value) });
            if (res.success) {
                Swal.fire({ icon: 'success', title: 'Pedido criado!', text: res.pedido.id, timer: 1800, showConfirmButton: false });
                await carregarPedidos();
            } else {
                Swal.fire('Erro', res.error, 'error');
            }
        } catch (e) {
            Swal.fire('Erro', e.message, 'error');
        }
    });
}

// Auto-refresh + inicialização
carregarPedidos();
setInterval(() => {
    if (document.hidden) return;
    if (document.querySelector('.swal2-container')) return;
    carregarPedidos();
}, 30000);
