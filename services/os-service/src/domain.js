// Regras de negócio das Ordens de Serviço (OS) da oficina.

export const STATUS = Object.freeze({
  AGUARDANDO_ORCAMENTO: 'AGUARDANDO_ORCAMENTO',
  AGUARDANDO_PECA: 'AGUARDANDO_PECA',
  EM_ANDAMENTO: 'EM_ANDAMENTO',
  PRONTO_PARA_ENTREGA: 'PRONTO_PARA_ENTREGA',
  ENTREGUE: 'ENTREGUE',
});

export const STATUS_LABEL = Object.freeze({
  AGUARDANDO_ORCAMENTO: 'Aguardando Orçamento',
  AGUARDANDO_PECA: 'Aguardando Peça',
  EM_ANDAMENTO: 'Em Andamento',
  PRONTO_PARA_ENTREGA: 'Pronto para Entrega',
  ENTREGUE: 'Entregue',
});

// Status exibidos no painel central (ENTREGUE sai do quadro).
export const STATUS_PAINEL = [
  STATUS.AGUARDANDO_ORCAMENTO,
  STATUS.AGUARDANDO_PECA,
  STATUS.EM_ANDAMENTO,
  STATUS.PRONTO_PARA_ENTREGA,
];

export class ValidationError extends Error {
  constructor(mensagem, detalhes = []) {
    super(mensagem);
    this.name = 'ValidationError';
    this.httpStatus = 400;
    this.detalhes = detalhes;
  }
}

export class NotFoundError extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'NotFoundError';
    this.httpStatus = 404;
  }
}

export class ConflictError extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ConflictError';
    this.httpStatus = 409;
  }
}

// Placa antiga (ABC1234) ou Mercosul (ABC1D23).
const PLACA_RE = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

export function normalizarPlaca(placa) {
  return String(placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function placaValida(placa) {
  return PLACA_RE.test(normalizarPlaca(placa));
}

// Converte telefone brasileiro para o formato E.164 sem "+" exigido pelo WhatsApp (ex.: 5511987654321).
export function normalizarTelefone(telefone) {
  const digitos = String(telefone ?? '').replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) return digitos;
  return null;
}

function texto(valor, max) {
  return String(valor ?? '').trim().slice(0, max);
}

export function validarNovaOS(entrada = {}) {
  const erros = [];
  const placa = normalizarPlaca(entrada.placa);
  const marca = texto(entrada.marca, 40);
  const modelo = texto(entrada.modelo, 60);
  const clienteNome = texto(entrada.clienteNome, 80);
  const servico = texto(entrada.servico, 500);
  const cor = texto(entrada.cor, 30);
  const status = entrada.status ?? STATUS.AGUARDANDO_ORCAMENTO;

  if (!PLACA_RE.test(placa)) erros.push('placa inválida (use ABC1234 ou ABC1D23)');
  if (!marca) erros.push('marca é obrigatória');
  if (!modelo) erros.push('modelo é obrigatório');
  if (!clienteNome) erros.push('clienteNome é obrigatório');

  let clienteTelefone = null;
  if (entrada.clienteTelefone) {
    clienteTelefone = normalizarTelefone(entrada.clienteTelefone);
    if (!clienteTelefone) erros.push('clienteTelefone inválido (use DDD + número)');
  } else {
    erros.push('clienteTelefone é obrigatório para avisos por WhatsApp');
  }

  if (!STATUS_PAINEL.includes(status)) erros.push(`status inicial inválido: ${status}`);

  if (erros.length) throw new ValidationError('Dados da ordem de serviço inválidos', erros);
  return { placa, marca, modelo, cor, clienteNome, clienteTelefone, servico, status };
}

export function validarTransicao(statusAtual, statusNovo) {
  if (!Object.values(STATUS).includes(statusNovo)) {
    throw new ValidationError(`Status desconhecido: ${statusNovo}`, [
      `valores aceitos: ${Object.values(STATUS).join(', ')}`,
    ]);
  }
  if (statusAtual === STATUS.ENTREGUE) {
    throw new ConflictError('Ordem de serviço já foi entregue e está encerrada');
  }
  if (statusAtual === statusNovo) {
    throw new ConflictError(`Veículo já está em "${STATUS_LABEL[statusNovo]}"`);
  }
  if (statusNovo === STATUS.ENTREGUE && statusAtual !== STATUS.PRONTO_PARA_ENTREGA) {
    throw new ConflictError('Só é possível entregar um veículo que está Pronto para Entrega');
  }
}
