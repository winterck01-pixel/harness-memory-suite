


import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  extensionOf,
  formatClock,
  isPlayableKind,
  isThumbnailableKind,
  isViewerKind,
  kindFromName,
  mediaKindOf,
  viewerItemsOf,
} from '../client/media.js'

describe('媒体判定', () => {
  it('扩展名取小写，隐藏文件与无扩展名不算', () => {
    assert.equal(extensionOf('photo.PNG'), 'png')
    assert.equal(extensionOf('archive.tar.gz'), 'gz')
    assert.equal(extensionOf('.bashrc'), '', '以点开头的是隐藏文件，不是扩展名')
    assert.equal(extensionOf('Makefile'), '')
    assert.equal(extensionOf(undefined), '')
  })

  it('优先采信服务端下发的 kind', () => {

    assert.equal(mediaKindOf({ name: 'track.dat', kind: 'audio' }), 'audio')
    assert.equal(mediaKindOf({ name: 'x', kind: 'pdf' }), 'pdf')
    assert.equal(mediaKindOf({ name: 'x', kind: 'text' }), 'text')
  })

  it('目录永远是 dir，哪怕名字带媒体扩展名', () => {
    assert.equal(mediaKindOf({ name: 'holiday.mp4', dir: true, kind: 'dir' }), 'dir')

    assert.equal(mediaKindOf({ name: 'holiday.mp4', dir: true }), 'dir')
  })

  it('服务端未下发 kind 时按扩展名回退', () => {
    assert.equal(mediaKindOf({ name: 'a.JPG' }), 'image')
    assert.equal(mediaKindOf({ name: 'a.svg' }), 'image')
    assert.equal(mediaKindOf({ name: 'a.mkv' }), 'video')
    assert.equal(mediaKindOf({ name: 'a.flac' }), 'audio')
    assert.equal(mediaKindOf({ name: 'a.bin' }), 'file')
    assert.equal(mediaKindOf({ name: 'notes.ts' }), 'file', 'TypeScript 不是 MPEG-TS 视频')
    assert.equal(mediaKindOf(null), 'file')
    assert.equal(mediaKindOf({}), 'file')
  })

  it('kindFromName 只认图像/视频/音频三类', () => {
    assert.equal(kindFromName('a.webp'), 'image')
    assert.equal(kindFromName('a.ogv'), 'video')
    assert.equal(kindFromName('a.opus'), 'audio')
    assert.equal(kindFromName('a.md'), 'file')
  })

  it('播放器 / 查看器 / 缩略图的归属互不混淆', () => {
    assert.equal(isPlayableKind('video'), true)
    assert.equal(isPlayableKind('audio'), true)
    assert.equal(isPlayableKind('image'), false, '图片没有播放器')
    assert.equal(isPlayableKind('pdf'), false)

    assert.equal(isViewerKind('image'), true)
    assert.equal(isViewerKind('video'), true)
    assert.equal(isViewerKind('audio'), true)
    assert.equal(isViewerKind('text'), false)
    assert.equal(isViewerKind('dir'), false)

    assert.equal(isThumbnailableKind('image'), true)
    assert.equal(isThumbnailableKind('video'), true)
    assert.equal(isThumbnailableKind('audio'), false, '音频没有画面可用作缩略图')
  })

  it('viewerItemsOf 只留媒体，且保持原顺序', () => {
    const entries = [
      { name: 'folder', dir: true, kind: 'dir' },
      { name: 'a.png', kind: 'image' },
      { name: 'readme.md', kind: 'text' },
      { name: 'b.mp4', kind: 'video' },
      { name: 'c.mp3', kind: 'audio' },
      { name: 'd.pdf', kind: 'pdf' },
    ]
    assert.deepEqual(viewerItemsOf(entries).map((entry) => entry.name), ['a.png', 'b.mp4', 'c.mp3'])
    assert.deepEqual(viewerItemsOf('not an array'), [])
  })

  it('时间格式化补零且跨过小时', () => {
    assert.equal(formatClock(0), '0:00')
    assert.equal(formatClock(7), '0:07')
    assert.equal(formatClock(75), '1:15')
    assert.equal(formatClock(3600), '1:00:00')
    assert.equal(formatClock(3725), '1:02:05')
    assert.equal(formatClock(Number.NaN), '—', '元数据未就绪时是 NaN')
    assert.equal(formatClock(Number.POSITIVE_INFINITY), '—', '流式资源的 duration 可能是 Infinity')
    assert.equal(formatClock(undefined), '—')
    assert.equal(formatClock(-1), '—')
  })
})
