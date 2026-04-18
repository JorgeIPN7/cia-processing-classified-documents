import { ApiProperty } from '@nestjs/swagger';

import type { UnredactResult } from '../redaction.service';

export class UnredactStatsDto {
  @ApiProperty({
    description: 'Number of mappings applied from the key.',
    example: 3,
  })
  readonly restoredCount!: number;

  @ApiProperty({ description: 'Service latency in milliseconds.', example: 1 })
  readonly latencyMs!: number;
}

export class UnredactResponseDto {
  @ApiProperty({
    description: 'Reconstructed original text.',
    example: 'I love Cheese Pizza and beer at Boston Red Sox games',
  })
  readonly text!: string;

  @ApiProperty({ type: () => UnredactStatsDto })
  readonly stats!: UnredactStatsDto;
}

export function toUnredactResponseDto(
  result: UnredactResult,
): UnredactResponseDto {
  return {
    text: result.text,
    stats: {
      restoredCount: result.stats.restoredCount,
      latencyMs: result.stats.latencyMs,
    },
  };
}
