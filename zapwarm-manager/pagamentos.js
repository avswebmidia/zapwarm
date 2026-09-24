// ============================================================
// CONFIGURAÇÃO MERCADO PAGO
// ============================================================
let instanciasMp = [];
let instanciaAtualMp = null;

async function carregarInstanciasMp() {
    try {
        const res = await apiFetch('/instance/list');
        const select = document.getElementById('mp-instance-select');
        select.innerHTML = '<option value="">Selecione uma instância...</option>';
        
        if (!res.success || !res.instances || res.instances.length === 0) {
            select.innerHTML = '<option value="">Nenhuma instância encontrada</option>';
            return;
        }
        
        instanciasMp = res.instances;
        res.instances.forEach(inst => {
            const opt = document.createElement('option');
            opt.value = inst.instance;
            opt.textContent = inst.instance + (inst.connected ? ' ✓' : '');
            select.appendChild(opt);
        });
    } catch (e) {
        console.error('Erro ao carregar instâncias:', e);
    }
}

async function carregarConfigMp() {
    const nome = document.getElementById('mp-instance-select').value;
    const statusEl = document.getElementById('mp-status');
    const formEl = document.getElementById('mp-form');
    
    if (!nome) {
        statusEl.style.display = 'none';
        formEl.style.display = 'none';
        return;
    }
    
    const inst = instanciasMp.find(i => i.instance === nome);
    if (!inst) return;
    instanciaAtualMp = inst;
    
    try {
        const res = await apiFetch('/payment/config', {
            headers: { instance: inst.instance, token: inst.token }
        });
        
        statusEl.style.display = 'block';
        formEl.style.display = 'block';
        
        const config = res.config || {};
        
        // Status badge
        const statusBadge = document.getElementById('mp-status-badge');
        if (config.enabled && config.hasAccessToken && config.hasPublicKey) {
            statusBadge.innerHTML = '<span class="status-badge active"><i class="fa-solid fa-check"></i> CONFIGURADO E ATIVO</span>';
        } else if (config.hasAccessToken || config.hasPublicKey) {
            statusBadge.innerHTML = '<span class="status-badge global"><i class="fa-solid fa-exclamation"></i> INCOMPLETO</span>';
        } else {
            statusBadge.innerHTML = '<span class="status-badge inactive"><i class="fa-solid fa-xmark"></i> NÃO CONFIGURADO</span>';
        }
        
        // Checkbox enabled
        document.getElementById('mp-enabled').checked = !!config.enabled;
        
        // Access Token
        const tokenInput = document.getElementById('mp-access-token');
        tokenInput.value = '';
        tokenInput.placeholder = config.maskedAccessToken 
            ? 'Chave salva: ' + config.maskedAccessToken + ' (deixe em branco para manter)'
            : 'APP_USR-... ou TEST-...';
        
        const tokenInfo = document.getElementById('mp-token-info');
        if (config.maskedAccessToken) {
            tokenInfo.innerHTML = '✅ Já existe uma chave salva. Preencha apenas se quiser trocar.';
        } else {
            tokenInfo.innerHTML = 'Cole aqui o Access Token de produção.';
        }
        
        // Public Key
        const pkInput = document.getElementById('mp-public-key');
        pkInput.value = '';
        pkInput.placeholder = config.maskedPublicKey 
            ? 'Chave salva: ' + config.maskedPublicKey + ' (deixe em branco para manter)'
            : 'APP_USR-... ou TEST-...';
        
    } catch (e) {
        console.error('Erro ao carregar config MP:', e);
        Swal.fire('Erro', 'Falha ao carregar configuração', 'error');
    }
}

async function salvarConfigMp() {
    if (!instanciaAtualMp) return;
    
    const enabled = document.getElementById('mp-enabled').checked;
    const accessToken = document.getElementById('mp-access-token').value.trim();
    const publicKey = document.getElementById('mp-public-key').value.trim();
    
    Swal.fire({ 
        title: 'Salvando...', 
        allowOutsideClick: false, 
        didOpen: () => Swal.showLoading() 
    });
    
    try {
        const body = { enabled };
        if (accessToken) body.accessToken = accessToken;
        if (publicKey) body.publicKey = publicKey;
        
        const res = await apiFetch('/payment/config', {
            method: 'POST',
            headers: { 
                instance: instanciaAtualMp.instance, 
                token: instanciaAtualMp.token 
            },
            body: JSON.stringify(body)
        });
        
        if (res.success) {
            Swal.fire({
                icon: 'success',
                title: 'Salvo!',
                text: 'Configuração do Mercado Pago atualizada',
                timer: 2000,
                showConfirmButton: false
            });
            // Recarregar
            carregarConfigMp();
        } else {
            Swal.fire('Erro', res.error || 'Falha ao salvar', 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

function togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.innerHTML = isPassword 
        ? '<i class="fa-solid fa-eye-slash"></i>' 
        : '<i class="fa-solid fa-eye"></i>';
}

function copiarWebhook() {
    const url = 'https://api.zapbulk.com.br/webhook/mp';
    navigator.clipboard.writeText(url).then(() => {
        Swal.fire({
            icon: 'success',
            title: 'URL copiada!',
            text: url,
            timer: 2000,
            showConfirmButton: false
        });
    });
}

// Inicialização
carregarInstanciasMp();
