


import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

const source = await readFile(new URL('../client/main.jsx', import.meta.url), 'utf8')

describe('上下文菜单接线', () => {
  it('面板根容器不再直接挂 contextmenu（避免与条目菜单抢同一个事件）', () => {
    const rootTag = source.split('\n').find((line) => line.includes('className="dfm-root"'))
    assert.ok(rootTag !== undefined, '找不到 .dfm-root 元素')
    assert.ok(!rootTag.includes('onContextMenu'), '.dfm-root 不应再挂 onContextMenu')
  })

  it('背景菜单挂在文件区容器上（列表视图与图标视图各一处）', () => {
    const listTag = source.split('\n').find((line) => line.includes('className="dfm-list"'))
    const gridTag = source.split('\n').find((line) => line.includes('className="dfm-grid"'))
    assert.ok(listTag !== undefined && listTag.includes('onContextMenu={(event) => openMenu(event)}'), '.dfm-list 缺少背景菜单绑定')
    assert.ok(gridTag !== undefined && gridTag.includes('onContextMenu={(event) => openMenu(event)}'), '.dfm-grid 缺少背景菜单绑定')
  })

  it('条目级调用点恰好两处，且都不自己处理 preventDefault（统一走 openMenu）', () => {
    const callSites = source.match(/onContextMenu=\{\(event\) => openMenu\(event, entry\)\}/gu) ?? []
    assert.equal(callSites.length, 2, '条目级 contextmenu 调用点应恰好 2 处（列表行 + 图标块）')
  })

  it('openMenu 在条目分支里 stopPropagation，且排在 setMenu 之前', () => {
    const start = source.indexOf('const openMenu = useCallback(')
    assert.ok(start >= 0, '找不到 openMenu')

    const tail = source.slice(start, source.indexOf('}, [selection])', start))
    const stop = tail.indexOf('event.stopPropagation()')
    assert.ok(stop >= 0, 'openMenu 的条目分支必须调用 event.stopPropagation()')

    const returnOnEmpty = tail.indexOf('return')
    assert.ok(returnOnEmpty >= 0 && stop > returnOnEmpty, 'stopPropagation 必须位于「空条目提前返回」之后，否则背景菜单会连累条目菜单')


    const firstSetMenuAfterStop = tail.indexOf('setMenu(', stop)
    assert.ok(firstSetMenuAfterStop > stop, 'stopPropagation 必须早于条目分支的 setMenu')
  })

  it('条目菜单按所在位置切换：普通目录给写操作，废纸篓给还原与彻底删除', () => {
    assert.match(source, /t\('remove'\)/u, '找不到删除项文案')
    assert.match(source, /<MenuItemButton danger icon=\{<IconTrashOutlineRegular/u, '删除项应带 danger 与垃圾桶图标')
    assert.match(
      source,
      /\{writable && !inTrash \? \(\s*<>\s*<MenuItemButton icon=\{<IconCopyOutlineRegular/u,
      '普通目录的写操作应整体包在 writable && !inTrash 条件里',
    )


    const branch = source.match(/\{writable && inTrash \? \(([\s\S]*?)\n {14}\) : null\}/u)
    assert.ok(branch !== null, '找不到废纸篓菜单分支')
    assert.match(branch[1], /t\('restore'\)/u, '废纸篓分支应有「放回原处」')
    assert.match(branch[1], /t\('purge'\)/u, '废纸篓分支应有「彻底删除」')

    assert.ok(!/transfer\(/u.test(branch[1]), '废纸篓条目不应出现拷贝/移动入口')
    assert.ok(!/t\('rename'\)/u.test(branch[1]), '废纸篓条目不应出现重命名入口')
  })

  it('破坏性操作按语义分流，且「在废纸篓里删除」不会退化成二次入篓', () => {

    assert.match(source, /const askRemove = useCallback\(\(entries\) => \{\s*(?:if\(!allowLeave\(\)\)return\s*)?setConfirming\(\{ action: inTrash \? 'purge' : 'trash', entries \}\)/u)

    const raw = source.match(/setConfirming\(selectedEntries\)/gu) ?? []
    assert.equal(raw.length, 0, '不应再有绕过 askRemove 的 setConfirming(selectedEntries)')
    assert.match(source, /askRemove\(selectedEntries\)/u, '快捷键与菜单应通过 askRemove 发起删除')
  })
})
