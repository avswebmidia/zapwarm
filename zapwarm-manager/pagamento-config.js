// ============================================================
// CONFIG DE FORMAS DE PAGAMENTO (com token correto)
// ============================================================
async function carregarFormasPagamento() {
    try {
        // 1. Pega a lista de instâncias (com token) — igual pagamentos.js faz
        const inst = await apiFetch('/instance/list');
        if (!inst.success || !inst.instances || inst.instances.length === 0) return;

        const instance = inst.instances[0].instance;
        const token = inst.instances[0].token;
        window._pagtoInstance = instance;
        window._pagtoToken = token;

        // 2. Chama a API com o token correto
        const res = await apiFetch('/bot/pagamento', {
            headers: { instance: instance, token: token }
        });

        if (!res.success || !res.config) {
            console.warn('Falha ao carregar config de pagamento:', res.error);
            return;
        }

        for (const [k, v] of Object.entries(res.config)) {
            const el = document.getElementById('pagto-' + k);
            if (el) el.checked = !!v.ativo;
        }
        console.log('💳 Formas de pagamento carregadas:', res.config);
    } catch (e) {
        console.warn('Erro ao carregar formas de pagamento:', e.message);
    }
}

async function salvarFormasPagamento() {
    const instance = window._pagtoInstance;
    const token = window._pagtoToken;

    if (!instance || !token) {
        return Swal.fire('Erro', 'Instância não carregada. Recarregue a página.', 'error');
    }

    const config = {};
    for (const k of ['pix', 'dinheiro', 'cartao_entrega', 'cartao_online']) {
        const el = document.getElementById('pagto-' + k);
        config[k] = el ? el.checked : false;
    }

    if (!Object.values(config).some(v => v)) {
        return Swal.fire('Aviso', 'Marque pelo menos uma forma de pagamento', 'warning');
    }

    Swal.fire({ title: 'Salvando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const res = await apiFetch('/bot/pagamento', {
            method: 'POST',
            headers: { instance: instance, token: token },
            body: JSON.stringify({ config: config, instance: instance, token: token })
        });
        if (res.success) {
            Swal.fire({ icon: 'success', title: 'Salvo!', timer: 1500, showConfirmButton: false });
        } else {
            Swal.fire('Erro', res.error || 'Falha', 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

// Não carrega automaticamente — só quando o usuário clicar na aba "Pagamento"
// A chamada é feita por mudarAba() no cardapio.js
console.log('💳 pagamento-config.js carregado (aguardando aba)');
