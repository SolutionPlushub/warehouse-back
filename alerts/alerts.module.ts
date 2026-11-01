import { Module, Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import IORedis, { type Redis, type RedisOptions } from 'ioredis';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertsProcessor, ALERTS_QUEUE } from './alerts.processor';
import { PrismaModule } from '../prisma/prisma.module';

const logger = new Logger('AlertsModule/Redis');

// Sans listener 'error' explicite, une erreur émise par le client Redis
// sous-jacent (ioredis) — ex: mauvais mot de passe, NOAUTH, connexion
// refusée — remonte comme exception non gérée et fait planter tout le
// process Node, même avec lazyConnect. On logue et on avale l'erreur ici :
// les alertes seront simplement indisponibles tant que Redis n'est pas
// correctement configuré/joignable, jamais une raison de crasher l'API.
function silenceRedisErrors(client: Redis) {
  client.on('error', (err: Error) => {
    logger.warn(
      `Erreur connexion Redis (alertes indisponibles) : ${err.message}`,
    );
  });
  return client;
}

@Module({
  imports: [
    PrismaModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          // Base logique dédiée à YWMS sur le Redis partagé — voir
          // D:\ISTAMCO\infra\redis\README.md pour la table d'attribution.
          db: config.get<number>('REDIS_DB', 0),
          // Démarrage sans bloquer si Redis absent (utile en dev local)
          enableReadyCheck: false,
          maxRetriesPerRequest: null,
          lazyConnect: true,
        },
        createClient: (_type: string, redisOpts: RedisOptions) =>
          silenceRedisErrors(new IORedis(redisOpts)),
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: ALERTS_QUEUE }),
  ],
  controllers: [AlertsController],
  providers: [AlertsService, AlertsProcessor],
  exports: [AlertsService],
})
export class AlertsModule {}
