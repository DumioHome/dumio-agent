import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { Agent } from './Agent.js';
import type { ILogger } from '../domain/ports/ILogger.js';
import type { DeviceFilter } from '../domain/entities/Device.js';
import type { ConnectionState } from '../domain/ports/IHomeAssistantClient.js';

export interface HttpServerConfig {
  port: number;
  host?: string;
}

export interface StatusInfo {
  version: string;
  uptime: number;
  websocket: {
    state: ConnectionState;
    connected: boolean;
    url: string;
  };
  homeAssistant: {
    entityCount: number;
    deviceCount: number;
  };
}

/**
 * HTTP Server for REST API access to the Agent
 */
export class HttpServer {
  private server: ReturnType<typeof createServer> | null = null;
  private startTime: number = Date.now();
  private statusProvider: (() => Promise<StatusInfo>) | null = null;
  
  // Smart cache - only updates when changes are detected
  private statusCache: StatusInfo | null = null;
  private statusCacheTime: number = 0;
  private cacheInvalidated: boolean = true; // Start invalidated to fetch on first request
  private lastConnectionState: ConnectionState = 'disconnected';
  private lastEntityCount: number = 0;
  private lastDeviceCount: number = 0;

  constructor(
    private readonly agent: Agent,
    private readonly logger: ILogger,
    private readonly config: HttpServerConfig
  ) {}

  /**
   * Set status provider function for detailed status info
   */
  setStatusProvider(provider: () => Promise<StatusInfo>): void {
    this.statusProvider = provider;
  }

  /**
   * Invalidate cache - call this when something changes
   */
  invalidateCache(): void {
    this.cacheInvalidated = true;
    this.logger.debug('Status cache invalidated');
  }

  /**
   * Notify of connection state change
   */
  onConnectionChange(state: ConnectionState): void {
    if (state !== this.lastConnectionState) {
      this.lastConnectionState = state;
      this.invalidateCache();
      this.logger.info('Connection state changed, cache invalidated', { state });
    }
  }

  /**
   * Notify of entity/device count change (call periodically or on events)
   */
  onCountsChange(entityCount: number, deviceCount: number): void {
    if (entityCount !== this.lastEntityCount || deviceCount !== this.lastDeviceCount) {
      this.lastEntityCount = entityCount;
      this.lastDeviceCount = deviceCount;
      this.invalidateCache();
      this.logger.debug('Counts changed, cache invalidated', { entityCount, deviceCount });
    }
  }

  /**
   * Get cached status or fetch new one if cache is invalidated
   */
  private async getCachedStatus(): Promise<StatusInfo | null> {
    if (!this.statusProvider) return null;

    // Return cached if not invalidated
    if (this.statusCache && !this.cacheInvalidated) {
      const cacheAge = Math.floor((Date.now() - this.statusCacheTime) / 1000);
      this.logger.debug('Using cached status (no changes detected)', { cacheAgeSeconds: cacheAge });
      return this.statusCache;
    }

    // Fetch new status
    try {
      this.logger.info('Fetching fresh status (cache was invalidated)');
      this.statusCache = await this.statusProvider();
      this.statusCacheTime = Date.now();
      this.cacheInvalidated = false;
      
      // Update tracking values
      this.lastConnectionState = this.statusCache.websocket.state;
      this.lastEntityCount = this.statusCache.homeAssistant.entityCount;
      this.lastDeviceCount = this.statusCache.homeAssistant.deviceCount;
      
      return this.statusCache;
    } catch (error) {
      this.logger.error('Failed to fetch status', error);
      // Return stale cache if available
      return this.statusCache;
    }
  }

  /**
   * Force refresh the status cache
   */
  async refreshStatusCache(): Promise<void> {
    this.invalidateCache();
    await this.getCachedStatus();
  }

  /**
   * Start the HTTP server
   */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.config.port, this.config.host ?? '0.0.0.0', () => {
        this.logger.info('HTTP Server started', {
          port: this.config.port,
          host: this.config.host ?? '0.0.0.0',
        });
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info('HTTP Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    this.logger.debug('HTTP Request', { method, path });

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Route handling
      if (path === '/health' && method === 'GET') {
        return await this.handleHealth(res);
      }

      if (path === '/api/status' && method === 'GET') {
        const forceRefresh = url.searchParams.get('refresh') === 'true';
        return await this.handleStatus(res, forceRefresh);
      }

      if (path === '/api/devices' && method === 'GET') {
        return await this.handleGetDevices(req, res, url);
      }

      if (path === '/api/devices/details' && method === 'GET') {
        return await this.handleGetDevicesWithDetails(req, res, url);
      }

      if (path === '/api/devices/stats' && method === 'GET') {
        return await this.handleGetDeviceStats(res);
      }

      if (path === '/api/rooms' && method === 'GET') {
        return await this.handleGetRooms(res);
      }

      if (path === '/api/rooms/with-devices' && method === 'GET') {
        return await this.handleGetRoomsWithDevices(res);
      }

      if (path.startsWith('/api/rooms/') && method === 'GET') {
        const roomId = path.split('/')[3];
        return await this.handleGetRoom(res, roomId);
      }

      if (path === '/api/home/overview' && method === 'GET') {
        return await this.handleGetHomeOverview(res);
      }

      if (path === '/api/all' && method === 'GET') {
        return await this.handleGetAllData(res);
      }

      if (path === '/api/service/call' && method === 'POST') {
        return await this.handleCallService(req, res);
      }

      if (path === '/api/conversation' && method === 'POST') {
        return await this.handleConversation(req, res);
      }

      if (path === '/api/entities' && method === 'GET') {
        return await this.handleGetEntities(res, url);
      }

      // 404 Not Found
      return this.sendJson(res, 404, { error: 'Not Found', path });

    } catch (error) {
      this.logger.error('HTTP Request error', error);
      return this.sendJson(res, 500, {
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async handleHealth(res: ServerResponse): Promise<void> {
    const status = await this.getCachedStatus();
    
    if (status) {
      const healthy = status.websocket.connected;
      this.sendJson(res, healthy ? 200 : 503, {
        status: healthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        websocket: status.websocket.state,
        uptime: status.uptime,
      });
    } else {
      this.sendJson(res, 200, {
        status: 'healthy',
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleStatus(res: ServerResponse, forceRefresh: boolean = false): Promise<void> {
    // Force refresh if requested
    if (forceRefresh) {
      this.logger.info('Forcing status cache refresh');
      this.invalidateCache();
    }

    const status = await this.getCachedStatus();
    
    if (status) {
      const cacheAge = Math.floor((Date.now() - this.statusCacheTime) / 1000);
      this.sendJson(res, 200, {
        ...status,
        timestamp: new Date().toISOString(),
        cache: {
          type: 'smart',
          description: 'Updates only when changes are detected',
          ageSeconds: cacheAge,
          invalidated: this.cacheInvalidated,
          wasRefreshed: forceRefresh,
        },
      });
    } else {
      this.sendJson(res, 200, {
        status: 'running',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
      });
    }
  }

  private async handleGetDevices(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const filter = this.parseDeviceFilter(url);
    const devices = await this.agent.getDevices(filter);
    this.sendJson(res, 200, { devices, count: devices.length });
  }

  private async handleGetDevicesWithDetails(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const filter = this.parseDeviceFilter(url);
    const devices = await this.agent.getDevicesWithDetails(filter);
    this.sendJson(res, 200, { devices, count: devices.length });
  }

  private async handleGetDeviceStats(res: ServerResponse): Promise<void> {
    const stats = await this.agent.getDeviceStats();
    this.sendJson(res, 200, stats);
  }

  private async handleGetRooms(res: ServerResponse): Promise<void> {
    const rooms = await this.agent.getRooms();
    this.sendJson(res, 200, { rooms, count: rooms.length });
  }

  private async handleGetRoomsWithDevices(res: ServerResponse): Promise<void> {
    const rooms = await this.agent.getRoomsWithDevices();
    this.sendJson(res, 200, { rooms, count: rooms.length });
  }

  private async handleGetRoom(res: ServerResponse, roomId: string): Promise<void> {
    const room = await this.agent.getRoom(roomId);
    if (!room) {
      return this.sendJson(res, 404, { error: 'Room not found', roomId });
    }
    this.sendJson(res, 200, room);
  }

  private async handleGetHomeOverview(res: ServerResponse): Promise<void> {
    const overview = await this.agent.getHomeOverview();
    this.sendJson(res, 200, overview);
  }

  private async handleGetAllData(res: ServerResponse): Promise<void> {
    const data = await this.agent.getAllMappedData();
    this.sendJson(res, 200, data);
  }

  private async handleCallService(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.parseBody<{
      domain: string;
      service: string;
      entityId?: string | string[];
      data?: Record<string, unknown>;
    }>(req);

    if (!body.domain || !body.service) {
      return this.sendJson(res, 400, { error: 'domain and service are required' });
    }

    const result = await this.agent.callService(body.domain, body.service, body.entityId, body.data);
    this.sendJson(res, 200, result);
  }

  private async handleConversation(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.parseBody<{
      text: string;
      conversationId?: string;
    }>(req);

    if (!body.text) {
      return this.sendJson(res, 400, { error: 'text is required' });
    }

    const result = await this.agent.processConversation(body.text, body.conversationId);
    this.sendJson(res, 200, result);
  }

  private async handleGetEntities(res: ServerResponse, url: URL): Promise<void> {
    const domain = url.searchParams.get('domain');
    const entityId = url.searchParams.get('entityId');

    if (entityId) {
      const entities = await this.agent.getState(entityId);
      this.sendJson(res, 200, { entities, count: entities.length });
    } else if (domain) {
      const entities = await this.agent.getEntitiesByDomain(domain);
      this.sendJson(res, 200, { entities, count: entities.length });
    } else {
      const entities = await this.agent.getState();
      this.sendJson(res, 200, { entities, count: entities.length });
    }
  }

  private parseDeviceFilter(url: URL): DeviceFilter | undefined {
    const roomId = url.searchParams.get('roomId');
    const type = url.searchParams.get('type');
    const isOnline = url.searchParams.get('isOnline');
    const isOn = url.searchParams.get('isOn');
    const search = url.searchParams.get('search');
    const onlyPhysical = url.searchParams.get('onlyPhysical');
    const includeAll = url.searchParams.get('includeAll');
    const integration = url.searchParams.get('integration');
    const integrations = url.searchParams.get('integrations');
    const manufacturer = url.searchParams.get('manufacturer');

    const filter: DeviceFilter = {};

    if (roomId) filter.roomId = roomId;
    if (type) filter.type = type as any;
    if (isOnline !== null) filter.isOnline = isOnline === 'true';
    if (isOn !== null) filter.isOn = isOn === 'true';
    if (search) filter.search = search;
    
    // By default onlyPhysical is true, but can be disabled
    if (onlyPhysical !== null) filter.onlyPhysical = onlyPhysical === 'true';
    if (includeAll !== null) filter.includeAll = includeAll === 'true';
    
    // Integration filters (tuya, zha, zigbee2mqtt, mqtt, hue, etc.)
    if (integration) filter.integration = integration;
    if (integrations) filter.integrations = integrations.split(',').map((s) => s.trim());
    if (manufacturer) filter.manufacturer = manufacturer;

    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  private parseBody<T>(req: IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          reject(new Error('Invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }
}
