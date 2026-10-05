import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { getWebSocketCorsOrigins } from "../config/cors.config";

/**
 * Interface pour les données de mise à jour de heat
 */
export interface HeatUpdateData {
  competitionId: string;
  eventId: string;
  heatNumber?: number;
  currentDancers?: string[];
  status?: string;
}

/**
 * Interface pour les données de résultat publié
 */
export interface ResultPublishedData {
  competitionId: string;
  eventId: string;
  results: Array<{
    userId: string;
    ranking: number;
    score?: number;
  }>;
}

/** Bucket de rate limiting par socket (sliding window) */
interface RateLimitBucket {
  count: number;
  resetAt: number;
}

/** 10 messages max par minute par socket */
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 60_000; // ms

@WebSocketGateway({
  cors: {
    // Restreindre les origines WebSocket depuis l'env (cohérent avec le CORS HTTP)
    origin: getWebSocketCorsOrigins(),
    credentials: true,
  },
  namespace: "live",
})
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private logger: Logger = new Logger("LiveGateway");

  /** Map socketId → bucket de rate limiting */
  private readonly rateLimitMap = new Map<string, RateLimitBucket>();

  constructor(private readonly jwtService: JwtService) {}

  handleConnection(client: Socket) {
    const token =
      (client.handshake.auth as Record<string, string> | undefined)?.token ??
      client.handshake.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      this.logger.warn(`Client ${client.id} disconnected: missing token`);
      client.disconnect(true);
      return;
    }

    try {
      this.jwtService.verify(token);
      this.logger.log(`Client connected: ${client.id}`);
    } catch {
      this.logger.warn(`Client ${client.id} disconnected: invalid token`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    // Nettoyage du bucket pour éviter les fuites mémoire
    this.rateLimitMap.delete(client.id);
  }

  /**
   * Vérifie si le client dépasse la limite de messages WebSocket.
   * @returns true si la limite est atteinte (bloquer), false sinon
   */
  private isRateLimited(socketId: string): boolean {
    const now = Date.now();
    const bucket = this.rateLimitMap.get(socketId);

    if (!bucket || now >= bucket.resetAt) {
      this.rateLimitMap.set(socketId, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW,
      });
      return false;
    }

    if (bucket.count >= RATE_LIMIT_MAX) {
      return true;
    }

    bucket.count++;
    return false;
  }

  @SubscribeMessage("joinCompetition")
  async handleJoinCompetition(
    @ConnectedSocket() client: Socket,
    @MessageBody() competitionId: string,
  ) {
    if (this.isRateLimited(client.id)) {
      this.logger.warn(`Rate limit exceeded for client: ${client.id}`);
      return { event: "error", data: "Too many requests. Please slow down." };
    }

    this.logger.log(
      `Client ${client.id} joining competition: ${competitionId}`,
    );
    await client.join(`competition_${competitionId}`);
    return { event: "joined", data: competitionId };
  }

  @SubscribeMessage("leaveCompetition")
  async handleLeaveCompetition(
    @ConnectedSocket() client: Socket,
    @MessageBody() competitionId: string,
  ) {
    if (this.isRateLimited(client.id)) {
      this.logger.warn(`Rate limit exceeded for client: ${client.id}`);
      return { event: "error", data: "Too many requests. Please slow down." };
    }

    this.logger.log(
      `Client ${client.id} leaving competition: ${competitionId}`,
    );
    await client.leave(`competition_${competitionId}`);
    return { event: "left", data: competitionId };
  }

  // Helper methods to broadcast from services
  broadcastHeatUpdate(competitionId: string, data: HeatUpdateData): void {
    this.server.to(`competition_${competitionId}`).emit("heat_update", data);
  }

  broadcastDelayUpdate(competitionId: string, delayMinutes: number): void {
    this.server.to(`competition_${competitionId}`).emit("delay_update", {
      competitionId,
      delayMinutes,
    });
  }

  broadcastResultPublished(
    competitionId: string,
    data: ResultPublishedData,
  ): void {
    this.server
      .to(`competition_${competitionId}`)
      .emit("result_published", data);
  }
}
