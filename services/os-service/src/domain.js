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
// Celular digitado sem o 9 inicial (8 dígitos começando em 6-9) recebe o 9: (48) 9876-0000 -> 5548998760000.
export function normalizarTelefone(telefone) {
  let digitos = String(telefone ?? '').replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;
  if (!((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55'))) return null;
  if (digitos.length === 12 && /[6-9]/.test(digitos[4])) digitos = `${digitos.slice(0, 4)}9${digitos.slice(4)}`;
  return digitos;
}

function texto(valor, max) {
  return String(valor ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

// Preposições e conjunções que ficam minúsculas no meio de nomes próprios ("Maria da Silva").
const PARTICULAS = new Set(['da', 'das', 'de', 'do', 'dos', 'e', 'di', 'du', 'van', 'von']);

function capitalizar(parte) {
  return parte.charAt(0).toLocaleUpperCase('pt-BR') + parte.slice(1).toLocaleLowerCase('pt-BR');
}

// Siglas de montadoras e versões que devem ficar sempre em maiúsculas.
const SIGLAS_VEICULO = new Set(['bmw', 'byd', 'gm', 'gwm', 'jac', 'jmc', 'mg', 'ram', 'ds', 'caoa', 'suv', 'gti', 'gli', 'tsi', 'flex']);

// Primeira letra maiúscula em cada palavra de um nome próprio.
// - Texto todo em maiúsculas ou minúsculas é sempre reformatado ("ANA SOUZA" -> "Ana Souza").
// - Em texto com caixa mista, siglas e grafias intencionais são preservadas ("Corolla XEi").
// - tipo "pessoa": preposições ficam minúsculas ("Maria da Silva").
// - tipo "veiculo": palavras com números, sem vogais ou siglas conhecidas ficam em maiúsculas ("HB20", "Onix LTZ", "BMW").
export function formatarNomeProprio(valor, { tipo = 'pessoa' } = {}) {
  const limpo = String(valor ?? '').trim().replace(/\s+/g, ' ');
  const temLetra = /\p{L}/u.test(limpo);
  const caixaUnica = limpo === limpo.toLocaleUpperCase('pt-BR') || limpo === limpo.toLocaleLowerCase('pt-BR');

  return limpo.split(' ').map((palavra, indice) => {
    if (!temLetra) return palavra;
    const minuscula = palavra.toLocaleLowerCase('pt-BR');
    if (tipo === 'veiculo' && (/\d/.test(palavra) || SIGLAS_VEICULO.has(minuscula)
      || (/^\p{L}{2,4}$/u.test(palavra) && !/[aeiouáéíóúâêôãõy]/i.test(palavra)))) {
      return palavra.toLocaleUpperCase('pt-BR');
    }
    if (tipo === 'pessoa' && indice > 0 && PARTICULAS.has(minuscula)) return minuscula;
    if (!caixaUnica && /\p{Lu}/u.test(palavra.slice(1))) return palavra;
    // Trata nomes compostos e com apóstrofo: "maria-clara" -> "Maria-Clara", "d'ávila" -> "D'Ávila".
    return minuscula.split(/([-'’])/).map((p) => (/^[-'’]$/.test(p) ? p : capitalizar(p))).join('');
  }).join(' ');
}

const NOME_PESSOA_RE = /^[\p{L}][\p{L}\s.'’-]*$/u;

// Valida e normaliza os campos de dados da OS. Em modo parcial, só os campos enviados são tratados.
function validarCampos(entrada, { parcial }) {
  const erros = [];
  const dados = {};
  const informado = (campo) => !parcial || entrada[campo] !== undefined;

  if (informado('placa')) {
    dados.placa = normalizarPlaca(entrada.placa);
    if (!PLACA_RE.test(dados.placa)) erros.push('placa inválida (use ABC1234 ou ABC1D23)');
  }
  if (informado('marca')) {
    dados.marca = formatarNomeProprio(texto(entrada.marca, 40), { tipo: 'veiculo' });
    if (!dados.marca) erros.push('marca é obrigatória');
  }
  if (informado('modelo')) {
    dados.modelo = formatarNomeProprio(texto(entrada.modelo, 60), { tipo: 'veiculo' });
    if (!dados.modelo) erros.push('modelo é obrigatório');
  }
  if (informado('cor')) {
    dados.cor = formatarNomeProprio(texto(entrada.cor, 30), { tipo: 'veiculo' });
  }
  if (informado('clienteNome')) {
    dados.clienteNome = formatarNomeProprio(texto(entrada.clienteNome, 80));
    if (!dados.clienteNome) erros.push('clienteNome é obrigatório');
    else if (!NOME_PESSOA_RE.test(dados.clienteNome) || dados.clienteNome.replace(/[^\p{L}]/gu, '').length < 2) {
      erros.push('clienteNome deve conter apenas letras (mínimo 2)');
    }
  }
  if (informado('clienteTelefone')) {
    if (entrada.clienteTelefone) {
      dados.clienteTelefone = normalizarTelefone(entrada.clienteTelefone);
      if (!dados.clienteTelefone) erros.push('clienteTelefone inválido (use DDD + número)');
    } else {
      erros.push('clienteTelefone é obrigatório para avisos por WhatsApp');
    }
  }
  if (informado('servico')) {
    dados.servico = texto(entrada.servico, 500);
  }
  return { dados, erros };
}

export function validarNovaOS(entrada = {}) {
  const { dados, erros } = validarCampos(entrada, { parcial: false });
  const status = entrada.status ?? STATUS.AGUARDANDO_ORCAMENTO;
  if (!STATUS_PAINEL.includes(status)) erros.push(`status inicial inválido: ${status}`);
  if (erros.length) throw new ValidationError('Dados da ordem de serviço inválidos', erros);
  return { ...dados, status };
}

export const CAMPOS_EDITAVEIS = ['placa', 'marca', 'modelo', 'cor', 'clienteNome', 'clienteTelefone', 'servico'];

export function validarEdicaoOS(entrada = {}) {
  const desconhecidos = Object.keys(entrada ?? {}).filter((c) => !CAMPOS_EDITAVEIS.includes(c));
  const { dados, erros } = validarCampos(entrada ?? {}, { parcial: true });
  if (desconhecidos.length) erros.push(`campos não editáveis: ${desconhecidos.join(', ')}`);
  if (!erros.length && !Object.keys(dados).length) erros.push('nenhum campo para alterar');
  if (erros.length) throw new ValidationError('Dados da edição inválidos', erros);
  return dados;
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
