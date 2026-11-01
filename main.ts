import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Derrière Traefik : l'IP réelle du client est dans X-Forwarded-For. Sans
  // ce réglage, toutes les requêtes semblaient venir du proxy et la limite de
  // débit (ThrottlerGuard) était PARTAGÉE par tous les utilisateurs — les
  // traitements de lots (sorties, ajouts) échouaient en 429.
  app.set('trust proxy', 1);

  // ── Cookies (JWT httpOnly) ────────────────────────────────────────────────
  app.use(cookieParser(process.env.COOKIE_SECRET));

  // ── Validation globale des DTOs ───────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  // ── CORS ──────────────────────────────────────────────────────────────────
  // FRONTEND_URL accepte une liste d'origines séparées par des virgules (ex:
  // "https://warehouse-dev.solution-plus.es,http://localhost:3000") — un seul
  // déploiement backend peut ainsi servir plusieurs fronts (env de dev
  // déployé + dev local contre la même API), sans reprovisionner à chaque
  // nouvel environnement front.
  const allowedOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ── Préfixe global ────────────────────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ── Swagger (document partagé avec ReDoc) ────────────────────────────────
  // La description complète est visible dans ReDoc (/api/redoc)
  const swaggerConfig = new DocumentBuilder()
    .setTitle('YWMS API — Solution+ ILS')
    .setDescription(
      `API REST de la suite logistique YWMS. Documentation complète sur [/api/redoc](/api/redoc).`,
    )
    .setVersion('1.0')
    .addServer('http://localhost:3001', 'Développement local')
    .addCookieAuth(
      'access_token',
      { type: 'apiKey', in: 'cookie', name: 'access_token' },
      'cookie-auth',
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer-auth',
    )
    .addTag('Auth')
    .addTag('Tenants')
    .addTag('Users')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // ── Swagger UI — /api/docs ────────────────────────────────────────────────
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      filter: true,
      showRequestDuration: true,
      tryItOutEnabled: true,
      withCredentials: true, // envoie les cookies automatiquement
    },
    customSiteTitle: 'YWMS API Docs',
    customCss: `
      .swagger-ui .topbar { display: none; }
      .swagger-ui .information-container { display: none; }
      .swagger-ui .scheme-container { background: #F8FAFC; padding: 12px 24px; border-radius: 8px; margin: 16px 0; }
      .swagger-ui .btn.authorize { border-color: #0050A0; color: #0050A0; font-weight: 600; }
      .swagger-ui .btn.authorize svg { fill: #0050A0; }
      .swagger-ui table thead tr th { background: linear-gradient(90deg, #003D80, #0050A0); color: white; }
      .swagger-ui .opblock.opblock-post .opblock-summary { border-color: #0050A0; }
      .swagger-ui .opblock.opblock-get .opblock-summary { border-color: #15803D; }
      .swagger-ui .opblock.opblock-patch .opblock-summary { border-color: #C29D3D; }
      .swagger-ui .opblock.opblock-delete .opblock-summary { border-color: #B91C1C; }
    `,
  });

  // ── Redirections & health ─────────────────────────────────────────────────
  const httpAdapter = app.getHttpAdapter();

  // Health check (utilisé par Docker et les load balancers)
  httpAdapter.get('/api/health', (_req: Request, res: Response) =>
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() }),
  );

  // / et /api → ReDoc (documentation principale)
  httpAdapter.get('/', (_req: Request, res: Response) =>
    res.redirect('/api/redoc'),
  );
  httpAdapter.get('/api', (_req: Request, res: Response) =>
    res.redirect('/api/redoc'),
  );

  // ── ReDoc — /api/redoc (HTML inline, sans dépendance externe) ────────────
  httpAdapter.get('/api/redoc', (_req: Request, res: Response) => {
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>YWMS API — Documentation ReDoc</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Manrope:wght@600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    body { margin: 0; padding: 0; font-family: 'Poppins', sans-serif; }
  </style>
</head>
<body>
  <div id="redoc-container"></div>
  <!-- ReDoc 2.1.5 — version stable (2.5.x a un bug removeChild sur Chrome) -->
  <script src="https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js"></script>
  <script>
    Redoc.init(
      '/api/docs-json',
      {
        theme: {
          colors: { primary: { main: '#0050A0' } },
          typography: {
            fontFamily: "'Poppins', system-ui, sans-serif",
            headings: { fontFamily: "'Manrope', sans-serif", fontWeight: '700' },
            code: { fontFamily: "'JetBrains Mono', monospace", fontSize: '13px' },
            fontSize: '14px',
            lineHeight: '1.6em',
          },
          sidebar: {
            backgroundColor: '#0F172A',
            textColor: '#E2E8F0',
            activeTextColor: '#60A5FA',
            groupItems: { textTransform: 'uppercase' },
            level1Items: { textTransform: 'none' },
          },
          rightPanel: { backgroundColor: '#1E293B', textColor: '#E2E8F0' },
          logo: { gutter: '16px' },
        },
        hideDownloadButton: false,
        expandResponses: '200,201',
        pathInMiddlePanel: true,
        requiredPropsFirst: true,
        sortPropsAlphabetically: false,
        nativeScrollbars: true,
      },
      document.getElementById('redoc-container'),
    );
  </script>
</body>
</html>`);
  });

  // ── Démarrage ─────────────────────────────────────────────────────────────
  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  console.log(`🚀 YWMS API       → http://localhost:${port}/api`);
  console.log(`📖 Swagger UI     → http://localhost:${port}/api/docs`);
  console.log(`📚 ReDoc          → http://localhost:${port}/api/redoc`);
  console.log(`📄 OpenAPI JSON   → http://localhost:${port}/api/docs-json`);
}
void bootstrap();
