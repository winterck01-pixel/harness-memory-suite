import {temporalMetadata} from './temporal.js'
import {resolve} from 'node:path'
import {realpathSync} from 'node:fs'
export const BUILD_ID = 'mnemo-model-selection-20261002.3'
export function projectScope(cwd) {
  if(!cwd) throw new Error('Memory call requires the invoking session project')
  let path=resolve(cwd);try{path=realpathSync(path)}catch{}
  return 'project:'+path
}
export function sourceLabel(item) {
  const trust=item.trust??(item.source==='human'?'reported':'unverified')
  return `[${trust}${item.conflicts?.length ? '; possible-conflict='+item.conflicts.join(',') : ''}; source=${item.source??'unknown'}; id=${item.id}${temporalMetadata(item)}] ${item.text}`
}
export function usable(item, now=Date.now()) {
 return !['disputed','superseded','rejected'].includes(item.trust) && !(typeof item.expiresAt === 'number' && item.expiresAt<=now)
}
