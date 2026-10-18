// Host-owned tokens inherit from body, including body portals. No theme state.
export const themeCss=`
:where(.lf,.dsh-plugin-surface,.dsh-image-edit,.dsh-asset-name){
 --bg:var(--dsw-alias-bg-base,#fff);--panel:var(--dsw-alias-bg-layer-1,#fff);--surface:var(--dsw-alias-bg-layer-2,#f5f6f7);
 --line:var(--dsw-alias-border-l3,#d4d4d4);--text:var(--dsw-alias-label-primary,#0f1115);--muted:var(--dsw-alias-label-secondary,#61666b);
 --accent:var(--dsw-alias-link,#4176e6);--hover:var(--dsw-alias-interactive-bg-hover,#2631480f);--selected:var(--dsw-alias-interactive-bg-active,#2631481a);
 font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif);font-size:var(--dsh-content-font-size,14px);line-height:1.57;color:var(--text);color-scheme:light;
}
body[data-ds-dark-theme] :where(.lf,.dsh-plugin-surface,.dsh-image-edit,.dsh-asset-name){color-scheme:dark}
:where(.dsh-plugin-surface,.dsh-image-edit) :where(button,input,select,textarea){box-sizing:border-box;font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:var(--dsw-radius-sm,8px);padding:6px 10px;max-width:100%}
:where(.dsh-plugin-surface,.dsh-image-edit) button{cursor:pointer}
:where(.dsh-plugin-surface,.dsh-image-edit) :where(button,a)[aria-pressed=true],.dsh-image-edit [aria-selected=true]{background:var(--selected);border-color:var(--dsw-static-neutral-bluish-400,#adb2b8)}
:where(.lf,.dsh-plugin-surface,.dsh-image-edit) :where(button,a,[role=button]):hover:not(:disabled){background:var(--hover)}
:where(.lf,.dsh-plugin-surface,.dsh-image-edit,.dsh-asset-name) :where(button,a,input,select,textarea,[role=button]):focus-visible{outline:2px solid var(--accent);outline-offset:2px}
:where(.lf,.dsh-plugin-surface,.dsh-image-edit) :where(button,input,select,textarea):disabled{cursor:not-allowed;opacity:.5}
:where(.lf,.dsh-plugin-surface,.dsh-image-edit) :where(input,textarea)::placeholder{color:var(--muted);opacity:1}
:where(.dsh-plugin-surface,.dsh-image-edit) small{color:var(--muted)}
:where(.lf,.dsh-plugin-surface,.dsh-image-edit,.dsh-asset-name) [role=alert]{color:var(--text);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ec1313) 9%,var(--panel));border-left:3px solid var(--dsw-alias-state-error-primary,#ec1313);padding:8px 10px;border-radius:4px}
.dsh-plugin-surface{background:var(--panel);border:1px solid var(--line)}
.dsh-reference-mask{background:var(--dsw-alias-bg-mask-1,#0008)}
.dsh-reference-picker button[aria-pressed=true]{background:var(--selected)!important;border-color:var(--accent)!important}
.dsh-reference-picker button:hover:not(:disabled){background:var(--hover)!important}
.dsh-reference-picker img{background:var(--surface)!important}
.dsh-reference-picker header{align-items:center}.dsh-reference-picker header>strong{font-weight:600}
.dsh-reference-picker nav button[aria-pressed=true]{background:var(--selected)!important}
.dsh-reference-picker footer button:last-child:not(:disabled){background:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}
.dsh-image-edit>div{color:var(--text)}.dsh-image-edit select,.dsh-image-edit textarea{background:var(--surface)!important;border-color:var(--line)!important}
.dsh-image-edit button:hover:not(:disabled){background:var(--hover)!important}
.dsh-image-edit [role=option][aria-selected=true]{background:var(--selected)!important}
.dsh-image-edit [role=listbox]{background:var(--panel);border-color:var(--line)!important}
.dsh-image-edit{border-color:var(--line)!important}
.dsh-name-row input{background:var(--surface)!important;border-color:var(--accent)!important}
.dsh-name-row button:hover{background:var(--hover)!important;color:var(--text)!important}
.dsh-preview-notice{background:var(--dsw-alias-state-success-tertiary,#e6faed)!important;color:var(--text)!important}
.dsh-preview-nav{background:var(--panel)!important;border-color:var(--line)!important;color:var(--text)!important;box-shadow:0 2px 8px #0002}
.dsh-preview-nav:hover:not(:disabled){background:var(--surface)!important;border-color:var(--accent)!important;color:var(--text)!important}
.dsh-preview-controls{background:var(--panel)!important;border-color:var(--line)!important;color:var(--text)!important}
.dsh-preview-controls :where(button,a):hover{background:var(--hover)!important;color:var(--text)!important}
.dsh-history-preview.is-fullscreen>header{background:var(--panel);color:var(--text)}
.dsh-history-preview.is-fullscreen .dsh-preview-full-actions{background:var(--panel);color:var(--text)}
`;
