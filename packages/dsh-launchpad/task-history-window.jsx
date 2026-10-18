import React from 'react'

export function TaskHistoryPager({windowState}) {
  const visible = windowState.total > 100 || windowState.offset > 0 || windowState.loading || !!windowState.error
  if (!visible) return null
  const first = windowState.total ? windowState.offset + 1 : 0
  const last = Math.min(windowState.offset + 100, windowState.total)
  const button = {border:'1px solid var(--dsw-alias-border-l1)',background:'var(--dsw-alias-bg-layer-1, #fff)',color:'inherit',borderRadius:8,padding:'6px 10px',cursor:'pointer'}
  return <nav aria-label="视频历史分页" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',margin:'12px 0'}}>
    <span style={{fontSize:12,opacity:.7}}>{windowState.total ? `视频记录 ${first}–${last} / ${windowState.total}` : '视频历史记录'}</span>
    <button type="button" style={button} disabled={windowState.loading||!windowState.hasNewer} onClick={windowState.newer}>较新记录</button>
    <button type="button" style={button} disabled={windowState.loading||!windowState.hasOlder} onClick={windowState.older}>更早记录</button>
    {windowState.loading&&<small role="status">正在读取视频历史…</small>}
    {windowState.error&&<small role="alert">{windowState.error}</small>}
  </nav>
}
