const API_BASE = (window.location.origin === 'null' || window.location.origin.includes('file://')) ? 'http://169.58.10.190:8080' : window.location.origin;

let instancesMap = {};

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
        const selectEl = document.getElementById('sender-instance');
        selectEl.innerHTML = '';
        instancesMap = {};
        
        if (!res.success || !res.instances || res.instances.length === 0) {
            selectEl.innerHTML = `<option value="">Nenhuma instância disponível</option>`;
            return;
        }

        let added = 0;
        res.instances.forEach(inst => {
            if (inst.status === 'connected' || inst.connected) {
                instancesMap[inst.instance] = inst.token;
                selectEl.innerHTML += `<option value="${inst.instance}">${inst.instance} (${inst.phone || 'Conectado'})</option>`;
                added++;
            }
        });

        if (added === 0) {
            selectEl.innerHTML = `<option value="">Nenhuma instância conectada</option>`;
        }
    } catch (error) {
        console.error(error);
        document.getElementById('sender-instance').innerHTML = `<option value="">Erro ao carregar instâncias</option>`;
    }
}

async function sendMessage() {
    const instance = document.getElementById('sender-instance').value;
    const number = document.getElementById('target-number').value;
    const text = document.getElementById('message-text').value;

    if (!instance) return Swal.fire('Atenção', 'Selecione uma instância conectada.', 'warning');
    if (!number) return Swal.fire('Atenção', 'Digite o número de destino.', 'warning');
    if (!text) return Swal.fire('Atenção', 'Digite a mensagem.', 'warning');

    const token = instancesMap[instance];

    Swal.fire({ title: 'Enviando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    const res = await apiFetch('/message/send-text', {
        method: 'POST',
        headers: { instance: instance, token: token },
        body: JSON.stringify({ number: number, text: text })
    });

    if (res.success) {
        Swal.fire('Sucesso!', 'Mensagem enviada com sucesso.', 'success');
        document.getElementById('message-text').value = '';
    } else {
        Swal.fire('Erro', res.error || 'Falha ao enviar mensagem.', 'error');
    }
}

loadInstances();
