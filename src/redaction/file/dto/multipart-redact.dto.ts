import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { LIMITS } from '../../../common/limits';

export class MultipartRedactDto {
  @ApiProperty({
    description:
      'Censor list: whitespace- or comma-separated; quoted phrases allowed.',
    example:
      'Hello world "Boston Red Sox", \'Pepperoni Pizza\', \'Cheese Pizza\', beer',
    maxLength: LIMITS.MAX_PATTERNS_INPUT_BYTES,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(LIMITS.MAX_PATTERNS_INPUT_BYTES)
  readonly patterns!: string;

  @ApiPropertyOptional({
    description:
      'MatcherOptions as a JSON string. Omit for defaults. Example: `{"caseSensitive":true}`.',
    example: '{"caseSensitive":false,"wordBoundaries":false}',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  readonly options?: string;
}

export const MULTIPART_REDACT_BODY_SCHEMA = {
  type: 'object' as const,
  required: ['file', 'patterns'],
  properties: {
    file: {
      type: 'string',
      format: 'binary',
      description: 'Plain text file to redact (.txt or .md, UTF-8).',
    },
    patterns: {
      type: 'string',
      description:
        'Censor list: whitespace- or comma-separated; quoted phrases allowed.',
    },
    options: {
      type: 'string',
      description: 'MatcherOptions as a JSON string.',
    },
  },
};
