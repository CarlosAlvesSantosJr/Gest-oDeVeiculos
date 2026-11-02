# Modelagem UML

Os diagramas usam [Mermaid](https://mermaid.js.org/), que o GitHub desenha direto na página.

## 1. Casos de uso

```mermaid
flowchart LR
    G([👤 Gerente<br/>celular])
    M([👤 Mecânico / Recepção<br/>painel central])
    C([👤 Cliente])
    W[[WhatsApp<br/>número da oficina ou Cloud API]]

    subgraph Sistema de Gestão da Oficina
        UC1((Cadastrar entrada<br/>do veículo))
        UC2((Atualizar status<br/>do serviço))
        UC3((Registrar entrega))
        UC4((Visualizar painel<br/>em tempo real))
        UC5((Consultar histórico<br/>da OS))
        UC6((Notificar cliente:<br/>veículo pronto))
        UC7((Autenticar gerente))
        UC8((Editar dados<br/>do veículo))
        UC9((Padronizar nomes<br/>próprios))
    end

    G --> UC1
    G --> UC2
    G --> UC3
    G --> UC5
    G --> UC8
    M --> UC4
    UC8 -. include .-> UC7
    UC1 -. include .-> UC9
    UC8 -. include .-> UC9
    UC1 -. include .-> UC7
    UC2 -. include .-> UC7
    UC3 -. include .-> UC7
    UC2 -. extend: status = Pronto .-> UC6
    UC6 --> W --> C
```

## 2. Diagrama de classes (domínio)

```mermaid
classDiagram
    direction LR

    class OrdemServico {
        +UUID id
        +String placa
        +String marca
        +String modelo
        +String cor
        +String servico
        +StatusOS status
        +DateTime criadoEm
        +DateTime atualizadoEm
        +alterarStatus(novo: StatusOS, observacao: String) EventoStatusAlterado
        +editar(dados: Partial~OrdemServico~) EventoDadosAlterados
    }

    class Cliente {
        +String nome
        +String telefone  «E.164»
    }

    class HistoricoStatus {
        +StatusOS statusAnterior
        +StatusOS statusNovo
        +String observacao
        +DateTime ocorridoEm
    }

    class StatusOS {
        <<enumeration>>
        AGUARDANDO_ORCAMENTO
        AGUARDANDO_PECA
        EM_ANDAMENTO
        PRONTO_PARA_ENTREGA
        ENTREGUE
    }

    class EventoOutbox {
        +UUID eventId
        +String tipo
        +String routingKey
        +JSON payload
        +DateTime publicadoEm
        +int tentativas
    }

    class Notificacao {
        +UUID eventId
        +String para
        +String texto
        +String idProvedor
        +StatusEnvio status
    }

    class ProvedorWhatsApp {
        <<interface>>
        +enviar(para, texto, variaveis) id
    }
    class ProvedorMock
    class ProvedorWhatsAppWeb {
        +String numeroPareamento
        +Buffer imagemLogo
        +status() EstadoConexao
        +desconectar()
    }
    class ProvedorCloudApi {
        +String phoneNumberId
        +String template
    }

    OrdemServico "1" *-- "1" Cliente : dados do cliente
    OrdemServico "1" *-- "1..*" HistoricoStatus : histórico
    OrdemServico --> StatusOS
    OrdemServico ..> EventoOutbox : gera
    EventoOutbox ..> Notificacao : consumido como
    ProvedorWhatsApp <|.. ProvedorMock
    ProvedorWhatsApp <|.. ProvedorCloudApi
    ProvedorWhatsApp <|.. ProvedorWhatsAppWeb
    Notificacao ..> ProvedorWhatsApp : enviada por
```

## 3. Máquina de estados do veículo

```mermaid
stateDiagram-v2
    [*] --> AGUARDANDO_ORCAMENTO : entrada do veículo
    AGUARDANDO_ORCAMENTO --> AGUARDANDO_PECA : orçamento aprovado
    AGUARDANDO_ORCAMENTO --> EM_ANDAMENTO : orçamento aprovado (peça em estoque)
    AGUARDANDO_PECA --> EM_ANDAMENTO : peça chegou
    EM_ANDAMENTO --> AGUARDANDO_PECA : faltou peça
    EM_ANDAMENTO --> PRONTO_PARA_ENTREGA : serviço concluído
    PRONTO_PARA_ENTREGA --> EM_ANDAMENTO : retrabalho
    PRONTO_PARA_ENTREGA --> ENTREGUE : cliente retirou
    ENTREGUE --> [*]

    note right of PRONTO_PARA_ENTREGA
        Dispara WhatsApp ao cliente
    end note
```

> Os quatro status do painel podem ir e voltar entre si (a oficina real tem idas e vindas).
> Só um veículo em `PRONTO_PARA_ENTREGA` pode ser `ENTREGUE`, e `ENTREGUE` é estado final.

## 4. Sequência: gerente marca "Pronto para Entrega"

```mermaid
sequenceDiagram
    autonumber
    actor G as Gerente (celular)
    participant GW as API Gateway (nginx)
    participant OS as os-service
    participant DB as SQLite (ordens + outbox)
    participant R as Relay do Outbox
    participant MQ as RabbitMQ
    participant NS as notification-service
    participant WA as WhatsApp (número da oficina)
    participant P as Painel central
    actor C as Cliente

    G->>GW: PATCH /api/ordens/{id}/status {PRONTO_PARA_ENTREGA}<br/>Authorization: Bearer token
    GW->>OS: proxy
    OS->>OS: valida token e transição
    OS->>DB: BEGIN; UPDATE ordens; INSERT historico; INSERT outbox; COMMIT
    OS-->>P: SSE "ordem_atualizada"
    P->>P: move o card para "Pronto para Entrega"
    OS-->>G: 200 OK (ordem atualizada)

    loop a cada 1s
        R->>DB: SELECT eventos pendentes
        R->>MQ: publish oficina.eventos<br/>routing key os.status.PRONTO_PARA_ENTREGA
        MQ-->>R: confirm
        R->>DB: marca como publicado
    end

    MQ->>NS: entrega (fila notificacoes.whatsapp)
    NS->>NS: idempotência (eventId), lista de permitidos e monta mensagem
    NS->>WA: onWhatsApp(número) + envia imagem com logo e legenda
    WA-->>NS: id da mensagem
    NS->>MQ: ack
    WA-->>C: imagem "Seu veículo está PRONTO!" + detalhes (veículo, placa, serviço, retirada)

    alt falha temporária (5xx, 429, rede)
        NS->>MQ: republica com x-tentativa+1 (backoff exponencial)
    else número sem WhatsApp ou tentativas esgotadas
        NS->>MQ: nack → DLX → notificacoes.whatsapp.dlq
    end
```

## 5. Componentes e implantação (Docker)

```mermaid
flowchart TB
    subgraph Dispositivos
        TV[🖥️ TV / monitor<br/>Painel central]
        CEL[📱 Celular do gerente<br/>PWA /gerente]
    end

    subgraph Docker Compose
        GW[gateway<br/>nginx :80 → host :8080<br/>frontend estático + proxy]
        OS[os-service<br/>Node.js :3001<br/>REST + SSE + Outbox]
        NS[notification-service<br/>Node.js :3002<br/>consumidor + WhatsApp]
        VOL2[(volume notification-data<br/>registro + sessão WhatsApp)]
        MQ[(rabbitmq<br/>exchange topic oficina.eventos<br/>DLX + DLQ)]
        VOL[(volume os-data<br/>SQLite)]
    end

    META[[WhatsApp<br/>aparelho vinculado da oficina<br/>ou Meta Cloud API]]

    TV -- HTTP + SSE --> GW
    CEL -- HTTP + SSE --> GW
    GW -- /api/* --> OS
    GW -- /api/notificacoes --> NS
    OS --- VOL
    OS -- publish os.* --> MQ
    MQ -- os.status.* --> NS
    NS --- VOL2
    NS -- WebSocket/HTTPS --> META
```
