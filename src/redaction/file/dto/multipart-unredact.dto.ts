import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { LIMITS } from '../../../common/limits';

export class MultipartUnredactDto {
  @ApiProperty({
    description: 'Opaque base64url key produced by a previous redact call.',
    example: 'eJyrVkrNS8YsS8zJTFGyUvJNLS7OzM8DAHvnB9k=',
    maxLength: LIMITS.MAX_KEY_BYTES,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(LIMITS.MAX_KEY_BYTES)
  readonly key!: string;
}

export const MULTIPART_UNREDACT_BODY_SCHEMA = {
  type: 'object' as const,
  required: ['file', 'key'],
  properties: {
    file: {
      type: 'string',
      format: 'binary',
      description: 'Redacted text file to restore (.txt or .md, UTF-8).',
    },
    key: {
      type: 'string',
      description: 'Opaque base64url key produced by a previous redact call.',
    },
  },
};
