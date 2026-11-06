import { useCallback, useEffect, useRef, useState } from 'react'

export type Progress<Result> =
  | { phase: 'loading' }
  | { phase: 'failed'; reason: string }
  | { phase: 'ready'; payload: Result }

/*
  Runs `producer` when the page opens and again every time `reloadAll` is called.
  `producer` must be wrapped in useCallback, because a new function means a
  new fetch.
  While the data is fetched again, the old data stays on the screen, so the
  page does not blink back to a loading message after every payment.
*/
export function useAsync<Result>(producer: (stop: AbortSignal) => Promise<Result>) {
  const [progress, setProgress] = useState<Progress<Result>>({ phase: 'loading' })
  const running = useRef<AbortController | null>(null)

  const reloadAll = useCallback(() => {
    running.current?.abort()
    const ctl = new AbortController()
    running.current = ctl

    producer(ctl.signal)
      .then((payload) => setProgress({ phase: 'ready', payload }))
      .catch((problem: unknown) => {
        if (ctl.signal.aborted) {
          return
        }
        const reason = problem instanceof Error ? problem.message : 'Something went wrong.'
        setProgress({ phase: 'failed', reason })
      })
  }, [producer])

  const startOver = useCallback(() => {
    setProgress({ phase: 'loading' })
    reloadAll()
  }, [reloadAll])

  useEffect(() => {
    setProgress({ phase: 'loading' })
    reloadAll()
    return () => running.current?.abort()
  }, [reloadAll])

  return { progress, reloadAll, startOver }
}
