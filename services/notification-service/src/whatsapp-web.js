// Provedor "web": envia pelo número da própria oficina, conectado como aparelho vinculado
// (WhatsApp > Aparelhos conectados), usando o protocolo do WhatsApp Web via Baileys.
// Atenção: não é a API oficial; use com moderação (avisos individuais a clientes).
import { readFileSync, rmSync } from 'node:fs';
import QRCode from 'qrcode';
import { ErroWhatsApp } from './whatsapp.js';

export const ESTADO = Object.freeze({
  INICIANDO: 'iniciando',
  AGUARDANDO_PAREAMENTO: 'aguardando_pareamento',
  CONECTADO: 'conectado',
  DESCONECTADO: 'desconectado',
});

async function carregarBaileys() {
  const [baileys, { default: pino }] = await Promise.all([import('@whiskeysockets/baileys'), import('pino')]);
  return { ...baileys, makeWASocket: baileys.makeWASocket ?? baileys.default, logger: pino({ level: 'silent' }) };
}

function formatarNumero(jid) {
  const d = String(jid ?? '').split(/[:@]/)[0];
  return d.length >= 12 ? `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, -4)}-${d.slice(-4)}` : d;
}

export function criarProvedorWhatsAppWeb({
  pastaSessao,
  numeroPareamento = '',
  caminhoImagem = '',
  logger = console,
  baileys = null, // injetável nos testes
  atrasoReconexaoMs = 3000,
}) {
  let sock = null;
  let parado = false;
  let imagem = null;
  const status = { estado: ESTADO.INICIANDO, numero: null, qr: null, codigoPareamento: null, atualizadoEm: null };

  if (caminhoImagem) {
    try { imagem = readFileSync(caminhoImagem); } catch (erro) { logger.warn(`[whatsapp:web] imagem não carregada: ${erro.message}`); }
  }

  function atualizar(parcial) {
    Object.assign(status, parcial, { atualizadoEm: new Date().toISOString() });
  }

  async function conectar() {
    const b = baileys ?? (baileys = await carregarBaileys());
    const { state, saveCreds } = await b.useMultiFileAuthState(pastaSessao);
    let version;
    try { ({ version } = await b.fetchLatestBaileysVersion()); } catch { /* usa a versão embutida */ }

    sock = b.makeWASocket({
      version,
      auth: state,
      logger: b.logger,
      browser: b.Browsers?.macOS?.('Chrome') ?? ['Mac OS', 'Chrome', '14.4.1'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    const atual = sock;
    atual.ev.on('creds.update', saveCreds);
    atual.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (atual !== sock) return;
      if (qr) {
        atualizar({ estado: ESTADO.AGUARDANDO_PAREAMENTO, qr: await QRCode.toDataURL(qr, { margin: 1, width: 320 }) });
        if (numeroPareamento && !atual.authState?.creds?.registered && !status.codigoPareamento) {
          try {
            const codigo = await atual.requestPairingCode(numeroPareamento);
            atualizar({ codigoPareamento: codigo?.match(/.{1,4}/g)?.join('-') ?? codigo });
            logger.info(`[whatsapp:web] código de pareamento para ${numeroPareamento}: ${status.codigoPareamento}`);
          } catch (erro) {
            logger.warn(`[whatsapp:web] não foi possível gerar código de pareamento: ${erro.message}`);
          }
        }
      }
      if (connection === 'open') {
        atualizar({ estado: ESTADO.CONECTADO, numero: formatarNumero(atual.user?.id), qr: null, codigoPareamento: null });
        logger.info(`[whatsapp:web] conectado como ${status.numero}`);
      }
      if (connection === 'close') {
        const codigo = lastDisconnect?.error?.output?.statusCode;
        const deslogado = codigo === b.DisconnectReason?.loggedOut;
        atualizar({ estado: ESTADO.DESCONECTADO, qr: null, codigoPareamento: null });
        if (deslogado) {
          logger.warn('[whatsapp:web] sessão encerrada no celular; será necessário parear novamente');
          rmSync(pastaSessao, { recursive: true, force: true });
        } else {
          logger.warn(`[whatsapp:web] conexão fechada (código ${codigo ?? '?'}), reconectando...`);
        }
        if (!parado) setTimeout(() => conectar().catch((e) => logger.error(`[whatsapp:web] ${e.message}`)), atrasoReconexaoMs);
      }
    });
  }

  return {
    nome: 'web',
    async iniciar() {
      parado = false;
      await conectar();
    },
    async parar() {
      parado = true;
      try { sock?.end?.(undefined); } catch { /* já fechado */ }
    },
    status: () => ({ provedor: 'web', ...status, comImagem: Boolean(imagem) }),
    async desconectar() {
      try { await sock?.logout(); } catch { /* força nova sessão mesmo assim */ }
    },
    async enviar({ para, texto }) {
      if (status.estado !== ESTADO.CONECTADO || !sock) {
        throw new ErroWhatsApp('WhatsApp da oficina não está conectado');
      }
      let destino;
      try {
        [destino] = await sock.onWhatsApp(`${para}@s.whatsapp.net`);
      } catch (erro) {
        throw new ErroWhatsApp(`Falha ao consultar número no WhatsApp: ${erro.message}`);
      }
      if (!destino?.exists) {
        throw new ErroWhatsApp(`O número ${para} não tem WhatsApp`, { permanente: true });
      }
      const conteudo = imagem ? { image: imagem, caption: texto, mimetype: 'image/jpeg' } : { text: texto };
      try {
        const msg = await sock.sendMessage(destino.jid, conteudo);
        return { id: msg?.key?.id ?? null };
      } catch (erro) {
        throw new ErroWhatsApp(`Falha ao enviar pelo WhatsApp: ${erro.message}`);
      }
    },
  };
}
