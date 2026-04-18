import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok', enum: ['ok'] })
  readonly status!: 'ok';

  @ApiProperty({ description: 'Process uptime in seconds.', example: 12345 })
  readonly uptime!: number;

  @ApiProperty({ description: 'Application semantic version.', example: '1.0.0' })
  readonly version!: string;
}
