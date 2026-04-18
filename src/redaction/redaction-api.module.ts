import { Module } from '@nestjs/common';

import { RedactionController } from './redaction.controller';
import { RedactionModule } from './redaction.module';

@Module({
  imports: [RedactionModule],
  controllers: [RedactionController],
})
export class RedactionApiModule {}
