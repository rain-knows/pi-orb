/** Ported from mini-yifan/dsh-orb-cordis@aa79308e47265b7d4a774edb688de2bbd7dce66e (MIT). Only Symbol namespace is replaced by Pi. */
import { describe, expect, it } from 'vitest'
import { SCREEN_BUSY_MESSAGE, withScreenLock } from '../src/main/gui-lock'

describe('withScreenLock', () => {
  it('fails fast when another owner holds the lock, then admits the retry after release', async () => {
    const gate = Promise.withResolvers<void>()
    const first = withScreenLock('session-a', async () => {
      await gate.promise
      return 'first'
    })
    await expect(withScreenLock('session-b', async () => 'second')).rejects.toThrow(SCREEN_BUSY_MESSAGE)
    gate.resolve()
    await expect(first).resolves.toBe('first')
    await expect(withScreenLock('session-b', async () => 'retry')).resolves.toBe('retry')
  })

  it('lets the same owner re-enter without releasing the hold', async () => {
    const gate = Promise.withResolvers<void>()
    const first = withScreenLock('session-a', async () => {
      await gate.promise
      return 'first'
    })
    await expect(withScreenLock('session-a', async () => 'nested')).resolves.toBe('nested')
    gate.resolve()
    await expect(first).resolves.toBe('first')
  })

  it('releases the lock when the run throws', async () => {
    await expect(withScreenLock('session-a', async () => {
      throw new Error('aborted action')
    })).rejects.toThrow('aborted action')
    await expect(withScreenLock('session-b', async () => 'after')).resolves.toBe('after')
  })

  it('blocks callers without an agent id against each other', async () => {
    const gate = Promise.withResolvers<void>()
    const first = withScreenLock(undefined, async () => {
      await gate.promise
      return 'first'
    })
    await expect(withScreenLock(undefined, async () => 'second')).rejects.toThrow(SCREEN_BUSY_MESSAGE)
    gate.resolve()
    await expect(first).resolves.toBe('first')
  })
})
