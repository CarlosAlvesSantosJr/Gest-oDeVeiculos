import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ESTADO, criarProvedorWhatsAppWeb } from '../src/whatsapp-web.js';
import { ErroWhatsApp } from '../src/whatsapp.js';

const silencioso = { info() {}, warn() {}, error() {} };
const esperarEventos = () => new Promise((r) => setTimeout(r, 20));
async function aguardar(condicao, timeoutMs = 3000) {
  const limite = Date.now() + timeoutMs;
  while (!condicao()) {
    if (Date.now() > limite) throw new Error('timeout aguardando condição');
    await new Promise((r) => setTimeout(r, 10));
  }
}

// Simula o socket do Baileys para testar sem conexão real com o WhatsApp.
function baileysFalso({ registrado = false, numerosComWhatsApp = ['5548999990000'] } = {}) {
  const ctx = { sockets: [], enviados: [], pareamentos: [], logout: 0 };
  ctx.baileys = {
    logger: {},
    DisconnectReason: { loggedOut: 401 },
    Browsers: { macOS: (b) => ['Mac OS', b, '1'] },
    useMultiFileAuthState: async () => ({ state: { creds: { registered: registrado } }, saveCreds: () => {} }),
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
    makeWASocket: (opcoes) => {
      const sock = {
        opcoes,
        ev: new EventEmitter(),
        authState: opcoes.auth,
        user: { id: '5548999990000:12@s.whatsapp.net' },
        requestPairingCode: async (n) => { ctx.pareamentos.push(n); return 'ABCD1234'; },
        onWhatsApp: async (jid) => {
          const n = jid.split('@')[0];
          return numerosComWhatsApp.includes(n) ? [{ exists: true, jid }] : [];
        },
        sendMessage: async (jid, conteudo) => { ctx.enviados.push({ jid, conteudo }); return { key: { id: 'MSG1' } }; },
        logout: async () => { ctx.logout += 1; },
        end: () => {},
      };
      ctx.sockets.push(sock);
      return sock;
    },
  };
  return ctx;
}

let pasta;
let imagem;
beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), 'wa-'));
  imagem = join(pasta, 'pronto.jpg');
  writeFileSync(imagem, Buffer.from([0xff, 0xd8, 0xff]));
});

test('gera QR code e código de pareamento pelo número da oficina', async () => {
  const ctx = baileysFalso();
  const p = criarProvedorWhatsAppWeb({ pastaSessao: join(pasta, 's'), numeroPareamento: '5548999990000', baileys: ctx.baileys, logger: silencioso });
  await p.iniciar();
  ctx.sockets[0].ev.emit('connection.update', { qr: 'conteudo-do-qr' });
  await aguardar(() => p.status().codigoPareamento);
  const s = p.status();
  assert.equal(s.estado, ESTADO.AGUARDANDO_PAREAMENTO);
  assert.match(s.qr, /^data:image\/png;base64,/);
  assert.equal(s.codigoPareamento, 'ABCD-1234');
  assert.deepEqual(ctx.pareamentos, ['5548999990000']);
  await p.parar();
});

test('ao conectar, envia imagem com a logo e a mensagem como legenda', async () => {
  const ctx = baileysFalso({ registrado: true });
  const p = criarProvedorWhatsAppWeb({ pastaSessao: join(pasta, 's'), caminhoImagem: imagem, baileys: ctx.baileys, logger: silencioso });
  await p.iniciar();
  ctx.sockets[0].ev.emit('connection.update', { connection: 'open' });
  await esperarEventos();
  assert.equal(p.status().estado, ESTADO.CONECTADO);
  assert.equal(p.status().numero, '+55 48 99999-0000');

  const r = await p.enviar({ para: '5548999990000', texto: 'Seu veículo está pronto' });
  assert.equal(r.id, 'MSG1');
  const [{ jid, conteudo }] = ctx.enviados;
  assert.equal(jid, '5548999990000@s.whatsapp.net');
  assert.equal(conteudo.caption, 'Seu veículo está pronto');
  assert.ok(Buffer.isBuffer(conteudo.image));
  await p.parar();
});

test('sem imagem disponível, envia apenas texto', async () => {
  const ctx = baileysFalso({ registrado: true });
  const p = criarProvedorWhatsAppWeb({ pastaSessao: join(pasta, 's'), caminhoImagem: join(pasta, 'nao-existe.jpg'), baileys: ctx.baileys, logger: silencioso });
  await p.iniciar();
  ctx.sockets[0].ev.emit('connection.update', { connection: 'open' });
  await esperarEventos();
  await p.enviar({ para: '5548999990000', texto: 'oi' });
  assert.deepEqual(ctx.enviados[0].conteudo, { text: 'oi' });
  await p.parar();
});

test('número sem WhatsApp gera erro permanente; desconectado gera erro temporário', async () => {
  const ctx = baileysFalso({ registrado: true });
  const p = criarProvedorWhatsAppWeb({ pastaSessao: join(pasta, 's'), baileys: ctx.baileys, logger: silencioso });
  await p.iniciar();
  await assert.rejects(p.enviar({ para: '5548999990000', texto: 'x' }), (e) => e instanceof ErroWhatsApp && !e.permanente);
  ctx.sockets[0].ev.emit('connection.update', { connection: 'open' });
  await esperarEventos();
  await assert.rejects(p.enviar({ para: '5511900000000', texto: 'x' }), (e) => e instanceof ErroWhatsApp && e.permanente);
  await p.parar();
});

test('reconecta automaticamente quando a conexão cai', async () => {
  const ctx = baileysFalso({ registrado: true });
  const p = criarProvedorWhatsAppWeb({ pastaSessao: join(pasta, 's'), baileys: ctx.baileys, logger: silencioso, atrasoReconexaoMs: 5 });
  await p.iniciar();
  ctx.sockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 515 } } } });
  await esperarEventos();
  assert.equal(ctx.sockets.length, 2, 'abriu um novo socket');
  assert.equal(p.status().estado, ESTADO.DESCONECTADO);
  await p.parar();
});
