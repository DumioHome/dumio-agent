# Dumio Agent - Documentación

## Descripción

Dumio Agent es un agente inteligente para Home Assistant que permite controlar tu hogar de forma remota a través de la nube de Dumio. Utiliza comunicación WebSocket en tiempo real para una experiencia rápida y fluida.

## Características

- **Conexión WebSocket nativa**: Comunicación en tiempo real con Home Assistant
- **Reconexión automática**: Se recupera automáticamente de desconexiones
- **API REST integrada**: Acceso programático a dispositivos y servicios
- **Soporte Cloud**: Conexión opcional a Dumio Cloud para control remoto
- **Multi-arquitectura**: Soporta amd64, aarch64 y armv7

## Instalación

### Desde el repositorio de addons

1. Ve a **Configuración** > **Add-ons** > **Tienda de Add-ons**
2. Haz clic en los tres puntos (⋮) en la esquina superior derecha
3. Selecciona **Repositorios**
4. Añade la URL del repositorio:
   ```
   https://github.com/DumioHome/dumio-agent
   ```
5. Busca "Dumio Agent" en la tienda
6. Haz clic en **Instalar**

### Configuración inicial

1. Después de instalar, ve a la pestaña **Configuración** del addon
2. Ajusta las opciones según tus necesidades
3. Haz clic en **Guardar**
4. Inicia el addon

## Opciones de configuración

| Opción                   | Descripción                                           | Valores                                | Por defecto     |
| ------------------------ | ----------------------------------------------------- | -------------------------------------- | --------------- |
| `dumio_device_id`        | ID único del dispositivo para identificación en cloud | String o vacío                         | (auto-generado) |
| `log_level`              | Nivel de detalle de logs                              | trace, debug, info, warn, error, fatal | info            |
| `reconnect_interval`     | Tiempo entre intentos de reconexión (ms)              | 1000-60000                             | 5000            |
| `max_reconnect_attempts` | Máximo de intentos de reconexión                      | 1-100                                  | 10              |
| `cloud_socket_url`       | URL del servidor Dumio Cloud                          | URL o vacío                            | (vacío)         |
| `cloud_api_key`          | API Key para Dumio Cloud                              | String o vacío                         | (vacío)         |
| `enable_api`             | Habilitar API REST                                    | true/false                             | true            |

### Dumio Device ID

El `dumio_device_id` es el identificador único del agente en el cloud de Dumio. Este ID se usa para:

- **Identificar el dispositivo**: El cloud verifica si el dispositivo ya existe en la base de datos
- **Reutilizar configuraciones**: Si el ID ya existe, se reutiliza la configuración existente
- **Nuevos dispositivos**: Si el ID no existe, se crea un nuevo registro en el cloud

**IMPORTANTE**: El health reporting hacia el cloud solo se activa si configuras un `dumio_device_id`. Si no lo configuras, el agente funcionará normalmente pero no enviará datos de salud al cloud ni registrará el dispositivo en la tabla `DeviceHealths`.

Esto permite que el cloud controle qué dispositivos existen - si el ID configurado ya existe en el cloud, se reutiliza; si no existe, se crea uno nuevo.

### Ejemplo de configuración

```yaml
dumio_device_id: "dumio-mi-casa-principal"
log_level: info
reconnect_interval: 5000
max_reconnect_attempts: 10
cloud_socket_url: "wss://cloud.dumio.io/agent"
cloud_api_key: "tu-api-key-aqui"
enable_api: true
```

## Conexión a Dumio Cloud

Para usar el control remoto a través de Dumio Cloud:

1. Regístrate en [dumio.io](https://dumio.io) (cuando esté disponible)
2. Obtén tu API Key desde el panel de usuario
3. Configura `cloud_socket_url` y `cloud_api_key` en las opciones del addon
4. Reinicia el addon

## API REST

El addon expone una API REST para integración con otros sistemas. Está disponible a través del ingress de Home Assistant.

### Endpoints disponibles

| Método | Endpoint           | Descripción               |
| ------ | ------------------ | ------------------------- |
| GET    | `/health`          | Estado de salud del addon |
| GET    | `/api/devices`     | Lista de dispositivos     |
| GET    | `/api/devices/:id` | Detalle de un dispositivo |
| GET    | `/api/rooms`       | Lista de habitaciones     |
| POST   | `/api/command`     | Ejecutar comando          |

### Ejemplo de uso

```bash
# Obtener lista de dispositivos
curl -X GET "http://homeassistant.local:3000/api/devices"

# Ejecutar un comando
curl -X POST "http://homeassistant.local:3000/api/command" \
  -H "Content-Type: application/json" \
  -d '{"command": "light.turn_on", "params": {"entity_id": "light.salon"}}'
```

## Solución de problemas

### El addon no se conecta a Home Assistant

1. Verifica que el addon tenga `homeassistant_api: true` habilitado
2. Revisa los logs del addon para más detalles
3. Asegúrate de que Home Assistant esté funcionando correctamente

### No puedo conectar a Dumio Cloud

1. Verifica que `cloud_socket_url` y `cloud_api_key` estén configurados correctamente
2. Comprueba tu conexión a internet
3. Revisa los logs para ver mensajes de error específicos

### El addon se reinicia constantemente

1. Aumenta `max_reconnect_attempts` si tienes una conexión inestable
2. Revisa los logs para identificar el problema
3. Verifica que Home Assistant esté respondiendo

## Logs

Para ver los logs del addon:

1. Ve a **Configuración** > **Add-ons** > **Dumio Agent**
2. Haz clic en la pestaña **Registro**

O usa el siguiente comando:

```bash
ha addons logs dumio_agent
```

Para logs más detallados, cambia `log_level` a `debug` o `trace`.

## Soporte

- **Issues**: [GitHub Issues](https://github.com/DumioHome/dumio-agent/issues)
- **Documentación**: [GitHub Wiki](https://github.com/DumioHome/dumio-agent/wiki)
- **Discord**: [Comunidad Dumio](https://discord.gg/dumio)

## Licencia

Este proyecto está bajo la licencia AGPL. Ver el archivo LICENSE para más detalles.
