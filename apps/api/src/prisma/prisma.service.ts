import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { type Prisma, PrismaClient } from "@prisma/client";

/**
 * Query events are emitted, never printed. An `emit: "event"` log level costs
 * nothing while nobody listens, so this is always on: it is what lets the
 * Phase-7.3 N+1 tests *count* the statements a request actually issues, and what
 * `PRISMA_LOG_QUERIES` turns into readable output when someone is investigating.
 * Printing every query by default would drown the structured request log.
 */
// `satisfies` rather than `as const`: it keeps the literal types Prisma needs to
// type `$on("query")`, while leaving the array mutable as the options type wants.
const PRISMA_OPTIONS = {
  log: [{ emit: "event", level: "query" }],
} satisfies Prisma.PrismaClientOptions;

/**
 * Thin wrapper that ties the Prisma client to the Nest lifecycle: it connects
 * when the module starts and disconnects on shutdown, so connections are opened
 * and released deterministically rather than lazily on first query.
 */
@Injectable()
export class PrismaService
  extends PrismaClient<typeof PRISMA_OPTIONS>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super(PRISMA_OPTIONS);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Prisma connected");

    if (process.env.PRISMA_LOG_QUERIES === "true") {
      this.$on("query", (event) => {
        this.logger.debug(`${event.duration}ms ${event.query}`);
      });
      this.logger.log("Prisma query logging enabled");
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
