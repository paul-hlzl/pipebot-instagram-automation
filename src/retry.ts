/** Retries `fn` up to `attempts` times with exponential backoff (2s, 4s, 8s, ...). */
export async function withRetry<T>(fn: () => Promise<T>, attempts: number, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const delayMs = 2000 * 2 ** (attempt - 1);
        console.error(`${label}: attempt ${attempt}/${attempts} failed, retrying in ${delayMs}ms:`, error);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}
