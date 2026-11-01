import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import ws from 'ws';

function buildAdapter() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not defined');

  if (url.includes('neon.tech')) {
    neonConfig.webSocketConstructor = ws;
    return new PrismaNeon({ connectionString: url });
  }

  const pool = new pg.Pool({ connectionString: url });
  return new PrismaPg(pool);
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Délai par défaut d'une transaction Prisma = 5 s : sur Neon (latence
    // réseau par requête), une transaction de 50+ conteneurs le dépassait
    // → « Internal server error » (réservation de capacité, placement…).
    super({
      adapter: buildAdapter(),
      transactionOptions: { maxWait: 20_000, timeout: 120_000 },
    });
  }

  async onModuleInit() {
    await this.$connect();
    const isNeon = (process.env.DATABASE_URL ?? '').includes('neon.tech');
    this.logger.log(isNeon ? 'Neon DB connected' : 'PostgreSQL (local) connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

export function buildPrismaClient(): PrismaClient {
  return new PrismaClient({ adapter: buildAdapter() });
}
