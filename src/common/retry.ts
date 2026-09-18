import { isRetryableConflict } from './errors';

/**
 * Runs `fn` again when Postgres aborted it with a serialization failure or a deadlock (40001,
 * 40P01, Prisma P2034). Any statement that touches a table with an exclusion constraint can be a
 * deadlock victim under contention — the constraint is rechecked on every non-HOT update, and the
 * check waits on in-flight conflicting inserts — so the callers that follow a reserve use this.
 */
export async function retryOnConflict<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryableConflict(error) || attempt + 1 >= attempts) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.floor(Math.random() * 20 * 2 ** attempt)),
      );
    }
  }
}
