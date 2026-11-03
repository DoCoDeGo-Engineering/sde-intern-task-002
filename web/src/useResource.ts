import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, isAbort } from './api'

type ResourceState<T> = { data: T | null; loading: boolean; error: string | null }

const empty = { data: null, loading: false, error: null }

export function useResource<T>(fetcher: ((signal: AbortSignal) => Promise<T>) | null) {
  const [state, setState] = useState<ResourceState<T>>(empty)
  const current = useRef<AbortController | null>(null)

  const reload = useCallback(async () => {
    if (!fetcher) return
    current.current?.abort()
    const controller = new AbortController()
    current.current = controller
    setState((previous) => ({ ...previous, loading: true, error: null }))
    try {
      const data = await fetcher(controller.signal)
      if (!controller.signal.aborted) setState({ data, loading: false, error: null })
    } catch (error) {
      if (controller.signal.aborted || isAbort(error)) return
      setState((previous) => ({ ...previous, loading: false, error: errorMessage(error) }))
    }
  }, [fetcher])

  useEffect(() => {
    setState(empty)
    void reload()
    return () => current.current?.abort()
  }, [reload])

  return { ...state, reload }
}
