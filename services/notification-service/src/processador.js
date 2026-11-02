import { montarMensagem } from './mensagens.js';

// Forma canônica de um celular brasileiro, com o 9 inicial: 554898760000 e 5548998760000 são o mesmo número.
export function telefoneCanonico(numero) {
  const d = String(numero ?? '').replace(/\D/g, '');
  return d.length === 12 && d.startsWith('55') && /[6-9]/.test(d[4]) ? `${d.slice(0, 4)}9${d.slice(4)}` : d;
}

// Decide se um evento gera WhatsApp, monta a mensagem e chama o provedor.
// "permitidos": se informado, só esses números recebem mensagens (modo de teste seguro).
export function criarProcessador({
  provedor, registro, statusNotificaveis, oficina, horario, permitidos = [], logger = console,
}) {
  const listaPermitidos = new Set(permitidos.map(telefoneCanonico));
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
    if (listaPermitidos.size && !listaPermitidos.has(telefoneCanonico(dados.clienteTelefone))) {
      registro.registrar({ ...base, para: dados.clienteTelefone, texto, provedor: provedor.nome, status: 'NAO_PERMITIDO' });
      logger.warn(`[notificacao] ${dados.clienteTelefone} fora da lista WHATSAPP_PERMITIDOS; mensagem não enviada`);
      return { acao: 'ignorado', motivo: 'número fora da lista de permitidos' };
    }
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
