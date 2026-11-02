// Relay do Transactional Outbox: lê eventos pendentes e publica no broker.
// Garante entrega "at-least-once" mesmo se o RabbitMQ estiver fora do ar no momento da alteração.
export function criarRelayOutbox({ repo, publicar, intervaloMs = 1000, lote = 50, logger = console }) {
  let timer = null;
  let executando = false;

  async function processar() {
    if (executando) return 0;
    executando = true;
    let publicados = 0;
    try {
      for (const item of repo.outboxPendentes(lote)) {
        try {
          await publicar(item.routingKey, item.evento);
          repo.marcarPublicado(item.id);
          publicados += 1;
        } catch (erro) {
          repo.registrarFalha(item.id);
          logger.warn(`[outbox] falha ao publicar ${item.routingKey} (${item.id}): ${erro.message}`);
          break; // preserva a ordem: tenta de novo no próximo ciclo
        }
      }
    } finally {
      executando = false;
    }
    return publicados;
  }

  return {
    processar,
    iniciar() {
      if (!timer) timer = setInterval(() => { processar().catch(() => {}); }, intervaloMs);
    },
    parar() {
      clearInterval(timer);
      timer = null;
    },
  };
}
