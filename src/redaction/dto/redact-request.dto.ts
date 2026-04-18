import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { LIMITS } from '../../common/limits';

import { MatcherOptionsDto } from './matcher-options.dto';

export class RedactRequestDto {
  @ApiProperty({
    description:
      'Document text to redact. Max size enforced by the service (413 PAYLOAD_TOO_LARGE).',
    example: 'I love Cheese Pizza and beer at Boston Red Sox games',
  })
  @IsString()
  readonly text!: string;

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
    type: () => MatcherOptionsDto,
    description: 'Matching options. Omitted fields use defaults.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => MatcherOptionsDto)
  readonly options?: MatcherOptionsDto;
}
