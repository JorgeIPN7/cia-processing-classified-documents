import { Module } from '@nestjs/common';

import { appVersionProvider } from './app-version.provider';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [appVersionProvider],
})
export class HealthModule {}
