/**
 * Small Cordis bridge used by opt-in Harness UI plugins.
 * The launcher owns the API; application plugins only publish metadata and task sources.
 */
export const SERVICE = 'dshLaunchpad'
import { useEffect, useState, useSyncExternalStore } from 'react'

const EMPTY_TASKS = Object.freeze({ image: Object.freeze([]), video: Object.freeze([]), updatedAt: 0 })
const NOOP_SUBSCRIBE = () => () => {}
const GET_EMPTY_TASKS = () => EMPTY_TASKS

export function connectLaunchpad(ctx, onReady, label = 'launchpad-client') {
  ctx.inject([SERVICE], (scope) => scope.effect(() => {
    const service = scope.get(SERVICE)
    const dispose = onReady(service)
    window.dispatchEvent(new Event('dsh-launchpad:service-ready'))
    return () => {
      dispose?.()
      window.dispatchEvent(new Event('dsh-launchpad:service-ready'))
    }
  }, `dsh-launchpad: ${label}`))
}

export function registerLaunchpadApp(ctx, descriptor, label = 'launchpad-app') {
  ctx.inject([SERVICE], (scope) => scope.effect(
    () => scope.get(SERVICE).registerApp(descriptor),
    `dsh-launchpad: ${label}`,
  ))
}

export function registerLaunchpadTasks(ctx, source, label = 'launchpad-tasks') {
  ctx.inject([SERVICE], (scope) => scope.effect(
    () => scope.get(SERVICE).registerTaskSource(source),
    `dsh-launchpad: ${label}`,
  ))
}

export function useLaunchpadTasks(serviceRef) {
  const [, refresh] = useState(0)
  const service = serviceRef.current
  useEffect(() => {
    const ready = () => refresh((value) => value + 1)
    window.addEventListener('dsh-launchpad:service-ready', ready)
    return () => window.removeEventListener('dsh-launchpad:service-ready', ready)
  }, [])
  const current = serviceRef.current
  const tasks = useSyncExternalStore(
    current?.subscribeTasks || NOOP_SUBSCRIBE,
    current?.getTaskSnapshot || GET_EMPTY_TASKS,
    GET_EMPTY_TASKS,
  )
  return tasks
}

export function useSessionValue(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const saved = sessionStorage.getItem(key)
      return saved === null ? initialValue : JSON.parse(saved)
    } catch { return initialValue }
  })
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* preserve UI even if storage is full */ }
  }, [key, value])
  return [value, setValue]
}
