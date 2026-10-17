import { createElement, useEffect } from 'react'

export const RAG_SETTINGS_ID = 'knowledge-rag'

function currentShell(slots) {
  const entry = slots.entriesOfSlot('sidebar.settings')[0]
  return entry?.store ? entry : undefined
}

function canNavigate(slots, shell) {
  return !!shell && currentShell(slots) === shell
    && slots.entriesOfSlot('settings.section').some(entry => entry.options.id === RAG_SETTINGS_ID)
}


function KnowledgeRagDeepLink({ actions, navigationIsCurrent, useSessions }) {
  const sessionsReady = useSessions?.(state => state.phase === 'ready') ?? false
  useEffect(() => {
    if (!sessionsReady) return
    let firstFrame, secondFrame, stopped = false
    const requested = () => new URL(window.location.href).searchParams.get('settings') === RAG_SETTINGS_ID
    if (!requested() || !navigationIsCurrent?.() || typeof actions?.openSection !== 'function') return

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (!stopped && requested() && navigationIsCurrent?.()) actions.openSection(RAG_SETTINGS_ID)
      })
    })
    return () => {
      stopped = true
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame)
    }
  }, [actions, navigationIsCurrent, sessionsReady])
  return null
}


export function confirmKnowledgeRagSection(Section) {
  return function ConfirmedKnowledgeRagSection(props) {
    useEffect(() => {
      const url = new URL(window.location.href)
      if (url.searchParams.get('settings') !== RAG_SETTINGS_ID) return
      url.searchParams.delete('settings')
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    }, [])
    return createElement(Section, props)
  }
}


export function registerKnowledgeSettingsNavigation(ctx, FilemanPanel, panelId) {
  const register = (name, options, Component, allowWithoutShell = false) => ctx.slots.inject(name, () => {
    let shell, section, disposeEntry, stopped = false
    const sync = () => {
      if (stopped) return
      const next = currentShell(ctx.slots)
      const nextSection = ctx.slots.entriesOfSlot('settings.section').find(entry => entry.options.id === RAG_SETTINGS_ID)
      if (next === shell && nextSection === section && disposeEntry) return
      disposeEntry?.()
      disposeEntry = undefined
      shell = next
      section = nextSection
      if (!shell && !allowWithoutShell) return
      const captured = shell
      disposeEntry = ctx.slots.register({
        name, ...options,
        ...(captured ? { store: captured.store } : {}),
        inject: () => ({ navigationIsCurrent: () => canNavigate(ctx.slots, captured) }),
      }, Component)
    }
    const offShell = ctx.slots.subscribe('sidebar.settings', sync)
    const offSection = ctx.slots.subscribe('settings.section', sync)
    sync()
    return () => { stopped = true; offShell(); offSection(); disposeEntry?.() }
  })
  register('main', { key: panelId }, FilemanPanel, true)
  register('sidebar.footer.action', { id: 'knowledge-rag-deep-link', order: 100 }, KnowledgeRagDeepLink)
}
