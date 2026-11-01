import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

interface AuthenticatedSocket extends Socket {
  tenantId?: string;
  userId?: string;
}

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/yard-map',
})
export class YardMapGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(YardMapGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  // ── Connexion ─────────────────────────────────────────────────────────────

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const authToken = client.handshake.auth as Record<string, unknown>;
      const token: string | undefined =
        (typeof authToken?.token === 'string' ? authToken.token : undefined) ??
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify<{ sub: string; tenantId: string }>(
        token,
        { secret: process.env.JWT_ACCESS_SECRET },
      );
      client.tenantId = payload.tenantId;
      client.userId   = payload.sub;

      // Rejoint la room du tenant pour recevoir uniquement ses événements
      await client.join(`tenant:${payload.tenantId}`);
      this.logger.log(`Client ${client.id} connecté (tenant: ${payload.tenantId})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`Client ${client.id} déconnecté`);
  }

  // ── Souscription au bloc (room fine-grained) ──────────────────────────────

  @SubscribeMessage('subscribe:block')
  handleSubscribeBlock(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { block: string },
  ) {
    if (client.tenantId && data?.block) {
      void client.join(`tenant:${client.tenantId}:block:${data.block}`);
    }
  }

  // ── Émission depuis le service ────────────────────────────────────────────

  emitPositionUpdated(
    tenantId: string,
    payload: {
      yardId: string;
      block: string;
      bay: number;
      row: number;
      tier: number;
      isOccupied: boolean;
      containerId: string | null;
    },
  ) {
    // Événement vers tous les clients du tenant
    this.server
      .to(`tenant:${tenantId}`)
      .emit('yard:position:updated', payload);

    // Événement vers les abonnés au bloc spécifique
    this.server
      .to(`tenant:${tenantId}:block:${payload.block}`)
      .emit('yard:position:updated', payload);
  }
}
