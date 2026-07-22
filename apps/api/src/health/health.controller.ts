import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Liveness + readiness probe. Pings the database so a 200 means "the process is
 * up AND can reach Postgres"; if the DB is unreachable it reports 503 rather
 * than pretending to be healthy.
 */
@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: "ok"; db: "up"; timestamp: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.error("Health check failed: database unreachable", error);
      throw new ServiceUnavailableException("database unreachable");
    }
    return { status: "ok", db: "up", timestamp: new Date().toISOString() };
  }
}
