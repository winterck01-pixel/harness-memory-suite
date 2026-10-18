import test from 'node:test'
import assert from 'node:assert/strict'
import {mergeVideoHistoryWindow, videoTaskSnapshotKey, TASK_HISTORY_PAGE_SIZE} from './task-history-window.js'

test('history window overlays fresh task status and keeps active recent tasks', () => {
  const tasks = mergeVideoHistoryWindow(
    [{id: 'old', status: 'completed', createdAt: 10}, {id: 'running', status: 'polling', createdAt: 8}],
    [{id: 'old', status: 'failed', createdAt: 10}, {id: 'active-new', status: 'submitting', createdAt: 12}, {id: 'recent-done', status: 'completed', createdAt: 11}],
  )

  assert.deepEqual(tasks.map(task => [task.id, task.status]), [
    ['active-new', 'submitting'],
    ['old', 'failed'],
    ['running', 'polling'],
  ])
  assert.ok(tasks.every(task => task.kind === 'video' && task.__source === 'video'))
})

test('history page size is bounded at 100', () => {
  assert.equal(TASK_HISTORY_PAGE_SIZE, 100)
})

test('video snapshot changes refresh a loaded page when a task completes or its assets change', () => {
  const polling = [{id: 'task-1', status: 'polling', updatedAt: 1, results: []}]
  const completed = [{id: 'task-1', status: 'completed', updatedAt: 2, results: [{id: 'asset-1', type: 'video/mp4', name: 'result.mp4'}]}]

  assert.equal(videoTaskSnapshotKey(polling), videoTaskSnapshotKey([{...polling[0], updatedAt: 3}]))
  assert.notEqual(videoTaskSnapshotKey(polling), videoTaskSnapshotKey(completed))
  assert.notEqual(videoTaskSnapshotKey(completed), videoTaskSnapshotKey([{...completed[0], results: [{id: 'asset-1', type: 'video/mp4', name: 'renamed.mp4'}]}]))
  assert.notEqual(videoTaskSnapshotKey(completed), videoTaskSnapshotKey([...completed, {id: 'task-2', status: 'completed'}]))
})

test('video result assets retain video provenance after a recent task overlays a page row', () => {
  const tasks = mergeVideoHistoryWindow(
    [{id: 'video-1', status: 'completed', results: [{id: 'asset-1', type: 'video/mp4'}]}],
    [{id: 'video-1', status: 'completed', billing: {status: 'settled'}, results: [{id: 'asset-1', type: 'video/mp4'}]}],
  )

  assert.equal(tasks[0].__source, 'video')
  assert.equal(tasks[0].results[0].__source, 'video')
  assert.equal(tasks[0].results[0].type, 'video/mp4')
})
