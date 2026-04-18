import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

import type { MatcherOptions } from '../interfaces/matcher-options.interface';

export class MatcherOptionsDto {
  @ApiPropertyOptional({
    description: 'Match respecting case. Default: false.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  readonly caseSensitive?: boolean;

  @ApiPropertyOptional({
    description: 'Require non-alphanumeric boundaries. Default: false.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  readonly wordBoundaries?: boolean;

  @ApiPropertyOptional({
    description: 'Normalize Unicode (NFD + strip diacritics). Default: false.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  readonly normalizeUnicode?: boolean;

  @ApiPropertyOptional({
    description: 'Collapse whitespace inside phrases. Default: false.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  readonly normalizeWhitespace?: boolean;
}

export function toMatcherOptions(
  dto: MatcherOptionsDto | undefined,
): MatcherOptions | undefined {
  if (dto === undefined) return undefined;
  const out: {
    caseSensitive?: boolean;
    wordBoundaries?: boolean;
    normalizeUnicode?: boolean;
    normalizeWhitespace?: boolean;
  } = {};
  if (dto.caseSensitive !== undefined) out.caseSensitive = dto.caseSensitive;
  if (dto.wordBoundaries !== undefined) out.wordBoundaries = dto.wordBoundaries;
  if (dto.normalizeUnicode !== undefined) {
    out.normalizeUnicode = dto.normalizeUnicode;
  }
  if (dto.normalizeWhitespace !== undefined) {
    out.normalizeWhitespace = dto.normalizeWhitespace;
  }
  return out;
}
