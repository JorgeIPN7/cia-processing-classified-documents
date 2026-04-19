import { ApiProperty } from '@nestjs/swagger';

import { RedactionStatsDto } from '../../dto/redact-response.dto';

export class RedactFileResponseDto {
  @ApiProperty({
    description:
      'Opaque storage ID (64 hex chars). Used to download the redacted file.',
    example:
      'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
  })
  readonly id!: string;

  @ApiProperty({
    description:
      'Download URL for the redacted file. Single-use, expires after TTL.',
    example:
      '/redactions/file/a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
  })
  readonly downloadUrl!: string;

  @ApiProperty({
    description:
      'Opaque base64url key to restore the original text via /redactions/unredact/file.',
  })
  readonly key!: string;

  @ApiProperty({
    description: 'TTL (in seconds) for the downloadable redacted file.',
    example: 300,
  })
  readonly expiresInSeconds!: number;

  @ApiProperty({ type: () => RedactionStatsDto })
  readonly stats!: RedactionStatsDto;
}
