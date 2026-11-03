import { useCallback, useEffect, useRef, useState } from 'react'

export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T }

/*
  Runs `load` when the page opens and again every time `reload` is called.
  `load` must be wrapped in useCallback, because a new function means a new load.
  While a reload runs, the old data stays on the screen, so the page does not
  blink back to a loading message after every payment.
*/
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' })
  const current = useRef<AbortController | null>(null)

  const reload = useCallback(() => {
    current.current?.abort()
    const controller = new AbortController()
    current.current = controller

    load(controller.signal)
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        const message = error instanceof Error ? error.message : 'Something went wrong.'
        setState({ status: 'error', message })
      })
  }, [load])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    reload()
  }, [reload])

  useEffect(() => {
    setState({ status: 'loading' })
    reload()
    return () => current.current?.abort()
  }, [reload])

  return { state, reload, retry }
}
