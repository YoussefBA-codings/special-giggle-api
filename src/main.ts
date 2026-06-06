import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'error', 'warn'] });

  app.enableCors();

  const port = process.env.PORT ?? 4783;
  await app.listen(port);

  console.log(`\n🏠 API immobilière démarrée sur http://localhost:${port}`);
  console.log('\nRoutes disponibles :');
  console.log('  GET /cities                    — liste paginée avec filtres');
  console.log('  GET /cities/:inseeCode         — détail complet');
  console.log('  GET /cities/compare?codes=...  — comparaison');
  console.log('  GET /regions                   — liste des régions');
  console.log('  GET /regions/:slug             — détail région');
  console.log('  GET /regions/:slug/cities      — communes de la région');
  console.log('  GET /departments               — liste des départements');
  console.log('  GET /departments/:code         — détail département');
  console.log('  GET /departments/:code/cities  — communes du département');
  console.log('  GET /rankings/global           — top scores globaux');
  console.log('  GET /rankings/yield            — top rendements');
  console.log('  GET /rankings/cashflow         — top cashflow');
  console.log('  GET /rankings/patrimonial      — top patrimoniaux');
  console.log('  GET /rankings/beginner         — top débutants');
  console.log('  GET /rankings/low-risk         — villes moins risquées');
  console.log('  GET /rankings/yield-traps      — yield traps');
  console.log('  GET /rankings/long-term        — top long terme');
  console.log('  GET /rankings/rental-demand    — top demande locative');
}

bootstrap();
