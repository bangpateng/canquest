import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(',').filter(Boolean) ?? [
      'http://localhost:3000',
    ],
    credentials: true,
  });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
}
bootstrap();
