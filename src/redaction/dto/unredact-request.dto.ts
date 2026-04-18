import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { LIMITS } from '../../common/limits';

export class UnredactRequestDto {
  @ApiProperty({
    description:
      'Redacted document text to restore. Max size enforced by the service (413 PAYLOAD_TOO_LARGE).',
    example: 'I love XXXX and XXXX at XXXX games',
  })
  @IsString()
  readonly redactedText!: string;

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
