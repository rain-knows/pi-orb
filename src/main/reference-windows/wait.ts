/**
 * Abortable delay used after GUI actions and by the wait and long_wait tools.
 * Source: `deepseek-harness-orb` commit `72f1d738458a223696685a909e806b683eff5885`,
 * `packages/experimental/tool-computer-use/src/wait.ts` (MIT). Unmodified; pi-orb has no wait tool
 * yet, so only the abortable delay is live.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/wait
 */

/**
 * Pause until `ms` elapses or `signal` aborts.
 * @param ms - delay in milliseconds; non-positive values return after an abort check.
 * @param signal - cooperative cancellation for the owning tool or pre-step.
 * @returns after the delay, or rejects with the abort reason.
 */
export async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    signal.throwIfAborted()
    return
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      const reason: unknown = signal.reason
      reject(reason instanceof Error ? reason : new Error('computer-use: wait aborted'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal.aborted) {
      clearTimeout(timer)
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
