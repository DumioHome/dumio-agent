# Dumio Agent

Agente para Home Assistant que utiliza WebSocket para comunicación en tiempo real. Implementado con Clean Architecture en Node.js/TypeScript.

## Características

- Conexión WebSocket con Home Assistant
- Reconexión automática
- Suscripción a eventos y cambios de estado
- Llamadas a servicios
- API de conversación para comandos de voz/texto
- Clean Architecture (Domain, Application, Infrastructure, Presentation)
- Tests unitarios con Vitest
- Logging estructurado con Pino

## Estructura del Proyecto

```
src/
├── domain/                    # Capa de dominio
│   ├── entities/              # Entidades del dominio
│   │   ├── HomeAssistantMessage.ts
│   │   ├── Entity.ts
│   │   └── AgentIntent.ts
│   └── ports/                 # Interfaces/Contratos
│       ├── IHomeAssistantClient.ts
│       ├── ILogger.ts
│       └── IConversationService.ts
├── application/               # Capa de aplicación
│   └── use-cases/             # Casos de uso
│       ├── ConnectToHomeAssistant.ts
│       ├── CallService.ts
│       ├── GetEntityState.ts
│       ├── ProcessConversation.ts
│       └── SubscribeToEvents.ts
├── infrastructure/            # Capa de infraestructura
│   ├── websocket/             # Cliente WebSocket
│   │   └── HomeAssistantClient.ts
│   ├── logging/               # Implementación de logging
│   │   └── PinoLogger.ts
│   └── config/                # Configuración
│       └── Config.ts
├── presentation/              # Capa de presentación
│   └── Agent.ts               # Clase principal del agente
└── index.ts                   # Entry point
```

## Requisitos

- Node.js >= 20.0.0
- Home Assistant con WebSocket API habilitada
- Long-lived access token de Home Assistant

## Instalación

```bash
# Clonar el repositorio
git clone <repository-url>
cd dumio-agent

# Instalar dependencias
npm install

# Copiar archivo de configuración
cp .env.example .env
```

## Configuración

Edita el archivo `.env` con tus credenciales de Home Assistant:

```env
# Home Assistant Configuration
HA_URL=ws://homeassistant.local:8123/api/websocket
HA_ACCESS_TOKEN=your_long_lived_access_token_here

# Agent Configuration
AGENT_NAME=dumio-agent
LOG_LEVEL=info

# Reconnection settings
RECONNECT_INTERVAL=5000
MAX_RECONNECT_ATTEMPTS=10
```

### Obtener Long-lived Access Token

1. Ve a tu instancia de Home Assistant
2. Haz clic en tu perfil (esquina inferior izquierda)
3. Desplázate hasta "Long-Lived Access Tokens"
4. Crea un nuevo token y cópialo al archivo `.env`

## Uso

### Ejecutar en desarrollo

```bash
npm run dev
```

### Compilar y ejecutar

```bash
npm run build
npm start
```

### Ejecutar tests

```bash
# Ejecutar tests una vez
npm test

# Ejecutar tests en modo watch
npm run test:watch

# Ejecutar tests con coverage
npm run test:coverage
```

## Uso Programático

```typescript
import { Agent, HomeAssistantClient, PinoLogger } from 'dumio-agent';

// Crear logger
const logger = new PinoLogger({
  name: 'my-agent',
  level: 'info',
  pretty: true,
});

// Crear cliente de Home Assistant
const haClient = new HomeAssistantClient(
  {
    url: 'ws://homeassistant.local:8123/api/websocket',
    accessToken: 'your_token_here',
  },
  logger
);

// Crear agente
const agent = new Agent(haClient, logger, {
  name: 'my-agent',
  subscribeOnConnect: true,
});

// Iniciar agente con handlers
await agent.start({
  onStateChange: (entityId, oldState, newState) => {
    console.log(`${entityId}: ${oldState?.state} -> ${newState.state}`);
  },
  onConnectionChange: (state) => {
    console.log(`Connection: ${state}`);
  },
});

// Usar el agente
await agent.turnOnLight('light.living_room');
await agent.setTemperature('climate.thermostat', 22);

const lights = await agent.getEntitiesByDomain('light');
console.log('Lights:', lights);

// Procesar comandos de voz/texto
const response = await agent.processConversation('Turn off all lights');
console.log('Response:', response.speech);

// Detener agente
await agent.stop();
```

## API del Agente

### Métodos principales

| Método | Descripción |
|--------|-------------|
| `start(handlers?)` | Inicia el agente y conecta a Home Assistant |
| `stop()` | Detiene el agente y desconecta |
| `callService(domain, service, entityId?, data?)` | Llama a un servicio |
| `getState(entityId?)` | Obtiene el estado de entidades |
| `getEntitiesByDomain(domain)` | Obtiene entidades por dominio |
| `processConversation(text, conversationId?)` | Procesa comando de voz/texto |

### Métodos de conveniencia

| Método | Descripción |
|--------|-------------|
| `turnOnLight(entityId, brightness?)` | Enciende una luz |
| `turnOffLight(entityId)` | Apaga una luz |
| `toggleLight(entityId)` | Alterna una luz |
| `turnOnSwitch(entityId)` | Enciende un switch |
| `turnOffSwitch(entityId)` | Apaga un switch |
| `setTemperature(entityId, temperature)` | Configura temperatura |
| `runScript(entityId)` | Ejecuta un script |
| `activateScene(entityId)` | Activa una escena |

## Casos de Uso

El proyecto implementa los siguientes casos de uso:

- **ConnectToHomeAssistant**: Conecta al WebSocket de Home Assistant
- **CallService**: Llama a servicios de Home Assistant
- **GetEntityState**: Obtiene estados de entidades con filtros
- **ProcessConversation**: Procesa comandos de voz/texto
- **SubscribeToEvents**: Suscribe a eventos en tiempo real

## Home Assistant Add-on

Este proyecto está preparado para instalarse como add-on nativo de Home Assistant.

### Instalación del Add-on

1. Ve a **Configuración** > **Add-ons** > **Tienda de Add-ons**
2. Haz clic en los tres puntos (⋮) en la esquina superior derecha
3. Selecciona **Repositorios**
4. Añade la URL del repositorio:
   ```
   https://github.com/yourusername/dumio-agent
   ```
5. Busca "Dumio Agent" en la tienda
6. Haz clic en **Instalar**
7. Configura las opciones según necesites
8. Haz clic en **Iniciar**

### Configuración del Add-on

Las opciones disponibles en la configuración del add-on:

```yaml
log_level: info           # trace, debug, info, warn, error, fatal
reconnect_interval: 5000  # ms entre intentos de reconexión
max_reconnect_attempts: 10
```

### Ventajas del Add-on

- **Autenticación automática**: Usa el token del Supervisor, no necesitas configurar credenciales
- **Integración nativa**: Se gestiona desde la UI de Home Assistant
- **Actualizaciones**: Recibe actualizaciones automáticas
- **Logs integrados**: Ve los logs directamente en la interfaz de Home Assistant
- **Watchdog**: Se reinicia automáticamente si falla

### Estructura del Add-on

```
dumio-agent/
├── config.yaml       # Configuración del add-on
├── build.yaml        # Configuración de build multi-arch
├── Dockerfile        # Dockerfile optimizado para HA
├── run.sh            # Script de inicio con bashio
├── DOCS.md           # Documentación del add-on
├── CHANGELOG.md      # Historial de cambios
├── translations/     # Traducciones
│   ├── en.yaml
│   └── es.yaml
└── src/              # Código fuente
```

### Arquitecturas soportadas

- amd64 (x86_64)
- aarch64 (ARM64, Raspberry Pi 4)
- armv7 (ARM32, Raspberry Pi 3)
- armhf (ARM hard float)
- i386 (x86 32-bit)

## Docker (Standalone)

### Construcción de la imagen

```bash
# Construir imagen de producción
docker build -t dumio-agent .

# Construir imagen de desarrollo
docker build -f Dockerfile.dev -t dumio-agent:dev .
```

### Ejecutar con Docker

```bash
# Ejecutar directamente con Docker
docker run -d \
  --name dumio-agent \
  --restart unless-stopped \
  -e HA_URL=ws://homeassistant.local:8123/api/websocket \
  -e HA_ACCESS_TOKEN=your_token_here \
  -e LOG_LEVEL=info \
  --network homeassistant \
  dumio-agent
```

### Ejecutar con Docker Compose

```bash
# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales

# Crear la red si no existe
docker network create homeassistant

# Ejecutar en producción
docker-compose up -d dumio-agent

# Ejecutar en desarrollo (con hot reload)
docker-compose --profile dev up dumio-agent-dev

# Ver logs
docker-compose logs -f dumio-agent

# Detener
docker-compose down
```

### Configuración de red

Si Home Assistant está en Docker, asegúrate de que ambos contenedores estén en la misma red:

```yaml
# En tu docker-compose de Home Assistant, añade:
networks:
  homeassistant:
    name: homeassistant
```

Si Home Assistant está en el host, usa la URL del host:

```env
# Linux
HA_URL=ws://host.docker.internal:8123/api/websocket

# O usa la IP del host
HA_URL=ws://192.168.1.100:8123/api/websocket
```

### Recursos y límites

El contenedor está configurado con límites de recursos por defecto:
- CPU: máximo 0.5 cores
- Memoria: máximo 256MB

Puedes ajustar estos valores en `docker-compose.yml`.

## Integración con Home Assistant

Este agente puede integrarse con Home Assistant de varias formas:

1. **Como servicio standalone**: Ejecuta comandos y reacciona a eventos
2. **Como bridge**: Conecta otros servicios con Home Assistant
3. **Como agente de conversación**: Procesa comandos de voz/texto
4. **Como contenedor Docker**: Despliega junto a Home Assistant en Docker

## Licencia

MIT
