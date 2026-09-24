// ============================================================
// DISPARO EM MASSA
// ============================================================
let instanciasDisparo = [];
let jobAtual = null;
let monitorInterval = null;

// ============================================================
// INICIALIZAÇÃO
// ============================================================
async function carregarDisparo() {
    try {
        // 1. Carrega instâncias
        const inst = await apiFetch('/instance/list');
        if (inst.success && inst.instances) {
            instanciasDisparo = inst.instances;
            const sel = document.getElementById('disparo-instancia');
            sel.innerHTML = inst.instances.map(i =>
                '<option value="' + i.instance + '">' + i.instance + (i.connected ? ' ✓' : '') + '</option>'
            ).join('');
        }

        // 2. Carrega fluxos disponíveis
        const fluxos = await apiFetch('/bot/fluxo/list');
        if (fluxos.success && fluxos.flows) {
            const selF = document.getElementById('disparo-flow');
            selF.innerHTML = fluxos.flows.map(f =>
                '<option value="' + f.name + '">' + f.name + ' (' + f.nodes.length + ' nós)</option>'
            ).join('');
            // Seleciona o jefferson se existir
            const jeff = fluxos.flows.find(f => f.name === 'jefferson');
            if (jeff) selF.value = 'jefferson';
        }

        // 3. Carrega stats
        await atualizarStats();

    } catch (e) {
        console.warn('Erro carregarDisparo:', e.message);
    }
}

async function atualizarStats() {
    try {
        const res = await apiFetch('/disparo/stats');
        if (res.success) {
            document.getElementById('kpi-optin').textContent = res.optin || 0;
            document.getElementById('kpi-optout').textContent = res.optout || 0;
            document.getElementById('kpi-hoje').textContent = (res.enviadosHoje || 0) + '/' + (res.limiteDiario || 50);
        }
    } catch (e) {}
}

// ============================================================
// UI — MODO
// ============================================================
function mudarModo() {
    const modo = document.getElementById('disparo-modo').value;
    document.getElementById('campo-flow').style.display = modo === 'fluxo' ? 'block' : 'none';
    document.getElementById('campo-mensagem').style.display = (modo === 'texto' || modo === 'imagem') ? 'block' : 'none';
    document.getElementById('campo-imagem').style.display = modo === 'imagem' ? 'block' : 'none';
}

// ============================================================
// IMPORTAÇÕES
// ============================================================
function importarCSV() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.csv,.txt';
    inp.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const linhas = ev.target.result.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
            const nums = linhas.map(l => {
                // Pega só a primeira coluna (antes da vírgula/ponto-e-vírgula)
                const col = l.split(/[,;]/)[0];
                return col.replace(/\D/g, '');
            }).filter(n => n.length >= 10);
            document.getElementById('disparo-numeros').value = nums.join('\n');
            Swal.fire({ icon: 'success', title: nums.length + ' números importados', timer: 1500, showConfirmButton: false });
        };
        reader.readAsText(file);
    };
    inp.click();
}

async function colarOptin() {
    Swal.fire({ title: 'Carregando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const res = await apiFetch('/disparo/optin');
        if (!res.success || !res.numeros) return Swal.fire('Erro', 'Falha', 'error');
        const nums = Object.keys(res.numeros);
        if (nums.length === 0) {
            return Swal.fire('Aviso', 'Nenhum número com opt-in registrado ainda.', 'info');
        }
        document.getElementById('disparo-numeros').value = nums.join('\n');
        Swal.fire({ icon: 'success', title: nums.length + ' números colados', timer: 1500, showConfirmButton: false });
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

// ============================================================
// INICIAR / PAUSAR / CANCELAR
// ============================================================
async function iniciarDisparo() {
    // Validações
    if (!document.getElementById('confirma-optin').checked) {
        return Swal.fire('⚠️ Atenção', 'Marque a confirmação de que os números autorizaram receber mensagens.', 'warning');
    }

    const instance = document.getElementById('disparo-instancia').value;
    const modo = document.getElementById('disparo-modo').value;
    const numerosTexto = document.getElementById('disparo-numeros').value;
    const mensagem = document.getElementById('disparo-mensagem').value;
    const imageUrl = document.getElementById('disparo-imagem').value;
    const flowName = document.getElementById('disparo-flow').value;
    const delayMin = parseInt(document.getElementById('disparo-delay-min').value) || 20;
    const delayMax = parseInt(document.getElementById('disparo-delay-max').value) || 35;

    const numeros = numerosTexto.split(/[\r\n,;]+/).map(n => n.replace(/\D/g, '')).filter(n => n.length >= 10);

    if (numeros.length === 0) return Swal.fire('Erro', 'Cole pelo menos 1 número', 'error');
    if (!instance) return Swal.fire('Erro', 'Selecione uma instância', 'error');
    if (modo === 'texto' && !mensagem) return Swal.fire('Erro', 'Digite a mensagem', 'error');
    if (modo === 'imagem' && !imageUrl) return Swal.fire('Erro', 'Cole a URL da imagem', 'error');

    const conf = await Swal.fire({
        title: '⚠️ Confirmar disparo?',
        html: '<b>' + numeros.length + ' números</b><br>Modo: <b>' + modo + '</b><br>Delay: <b>' + delayMin + '-' + delayMax + 's</b><br><br>Isso pode levar <b>' + Math.round(numeros.length * (delayMin + delayMax) / 2 / 60) + ' minutos</b>.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Iniciar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#10b981'
    });
    if (!conf.isConfirmed) return;

    Swal.fire({ title: 'Iniciando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const primeiroContatoEl = document.getElementById('primeiro-contato');
        const primeiroContato = primeiroContatoEl ? primeiroContatoEl.checked : false;
        console.log('[DISPARO] primeiroContato:', primeiroContato);

        const res = await apiFetch('/disparo/start', {
            method: 'POST',
            body: JSON.stringify({ instance, modo, numeros, mensagem, imageUrl, flowName, delayMin, delayMax, primeiroContato })
        });
        if (!res.success) return Swal.fire('Erro', res.error || 'Falha', 'error');

        jobAtual = res.jobId;
        Swal.fire({ icon: 'success', title: 'Disparo iniciado!', timer: 1500, showConfirmButton: false });

        // UI
        document.getElementById('progresso').style.display = 'block';
        document.getElementById('btn-iniciar').style.display = 'none';
        document.getElementById('btn-pausar').style.display = 'inline-block';
        document.getElementById('btn-cancelar').style.display = 'inline-block';
        document.getElementById('progresso-texto').textContent = '0/' + res.total;
        document.getElementById('progresso-status').textContent = 'Rodando...';
        document.getElementById('progresso-ok').textContent = '0';
        document.getElementById('progresso-erro').textContent = '0';
        document.getElementById('progresso-barra').style.width = '0%';

        // Monitora
        if (monitorInterval) clearInterval(monitorInterval);
        monitorInterval = setInterval(monitorarDisparo, 3000);

    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

async function monitorarDisparo() {
    if (!jobAtual) return;
    try {
        const res = await apiFetch('/disparo/status/' + jobAtual);
        if (!res.success || !res.job) return;
        const job = res.job;

        const total = job.total;
        const processados = job.enviados + job.erros;
        const pct = total > 0 ? Math.round(processados / total * 100) : 0;

        document.getElementById('progresso-texto').textContent = processados + '/' + total;
        document.getElementById('progresso-barra').style.width = pct + '%';
        document.getElementById('progresso-ok').textContent = job.enviados;
        document.getElementById('progresso-erro').textContent = job.erros;
        document.getElementById('progresso-status').textContent =
            job.status === 'concluido' ? '✅ Concluído' :
            job.status === 'pausado' ? '⏸️ Pausado' :
            job.status === 'cancelado' ? '⏹️ Cancelado' :
            '📢 Enviando (' + pct + '%)';

        // Fim
        if (job.status === 'concluido' || job.status === 'cancelado') {
            clearInterval(monitorInterval);
            monitorInterval = null;
            document.getElementById('btn-pausar').style.display = 'none';
            document.getElementById('btn-cancelar').style.display = 'none';
            document.getElementById('btn-iniciar').style.display = 'inline-block';
            atualizarStats();

            if (job.status === 'concluido') {
                Swal.fire({ icon: 'success', title: 'Disparo concluído!', html: '✅ ' + job.enviados + ' enviados<br>❌ ' + job.erros + ' erros', confirmButtonText: 'OK' });
            }
        }
    } catch (e) {}
}

async function pausarDisparo() {
    if (!jobAtual) return;
    await apiFetch('/disparo/pause/' + jobAtual, { method: 'POST' });
    Swal.fire({ icon: 'info', title: 'Pausado', timer: 1500, showConfirmButton: false });
}

async function cancelarDisparo() {
    if (!jobAtual) return;
    const conf = await Swal.fire({
        title: 'Cancelar disparo?',
        text: 'Os números ainda não enviados serão descartados.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Cancelar disparo',
        cancelButtonText: 'Voltar',
        confirmButtonColor: '#ef4444'
    });
    if (!conf.isConfirmed) return;
    await apiFetch('/disparo/cancel/' + jobAtual, { method: 'POST' });
    Swal.fire({ icon: 'info', title: 'Cancelado', timer: 1500, showConfirmButton: false });
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    carregarDisparo();
    setInterval(atualizarStats, 15000);
});

// ============================================================
// ABAS: DISPARO / RELATOS
// ============================================================
function mudarAbaDisparo(aba) {
    document.getElementById('conteudo-disparo').style.display = aba === 'disparo' ? 'block' : 'none';
    document.getElementById('conteudo-relatos').style.display = aba === 'relatos' ? 'block' : 'none';

    ['disparo', 'relatos'].forEach(function(a) {
        var btn = document.getElementById('tab-' + a);
        if (!btn) return;
        var ativo = a === aba;
        btn.style.borderBottomColor = ativo ? '#10b981' : 'transparent';
        btn.style.color = ativo ? '#10b981' : '#94a3b8';
    });

    if (aba === 'relatos') carregarRelatos();
}

// ============================================================
// RELATOS
// ============================================================
async function carregarRelatos() {
    var list = document.getElementById('relatos-list');
    list.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin text-2xl"></i><p>Carregando...</p></div>';

    try {
        var res = await apiFetch('/relatos');
        if (!res.success) throw new Error(res.error || 'Falha');

        // Atualiza badge
        var badge = document.getElementById('badge-relatos');
        if (res.total > 0) {
            badge.textContent = res.total;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }

        if (!res.relatos || res.relatos.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:48px 16px;background:#f8fafc;border-radius:14px;border:2px dashed #e2e8f0;color:#94a3b8;"><i class="fa-solid fa-inbox text-3xl"></i><p style="margin-top:8px;">Nenhum relato recebido ainda.</p></div>';
            return;
        }

        list.innerHTML = res.relatos.map(function(r) {
            var data = new Date(r.data);
            var dataFmt = data.toLocaleDateString('pt-BR') + ' ' + data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            return '<div style="background:#fff;border-radius:12px;padding:14px;margin-bottom:10px;border:2px solid #f1f5f9;">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">' +
                    '<div style="flex:1;min-width:200px;">' +
                        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                            '<strong style="font-size:14px;color:#1e293b;">' + (r.cliente.nome || 'Cliente') + '</strong>' +
                            '<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;">' + (r.id || '') + '</span>' +
                        '</div>' +
                        '<div style="margin-top:4px;font-size:12px;color:#64748b;">📱 ' + (r.cliente.telefone || '-') + ' • ' + (r.instance || '-') + '</div>' +
                        '<div style="margin-top:8px;padding:10px;background:#f8fafc;border-radius:8px;font-size:13px;color:#334155;white-space:pre-wrap;">' + (r.mensagem || '') + '</div>' +
                        '<div style="margin-top:6px;font-size:11px;color:#94a3b8;">' + dataFmt + '</div>' +
                    '</div>' +
                    '<div style="display:flex;flex-direction:column;gap:6px;min-width:110px;">' +
                        '<button onclick="responderPeloPainel(\'' + (r.cliente.remoteJid || r.cliente.telefone) + '\', \'' + (r.instance || '') + '\')" class="btn btn-primary" style="padding:6px 12px;font-size:12px;min-height:32px;background:#10b981;">' +
                            '<i class="fa-solid fa-comment"></i> Responder' +
                        '</button>' +
                        '<button onclick="responderPeloPainel(\'' + (r.cliente.telefone || '') + '\')" class="btn btn-secondary" style="padding:6px 12px;font-size:12px;min-height:32px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;">' +
                            '<i class="fa-solid fa-copy"></i> Copiar ID' +
                        '</button>' +
                        '<button onclick="removerRelato(\'' + r.id + '\')" class="btn btn-secondary" style="padding:6px 12px;font-size:12px;min-height:32px;color:#ef4444;">' +
                            '<i class="fa-solid fa-trash"></i> Excluir' +
                        '</button>'
                    '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    } catch (e) {
        list.innerHTML = '<div style="text-align:center;padding:32px;color:#ef4444;">Erro: ' + e.message + '</div>';
    }
}

async function removerRelato(id) {
    var conf = await Swal.fire({
        title: 'Remover relato?',
        text: 'Essa ação não pode ser desfeita.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Remover',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#ef4444'
    });
    if (!conf.isConfirmed) return;

    try {
        var res = await apiFetch('/relatos/' + id, { method: 'DELETE' });
        if (res.success) {
            Swal.fire({ icon: 'success', title: 'Removido', timer: 1200, showConfirmButton: false });
            await carregarRelatos();
        } else {
            Swal.fire('Erro', res.error || 'Falha', 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

// Atualiza badge ao carregar a página
setTimeout(function() {
    apiFetch('/relatos').then(function(res) {
        if (res.success && res.total > 0) {
            var badge = document.getElementById('badge-relatos');
            if (badge) {
                badge.textContent = res.total;
                badge.style.display = 'inline-block';
            }
        }
    }).catch(function() {});
}, 2000);

// ============================================================
// RESPONDER PELO PAINEL (envia via Baileys, funciona com @lid)
// ============================================================
async function responderPeloPainel(remoteJid, instance) {
    var result = await Swal.fire({
        title: 'Responder',
        input: 'textarea',
        inputLabel: 'Mensagem para o cliente',
        inputPlaceholder: 'Digite sua resposta...',
        showCancelButton: true,
        confirmButtonText: 'Enviar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#10b981',
        inputValidator: function(v) {
            if (!v || v.trim().length < 2) return 'Digite uma mensagem';
        }
    });

    if (!result.isConfirmed) return;

    Swal.fire({ title: 'Enviando...', allowOutsideClick: false, didOpen: function() { Swal.showLoading(); } });

    try {
        var instList = await apiFetch('/instance/list');
        var inst = (instList.instances || []).find(function(i) { return i.instance === instance; });
        var token = inst ? inst.token : '';
        if (!token) return Swal.fire('Erro', 'Token nao encontrado', 'error');

        var res = await apiFetch('/message/send-text', {
            method: 'POST',
            headers: { instance: instance, token: token },
            body: JSON.stringify({
                instance: instance,
                token: token,
                number: remoteJid,
                text: result.value
            })
        });

        if (res.success || res.messageId) {
            Swal.fire({ icon: 'success', title: 'Enviado!', timer: 1500, showConfirmButton: false });
        } else {
            Swal.fire('Erro', res.error || 'Falha ao enviar', 'error');
        }
    } catch (e) {
        Swal.fire('Erro', e.message, 'error');
    }
}

function copiarTelefone(telefone) {
    if (!telefone) return;
    navigator.clipboard.writeText(telefone).then(function() {
        Swal.fire({ icon: 'success', title: 'Copiado!', text: telefone, timer: 2000, showConfirmButton: false });
    }).catch(function() {
        var input = document.createElement('input');
        input.value = telefone;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        Swal.fire({ icon: 'success', title: 'Copiado!', timer: 1500, showConfirmButton: false });
    });
}
