import { ApiProperty } from '@nestjs/swagger';

import type { RedactResult } from '../redaction.service';

export class RedactionStatsDto {
  @ApiProperty({ description: 'Number of unique patterns after parsing.', example: 4 })
  readonly patternCount!: number;

  @ApiProperty({ description: 'Number of matches replaced by XXXX.', example: 3 })
  readonly matchCount!: number;

  @ApiProperty({ description: 'Input document length in characters.', example: 52 })
  readonly documentBytes!: number;

  @ApiProperty({ description: 'Service latency in milliseconds.', example: 3 })
  readonly latencyMs!: number;
}

export class RedactResponseDto {
  @ApiProperty({
    description: 'Document with matches replaced by the literal token XXXX.',
    example: 'I love XXXX and XXXX at XXXX games',
  })
  readonly redactedText!: string;

  @ApiProperty({
    description:
      'Opaque, self-contained base64url key to restore the original text. Not cryptographic.',
    example: 'eJyrVkrNS8YsS8zJTFGyUvJNLS7OzM8DAHvnB9k=',
  })
  readonly key!: string;

  @ApiProperty({ type: () => RedactionStatsDto })
  readonly stats!: RedactionStatsDto;
}

export function toRedactResponseDto(result: RedactResult): RedactResponseDto {
  return {
    redactedText: result.redactedText,
    key: result.key,
    stats: {
      patternCount: result.stats.patternCount,
      matchCount: result.stats.matchCount,
      documentBytes: result.stats.documentBytes,
      latencyMs: result.stats.latencyMs,
    },
  };
}
