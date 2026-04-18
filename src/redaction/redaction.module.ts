import { Module } from '@nestjs/common';

import { MATCHER } from './interfaces/matcher.interface';
import { KeySerializerService } from './keys/key-serializer.service';
import { AhoCorasickMatcher } from './matchers/aho-corasick.service';
import { CensorListParserService } from './parsers/censor-list-parser.service';
import { RedactionService } from './redaction.service';

@Module({
  providers: [
    CensorListParserService,
    KeySerializerService,
    AhoCorasickMatcher,
    { provide: MATCHER, useExisting: AhoCorasickMatcher },
    RedactionService,
  ],
  exports: [RedactionService],
})
export class RedactionModule {}
