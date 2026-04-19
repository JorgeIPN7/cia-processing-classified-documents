import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { DomainHttpException } from '../../common/filters/domain-http.exception';
import { RedactionStatsDto } from '../dto/redact-response.dto';

import {
  MULTIPART_REDACT_BODY_SCHEMA,
  MultipartRedactDto,
} from './dto/multipart-redact.dto';
import {
  MULTIPART_UNREDACT_BODY_SCHEMA,
  MultipartUnredactDto,
} from './dto/multipart-unredact.dto';
import { RedactFileResponseDto } from './dto/redact-file-response.dto';
import {
  assertValidUploadedFile,
  buildMulterOptions,
  sanitizeFilename,
  type UploadedFileLike,
} from './multipart.config';
import { isValidStorageId } from './file-storage.service';
import { RedactionFileService } from './redaction-file.service';

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

function contentDisposition(filename: string): string {
  const safe = sanitizeFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(safe);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function absoluteDownloadUrl(req: Request, id: string): string {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = req.get('x-forwarded-host');
  const proto = forwardedProto ?? req.protocol;
  const host = forwardedHost ?? req.get('host') ?? 'localhost';
  return `${proto}://${host}/redactions/file/${id}`;
}

@ApiTags('redactions')
@Controller('redactions')
export class RedactionFileController {
  public constructor(private readonly svc: RedactionFileService) {}

  @Post('file')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Redact a plain-text document uploaded as a file',
    description:
      'Accepts multipart/form-data with a `.txt` or `.md` file plus a `patterns` field and optional JSON `options`. Returns a download handle (single-use, short TTL) for the redacted file, together with the restoration key and stats.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: MULTIPART_REDACT_BODY_SCHEMA })
  @ApiResponse({ status: 200, type: RedactFileResponseDto })
  @ApiResponse({ status: 400, description: 'Validation or parse error.', schema: ERROR_SCHEMA })
  @ApiResponse({ status: 413, description: 'Payload too large.', schema: ERROR_SCHEMA })
  @ApiResponse({ status: 500, description: 'Internal error.', schema: ERROR_SCHEMA })
  @UseInterceptors(FileInterceptor('file', buildMulterOptions()))
  public async redactFile(
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() body: MultipartRedactDto,
    @Req() req: Request,
  ): Promise<RedactFileResponseDto> {
    assertValidUploadedFile(file);

    const result = await this.svc.redactFile({
      buffer: file.buffer,
      originalFilename: file.originalname,
      patterns: body.patterns,
      ...(body.options !== undefined ? { optionsJson: body.options } : {}),
    });
    if (!result.ok) throw new DomainHttpException(result.error);

    return {
      id: result.value.id,
      downloadUrl: absoluteDownloadUrl(req, result.value.id),
      key: result.value.result.key,
      expiresInSeconds: result.value.expiresInSeconds,
      stats: toStatsDto(result.value.result.stats),
    };
  }

  @Get('file/:id')
  @ApiOperation({
    summary: 'Download a previously-redacted file (single-use)',
    description:
      'Returns the redacted document stored by a prior POST /redactions/file. The file is removed from storage upon successful read — subsequent requests return 404.',
  })
  @ApiParam({ name: 'id', description: '64-char lowercase hex storage ID' })
  @ApiResponse({
    status: 200,
    description: 'Redacted file contents.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({ status: 400, description: 'Malformed id.', schema: ERROR_SCHEMA })
  @ApiResponse({
    status: 404,
    description: 'Unknown or expired id.',
    schema: ERROR_SCHEMA,
  })
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'no-store')
  public async downloadFile(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!isValidStorageId(id)) {
      throw new BadRequestException('Invalid storage id');
    }
    const record = await this.svc.consumeStored(id);
    if (record === null) {
      throw new NotFoundException('Download not found or expired');
    }
    res.setHeader('Content-Type', record.meta.mime);
    res.setHeader(
      'Content-Disposition',
      contentDisposition(record.meta.filename),
    );
    return new StreamableFile(record.buffer);
  }

  @Post('unredact/file')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restore a redacted file and download the original inline',
    description:
      'Accepts multipart/form-data with a redacted `.txt` or `.md` file plus a `key` field. Responds synchronously with the reconstructed file — nothing is persisted to disk.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: MULTIPART_UNREDACT_BODY_SCHEMA })
  @ApiResponse({
    status: 200,
    description: 'Restored file contents.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({ status: 400, description: 'Validation or invalid key.', schema: ERROR_SCHEMA })
  @ApiResponse({ status: 413, description: 'Payload too large.', schema: ERROR_SCHEMA })
  @ApiResponse({ status: 422, description: 'Key integrity failure.', schema: ERROR_SCHEMA })
  @ApiResponse({ status: 500, description: 'Internal error.', schema: ERROR_SCHEMA })
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('file', buildMulterOptions()))
  public unredactFile(
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() body: MultipartUnredactDto,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    assertValidUploadedFile(file);

    const result = this.svc.unredactFile({
      buffer: file.buffer,
      originalFilename: file.originalname,
      key: body.key,
    });
    if (!result.ok) throw new DomainHttpException(result.error);

    res.setHeader('Content-Type', result.value.mime);
    res.setHeader(
      'Content-Disposition',
      contentDisposition(result.value.filename),
    );
    res.setHeader(
      'X-Unredact-Restored-Count',
      String(result.value.result.stats.restoredCount),
    );
    res.setHeader(
      'X-Unredact-Latency-Ms',
      String(result.value.result.stats.latencyMs),
    );
    return new StreamableFile(result.value.buffer);
  }
}

function toStatsDto(stats: {
  readonly patternCount: number;
  readonly matchCount: number;
  readonly documentBytes: number;
  readonly latencyMs: number;
}): RedactionStatsDto {
  return {
    patternCount: stats.patternCount,
    matchCount: stats.matchCount,
    documentBytes: stats.documentBytes,
    latencyMs: stats.latencyMs,
  };
}
