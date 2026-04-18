import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

export function configureApp(app: INestApplication): void {
  (app as NestExpressApplication).useBodyParser('json', { limit: '11mb' });
}
