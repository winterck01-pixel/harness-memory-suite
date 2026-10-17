
export const ragStyles = `
.dkr-section{max-width:720px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px;min-width:0}
.dkr-title{margin:0;font-size:16px;font-weight:500;line-height:24px}.dkr-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}
.dkr-rows{display:flex;flex-direction:column;gap:8px;margin:12px 0 0}.dkr-card{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);display:flex;flex-direction:column;gap:12px;padding:12px 14px;min-width:0}
.dkr-card-head,.dkr-toggle{display:flex;align-items:center;justify-content:space-between;gap:10px}.dkr-card-head h3{margin:0;font-size:14px;font-weight:500;line-height:22px}.dkr-toggle{font-size:13px;line-height:20px}
.dkr-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}.dkr-error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}.dkr-saved{color:var(--dsw-alias-state-success-primary);margin:0;font-size:12px;line-height:18px}
.dkr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.dkr-grid>*{min-width:0}.dkr-field{display:flex;flex-direction:column;gap:6px;padding:12px 0;min-width:0}.dkr-field-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}
.dkr-select{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);width:100%;height:34px;font:inherit;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);padding:0 10px;font-size:13px;line-height:20px;min-width:0}.dkr-select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}.dkr-select:disabled{opacity:.6;cursor:default}.dkr-select[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}
.dkr-instructions{box-sizing:border-box;width:100%;min-width:0;min-height:96px;resize:vertical;padding:8px 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}.dkr-instructions:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}.dkr-instructions[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}.dkr-instructions:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dkr-details{border-top:.5px solid var(--dsw-alias-border-l2);padding-top:12px}.dkr-details>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.dkr-details[open]>summary{margin-bottom:12px}.dkr-details>summary:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);outline-offset:2px}
.dkr-actions,.dkr-feedback,.dkr-entry{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dkr-actions{justify-content:flex-end;padding-top:12px}.dkr-feedback{align-items:flex-start}.dkr-entry{font-size:13px;line-height:20px;padding:12px 14px;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill)}.dkr-entry.dkr-compact{padding:0;border:0;background:transparent}
.dkr-model-shortcuts{display:flex;flex-wrap:wrap;gap:8px;min-width:0}.dkr-model-shortcuts>button{max-width:100%;height:auto;min-height:28px;white-space:normal;overflow-wrap:anywhere;text-align:left}
.dkr-ops{display:flex;flex-direction:column;gap:12px}.dkr-results{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}.dkr-result{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);padding:10px 12px;overflow-wrap:anywhere;font-size:13px;line-height:20px}.dkr-result p{margin:6px 0 0;white-space:pre-wrap}.dkr-capabilities{display:flex;flex-wrap:wrap;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
@media(max-width:560px){.dkr-grid{grid-template-columns:minmax(0,1fr)}.dkr-card{padding:12px}.dkr-card-head{align-items:flex-start}.dkr-toggle>span{flex:1;min-width:0}.dkr-entry{align-items:flex-start}}
/* Scope the narrow-screen host layout to this mounted section. The installed
   SettingsShell exposes a semantic dialog with direct nav/content children;
   keep its native navigation, actions and close control rather than replacing it. */
@media(max-width:560px){
[data-shortcut-modal="settings"][role="dialog"]:has(.dkr-section){flex-direction:column}
[data-shortcut-modal="settings"][role="dialog"]:has(.dkr-section)>nav{width:100%;min-width:0;padding:12px 12px 0;gap:8px}
[data-shortcut-modal="settings"][role="dialog"]:has(.dkr-section)>nav>div:last-child{flex-direction:row;flex:none;width:100%;min-width:0;overflow-x:auto;overflow-y:hidden}
[data-shortcut-modal="settings"][role="dialog"]:has(.dkr-section)>nav>div:last-child>button{flex:none;white-space:nowrap}
[data-shortcut-modal="settings"][role="dialog"]:has(.dkr-section)>nav+div{width:100%;min-width:0;min-height:0}
[data-shortcut-modal="settings"][role="dialog"]:has(.dkr-section)>nav+div>div:first-child{height:44px;padding:8px 12px}
[data-shortcut-modal="settings"][role="dialog"]:has(.dkr-section)>nav+div>div:last-child{padding:0 12px 12px}
}
`
