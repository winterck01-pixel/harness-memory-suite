/** Refresh shared media libraries across panels and browser tabs without polling. */
const channelName = 'dsh-shared-assets';
const events = ['dsh-image-assets-changed', 'dsh-video-assets-changed'];
export function announceAssetsChanged(kind = 'image') {
  window.dispatchEvent(new Event(`dsh-${kind}-assets-changed`));
  try {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage({kind});
    channel.close();
  } catch { /* Focus and panel activation still refresh when channels are unavailable. */ }
}
export function subscribeAssetChanges(refresh, appId) {
  const changed = () => { if (!document.hidden) refresh(); };
  const activated = event => { if (event.detail?.id === appId) changed(); };
  for (const event of events) window.addEventListener(event, changed);
  window.addEventListener('focus', changed);
  window.addEventListener('dsh-app-activated', activated);
  document.addEventListener('visibilitychange', changed);
  let channel;
  try { channel = new BroadcastChannel(channelName); channel.onmessage = event => { if (['image','video'].includes(event.data?.kind)) changed(); }; } catch {}
  return () => {
    for (const event of events) window.removeEventListener(event, changed);
    window.removeEventListener('focus', changed);
    window.removeEventListener('dsh-app-activated', activated);
    document.removeEventListener('visibilitychange', changed);
    channel?.close();
  };
}
