import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { APP_VERSION } from './app-version.provider';
import { HealthResponseDto } from './dto/health-response.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  public constructor(
    @Inject(APP_VERSION) private readonly version: string,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200, type: HealthResponseDto })
  public getHealth(): HealthResponseDto {
    return {
      status: 'ok',
      uptime: process.uptime(),
      version: this.version,
    };
  }
}
