/** HTTP-level failure from monobank. The message never contains the token. */
export class MonoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "MonoApiError";
  }
}

/** The response arrived but did not match the expected schema. */
export class MonoResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonoResponseError";
  }
}
