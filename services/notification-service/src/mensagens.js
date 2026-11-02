// Modelos das mensagens de WhatsApp enviadas ao cliente, por status.
// "variaveis" segue a ordem dos parâmetros {{1}}, {{2}}... de um template aprovado na Meta.

function primeiroNome(nome) {
  return String(nome ?? '').trim().split(/\s+/)[0] || 'cliente';
}

function formatarPlaca(placa) {
  const p = String(placa ?? '').toUpperCase();
  return /^[A-Z]{3}[0-9]{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}

const MODELOS = {
  PRONTO_PARA_ENTREGA: ({ nome, veiculo, placa, servico, oficina, horario }) => [
    `*${oficina.toUpperCase()}* 🔧`,
    '',
    `Olá, *${nome}*! Tudo bem?`,
    '',
    'Temos uma ótima notícia: o seu veículo está *pronto para retirada*. ✅',
    '',
    `🚗 *Veículo:* ${veiculo}`,
    `🔖 *Placa:* ${placa}`,
    ...(servico ? [`🛠️ *Serviço:* ${servico}`] : []),
    '',
    `🕗 *Retirada:* ${horario}.`,
    '',
    'Se tiver qualquer dúvida, é só responder esta mensagem.',
    'Agradecemos a confiança!',
    '',
    `_Equipe ${oficina}_`,
  ].join('\n'),
  AGUARDANDO_ORCAMENTO: ({ nome, veiculo, placa, oficina }) =>
    `Olá, ${nome}! Recebemos seu veículo ${veiculo}, placa ${placa}, na ${oficina}. `
    + 'Em breve enviaremos o orçamento.',
  AGUARDANDO_PECA: ({ nome, veiculo, placa, oficina }) =>
    `Olá, ${nome}! O serviço do seu ${veiculo} (${placa}) está aguardando a chegada de peças na ${oficina}. `
    + 'Avisaremos assim que retomarmos.',
  EM_ANDAMENTO: ({ nome, veiculo, placa, oficina }) =>
    `Olá, ${nome}! O serviço do seu ${veiculo} (${placa}) está em andamento na ${oficina}. 🔧`,
};

export function statusSuportados() {
  return Object.keys(MODELOS);
}

export function montarMensagem(dados, { oficina = 'nossa oficina', horario = 'em nosso horário de atendimento' } = {}) {
  const modelo = MODELOS[dados.statusNovo];
  if (!modelo) throw new Error(`Sem modelo de mensagem para o status ${dados.statusNovo}`);
  const contexto = {
    nome: primeiroNome(dados.clienteNome),
    veiculo: `${dados.marca} ${dados.modelo}`.trim(),
    placa: formatarPlaca(dados.placa),
    servico: String(dados.servico ?? '').trim(),
    oficina,
    horario,
  };
  return {
    texto: modelo(contexto),
    variaveis: [contexto.nome, contexto.veiculo, contexto.placa, contexto.oficina],
  };
}
