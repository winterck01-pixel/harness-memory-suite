


import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

const source = await readFile(new URL('../client/main.jsx', import.meta.url), 'utf8')


function infoKeysOf(block) {
  return [...block.matchAll(/\[t\('([A-Za-z0-9]+)'\),/gu)].map((match) => match[1])
}


function dictionaryKeys(name) {
  const start = source.indexOf(`const ${name} = {`)
  assert.ok(start >= 0, `找不到字典 ${name}`)
  const end = source.indexOf('\n}', start)
  assert.ok(end > start, `字典 ${name} 没有正常结束`)
  const body = source.slice(start, end)
  return [...body.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gmu)].map((match) => match[1]).sort()
}

describe('废纸篓界面接线', () => {
  it('简介行只有一处构造：任何类型走同一个 mediaInfoRows', () => {
    const constructions = [...source.matchAll(/\[t\('kindLabel'\),/gu)]
    assert.equal(constructions.length, 1, '「种类」行只应在 mediaInfoRows 里出现一次，别处不许自己拼简介')
    assert.match(source, /\[t\('kindLabel'\), t\(KIND_LABEL_KEYS\[kind\]/u, 'mediaInfoRows 应保留种类行')
  })

  it('mediaInfoRows 带出废纸篓条目独有的原位置与删除时间', () => {
    const start = source.indexOf('function mediaInfoRows(')
    assert.ok(start >= 0, '找不到 mediaInfoRows')
    const body = source.slice(start, source.indexOf('\n}', start))
    const keys = infoKeysOf(body)
    assert.ok(keys.includes('originalPath'), 'mediaInfoRows 应输出原位置行')
    assert.ok(keys.includes('deletedAt'), 'mediaInfoRows 应输出删除时间行')

    assert.match(body, /typeof entry\.original === 'string'/u)
    assert.match(body, /typeof entry\.deletedAt === 'string'/u)
  })

  it('位置栏把废纸篓当独立位置，配垃圾桶图标', () => {
    const presentation = source.slice(
      source.indexOf('const LOCATION_PRESENTATION = {'),
      source.indexOf('\n}', source.indexOf('const LOCATION_PRESENTATION = {')),
    )
    assert.match(presentation, /trash: \{ icon: IconTrashOutlineRegular, key: 'trash' \}/u)
  })

  it('废纸篓路径不摊开成面包屑（避免诱人走进记录区）', () => {
    assert.match(source, /inTrash \? \(/u, '面包屑应有废纸篓分支')
    assert.match(source, /className="dfm-crumb-static"/u, '废纸篓应显示成不可点的一格')
  })

  it('文案字典中英两侧键集合完全一致，且废纸篓所需键齐备', () => {
    const zhKeys = dictionaryKeys('zh')
    const enKeys = dictionaryKeys('en')
    assert.deepEqual(zhKeys, enKeys, '中英文案键必须一一对应，漏翻译会在英文环境下露出裸键名')
    for (const key of ['trash', 'emptyTrash', 'restore', 'purge', 'restored', 'purged', 'emptied', 'originalPath', 'deletedAt', 'trashNote', 'restoreTitle', 'restoreBody', 'purgeTitle', 'purgeBody', 'emptyTrashTitle', 'emptyTrashBody']) {
      assert.ok(zhKeys.includes(key), `缺少文案键 ${key}`)
    }
  })
})
