import type {
  RedactError,
  UnredactError,
} from '../../redaction/redaction.service';

export type RedactionDomainError = RedactError | UnredactError;

export class DomainHttpException extends Error {
  public readonly domainError: RedactionDomainError;

  public constructor(domainError: RedactionDomainError) {
    super(domainError.message);
    this.name = 'DomainHttpException';
    this.domainError = domainError;
  }
}
