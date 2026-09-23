const io = require('socket.io-client');
const fs = require('fs');
const readline = require('readline');

const SERVER_URL = 'https://zapwarm.com.br/zapwarm-api/';
const PHONE_NUMBER = '5515998295029'; // Seu número

console.log('🚀 Conectando ao servidor WebSocket...');
console.log(`🔗 URL: ${SERVER_URL}`);

const socket = io(SERVER_URL, {
  transports: ['websocket'],
  reconnection: true,
  reconnectionAttempts: 5,
  timeout: 10000
});

// Para debug
socket.on('connect', () => {
  console.log('✅ Conectado ao WebSocket!');
  console.log('📱 Solicitando código de pareamento...');
  
  const instanceName = `whatsapp_${Date.now()}`;
  
  socket.emit('pairing_request', {
    instance: instanceName,
    phoneNumber: PHONE_NUMBER
  });
  
  console.log(`🏷️  Instância: ${instanceName}`);
});

// Receber o código de pareamento
socket.on('pairing_code', (data) => {
  console.log('\n🔐 =======================================');
  console.log('📲 CÓDIGO DE PAREAMENTO:');
  console.log(`   ⭐ ${data.code} ⭐`);
  console.log('=======================================\n');
  console.log(`📱 Instância: ${data.instance}`);
  console.log(`🔑 Token: ${data.token}`);
  console.log(`📱 Número: ${PHONE_NUMBER}`);
  console.log('\n⚠️  INSTRUÇÕES:');
  console.log(`1. Abra o WhatsApp no número ${PHONE_NUMBER}`);
  console.log('2. Vá em: Configurações > Dispositivos vinculados > Vincular dispositivo');
  console.log(`3. Digite o código: ${data.code}`);
  console.log('4. Aguarde a confirmação\n');
  
  // Salvar configuração
  const configFile = `instancia_${data.instance}.json`;
  fs.writeFileSync(configFile, JSON.stringify({
    instance: data.instance,
    token: data.token,
    code: data.code,
    phone: PHONE_NUMBER,
    createdAt: new Date().toISOString()
  }, null, 2));
  
  console.log(`💾 Configuração salva em: ${configFile}`);
});

// Quando conectar com sucesso
socket.on('connected', (data) => {
  console.log('\n🎉 ========================================');
  console.log('✅ SUCESSO! WhatsApp conectado!');
  console.log('=========================================\n');
  console.log(`🏷️  Instância: ${data.instance}`);
  console.log('📱 Agora você pode enviar mensagens via API!');
  console.log('\nExemplo de uso:');
  console.log('curl -X POST https://zapbulkapi-baileys-whatsapp-server.y7nagi.easypanel.host/message/send-text \\');
  console.log('  -H "instance: sua_instancia" \\');
  console.log('  -H "token: seu_token" \\');
  console.log('  -H "Content-Type: application/json" \\');
  console.log('  -d \'{"number":"5515999999999","text":"Olá mundo!"}\'');
  console.log('\n');
  
  process.exit(0);
});

// Eventos de status
socket.on('status', (data) => {
  console.log(`📡 Status: ${data.status}`);
});

socket.on('disconnect', (reason) => {
  console.log(`🔌 Desconectado: ${reason}`);
});

// Erros
socket.on('error', (error) => {
  console.error('❌ Erro do servidor:', error.message || error);
});

socket.on('connect_error', (error) => {
  console.error('❌ Erro de conexão:', error.message);
  console.log('🔄 Tentando reconectar...');
});

// Timeout de 60 segundos
const timeout = setTimeout(() => {
  console.log('\n⏰ Timeout: Não foi possível gerar o código em 60 segundos');
  console.log('📋 Verifique:');
  console.log('  1. Se o servidor está online');
  console.log('  2. Se o número está correto');
  console.log('  3. Se o servidor aceita conexões WebSocket');
  process.exit(1);
}, 60000);

// Limpar timeout ao conectar
socket.on('pairing_code', () => {
  clearTimeout(timeout);
});

// Função para enviar mensagem após conectar
const sendTestMessage = async (instance, token) => {
  try {
    const response = await fetch(`${SERVER_URL}/message/send-text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'instance': instance,
        'token': token
      },
      body: JSON.stringify({
        number: '5515998295029', // Seu próprio número para teste
        text: '✅ Conexão estabelecida com sucesso via WebSocket!'
      })
    });
    
    const result = await response.json();
    console.log('📨 Mensagem de teste enviada:', result);
  } catch (error) {
    console.error('❌ Erro ao enviar mensagem de teste:', error.message);
  }
};

// Registrar função para quando conectar
socket.on('connected', (data) => {
  // Já está tratado acima
});