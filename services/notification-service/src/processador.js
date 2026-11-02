import { montarMensagem } from './mensagens.js';

// Decide se um evento gera WhatsApp, monta a mensagem e chama o provedor.
export function criarProcessador({ provedor, registro, statusNotificaveis, oficina, horario, logger = console }) {
  return async function processar(evento) {
    if (evento?.tipo !== 'OS_STATUS_ALTERADO') return { acao: 'ignorado', motivo: 'tipo de evento não notificável' };
    const dados = evento.dados ?? {};
    if (!statusNotificaveis.includes(dados.statusNovo)) {
      return { acao: 'ignorado', motivo: `status ${dados.statusNovo} não notificável` };
    }
    if (registro.jaProcessado(evento.eventId)) return { acao: 'duplicado' };

    const base = { eventId: evento.eventId, osId: dados.osId, placa: dados.placa, statusOS: dados.statusNovo };
    if (!dados.clienteTelefone) {
      registro.registrar({ ...base, status: 'SEM_TELEFONE' });
      logger.warn(`[notificacao] OS ${dados.osId} sem telefone do cliente`);
      return { acao: 'ignorado', motivo: 'cliente sem telefone' };
    }

    const { texto, variaveis } = montarMensagem(dados, { oficina, horario });
    try {
      const { id } = await provedor.enviar({ para: dados.clienteTelefone, texto, variaveis });
      registro.registrar({ ...base, para: dados.clienteTelefone, texto, provedor: provedor.nome, idProvedor: id, status: 'ENVIADA' });
      return { acao: 'enviado', id };
    } catch (erro) {
      registro.registrar({ ...base, para: dados.clienteTelefone, texto, provedor: provedor.nome, status: 'FALHA', erro: erro.message });
      throw erro;
    }
  };
}
