import {useEffect, useMemo, useState} from 'react'

export const TASK_HISTORY_PAGE_SIZE = 100
const ACTIVE_TASK_STATUSES = new Set(['queued', 'waiting', 'dispatching', 'submitting', 'polling', 'running', 'processing'])

export function videoTaskSnapshotKey(tasks = []) {
  return JSON.stringify(tasks.map(task => [
    task.id, task.status, task.hiddenAt, task.prompt, task.model, task.createdAt, task.error,
    task.billing?.status, task.billing?.credits, task.billing?.costUsd, task.billingCheck?.status, task.billingCheck?.reason, task.billingCheck?.checkedAt,
    (task.results || []).map(result => [result.id, result.type, result.name]),
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}

export function mergeVideoHistoryWindow(pageTasks, recentTasks) {
  const merged = new Map()
  const markVideo = task => ({
    ...task,
    kind: 'video',
    __source: 'video',
    results: (task.results || []).map(asset => markVideo(asset)),
  })
  for (const task of pageTasks || []) {
    if (task?.id) merged.set(task.id, markVideo(task))
  }
  for (const task of recentTasks || []) {
    if (!task?.id) continue
    const previous = merged.get(task.id)
    if (previous) merged.set(task.id, markVideo({...previous, ...task}))
    else if (ACTIVE_TASK_STATUSES.has(task.status)) merged.set(task.id, markVideo(task))
  }
  return [...merged.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

export function useVideoTaskHistoryWindow(recentTasks = []) {
  const [offset, setOffset] = useState(0)
  const [eventRevision, setEventRevision] = useState(0)
  const [page, setPage] = useState({tasks: [], total: 0, nextOffset: null, offset: 0, loading: false, error: ''})
  const snapshotKey = videoTaskSnapshotKey(recentTasks)

  useEffect(() => {
    const refresh = () => setEventRevision(value => value + 1)
    const costsChanged = event => {
      if (event.detail?.tasks?.some(task => task.kind === 'video' || task.__source === 'video')) refresh()
    }
    window.addEventListener('dsh-video-assets-changed', refresh)
    window.addEventListener('dsh-generation-cost-changed', costsChanged)
    return () => {
      window.removeEventListener('dsh-video-assets-changed', refresh)
      window.removeEventListener('dsh-generation-cost-changed', costsChanged)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setPage(current => ({
      ...current,
      ...(current.offset === offset ? {} : {tasks: [], total: 0, nextOffset: null}),
      offset,
      loading: true,
      error: '',
    }))
    fetch('/api/video-studio/tasks/history?limit='+TASK_HISTORY_PAGE_SIZE+'&offset='+offset, {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw Error(data.error || '视频历史记录暂不可用')
      return data
    }).then(data => {
      if (controller.signal.aborted) return
      setPage({
        tasks: (Array.isArray(data.tasks) ? data.tasks : []).map(task => ({...task, kind: 'video', __source: 'video'})),
        total: Number.isFinite(data.total) ? data.total : 0,
        nextOffset: Number.isInteger(data.nextOffset) ? data.nextOffset : null,
        offset,
        loading: false,
        error: '',
      })
    }).catch(error => {
      if (controller.signal.aborted) return
      setPage(current => ({...current, loading: false, error: error.message || '视频历史记录暂不可用'}))
    })
    return () => controller.abort()
  }, [offset, snapshotKey, eventRevision])

  const tasks = useMemo(() => mergeVideoHistoryWindow(page.tasks, recentTasks), [page.tasks, recentTasks])
  return {
    ...page,
    tasks,
    offset,
    hasNewer: offset > 0,
    hasOlder: page.nextOffset !== null,
    newer() { setOffset(value => Math.max(0, value - TASK_HISTORY_PAGE_SIZE)) },
    older() { if (page.nextOffset !== null) setOffset(page.nextOffset) },
  }
}
