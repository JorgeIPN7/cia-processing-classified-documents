import { Module } from '@nestjs/common';

import { FileStorageService } from './file/file-storage.service';
import { RedactionFileController } from './file/redaction-file.controller';
import { RedactionFileService } from './file/redaction-file.service';
import { RedactionController } from './redaction.controller';
import { RedactionModule } from './redaction.module';

@Module({
  imports: [RedactionModule],
  controllers: [RedactionController, RedactionFileController],
  providers: [FileStorageService, RedactionFileService],
})
export class RedactionApiModule {}
