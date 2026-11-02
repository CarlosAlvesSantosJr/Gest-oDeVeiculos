// Provedores de envio de WhatsApp.
//  - mock: registra a mensagem localmente (desenvolvimento/testes, sem custo).
//  - cloud: WhatsApp Business Cloud API oficial da Meta (graph.facebook.com).
//  - web: número da própria oficina conectado como aparelho vinculado (ver whatsapp-web.js).
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { criarProvedorWhatsAppWeb } from './whatsapp-web.js';

export class ErroWhatsApp extends Error {
  constructor(mensagem, { httpStatus = null, permanente = false } = {}) {
    super(mensagem);
    this.name = 'ErroWhatsApp';
    this.httpStatus = httpStatus;
    // Erros 4xx (exceto 429) não melhoram com retentativa: número inválido, template inexistente etc.
    this.permanente = permanente;
  }
}

export function criarProvedorMock({ logger = console } = {}) {
  return {
    nome: 'mock',
    async enviar({ para, texto }) {
      const id = `mock-${randomUUID()}`;
      logger.info(`[whatsapp:mock] -> ${para}: ${texto.replace(/\n/g, ' ')}`);
      return { id };
    },
  };
}

export function criarProvedorCloudApi({
  token, phoneNumberId, versao = 'v21.0', template = '', idioma = 'pt_BR', fetchImpl = globalThis.fetch,
}) {
  if (!token || !phoneNumberId) {
    throw new Error('WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID são obrigatórios para o provedor cloud');
  }
  const url = `https://graph.facebook.com/${versao}/${phoneNumberId}/messages`;

  function corpo({ para, texto, variaveis }) {
    // Mensagens iniciadas pela empresa fora da janela de 24h exigem template aprovado.
    if (template) {
      return {
        messaging_product: 'whatsapp',
        to: para,
        type: 'template',
        template: {
          name: template,
          language: { code: idioma },
          components: [{
            type: 'body',
            parameters: (variaveis ?? []).map((v) => ({ type: 'text', text: String(v) })),
          }],
        },
      };
    }
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: para,
      type: 'text',
      text: { preview_url: false, body: texto },
    };
  }

  return {
    nome: 'cloud',
    url,
    corpo,
    async enviar(mensagem) {
      let resposta;
      try {
        resposta = await fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo(mensagem)),
        });
      } catch (erro) {
        throw new ErroWhatsApp(`Falha de rede ao chamar a Cloud API: ${erro.message}`);
      }
      const json = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        const status = resposta.status;
        throw new ErroWhatsApp(json?.error?.message ?? `HTTP ${status}`, {
          httpStatus: status,
          permanente: status >= 400 && status < 500 && status !== 429,
        });
      }
      return { id: json?.messages?.[0]?.id ?? null };
    },
  };
}

export function criarProvedor(env = process.env, { logger = console, fetchImpl, baileys } = {}) {
  const tipo = env.WHATSAPP_PROVIDER ?? 'mock';
  if (tipo === 'web') {
    return criarProvedorWhatsAppWeb({
      pastaSessao: env.WHATSAPP_SESSAO_DIR || './data/whatsapp-sessao',
      numeroPareamento: String(env.WHATSAPP_NUMERO_PAREAMENTO ?? '').replace(/\D/g, ''),
      caminhoImagem: env.WHATSAPP_IMAGEM_PRONTO ?? fileURLToPath(new URL('../assets/veiculo-pronto.jpg', import.meta.url)),
      logger,
      baileys,
    });
  }
  if (tipo === 'cloud') {
    return criarProvedorCloudApi({
      token: env.WHATSAPP_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      versao: env.WHATSAPP_API_VERSION || 'v21.0',
      template: env.WHATSAPP_TEMPLATE_NAME || '',
      idioma: env.WHATSAPP_TEMPLATE_LANG || 'pt_BR',
      fetchImpl,
    });
  }
  return criarProvedorMock({ logger });
}
