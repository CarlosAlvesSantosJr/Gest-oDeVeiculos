# Arquitetura

## Visão geral

O sistema é dividido em **microsserviços independentes** que conversam por **REST** (síncrono, para
comandos do usuário) e por **mensageria RabbitMQ** (assíncrono, para efeitos colaterais como o
WhatsApp). Assim, se a Meta ou o serviço de notificação estiverem fora do ar, o gerente continua
atualizando os veículos normalmente e as mensagens são enviadas quando tudo voltar.

| Serviço | Responsabilidade | Tecnologia | Porta interna |
|---|---|---|---|
| `gateway` | Ponto único de entrada: serve o painel e o app do gerente e faz proxy da API | nginx 1.27 | 80 (host 8080) |
| `os-service` | Ordens de Serviço: cadastro, status, histórico, tempo real (SSE) e publicação de eventos | Node.js 24, Express, SQLite (`node:sqlite`) | 3001 |
| `notification-service` | Consome eventos e envia WhatsApp ao cliente | Node.js 24, amqplib | 3002 |
| `rabbitmq` | Broker de mensagens | RabbitMQ 3.13 | 5672 / 15672 |

Cada serviço tem **seus próprios dados** (o `os-service` é dono do banco de OS; o
`notification-service` guarda só o registro dos envios, em SQLite no volume `notification-data`,
que também serve para a idempotência sobreviver a reinícios) e pode ser implantado e escalado separadamente.

## Padrões aplicados

### Transactional Outbox (os-service)
A atualização da OS, o histórico e o evento a publicar são gravados **na mesma transação** SQLite
(tabela `outbox`). Um *relay* lê os eventos pendentes a cada segundo e publica no RabbitMQ com
*publisher confirms*. Só depois da confirmação o evento é marcado como publicado.

- Não existe "salvei a OS mas perdi o evento" nem "publiquei o evento mas a OS não foi salva".
- Se o RabbitMQ cair, os eventos se acumulam no outbox e são enviados na ordem quando ele volta.
  Isso foi visto na prática ao subir o compose: o os-service iniciou antes do broker aceitar
  conexões e publicou tudo assim que conectou.

### Mensageria (RabbitMQ)

```
                    exchange: oficina.eventos (topic, durável)
os-service ──────►  routing keys: os.criada
                                  os.dados.alterados   (edição de placa, marca, modelo, cliente...)
                                  os.status.AGUARDANDO_ORCAMENTO
                                  os.status.AGUARDANDO_PECA
                                  os.status.EM_ANDAMENTO
                                  os.status.PRONTO_PARA_ENTREGA
                                  os.status.ENTREGUE
                          │
                          │ binding "os.status.*"
                          ▼
              fila: notificacoes.whatsapp (durável, x-dead-letter-exchange)
                          │  falha permanente / esgotou tentativas
                          ▼
              exchange: oficina.eventos.dlx (fanout) ──► fila: notificacoes.whatsapp.dlq
```

Formato do evento (JSON, mensagem persistente, `messageId = eventId`):

```json
{
  "eventId": "6f1c…",
  "tipo": "OS_STATUS_ALTERADO",
  "ocorridoEm": "2026-11-02T14:03:11.204Z",
  "dados": {
    "osId": "…", "placa": "MNO7P89", "marca": "Toyota", "modelo": "Corolla XEi", "cor": "Preto",
    "clienteNome": "Diego Rocha", "clienteTelefone": "5511987650004",
    "statusAnterior": "EM_ANDAMENTO", "statusNovo": "PRONTO_PARA_ENTREGA", "observacao": ""
  }
}
```

Garantias do consumidor:
- **At-least-once + idempotência**: o `eventId` já processado é ignorado, então uma reentrega nunca manda WhatsApp duplicado.
- **Retentativa com backoff exponencial** (2s, 4s, 8s, 16s) para erros temporários (HTTP 5xx, 429, falha de rede).
- **Dead Letter Queue** para erros permanentes (número inválido, template inexistente, JSON corrompido) ou após `MAX_TENTATIVAS`.
- **Filtro configurável**: `NOTIFICAR_STATUS=PRONTO_PARA_ENTREGA` (padrão). Para avisar mais etapas, use por exemplo `AGUARDANDO_PECA,PRONTO_PARA_ENTREGA`; já existem mensagens para os 4 status.

### Tempo real (painel central ⇄ celular)
O `os-service` mantém um **hub de Server-Sent Events** (`GET /api/eventos/stream`). Qualquer mudança
feita pelo celular do gerente é enviada na hora para todos os painéis e celulares conectados
(`ordem_criada`, `ordem_atualizada`). O nginx repassa o stream sem buffer. O navegador reconecta
sozinho e, ao reconectar, recarrega o painel inteiro para não perder nada.

> Para rodar **várias réplicas** do os-service, o hub SSE passaria a ouvir os eventos do próprio
> RabbitMQ (uma fila exclusiva por réplica) em vez de emitir em memória.

### Operação pelo celular do gerente
`/gerente` é um **PWA** (pode ser instalado com "Adicionar à tela inicial") feito para telas pequenas:
busca por placa, filtros por status, botões grandes para trocar o status, cadastro de entrada e
confirmação de entrega. As operações de escrita exigem o **código de acesso do gerente**
(`MANAGER_TOKEN`), enviado como `Authorization: Bearer`, com comparação em tempo constante.

**Como acessar do celular:**
1. Mesma rede Wi-Fi: descubra o IP do computador (`ipconfig`) e abra `http://<IP>:8080/gerente` no celular.
2. Fora da oficina: publique o gateway com um túnel HTTPS (ex.: `cloudflared tunnel --url http://localhost:8080`)
   ou implante em um servidor com domínio e TLS.

## WhatsApp Business Cloud API

O provedor `cloud` usa a API oficial da Meta:

```
POST https://graph.facebook.com/v21.0/{WHATSAPP_PHONE_NUMBER_ID}/messages
Authorization: Bearer {WHATSAPP_TOKEN}
```

Passo a passo:
1. Crie um app em <https://developers.facebook.com/> com o produto **WhatsApp**.
2. Copie o **Phone number ID** e gere um **token de acesso permanente** (usuário de sistema).
3. Como a oficina inicia a conversa, a Meta exige um **template aprovado** fora da janela de 24h.
   Crie, por exemplo, o template `veiculo_pronto` (categoria *Utility*, idioma `pt_BR`):
   > Olá, {{1}}! Seu veículo {{2}}, placa {{3}}, está pronto para entrega na {{4}}. Obrigado pela confiança!
4. Configure o `.env`:
   ```env
   WHATSAPP_PROVIDER=cloud
   WHATSAPP_TOKEN=EAAG...
   WHATSAPP_PHONE_NUMBER_ID=1234567890
   WHATSAPP_TEMPLATE_NAME=veiculo_pronto
   ```
5. `docker compose up -d` e marque um veículo como "Pronto para Entrega".

Sem template configurado, o serviço envia mensagem de texto livre (funciona dentro da janela de 24h
ou com números de teste da Meta). Em desenvolvimento o provedor padrão é `mock`, que só registra a
mensagem no log e em `GET /api/notificacoes`.

### Provedor `web`: número da própria oficina

Envia pelo WhatsApp que a oficina já usa, conectado como **aparelho vinculado** (como o WhatsApp Web),
com a biblioteca [Baileys](https://github.com/WhiskeySockets/Baileys). A mensagem de "veículo pronto" vai
como **imagem com a logo da oficina** ([assets/veiculo-pronto.jpg](../services/notification-service/assets/veiculo-pronto.jpg))
e o texto formatado como legenda.

> ⚠️ Não é a API oficial: o WhatsApp proíbe automação de contas comuns e pode bloquear o número em caso
> de envios em massa. Para avisos individuais o risco é baixo; para operação em larga escala use o provedor `cloud`.

```env
WHATSAPP_PROVIDER=web
WHATSAPP_NUMERO_PAREAMENTO=5548999999999   # número da oficina, com DDI 55
WHATSAPP_PERMITIDOS=5548999999999          # modo de teste: só estes números recebem. Vazio = todos
```

Pareamento (uma única vez): no app do gerente toque em **WhatsApp**. A tela mostra um **código de
pareamento** e um **QR code**. No celular da oficina: *WhatsApp → ⋮ → Aparelhos conectados → Conectar
aparelho → Conectar com número de telefone* e digite o código (ou escaneie o QR exibido no computador).
A sessão fica salva no volume `notification-data` e sobrevive a reinícios.

Proteções:
- **Lista de permitidos** (`WHATSAPP_PERMITIDOS`) para testar sem risco de enviar a clientes reais.
- Número sem WhatsApp → erro permanente (DLQ), sem retentativas.
- WhatsApp desconectado → retentativas com backoff (`MAX_TENTATIVAS=8`, `BACKOFF_MS=5000`, cerca de 10 min) e depois DLQ.
- Se a sessão for encerrada pelo celular, o serviço apaga a sessão e volta a pedir pareamento.

## API REST (via gateway)

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/painel` | – | Veículos ativos + contagem por status |
| GET | `/api/ordens[?incluirEntregues=true]` | – | Lista OS |
| GET | `/api/ordens/{id}` | – | Detalhe + histórico |
| POST | `/api/ordens` | gerente | Entrada de veículo |
| PATCH | `/api/ordens/{id}` | gerente | Edita dados: `placa`, `marca`, `modelo`, `cor`, `clienteNome`, `clienteTelefone`, `servico` |
| PATCH | `/api/ordens/{id}/status` | gerente | `{ "status": "...", "observacao": "..." }` |
| POST | `/api/auth/verificar` | gerente | 204 se o código for válido |
| GET | `/api/status` | – | Status e rótulos |
| GET | `/api/eventos/stream` | – | Stream SSE em tempo real |
| GET | `/api/notificacoes[?placa=]` | – | Auditoria dos WhatsApps enviados |
| GET | `/api/whatsapp/status` | gerente | Estado da conexão, número, QR code e código de pareamento |
| POST | `/api/whatsapp/desconectar` | gerente | Encerra a sessão do WhatsApp (pede novo pareamento) |

Erros: `400` validação (com `detalhes`), `401` token, `404` OS inexistente, `409` placa já ativa ou transição inválida.

## Segurança e produção
- Troque `MANAGER_TOKEN` e as credenciais do RabbitMQ no `.env`; nunca faça commit do `.env`.
- Exponha somente o `gateway` (a porta 15672 do RabbitMQ é só para administração local).
- Use HTTPS (túnel ou proxy reverso com TLS) ao acessar pelo celular fora da rede local.
- O painel é somente leitura. Se o painel for público, proteja as rotas GET no gateway (ex.: `auth_basic` ou VPN).
