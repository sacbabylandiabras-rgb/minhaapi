# ZAPI Clone 🚀

API WhatsApp multi-tenant inspirada na Z-API. Construída com Baileys + Fastify + BullMQ + PostgreSQL + Redis.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| WhatsApp | Baileys (protocolo nativo) |
| API REST | Fastify + TypeScript |
| Fila de mensagens | BullMQ + Redis |
| Banco de dados | PostgreSQL + Prisma |
| Sessões | Sistema de arquivos + Redis |
| Infraestrutura | Docker Compose |

---

## Início rápido

### 1. Clone e configure

```bash
cp .env.example .env
# Edite o .env com sua API_KEY
```

### 2. Suba com Docker

```bash
docker-compose up -d
```

### 3. Rode as migrations

```bash
docker-compose exec app npx prisma migrate deploy
```

---

## Endpoints

### 🔐 Autenticação

- **Admin routes** → header `x-api-key: SUA_MASTER_API_KEY`
- **Instance routes** → header `x-api-key: TOKEN_DA_INSTANCIA`

---

### Instâncias

#### Criar instância
```http
POST /api/v1/instances
x-api-key: MASTER_KEY

{
  "name": "minha-loja",
  "webhookUrl": "https://meusite.com/webhook",
  "webhookToken": "token-secreto"
}
```

**Resposta:**
```json
{
  "id": "uuid",
  "name": "minha-loja",
  "token": "token-da-instancia",
  "status": "CONNECTING"
}
```

#### Listar instâncias
```http
GET /api/v1/instances
x-api-key: MASTER_KEY
```

#### Obter QR Code
```http
GET /api/v1/instances/minha-loja/qrcode
x-api-key: TOKEN_DA_INSTANCIA
```

**Resposta:**
```json
{
  "connected": false,
  "qrCode": "2@xxx...",
  "qrCodeBase64": "data:image/png;base64,..."
}
```

#### Status da instância
```http
GET /api/v1/instances/minha-loja
x-api-key: TOKEN_DA_INSTANCIA
```

#### Reiniciar instância
```http
POST /api/v1/instances/minha-loja/restart
x-api-key: TOKEN_DA_INSTANCIA
```

#### Desconectar
```http
POST /api/v1/instances/minha-loja/disconnect
x-api-key: TOKEN_DA_INSTANCIA
```

#### Atualizar webhook
```http
PATCH /api/v1/instances/minha-loja/webhook
x-api-key: TOKEN_DA_INSTANCIA

{
  "webhookUrl": "https://novo-url.com/webhook",
  "webhookToken": "novo-token"
}
```

#### Deletar instância
```http
DELETE /api/v1/instances/minha-loja
x-api-key: MASTER_KEY
```

---

### Mensagens

#### Enviar texto
```http
POST /api/v1/instances/minha-loja/messages/text
x-api-key: TOKEN_DA_INSTANCIA

{
  "phone": "5511999999999",
  "message": "Olá! Como posso te ajudar?",
  "delayMs": 1000
}
```

#### Enviar imagem
```http
POST /api/v1/instances/minha-loja/messages/image
x-api-key: TOKEN_DA_INSTANCIA

{
  "phone": "5511999999999",
  "url": "https://exemplo.com/imagem.jpg",
  "caption": "Veja esta imagem!"
}
```

#### Enviar vídeo
```http
POST /api/v1/instances/minha-loja/messages/video
x-api-key: TOKEN_DA_INSTANCIA

{
  "phone": "5511999999999",
  "url": "https://exemplo.com/video.mp4",
  "caption": "Confira este vídeo"
}
```

#### Enviar áudio
```http
POST /api/v1/instances/minha-loja/messages/audio
x-api-key: TOKEN_DA_INSTANCIA

{
  "phone": "5511999999999",
  "url": "https://exemplo.com/audio.ogg",
  "ptt": true
}
```

#### Enviar documento
```http
POST /api/v1/instances/minha-loja/messages/document
x-api-key: TOKEN_DA_INSTANCIA

{
  "phone": "5511999999999",
  "url": "https://exemplo.com/arquivo.pdf",
  "fileName": "contrato.pdf",
  "mimetype": "application/pdf"
}
```

#### Enviar localização
```http
POST /api/v1/instances/minha-loja/messages/location
x-api-key: TOKEN_DA_INSTANCIA

{
  "phone": "5511999999999",
  "lat": -23.5505,
  "lon": -46.6333,
  "name": "São Paulo, SP"
}
```

#### Enviar reação
```http
POST /api/v1/instances/minha-loja/messages/reaction
x-api-key: TOKEN_DA_INSTANCIA

{
  "phone": "5511999999999",
  "messageId": "ABCD1234",
  "emoji": "👍"
}
```

#### Marcar como lido
```http
POST /api/v1/instances/minha-loja/messages/read
x-api-key: TOKEN_DA_INSTANCIA

{
  "phone": "5511999999999",
  "messageId": "ABCD1234"
}
```

#### Indicador de digitação
```http
POST /api/v1/instances/minha-loja/presence
x-api-key: TOKEN_DA_INSTANCIA

{
  "phone": "5511999999999",
  "presence": "composing"
}
```

#### Listar mensagens
```http
GET /api/v1/instances/minha-loja/messages?phone=5511999999999&page=1&limit=50
x-api-key: TOKEN_DA_INSTANCIA
```

---

### Contato / Perfil

#### Verificar se número existe no WhatsApp
```http
GET /api/v1/instances/minha-loja/check-number?phone=5511999999999
x-api-key: TOKEN_DA_INSTANCIA
```

#### Foto de perfil
```http
GET /api/v1/instances/minha-loja/profile-picture?phone=5511999999999
x-api-key: TOKEN_DA_INSTANCIA
```

---

### Webhook

Quando configurado, sua URL recebe eventos neste formato:

```json
{
  "event": "message.received",
  "instanceId": "uuid",
  "instanceName": "minha-loja",
  "timestamp": 1719000000000,
  "data": {
    "key": { "remoteJid": "5511999999999@s.whatsapp.net", "fromMe": false, "id": "MSG_ID" },
    "pushName": "João",
    "message": { "type": "text", "text": "Olá!" },
    "messageTimestamp": 1719000000
  }
}
```

**Eventos disponíveis:**
- `qr.updated` — novo QR Code gerado
- `connection.update` — mudança de status da conexão
- `message.received` — mensagem recebida
- `message.sent` — mensagem enviada
- `message.ack` — confirmação de entrega/leitura
- `presence.update` — atualização de presença

---

## Desenvolvimento local

```bash
npm install
cp .env.example .env

# Suba apenas postgres e redis
docker-compose up postgres redis -d

# Rode as migrations
npx prisma migrate dev

# Inicie o servidor
npm run dev
```

---

## Estrutura do projeto

```
src/
├── config/          # Configurações da aplicação
├── controllers/     # Rotas HTTP (Fastify)
├── middlewares/     # Autenticação
├── queues/          # Workers BullMQ (mensagens + webhooks)
├── services/        # Lógica de negócio (InstanceManager, Prisma)
├── types/           # Tipos TypeScript
├── utils/           # Helpers (logger, redis, phone)
└── server.ts        # Entry point
prisma/
└── schema.prisma    # Schema do banco
```
