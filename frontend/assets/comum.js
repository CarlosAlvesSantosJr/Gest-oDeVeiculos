// Utilitários compartilhados pelo painel central e pelo app do gerente.
export const STATUS = [
  { codigo: 'AGUARDANDO_ORCAMENTO', rotulo: 'Aguardando Orçamento', curto: 'Orçamento', icone: '📋' },
  { codigo: 'AGUARDANDO_PECA', rotulo: 'Aguardando Peça', curto: 'Peça', icone: '📦' },
  { codigo: 'EM_ANDAMENTO', rotulo: 'Em Andamento', curto: 'Andamento', icone: '🔧' },
  { codigo: 'PRONTO_PARA_ENTREGA', rotulo: 'Pronto para Entrega', curto: 'Pronto', icone: '✅' },
];

export const rotuloStatus = (codigo) =>
  STATUS.find((s) => s.codigo === codigo)?.rotulo ?? (codigo === 'ENTREGUE' ? 'Entregue' : codigo);

export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function formatarPlaca(placa) {
  const p = String(placa ?? '').toUpperCase();
  return /^[A-Z]{3}[0-9]{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}

export const OFICINA = 'Mecânica Auto Marcas';

// Espelho de formatarNomeProprio do os-service (services/os-service/src/domain.js), usado para
// corrigir o texto já no formulário. O servidor reaplica a regra e é a fonte da verdade.
const PARTICULAS = new Set(['da', 'das', 'de', 'do', 'dos', 'e', 'di', 'du', 'van', 'von']);
const SIGLAS_VEICULO = new Set(['bmw', 'byd', 'gm', 'gwm', 'jac', 'jmc', 'mg', 'ram', 'ds', 'caoa', 'suv', 'gti', 'gli', 'tsi', 'flex']);
const capitalizar = (p) => p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1).toLocaleLowerCase('pt-BR');

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
    return minuscula.split(/([-'’])/).map((p) => (/^[-'’]$/.test(p) ? p : capitalizar(p))).join('');
  }).join(' ');
}

// 5511987654321 -> (11) 98765-4321
export function formatarTelefone(e164) {
  const d = String(e164 ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return e164 ?? '';
}

export function formatarDataHora(iso) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function marcaHTML() {
  return `<span class="marca-oficina">
    <img src="/assets/logo-192.png" alt="" width="48" height="48">
    <span class="marca-texto"><small>Mecânica</small><b>Auto <em>Marcas</em></b></span>
  </span>`;
}

export function tempoDesde(iso, agora = Date.now()) {
  const min = Math.max(0, Math.floor((agora - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h${min % 60 ? ` ${min % 60}min` : ''}`;
  const d = Math.floor(h / 24);
  return `há ${d} dia${d > 1 ? 's' : ''}`;
}

export function placaHTML(placa, classe = '') {
  return `<span class="placa ${classe}" aria-label="Placa ${esc(placa)}">
    <span class="placa-faixa">BRASIL</span><span class="placa-num">${esc(formatarPlaca(placa))}</span></span>`;
}

// Assina o stream SSE; reconecta sozinho e avisa o estado da conexão.
export function assinarEventos({ aoMudar, aoConectar, aoDesconectar }) {
  let fonte;
  function abrir() {
    fonte = new EventSource('/api/eventos/stream');
    fonte.onopen = () => aoConectar?.();
    fonte.onerror = () => aoDesconectar?.();
    fonte.addEventListener('ordem_criada', (e) => aoMudar('criada', JSON.parse(e.data)));
    fonte.addEventListener('ordem_atualizada', (e) => aoMudar('atualizada', JSON.parse(e.data)));
  }
  abrir();
  return () => fonte?.close();
}
