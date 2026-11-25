import { PipelineError } from './errors.js';

/** Channel sends retry three times after the first attempt (rule G3). */
export const SEND_RETRIES = 3;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Run a send; on failure retry up to three more times, then throw `send_failed`. */
export async function sendWithRetry(send: () => Promise<void>, delayMs: number): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await send();
      return;
    } catch (error) {
      if (attempt >= SEND_RETRIES) {
        throw new PipelineError(
          'send_failed',
          `Send failed after ${String(attempt + 1)} attempts`,
          {
            cause: error,
          },
        );
      }
      await wait(delayMs * (attempt + 1));
    }
  }
}
