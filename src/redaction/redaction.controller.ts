import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { DomainHttpException } from '../common/filters/domain-http.exception';

import { MatcherOptionsDto, toMatcherOptions } from './dto/matcher-options.dto';
import { RedactRequestDto } from './dto/redact-request.dto';
import {
  RedactResponseDto,
  toRedactResponseDto,
} from './dto/redact-response.dto';
import { UnredactRequestDto } from './dto/unredact-request.dto';
import {
  UnredactResponseDto,
  toUnredactResponseDto,
} from './dto/unredact-response.dto';
import { createRedactionKey } from './keys/redaction-key';
import { RedactionService } from './redaction.service';

const ERROR_SCHEMA = {
  type: 'object' as const,
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        kind: { type: 'string' },
        message: { type: 'string' },
        details: {},
      },
    },
    timestamp: { type: 'string', format: 'date-time' },
    path: { type: 'string' },
  },
};

export { MatcherOptionsDto };

@ApiTags('redactions')
@Controller('redactions')
export class RedactionController {
  public constructor(private readonly svc: RedactionService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Redact a document',
    description:
      'Replaces every occurrence of the censor-list patterns in the document with XXXX. Returns the redacted text plus an opaque key to restore the original.',
  })
  @ApiBody({ type: RedactRequestDto })
  @ApiResponse({ status: 200, type: RedactResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Validation or parse error.',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 413,
    description: 'Payload too large.',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal error.',
    schema: ERROR_SCHEMA,
  })
  public redact(@Body() dto: RedactRequestDto): RedactResponseDto {
    const result = this.svc.redact(
      dto.text,
      dto.patterns,
      toMatcherOptions(dto.options),
    );
    if (!result.ok) throw new DomainHttpException(result.error);
    return toRedactResponseDto(result.value);
  }

  @Post('unredact')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restore a redacted document',
    description:
      'Applies the mappings encoded in the key to reconstruct the original text from the redacted input.',
  })
  @ApiBody({ type: UnredactRequestDto })
  @ApiResponse({ status: 200, type: UnredactResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Validation or invalid key.',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 413,
    description: 'Payload too large.',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 422,
    description: 'Key integrity failure.',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal error.',
    schema: ERROR_SCHEMA,
  })
  public unredact(@Body() dto: UnredactRequestDto): UnredactResponseDto {
    const result = this.svc.unredact(
      dto.redactedText,
      createRedactionKey(dto.key),
    );
    if (!result.ok) throw new DomainHttpException(result.error);
    return toUnredactResponseDto(result.value);
  }
}
