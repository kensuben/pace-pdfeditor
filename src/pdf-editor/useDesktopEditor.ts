import { useSyncExternalStore } from 'react'

const subscribe = (callback: () => void) => {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return () => {}
  }
  const mq = window.matchMedia('(min-width: 1024px)')
  mq.addEventListener('change', callback)
  return () => mq.removeEventListener('change', callback)
}

const getSnapshot = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  return window.matchMedia('(min-width: 1024px)').matches
}

const getServerSnapshot = () => true

export function useDesktopEditor(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
