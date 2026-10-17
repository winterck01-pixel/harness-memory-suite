


window.__ModuleLoader__.load({
  id: 'dsh-skill-manager',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const ReactDom = require("react-dom");
    const { IconSparkleRegular } = require("@deepseek-ai/dsh-client-ui-primitives");

    const h = React.createElement;
    const { useState, useEffect, useCallback, useRef, useSyncExternalStore } = React;
    const name = "dsh-skill-manager";

    const API = "/api/skill-manager";
    const PANEL_ID = "skill-manager";
    let currentSession, currentDirectory;
    const listeners = new Set();
    const sessionSnapshot = () => JSON.stringify([currentSession?.getSnapshot()?.key || "", currentDirectory?.getSnapshot() ?? null]);
    const sessionSubscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
    const notifySession = () => { for (const fn of listeners) fn(); };
    const statusLabel = entry => ({effective:"当前会话生效",shadowed:"同名覆盖",invalid:"格式无效","file-disabled":"此文件已关闭",unavailable:"会话不可用",unverified:"未核验会话"})[entry.status] || "未核验会话";
    const STYLE_ID = "dsh-skill-manager-styles";


    function ensureStyle() {
      if (document.getElementById(STYLE_ID) !== null) return;
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.dataset.plugin = name;
      style.textContent = `
.dskm-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; font-size: 13px; }
.dskm-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px; }
.dskm-head h2 { margin: 0; font-size: 14px; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dskm-btn { appearance: none; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); background: transparent; color: inherit;
  border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; white-space: nowrap; }
.dskm-btn:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.dskm-btn.primary { background: color-mix(in srgb, currentColor 12%, transparent); font-weight: 600; }
.dskm-btn:disabled { opacity: .45; cursor: default; }
.dskm-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 12px; }
.dskm-row { display: flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left; appearance: none;
  background: transparent; border: 0; color: inherit; font: inherit; cursor: pointer;
  padding: 8px 8px; border-radius: 8px; }
.dskm-row:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
.dskm-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; }
.dskm-dot.on { background: #22a06b; box-shadow: 0 0 0 3px color-mix(in srgb, #22a06b 22%, transparent); }
.dskm-dot.off { background: color-mix(in srgb, currentColor 30%, transparent); }
.dskm-dot.err { background: #d97706; }
.dskm-main { flex: 1; min-width: 0; }
.dskm-name { font-weight: 600; display: flex; align-items: center; gap: 6px; }
.dskm-name span.t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dskm-tag { flex: none; font-size: 10px; padding: 1px 6px; border-radius: 99px;
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent); opacity: .75; }
.dskm-desc { font-size: 11px; opacity: .62; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.dskm-err { font-size: 11px; color: #d97706; margin-top: 2px; }
.dskm-group { font-size: 11px; opacity: .55; padding: 10px 8px 4px; letter-spacing: .04em; }
.dskm-detail, .dskm-editor { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 0 12px 12px; gap: 10px; }
.dskm-meta { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 12px;
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 8px; padding: 8px 10px; }
.dskm-meta .k { opacity: .55; white-space: nowrap; }
.dskm-meta .v { min-width: 0; overflow-wrap: anywhere; }
.dskm-body { flex: 1; min-height: 0; overflow: auto; white-space: pre-wrap; word-break: break-word;
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 8px;
  padding: 10px 12px; font-size: 12px; line-height: 1.6; background: color-mix(in srgb, currentColor 4%, transparent); }
.dskm-textarea { flex: 1; min-height: 0; resize: none; font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 8px; padding: 10px 12px;
  background: transparent; color: inherit; outline: none; }
.dskm-textarea:focus { border-color: color-mix(in srgb, currentColor 45%, transparent); }
.dskm-input { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 8px;
  padding: 6px 10px; font-size: 13px; background: transparent; color: inherit; outline: none; width: 100%; }
.dskm-input:focus { border-color: color-mix(in srgb, currentColor 45%, transparent); }
.dskm-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dskm-hint { font-size: 11px; opacity: .6; }
.dskm-error { font-size: 12px; color: #d97706; white-space: pre-wrap; }
.dskm-empty { opacity: .55; text-align: center; padding: 32px 12px; line-height: 1.7; }
.dskm-spin { opacity: .5; text-align: center; padding: 32px 0; }
`;
      document.head.appendChild(style);
    }


    async function api(path, init) {
      const response = await fetch(API + path, init)
      const value = await response.json().catch(() => null)
      if (!response.ok || value === null) {
        throw new Error((value !== null && value.error) || `请求失败（HTTP ${response.status}）`)
      }
      return value
    }

    const fmtTime = (ms) =>
      ms > 0 ? new Date(ms).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"

    function InvocationBadge({ entry }) {
      if (!entry.invocation) return null
      const tags = []
      if (!entry.invocation.modelInvocable) tags.push("模型不可自动调用")
      if (!entry.invocation.userInvocable) tags.push("不可手动 /")
      if (tags.length === 0) return null
      return h("span", { className: "dskm-tag" }, tags.join(" · "))
    }

    function SourceTag({ entry }) {
      return h("span", { className: "dskm-tag" }, entry.sourceLabel)
    }


    function SkillRow({ entry, onOpen }) {
      const dotClass = entry.error !== undefined ? "err" : entry.enabled ? "on" : "off"
      return h(
        "button",
        { className: "dskm-row", onClick: () => onOpen(entry) },
        h("span", { className: `dskm-dot ${dotClass}`, "aria-hidden": "true" }),
        h(
          "div",
          { className: "dskm-main" },
          h(
            "div",
            { className: "dskm-name" },
            h("span", { className: "t" }, entry.name ?? entry.dirName),
            h("span", { className: "dskm-tag" }, statusLabel(entry)),
            entry.writable ? null : h("span", { className: "dskm-tag" }, "只读"),
            h(InvocationBadge, { entry }),
          ),
          entry.description !== undefined && entry.description !== ""
            ? h("div", { className: "dskm-desc", title: entry.description }, entry.description)
            : null,
          entry.error !== undefined ? h("div", { className: "dskm-err" }, entry.error) : null,
          entry.notice ? h("div", {className:"dskm-err"}, entry.notice) : null,
        ),
      )
    }

    function ListView({ state, onOpen, onRefresh, onCreate }) {
      const { skills, loading, error } = state

      const groups = []
      for (const entry of skills ?? []) {
        const last = groups[groups.length - 1]
        if (last !== undefined && last.source === entry.source) last.items.push(entry)
        else groups.push({ source: entry.source, label: entry.sourceLabel, items: [entry] })
      }
      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "dskm-head" },
          h("h2", null, "技能"),
          h("button", { className: "dskm-btn", onClick: onRefresh, disabled: loading }, loading ? "刷新中…" : "刷新"),
          h("button", { className: "dskm-btn primary", onClick: onCreate }, "新建"),
        ),
        h("div", {className:"dskm-hint",style:{padding:"0 12px 8px",overflowWrap:"anywhere"}}, state.cwd ? `当前会话目录：${state.cwd} · ${state.authoritative ? "官方 Registry 已核验" : "尚未核验"}` : "未选择会话；仅显示用户文件"),
        state.warning ? h("div",{className:"dskm-error"},state.warning) : null,
        error !== undefined
          ? h("div", { className: "dskm-error", style: { padding: "0 12px" } }, error)
          : null,
        h(
          "div",
          { className: "dskm-list" },
          loading && (skills === undefined || skills === null)
            ? h("div", { className: "dskm-spin" }, "正在扫描技能目录…")
            : groups.length === 0
              ? h(
                  "div",
                  { className: "dskm-empty" },
                  "还没有任何技能。",
                  h("br", null),
                  "点「新建」创建，或让 agent 把 SKILL.md 写进 ~/.dsh/skills/。",
                )
              : groups.map((group) =>
                  h(
                    React.Fragment,
                    { key: group.source },
                    h("div", { className: "dskm-group" }, group.label),
                    group.items.map((entry) => h(SkillRow, { key: entry.id, entry, onOpen })),
                  ),
                ),
        ),
      )
    }


    function DetailView({ entry, content, onLoad, onBack, onEdit, onToggle, busy }) {
      useEffect(() => {
        onLoad(entry)
      }, [entry.id])
      const dotClass = entry.error !== undefined ? "err" : entry.enabled ? "on" : "off"
      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "dskm-head" },
          h("button", { className: "dskm-btn", onClick: onBack }, "← 返回"),
          h("h2", null, entry.name ?? entry.dirName),
        ),
        h(
          "div",
          { className: "dskm-detail" },
          h(
            "div",
            { className: "dskm-meta" },
            h("span", { className: "k" }, "状态"),
            h(
              "span",
              { className: "v" },
              h("span", { className: `dskm-dot ${dotClass}`, style: { display: "inline-block", marginRight: 6, verticalAlign: "middle" } }),
              statusLabel(entry),
            ),
            h("span", { className: "k" }, "实际生效文件"),
            h("span", {className:"v"}, entry.effectiveFile || "无 / 尚未核验"),
            h("span", {className:"k"}, "同名副本"),
            h("span", {className:"v"}, (entry.copies||[]).map(x=>`${x.sourceLabel}: ${x.file} (${x.enabled ? "文件开启" : "文件关闭"})`).join("；") || "无"),
            h("span", { className: "k" }, "来源"),
            h("span", { className: "v" }, entry.sourceLabel),
            h("span", { className: "k" }, "模型调用"),
            h("span", { className: "v" }, entry.invocation ? (entry.invocation.modelInvocable ? "允许（任务匹配时自动加载）" : "禁止（仅手动 /名 调用）") : "—"),
            h("span", { className: "k" }, "手动调用"),
            h("span", { className: "v" }, entry.invocation ? (entry.invocation.userInvocable ? "允许（消息里输入 /技能名）" : "禁止") : "—"),
            entry.whenToUse
              ? [h("span", { className: "k", key: "k" }, "适用场景"), h("span", { className: "v", key: "v" }, entry.whenToUse)]
              : null,
            h("span", { className: "k" }, "文件"),
            h("span", { className: "v" }, entry.file),
            h("span", { className: "k" }, "更新时间"),
            h("span", { className: "v" }, fmtTime(entry.updatedAt)),
          ),
          h("div", {className:"dskm-hint"}, "开关仅作用于此文件；同名副本可能继续生效。已有加载正文不会撤回，目录在下一轮刷新。"),
          content === null
            ? h("div", { className: "dskm-body" }, "加载中…")
            : content instanceof Error
              ? h("div", { className: "dskm-error" }, String(content.message ?? content))
              : h("div", { className: "dskm-body" }, content),
          h(
            "div",
            { className: "dskm-actions" },
            entry.writable
              ? h(
                  "button",
                  { className: "dskm-btn primary", onClick: onToggle, disabled: busy || entry.error !== undefined },
                  entry.enabled ? "仅关闭此文件" : "仅开启此文件",
                )
              : h("span", { className: "dskm-hint" }, "此来源为只读"),
            entry.writable
              ? h("button", { className: "dskm-btn", onClick: onEdit, disabled: busy }, "编辑")
              : null,
          ),
        ),
      )
    }


    function EditorView({ entry, initialContent, onSave, onBack, busy, errorText }) {
      const [text, setText] = useState(initialContent ?? "")
      const [dirName, setDirName] = useState(entry !== undefined ? entry.dirName : "")
      const isCreate = entry === undefined
      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "dskm-head" },
          h("button", { className: "dskm-btn", onClick: onBack, disabled: busy }, "← 取消"),
          h("h2", null, isCreate ? "新建技能" : `编辑：${entry.name ?? entry.dirName}`),
        ),
        h(
          "div",
          { className: "dskm-editor" },
          isCreate
            ? h("input", {
                className: "dskm-input",
                placeholder: "技能目录名（小写字母/数字/中划线，如 code-review）",
                value: dirName,
                onChange: (event) => setDirName(event.target.value),
                spellCheck: false,
              })
            : null,
          h("textarea", {
            className: "dskm-textarea",
            value: text,
            onChange: (event) => setText(event.target.value),
            spellCheck: false,
          }),
          errorText !== undefined ? h("div", { className: "dskm-error" }, errorText) : null,
          h(
            "div",
            { className: "dskm-actions" },
            h(
              "button",
              {
                className: "dskm-btn primary",
                disabled: busy || text.trim() === "" || (isCreate && dirName.trim() === ""),
                onClick: () => onSave({ dirName: dirName.trim(), content: text }),
              },
              busy ? "保存中…" : "保存此文件",
            ),
            h("span", { className: "dskm-hint" }, "frontmatter 需要 name 与 description 两个字段"),
          ),
        ),
      )
    }


    const VIEW_STATE_KEY = "dsh-skill-manager:view:v1";
    function readViewState() {
      try {
        const value = JSON.parse(sessionStorage.getItem(VIEW_STATE_KEY) || "null");
        if (!value || !["detail", "edit"].includes(value.kind) || typeof value.file !== "string") return null;
        return { kind: value.kind, file: value.file, id: typeof value.id === "string" ? value.id : "", sessionId:value.sessionId,contextKey:value.contextKey,sha256:value.sha256,content: typeof value.content === "string" ? value.content.slice(0, 256 * 1024) : null };
      } catch { return null; }
    }

    function SkillPanel() {
      const contextKey = useSyncExternalStore(sessionSubscribe,sessionSnapshot,()=> '["",null]');
      const [sessionId] = JSON.parse(contextKey);
      const request = useCallback((path,init) => api(path + (path.includes("?") ? "&" : "?") + "sessionId=" + encodeURIComponent(sessionId),init),[sessionId,contextKey]);
      const requestRevision=useRef(0);
      const selectedContext=useRef(contextKey);const selectedSession=useRef(sessionId);const uiGeneration=useRef(0);if(selectedContext.current!==contextKey)uiGeneration.current++;selectedContext.current=contextKey;selectedSession.current=sessionId;
      const readHash=useRef(null);
      const [state, setState] = useState({ loading: true })
      const [view, setView] = useState({ kind: "list" })
      const [content, setContent] = useState(null)
      const restoreView = useRef(readViewState())
      const [busy, setBusy] = useState(false)
      const [errorText, setErrorText] = useState(undefined)

      const refresh = useCallback(async () => {
        const revision=++requestRevision.current;
        setState((prev) => ({ ...prev, loading: true, error: undefined }))
        try {
          const data = await request("/list")
          if(revision!==requestRevision.current || selectedSession.current!==sessionId || selectedContext.current!==contextKey)return;
          setState({ ...data,contextKey,loading:false })
          const saved = restoreView.current
          if (saved && saved.sessionId===sessionId && saved.contextKey===contextKey) {
            restoreView.current = null
            const entry = (data.skills ?? []).find((item) => item.file === saved.file || (saved.id && item.id === saved.id))
            if (entry) {
              readHash.current=saved.sha256??null;
              setView({ contextKey,kind: saved.kind==="edit" && !saved.sha256 ? "detail" : saved.kind, entry })
              if (saved.kind === "edit" && saved.content !== null) setContent(saved.content)
            }
          }

          return data
        } catch (error) {
          if(revision!==requestRevision.current || selectedSession.current!==sessionId || selectedContext.current!==contextKey)return;
          setState((prev) => ({ ...prev, loading: false, error: String(error.message ?? error) }))
        }
      }, [request])

      useEffect(() => {
        setView({kind:"list"});setContent(null);readHash.current=null;setBusy(false);setErrorText(undefined);
      }, [sessionId])
      useEffect(() => { refresh() }, [refresh])
      useEffect(() => {
        if(view.contextKey && view.contextKey!==contextKey) {
          setBusy(false);
          setErrorText('工作目录已切换，草稿已保留。请复制草稿后返回列表重新打开；旧目录编辑不能直接保存。');
        }
      }, [contextKey,view.contextKey])

      useEffect(() => {
        try {
          if (["detail", "edit"].includes(view.kind) && view.entry?.file) {
            const value = { sessionId,contextKey:view.contextKey,sha256:readHash.current,kind: view.kind, file: view.entry.file, id: view.entry.id, ...(view.kind === "edit" && typeof content === "string" ? { content: content.slice(0, 256 * 1024) } : {}) }
            sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify(value))
          } else {
            sessionStorage.removeItem(VIEW_STATE_KEY)
          }
        } catch {                                          }
      }, [view, content,sessionId])

      const openDetail = useCallback((entry) => {
        if(state.loading || state.contextKey!==contextKey)return;
        uiGeneration.current++;readHash.current=null;setBusy(false);
        setContent(null)
        setView({ kind: "detail", entry,contextKey })
      }, [contextKey,state.loading,state.contextKey])

      const loadContent = useCallback(async (entry) => {
        const selected=sessionId;const generation=uiGeneration.current;
        setContent(null)
        try {
          const data = await request(`/read?path=${encodeURIComponent(entry.file)}`)
          if((selectedSession.current!==selected || uiGeneration.current!==generation))return;
          readHash.current=data.sha256;
          setContent(data.content)
        } catch (error) {
          if((selectedSession.current===selected && uiGeneration.current===generation))setContent(error)
        }
      }, [request])

      const toggle = useCallback(async () => {
        const selected=sessionId;const generation=uiGeneration.current;
        const entry = view.entry
        if (entry === undefined) return
        setBusy(true)
        setErrorText(undefined)
        try {
          if(view.contextKey!==contextKey) throw new Error('工作目录已切换，请从当前列表重新打开');
          await request("/toggle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expectedCwd:state.cwd,path: entry.file, enable: !entry.enabled }),
          })
          if((selectedSession.current!==selected || uiGeneration.current!==generation))return;


          const data=await refresh()
          if((selectedSession.current!==selected || uiGeneration.current!==generation))return;
          const fresh = (data?.skills ?? []).find((item) => item.id === entry.id)
            ?? (data?.skills ?? []).find((item) => item.name === entry.name && item.root === entry.root)
          if (fresh !== undefined) setView({ kind: "detail", entry: fresh,contextKey })
          else setView({ kind: "list" })
        } catch (error) {
          if((selectedSession.current===selected && uiGeneration.current===generation))setErrorText(String(error.message ?? error))
        } finally {
          if((selectedSession.current===selected && uiGeneration.current===generation))setBusy(false)
        }
      }, [view, refresh, request,state.cwd])

      const startEdit = useCallback(async () => {
        const selected=sessionId;const generation=uiGeneration.current;
        const entry = view.entry
        setBusy(true)
        setErrorText(undefined)
        try {
          if(view.contextKey!==contextKey)throw new Error('工作目录已切换，请从当前列表重新打开');
          const data = await request(`/read?path=${encodeURIComponent(entry.file)}`)
          if((selectedSession.current!==selected || uiGeneration.current!==generation))return;
          readHash.current=data.sha256;
          setContent(data.content)
          setView({ kind: "edit", entry,contextKey })
        } catch (error) {
          if((selectedSession.current===selected && uiGeneration.current===generation))setErrorText(String(error.message ?? error))
        } finally {
          if((selectedSession.current===selected && uiGeneration.current===generation))setBusy(false)
        }
      }, [view,request])

      const save = useCallback(
        async ({ dirName, content }) => {
        const selected=sessionId;const generation=uiGeneration.current;
          setBusy(true)
          setErrorText(undefined)
          try {
            if(view.contextKey!==contextKey) throw new Error('工作目录已切换，请保留草稿并从当前列表重新打开');
            const root = state.roots !== undefined ? state.roots.find((item) => item.writable && item.source === "user-dsh") : undefined
            const rootPath = view.entry?.root ?? (root !== undefined ? root.path : (state.roots ?? []).find((item) => item.writable)?.path)
            await request("/save", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ expectedCwd:state.cwd,root: rootPath, dir: dirName, content, path:view.kind==="edit"?view.entry?.file:undefined, expectedHash:readHash.current }),
            })
            if((selectedSession.current!==selected || uiGeneration.current!==generation))return;
            await refresh()
            if((selectedSession.current!==selected || uiGeneration.current!==generation))return;
            setView({ kind: "list" })
          } catch (error) {
            if((selectedSession.current===selected && uiGeneration.current===generation))setErrorText(String(error.message ?? error))
          } finally {
            if((selectedSession.current===selected && uiGeneration.current===generation))setBusy(false)
          }
        },
        [state.roots, refresh, request,view],
      )

      const startCreate = useCallback(() => {
        if(state.loading || state.contextKey!==contextKey)return;
        uiGeneration.current++;readHash.current=null;setBusy(false);
        setErrorText(undefined)
        setView({ kind: "create",contextKey })
      }, [contextKey,state.loading,state.contextKey])

      return h(
        "div",
        { className: "dskm-panel" },
        errorText ? h("div", {className:"dskm-error"},errorText):null,
        view.kind === "list"
          ? h(ListView, { state, onOpen: openDetail, onRefresh: refresh, onCreate: startCreate })
          : view.kind === "detail"
            ? h(DetailView, {
                entry: view.entry,
                content,
                onLoad: loadContent,
                onBack: () => {uiGeneration.current++;setContent(null);readHash.current=null;setBusy(false);setView({ kind: "list" })},
                onEdit: startEdit,
                onToggle: toggle,
                busy,
              })
            : h(EditorView, {
                entry: view.kind === "edit" ? view.entry : undefined,
                initialContent: view.kind === "edit" ? content : undefined,
                onSave: save,
                onBack: () => {uiGeneration.current++;setContent(null);readHash.current=null;setBusy(false);setView({ kind: "list" })},
                busy,
                errorText,
              }),
      )
    }

    function SkillPanelIcon({ size }) {
      return h(IconSparkleRegular, { size })
    }


    function apply(ctx) {
      ensureStyle();
      ctx.inject(["uiSession"], c=>c.effect(()=>{
        currentSession=c.uiSession.adapter.current;
        let stopDirectory=()=>{};
        const bindDirectory=()=>{
          stopDirectory();
          currentDirectory=currentSession.getSnapshot()?.keyedHooks?.projection?.('workingDirectory');
          stopDirectory=currentDirectory?.subscribe(notifySession) ?? (()=>{});
          notifySession();
        };
        const dispose=currentSession.subscribe(bindDirectory);bindDirectory();
        return ()=>{dispose();stopDirectory();currentDirectory=undefined;currentSession=undefined;notifySession();};
      }));


      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: 50, label: "技能" }, SkillPanelIcon),
      );
      ctx.slots.inject("main", () =>
        ctx.slots.register({ name: "main", key: PANEL_ID }, SkillPanel),
      );
    }

    ensureStyle();

    exports.name = name;
    exports.inject = ["slots"];
    exports.apply = apply;
    exports.SkillPanel = SkillPanel;
    return module.exports;
  },
});
