export type PipelineErrorKind = 'invalid_message' | 'send_failed' | 'unknown_channel' | 'unlinked';

/** Every failure the turn pipeline raises on purpose. Messages never contain message bodies. */
export class PipelineError extends Error {
  constructor(
    readonly kind: PipelineErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PipelineError';
  }
}
