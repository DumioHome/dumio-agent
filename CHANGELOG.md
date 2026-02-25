# Changelog

Todos los cambios notables en este proyecto serán documentados en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/lang/es/).

## [1.3.1] - 2026-02-24

### Agregado

- Fix config json

## [1.3.0] - 2026-02-24

### Agregado

- Feature add new endpoint for devices

## [1.2.2] - 2026-02-24

### Agregado

- Fix error with entity tupes domain

## [1.2.1] - 2026-02-24

### Agregado

- Add all oficial devices by entity_id

## [1.2.0] - 2026-02-23

### Agregado

- Acept new devices for cloud

## [1.1.3] - 2026-02-10

### Agregado

- Fix name devices

## [1.1.2] - 2026-02-10

### Agregado

- Fix update name

## [1.1.1] - 2026-02-10

### Agregado

- Fix update

## [1.1.0] - 2026-02-10

### Agregado

- Se agrego modificacion del friendly name al device por cloud

## [1.0.2] - 2026-02-06

### Agregado

- Se agrego conexión con sensor power

## [1.0.0] - 2026-01-31

### Agregado

- Conexión WebSocket con Home Assistant
- Reconexión automática con backoff exponencial
- Suscripción a eventos y cambios de estado en tiempo real
- API REST para control de dispositivos
- Soporte para Dumio Cloud (conexión remota)
- Clean Architecture (Domain, Application, Infrastructure, Presentation)
- Tests unitarios con Vitest
- Logging estructurado con Pino
- Soporte multi-arquitectura: amd64, aarch64, armv7
- Watchdog para reinicio automático en caso de fallo
- Ingress para acceso web a través de Home Assistant UI
- Health check endpoint para monitoreo
- Documentación completa en español e inglés

### Casos de uso implementados

- `ConnectToHomeAssistant`: Conexión y autenticación WebSocket
- `CallService`: Llamadas a servicios de Home Assistant
- `GetEntityState`: Consulta de estados de entidades
- `GetDevices`: Obtención de dispositivos agrupados
- `GetRooms`: Obtención de áreas/habitaciones
- `ProcessConversation`: Procesamiento de comandos de voz/texto
- `SubscribeToEvents`: Suscripción a eventos en tiempo real

### Modos de operación

- **Addon de Home Assistant**: Integración nativa con autenticación automática
- **Standalone**: Ejecución independiente con configuración por variables de entorno
- **Docker**: Contenedores pre-construidos para múltiples arquitecturas

## [Unreleased]

### Por venir

- Soporte para webhooks
- Automatizaciones basadas en reglas
- Panel de administración web
- Métricas y telemetría
- Integración con asistentes de voz
