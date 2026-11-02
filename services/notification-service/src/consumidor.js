// Consumidor RabbitMQ com retentativa exponencial e Dead Letter Queue.
import amqp from 'amqplib';

export const TOPOLOGIA = {
  exchange: 'oficina.eventos',
  dlx: 'oficina.eventos.dlx',
  fila: 'notificacoes.whatsapp',
  dlq: 'notificacoes.whatsapp.dlq',
  bindings: ['os.status.*'],
};

// Retorna o que fazer com uma mensagem cujo processamento falhou.
export function decidirFalha(erro, tentativa, { maxTentativas = 5, backoffMs = 2000 } = {}) {
  if (erro?.permanente || erro instanceof SyntaxError) return { acao: 'dlq', motivo: 'erro permanente' };
  if (tentativa >= maxTentativas) return { acao: 'dlq', motivo: `excedeu ${maxTentativas} tentativas` };
  return { acao: 'retentar', atrasoMs: backoffMs * 2 ** (tentativa - 1) };
}

export async function montarTopologia(canal, t = TOPOLOGIA) {
  await canal.assertExchange(t.exchange, 'topic', { durable: true });
  await canal.assertExchange(t.dlx, 'fanout', { durable: true });
  await canal.assertQueue(t.dlq, { durable: true });
  await canal.bindQueue(t.dlq, t.dlx, '');
  await canal.assertQueue(t.fila, { durable: true, deadLetterExchange: t.dlx });
  for (const chave of t.bindings) await canal.bindQueue(t.fila, t.exchange, chave);
}

export function criarConsumidor({ url, processar, opcoesFalha = {}, logger = console, topologia = TOPOLOGIA }) {
  let conexao = null;
  let parado = false;
  let conectado = false;
  let tentativaReconexao = null;

  async function tratarMensagem(canal, msg) {
    const tentativa = (msg.properties.headers?.['x-tentativa'] ?? 0) + 1;
    try {
      const evento = JSON.parse(msg.content.toString('utf8'));
      const resultado = await processar(evento);
      logger.info(`[consumidor] ${msg.fields.routingKey} -> ${resultado.acao}${resultado.motivo ? ` (${resultado.motivo})` : ''}`);
      canal.ack(msg);
    } catch (erro) {
      const decisao = decidirFalha(erro, tentativa, opcoesFalha);
      if (decisao.acao === 'dlq') {
        logger.error(`[consumidor] enviando para DLQ (${decisao.motivo}): ${erro.message}`);
        canal.nack(msg, false, false);
        return;
      }
      logger.warn(`[consumidor] tentativa ${tentativa} falhou (${erro.message}); nova tentativa em ${decisao.atrasoMs}ms`);
      setTimeout(() => {
        try {
          canal.sendToQueue(topologia.fila, msg.content, {
            ...msg.properties,
            headers: { ...msg.properties.headers, 'x-tentativa': tentativa },
          });
          canal.ack(msg);
        } catch (e) {
          logger.warn(`[consumidor] canal fechado, mensagem será reentregue pelo broker: ${e.message}`);
        }
      }, decisao.atrasoMs);
    }
  }

  async function conectar() {
    try {
      conexao = await amqp.connect(url);
      conexao.on('error', (erro) => logger.warn(`[consumidor] erro de conexão: ${erro.message}`));
      conexao.on('close', () => {
        conectado = false;
        if (!parado) agendarReconexao();
      });
      const canal = await conexao.createChannel();
      await canal.prefetch(10);
      await montarTopologia(canal, topologia);
      await canal.consume(topologia.fila, (msg) => msg && tratarMensagem(canal, msg));
      conectado = true;
      logger.info(`[consumidor] aguardando eventos na fila "${topologia.fila}"`);
    } catch (erro) {
      logger.warn(`[consumidor] RabbitMQ indisponível (${erro.message}), tentando novamente...`);
      agendarReconexao();
    }
  }

  function agendarReconexao() {
    if (parado || tentativaReconexao) return;
    tentativaReconexao = setTimeout(() => {
      tentativaReconexao = null;
      conectar();
    }, 3000);
  }

  return {
    iniciar: conectar,
    get conectado() { return conectado; },
    async parar() {
      parado = true;
      clearTimeout(tentativaReconexao);
      try { await conexao?.close(); } catch { /* já fechada */ }
    },
  };
}
