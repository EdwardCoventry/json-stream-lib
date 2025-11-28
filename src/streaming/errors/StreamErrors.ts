export type StreamErrorShape = {
  status?: number;
  code?: string;
  message: string;
  retryable?: boolean;
  attempt: number;
  maxAttempts: number;
  reason?: string;
  bodySnippet?: string;
};

export function buildStreamError(partial: Partial<StreamErrorShape>): StreamErrorShape {
  return {
    status: partial.status,
    code: partial.code || (partial.status ? `HTTP_${partial.status}` : 'STREAM_ERROR'),
    message: partial.message || 'stream error',
    retryable: !!partial.retryable,
    attempt: partial.attempt || 0,
    maxAttempts: partial.maxAttempts || 0,
    reason: partial.reason,
    bodySnippet: partial.bodySnippet,
  };
}
