
window.__ModuleLoader__.load({id:'dsh-reader',factory:(require)=>{const module={exports:{}};const exports=module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(


  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);


var client_exports = {};
__export(client_exports, {
  ReaderIcon: () => ReaderIcon,
  ReaderPanel: () => ReaderPanel,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);


var import_react = __toESM(require("react"), 1);


var ApiError = class extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
};
async function api(route, { method = "GET", body, signal, keepalive = false } = {}) {
  const path = method === "POST" && ["books", "book", "reading", "settings"].includes(route) ? `${route}/write` : route;
  const response = await fetch(`/api/reader/${path}`, { method, signal, keepalive, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : void 0, body: body ? JSON.stringify(body) : void 0 });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || "READER_UNAVAILABLE", response.status);
  return data;
}
var rid = () => crypto.randomUUID();
var assetUrl = (book, part) => `/api/reader/asset?id=${encodeURIComponent(book.bookId)}&revision=${book.revision}&part=${encodeURIComponent(part)}`;
function createClient() {
  const queues =                 new Map(), readings =                 new Map(), uncertain =                 new Map(), conflicts =                 new Set();
  function enqueue(bookId, operation) {
    const prior = queues.get(bookId) || Promise.resolve();
    const result = prior.catch(() => {
    }).then(operation);
    queues.set(bookId, result);
    return result;
  }
  async function loadReading(bookId) {
    await queues.get(bookId)?.catch(() => {
    });
    const reading = await api(`reading?id=${encodeURIComponent(bookId)}`);
    readings.set(bookId, reading);
    return reading;
  }
  async function replayPending(bookId) {
    const pending = uncertain.get(bookId);
    if (!pending) return readings.get(bookId);
    try {
      const result = await api(pending.route, { method: "POST", body: pending.body, keepalive: true });
      readings.set(bookId, result);
      uncertain.delete(bookId);
      return result;
    } catch (error) {
      await handleConflict(bookId, error);
      throw error;
    }
  }
  async function handleConflict(bookId, error) {
    if (error.status !== 409) return;
    uncertain.delete(bookId);
    conflicts.add(bookId);
    readings.set(bookId, await api(`reading?id=${encodeURIComponent(bookId)}`));
  }
  function write(bookId, route, data) {
    return enqueue(bookId, async () => {
      if (conflicts.has(bookId)) throw new ApiError("READING_CONFLICT", 409);
      if (uncertain.has(bookId)) await replayPending(bookId);
      const old = readings.get(bookId) || await loadReadingDirect(bookId);
      const body = { ...data, bookId, expectedServerRevision: old.serverRevision, requestId: rid() };
      try {
        const result = await api(route, { method: "POST", body, keepalive: true });
        readings.set(bookId, result);
        return result;
      } catch (error) {
        if (!error.status) uncertain.set(bookId, { route, body });
        await handleConflict(bookId, error);
        throw error;
      }
    });
  }
  async function loadReadingDirect(bookId) {
    const r = await api(`reading?id=${encodeURIComponent(bookId)}`);
    readings.set(bookId, r);
    return r;
  }
  return { loadReading, write, retry: (bookId) => enqueue(bookId, () => replayPending(bookId)), current: (bookId) => readings.get(bookId), resolve: (bookId) => conflicts.delete(bookId) };
}


function imageRagRequest(book, part, action, remote = false, query = "", ocrEngine = "auto") {
  const pageNumber = book.parts.findIndex((p) => p.id === part.id) + 1;
  if (!["pdf", "comic"].includes(book.kind) || pageNumber < 1) throw Error("UNSUPPORTED_FORMAT");
  if (!["auto", "local", "configured"].includes(ocrEngine)) throw Error("INVALID_BUDGET");
  const source = { adapter: "reader", sourceId: book.bookId, partId: part.id, revision: String(book.revision) };
  if (action === "local" || action === "configured") return { route: "reader", body: { bookId: book.bookId, partId: part.id, revision: book.revision, ocrEngine: action === "local" ? "local" : "configured", allowRemote: action === "configured" && remote, consent: "selected-document" } };
  if (action === "query") return { route: "rag", body: { action: "search", query, queryImage: { ...source, pageNumber }, allowRemote: remote, consent: "query-and-candidates", imageConsent: "selected-query-image" } };
  if (!["indexText", "indexImage"].includes(action)) throw Error("INVALID_ACTION");
  return { route: "rag", body: { action: "indexSource", ...source, pageNumbers: [pageNumber], indexImages: action === "indexImage", ocrEngine, allowRemote: remote, consent: "selected-document", ...action === "indexImage" ? { imageConsent: "selected-pages" } : {} } };
}


var import_jsx_runtime = require("react/jsx-runtime");
function ImageRag({ book, part, t, onClose, onCitation }) {
  const [remote, setRemote] = (0, import_react.useState)(false), [action, setAction] = (0, import_react.useState)("local"), [query, setQuery] = (0, import_react.useState)(""), [ocrEngine, setOcrEngine] = (0, import_react.useState)("auto"), [busy, setBusy] = (0, import_react.useState)(false), [error, setError] = (0, import_react.useState)(null), [result, setResult] = (0, import_react.useState)(null);
  const epoch = (0, import_react.useRef)(0), pending = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    epoch.current++;
    pending.current?.abort();
    setRemote(false);
    setBusy(false);
    setError(null);
    setResult(null);
    return () => {
      epoch.current++;
      pending.current?.abort();
    };
  }, [book.bookId, book.revision, part.id]);
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const accepted = remote, request = imageRagRequest(book, part, action, accepted, query, ocrEngine), token = ++epoch.current, controller = new AbortController();
    pending.current = controller;
    setRemote(false);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let data;
      if (request.route === "reader") data = await api("process", { method: "POST", body: request.body, signal: controller.signal });
      else {
        const response = await fetch("/api/knowledge-rag/action", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body), signal: controller.signal });
        data = await response.json();
        if (!response.ok) throw new ApiError(data.error || "PROCESSING_UNAVAILABLE", response.status);
      }
      if (token === epoch.current) setResult(data);
    } catch (e2) {
      if (token === epoch.current && e2.name !== "AbortError") setError(e2.code || "PROCESSING_UNAVAILABLE");
    } finally {
      if (token === epoch.current) {
        setBusy(false);
        pending.current = null;
      }
    }
  }
  const needsRemote = action === "configured" || action === "indexImage" || action === "query" || action.startsWith("index") && ocrEngine === "configured";
  return                 (0, import_jsx_runtime.jsxs)("form", { className: "r-form", onSubmit: submit, children: [
                    (0, import_jsx_runtime.jsxs)("h2", { children: [
      t("imageRag"),
      " \xB7 ",
      t("imageRagSelectedPage"),
      " ",
      book.parts.findIndex((p) => p.id === part.id) + 1,
      " \xB7 ",
      t("version"),
      " ",
      book.revision
    ] }),
                    (0, import_jsx_runtime.jsxs)("p", { children: [
      book.title,
      " \xB7 ",
      t("version"),
      " ",
      book.revision,
      " \xB7 ",
      part.title,
      " \xB7 ",
      t("part"),
      " ",
      book.parts.findIndex((p) => p.id === part.id) + 1
    ] }),
                    (0, import_jsx_runtime.jsx)("p", { className: "r-file-hint", children: t("imageRagScope") }),
    !result &&                 (0, import_jsx_runtime.jsx)("p", { className: "r-muted", children: t("imageRagStatusUnknown") }),
                    (0, import_jsx_runtime.jsxs)("label", { children: [
      t("imageRagAction"),
                      (0, import_jsx_runtime.jsx)("select", { value: action, disabled: busy, onChange: (e) => {
        setAction(e.target.value);
        setRemote(false);
        setResult(null);
      }, children: ["local", "configured", "indexText", "indexImage", "query"].map((x2) =>                 (0, import_jsx_runtime.jsx)("option", { value: x2, children: t("imageRag_" + x2) }, x2)) })
    ] }),
    action.startsWith("index") &&                 (0, import_jsx_runtime.jsxs)("label", { children: [
      t("imageRagOcrEngine"),
                      (0, import_jsx_runtime.jsx)("select", { value: ocrEngine, disabled: busy, onChange: (e) => {
        setOcrEngine(e.target.value);
        setRemote(false);
      }, children: ["auto", "local", "configured"].map((x2) =>                 (0, import_jsx_runtime.jsx)("option", { value: x2, children: t("imageRagEngine_" + x2) }, x2)) })
    ] }),
    action === "query" &&                 (0, import_jsx_runtime.jsxs)("label", { children: [
      t("imageRagQuery"),
                      (0, import_jsx_runtime.jsx)("input", { type: "text", maxLength: 1e3, value: query, onChange: (e) => setQuery(e.target.value), disabled: busy })
    ] }),
                    (0, import_jsx_runtime.jsx)("label", { children:                 (0, import_jsx_runtime.jsxs)("span", { children: [
                      (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: remote, onChange: (e) => setRemote(e.target.checked), disabled: busy || action === "local" }),
      " ",
      t("imageRagConsent")
    ] }) }),
    action.startsWith("index") &&                 (0, import_jsx_runtime.jsx)("p", { children: t("imageRagReplace") }),
    error &&                 (0, import_jsx_runtime.jsx)("div", { role: "alert", className: "r-error", children: t(error) }),
                    (0, import_jsx_runtime.jsxs)("div", { className: "r-controls", children: [
                      (0, import_jsx_runtime.jsx)("button", { className: "r-primary", disabled: busy || needsRemote && !remote, children: t(busy ? "busy" : "imageRagRun") }),
                      (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => pending.current?.abort(), disabled: !busy, children: t("cancel") }),
                      (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: onClose, children: t("close") })
    ] }),
    result &&                 (0, import_jsx_runtime.jsxs)("div", { role: "status", children: [
      result.pages?.map((p) =>                 (0, import_jsx_runtime.jsxs)("div", { children: [
                        (0, import_jsx_runtime.jsx)("small", { children: p.textMethod }),
                        (0, import_jsx_runtime.jsx)("pre", { style: { whiteSpace: "pre-wrap" }, children: p.text })
      ] }, p.pageNumber)),
      result.results?.map((r, i) =>                 (0, import_jsx_runtime.jsxs)("div", { children: [
                        (0, import_jsx_runtime.jsx)("p", { children: r.text || r.content || r.snippet || r.title || t("imageRagResult") }),
        r.citation?.adapter === "reader" && r.citation?.sourceId &&                 (0, import_jsx_runtime.jsxs)("button", { type: "button", onClick: () => onCitation(r.citation), children: [
          t("preview"),
          " \xB7 ",
          r.citation.pageNumber
        ] })
      ] }, i)),
      typeof result.textChunks === "number" && typeof result.imageChunks === "number" &&                 (0, import_jsx_runtime.jsxs)("p", { children: [
        t("version"),
        " ",
        result.revision,
        " \xB7 ",
        t("imageRagTextChunks"),
        " ",
        result.textChunks,
        " \xB7 ",
        t("imageRagImageChunks"),
        " ",
        result.imageChunks
      ] }),
      !result.pages && !result.results &&                 (0, import_jsx_runtime.jsx)("p", { children: t("imageRagDone") })
    ] })
  ] });
}


var import_react2 = __toESM(require("react"), 1);
var import_jsx_runtime2 = require("react/jsx-runtime");
function AgentAuthorization({ bookId, t, onClose }) {
  const [state, setState] = (0, import_react2.useState)(null), [scope, setScope] = (0, import_react2.useState)("private"), [projects, setProjects] = (0, import_react2.useState)(""), [error, setError] = (0, import_react2.useState)(null), [busy, setBusy] = (0, import_react2.useState)(false);
  (0, import_react2.useEffect)(() => {
    const c = new AbortController();
    api(`access?id=${encodeURIComponent(bookId)}`, { signal: c.signal }).then((s) => {
      setState(s);
      setScope(s.scope);
      setProjects(s.projects.join("\n"));
    }).catch((e) => {
      if (e.name !== "AbortError") setError(e);
    });
    return () => c.abort();
  }, [bookId]);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await api("access/write", { method: "POST", body: { bookId, scope, projects: scope === "projects" ? projects.split("\n").map((s) => s.trim()).filter(Boolean) : [], expectedAuthorizationRevision: state.authorizationRevision, requestId: rid() } });
      setState(saved);
      setScope(saved.scope);
      setProjects(saved.projects.join("\n"));
    } catch (e2) {
      setError(e2);
    } finally {
      setBusy(false);
    }
  }
  return                 (0, import_jsx_runtime2.jsxs)("form", { className: "r-page r-form", onSubmit: save, children: [
                    (0, import_jsx_runtime2.jsx)("h2", { children: t("agentAccess") }),
                    (0, import_jsx_runtime2.jsx)("p", { children: t("agentAccessHint") }),
    error &&                 (0, import_jsx_runtime2.jsx)("p", { role: "alert", children: t(error.code || error.message) }),
                    (0, import_jsx_runtime2.jsxs)("label", { children: [
      t("agentAccessScope"),
                      (0, import_jsx_runtime2.jsx)("select", { disabled: !state || busy, "aria-label": t("agentAccessScope"), value: scope, onChange: (e) => setScope(e.target.value), children: ["private", "projects", "all"].map((s) =>                 (0, import_jsx_runtime2.jsx)("option", { value: s, children: t(`agentAccess_${s}`) }, s)) })
    ] }),
    scope === "projects" &&                 (0, import_jsx_runtime2.jsxs)("label", { children: [
      t("agentProjects"),
                      (0, import_jsx_runtime2.jsx)("textarea", { disabled: !state || busy, "aria-label": t("agentProjects"), required: true, value: projects, onChange: (e) => setProjects(e.target.value) })
    ] }),
                    (0, import_jsx_runtime2.jsx)("p", { children: state && (scope !== state.scope || scope === "projects" && projects.trim() !== state.projects.join("\n")) ? t("agentAccessUnsaved") : state?.scope === "private" ? t("agentPending") : t("agentAccessSaved") }),
                    (0, import_jsx_runtime2.jsxs)("div", { className: "r-controls", children: [
                      (0, import_jsx_runtime2.jsx)("button", { disabled: !state || busy, children: t(busy ? "busy" : "saveAccess") }),
                      (0, import_jsx_runtime2.jsx)("button", { type: "button", onClick: onClose, children: t("close") })
    ] })
  ] });
}


var import_react4 = __toESM(require("react"), 1);


var import_react3 = require("react");
var SERVICE = "dshLaunchpad";
var EMPTY_TASKS = Object.freeze({ image: Object.freeze([]), video: Object.freeze([]), updatedAt: 0 });
function registerLaunchpadApp(ctx, descriptor, label = "launchpad-app") {
  ctx.inject([SERVICE], (scope) => scope.effect(
    () => scope.get(SERVICE).registerApp(descriptor),
    `dsh-launchpad: ${label}`
  ));
}


var zh = { panel: "\u9605\u8BFB\u5668", description: "\u5C01\u9762\u4E66\u67B6\uFF0C\u9605\u8BFB\u5C0F\u8BF4\u3001\u5267\u672C\u4E0E\u6F2B\u753B\u3002", shelf: "\u4F5C\u54C1\u4E66\u67B6", tagline: "\u628A\u6545\u4E8B\u5E26\u5728\u8EAB\u8FB9", scope: "\u540C\u4E00\u64CD\u4F5C\u8005 \xB7 \u670D\u52A1\u7AEF\u7EED\u8BFB", all: "\u5168\u90E8", novel: "\u5C0F\u8BF4", script: "\u5267\u672C", comic: "\u6F2B\u753B", search: "\u641C\u7D22\u4E66\u540D\u3001\u4F5C\u8005\u6216\u6807\u7B7E", add: "\u52A0\u5165\u4E66\u67B6", loading: "\u8BFB\u53D6\u4E2D\u2026", empty: "\u4E66\u67B6\u8FD8\u6CA1\u6709\u4F5C\u54C1", emptyHint: "\u5BFC\u5165\u5DF2\u6709\u6587\u672C\u6216\u56FE\u7247\uFF0C\u4E5F\u53EF\u4EE5\u8BA9 Agent \u521B\u5EFA\u4E66\u7C4D\u3002", none: "\u6CA1\u6709\u5339\u914D\u4F5C\u54C1", author: "\u4F5C\u8005", title: "\u4E66\u540D", kind: "\u4F5C\u54C1\u7C7B\u578B", summary: "\u7B80\u4ECB", source: "\u6765\u6E90", text: "\u7C98\u8D34\u6B63\u6587", file: "\u670D\u52A1\u5668\u6587\u4EF6", knowledge: "\u77E5\u8BC6\u5E93", paths: "\u6587\u4EF6\u8DEF\u5F84\uFF0C\u6BCF\u884C\u4E00\u9879\uFF1B\u884C\u987A\u5E8F\u5C31\u662F\u9605\u8BFB\u987A\u5E8F", knowledgeIds: "\u77E5\u8BC6\u6761\u76EE ID\uFF0C\u6BCF\u884C\u4E00\u9879", body: "\u6B63\u6587\uFF08MD / TXT\uFF09", create: "\u521B\u5EFA\u4E66\u7C4D", cancel: "\u53D6\u6D88", back: "\u4E66\u67B6", toc: "\u76EE\u5F55", bookmark: "\u6DFB\u52A0\u4E66\u7B7E", bookmarks: "\u4E66\u7B7E", history: "\u5386\u53F2\u7248\u672C", noBookmarks: "\u6682\u65E0\u4E66\u7B7E", remove: "\u79FB\u9664", fontSize: "\u5B57\u53F7", lineHeight: "\u884C\u8DDD", theme: "\u4E3B\u9898", light: "\u660E\u4EAE", warm: "\u6696\u7EB8", dark: "\u591C\u95F4", compact: "\u7D27\u51D1", comfortable: "\u8212\u9002", loose: "\u5BBD\u677E", prev: "\u4E0A\u4E00\u7AE0 / \u9875", next: "\u4E0B\u4E00\u7AE0 / \u9875", prevChunk: "\u4E0A\u4E00\u6BB5", nextChunk: "\u7EE7\u7EED\u672C\u7AE0", scroll: "\u8FDE\u7EED\u6EDA\u52A8", page: "\u5355\u9875\u7FFB\u9875", fit: "\u9002\u5C4F", zoomIn: "\u653E\u5927", zoomOut: "\u7F29\u5C0F", noCover: "\u6682\u65E0\u5C01\u9762", synced: "\u5DF2\u540C\u6B65", pending: "\u5F85\u540C\u6B65", conflict: "\u5176\u4ED6\u8BBE\u5907\u5DF2\u66F4\u65B0\u9605\u8BFB\u4F4D\u7F6E", useRemote: "\u8F6C\u5230\u8FDC\u7AEF\u4F4D\u7F6E", keepLocal: "\u4FDD\u7559\u672C\u673A\u4F4D\u7F6E", retry: "\u91CD\u8BD5\u540C\u6B65", latest: "\u6709\u65B0\u7248\u672C", switchLatest: "\u5207\u6362\u5230\u65B0\u7248", restore: "\u6062\u590D\u6B64\u7248\u672C", readVersion: "\u9605\u8BFB\u6B64\u7248\u672C", close: "\u5173\u95ED", trash: "\u56DE\u6536\u7AD9", recycle: "\u79FB\u5165\u56DE\u6536\u7AD9", restoreBook: "\u6062\u590D\u4E66\u7C4D", missingImage: "\u56FE\u7247\u65E0\u6CD5\u8BFB\u53D6", version: "\u7248\u672C", part: "\u7AE0\u8282 / \u9875", saved: "\u5DF2\u4FDD\u5B58", imageSource: "\u6F2B\u753B\u8BF7\u63D0\u4F9B PNG / JPEG / WebP \u56FE\u7247\u6587\u4EF6\u6216\u77E5\u8BC6\u5F15\u7528\u3002", originals: "\u5BFC\u5165\u4E0D\u6539\u52A8\u539F\u6587\u4EF6\uFF1B\u5DF2\u53D1\u5E03\u7248\u672C\u4FDD\u7559\u5FEB\u7167\u3002", busy: "\u5904\u7406\u4E2D\u2026", chooseKnowledge: "\u67E5\u770B\u77E5\u8BC6\u6761\u76EE", select: "\u9009\u62E9", sourceRevoked: "\u6765\u6E90\u5DF2\u64A4\u9500\u6216\u4E0D\u5728\u5141\u8BB8\u76EE\u5F55\u4E2D", READING_CONFLICT: "\u9605\u8BFB\u4F4D\u7F6E\u51B2\u7A81\uFF0C\u8BF7\u9009\u62E9\u672C\u673A\u6216\u8FDC\u7AEF", BOOK_VERSION_CONFLICT: "\u4E66\u7C4D\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u5237\u65B0\u540E\u518D\u64CD\u4F5C", SOURCE_OUTSIDE_ALLOWED_ROOTS: "\u6765\u6E90\u4E0D\u5728\u5141\u8BB8\u5BFC\u5165\u7684\u76EE\u5F55\u4E2D", SOURCE_SYMLINK_FORBIDDEN: "\u4E0D\u5141\u8BB8\u7B26\u53F7\u94FE\u63A5\u6765\u6E90", SOURCE_UNAVAILABLE: "\u6765\u6E90\u6587\u4EF6\u4E0D\u53EF\u7528", SOURCE_REVOKED: "\u6765\u6E90\u5DF2\u64A4\u9500", SOURCE_REFERENCE_CHANGED: "\u6765\u6E90\u5F15\u7528\u5DF2\u53D8\u5316", KNOWLEDGE_UNAVAILABLE: "\u77E5\u8BC6\u5E93\u672A\u542F\u7528", INVALID_OR_OVERSIZED_RASTER: "\u56FE\u7247\u683C\u5F0F\u6216\u89E3\u7801\u5C3A\u5BF8\u8D85\u51FA\u9650\u5236", BOOK_TEXT_LIMIT: "\u6587\u672C\u8D85\u51FA\u5355\u672C\u4E66\u9650\u5236", READER_STORAGE_LIMIT: "\u9605\u8BFB\u5668\u5B58\u50A8\u8FBE\u5230\u4E0A\u9650", UNAUTHENTICATED: "\u8BF7\u5148\u767B\u5F55 Harness", INVALID_TEXT: "\u8BF7\u8F93\u5165\u6709\u6548\u6587\u672C", TEXT_MUST_BE_UTF8: "\u6587\u672C\u5FC5\u987B\u4E3A UTF-8 \u7F16\u7801", UNSUPPORTED_TEXT_FORMAT: "\u9996\u7248\u652F\u6301 MD / TXT \u6587\u672C", READER_UNAVAILABLE: "\u9605\u8BFB\u5668\u6682\u65F6\u4E0D\u53EF\u7528", failed: "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8F93\u5165\u6216\u7A0D\u540E\u91CD\u8BD5", network: "\u7F51\u7EDC\u4E0D\u53EF\u7528\uFF0C\u8FDB\u5EA6\u5C1A\u672A\u786E\u8BA4\u540C\u6B65", bookmarkLabel: "\u4E66\u7B7E\u540D\u79F0", bookExists: "\u4E66\u7C4D\u5DF2\u521B\u5EFA", published: "\u65B0\u7248\u672C\u5DF2\u53D1\u5E03", recycled: "\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9", preview: "\u9605\u8BFB", draftNotice: "Agent \u53EF\u8C03\u7528 reader_create_book / reader_update_book \u7BA1\u7406\u7AE0\u8282\u4E0E\u6F2B\u753B\u9875\u9762\u3002", offline: "\u8FDE\u63A5\u5931\u8D25", pageLabel: "\u9875", noHistory: "\u6682\u65E0\u5386\u53F2\u7248\u672C" };
var en = { ...zh, panel: "Reader", description: "Bookshelf for novels, scripts and comics.", shelf: "Bookshelf", tagline: "Stories, close at hand", scope: "One operator \xB7 Server progress", all: "All", novel: "Novel", script: "Script", comic: "Comic", search: "Search title, author or tags", add: "Add book", loading: "Loading\u2026", empty: "Your bookshelf is empty", emptyHint: "Import text or images, or ask the agent to create a book.", none: "No matching books", author: "Author", title: "Title", kind: "Book type", summary: "Summary", source: "Source", text: "Paste text", file: "Server files", knowledge: "Knowledge", paths: "One file path per line, in reading order", knowledgeIds: "One knowledge ID per line", body: "Text (MD / TXT)", create: "Create book", cancel: "Cancel", back: "Bookshelf", toc: "Contents", bookmark: "Add bookmark", bookmarks: "Bookmarks", history: "Versions", noBookmarks: "No bookmarks", remove: "Remove", fontSize: "Font size", lineHeight: "Line spacing", theme: "Theme", light: "Light", warm: "Warm", dark: "Dark", compact: "Compact", comfortable: "Comfortable", loose: "Loose", prev: "Previous chapter / page", next: "Next chapter / page", prevChunk: "Previous section", nextChunk: "Continue chapter", scroll: "Scroll", page: "Single page", fit: "Fit", zoomIn: "Zoom in", zoomOut: "Zoom out", noCover: "No cover", synced: "Synced", pending: "Pending sync", conflict: "Reading position changed on another device", useRemote: "Use remote position", keepLocal: "Keep this position", retry: "Retry sync", latest: "New version available", switchLatest: "Open latest", restore: "Restore version", readVersion: "Read version", close: "Close", trash: "Recycle bin", recycle: "Recycle book", restoreBook: "Restore book", missingImage: "Image unavailable", version: "Version", part: "Chapter / page", saved: "Saved", imageSource: "Use PNG / JPEG / WebP image paths or knowledge references.", originals: "Original files are unchanged. Published versions keep snapshots.", busy: "Working\u2026", chooseKnowledge: "Browse knowledge", select: "Select", failed: "Request failed. Check input or retry later.", network: "Offline. Sync is not confirmed.", bookmarkLabel: "Bookmark label", bookExists: "Book created", published: "Version published", recycled: "Book recycled", preview: "Read", draftNotice: "Agents can manage books with reader_create_book / reader_update_book.", offline: "Connection failed", pageLabel: "Page", noHistory: "No historical versions" };
Object.assign(zh, { pdf: "PDF", upload: "\u672C\u673A\u6587\u4EF6", document: "\u670D\u52A1\u5668\u6587\u6863\uFF08\u81EA\u52A8\u89E3\u6790\uFF09", localFile: "\u9009\u62E9\u6587\u4EF6", documentPath: "\u670D\u52A1\u5668\u6587\u4EF6\u8DEF\u5F84\uFF08\u5355\u4E2A\u6587\u6863\uFF09", formatSupport: "TXT / Markdown / DOCX / EPUB / PDF\uFF0C\u5355\u6587\u4EF6\u9ED8\u8BA4\u6700\u591A 32 MiB\u3002PDF \u6309\u539F\u9875\u6D4F\u89C8\uFF0C\u626B\u63CF\u7248\u4E0D\u505A OCR\uFF1BDOCX \u548C EPUB \u63D0\u53D6\u6587\u5B57\u91CD\u6392\uFF0C\u5D4C\u5165\u56FE\u7247\u63D0\u793A\u4F4D\u7F6E\u3002\u4F20\u7EDF DOC \u901A\u8FC7\u77E5\u8BC6\u5E93\u5171\u4EAB\u672C\u5730\u5904\u7406\u670D\u52A1\u5BFC\u5165\u6587\u5B57\u6D41\uFF1B\u9700\u542F\u7528\u5BF9\u5E94\u8F6C\u6362\u80FD\u529B\u3002Agent \u7684 PDF/OCR/\u6F2B\u753B\u9875\u8BFB\u53D6\u4E5F\u4F7F\u7528\u8BE5\u5171\u4EAB\u670D\u52A1\u3002\u52A0\u5BC6\u3001DRM\u3001\u56FA\u5B9A\u7248\u5F0F EPUB \u6682\u4E0D\u652F\u6301\u3002", DOCUMENT_TOO_LARGE: "\u6587\u6863\u8D85\u51FA\u5355\u6587\u4EF6\u5927\u5C0F\u9650\u5236", DOCUMENT_FILE_REQUIRED: "\u8BF7\u9009\u62E9\u6587\u6863\u6587\u4EF6", DOCUMENT_CHAPTER_LIMIT: "\u6587\u6863\u4E3A\u7A7A\u6216\u7AE0\u8282\u6570\u91CF\u8D85\u51FA\u9650\u5236", DOCUMENT_PAGE_LIMIT: "PDF \u9875\u6570\u8D85\u51FA\u9650\u5236", DOCUMENT_PARSE_FAILED: "\u6587\u6863\u89E3\u6790\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u662F\u5426\u635F\u574F", DOCUMENT_PARSE_TIMEOUT: "\u6587\u6863\u89E3\u6790\u8D85\u65F6\uFF0C\u6587\u4EF6\u8FC7\u4E8E\u590D\u6742", INVALID_PDF: "PDF \u65E0\u6CD5\u89E3\u6790\u6216\u5206\u9875\u4FE1\u606F\u4E0D\u4E00\u81F4", PDF_RENDER_FAILED: "PDF \u9875\u9762\u65E0\u6CD5\u6E32\u67D3\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u6216\u91CD\u8BD5", INVALID_DOCUMENT_ARCHIVE: "\u6587\u6863\u538B\u7F29\u5305\u635F\u574F", ARCHIVE_LIMIT: "\u6587\u6863\u89E3\u538B\u4F53\u79EF\u6216\u538B\u7F29\u7387\u8D85\u51FA\u9650\u5236", UNSAFE_ARCHIVE_PATH: "\u6587\u6863\u5305\u542B\u4E0D\u5B89\u5168\u7684\u8D44\u6E90\u8DEF\u5F84", INVALID_DOCUMENT_XML: "\u6587\u6863\u7ED3\u6784\u635F\u574F", UNSAFE_DOCUMENT_XML: "\u6587\u6863\u5305\u542B\u4E0D\u652F\u6301\u7684 XML \u5B9E\u4F53\u58F0\u660E", ENCRYPTED_DOCUMENT_UNSUPPORTED: "\u4E0D\u652F\u6301\u52A0\u5BC6\u6216 DRM \u6587\u6863", ENCRYPTED_OR_UNSUPPORTED_ARCHIVE: "\u4E0D\u652F\u6301\u52A0\u5BC6\u6216\u7279\u6B8A\u538B\u7F29\u6587\u6863", LEGACY_DOC_REQUIRES_CONVERSION: "\u4F20\u7EDF DOC \u8BF7\u5148\u5728\u672C\u673A Word / LibreOffice \u4E2D\u53E6\u5B58 DOCX \u6216 PDF\uFF0C\u518D\u5BFC\u5165", UNSUPPORTED_DOCUMENT_FORMAT: "\u652F\u6301 TXT\u3001Markdown\u3001DOCX\u3001EPUB \u548C PDF", INVALID_TEXT_ENCODING: "\u6587\u672C\u7F16\u7801\u65E0\u6CD5\u8BC6\u522B\uFF0C\u5EFA\u8BAE\u53E6\u5B58 UTF-8", REMOTE_DOCUMENT_RESOURCE: "\u6587\u6863\u5305\u542B\u5916\u90E8\u6216\u4E0D\u5B89\u5168\u7684\u8D44\u6E90\u5F15\u7528", DOCUMENT_RESOURCE_MISSING: "\u6587\u6863\u5185\u90E8\u8D44\u6E90\u7F3A\u5931", INVALID_EPUB: "\u4E0D\u662F\u6709\u6548\u7684 EPUB \u6587\u6863", INVALID_EPUB_SPINE: "EPUB \u9605\u8BFB\u987A\u5E8F\u65E0\u6548", UNSUPPORTED_EPUB_SPINE_ITEM: "EPUB \u5305\u542B\u4E0D\u652F\u6301\u7684\u9605\u8BFB\u5185\u5BB9", FIXED_LAYOUT_EPUB_UNSUPPORTED: "\u56FA\u5B9A\u7248\u5F0F EPUB \u6682\u4E0D\u652F\u6301\uFF0C\u8BF7\u8F6C\u4E3A PDF", MACRO_DOCUMENT_UNSUPPORTED: "\u4E0D\u652F\u6301\u5305\u542B\u5B8F\u7684\u6587\u6863", DOCX_TEXT_REFLOW: "Word \u6587\u6863\u5DF2\u6309\u6B63\u6587\u987A\u5E8F\u63D0\u53D6\u6587\u5B57\u91CD\u6392\uFF0C\u8868\u683C\u4FDD\u7559\u6587\u5B57\uFF1B\u539F\u9875\u5E03\u5C40\u3001\u6279\u6CE8\u548C\u5D4C\u5165\u5BF9\u8C61\u672A\u4FDD\u7559\u3002", EPUB_TEXT_REFLOW: "EPUB \u5DF2\u6309\u9605\u8BFB\u987A\u5E8F\u63D0\u53D6\u6587\u5B57\u91CD\u6392\uFF0C\u539F\u6837\u5F0F\u4E0E\u4EA4\u4E92\u672A\u4FDD\u7559\u3002", EMBEDDED_MEDIA_NOT_IMPORTED: "\u6587\u6863\u4E2D\u7684\u5D4C\u5165\u56FE\u7247\u6216\u5BF9\u8C61\u4EE5\u6587\u5B57\u63D0\u793A\u4F4D\u7F6E\uFF0C\u672A\u5BFC\u5165\u5A92\u4F53\u3002", PDF_PAGINATED_NO_OCR: "PDF \u4FDD\u7559\u539F\u5206\u9875\u6D4F\u89C8\uFF1B\u626B\u63CF\u7248\u53EF\u67E5\u770B\uFF0C\u4E0D\u8FDB\u884C OCR\u3002", UNSUPPORTED_TEXT_FORMAT: "\u6587\u672C\u6765\u6E90\u652F\u6301 TXT / Markdown\uFF1B\u5176\u4ED6\u683C\u5F0F\u8BF7\u4F7F\u7528\u6587\u6863\u5BFC\u5165\u5165\u53E3" });
Object.assign(en, { pdf: "PDF", upload: "Local file", document: "Server document (auto parse)", localFile: "Choose file", documentPath: "One server document path", formatSupport: "TXT / Markdown / DOCX / EPUB / PDF, default 32 MiB per file. PDF keeps pages; no OCR. DOCX/EPUB reflow text and indicate embedded media. Legacy DOC imports document flow through the shared knowledge processing service when configured. Agent page/OCR reading also uses that service. Encrypted/DRM and fixed-layout EPUB are unsupported.", PDF_PAGINATED_NO_OCR: "PDF keeps original pages; scanned pages can be viewed without OCR.", DOCX_TEXT_REFLOW: "Word text is reflowed in body order. Original layout, comments and embedded objects are not preserved.", EPUB_TEXT_REFLOW: "EPUB text is reflowed in spine order. Original styles and interaction are not preserved.", EMBEDDED_MEDIA_NOT_IMPORTED: "Embedded media are indicated by text placeholders." });
Object.assign(zh, { PROCESSING_UNAVAILABLE: "\u77E5\u8BC6\u5E93\u5171\u4EAB\u5904\u7406\u80FD\u529B\u5C1A\u672A\u5C31\u7EEA", INVALID_BUDGET: "\u5904\u7406\u8303\u56F4\u6216\u9884\u7B97\u65E0\u6548", SOURCE_REFERENCE_CHANGED: "\u6765\u6E90\u5185\u5BB9\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6", ABORT_ERR: "\u5904\u7406\u5DF2\u53D6\u6D88\u6216\u8D85\u65F6" });
Object.assign(en, { PROCESSING_UNAVAILABLE: "Shared knowledge processing is unavailable", INVALID_BUDGET: "Invalid processing range or budget", SOURCE_REFERENCE_CHANGED: "Source content changed; read it again", ABORT_ERR: "Processing cancelled or timed out" });
Object.assign(zh, { agentAccess: "\u667A\u80FD\u4F53\u8BFB\u53D6\u6388\u6743", agentAccessHint: "\u65E7\u4E66\u9ED8\u8BA4\u4E0D\u6269\u5927\u9879\u76EE\u6743\u9650\u3002\u6388\u6743\u6DB5\u76D6\u667A\u80FD\u4F53\u8BFB\u53D6\u4E0E\u5171\u4EAB\u68C0\u7D22\uFF0C\u539F\u6587\u4EF6\u6743\u9650\u548C\u56DE\u6536\u72B6\u6001\u4ECD\u4F1A\u68C0\u67E5\uFF1B\u64A4\u9500\u540E\u5DF2\u5EFA\u7ACB\u7684\u7D22\u5F15\u4E5F\u4E0D\u53EF\u68C0\u7D22\u3002\u5171\u4EAB\u68C0\u7D22\u670D\u52A1\u91CD\u8F7D\u540E\uFF0C\u8BF7\u8BA9\u667A\u80FD\u4F53\u91CD\u65B0\u5EFA\u7ACB\u6240\u9700\u7AE0\u8282\u6216\u9875\u9762\u7684\u7D22\u5F15\uFF0C\u518D\u8FDB\u884C\u641C\u7D22\u3002", agentAccessScope: "\u5141\u8BB8\u8BFB\u53D6\u8303\u56F4", agentAccess_private: "\u672A\u6388\u6743\u5176\u4ED6\u9879\u76EE", agentAccess_projects: "\u6307\u5B9A\u9879\u76EE", agentAccess_all: "\u540C\u4E00\u7528\u6237\u7684\u5168\u90E8\u9879\u76EE", agentProjects: "\u9879\u76EE\u7EDD\u5BF9\u8DEF\u5F84\uFF0C\u6BCF\u884C\u4E00\u4E2A", agentPending: "\u6B64\u4E66\u5C1A\u672A\u6388\u4E88\u8DE8\u9879\u76EE\u8BFB\u53D6\u6743\u9650\u3002", agentAccessSaved: "\u5F53\u524D\u6388\u6743\u5DF2\u4FDD\u5B58\u3002", saveAccess: "\u4FDD\u5B58\u6388\u6743", AUTHORIZATION_CONFLICT: "\u6388\u6743\u5DF2\u88AB\u5176\u4ED6\u7A97\u53E3\u66F4\u65B0\uFF0C\u8BF7\u5173\u95ED\u540E\u91CD\u65B0\u6253\u5F00", INVALID_AUTHORIZATION: "\u8BF7\u68C0\u67E5\u6388\u6743\u8303\u56F4\u53CA\u9879\u76EE\u7EDD\u5BF9\u8DEF\u5F84", SOURCE_PROJECT_ACCESS_DENIED: "\u5F53\u524D\u9879\u76EE\u5C1A\u672A\u83B7\u51C6\u8BFB\u53D6\u6B64\u4E66" });
Object.assign(en, { agentAccess: "Agent reading access", agentAccessHint: "Access covers Agent reading and shared retrieval. Existing books do not automatically grant cross-project access. Source permissions and trash state remain enforced; revoked indexes become unsearchable. After the shared retrieval service reloads, ask the Agent to index the desired chapters or pages again before searching.", agentAccessScope: "Allowed scope", agentAccess_private: "No cross-project grant", agentAccess_projects: "Selected projects", agentAccess_all: "All projects of this user", agentProjects: "Absolute project paths, one per line", agentPending: "Cross-project access has not been granted.", agentAccessSaved: "Current access saved.", saveAccess: "Save access", AUTHORIZATION_CONFLICT: "Access changed in another window; reopen this panel", INVALID_AUTHORIZATION: "Check scope and absolute project paths", SOURCE_PROJECT_ACCESS_DENIED: "This project is not authorized to read this book" });
Object.assign(zh, { agentAccessUnsaved: "\u66F4\u6539\u5C1A\u672A\u4FDD\u5B58\u3002" });
Object.assign(en, { agentAccessUnsaved: "Changes have not been saved." });
Object.assign(zh, { DOCUMENT_PARSE_ERROR: "\u6587\u6863\u5185\u5BB9\u635F\u574F\u6216\u65E0\u6CD5\u5B89\u5168\u89E3\u6790", DOCUMENT_ENCRYPTED: "\u8BF7\u5148\u89E3\u5BC6 PDF\uFF0C\u518D\u8FDB\u884C\u5904\u7406" });
Object.assign(en, { DOCUMENT_PARSE_ERROR: "Document content is malformed or unsafe to parse", DOCUMENT_ENCRYPTED: "Decrypt the PDF before processing" });
Object.assign(zh, { SOURCE_REINDEX_REQUIRED: "\u5171\u4EAB\u68C0\u7D22\u670D\u52A1\u5DF2\u91CD\u8F7D\u6216\u6765\u6E90\u5DF2\u6539\u7248\uFF0C\u8BF7\u91CD\u65B0\u5EFA\u7ACB\u76F8\u5173\u7AE0\u8282\u6216\u9875\u9762\u7D22\u5F15\u540E\u641C\u7D22" });
Object.assign(en, { SOURCE_REINDEX_REQUIRED: "The retrieval service reloaded or the source changed. Index the desired chapters or pages again before searching." });
Object.assign(zh, { READER_HOST_UPGRADE_REQUIRED: "Reader \u9700\u8981\u5BBF\u4E3B\u6700\u7EC8\u7ED3\u679C\u6388\u6743\u68C0\u67E5\u652F\u6301\uFF0C\u8BF7\u5148\u66F4\u65B0\u914D\u5957\u5BBF\u4E3B\u8865\u4E01" });
Object.assign(en, { READER_HOST_UPGRADE_REQUIRED: "Reader requires the companion host update for final result authorization checks." });
Object.assign(zh, { imageRagSelectedPage: "\u5DF2\u9009\u7269\u7406\u9875", imageRag: "\u56FE\u7247\u8BC6\u522B\u4E0E\u77E5\u8BC6\u68C0\u7D22", imageRagScope: "\u4EC5\u5904\u7406\u5F53\u524D\u4E66\u7C4D\u7248\u672C\u7684\u5F53\u524D\u9875\u3002\u5176\u4ED6\u9875\u9700\u9010\u9875\u660E\u786E\u64CD\u4F5C\uFF0C\u6700\u591A\u6BCF\u6B21\u4E00\u9875\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u6574\u672C\u5904\u7406\u3002", imageRagAction: "\u64CD\u4F5C", imageRag_local: "\u672C\u5730\u6587\u5B57\u8BC6\u522B", imageRag_configured: "\u4F7F\u7528\u5DF2\u914D\u7F6E\u7684\u4E13\u7528 OCR", imageRag_indexText: "\u7D22\u5F15\u5F53\u524D\u9875\u6587\u5B57", imageRag_indexImage: "\u7D22\u5F15\u5F53\u524D\u9875\u6587\u5B57\u548C\u56FE\u7247", imageRag_query: "\u7528\u5F53\u524D\u56FE\u7247\u68C0\u7D22", imageRagQuery: "\u9644\u52A0\u68C0\u7D22\u6587\u5B57\uFF08\u53EF\u7559\u7A7A\uFF09", imageRagConsent: "\u4EC5\u672C\u6B21\u540C\u610F\u5C06\u5F53\u524D\u9875\uFF0F\u67E5\u8BE2\u548C\u5019\u9009\u53D1\u9001\u7ED9\u5DF2\u914D\u7F6E\u670D\u52A1\uFF1B\u63D0\u4EA4\u540E\u91CD\u7F6E", imageRagReplace: "\u7D22\u5F15\u4F1A\u66FF\u6362\u5F53\u524D part \u5DF2\u6709\u7D22\u5F15\uFF0C\u4E0D\u4F1A\u8FFD\u52A0\u3002\u4FDD\u5B58\u8BBE\u7F6E\u4E0D\u4F1A\u8BC6\u522B\u3001\u7D22\u5F15\u6216\u4E0A\u4F20\u3002", imageRagRun: "\u6267\u884C\u672C\u6B21\u64CD\u4F5C", imageRagDone: "\u5F53\u524D\u9875\u7D22\u5F15\u5B8C\u6210", imageRagResult: "\u56FE\u7247\u68C0\u7D22\u7ED3\u679C", SOURCE_REVISION_CHANGED: "\u4E66\u7C4D\u7248\u672C\u5DF2\u6539\u53D8\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00", REMOTE_PROCESSING_REQUIRES_CONSENT: "\u8FDC\u7A0B\u8BC6\u522B\u9700\u8981\u672C\u6B21\u660E\u786E\u540C\u610F", IMAGE_PAGE_UNAVAILABLE: "\u5F53\u524D\u9875\u56FE\u7247\u5904\u7406\u4E0D\u53EF\u7528", INVALID_OR_OVERSIZED_RASTER: "\u56FE\u7247\u683C\u5F0F\u3001\u5C3A\u5BF8\u6216\u9884\u7B97\u4E0D\u7B26\u5408\u8981\u6C42" });
Object.assign(en, { imageRagSelectedPage: "Selected physical page", imageRag: "Image recognition and retrieval", imageRagScope: "Only the current page in this book revision. Select other parts explicitly; no whole-book processing.", imageRagAction: "Operation", imageRag_local: "Local OCR", imageRag_configured: "Configured dedicated OCR", imageRag_indexText: "Index current page text", imageRag_indexImage: "Index current page text and image", imageRag_query: "Search with current image", imageRagQuery: "Additional query text (optional)", imageRagConsent: "Consent for this operation to send this page/query and candidates to configured services; resets on submit", imageRagReplace: "Replaces this part\u2019s existing index; does not append. Saving settings does not process or upload.", imageRagRun: "Run this operation", imageRagDone: "Current page indexed", imageRagResult: "Image result", SOURCE_REVISION_CHANGED: "Book revision changed; reopen it", REMOTE_PROCESSING_REQUIRES_CONSENT: "Explicit consent is required for remote processing", IMAGE_PAGE_UNAVAILABLE: "Page image unavailable", INVALID_OR_OVERSIZED_RASTER: "Invalid image format, dimensions or budget" });
Object.assign(zh, { imageRagOcrEngine: "\u7D22\u5F15\u6587\u5B57\u8BC6\u522B\u65B9\u5F0F", imageRagEngine_auto: "\u81EA\u52A8\uFF08\u672C\u5730\u4F18\u5148\uFF09", imageRagEngine_local: "\u4EC5\u672C\u5730", imageRagEngine_configured: "\u4E13\u7528 OCR\uFF08\u9700\u672C\u6B21\u540C\u610F\uFF09" });
Object.assign(en, { imageRagOcrEngine: "OCR for indexing", imageRagEngine_auto: "Auto (local first)", imageRagEngine_local: "Local only", imageRagEngine_configured: "Dedicated OCR (requires consent)" });
Object.assign(zh, { imageRagStatusUnknown: "\u5F53\u524D part \u7684\u6301\u4E45\u7D22\u5F15\u72B6\u6001\u672A\u77E5\uFF1B\u6B64\u9762\u677F\u4E0D\u6062\u590D\u6216\u63A8\u65AD\u5168\u4E66\u7D22\u5F15\u72B6\u6001\u3002", imageRagTextChunks: "\u6587\u5B57\u5757", imageRagImageChunks: "\u56FE\u7247\u5757" });
Object.assign(en, { imageRagStatusUnknown: "Persistent index state for this part is unknown. This panel does not infer book-wide state.", imageRagTextChunks: "Text chunks", imageRagImageChunks: "Image chunks" });


var reader_default = ".dsh-reader{--r-bg:#f6f4ee;--r-paper:#fffdf7;--r-ink:#26382f;--r-muted:#737f77;--r-line:#dcdfd4;--r-accent:#416a55;height:100%;min-height:0;background:var(--r-bg);color:var(--r-ink);font:15px/1.5 system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;overflow:hidden}.dsh-reader[data-theme=warm]{--r-bg:#eee2cc;--r-paper:#f7edd9;--r-ink:#493e2d;--r-muted:#887656;--r-line:#d9c8aa}.dsh-reader[data-theme=dark]{--r-bg:#18231d;--r-paper:#223028;--r-ink:#e7e9dc;--r-muted:#b0bba9;--r-line:#425047;--r-accent:#91baa0}.dsh-reader *{box-sizing:border-box}.dsh-reader button,.dsh-reader input,.dsh-reader textarea,.dsh-reader select{font:inherit;color:inherit}.dsh-reader button{border:1px solid var(--r-line);border-radius:9px;padding:9px 13px;min-height:44px;background:var(--r-paper);cursor:pointer}.dsh-reader button:hover{border-color:var(--r-accent)}.dsh-reader button:disabled{opacity:.5;cursor:default}.dsh-reader :is(button,input,textarea,select):focus-visible{outline:2px solid var(--r-accent);outline-offset:3px}.dsh-reader .r-primary,.dsh-reader .r-active{background:var(--r-accent);border-color:var(--r-accent);color:var(--r-bg)}.dsh-reader .r-toolbar{padding:14px 24px;border-bottom:1px solid var(--r-line);display:flex;flex-wrap:wrap;align-items:center;gap:10px;background:var(--r-paper);flex-shrink:0}.dsh-reader .r-brand{font:600 22px Georgia,serif;margin-right:auto}.dsh-reader .r-muted{color:var(--r-muted);font-size:12px}.dsh-reader .r-scroll{overflow:auto;flex:1;min-height:0;padding:28px;overscroll-behavior:contain}.dsh-reader .r-shelf{max-width:1200px;margin:auto}.dsh-reader h1{font:500 35px Georgia,'Songti SC',serif;margin:0 0 8px}.dsh-reader h2{font:500 27px Georgia,'Songti SC',serif;margin:0 0 24px}.dsh-reader .r-controls{display:flex;align-items:center;flex-wrap:wrap;gap:9px;margin:24px 0}.dsh-reader input[type=search]{margin-left:auto;width:280px}.dsh-reader :is(input[type=text],input[type=search],textarea,select){border:1px solid var(--r-line);border-radius:7px;background:var(--r-paper);padding:9px;max-width:100%}.dsh-reader .r-books{display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:28px;align-items:start}.dsh-reader .r-book{border:0;background:none;padding:0;text-align:left;width:100%;min-width:0}.dsh-reader .r-cover{height:260px;max-width:230px;position:relative;background:#385647;color:#f5f0df;border-radius:4px 12px 12px 4px;overflow:hidden;box-shadow:3px 7px 14px #15251a12,inset 5px 0 #0002;display:flex;flex-direction:column;justify-content:space-between;padding:22px;isolation:isolate}.dsh-reader .r-cover:before{content:'';position:absolute;width:170px;height:170px;right:-40px;bottom:-25px;border:1px solid #d4e1c555;border-radius:50%;box-shadow:0 0 0 25px #d4e1c519;z-index:-1}.dsh-reader .r-cover[data-kind=script]{background:#9b724a}.dsh-reader .r-cover[data-kind=comic]{background:#354f67}.dsh-reader .r-cover strong{font:500 27px/1.5 Georgia,'Songti SC',serif;overflow-wrap:anywhere;letter-spacing:2px}.dsh-reader .r-cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1}.dsh-reader .r-book-title{font-weight:600;font-size:16px;margin:12px 0 5px;overflow-wrap:anywhere}.dsh-reader .r-empty{padding:50px 0;text-align:center}.dsh-reader .r-progress{height:3px;background:var(--r-line);margin:10px 0}.dsh-reader .r-progress>span{display:block;height:100%;background:var(--r-accent)}.dsh-reader .r-error{padding:14px;border:1px solid #b97b63;border-radius:8px;margin:12px 0;background:var(--r-paper)}.dsh-reader .r-form{display:grid;gap:16px;max-width:760px;margin:auto;padding:24px;background:var(--r-paper);border:1px solid var(--r-line);border-radius:12px}.dsh-reader .r-form label{display:grid;gap:7px}.dsh-reader .r-form textarea{min-height:150px;resize:vertical;width:100%}.dsh-reader .r-settings{display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin:0 0 24px;font-size:13px}.dsh-reader .r-settings label{display:flex;align-items:center;gap:7px}.dsh-reader input[type=range]{width:100px}.dsh-reader .r-layout{display:grid;grid-template-columns:190px minmax(0,1fr);gap:28px;max-width:1200px;margin:auto}.dsh-reader .r-layout.r-no-toc{grid-template-columns:minmax(0,1fr)}.dsh-reader .r-toc{border-right:1px solid var(--r-line);padding-right:16px}.dsh-reader .r-toc button{display:block;text-align:left;border:0;background:transparent;width:100%;margin:4px 0;overflow-wrap:anywhere}.dsh-reader .r-toc button.r-active{background:var(--r-accent)}.dsh-reader .r-page{max-width:760px;margin:auto;padding:40px 44px;border-radius:10px;background:var(--r-paper);width:100%;min-width:0}.dsh-reader .r-text{font:var(--r-size,20px)/var(--r-leading,1.95) Georgia,'Songti SC',serif;overflow-wrap:anywhere;white-space:pre-wrap}.dsh-reader .r-text p{font:inherit;margin:1em 0}.dsh-reader .r-text .r-paragraph{text-indent:2em}.dsh-reader .r-text .r-scene{font:600 17px/1.6 system-ui;border-bottom:1px solid var(--r-line);padding:12px 0}.dsh-reader .r-text .r-action{color:var(--r-muted)}.dsh-reader .r-dialogue{max-width:450px;margin:26px auto}.dsh-reader .r-dialogue strong{font:600 15px/1.5 system-ui;letter-spacing:2px}.dsh-reader .r-dialogue p{margin:8px 0}.dsh-reader .r-parenthetical{font-style:italic;color:var(--r-muted)}.dsh-reader .r-location{max-width:760px;margin:16px auto;display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap}.dsh-reader .r-pager{max-width:760px;margin:16px auto;display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px}.dsh-reader .r-comic-viewport{overflow:auto}.dsh-reader .r-comic-page{position:relative;width:100%;background:var(--r-bg);margin-bottom:18px;overflow:hidden;min-height:44px}.dsh-reader .r-comic-page img{display:block;width:100%;height:auto}.dsh-reader .r-comic-placeholder{position:absolute;inset:0;display:grid;place-items:center;color:var(--r-muted);font-size:13px}.dsh-reader .r-comic-label{font:12px system-ui;margin-bottom:10px;color:var(--r-muted)}.dsh-reader .r-list{display:grid;gap:12px}.dsh-reader .r-list-row{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:12px;border-bottom:1px solid var(--r-line)}.dsh-reader .r-list-row>span{flex:1;min-width:150px}.dsh-reader .r-badge{color:var(--r-accent);font-size:12px}.dsh-reader .r-toast{padding:8px 24px;background:var(--r-paper);border-bottom:1px solid var(--r-line);font-size:13px}.dsh-reader .r-reading-title{flex:1;min-width:100px;font-weight:600}.dsh-reader .r-bookmark-label{max-width:200px}.dsh-reader .r-file-hint{font-size:12px;line-height:1.7;color:var(--r-muted)}@media(max-width:700px){.dsh-reader .r-toolbar{padding:12px 16px}.dsh-reader .r-scroll{padding:20px 16px}.dsh-reader .r-layout{display:block}.dsh-reader .r-toc{border:0;padding:0;margin-bottom:18px}.dsh-reader .r-page{padding:26px 18px}.dsh-reader .r-books{grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 16px}.dsh-reader .r-cover{height:225px;padding:17px}.dsh-reader .r-cover strong{font-size:24px}.dsh-reader .r-controls input[type=search]{width:100%;margin:7px 0 0}.dsh-reader .r-brand{font-size:19px}.dsh-reader .r-reading-title{width:100%;flex-basis:100%;order:3}.dsh-reader .r-form{padding:18px}.dsh-reader h1{font-size:30px}.dsh-reader .r-scope{display:none}}\n\n.dsh-reader .r-pdf-page canvas{display:block;width:100%;height:100%;object-fit:contain;background:white}.dsh-reader .r-pdf-page{background:#fff}\n.dsh-reader .r-markdown pre{overflow:auto;white-space:pre;font-size:.8em;background:#8881;padding:16px;border-radius:8px}.dsh-reader .r-markdown code{font-size:.85em}.dsh-reader .r-markdown blockquote{border-left:3px solid #8886;margin:1em 0;padding-left:1em}.dsh-reader .r-table{overflow:auto}.dsh-reader .r-table table{border-collapse:collapse;min-width:50%}.dsh-reader .r-table td,.dsh-reader .r-table th{border:1px solid #8885;padding:8px}.dsh-reader .r-markdown a{color:inherit;text-decoration:underline}\n";


function M() {
  return { async: false, breaks: false, extensions: null, gfm: true, hooks: null, pedantic: false, renderer: null, silent: false, tokenizer: null, walkTokens: null };
}
var T = M();
function G(u3) {
  T = u3;
}
var _ = { exec: () => null };
function k(u3, e = "") {
  let t = typeof u3 == "string" ? u3 : u3.source, n = { replace: (r, i) => {
    let s = typeof i == "string" ? i : i.source;
    return s = s.replace(m.caret, "$1"), t = t.replace(r, s), n;
  }, getRegex: () => new RegExp(t, e) };
  return n;
}
var be = (() => {
  try {
    return !!new RegExp("(?<=1)(?<!1)");
  } catch {
    return false;
  }
})();
var m = { codeRemoveIndent: /^(?: {1,4}| {0,3}\t)/gm, outputLinkReplace: /\\([\[\]])/g, indentCodeCompensation: /^(\s+)(?:```)/, beginningSpace: /^\s+/, endingHash: /#$/, startingSpaceChar: /^ /, endingSpaceChar: / $/, nonSpaceChar: /[^ ]/, newLineCharGlobal: /\n/g, tabCharGlobal: /\t/g, multipleSpaceGlobal: /\s+/g, blankLine: /^[ \t]*$/, doubleBlankLine: /\n[ \t]*\n[ \t]*$/, blockquoteStart: /^ {0,3}>/, blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g, blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm, listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g, listIsTask: /^\[[ xX]\] +\S/, listReplaceTask: /^\[[ xX]\] +/, listTaskCheckbox: /\[[ xX]\]/, anyLine: /\n.*\n/, hrefBrackets: /^<(.*)>$/, tableDelimiter: /[:|]/, tableAlignChars: /^\||\| *$/g, tableRowBlankLine: /\n[ \t]*$/, tableAlignRight: /^ *-+: *$/, tableAlignCenter: /^ *:-+: *$/, tableAlignLeft: /^ *:-+ *$/, startATag: /^<a /i, endATag: /^<\/a>/i, startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i, endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i, startAngleBracket: /^</, endAngleBracket: />$/, pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/, unicodeAlphaNumeric: /[\p{L}\p{N}]/u, escapeTest: /[&<>"']/, escapeReplace: /[&<>"']/g, escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/, escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, caret: /(^|[^\[])\^/g, percentDecode: /%25/g, findPipe: /\|/g, splitPipe: / \|/, slashPipe: /\\\|/g, carriageReturn: /\r\n|\r/g, spaceLine: /^ +$/gm, notSpaceStart: /^\S*/, endingNewline: /\n$/, listItemRegex: (u3) => new RegExp(`^( {0,3}${u3})((?:[	 ][^\\n]*)?(?:\\n|$))`), nextBulletRegex: (u3) => new RegExp(`^ {0,${Math.min(3, u3 - 1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`), hrRegex: (u3) => new RegExp(`^ {0,${Math.min(3, u3 - 1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`), fencesBeginRegex: (u3) => new RegExp(`^ {0,${Math.min(3, u3 - 1)}}(?:\`\`\`|~~~)`), headingBeginRegex: (u3) => new RegExp(`^ {0,${Math.min(3, u3 - 1)}}#`), htmlBeginRegex: (u3) => new RegExp(`^ {0,${Math.min(3, u3 - 1)}}<(?:[a-z].*>|!--)`, "i"), blockquoteBeginRegex: (u3) => new RegExp(`^ {0,${Math.min(3, u3 - 1)}}>`) };
var Re = /^(?:[ \t]*(?:\n|$))+/;
var Te = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
var Oe = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
var C = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
var we = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
var Q = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
var se = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
var ie = k(se).replace(/bull/g, Q).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex();
var ye = k(se).replace(/bull/g, Q).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
var j = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/;
var Pe = /^[^\n]+/;
var F = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/;
var Se = k(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", F).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
var $e = k(/^(bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g, Q).getRegex();
var v = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
var U = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
var _e = k("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", U).replace("tag", v).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
var oe = k(j).replace("hr", C).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", v).getRegex();
var Le = k(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", oe).getRegex();
var K = { blockquote: Le, code: Te, def: Se, fences: Oe, heading: we, hr: C, html: _e, lheading: ie, list: $e, newline: Re, paragraph: oe, table: _, text: Pe };
var ne = k("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", C).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", v).getRegex();
var Me = { ...K, lheading: ye, table: ne, paragraph: k(j).replace("hr", C).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", ne).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", v).getRegex() };
var ze = { ...K, html: k(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", U).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(), def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/, heading: /^(#{1,6})(.*)(?:\n+|$)/, fences: _, lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/, paragraph: k(j).replace("hr", C).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", ie).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex() };
var Ee = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
var Ie = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
var ae = /^( {2,}|\\)\n(?!\s*$)/;
var Ae = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
var z = /[\p{P}\p{S}]/u;
var H = /[\s\p{P}\p{S}]/u;
var W = /[^\s\p{P}\p{S}]/u;
var Ce = k(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, H).getRegex();
var le = /(?!~)[\p{P}\p{S}]/u;
var Be = /(?!~)[\s\p{P}\p{S}]/u;
var De = /(?:[^\s\p{P}\p{S}]|~)/u;
var qe = k(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", be ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
var ue = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
var ve = k(ue, "u").replace(/punct/g, z).getRegex();
var He = k(ue, "u").replace(/punct/g, le).getRegex();
var pe = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
var Ze = k(pe, "gu").replace(/notPunctSpace/g, W).replace(/punctSpace/g, H).replace(/punct/g, z).getRegex();
var Ge = k(pe, "gu").replace(/notPunctSpace/g, De).replace(/punctSpace/g, Be).replace(/punct/g, le).getRegex();
var Ne = k("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, W).replace(/punctSpace/g, H).replace(/punct/g, z).getRegex();
var Qe = k(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, z).getRegex();
var je = "^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)";
var Fe = k(je, "gu").replace(/notPunctSpace/g, W).replace(/punctSpace/g, H).replace(/punct/g, z).getRegex();
var Ue = k(/\\(punct)/, "gu").replace(/punct/g, z).getRegex();
var Ke = k(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
var We = k(U).replace("(?:-->|$)", "-->").getRegex();
var Xe = k("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", We).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
var q = /(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/;
var Je = k(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?\s*\)/).replace("label", q).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
var ce = k(/^!?\[(label)\]\[(ref)\]/).replace("label", q).replace("ref", F).getRegex();
var he = k(/^!?\[(ref)\](?:\[\])?/).replace("ref", F).getRegex();
var Ve = k("reflink|nolink(?!\\()", "g").replace("reflink", ce).replace("nolink", he).getRegex();
var re = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
var X = { _backpedal: _, anyPunctuation: Ue, autolink: Ke, blockSkip: qe, br: ae, code: Ie, del: _, delLDelim: _, delRDelim: _, emStrongLDelim: ve, emStrongRDelimAst: Ze, emStrongRDelimUnd: Ne, escape: Ee, link: Je, nolink: he, punctuation: Ce, reflink: ce, reflinkSearch: Ve, tag: Xe, text: Ae, url: _ };
var Ye = { ...X, link: k(/^!?\[(label)\]\((.*?)\)/).replace("label", q).getRegex(), reflink: k(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", q).getRegex() };
var N = { ...X, emStrongRDelimAst: Ge, emStrongLDelim: He, delLDelim: Qe, delRDelim: Fe, url: k(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol", re).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(), _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/, del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/, text: k(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol", re).getRegex() };
var et = { ...N, br: k(ae).replace("{2,}", "*").getRegex(), text: k(N.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex() };
var B = { normal: K, gfm: Me, pedantic: ze };
var E = { normal: X, gfm: N, breaks: et, pedantic: Ye };
var tt = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
var ke = (u3) => tt[u3];
function O(u3, e) {
  if (e) {
    if (m.escapeTest.test(u3)) return u3.replace(m.escapeReplace, ke);
  } else if (m.escapeTestNoEncode.test(u3)) return u3.replace(m.escapeReplaceNoEncode, ke);
  return u3;
}
function J(u3) {
  try {
    u3 = encodeURI(u3).replace(m.percentDecode, "%");
  } catch {
    return null;
  }
  return u3;
}
function V(u3, e) {
  let t = u3.replace(m.findPipe, (i, s, a) => {
    let o = false, l = s;
    for (; --l >= 0 && a[l] === "\\"; ) o = !o;
    return o ? "|" : " |";
  }), n = t.split(m.splitPipe), r = 0;
  if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
  else for (; n.length < e; ) n.push("");
  for (; r < n.length; r++) n[r] = n[r].trim().replace(m.slashPipe, "|");
  return n;
}
function I(u3, e, t) {
  let n = u3.length;
  if (n === 0) return "";
  let r = 0;
  for (; r < n; ) {
    let i = u3.charAt(n - r - 1);
    if (i === e && !t) r++;
    else if (i !== e && t) r++;
    else break;
  }
  return u3.slice(0, n - r);
}
function de(u3, e) {
  if (u3.indexOf(e[1]) === -1) return -1;
  let t = 0;
  for (let n = 0; n < u3.length; n++) if (u3[n] === "\\") n++;
  else if (u3[n] === e[0]) t++;
  else if (u3[n] === e[1] && (t--, t < 0)) return n;
  return t > 0 ? -2 : -1;
}
function ge(u3, e = 0) {
  let t = e, n = "";
  for (let r of u3) if (r === "	") {
    let i = 4 - t % 4;
    n += " ".repeat(i), t += i;
  } else n += r, t++;
  return n;
}
function fe(u3, e, t, n, r) {
  let i = e.href, s = e.title || null, a = u3[1].replace(r.other.outputLinkReplace, "$1");
  n.state.inLink = true;
  let o = { type: u3[0].charAt(0) === "!" ? "image" : "link", raw: t, href: i, title: s, text: a, tokens: n.inlineTokens(a) };
  return n.state.inLink = false, o;
}
function nt(u3, e, t) {
  let n = u3.match(t.other.indentCodeCompensation);
  if (n === null) return e;
  let r = n[1];
  return e.split(`
`).map((i) => {
    let s = i.match(t.other.beginningSpace);
    if (s === null) return i;
    let [a] = s;
    return a.length >= r.length ? i.slice(r.length) : i;
  }).join(`
`);
}
var w = class {
  options;
  rules;
  lexer;
  constructor(e) {
    this.options = e || T;
  }
  space(e) {
    let t = this.rules.block.newline.exec(e);
    if (t && t[0].length > 0) return { type: "space", raw: t[0] };
  }
  code(e) {
    let t = this.rules.block.code.exec(e);
    if (t) {
      let n = t[0].replace(this.rules.other.codeRemoveIndent, "");
      return { type: "code", raw: t[0], codeBlockStyle: "indented", text: this.options.pedantic ? n : I(n, `
`) };
    }
  }
  fences(e) {
    let t = this.rules.block.fences.exec(e);
    if (t) {
      let n = t[0], r = nt(n, t[3] || "", this.rules);
      return { type: "code", raw: n, lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2], text: r };
    }
  }
  heading(e) {
    let t = this.rules.block.heading.exec(e);
    if (t) {
      let n = t[2].trim();
      if (this.rules.other.endingHash.test(n)) {
        let r = I(n, "#");
        (this.options.pedantic || !r || this.rules.other.endingSpaceChar.test(r)) && (n = r.trim());
      }
      return { type: "heading", raw: t[0], depth: t[1].length, text: n, tokens: this.lexer.inline(n) };
    }
  }
  hr(e) {
    let t = this.rules.block.hr.exec(e);
    if (t) return { type: "hr", raw: I(t[0], `
`) };
  }
  blockquote(e) {
    let t = this.rules.block.blockquote.exec(e);
    if (t) {
      let n = I(t[0], `
`).split(`
`), r = "", i = "", s = [];
      for (; n.length > 0; ) {
        let a = false, o = [], l;
        for (l = 0; l < n.length; l++) if (this.rules.other.blockquoteStart.test(n[l])) o.push(n[l]), a = true;
        else if (!a) o.push(n[l]);
        else break;
        n = n.slice(l);
        let p = o.join(`
`), c = p.replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
        r = r ? `${r}
${p}` : p, i = i ? `${i}
${c}` : c;
        let d = this.lexer.state.top;
        if (this.lexer.state.top = true, this.lexer.blockTokens(c, s, true), this.lexer.state.top = d, n.length === 0) break;
        let h = s.at(-1);
        if (h?.type === "code") break;
        if (h?.type === "blockquote") {
          let R = h, f = R.raw + `
` + n.join(`
`), S = this.blockquote(f);
          s[s.length - 1] = S, r = r.substring(0, r.length - R.raw.length) + S.raw, i = i.substring(0, i.length - R.text.length) + S.text;
          break;
        } else if (h?.type === "list") {
          let R = h, f = R.raw + `
` + n.join(`
`), S = this.list(f);
          s[s.length - 1] = S, r = r.substring(0, r.length - h.raw.length) + S.raw, i = i.substring(0, i.length - R.raw.length) + S.raw, n = f.substring(s.at(-1).raw.length).split(`
`);
          continue;
        }
      }
      return { type: "blockquote", raw: r, tokens: s, text: i };
    }
  }
  list(e) {
    let t = this.rules.block.list.exec(e);
    if (t) {
      let n = t[1].trim(), r = n.length > 1, i = { type: "list", raw: "", ordered: r, start: r ? +n.slice(0, -1) : "", loose: false, items: [] };
      n = r ? `\\d{1,9}\\${n.slice(-1)}` : `\\${n}`, this.options.pedantic && (n = r ? n : "[*+-]");
      let s = this.rules.other.listItemRegex(n), a = false;
      for (; e; ) {
        let l = false, p = "", c = "";
        if (!(t = s.exec(e)) || this.rules.block.hr.test(e)) break;
        p = t[0], e = e.substring(p.length);
        let d = ge(t[2].split(`
`, 1)[0], t[1].length), h = e.split(`
`, 1)[0], R = !d.trim(), f = 0;
        if (this.options.pedantic ? (f = 2, c = d.trimStart()) : R ? f = t[1].length + 1 : (f = d.search(this.rules.other.nonSpaceChar), f = f > 4 ? 1 : f, c = d.slice(f), f += t[1].length), R && this.rules.other.blankLine.test(h) && (p += h + `
`, e = e.substring(h.length + 1), l = true), !l) {
          let S = this.rules.other.nextBulletRegex(f), Y = this.rules.other.hrRegex(f), ee = this.rules.other.fencesBeginRegex(f), te = this.rules.other.headingBeginRegex(f), me = this.rules.other.htmlBeginRegex(f), xe = this.rules.other.blockquoteBeginRegex(f);
          for (; e; ) {
            let Z = e.split(`
`, 1)[0], A;
            if (h = Z, this.options.pedantic ? (h = h.replace(this.rules.other.listReplaceNesting, "  "), A = h) : A = h.replace(this.rules.other.tabCharGlobal, "    "), ee.test(h) || te.test(h) || me.test(h) || xe.test(h) || S.test(h) || Y.test(h)) break;
            if (A.search(this.rules.other.nonSpaceChar) >= f || !h.trim()) c += `
` + A.slice(f);
            else {
              if (R || d.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || ee.test(d) || te.test(d) || Y.test(d)) break;
              c += `
` + h;
            }
            R = !h.trim(), p += Z + `
`, e = e.substring(Z.length + 1), d = A.slice(f);
          }
        }
        i.loose || (a ? i.loose = true : this.rules.other.doubleBlankLine.test(p) && (a = true)), i.items.push({ type: "list_item", raw: p, task: !!this.options.gfm && this.rules.other.listIsTask.test(c), loose: false, text: c, tokens: [] }), i.raw += p;
      }
      let o = i.items.at(-1);
      if (o) o.raw = o.raw.trimEnd(), o.text = o.text.trimEnd();
      else return;
      i.raw = i.raw.trimEnd();
      for (let l of i.items) {
        if (this.lexer.state.top = false, l.tokens = this.lexer.blockTokens(l.text, []), l.task) {
          if (l.text = l.text.replace(this.rules.other.listReplaceTask, ""), l.tokens[0]?.type === "text" || l.tokens[0]?.type === "paragraph") {
            l.tokens[0].raw = l.tokens[0].raw.replace(this.rules.other.listReplaceTask, ""), l.tokens[0].text = l.tokens[0].text.replace(this.rules.other.listReplaceTask, "");
            for (let c = this.lexer.inlineQueue.length - 1; c >= 0; c--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[c].src)) {
              this.lexer.inlineQueue[c].src = this.lexer.inlineQueue[c].src.replace(this.rules.other.listReplaceTask, "");
              break;
            }
          }
          let p = this.rules.other.listTaskCheckbox.exec(l.raw);
          if (p) {
            let c = { type: "checkbox", raw: p[0] + " ", checked: p[0] !== "[ ]" };
            l.checked = c.checked, i.loose ? l.tokens[0] && ["paragraph", "text"].includes(l.tokens[0].type) && "tokens" in l.tokens[0] && l.tokens[0].tokens ? (l.tokens[0].raw = c.raw + l.tokens[0].raw, l.tokens[0].text = c.raw + l.tokens[0].text, l.tokens[0].tokens.unshift(c)) : l.tokens.unshift({ type: "paragraph", raw: c.raw, text: c.raw, tokens: [c] }) : l.tokens.unshift(c);
          }
        }
        if (!i.loose) {
          let p = l.tokens.filter((d) => d.type === "space"), c = p.length > 0 && p.some((d) => this.rules.other.anyLine.test(d.raw));
          i.loose = c;
        }
      }
      if (i.loose) for (let l of i.items) {
        l.loose = true;
        for (let p of l.tokens) p.type === "text" && (p.type = "paragraph");
      }
      return i;
    }
  }
  html(e) {
    let t = this.rules.block.html.exec(e);
    if (t) return { type: "html", block: true, raw: t[0], pre: t[1] === "pre" || t[1] === "script" || t[1] === "style", text: t[0] };
  }
  def(e) {
    let t = this.rules.block.def.exec(e);
    if (t) {
      let n = t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal, " "), r = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", i = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
      return { type: "def", tag: n, raw: t[0], href: r, title: i };
    }
  }
  table(e) {
    let t = this.rules.block.table.exec(e);
    if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
    let n = V(t[1]), r = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), i = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], s = { type: "table", raw: t[0], header: [], align: [], rows: [] };
    if (n.length === r.length) {
      for (let a of r) this.rules.other.tableAlignRight.test(a) ? s.align.push("right") : this.rules.other.tableAlignCenter.test(a) ? s.align.push("center") : this.rules.other.tableAlignLeft.test(a) ? s.align.push("left") : s.align.push(null);
      for (let a = 0; a < n.length; a++) s.header.push({ text: n[a], tokens: this.lexer.inline(n[a]), header: true, align: s.align[a] });
      for (let a of i) s.rows.push(V(a, s.header.length).map((o, l) => ({ text: o, tokens: this.lexer.inline(o), header: false, align: s.align[l] })));
      return s;
    }
  }
  lheading(e) {
    let t = this.rules.block.lheading.exec(e);
    if (t) {
      let n = t[1].trim();
      return { type: "heading", raw: t[0], depth: t[2].charAt(0) === "=" ? 1 : 2, text: n, tokens: this.lexer.inline(n) };
    }
  }
  paragraph(e) {
    let t = this.rules.block.paragraph.exec(e);
    if (t) {
      let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
      return { type: "paragraph", raw: t[0], text: n, tokens: this.lexer.inline(n) };
    }
  }
  text(e) {
    let t = this.rules.block.text.exec(e);
    if (t) return { type: "text", raw: t[0], text: t[0], tokens: this.lexer.inline(t[0]) };
  }
  escape(e) {
    let t = this.rules.inline.escape.exec(e);
    if (t) return { type: "escape", raw: t[0], text: t[1] };
  }
  tag(e) {
    let t = this.rules.inline.tag.exec(e);
    if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = true : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = false), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = true : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = false), { type: "html", raw: t[0], inLink: this.lexer.state.inLink, inRawBlock: this.lexer.state.inRawBlock, block: false, text: t[0] };
  }
  link(e) {
    let t = this.rules.inline.link.exec(e);
    if (t) {
      let n = t[2].trim();
      if (!this.options.pedantic && this.rules.other.startAngleBracket.test(n)) {
        if (!this.rules.other.endAngleBracket.test(n)) return;
        let s = I(n.slice(0, -1), "\\");
        if ((n.length - s.length) % 2 === 0) return;
      } else {
        let s = de(t[2], "()");
        if (s === -2) return;
        if (s > -1) {
          let o = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + s;
          t[2] = t[2].substring(0, s), t[0] = t[0].substring(0, o).trim(), t[3] = "";
        }
      }
      let r = t[2], i = "";
      if (this.options.pedantic) {
        let s = this.rules.other.pedanticHrefTitle.exec(r);
        s && (r = s[1], i = s[3]);
      } else i = t[3] ? t[3].slice(1, -1) : "";
      return r = r.trim(), this.rules.other.startAngleBracket.test(r) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(n) ? r = r.slice(1) : r = r.slice(1, -1)), fe(t, { href: r && r.replace(this.rules.inline.anyPunctuation, "$1"), title: i && i.replace(this.rules.inline.anyPunctuation, "$1") }, t[0], this.lexer, this.rules);
    }
  }
  reflink(e, t) {
    let n;
    if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
      let r = (n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " "), i = t[r.toLowerCase()];
      if (!i) {
        let s = n[0].charAt(0);
        return { type: "text", raw: s, text: s };
      }
      return fe(n, i, n[0], this.lexer, this.rules);
    }
  }
  emStrong(e, t, n = "") {
    let r = this.rules.inline.emStrongLDelim.exec(e);
    if (!r || !r[1] && !r[2] && !r[3] && !r[4] || r[4] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
    if (!(r[1] || r[3] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let s = [...r[0]].length - 1, a, o, l = s, p = 0, c = r[0][0] === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
      for (c.lastIndex = 0, t = t.slice(-1 * e.length + s); (r = c.exec(t)) != null; ) {
        if (a = r[1] || r[2] || r[3] || r[4] || r[5] || r[6], !a) continue;
        if (o = [...a].length, r[3] || r[4]) {
          l += o;
          continue;
        } else if ((r[5] || r[6]) && s % 3 && !((s + o) % 3)) {
          p += o;
          continue;
        }
        if (l -= o, l > 0) continue;
        o = Math.min(o, o + l + p);
        let d = [...r[0]][0].length, h = e.slice(0, s + r.index + d + o);
        if (Math.min(s, o) % 2) {
          let f = h.slice(1, -1);
          return { type: "em", raw: h, text: f, tokens: this.lexer.inlineTokens(f) };
        }
        let R = h.slice(2, -2);
        return { type: "strong", raw: h, text: R, tokens: this.lexer.inlineTokens(R) };
      }
    }
  }
  codespan(e) {
    let t = this.rules.inline.code.exec(e);
    if (t) {
      let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), r = this.rules.other.nonSpaceChar.test(n), i = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
      return r && i && (n = n.substring(1, n.length - 1)), { type: "codespan", raw: t[0], text: n };
    }
  }
  br(e) {
    let t = this.rules.inline.br.exec(e);
    if (t) return { type: "br", raw: t[0] };
  }
  del(e, t, n = "") {
    let r = this.rules.inline.delLDelim.exec(e);
    if (!r) return;
    if (!(r[1] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let s = [...r[0]].length - 1, a, o, l = s, p = this.rules.inline.delRDelim;
      for (p.lastIndex = 0, t = t.slice(-1 * e.length + s); (r = p.exec(t)) != null; ) {
        if (a = r[1] || r[2] || r[3] || r[4] || r[5] || r[6], !a || (o = [...a].length, o !== s)) continue;
        if (r[3] || r[4]) {
          l += o;
          continue;
        }
        if (l -= o, l > 0) continue;
        o = Math.min(o, o + l);
        let c = [...r[0]][0].length, d = e.slice(0, s + r.index + c + o), h = d.slice(s, -s);
        return { type: "del", raw: d, text: h, tokens: this.lexer.inlineTokens(h) };
      }
    }
  }
  autolink(e) {
    let t = this.rules.inline.autolink.exec(e);
    if (t) {
      let n, r;
      return t[2] === "@" ? (n = t[1], r = "mailto:" + n) : (n = t[1], r = n), { type: "link", raw: t[0], text: n, href: r, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  url(e) {
    let t;
    if (t = this.rules.inline.url.exec(e)) {
      let n, r;
      if (t[2] === "@") n = t[0], r = "mailto:" + n;
      else {
        let i;
        do
          i = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
        while (i !== t[0]);
        n = t[0], t[1] === "www." ? r = "http://" + t[0] : r = t[0];
      }
      return { type: "link", raw: t[0], text: n, href: r, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  inlineText(e) {
    let t = this.rules.inline.text.exec(e);
    if (t) {
      let n = this.lexer.state.inRawBlock;
      return { type: "text", raw: t[0], text: t[0], escaped: n };
    }
  }
};
var x = class u {
  tokens;
  options;
  state;
  inlineQueue;
  tokenizer;
  constructor(e) {
    this.tokens = [], this.tokens.links =                 Object.create(null), this.options = e || T, this.options.tokenizer = this.options.tokenizer || new w(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = { inLink: false, inRawBlock: false, top: true };
    let t = { other: m, block: B.normal, inline: E.normal };
    this.options.pedantic ? (t.block = B.pedantic, t.inline = E.pedantic) : this.options.gfm && (t.block = B.gfm, this.options.breaks ? t.inline = E.breaks : t.inline = E.gfm), this.tokenizer.rules = t;
  }
  static get rules() {
    return { block: B, inline: E };
  }
  static lex(e, t) {
    return new u(t).lex(e);
  }
  static lexInline(e, t) {
    return new u(t).inlineTokens(e);
  }
  lex(e) {
    e = e.replace(m.carriageReturn, `
`), this.blockTokens(e, this.tokens);
    for (let t = 0; t < this.inlineQueue.length; t++) {
      let n = this.inlineQueue[t];
      this.inlineTokens(n.src, n.tokens);
    }
    return this.inlineQueue = [], this.tokens;
  }
  blockTokens(e, t = [], n = false) {
    for (this.tokenizer.lexer = this, this.options.pedantic && (e = e.replace(m.tabCharGlobal, "    ").replace(m.spaceLine, "")); e; ) {
      let r;
      if (this.options.extensions?.block?.some((s) => (r = s.call({ lexer: this }, e, t)) ? (e = e.substring(r.raw.length), t.push(r), true) : false)) continue;
      if (r = this.tokenizer.space(e)) {
        e = e.substring(r.raw.length);
        let s = t.at(-1);
        r.raw.length === 1 && s !== void 0 ? s.raw += `
` : t.push(r);
        continue;
      }
      if (r = this.tokenizer.code(e)) {
        e = e.substring(r.raw.length);
        let s = t.at(-1);
        s?.type === "paragraph" || s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.at(-1).src = s.text) : t.push(r);
        continue;
      }
      if (r = this.tokenizer.fences(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.heading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.hr(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.blockquote(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.list(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.html(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.def(e)) {
        e = e.substring(r.raw.length);
        let s = t.at(-1);
        s?.type === "paragraph" || s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.raw, this.inlineQueue.at(-1).src = s.text) : this.tokens.links[r.tag] || (this.tokens.links[r.tag] = { href: r.href, title: r.title }, t.push(r));
        continue;
      }
      if (r = this.tokenizer.table(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.lheading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      let i = e;
      if (this.options.extensions?.startBlock) {
        let s = 1 / 0, a = e.slice(1), o;
        this.options.extensions.startBlock.forEach((l) => {
          o = l.call({ lexer: this }, a), typeof o == "number" && o >= 0 && (s = Math.min(s, o));
        }), s < 1 / 0 && s >= 0 && (i = e.substring(0, s + 1));
      }
      if (this.state.top && (r = this.tokenizer.paragraph(i))) {
        let s = t.at(-1);
        n && s?.type === "paragraph" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = s.text) : t.push(r), n = i.length !== e.length, e = e.substring(r.raw.length);
        continue;
      }
      if (r = this.tokenizer.text(e)) {
        e = e.substring(r.raw.length);
        let s = t.at(-1);
        s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = s.text) : t.push(r);
        continue;
      }
      if (e) {
        let s = "Infinite loop on byte: " + e.charCodeAt(0);
        if (this.options.silent) {
          console.error(s);
          break;
        } else throw new Error(s);
      }
    }
    return this.state.top = true, t;
  }
  inline(e, t = []) {
    return this.inlineQueue.push({ src: e, tokens: t }), t;
  }
  inlineTokens(e, t = []) {
    this.tokenizer.lexer = this;
    let n = e, r = null;
    if (this.tokens.links) {
      let o = Object.keys(this.tokens.links);
      if (o.length > 0) for (; (r = this.tokenizer.rules.inline.reflinkSearch.exec(n)) != null; ) o.includes(r[0].slice(r[0].lastIndexOf("[") + 1, -1)) && (n = n.slice(0, r.index) + "[" + "a".repeat(r[0].length - 2) + "]" + n.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex));
    }
    for (; (r = this.tokenizer.rules.inline.anyPunctuation.exec(n)) != null; ) n = n.slice(0, r.index) + "++" + n.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);
    let i;
    for (; (r = this.tokenizer.rules.inline.blockSkip.exec(n)) != null; ) i = r[2] ? r[2].length : 0, n = n.slice(0, r.index + i) + "[" + "a".repeat(r[0].length - i - 2) + "]" + n.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);
    n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
    let s = false, a = "";
    for (; e; ) {
      s || (a = ""), s = false;
      let o;
      if (this.options.extensions?.inline?.some((p) => (o = p.call({ lexer: this }, e, t)) ? (e = e.substring(o.raw.length), t.push(o), true) : false)) continue;
      if (o = this.tokenizer.escape(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.tag(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.link(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.reflink(e, this.tokens.links)) {
        e = e.substring(o.raw.length);
        let p = t.at(-1);
        o.type === "text" && p?.type === "text" ? (p.raw += o.raw, p.text += o.text) : t.push(o);
        continue;
      }
      if (o = this.tokenizer.emStrong(e, n, a)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.codespan(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.br(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.del(e, n, a)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.autolink(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (!this.state.inLink && (o = this.tokenizer.url(e))) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      let l = e;
      if (this.options.extensions?.startInline) {
        let p = 1 / 0, c = e.slice(1), d;
        this.options.extensions.startInline.forEach((h) => {
          d = h.call({ lexer: this }, c), typeof d == "number" && d >= 0 && (p = Math.min(p, d));
        }), p < 1 / 0 && p >= 0 && (l = e.substring(0, p + 1));
      }
      if (o = this.tokenizer.inlineText(l)) {
        e = e.substring(o.raw.length), o.raw.slice(-1) !== "_" && (a = o.raw.slice(-1)), s = true;
        let p = t.at(-1);
        p?.type === "text" ? (p.raw += o.raw, p.text += o.text) : t.push(o);
        continue;
      }
      if (e) {
        let p = "Infinite loop on byte: " + e.charCodeAt(0);
        if (this.options.silent) {
          console.error(p);
          break;
        } else throw new Error(p);
      }
    }
    return t;
  }
};
var y = class {
  options;
  parser;
  constructor(e) {
    this.options = e || T;
  }
  space(e) {
    return "";
  }
  code({ text: e, lang: t, escaped: n }) {
    let r = (t || "").match(m.notSpaceStart)?.[0], i = e.replace(m.endingNewline, "") + `
`;
    return r ? '<pre><code class="language-' + O(r) + '">' + (n ? i : O(i, true)) + `</code></pre>
` : "<pre><code>" + (n ? i : O(i, true)) + `</code></pre>
`;
  }
  blockquote({ tokens: e }) {
    return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
  }
  html({ text: e }) {
    return e;
  }
  def(e) {
    return "";
  }
  heading({ tokens: e, depth: t }) {
    return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
  }
  hr(e) {
    return `<hr>
`;
  }
  list(e) {
    let t = e.ordered, n = e.start, r = "";
    for (let a = 0; a < e.items.length; a++) {
      let o = e.items[a];
      r += this.listitem(o);
    }
    let i = t ? "ol" : "ul", s = t && n !== 1 ? ' start="' + n + '"' : "";
    return "<" + i + s + `>
` + r + "</" + i + `>
`;
  }
  listitem(e) {
    return `<li>${this.parser.parse(e.tokens)}</li>
`;
  }
  checkbox({ checked: e }) {
    return "<input " + (e ? 'checked="" ' : "") + 'disabled="" type="checkbox"> ';
  }
  paragraph({ tokens: e }) {
    return `<p>${this.parser.parseInline(e)}</p>
`;
  }
  table(e) {
    let t = "", n = "";
    for (let i = 0; i < e.header.length; i++) n += this.tablecell(e.header[i]);
    t += this.tablerow({ text: n });
    let r = "";
    for (let i = 0; i < e.rows.length; i++) {
      let s = e.rows[i];
      n = "";
      for (let a = 0; a < s.length; a++) n += this.tablecell(s[a]);
      r += this.tablerow({ text: n });
    }
    return r && (r = `<tbody>${r}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + r + `</table>
`;
  }
  tablerow({ text: e }) {
    return `<tr>
${e}</tr>
`;
  }
  tablecell(e) {
    let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
    return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
  }
  strong({ tokens: e }) {
    return `<strong>${this.parser.parseInline(e)}</strong>`;
  }
  em({ tokens: e }) {
    return `<em>${this.parser.parseInline(e)}</em>`;
  }
  codespan({ text: e }) {
    return `<code>${O(e, true)}</code>`;
  }
  br(e) {
    return "<br>";
  }
  del({ tokens: e }) {
    return `<del>${this.parser.parseInline(e)}</del>`;
  }
  link({ href: e, title: t, tokens: n }) {
    let r = this.parser.parseInline(n), i = J(e);
    if (i === null) return r;
    e = i;
    let s = '<a href="' + e + '"';
    return t && (s += ' title="' + O(t) + '"'), s += ">" + r + "</a>", s;
  }
  image({ href: e, title: t, text: n, tokens: r }) {
    r && (n = this.parser.parseInline(r, this.parser.textRenderer));
    let i = J(e);
    if (i === null) return O(n);
    e = i;
    let s = `<img src="${e}" alt="${O(n)}"`;
    return t && (s += ` title="${O(t)}"`), s += ">", s;
  }
  text(e) {
    return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : O(e.text);
  }
};
var $ = class {
  strong({ text: e }) {
    return e;
  }
  em({ text: e }) {
    return e;
  }
  codespan({ text: e }) {
    return e;
  }
  del({ text: e }) {
    return e;
  }
  html({ text: e }) {
    return e;
  }
  text({ text: e }) {
    return e;
  }
  link({ text: e }) {
    return "" + e;
  }
  image({ text: e }) {
    return "" + e;
  }
  br() {
    return "";
  }
  checkbox({ raw: e }) {
    return e;
  }
};
var b = class u2 {
  options;
  renderer;
  textRenderer;
  constructor(e) {
    this.options = e || T, this.options.renderer = this.options.renderer || new y(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new $();
  }
  static parse(e, t) {
    return new u2(t).parse(e);
  }
  static parseInline(e, t) {
    return new u2(t).parseInline(e);
  }
  parse(e) {
    this.renderer.parser = this;
    let t = "";
    for (let n = 0; n < e.length; n++) {
      let r = e[n];
      if (this.options.extensions?.renderers?.[r.type]) {
        let s = r, a = this.options.extensions.renderers[s.type].call({ parser: this }, s);
        if (a !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "html", "def", "paragraph", "text"].includes(s.type)) {
          t += a || "";
          continue;
        }
      }
      let i = r;
      switch (i.type) {
        case "space": {
          t += this.renderer.space(i);
          break;
        }
        case "hr": {
          t += this.renderer.hr(i);
          break;
        }
        case "heading": {
          t += this.renderer.heading(i);
          break;
        }
        case "code": {
          t += this.renderer.code(i);
          break;
        }
        case "table": {
          t += this.renderer.table(i);
          break;
        }
        case "blockquote": {
          t += this.renderer.blockquote(i);
          break;
        }
        case "list": {
          t += this.renderer.list(i);
          break;
        }
        case "checkbox": {
          t += this.renderer.checkbox(i);
          break;
        }
        case "html": {
          t += this.renderer.html(i);
          break;
        }
        case "def": {
          t += this.renderer.def(i);
          break;
        }
        case "paragraph": {
          t += this.renderer.paragraph(i);
          break;
        }
        case "text": {
          t += this.renderer.text(i);
          break;
        }
        default: {
          let s = 'Token with "' + i.type + '" type was not found.';
          if (this.options.silent) return console.error(s), "";
          throw new Error(s);
        }
      }
    }
    return t;
  }
  parseInline(e, t = this.renderer) {
    this.renderer.parser = this;
    let n = "";
    for (let r = 0; r < e.length; r++) {
      let i = e[r];
      if (this.options.extensions?.renderers?.[i.type]) {
        let a = this.options.extensions.renderers[i.type].call({ parser: this }, i);
        if (a !== false || !["escape", "html", "link", "image", "strong", "em", "codespan", "br", "del", "text"].includes(i.type)) {
          n += a || "";
          continue;
        }
      }
      let s = i;
      switch (s.type) {
        case "escape": {
          n += t.text(s);
          break;
        }
        case "html": {
          n += t.html(s);
          break;
        }
        case "link": {
          n += t.link(s);
          break;
        }
        case "image": {
          n += t.image(s);
          break;
        }
        case "checkbox": {
          n += t.checkbox(s);
          break;
        }
        case "strong": {
          n += t.strong(s);
          break;
        }
        case "em": {
          n += t.em(s);
          break;
        }
        case "codespan": {
          n += t.codespan(s);
          break;
        }
        case "br": {
          n += t.br(s);
          break;
        }
        case "del": {
          n += t.del(s);
          break;
        }
        case "text": {
          n += t.text(s);
          break;
        }
        default: {
          let a = 'Token with "' + s.type + '" type was not found.';
          if (this.options.silent) return console.error(a), "";
          throw new Error(a);
        }
      }
    }
    return n;
  }
};
var P = class {
  options;
  block;
  constructor(e) {
    this.options = e || T;
  }
  static passThroughHooks =                 new Set(["preprocess", "postprocess", "processAllTokens", "emStrongMask"]);
  static passThroughHooksRespectAsync =                 new Set(["preprocess", "postprocess", "processAllTokens"]);
  preprocess(e) {
    return e;
  }
  postprocess(e) {
    return e;
  }
  processAllTokens(e) {
    return e;
  }
  emStrongMask(e) {
    return e;
  }
  provideLexer() {
    return this.block ? x.lex : x.lexInline;
  }
  provideParser() {
    return this.block ? b.parse : b.parseInline;
  }
};
var D = class {
  defaults = M();
  options = this.setOptions;
  parse = this.parseMarkdown(true);
  parseInline = this.parseMarkdown(false);
  Parser = b;
  Renderer = y;
  TextRenderer = $;
  Lexer = x;
  Tokenizer = w;
  Hooks = P;
  constructor(...e) {
    this.use(...e);
  }
  walkTokens(e, t) {
    let n = [];
    for (let r of e) switch (n = n.concat(t.call(this, r)), r.type) {
      case "table": {
        let i = r;
        for (let s of i.header) n = n.concat(this.walkTokens(s.tokens, t));
        for (let s of i.rows) for (let a of s) n = n.concat(this.walkTokens(a.tokens, t));
        break;
      }
      case "list": {
        let i = r;
        n = n.concat(this.walkTokens(i.items, t));
        break;
      }
      default: {
        let i = r;
        this.defaults.extensions?.childTokens?.[i.type] ? this.defaults.extensions.childTokens[i.type].forEach((s) => {
          let a = i[s].flat(1 / 0);
          n = n.concat(this.walkTokens(a, t));
        }) : i.tokens && (n = n.concat(this.walkTokens(i.tokens, t)));
      }
    }
    return n;
  }
  use(...e) {
    let t = this.defaults.extensions || { renderers: {}, childTokens: {} };
    return e.forEach((n) => {
      let r = { ...n };
      if (r.async = this.defaults.async || r.async || false, n.extensions && (n.extensions.forEach((i) => {
        if (!i.name) throw new Error("extension name required");
        if ("renderer" in i) {
          let s = t.renderers[i.name];
          s ? t.renderers[i.name] = function(...a) {
            let o = i.renderer.apply(this, a);
            return o === false && (o = s.apply(this, a)), o;
          } : t.renderers[i.name] = i.renderer;
        }
        if ("tokenizer" in i) {
          if (!i.level || i.level !== "block" && i.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
          let s = t[i.level];
          s ? s.unshift(i.tokenizer) : t[i.level] = [i.tokenizer], i.start && (i.level === "block" ? t.startBlock ? t.startBlock.push(i.start) : t.startBlock = [i.start] : i.level === "inline" && (t.startInline ? t.startInline.push(i.start) : t.startInline = [i.start]));
        }
        "childTokens" in i && i.childTokens && (t.childTokens[i.name] = i.childTokens);
      }), r.extensions = t), n.renderer) {
        let i = this.defaults.renderer || new y(this.defaults);
        for (let s in n.renderer) {
          if (!(s in i)) throw new Error(`renderer '${s}' does not exist`);
          if (["options", "parser"].includes(s)) continue;
          let a = s, o = n.renderer[a], l = i[a];
          i[a] = (...p) => {
            let c = o.apply(i, p);
            return c === false && (c = l.apply(i, p)), c || "";
          };
        }
        r.renderer = i;
      }
      if (n.tokenizer) {
        let i = this.defaults.tokenizer || new w(this.defaults);
        for (let s in n.tokenizer) {
          if (!(s in i)) throw new Error(`tokenizer '${s}' does not exist`);
          if (["options", "rules", "lexer"].includes(s)) continue;
          let a = s, o = n.tokenizer[a], l = i[a];
          i[a] = (...p) => {
            let c = o.apply(i, p);
            return c === false && (c = l.apply(i, p)), c;
          };
        }
        r.tokenizer = i;
      }
      if (n.hooks) {
        let i = this.defaults.hooks || new P();
        for (let s in n.hooks) {
          if (!(s in i)) throw new Error(`hook '${s}' does not exist`);
          if (["options", "block"].includes(s)) continue;
          let a = s, o = n.hooks[a], l = i[a];
          P.passThroughHooks.has(s) ? i[a] = (p) => {
            if (this.defaults.async && P.passThroughHooksRespectAsync.has(s)) return (async () => {
              let d = await o.call(i, p);
              return l.call(i, d);
            })();
            let c = o.call(i, p);
            return l.call(i, c);
          } : i[a] = (...p) => {
            if (this.defaults.async) return (async () => {
              let d = await o.apply(i, p);
              return d === false && (d = await l.apply(i, p)), d;
            })();
            let c = o.apply(i, p);
            return c === false && (c = l.apply(i, p)), c;
          };
        }
        r.hooks = i;
      }
      if (n.walkTokens) {
        let i = this.defaults.walkTokens, s = n.walkTokens;
        r.walkTokens = function(a) {
          let o = [];
          return o.push(s.call(this, a)), i && (o = o.concat(i.call(this, a))), o;
        };
      }
      this.defaults = { ...this.defaults, ...r };
    }), this;
  }
  setOptions(e) {
    return this.defaults = { ...this.defaults, ...e }, this;
  }
  lexer(e, t) {
    return x.lex(e, t ?? this.defaults);
  }
  parser(e, t) {
    return b.parse(e, t ?? this.defaults);
  }
  parseMarkdown(e) {
    return (n, r) => {
      let i = { ...r }, s = { ...this.defaults, ...i }, a = this.onError(!!s.silent, !!s.async);
      if (this.defaults.async === true && i.async === false) return a(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
      if (typeof n > "u" || n === null) return a(new Error("marked(): input parameter is undefined or null"));
      if (typeof n != "string") return a(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
      if (s.hooks && (s.hooks.options = s, s.hooks.block = e), s.async) return (async () => {
        let o = s.hooks ? await s.hooks.preprocess(n) : n, p = await (s.hooks ? await s.hooks.provideLexer() : e ? x.lex : x.lexInline)(o, s), c = s.hooks ? await s.hooks.processAllTokens(p) : p;
        s.walkTokens && await Promise.all(this.walkTokens(c, s.walkTokens));
        let h = await (s.hooks ? await s.hooks.provideParser() : e ? b.parse : b.parseInline)(c, s);
        return s.hooks ? await s.hooks.postprocess(h) : h;
      })().catch(a);
      try {
        s.hooks && (n = s.hooks.preprocess(n));
        let l = (s.hooks ? s.hooks.provideLexer() : e ? x.lex : x.lexInline)(n, s);
        s.hooks && (l = s.hooks.processAllTokens(l)), s.walkTokens && this.walkTokens(l, s.walkTokens);
        let c = (s.hooks ? s.hooks.provideParser() : e ? b.parse : b.parseInline)(l, s);
        return s.hooks && (c = s.hooks.postprocess(c)), c;
      } catch (o) {
        return a(o);
      }
    };
  }
  onError(e, t) {
    return (n) => {
      if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
        let r = "<p>An error occurred:</p><pre>" + O(n.message + "", true) + "</pre>";
        return t ? Promise.resolve(r) : r;
      }
      if (t) return Promise.reject(n);
      throw n;
    };
  }
};
var L = new D();
function g(u3, e) {
  return L.parse(u3, e);
}
g.options = g.setOptions = function(u3) {
  return L.setOptions(u3), g.defaults = L.defaults, G(g.defaults), g;
};
g.getDefaults = M;
g.defaults = T;
g.use = function(...u3) {
  return L.use(...u3), g.defaults = L.defaults, G(g.defaults), g;
};
g.walkTokens = function(u3, e) {
  return L.walkTokens(u3, e);
};
g.parseInline = L.parseInline;
g.Parser = b;
g.parser = b.parse;
g.Renderer = y;
g.TextRenderer = $;
g.Lexer = x;
g.lexer = x.lex;
g.Tokenizer = w;
g.Hooks = P;
g.parse = g;
var Qt = g.options;
var jt = g.setOptions;
var Ft = g.use;
var Ut = g.walkTokens;
var Kt = g.parseInline;
var Xt = b.parse;
var Jt = x.lex;


var import_jsx_runtime3 = require("react/jsx-runtime");
var APP = "dsh-reader";
var NS = "dsh-reader";
var inject = ["slots", "layout", "locale"];
var initialSettings = { theme: "light", fontSize: 20, lineHeight: 1.95, comicMode: "scroll" };
function ReaderIcon({ size = 18 }) {
  return                 (0, import_jsx_runtime3.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.7", "aria-hidden": "true", children: [
                    (0, import_jsx_runtime3.jsx)("path", { d: "M3 4.5c4-1 6-.5 9 1.5 3-2 5-2.5 9-1.5v15c-4-1-6-.5-9 1.5-3-2-5-2.5-9-1.5zM12 6v15" }),
                    (0, import_jsx_runtime3.jsx)("path", { d: "M6 9h3M15 9h3" })
  ] });
}
function ErrorBox({ error, t }) {
  return error ?                 (0, import_jsx_runtime3.jsx)("div", { className: "r-error", role: "alert", children: error.status ? t(error.code) || t("failed") : t("network") }) : null;
}
function Cover({ book, t }) {
  const [failed, setFailed] = (0, import_react4.useState)(false);
  return                 (0, import_jsx_runtime3.jsxs)("div", { className: "r-cover", "data-kind": book.kind, children: [
                    (0, import_jsx_runtime3.jsx)("small", { children: t(book.kind) }),
                    (0, import_jsx_runtime3.jsx)("strong", { children: book.title }),
                    (0, import_jsx_runtime3.jsx)("small", { children: t("noCover") }),
    book.cover && !failed &&                 (0, import_jsx_runtime3.jsx)("img", { src: assetUrl(book, "cover"), alt: "", loading: "lazy", decoding: "async", onError: () => setFailed(true) })
  ] });
}
function ImportForm({ t, onCreated, onClose }) {
  const [title, setTitle] = (0, import_react4.useState)(""), [author, setAuthor] = (0, import_react4.useState)(""), [kind, setKind] = (0, import_react4.useState)("novel"), [mode, setMode] = (0, import_react4.useState)("upload"), [content, setContent] = (0, import_react4.useState)(""), [busy, setBusy] = (0, import_react4.useState)(false), [error, setError] = (0, import_react4.useState)(null), [knowledge, setKnowledge] = (0, import_react4.useState)(null);
  const alive = (0, import_react4.useRef)(true);
  (0, import_react4.useEffect)(() => () => {
    alive.current = false;
  }, []);
  const [file, setFile] = (0, import_react4.useState)(null);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "upload" || mode === "document") {
        let body = { requestId: rid(), title, author };
        if (mode === "document") body.source = { path: content.trim() };
        else {
          if (!file) throw { status: 400, code: "DOCUMENT_FILE_REQUIRED" };
          const health = await api("health");
          if (file.size > health.maxDocumentBytes) throw { status: 413, code: "DOCUMENT_TOO_LARGE" };
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
          body = { ...body, filename: file.name, data: btoa(binary) };
        }
        const result = await api("import", { method: "POST", body });
        if (alive.current) onCreated(result);
        return;
      }
      const inputs = content.split("\n").map((x2) => x2.trim()).filter(Boolean);
      const parts = mode === "text" ? [{ id: rid(), title, text: content }] : inputs.map((value, i) => ({ id: rid(), title: `${t("part")} ${i + 1}`, source: mode === "file" ? { path: value } : { knowledgeId: value }, alt: title }));
      const document = { title, author, kind, [kind === "comic" ? "pages" : "chapters"]: parts };
      if (kind === "comic" && mode === "text") throw { status: 400, code: "imageSource" };
      const book = await api("books", { method: "POST", body: { requestId: rid(), document } });
      if (alive.current) onCreated(book);
    } catch (e2) {
      if (alive.current) setError(e2);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function browse() {
    try {
      const r = await fetch("/dsh-fileman/knowledge/list?type=all", { credentials: "same-origin" });
      if (!r.ok) throw { status: r.status, code: "KNOWLEDGE_UNAVAILABLE" };
      const data = await r.json();
      if (alive.current) setKnowledge(data.items || []);
    } catch (e) {
      if (alive.current) setError(e);
    }
  }
  return                 (0, import_jsx_runtime3.jsxs)("form", { className: "r-form", onSubmit: submit, children: [
                    (0, import_jsx_runtime3.jsx)("h2", { children: t("add") }),
                    (0, import_jsx_runtime3.jsx)(ErrorBox, { error, t }),
                    (0, import_jsx_runtime3.jsxs)("label", { children: [
      t("title"),
                      (0, import_jsx_runtime3.jsx)("input", { required: true, maxLength: 240, type: "text", value: title, onChange: (e) => setTitle(e.target.value) })
    ] }),
                    (0, import_jsx_runtime3.jsxs)("label", { children: [
      t("author"),
                      (0, import_jsx_runtime3.jsx)("input", { maxLength: 240, type: "text", value: author, onChange: (e) => setAuthor(e.target.value) })
    ] }),
    !["upload", "document"].includes(mode) &&                 (0, import_jsx_runtime3.jsxs)("label", { children: [
      t("kind"),
                      (0, import_jsx_runtime3.jsx)("select", { value: kind, onChange: (e) => {
        setKind(e.target.value);
        if (e.target.value === "comic") setMode("file");
      }, children: ["novel", "script", "comic"].map((x2) =>                 (0, import_jsx_runtime3.jsx)("option", { value: x2, children: t(x2) }, x2)) })
    ] }),
                    (0, import_jsx_runtime3.jsxs)("label", { children: [
      t("source"),
                      (0, import_jsx_runtime3.jsx)("select", { value: mode, onChange: (e) => setMode(e.target.value), children: ["upload", "document", "text", "file", "knowledge"].map((x2) =>                 (0, import_jsx_runtime3.jsx)("option", { value: x2, disabled: ["text", "upload", "document"].includes(x2) && kind === "comic", children: t(x2) }, x2)) })
    ] }),
    mode === "upload" ?                 (0, import_jsx_runtime3.jsxs)("label", { children: [
      t("localFile"),
                      (0, import_jsx_runtime3.jsx)("input", { required: true, type: "file", accept: ".txt,.md,.markdown,.pdf,.docx,.epub,.doc", onChange: (e) => {
        const selected = e.target.files?.[0];
        setFile(selected || null);
        if (selected && !title) setTitle(selected.name.replace(/\.[^.]+$/, ""));
      } })
    ] }) :                 (0, import_jsx_runtime3.jsxs)("label", { children: [
      t(mode === "text" ? "body" : mode === "file" ? "paths" : mode === "document" ? "documentPath" : "knowledgeIds"),
                      (0, import_jsx_runtime3.jsx)("textarea", { required: true, value: content, onChange: (e) => setContent(e.target.value) })
    ] }),
    ["upload", "document"].includes(mode) &&                 (0, import_jsx_runtime3.jsx)("p", { className: "r-file-hint", children: t("formatSupport") }),
    kind === "comic" &&                 (0, import_jsx_runtime3.jsx)("div", { className: "r-file-hint", children: t("imageSource") }),
    mode === "knowledge" &&                 (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
                      (0, import_jsx_runtime3.jsx)("button", { type: "button", onClick: browse, children: t("chooseKnowledge") }),
      knowledge &&                 (0, import_jsx_runtime3.jsx)("div", { className: "r-list", children: knowledge.map((entry) =>                 (0, import_jsx_runtime3.jsxs)("div", { className: "r-list-row", children: [
                        (0, import_jsx_runtime3.jsx)("span", { children: entry.title }),
                        (0, import_jsx_runtime3.jsx)("button", { type: "button", onClick: () => setContent((x2) => [x2, entry.id].filter(Boolean).join("\n")), children: t("select") })
      ] }, entry.id)) })
    ] }),
                    (0, import_jsx_runtime3.jsx)("div", { className: "r-file-hint", children: t("originals") }),
                    (0, import_jsx_runtime3.jsxs)("div", { className: "r-controls", children: [
                      (0, import_jsx_runtime3.jsx)("button", { className: "r-primary", disabled: busy, children: t(busy ? "busy" : "create") }),
                      (0, import_jsx_runtime3.jsx)("button", { type: "button", onClick: onClose, disabled: busy, children: t("cancel") })
    ] })
  ] });
}
function Shelf({ t, onOpen, onImport, refreshKey }) {
  const [q2, setQ] = (0, import_react4.useState)(""), [kind, setKind] = (0, import_react4.useState)("all"), [trash, setTrash] = (0, import_react4.useState)(false), [data, setData] = (0, import_react4.useState)(null), [error, setError] = (0, import_react4.useState)(null), [loading, setLoading] = (0, import_react4.useState)(false), [offset, setOffset] = (0, import_react4.useState)(0), [refresh, setRefresh] = (0, import_react4.useState)(0);
  (0, import_react4.useEffect)(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => api(`books?q=${encodeURIComponent(q2)}&kind=${kind}&trash=${trash}&offset=${offset}`, { signal: controller.signal }).then((d) => {
      setData((old) => offset ? { ...d, items: [...old?.items || [], ...d.items] } : d);
    }).catch((e) => {
      if (e.name !== "AbortError") setError(e);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    }), 180);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [q2, kind, trash, offset, refreshKey, refresh]);
  async function restore(book) {
    try {
      await api("restore", { method: "POST", body: { bookId: book.bookId, expectedRevision: book.latestRevision, restoreRevision: book.latestRevision, requestId: rid() } });
      setOffset(0);
      setRefresh((x2) => x2 + 1);
    } catch (e) {
      setError(e);
    }
  }
  return                 (0, import_jsx_runtime3.jsxs)("div", { className: "r-shelf", children: [
                    (0, import_jsx_runtime3.jsx)("h1", { children: t("tagline") }),
                    (0, import_jsx_runtime3.jsx)("div", { className: "r-muted", children: t("draftNotice") }),
                    (0, import_jsx_runtime3.jsxs)("div", { className: "r-controls", children: [
      ["all", "novel", "script", "comic", "pdf"].map((x2) =>                 (0, import_jsx_runtime3.jsx)("button", { className: kind === x2 ? "r-active" : "", "aria-pressed": kind === x2, onClick: () => {
        setKind(x2);
        setOffset(0);
      }, children: t(x2) }, x2)),
                      (0, import_jsx_runtime3.jsx)("button", { "aria-pressed": trash, className: trash ? "r-active" : "", onClick: () => {
        setTrash(!trash);
        setOffset(0);
      }, children: t("trash") }),
                      (0, import_jsx_runtime3.jsx)("input", { type: "search", "aria-label": t("search"), placeholder: t("search"), value: q2, onChange: (e) => {
        setQ(e.target.value);
        setOffset(0);
      } })
    ] }),
                    (0, import_jsx_runtime3.jsx)(ErrorBox, { error, t }),
    !data && loading ?                 (0, import_jsx_runtime3.jsx)("p", { role: "status", children: t("loading") }) :                 (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
                      (0, import_jsx_runtime3.jsx)("div", { className: "r-books", children: data?.items.map((book) =>                 (0, import_jsx_runtime3.jsxs)("div", { children: [
                        (0, import_jsx_runtime3.jsxs)("button", { className: "r-book", "aria-label": `${t("preview")} ${book.title}`, onClick: () => onOpen(book.bookId, book.progress?.revision), disabled: trash, children: [
                          (0, import_jsx_runtime3.jsx)(Cover, { book, t }),
                          (0, import_jsx_runtime3.jsx)("div", { className: "r-book-title", children: book.title }),
                          (0, import_jsx_runtime3.jsxs)("div", { className: "r-muted", children: [
            t(book.kind),
            " \xB7 ",
            book.author || "\u2014",
            " \xB7 ",
            book.partCount,
            " ",
            t("part")
          ] }),
          book.progress &&                 (0, import_jsx_runtime3.jsxs)("div", { className: "r-badge", children: [
            t("version"),
            " ",
            book.progress.revision
          ] })
        ] }),
        trash &&                 (0, import_jsx_runtime3.jsx)("button", { onClick: () => restore(book), children: t("restoreBook") })
      ] }, book.bookId)) }),
      data?.items.length === 0 &&                 (0, import_jsx_runtime3.jsxs)("div", { className: "r-empty", children: [
                        (0, import_jsx_runtime3.jsx)("h2", { children: t(q2 || kind !== "all" || trash ? "none" : "empty") }),
                        (0, import_jsx_runtime3.jsx)("p", { children: t("emptyHint") }),
                        (0, import_jsx_runtime3.jsx)("button", { onClick: onImport, children: t("add") })
      ] }),
      data?.nextOffset !== null && data?.nextOffset !== void 0 &&                 (0, import_jsx_runtime3.jsx)("div", { className: "r-controls", children:                 (0, import_jsx_runtime3.jsx)("button", { onClick: () => setOffset(data.nextOffset), disabled: loading, children: t(loading ? "loading" : "nextChunk") }) })
    ] })
  ] });
}
function MarkdownText({ text }) {
  const render = (tokens) => tokens?.map((token, i) => {
    const nested = () => render(token.tokens), props = { key: i };
    switch (token.type) {
      case "space":
        return null;
      case "heading":
        return import_react4.default.createElement(`h${Math.min(6, token.depth)}`, props, nested());
      case "paragraph":
        return                 (0, import_jsx_runtime3.jsx)("p", { children: nested() }, i);
      case "text":
        return                 (0, import_jsx_runtime3.jsx)(import_react4.default.Fragment, { children: token.tokens ? nested() : token.text }, i);
      case "strong":
        return                 (0, import_jsx_runtime3.jsx)("strong", { children: nested() }, i);
      case "em":
        return                 (0, import_jsx_runtime3.jsx)("em", { children: nested() }, i);
      case "del":
        return                 (0, import_jsx_runtime3.jsx)("del", { children: nested() }, i);
      case "codespan":
        return                 (0, import_jsx_runtime3.jsx)("code", { children: token.text }, i);
      case "code":
        return                 (0, import_jsx_runtime3.jsx)("pre", { children:                 (0, import_jsx_runtime3.jsx)("code", { children: token.text }) }, i);
      case "blockquote":
        return                 (0, import_jsx_runtime3.jsx)("blockquote", { children: nested() }, i);
      case "br":
        return                 (0, import_jsx_runtime3.jsx)("br", {}, i);
      case "hr":
        return                 (0, import_jsx_runtime3.jsx)("hr", {}, i);
      case "list":
        return import_react4.default.createElement(token.ordered ? "ol" : "ul", { ...props, ...token.ordered ? { start: token.start } : {} }, token.items.map((item, j2) =>                 (0, import_jsx_runtime3.jsxs)("li", { children: [
          item.task ? `${item.checked ? "\u2611" : "\u2610"} ` : "",
          render(item.tokens)
        ] }, j2)));
      case "table":
        return                 (0, import_jsx_runtime3.jsx)("div", { className: "r-table", children:                 (0, import_jsx_runtime3.jsxs)("table", { children: [
                          (0, import_jsx_runtime3.jsx)("thead", { children:                 (0, import_jsx_runtime3.jsx)("tr", { children: token.header.map((cell, j2) =>                 (0, import_jsx_runtime3.jsx)("th", { children: render(cell.tokens) }, j2)) }) }),
                          (0, import_jsx_runtime3.jsx)("tbody", { children: token.rows.map((row, j2) =>                 (0, import_jsx_runtime3.jsx)("tr", { children: row.map((cell, k2) =>                 (0, import_jsx_runtime3.jsx)("td", { children: render(cell.tokens) }, k2)) }, j2)) })
        ] }) }, i);
      case "link":
        return /^(https?:|mailto:)/i.test(token.href) ?                 (0, import_jsx_runtime3.jsx)("a", { href: token.href, target: "_blank", rel: "noopener noreferrer", children: nested() }, i) :                 (0, import_jsx_runtime3.jsx)("span", { children: nested() }, i);
      case "image":
        return                 (0, import_jsx_runtime3.jsxs)("span", { children: [
          "[\u56FE\u7247\uFF1A",
          token.text || "\u67E5\u770B\u539F\u6587\u4EF6",
          "]"
        ] }, i);
      default:
        return                 (0, import_jsx_runtime3.jsx)("span", { children: token.raw || token.text || "" }, i);
    }
  });
  return                 (0, import_jsx_runtime3.jsx)("div", { className: "r-markdown", children: render(g.lexer(text)) });
}
function TextBlocks({ blocks }) {
  return                 (0, import_jsx_runtime3.jsx)("div", { className: "r-text", children: blocks.map((b2) =>                 (0, import_jsx_runtime3.jsx)("div", { "data-block": b2.id, children: b2.type === "markdown" ?                 (0, import_jsx_runtime3.jsx)(MarkdownText, { text: b2.text }) : b2.type === "dialogue" ?                 (0, import_jsx_runtime3.jsxs)("div", { className: "r-dialogue", children: [
                    (0, import_jsx_runtime3.jsx)("strong", { children: b2.speaker }),
                    (0, import_jsx_runtime3.jsx)("p", { children: b2.text })
  ] }) : b2.type === "heading" ?                 (0, import_jsx_runtime3.jsx)("h3", { children: b2.text.replace(/^#{1,6} /, "") }) :                 (0, import_jsx_runtime3.jsx)("p", { className: `r-${b2.type}`, children: b2.text }) }, b2.id)) });
}
function ComicPage({ book, part, active, t, observe }) {
  const [failed, setFailed] = (0, import_react4.useState)(false), ref = (0, import_react4.useRef)(null);
  (0, import_react4.useEffect)(() => observe(ref.current, part.id), [observe, part.id]);
  return                 (0, import_jsx_runtime3.jsx)("div", { ref, "data-page": part.id, className: "r-comic-page", style: { aspectRatio: `${part.width}/${part.height}` }, children: active && !failed ?                 (0, import_jsx_runtime3.jsx)("img", { src: assetUrl(book, part.id), alt: part.alt, width: part.width, height: part.height, decoding: "async", loading: "lazy", onError: () => setFailed(true) }) :                 (0, import_jsx_runtime3.jsx)("div", { className: "r-comic-placeholder", children: failed ? t("missingImage") : part.title }) });
}
function PdfPage({ document, part, active, t, observe, zoom }) {
  const ref = (0, import_react4.useRef)(null), canvas = (0, import_react4.useRef)(null), [failed, setFailed] = (0, import_react4.useState)(false);
  (0, import_react4.useEffect)(() => observe(ref.current, part.id), [observe, part.id]);
  (0, import_react4.useEffect)(() => {
    if (!active || !document || !canvas.current) return;
    let cancelled = false, task, page;
    setFailed(false);
    document.getPage(part.pageNumber).then((p) => {
      if (cancelled) return;
      page = p;
      const natural = p.getViewport({ scale: 1 }), width = Math.min(1600, (ref.current?.clientWidth || 760) * (window.devicePixelRatio || 1)), scale = Math.min(width / natural.width, Math.sqrt(8e6 / (natural.width * natural.height))), viewport = p.getViewport({ scale });
      const node = canvas.current;
      if (!node) return;
      node.width = Math.ceil(viewport.width);
      node.height = Math.ceil(viewport.height);
      task = p.render({ canvasContext: node.getContext("2d"), viewport });
      return task.promise;
    }).catch((e) => {
      if (!cancelled && e.name !== "RenderingCancelledException") setFailed(true);
    });
    return () => {
      cancelled = true;
      task?.cancel();
      if (task) task.promise.catch(() => {
      }).finally(() => page?.cleanup());
      else page?.cleanup();
    };
  }, [document, active, part.pageNumber, zoom]);
  return                 (0, import_jsx_runtime3.jsx)("div", { ref, "data-page": part.id, className: "r-comic-page r-pdf-page", style: { aspectRatio: `${part.width}/${part.height}` }, children: active && document && !failed ?                 (0, import_jsx_runtime3.jsx)("canvas", { ref: canvas, "aria-label": `${t("pageLabel")} ${part.pageNumber}`, role: "img" }) :                 (0, import_jsx_runtime3.jsx)("div", { className: "r-comic-placeholder", children: failed ? t("PDF_RENDER_FAILED") : !document ? t("loading") : part.title }) });
}
function selectComicPages(parts, visible, container, preferred, fallback) {
  const viewport = container?.getBoundingClientRect(), top = viewport ? viewport.top + 16 : 0;
  const nodes = container ? [...container.querySelectorAll("[data-page]")] : [];
  const rects = new Map(nodes.map((node) => [node.dataset.page, node.getBoundingClientRect()]));
  const current = nodes.find((node) => rects.get(node.dataset.page).bottom > top)?.dataset.page;
  const focus = preferred || current || fallback, index = parts.findIndex((p) => p.id === focus);
  const indices = new Map(parts.map((p, i) => [p.id, i]));
  const candidates = new Set([focus, ...visible].flatMap((key) => {
    const i = parts.findIndex((p) => p.id === key);
    return i < 0 ? [] : parts.slice(Math.max(0, i - 1), i + 2).map((p) => p.id);
  }));
  const distance = (key) => {
    const rect = rects.get(key);
    return viewport && rect ? Math.max(0, top - rect.bottom, rect.top - viewport.bottom) : Infinity;
  };
  return new Set([...candidates].sort((a, b2) => Number(b2 === focus) - Number(a === focus) || distance(a) - distance(b2) || Math.abs(indices.get(a) - index) - Math.abs(indices.get(b2) - index) || indices.get(a) - indices.get(b2)).slice(0, 3));
}
function Reading({ book, initialAnchor, t, client, preferences, setPreferences, onBack, onOpen, onTrash }) {
  const [partIndex, setPartIndex] = (0, import_react4.useState)(0), [chunkIndex, setChunkIndex] = (0, import_react4.useState)(0), [blocks, setBlocks] = (0, import_react4.useState)([]), [reading, setReading] = (0, import_react4.useState)(null), [error, setError] = (0, import_react4.useState)(null), [sync, setSync] = (0, import_react4.useState)("pending"), [toc, setToc] = (0, import_react4.useState)(() => window.innerWidth > 700), [side, setSide] = (0, import_react4.useState)(null), [history, setHistory] = (0, import_react4.useState)(null), [latest, setLatest] = (0, import_react4.useState)(book.latestRevision), [zoom, setZoom] = (0, import_react4.useState)(100), [visible, setVisible] = (0, import_react4.useState)(                new Set()), [loading, setLoading] = (0, import_react4.useState)(true);
  const scroller = (0, import_react4.useRef)(null), alive = (0, import_react4.useRef)(true), restoring = (0, import_react4.useRef)(true), target = (0, import_react4.useRef)(null), position = (0, import_react4.useRef)(null), lastSaved = (0, import_react4.useRef)(""), saveTimer = (0, import_react4.useRef)(null), observer = (0, import_react4.useRef)(null), chapterEpoch = (0, import_react4.useRef)(0), captureRef = (0, import_react4.useRef)(capture);
  const [comicFocus, setComicFocus] = (0, import_react4.useState)(null), [imageRagPart, setImageRagPart] = (0, import_react4.useState)(null);
  function closeImageRag() {
    setImageRagPart(null);
    setSide(null);
  }
  const part = book.parts[partIndex], comic = book.kind === "comic" || book.kind === "pdf";
  const [pdfDocument, setPdfDocument] = (0, import_react4.useState)(null);
  const chapterFailure = (0, import_react4.useRef)(null);
  captureRef.current = capture;
  (0, import_react4.useEffect)(() => () => {
    alive.current = false;
    clearTimeout(saveTimer.current);
    flush();
  }, []);
  const fail = (e) => {
    if (alive.current) {
      setError(e);
      setSync(e.status === 409 ? "conflict" : "pending");
    }
  };
  (0, import_react4.useEffect)(() => {
    if (book.kind !== "pdf") return;
    let cancelled = false, task;
    const runtime = "/api/reader/runtime/";
    import(

      runtime + "pdf.min.mjs"
    ).then((module2) => {
      if (cancelled) return;
      module2.GlobalWorkerOptions.workerSrc = runtime + "pdf.worker.min.mjs";
      task = module2.getDocument({ url: assetUrl(book, "document"), isEvalSupported: false, enableXfa: false, cMapUrl: runtime + "cmaps/", cMapPacked: true, standardFontDataUrl: runtime + "standard_fonts/", wasmUrl: runtime + "wasm/", disableRange: true, disableStream: true, maxImageSize: 8e6, stopAtErrors: true });
      return task.promise;
    }).then((document) => {
      if (!document) return;
      if (cancelled) {
        document.destroy();
        return;
      }
      if (document.numPages !== book.parts.length) throw { status: 422, code: "INVALID_PDF" };
      setPdfDocument(document);
    }).catch((e) => {
      if (!cancelled) fail({ status: 422, code: e.name === "PasswordException" ? "ENCRYPTED_DOCUMENT_UNSUPPORTED" : "PDF_RENDER_FAILED" });
    });
    return () => {
      cancelled = true;
      task?.destroy();
      setPdfDocument(null);
    };
  }, [book.bookId, book.revision]);
  function flush() {
    const anchor = position.current;
    if (!anchor) return Promise.resolve();
    const signature = JSON.stringify(anchor);
    if (signature === lastSaved.current) return Promise.resolve();
    return client.write(book.bookId, "reading", anchor).then((r) => {
      lastSaved.current = signature;
      if (alive.current) {
        setReading(r);
        setSync("synced");
      }
    }).catch(fail);
  }
  function mark(anchor) {
    position.current = anchor;
    if (JSON.stringify(anchor) !== lastSaved.current) {
      setSync("pending");
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, 900);
    }
  }
  function goto(anchor) {
    closeImageRag();
    if (anchor.revision !== book.revision) {
      onOpen(book.bookId, anchor.revision, anchor);
      return;
    }
    const index = book.parts.findIndex((p) => p.id === anchor.partId);
    if (index < 0) return;
    restoring.current = true;
    target.current = anchor;
    setPartIndex(index);
    setChunkIndex(anchor.chunkIndex || 0);
    if (comic || index === partIndex && (anchor.chunkIndex || 0) === chunkIndex) restorePosition(anchor);
  }
  function restorePosition(anchor) {
    requestAnimationFrame(() => {
      if (!alive.current) return;
      const container = scroller.current;
      if (!container) return;
      const key = comic ? anchor?.partId : anchor?.blockId;
      const elements = container.querySelectorAll(comic ? "[data-page]" : "[data-block]");
      const node = [...elements].find((e) => (comic ? e.dataset.page : e.dataset.block) === key);
      if (node) {
        container.scrollTop += node.getBoundingClientRect().top - container.getBoundingClientRect().top + (anchor?.ratio || 0) * node.getBoundingClientRect().height - 15;
      } else container.scrollTop = 0;
      requestAnimationFrame(() => {
        if (alive.current) {
          restoring.current = false;
          captureRef.current();
        }
      });
    });
  }
  (0, import_react4.useEffect)(() => {
    let cancelled = false;
    client.loadReading(book.bookId).then((r) => {
      if (cancelled) return;
      setReading(r);
      const anchor = initialAnchor || (r.progress?.revision === book.revision ? r.progress : null);
      if (anchor) {
        target.current = anchor;
        const idx = book.parts.findIndex((p) => p.id === anchor.partId);
        if (idx >= 0) {
          setPartIndex(idx);
          setChunkIndex(anchor.chunkIndex || 0);
        }
      } else target.current = null;
    }).catch(fail);
    const timer = setInterval(() => api(`book?id=${book.bookId}`).then((b2) => {
      if (!cancelled) setLatest(b2.latestRevision);
    }).catch(fail), 3e4);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [book.bookId]);
  (0, import_react4.useEffect)(() => {
    if (!reading) return;
    const controller = new AbortController(), epoch = ++chapterEpoch.current;
    setLoading(true);
    restoring.current = true;
    if (comic) {
      setLoading(false);
      restorePosition(target.current);
      return () => controller.abort();
    }
    setBlocks([]);
    api(`chunk?id=${book.bookId}&revision=${book.revision}&part=${encodeURIComponent(part.id)}&chunk=${chunkIndex}`, { signal: controller.signal }).then((d) => {
      if (epoch !== chapterEpoch.current) return;
      const previous = chapterFailure.current;
      setError((old) => old === previous ? null : old);
      chapterFailure.current = null;
      setBlocks(d.blocks);
      setLoading(false);
      restorePosition(target.current);
    }).catch((e) => {
      if (e.name !== "AbortError" && epoch === chapterEpoch.current) {
        chapterFailure.current = e;
        setLoading(false);
        fail(e);
      }
    });
    return () => controller.abort();
  }, [reading !== null, comic ? null : partIndex, chunkIndex]);
  (0, import_react4.useEffect)(() => {
    const current = position.current;
    if (current && !restoring.current) {
      restoring.current = true;
      restorePosition(current);
    }
  }, [preferences.fontSize, preferences.lineHeight, preferences.comicMode]);
  function capture() {
    if (restoring.current || !reading || loading || !scroller.current) return;
    const container = scroller.current, top = container.getBoundingClientRect().top + 16;
    const nodes = [...container.querySelectorAll(comic ? "[data-page]" : "[data-block]")];
    const node = nodes.find((e) => e.getBoundingClientRect().bottom > top) || nodes[nodes.length - 1];
    if (!node) return;
    const rect = node.getBoundingClientRect(), pageId = comic ? node.dataset.page : part.id;
    if (comic) {
      setComicFocus(pageId);
      const index = book.parts.findIndex((p) => p.id === pageId);
      if (index >= 0) setPartIndex(index);
    }
    const anchor = { revision: book.revision, partId: pageId, chunkIndex: comic ? 0 : chunkIndex, blockId: comic ? null : node.dataset.block, ratio: Math.max(0, Math.min(1, (top - rect.top) / Math.max(1, rect.height))) };
    mark(anchor);
  }
  const observe = (0, import_react4.useCallback)((node, partId) => {
    if (!node) return () => {
    };
    if (!observer.current) {
      observer.current = new IntersectionObserver((entries) => {
        setVisible((old) => {
          const next = new Set(old);
          for (const entry of entries) {
            const key = entry.target.dataset.page;
            if (entry.isIntersecting) next.add(key);
            else next.delete(key);
          }
          return next;
        });
      }, { root: scroller.current, rootMargin: "400px 0px" });
    }
    observer.current.observe(node);
    return () => observer.current?.unobserve(node);
  }, []);
  (0, import_react4.useEffect)(() => () => observer.current?.disconnect(), []);
  function navigate(i, c = 0) {
    closeImageRag();
    flush();
    restoring.current = true;
    target.current = comic ? { revision: book.revision, partId: book.parts[i].id, ratio: 0 } : null;
    position.current = null;
    setPartIndex(i);
    setChunkIndex(c);
    if (comic || i === partIndex && c === chunkIndex) restorePosition(target.current);
  }
  async function addBookmark() {
    try {
      capture();
      if (!position.current) return;
      const r = await client.write(book.bookId, "bookmark", { ...position.current, label: part.title });
      if (alive.current) {
        setReading(r);
        setSide("bookmarks");
      }
    } catch (e) {
      fail(e);
    }
  }
  async function removeBookmark(key) {
    try {
      const r = await client.write(book.bookId, "bookmark", { removeId: key });
      if (alive.current) setReading(r);
    } catch (e) {
      fail(e);
    }
  }
  async function showHistory() {
    setSide("history");
    try {
      const result = await api(`history?id=${book.bookId}`);
      if (alive.current) setHistory(result.versions);
    } catch (e) {
      fail(e);
    }
  }
  async function restore(revision) {
    try {
      const result = await api("restore", { method: "POST", body: { bookId: book.bookId, expectedRevision: latest, restoreRevision: revision, requestId: rid() } });
      onOpen(book.bookId, result.revision);
    } catch (e) {
      fail(e);
    }
  }
  async function recycle() {
    try {
      await api("trash", { method: "POST", body: { bookId: book.bookId, expectedRevision: latest, requestId: rid() } });
      onTrash();
    } catch (e) {
      fail(e);
    }
  }
  function resolveConflict(remote) {
    const r = client.current(book.bookId);
    if (remote) {
      clearTimeout(saveTimer.current);
      position.current = null;
      restoring.current = true;
      lastSaved.current = JSON.stringify(r.progress);
      setSync("synced");
    }
    client.resolve(book.bookId);
    setError(null);
    setReading(r);
    if (remote) {
      if (r.progress) goto(r.progress);
      else {
        restoring.current = false;
        captureRef.current();
      }
    } else {
      lastSaved.current = "";
      flush();
    }
  }
  const activePages = comic ? selectComicPages(book.parts, visible, scroller.current, restoring.current ? target.current?.partId : null, comicFocus || part.id) :                 new Set();
  const decodedPages = activePages;
  const comicParts = preferences.comicMode === "page" ? [part] : book.parts;
  return                 (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
                    (0, import_jsx_runtime3.jsxs)("div", { className: "r-toolbar", children: [
                      (0, import_jsx_runtime3.jsxs)("button", { onClick: () => {
        flush();
        onBack();
      }, children: [
        "\u2190 ",
        t("back")
      ] }),
                      (0, import_jsx_runtime3.jsxs)("span", { className: "r-reading-title", children: [
        book.title,
        " \xB7 ",
        t("version"),
        " ",
        book.revision
      ] }),
                      (0, import_jsx_runtime3.jsx)("button", { "aria-expanded": toc, onClick: () => setToc(!toc), children: t("toc") }),
                      (0, import_jsx_runtime3.jsx)("button", { onClick: addBookmark, children: t("bookmark") }),
                      (0, import_jsx_runtime3.jsx)("button", { onClick: () => setSide(side === "bookmarks" ? null : "bookmarks"), children: t("bookmarks") }),
                      (0, import_jsx_runtime3.jsx)("button", { onClick: showHistory, children: t("history") }),
                      (0, import_jsx_runtime3.jsx)("button", { onClick: () => setSide("agentAccess"), children: t("agentAccess") }),
      comic &&                 (0, import_jsx_runtime3.jsx)("button", { onClick: () => {
        setImageRagPart(part);
        setSide("imageRag");
      }, children: t("imageRag") })
    ] }),
                    (0, import_jsx_runtime3.jsxs)("div", { ref: scroller, className: "r-scroll", onScroll: capture, style: { "--r-size": `${preferences.fontSize}px`, "--r-leading": preferences.lineHeight }, children: [
                      (0, import_jsx_runtime3.jsxs)("div", { className: "r-settings", children: [
                        (0, import_jsx_runtime3.jsxs)("label", { children: [
          t("fontSize"),
                          (0, import_jsx_runtime3.jsx)("input", { "aria-label": t("fontSize"), type: "range", min: "16", max: "30", value: preferences.fontSize, onChange: (e) => setPreferences({ ...preferences, fontSize: Number(e.target.value) }) }),
                          (0, import_jsx_runtime3.jsx)("output", { children: preferences.fontSize })
        ] }),
                        (0, import_jsx_runtime3.jsxs)("label", { children: [
          t("lineHeight"),
                          (0, import_jsx_runtime3.jsx)("select", { value: preferences.lineHeight, onChange: (e) => setPreferences({ ...preferences, lineHeight: Number(e.target.value) }), children: [[1.65, "compact"], [1.95, "comfortable"], [2.3, "loose"]].map(([value, label]) =>                 (0, import_jsx_runtime3.jsx)("option", { value, children: t(label) }, value)) })
        ] }),
                        (0, import_jsx_runtime3.jsxs)("label", { children: [
          t("theme"),
                          (0, import_jsx_runtime3.jsx)("select", { value: preferences.theme, onChange: (e) => setPreferences({ ...preferences, theme: e.target.value }), children: ["light", "warm", "dark"].map((x2) =>                 (0, import_jsx_runtime3.jsx)("option", { value: x2, children: t(x2) }, x2)) })
        ] })
      ] }),
                      (0, import_jsx_runtime3.jsx)(ErrorBox, { error, t }),
      book.importInfo?.warnings?.map((code) =>                 (0, import_jsx_runtime3.jsx)("p", { className: "r-file-hint", children: t(code) }, code)),
      sync === "conflict" &&                 (0, import_jsx_runtime3.jsxs)("div", { className: "r-controls", children: [
                        (0, import_jsx_runtime3.jsx)("button", { onClick: () => resolveConflict(true), children: t("useRemote") }),
                        (0, import_jsx_runtime3.jsx)("button", { onClick: () => resolveConflict(false), children: t("keepLocal") })
      ] }),
      sync === "pending" && error && !error.status &&                 (0, import_jsx_runtime3.jsx)("button", { onClick: () => client.retry(book.bookId).then((r) => {
        if (r) {
          setReading(r);
          setSync("synced");
          setError(null);
        }
      }).catch(fail), children: t("retry") }),
      latest > book.revision &&                 (0, import_jsx_runtime3.jsxs)("div", { className: "r-controls", children: [
                        (0, import_jsx_runtime3.jsxs)("span", { children: [
          t("latest"),
          " \xB7 ",
          latest
        ] }),
                        (0, import_jsx_runtime3.jsx)("button", { onClick: () => {
          flush();
          onOpen(book.bookId, latest);
        }, children: t("switchLatest") })
      ] }),
      side === "agentAccess" &&                 (0, import_jsx_runtime3.jsx)(AgentAuthorization, { bookId: book.bookId, t, onClose: () => setSide(null) }),
      " ",
      side === "imageRag" && imageRagPart &&                 (0, import_jsx_runtime3.jsx)(ImageRag, { book, part: imageRagPart, t, onClose: closeImageRag, onCitation: (c) => {
        closeImageRag();
        const anchor = { revision: Number(c.revision), partId: c.partId, chunkIndex: 0, ratio: 0 };
        if (c.sourceId !== book.bookId) onOpen(c.sourceId, Number(c.revision), anchor);
        else goto(anchor);
      } }),
      side && side !== "agentAccess" && side !== "imageRag" &&                 (0, import_jsx_runtime3.jsxs)("div", { className: "r-page", children: [
                        (0, import_jsx_runtime3.jsx)("button", { onClick: () => setSide(null), children: t("close") }),
                        (0, import_jsx_runtime3.jsx)("h2", { children: t(side) }),
                        (0, import_jsx_runtime3.jsx)("div", { className: "r-list", children: side === "bookmarks" ? reading?.bookmarks.length ? reading.bookmarks.map((b2) =>                 (0, import_jsx_runtime3.jsxs)("div", { className: "r-list-row", children: [
                          (0, import_jsx_runtime3.jsxs)("span", { children: [
            b2.label,
            " \xB7 ",
            t("version"),
            " ",
            b2.revision
          ] }),
                          (0, import_jsx_runtime3.jsx)("button", { onClick: () => {
            setSide(null);
            goto(b2);
          }, children: t("preview") }),
                          (0, import_jsx_runtime3.jsx)("button", { onClick: () => removeBookmark(b2.id), children: t("remove") })
        ] }, b2.id)) :                 (0, import_jsx_runtime3.jsx)("p", { children: t("noBookmarks") }) : history?.map((v2) =>                 (0, import_jsx_runtime3.jsxs)("div", { className: "r-list-row", children: [
                          (0, import_jsx_runtime3.jsxs)("span", { children: [
            t("version"),
            " ",
            v2.revision,
            " \xB7 ",
            v2.title
          ] }),
                          (0, import_jsx_runtime3.jsx)("button", { onClick: () => onOpen(book.bookId, v2.revision), children: t("readVersion") }),
                          (0, import_jsx_runtime3.jsx)("button", { onClick: () => restore(v2.revision), children: t("restore") })
        ] }, v2.revision)) })
      ] }),
                      (0, import_jsx_runtime3.jsxs)("div", { className: `r-layout ${toc ? "" : "r-no-toc"}`, children: [
        toc &&                 (0, import_jsx_runtime3.jsxs)("aside", { className: "r-toc", "aria-label": t("toc"), children: [
          book.parts.map((p, i) =>                 (0, import_jsx_runtime3.jsx)("button", { className: i === partIndex ? "r-active" : "", "aria-current": i === partIndex ? "location" : void 0, onClick: () => navigate(i), children: p.title }, p.id)),
                          (0, import_jsx_runtime3.jsx)("button", { onClick: recycle, children: t("recycle") })
        ] }),
                        (0, import_jsx_runtime3.jsxs)("div", { children: [
                          (0, import_jsx_runtime3.jsxs)("article", { className: "r-page", children: [
                            (0, import_jsx_runtime3.jsx)("h2", { children: part.title }),
            loading ?                 (0, import_jsx_runtime3.jsx)("p", { role: "status", children: t("loading") }) : comic ?                 (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
                              (0, import_jsx_runtime3.jsxs)("div", { className: "r-controls", children: [
                ["scroll", "page"].map((mode) =>                 (0, import_jsx_runtime3.jsx)("button", { className: preferences.comicMode === mode ? "r-active" : "", onClick: () => setPreferences({ ...preferences, comicMode: mode }), children: t(mode) }, mode)),
                                (0, import_jsx_runtime3.jsx)("button", { "aria-label": t("zoomOut"), onClick: () => setZoom((z2) => Math.max(75, z2 - 25)), children: "\u2212" }),
                                (0, import_jsx_runtime3.jsxs)("button", { onClick: () => setZoom(100), children: [
                  zoom,
                  "% \xB7 ",
                  t("fit")
                ] }),
                                (0, import_jsx_runtime3.jsx)("button", { "aria-label": t("zoomIn"), onClick: () => setZoom((z2) => Math.min(200, z2 + 25)), children: "\uFF0B" })
              ] }),
                              (0, import_jsx_runtime3.jsx)("div", { className: "r-comic-viewport", dir: book.direction, children:                 (0, import_jsx_runtime3.jsx)("div", { style: { width: `${zoom}%` }, children: comicParts.map((p) =>                 (0, import_jsx_runtime3.jsxs)(import_react4.default.Fragment, { children: [
                                (0, import_jsx_runtime3.jsx)("div", { className: "r-comic-label", children: p.title }),
                book.kind === "pdf" ?                 (0, import_jsx_runtime3.jsx)(PdfPage, { document: pdfDocument, part: p, t, active: preferences.comicMode === "page" || decodedPages.has(p.id), observe, zoom }) :                 (0, import_jsx_runtime3.jsx)(ComicPage, { book, part: p, t, active: preferences.comicMode === "page" || decodedPages.has(p.id), observe })
              ] }, p.id)) }) })
            ] }) :                 (0, import_jsx_runtime3.jsx)(TextBlocks, { blocks })
          ] }),
                          (0, import_jsx_runtime3.jsxs)("div", { className: "r-location r-muted", children: [
                            (0, import_jsx_runtime3.jsxs)("span", { children: [
              partIndex + 1,
              " / ",
              book.parts.length,
              " \xB7 ",
              comic ? "" : `${chunkIndex + 1} / ${part.chunks.length}`
            ] }),
                            (0, import_jsx_runtime3.jsx)("span", { role: "status", children: t(sync) })
          ] }),
                          (0, import_jsx_runtime3.jsxs)("div", { className: "r-pager", children: [
                            (0, import_jsx_runtime3.jsxs)("button", { disabled: partIndex === 0, onClick: () => navigate(partIndex - 1), children: [
              "\u2190 ",
              t("prev")
            ] }),
            !comic && chunkIndex > 0 &&                 (0, import_jsx_runtime3.jsx)("button", { onClick: () => navigate(partIndex, chunkIndex - 1), children: t("prevChunk") }),
            !comic && chunkIndex < part.chunks.length - 1 &&                 (0, import_jsx_runtime3.jsx)("button", { onClick: () => navigate(partIndex, chunkIndex + 1), children: t("nextChunk") }),
                            (0, import_jsx_runtime3.jsxs)("button", { disabled: partIndex === book.parts.length - 1, onClick: () => navigate(partIndex + 1), children: [
              t("next"),
              " \u2192"
            ] })
          ] })
        ] })
      ] })
    ] })
  ] });
}
function ReaderPanel({ t, client }) {
  const [book, setBook] = (0, import_react4.useState)(null), [initialAnchor, setInitialAnchor] = (0, import_react4.useState)(null), [importing, setImporting] = (0, import_react4.useState)(false), [error, setError] = (0, import_react4.useState)(null), [opening, setOpening] = (0, import_react4.useState)(false), [refreshKey, setRefreshKey] = (0, import_react4.useState)(0), [preferences, setPrefs] = (0, import_react4.useState)(initialSettings);
  const openEpoch = (0, import_react4.useRef)(0), alive = (0, import_react4.useRef)(true);
  (0, import_react4.useEffect)(() => {
    api("settings").then((s) => {
      if (alive.current) setPrefs(s);
    }).catch((e) => {
      if (alive.current) setError(e);
    });
    let previous;
    try {
      previous = JSON.parse(window.localStorage?.getItem("dsh-reader:last-open:1"));
    } catch {
    }
    if (previous?.bookId && Number.isSafeInteger(previous.revision) && previous.revision > 0) onOpen(previous.bookId, previous.revision, null, true);
    return () => {
      alive.current = false;
      openEpoch.current++;
    };
  }, []);
  function setPreferences(value) {
    setPrefs(value);
    api("settings", { method: "POST", keepalive: true, body: { settings: value, requestId: rid() } }).catch((e) => {
      if (alive.current) setError(e);
    });
  }
  async function onOpen(bookId, revision, anchor = null, resume = false) {
    const epoch = ++openEpoch.current;
    setOpening(true);
    setError(null);
    try {
      await client.loadReading(bookId);
      const reading = client.current(bookId);
      const selected = revision || reading?.progress?.revision;
      const b2 = await api(`book?id=${encodeURIComponent(bookId)}${selected ? `&revision=${selected}` : ""}`);
      if (alive.current && epoch === openEpoch.current) {
        setInitialAnchor(anchor);
        setBook(b2);
        setImporting(false);
        try {
          window.localStorage?.setItem("dsh-reader:last-open:1", JSON.stringify({ bookId: b2.bookId, revision: b2.revision }));
        } catch {
        }
      }
    } catch (e) {
      if (alive.current && epoch === openEpoch.current) {
        setError(e);
        if (resume) try {
          window.localStorage?.removeItem("dsh-reader:last-open:1");
        } catch {
        }
      }
    } finally {
      if (alive.current && epoch === openEpoch.current) setOpening(false);
    }
  }
  function back() {
    openEpoch.current++;
    setBook(null);
    setRefreshKey((k2) => k2 + 1);
    setError(null);
    try {
      window.localStorage?.removeItem("dsh-reader:last-open:1");
    } catch {
    }
  }
  return                 (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-reader", "data-theme": preferences.theme, children: [
                    (0, import_jsx_runtime3.jsx)("style", { children: reader_default }),
                    (0, import_jsx_runtime3.jsx)(ErrorBox, { error, t }),
    book ?                 (0, import_jsx_runtime3.jsx)(Reading, { book, initialAnchor, t, client, preferences, setPreferences, onBack: back, onOpen, onTrash: back }, `${book.bookId}:${book.revision}`) :                 (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
                      (0, import_jsx_runtime3.jsxs)("div", { className: "r-toolbar", children: [
                        (0, import_jsx_runtime3.jsx)("span", { className: "r-brand", children: t("panel") }),
                        (0, import_jsx_runtime3.jsx)("span", { className: "r-muted r-scope", children: t("scope") }),
                        (0, import_jsx_runtime3.jsx)("button", { className: "r-primary", onClick: () => setImporting(true), children: t("add") })
      ] }),
                      (0, import_jsx_runtime3.jsxs)("div", { className: "r-scroll", children: [
        opening &&                 (0, import_jsx_runtime3.jsx)("p", { role: "status", children: t("loading") }),
        importing ?                 (0, import_jsx_runtime3.jsx)(ImportForm, { t, onClose: () => setImporting(false), onCreated: (b2) => {
          setRefreshKey((x2) => x2 + 1);
          onOpen(b2.bookId, b2.revision);
        } }) :                 (0, import_jsx_runtime3.jsx)(Shelf, { t, onOpen, onImport: () => setImporting(true), refreshKey })
      ] })
    ] })
  ] });
}
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-reader: locale");
  const t = ctx.locale.bind(NS), client = createClient();
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: APP }, () =>                 (0, import_jsx_runtime3.jsx)(ReaderPanel, { t, client })));
  registerLaunchpadApp(ctx, { id: APP, name: t("panel"), description: t("description"), icon: ReaderIcon, order: 45 }, APP);
}

return module.exports;}});
