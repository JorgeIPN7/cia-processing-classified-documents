import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useBodyParser('json', { limit: '11mb' });

  const config = new DocumentBuilder()
    .setTitle('CIA Document Redactor API')
    .setVersion('1.0.0')
    .addTag('redactions')
    .addTag('health')
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, config),
  );

  const port = process.env['PORT'] ?? 8888;
  await app.listen(port);
}

void bootstrap();
