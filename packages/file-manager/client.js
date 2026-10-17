// 由 scripts/build-client.mjs 生成；请编辑 client/main.jsx 后重新构建。
window.__ModuleLoader__.load({
  id: "dsh-fileman",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
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
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/main.jsx
var main_exports = {};
__export(main_exports, {
  FilemanPanel: () => FilemanPanel,
  FilemanPanelIcon: () => FilemanPanelIcon,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(main_exports);

// client/knowledge-import.js
function captureDrop(dt) {
  const paths = dt.getData("application/x-dsh-file-paths");
  if (paths) {
    try {
      return { paths: JSON.parse(paths) };
    } catch {
      throw Error("\u62D6\u5165\u6570\u636E\u65E0\u6548");
    }
  }
  const urls = String(dt.getData("text/uri-list") || "").split(/\r?\n/).filter((x) => /^https?:\/\//i.test(x));
  if (urls.length) return { urls };
  const entries = [...dt.items || []].filter((i) => i.kind === "file").map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  return entries.length ? { entries } : { files: [...dt.files || []] };
}
var entryFile = (e) => new Promise((resolve, reject) => e.file(resolve, reject));
async function* walk(entry, path = "") {
  const rel = path ? path + "/" + entry.name : entry.name;
  if (entry.isFile) {
    yield { relativePath: rel, file: await entryFile(entry) };
    return;
  }
  if (entry.isDirectory) {
    yield { relativePath: rel, directory: true };
    const reader = entry.createReader();
    for (; ; ) {
      const children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!children.length) break;
      for (const child of children) {
        try {
          yield* walk(child, rel);
        } catch (e) {
          yield { relativePath: rel + "/" + child.name, error: e.message };
        }
      }
    }
  }
}
async function* walkHandle(handle, path = "") {
  const rel = path ? path + "/" + handle.name : handle.name;
  if (handle.kind === "file") {
    yield { relativePath: rel, file: await handle.getFile() };
    return;
  }
  yield { relativePath: rel, directory: true };
  for await (const child of handle.values()) {
    try {
      yield* walkHandle(child, rel);
    } catch (e) {
      yield { relativePath: rel + "/" + child.name, error: e.message };
    }
  }
}
function encode(buffer) {
  let s = "";
  for (const byte of new Uint8Array(buffer)) s += String.fromCharCode(byte);
  return btoa(s);
}
async function runImport(api, input, progress, signal) {
  const results = [];
  const dirs = /* @__PURE__ */ new Set();
  let count2 = 0;
  if (input.urls) {
    for (const url of input.urls) {
      if (signal.aborted) break;
      try {
        const r = await api("knowledge/save", { method: "POST", body: { title: url.slice(0, 240), content: url, sourceUrl: url, category: "\u7F51\u9875", tags: [], requestId: crypto.randomUUID() } });
        results.push({ path: url, ok: true, duplicate: !!r.duplicate });
      } catch (e) {
        results.push({ path: url, ok: false, error: e.message });
      }
    }
    return results;
  }
  if (input.paths) {
    for (const path of input.paths) {
      if (signal.aborted) break;
      progress({ text: "\u6B63\u5728\u5BFC\u5165 " + path, results });
      try {
        const r = await api("knowledge/import", { method: "POST", body: { path, requestId: crypto.randomUUID() } });
        results.push(...r.results);
      } catch (e) {
        results.push({ path, ok: false, error: e.message });
      }
    }
    return results;
  }
  async function send(name, item) {
    if (signal.aborted) return;
    if (++count2 > 1e4) throw Error("\u8D85\u8FC7\u5355\u6B21\u4E00\u4E07\u9879\u4E0A\u9650\uFF0C\u5269\u4F59\u5185\u5BB9\u672A\u5BFC\u5165");
    progress({ text: "\u6B63\u5728\u5BFC\u5165 " + item.relativePath, results });
    let uploadId;
    try {
      if (item.error) throw Error(item.error);
      if (item.directory) {
        await api("knowledge/upload", { method: "POST", body: { name, relativePath: item.relativePath, directory: true, requestId: crypto.randomUUID() } });
        results.push({ path: item.relativePath, ok: true });
        return;
      }
      const f = item.file;
      if (f.size > 5 * 1024 ** 3) throw Error("\u6587\u4EF6\u8D85\u8FC7 5 GB \u4E0A\u4F20\u4E0A\u9650");
      let offset = 0, last;
      do {
        if (signal.aborted) throw Error("\u5BFC\u5165\u5DF2\u53D6\u6D88");
        const chunk = await f.slice(offset, offset + 256 * 1024).arrayBuffer();
        last = await api("knowledge/upload", { method: "POST", body: { name, relativePath: item.relativePath, data: encode(chunk), offset, uploadId, final: offset + chunk.byteLength >= f.size, requestId: crypto.randomUUID() } });
        uploadId = last.uploadId;
        offset += chunk.byteLength;
        progress({ text: `\u6B63\u5728\u5BFC\u5165 ${item.relativePath} \xB7 ${offset}/${f.size} \u5B57\u8282`, results });
      } while (offset < f.size);
      results.push({ path: item.relativePath, ok: true, duplicate: !!last.duplicate });
    } catch (e) {
      if (uploadId) await api("knowledge/cancel-upload", { method: "POST", body: { uploadId } }).catch(() => {
      });
      results.push({ path: item.relativePath, ok: false, error: e.message });
    }
  }
  if (input.handles) {
    for (const root of input.handles) {
      try {
        for await (const item of walkHandle(root)) {
          if (signal.aborted) break;
          await send(root.name, item);
        }
      } catch (e) {
        results.push({ path: root.name, ok: false, error: e.message });
      }
    }
  } else if (input.entries) {
    for (const root of input.entries) {
      if (signal.aborted) break;
      try {
        for await (const item of walk(root)) {
          if (signal.aborted) break;
          await send(root.isDirectory ? root.name : "\u62D6\u5165\u6587\u4EF6", item);
        }
      } catch (e) {
        results.push({ path: root.name, ok: false, error: e.message });
      }
    }
  } else for (const file of input.files || []) {
    if (signal.aborted) break;
    const path = file.webkitRelativePath || file.name, name = file.webkitRelativePath ? path.split("/")[0] : "\u62D6\u5165\u6587\u4EF6";
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (!dirs.has(dir)) {
        dirs.add(dir);
        await send(name, { directory: true, relativePath: dir });
      }
    }
    await send(name, { file, relativePath: path });
  }
  return results;
}

// lib/file-types.js
var FILE_TYPES = {
  folder: { label: "\u6587\u4EF6\u5939", color: "#3499d4" },
  image: { label: "\u56FE\u7247", color: "#8b63d2" },
  video: { label: "\u89C6\u9891", color: "#d76a4d" },
  audio: { label: "\u97F3\u9891", color: "#ce5797" },
  spreadsheet: { label: "\u8868\u683C", color: "#399369" },
  document: { label: "\u6587\u6863", color: "#4c83cc" },
  code: { label: "\u4EE3\u7801", color: "#bd8431" },
  archive: { label: "\u538B\u7F29\u5305", color: "#9c7b60" },
  webpage: { label: "\u7F51\u9875", color: "#339a9f" },
  note: { label: "\u7B14\u8BB0", color: "#c19738" },
  other: { label: "\u5176\u4ED6", color: "#7b8595" }
};
var groups = {
  image: "png jpg jpeg jpe gif webp avif apng bmp ico svg tif tiff heic heif",
  video: "mp4 m4v webm ogv mov mkv avi mpg mpeg 3gp m2ts",
  audio: "mp3 m4a aac wav wave flac ogg oga opus weba aif aiff wma mid midi",
  spreadsheet: "xls xlsx xlsm ods csv tsv numbers",
  document: "pdf doc docx odt rtf txt md markdown pages ppt pptx odp key",
  code: "js mjs cjs jsx ts tsx vue svelte py rb go rs java kt c h cc cpp hpp cs swift dart sh bash zsh fish ps1 sql graphql proto json jsonc yaml yml toml xml html htm css scss less ini cfg conf env",
  archive: "zip rar 7z tar gz bz2 xz tgz"
};
var extensions = new Map(Object.entries(groups).flatMap(([type, list]) => list.split(" ").map((ext) => [ext, type])));
function fileType(entry) {
  if (entry?.dir || entry?.kind === "dir") return "folder";
  const path = String(entry?.path || entry?.name || ""), name = path.split("/").at(-1), ext = name.includes(".") ? name.split(".").at(-1).toLowerCase() : "";
  return extensions.get(ext) || (["image", "video", "audio"].includes(entry?.kind) ? entry.kind : "other");
}
var categories = { image: "image", picture: "image", "image-prompt": "image", "\u56FE\u7247": "image", video: "video", "\u89C6\u9891": "video", audio: "audio", "\u97F3\u9891": "audio", spreadsheet: "spreadsheet", "\u8868\u683C": "spreadsheet", document: "document", article: "document", "\u6587\u6863": "document", text: "document", "\u6587\u672C": "document", code: "code", "\u4EE3\u7801": "code", webpage: "webpage", "\u7F51\u9875": "webpage", note: "note", idea: "note", "\u7B14\u8BB0": "note", archive: "archive", "\u538B\u7F29\u5305": "archive" };
function knowledgeType(entry) {
  if (entry?.directory) return "folder";
  if (entry?.assetId?.startsWith("file:")) return fileType({ path: entry.assetId.slice(5) });
  const explicit = categories[String(entry?.category || "").toLowerCase()];
  if (explicit) return explicit;
  if (entry?.sourceUrl) {
    try {
      const u = new URL(entry.sourceUrl);
      const kind = fileType({ path: u.pathname });
      return kind === "other" ? "webpage" : kind;
    } catch {
    }
  }
  if (entry?.assetId) return "other";
  return "note";
}

// client/type-visual.jsx
var import_react = __toESM(require("react"), 1);
var import_jsx_runtime = require("react/jsx-runtime");
function TypeIcon({ entry, type, size = 64 }) {
  const kind = type || fileType(entry), meta = FILE_TYPES[kind] || FILE_TYPES.other;
  const glyph = { image: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "37", cy: "28", r: "4" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m17 45 10-12 7 8 5-5 8 10" })
  ] }), video: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m26 26 15 10-15 10z" }), audio: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M29 43V25l14-3v18M29 29l14-3" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ellipse", { cx: "25", cy: "44", rx: "4", ry: "3" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ellipse", { cx: "39", cy: "41", rx: "4", ry: "3" })
  ] }), spreadsheet: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "18", y: "25", width: "28", height: "23", rx: "2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M18 33h28M18 40h28M27 25v23M37 25v23" })
  ] }), code: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m24 29-7 8 7 8m16-16 7 8-7 8M35 27l-6 20" }) }), archive: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M31 15v25", strokeDasharray: "3 2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "28", y: "40", width: "7", height: "9", rx: "2" })
  ] }), webpage: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "32", cy: "36", r: "13" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ellipse", { cx: "32", cy: "36", rx: "6", ry: "13" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M19 36h26M22 29h20M22 43h20" })
  ] }) }[kind] || /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M20 28h23M20 35h23M20 42h17" }) });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { className: "dfm-type-icon", width: size, height: size, viewBox: "0 0 64 64", "aria-hidden": "true", style: { flex: "none", color: meta.color }, children: kind === "folder" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5 18a5 5 0 0 1 5-5h16l6 6h22a5 5 0 0 1 5 5v27H5z", fill: "currentColor", opacity: ".7" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5 26h54l-4 25a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z", fill: "currentColor" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M9 29h45", stroke: "white", strokeOpacity: ".35", strokeWidth: "2" })
  ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M15 5h24l12 12v38a4 4 0 0 1-4 4H15a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z", fill: "currentColor", opacity: ".16" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M15 5h24l12 12v38a4 4 0 0 1-4 4H15a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z", fill: "none", stroke: "currentColor", strokeWidth: "1.5" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M39 5v9a3 3 0 0 0 3 3h9", fill: "currentColor", opacity: ".3" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("g", { stroke: "currentColor", fill: "none", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round", children: glyph })
  ] }) });
}
function TypeBadge({ type }) {
  const meta = FILE_TYPES[type] || FILE_TYPES.other;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dfm-type-badge", style: { "--type-color": meta.color }, children: meta.label });
}
function KnowledgeArtwork({ item, compact = false }) {
  const ref = (0, import_react.useRef)(null), [visible, setVisible] = (0, import_react.useState)(false), [failed, setFailed] = (0, import_react.useState)(false);
  const path = item.assetId?.startsWith("file:") ? item.assetId.slice(5) : null;
  const image = path && ["image", "video"].includes(item.type);
  (0, import_react.useEffect)(() => {
    setFailed(false);
    const observer = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "100px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [path, item.updatedAt]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { ref, className: compact ? "dfm-kb-mini" : "dfm-kb-art", title: failed ? "\u9884\u89C8\u6682\u4E0D\u53EF\u7528" : void 0, children: image && visible && !failed ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { alt: "", loading: "lazy", decoding: "async", src: "/dsh-fileman/thumbnail?path=" + encodeURIComponent(path) + "&v=" + encodeURIComponent(item.updatedAt || ""), onError: () => setFailed(true) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TypeIcon, { type: item.type || "note", size: compact ? 24 : 80 }) });
}

// client/windowed.js
var import_react2 = require("react");
function useWindowedEntries(items, view, resetKey) {
  const [node, setNode] = (0, import_react2.useState)(null), [box, setBox] = (0, import_react2.useState)({ width: 600, height: 600, top: 0 });
  (0, import_react2.useLayoutEffect)(() => {
    if (!node) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (node.clientWidth) setBox({ width: node.clientWidth, height: node.clientHeight, top: node.scrollTop });
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    node.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", measure);
      cancelAnimationFrame(frame);
    };
  }, [node]);
  (0, import_react2.useEffect)(() => {
    if (node) node.scrollTop = 0;
    setBox((b) => ({ ...b, top: 0 }));
  }, [resetKey, node]);
  return (0, import_react2.useMemo)(() => {
    const list = view === "list", gap = list ? 0 : view === "large" ? 12 : 6, padding = list ? 0 : 24;
    const columns = list ? 1 : Math.max(1, Math.floor((box.width - padding + gap) / ((view === "large" ? 172 : 120) + gap)));
    const row = list ? 30 : view === "large" ? 220 : 166;
    const rows = Math.ceil(items.length / columns), first = Math.min(Math.max(0, rows - Math.ceil(box.height / row)), Math.max(0, Math.floor(Math.max(0, box.top - (list ? 32 : 12)) / row) - 3)), last = Math.min(rows, first + Math.ceil(box.height / row) + 7);
    const start = Math.min(first * columns, items.length), end = Math.min(last * columns, items.length);
    return { ref: setNode, items: items.slice(start, end), top: first * row, bottom: Math.max(0, (rows - last) * row), columns, rowHeight: row - gap, gap };
  }, [items, view, box]);
}

// client/knowledge-rag-entry.jsx
var import_react4 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// client/knowledge-rag-model.js
var RAG_API = "/api/knowledge-rag";
var ROLES = ["embedding", "text", "ocr", "vision", "rerank"];
var ROLE_INFO = {
  embedding: { title: "\u8BED\u4E49\u5411\u91CF", hint: "\u4E3A\u6587\u6863\u5EFA\u7ACB\u4E0E\u67E5\u8BE2\u8BED\u4E49\u7D22\u5F15\u3002", protocol: "openai-embeddings" },
  text: { title: "\u6587\u672C\u5904\u7406", hint: "OpenAI chat/completions \u534F\u8BAE\uFF0C\u7528\u4E8E\u5904\u7406\u6587\u6863\u6587\u672C\u3002", protocol: "openai-chat" },
  ocr: { title: "OCR", hint: "\u53EF\u9009\u62E9\u4E13\u7528 OCR \u63A5\u53E3\uFF0C\u6216\u652F\u6301\u56FE\u50CF\u8F93\u5165\u7684\u89C6\u89C9\u8BC6\u5B57\u6A21\u578B\u3002", protocol: "openai-chat" },
  vision: { title: "\u56FE\u7247\u4E0E\u6F2B\u753B\u89C6\u89C9", hint: "OpenAI chat/completions \u534F\u8BAE\uFF0C\u6A21\u578B\u987B\u652F\u6301\u56FE\u50CF\u8F93\u5165\u3002", protocol: "openai-chat" },
  rerank: { title: "\u5019\u9009\u91CD\u6392", hint: "\u4F7F\u7528\u767E\u70BC DashScope\u3001Cohere v2 \u6216 VikingDB \u91CD\u6392\u5019\u9009\uFF1B\u767E\u70BC Qwen3-VL \u652F\u6301\u56FE\u6587\u3002", protocol: "cohere-v2" }
};
var reusable = (role) => ["text", "ocr", "vision"].includes(role);
var PROTOCOLS = { embedding: ["openai-embeddings", "ark-multimodal"], text: ["openai-chat"], ocr: ["openai-chat", "volc-visual-ocr"], vision: ["openai-chat"], rerank: ["cohere-v2", "vikingdb-rerank", "dashscope-rerank"] };
var REASONING = ["", "minimal", "low", "medium", "high"];
var text = (value) => typeof value === "string" ? value : "";
var copy = (value) => structuredClone(value);
var CREDENTIALS = ["apiKey", "accessKey", "secretKey"];
var CLEAR = { apiKey: "clearCredential", accessKey: "clearAccessKey", secretKey: "clearSecretKey" };
var ROUTE = ["protocol", "source", "provider", "endpoint"];
var sameRoute = (model, baseline) => !!baseline && ROUTE.every((field) => model[field] === baseline[field]);
var credentialsFor = (model) => model.source === "harness" ? [] : ["vikingdb-rerank", "volc-visual-ocr"].includes(model.protocol) ? ["accessKey", "secretKey"] : ["apiKey"];
var clearDraftKeys = (model) => {
  for (const field of CREDENTIALS) {
    model[field] = "";
    model[CLEAR[field]] = false;
  }
};
function publicProviderCatalog(data) {
  const protocols = (Array.isArray(data?.protocols) ? data.protocols : []).flatMap((protocol) => {
    if (typeof protocol.id !== "string") return [];
    const roles = (Array.isArray(protocol.roles) ? protocol.roles : []).filter((role) => ROLES.includes(role) && PROTOCOLS[role].includes(protocol.id));
    if (!roles.length) return [];
    return [{ id: protocol.id, roles, path: text(protocol.path), endpointKind: protocol.endpointKind === "origin" ? "origin" : "base-url", credentialFields: (Array.isArray(protocol.credentialFields) ? protocol.credentialFields : []).filter((field) => CREDENTIALS.includes(field)), dimensions: (Array.isArray(protocol.dimensions) ? protocol.dimensions : []).filter((value) => [1024, 2048].includes(value)), denseOnly: protocol.denseOnly === true, oneRequestPerChunk: protocol.oneRequestPerChunk === true, instructionModels: (Array.isArray(protocol.instructionModels) ? protocol.instructionModels : []).filter((value) => typeof value === "string"), regionRequired: protocol.regionRequired === true, signingService: text(protocol.signingService), models: (Array.isArray(protocol.models) ? protocol.models : []).filter((value) => typeof value === "string"), ocrMethod: text(protocol.ocrMethod) }];
  });
  const presets = (Array.isArray(data?.presets) ? data.presets : []).flatMap((preset) => {
    const config = preset?.config;
    if (typeof preset?.id !== "string" || !config || typeof config.protocol !== "string") return [];
    const roles = (Array.isArray(preset.roles) ? preset.roles : []).filter((role) => ROLES.includes(role) && PROTOCOLS[role].includes(config.protocol));
    if (!roles.length) return [];
    const projected = { source: config.source === "harness" ? "harness" : "independent", provider: text(config.provider), protocol: config.protocol, endpoint: text(config.endpoint), model: text(config.model) };
    for (const field of ["queryInstructions", "documentInstructions", "imageDocumentInstructions", "imageQueryInstructions", "multimodalQueryInstructions", "reasoningEffort", "region", "instruction"]) if (typeof config[field] === "string") projected[field] = config[field];
    if (config.dimensions !== void 0) projected.dimensions = String(config.dimensions);
    if (typeof config.imageEnabled === "boolean") projected.imageEnabled = config.imageEnabled;
    return [{ id: preset.id, label: text(preset.label) || preset.id, roles, ocrMethod: text(preset.ocrMethod), config: projected }];
  });
  return { version: Number.isInteger(data?.version) ? data.version : 0, protocols, presets };
}
var inferPreset = (role, model, catalog) => catalog.presets.find((preset) => preset.roles.includes(role) && Object.entries(preset.config).every(([field, value]) => String(model[field]) === String(value)))?.id || "custom";
function publicDocument(data, catalog = publicProviderCatalog(data?.providerCatalog)) {
  if (!data?.settings?.models) throw new Error("INVALID_RESPONSE");
  const settings = data.settings;
  return { enabled: settings.enabled === true, chunkSize: String(settings.chunkSize ?? 1200), overlap: String(settings.overlap ?? 160), models: Object.fromEntries(ROLES.map((role) => {
    const value = settings.models[role] || {}, defaults = catalog.presets.find((preset) => preset.roles.includes(role) && preset.config.protocol === value.protocol)?.config || {};
    const model = { enabled: value.enabled === true, source: reusable(role) && value.source === "harness" ? "harness" : "independent", protocol: value.protocol === void 0 ? ROLE_INFO[role].protocol : text(value.protocol), provider: text(value.provider), endpoint: text(value.endpoint), model: text(value.model), imageEnabled: value.imageEnabled === true, imageFieldsKnown: Object.hasOwn(value, "imageEnabled") || Object.hasOwn(defaults, "imageEnabled"), imageDocumentInstructions: text(value.imageDocumentInstructions ?? defaults.imageDocumentInstructions), imageQueryInstructions: text(value.imageQueryInstructions ?? defaults.imageQueryInstructions), multimodalQueryInstructions: text(value.multimodalQueryInstructions ?? defaults.multimodalQueryInstructions), dimensions: String(value.dimensions === void 0 ? 1024 : value.dimensions), queryInstructions: text(value.queryInstructions), documentInstructions: text(value.documentInstructions), reasoningEffort: text(value.reasoningEffort), region: value.region === void 0 ? text(defaults.region) || "cn-beijing" : text(value.region), instruction: text(value.instruction), credentialSet: value.credentialSet === true, accessKeySet: value.accessKeySet === true, secretKeySet: value.secretKeySet === true, apiKey: "", accessKey: "", secretKey: "", clearCredential: false, clearAccessKey: false, clearSecretKey: false };
    return [role, { ...model, preset: inferPreset(role, model, catalog) }];
  })) };
}
function publicCatalog(data) {
  return { providers: (Array.isArray(data?.providers) ? data.providers : []).filter((provider) => typeof provider.id === "string").map((provider) => ({ id: provider.id, name: text(provider.name) || provider.id, unavailable: provider.unavailable === true, models: (Array.isArray(provider.models) ? provider.models : []).filter((model) => typeof model.id === "string").map((model) => ({ id: model.id, name: text(model.name) || model.id, inputModalities: Array.isArray(model.inputModalities) ? model.inputModalities.filter((x) => x === "text" || x === "image") : [] })) })), unavailable: data?.unavailable === true };
}
function modelsFor(catalog, providerId, role) {
  const provider = catalog.providers.find((p) => p.id === providerId && !p.unavailable);
  return (provider?.models || []).filter((model) => !["ocr", "vision"].includes(role) || !model.inputModalities.length || model.inputModalities.includes("image"));
}
function validateDraft(draft, catalog) {
  const errors2 = {}, chunk = Number(draft.chunkSize), overlap = Number(draft.overlap);
  if (!/^\d+$/.test(draft.chunkSize) || !Number.isInteger(chunk) || chunk < 200 || chunk > 4e3) errors2.chunkSize = "\u8BF7\u8F93\u5165 200\u20134000 \u7684\u6574\u6570\u3002";
  if (!/^\d+$/.test(draft.overlap) || !Number.isInteger(overlap) || overlap < 0 || overlap >= chunk / 2) errors2.overlap = "\u8BF7\u8F93\u5165\u975E\u8D1F\u6574\u6570\uFF0C\u4E14\u5C0F\u4E8E\u5206\u5757\u5B57\u7B26\u6570\u7684\u4E00\u534A\u3002";
  for (const role of ROLES) {
    const value = draft.models[role], key = (field) => `${role}.${field}`;
    if (!PROTOCOLS[role].includes(value.protocol)) errors2[key("protocol")] = "\u5F53\u524D\u63A5\u53E3\u534F\u8BAE\u4E0D\u53D7\u652F\u6301\uFF0C\u8BF7\u9009\u62E9\u6B64\u89D2\u8272\u652F\u6301\u7684\u534F\u8BAE\u540E\u4FDD\u5B58\u3002";
    if (value.provider.length > 240) errors2[key("provider")] = "\u670D\u52A1\u5546\u6807\u8BC6\u6700\u591A 240 \u4E2A\u5B57\u7B26\u3002";
    if (value.model.length > 8192 || value.enabled && !value.model.trim()) errors2[key("model")] = "\u8BF7\u8F93\u5165\u6A21\u578B ID\u3002";
    if (role === "embedding" && value.protocol === "ark-multimodal") {
      if (!["1024", "2048"].includes(value.dimensions)) errors2[key("dimensions")] = "\u8BF7\u9009\u62E9 1024 \u6216 2048 \u7EF4\u3002";
      for (const field of ["queryInstructions", "documentInstructions", ...value.imageFieldsKnown || value.imageEnabled ? ["imageDocumentInstructions", "imageQueryInstructions", "multimodalQueryInstructions"] : []]) if (!value[field].trim() || value[field].length > 4e3) errors2[key(field)] = "\u8BF7\u8F93\u5165\u975E\u7A7A\u6307\u4EE4\uFF0C\u6700\u591A 4000 \u4E2A\u5B57\u7B26\u3002";
    }
    if (value.protocol === "volc-visual-ocr") {
      if (value.source !== "independent") errors2[key("source")] = "\u4E13\u7528 OCR \u53EA\u652F\u6301\u72EC\u7ACB\u63A5\u53E3\u4E0E AK/SK\u3002";
      if (value.region !== "cn-north-1") errors2[key("region")] = "\u6B64 OCR \u670D\u52A1\u8981\u6C42 cn-north-1\u3002";
      if (value.model !== "OCRNormal") errors2[key("model")] = "\u6B64 OCR \u63A5\u53E3\u64CD\u4F5C\u540D\u5FC5\u987B\u662F OCRNormal\u3002";
    }
    if (value.protocol === "openai-chat" && reusable(role) && !REASONING.includes(value.reasoningEffort)) errors2[key("reasoningEffort")] = "\u8BF7\u9009\u62E9\u652F\u6301\u7684\u63A8\u7406\u5F3A\u5EA6\u3002";
    if (value.protocol === "dashscope-rerank" && value.model && !["qwen3.7-text-rerank", "qwen3-rerank", "qwen3-vl-rerank", "gte-rerank-v2"].includes(value.model)) errors2[key("model")] = "\u8BF7\u9009\u62E9\u767E\u70BC\u652F\u6301\u7684\u91CD\u6392\u6A21\u578B\u3002";
    if (value.protocol === "vikingdb-rerank") {
      if (!/^[a-z0-9-]{1,40}$/.test(value.region)) errors2[key("region")] = "Region \u4E3A 1\u201340 \u4E2A\u5C0F\u5199\u5B57\u6BCD\u3001\u6570\u5B57\u6216\u8FDE\u5B57\u7B26\u3002";
      if (value.instruction.length > 1024) errors2[key("instruction")] = "\u91CD\u6392\u6307\u4EE4\u6700\u591A 1024 \u4E2A\u5B57\u7B26\u3002";
      if (value.model && !["doubao-seed-rerank", "base-multilingual-rerank"].includes(value.model)) errors2[key("model")] = "\u8BF7\u9009\u62E9 VikingDB \u652F\u6301\u7684\u91CD\u6392\u6A21\u578B\u3002";
      if (value.model === "base-multilingual-rerank" && value.instruction) errors2[key("instruction")] = "base-multilingual-rerank \u4E0D\u652F\u6301\u91CD\u6392\u6307\u4EE4\uFF0C\u8BF7\u6E05\u7A7A\u3002";
    }
    if (value.source === "harness") {
      if (value.enabled && !catalog.providers.some((p) => p.id === value.provider && !p.unavailable)) errors2[key("provider")] = "\u8BF7\u9009\u62E9\u53EF\u7528\u7684 Harness \u670D\u52A1\u5546\u3002";
      if (value.enabled && !modelsFor(catalog, value.provider, role).some((m) => m.id === value.model)) errors2[key("model")] = "\u8BF7\u9009\u62E9\u6B64\u670D\u52A1\u5546\u4E0B\u53EF\u7528\u7684\u6A21\u578B\u3002";
    } else {
      if (value.enabled && !value.endpoint) errors2[key("endpoint")] = "\u8BF7\u8F93\u5165 API \u57FA\u7840\u5730\u5740\u3002";
      if (value.endpoint) {
        try {
          const url = new URL(value.endpoint);
          if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || value.endpoint.length > 8192) throw new Error();
          if (["vikingdb-rerank", "volc-visual-ocr", "dashscope-rerank"].includes(value.protocol) && (url.pathname !== "/" || /[{}<>]/.test(value.endpoint))) errors2[key("endpoint")] = "\u6B64\u63A5\u53E3\u5730\u5740\u53EA\u80FD\u5305\u542B HTTPS origin\uFF0C\u4E0D\u5305\u542B\u8BF7\u6C42\u8DEF\u5F84\u3002";
        } catch {
          errors2[key("endpoint")] = "\u8BF7\u8F93\u5165\u4E0D\u542B\u7528\u6237\u540D\u3001\u5BC6\u7801\u3001\u67E5\u8BE2\u6216\u7247\u6BB5\u7684 HTTPS \u5730\u5740\u3002";
        }
      }
      for (const field of credentialsFor(value)) {
        const secret = value[field];
        if (secret && (!/^[\x21-\x7e]+$/.test(secret.trim()) || /^[A-Z][A-Z0-9_]*=[^=]/.test(secret.trim()) || /^(["'`]).*\1$/.test(secret.trim()) || secret.length > 8192)) errors2[key(field)] = "\u8BF7\u8F93\u5165\u51ED\u636E\u672C\u8EAB\uFF0C\u4E0D\u8981\u7C98\u8D34\u73AF\u5883\u53D8\u91CF\u8D4B\u503C\u3001\u5F15\u53F7\u6216\u7A7A\u767D\u3002";
      }
    }
  }
  return errors2;
}
function writeSettings(draft) {
  return { enabled: draft.enabled, chunkSize: Number(draft.chunkSize), overlap: Number(draft.overlap), models: Object.fromEntries(ROLES.map((role) => {
    const value = draft.models[role], out = { enabled: value.enabled, source: value.source, protocol: value.protocol, provider: value.provider.trim(), endpoint: value.endpoint.trim(), model: value.model.trim() };
    if (role === "embedding" && value.protocol === "ark-multimodal") {
      Object.assign(out, { dimensions: Number(value.dimensions), queryInstructions: value.queryInstructions, documentInstructions: value.documentInstructions, imageEnabled: value.imageEnabled });
      for (const field of ["imageDocumentInstructions", "imageQueryInstructions", "multimodalQueryInstructions"]) if (value.imageFieldsKnown || value.imageEnabled || value[field]) out[field] = value[field];
    }
    if (reusable(role) && value.protocol === "openai-chat") out.reasoningEffort = value.reasoningEffort;
    if (value.protocol === "vikingdb-rerank") Object.assign(out, { region: value.region, instruction: value.instruction });
    if (value.protocol === "volc-visual-ocr") out.region = value.region;
    for (const field of credentialsFor(value)) {
      if (value[CLEAR[field]]) out[field] = "";
      else if (value[field] !== "") out[field] = value[field].trim();
    }
    return [role, out];
  })) };
}
var signature = (draft) => draft ? JSON.stringify(writeSettings(draft)) : "";
var statusMessage = (status) => status === 401 ? "\u767B\u5F55\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u540E\u91CD\u8BD5\u3002" : status === 403 ? "\u5F53\u524D\u8D26\u53F7\u65E0\u6743\u8BBF\u95EE\u77E5\u8BC6\u5E93\u914D\u7F6E\u3002" : status === 404 ? "\u77E5\u8BC6\u5E93\u6838\u5FC3\u672A\u52A0\u8F7D\u3002" : "\u77E5\u8BC6\u5E93\u6838\u5FC3\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u8BD5\u3002";
var safeCodes = { DASHSCOPE_ENDPOINT_ORIGIN_REQUIRED: "\u767E\u70BC\u5730\u5740\u53EA\u80FD\u586B\u5199\u5B9E\u9645\u4E1A\u52A1\u7A7A\u95F4 HTTPS origin\uFF0C\u8BF7\u52FF\u5305\u542B API \u8DEF\u5F84\u6216\u5360\u4F4D\u7B26\u3002", UNSUPPORTED_DASHSCOPE_RERANK_MODEL: "\u8BF7\u9009\u62E9\u767E\u70BC\u652F\u6301\u7684\u91CD\u6392\u6A21\u578B\u3002", INVALID_CHUNK_SETTINGS: "\u5206\u5757\u8BBE\u7F6E\u4E0D\u7B26\u5408\u8981\u6C42\u3002", HTTPS_ENDPOINT_REQUIRED: "API \u5730\u5740\u5FC5\u987B\u662F\u6709\u6548\u7684 HTTPS \u57FA\u7840\u5730\u5740\u3002", INVALID_PROVIDER: "\u670D\u52A1\u5546\u6807\u8BC6\u4E0D\u7B26\u5408\u8981\u6C42\u3002", UNSUPPORTED_MODEL_SOURCE: "\u6B64\u89D2\u8272\u4E0D\u652F\u6301\u6240\u9009\u914D\u7F6E\u6765\u6E90\u3002", INVALID_EMBEDDING_DIMENSIONS: "\u5411\u91CF\u7EF4\u5EA6\u4E0D\u7B26\u5408\u8981\u6C42\u3002", INVALID_EMBEDDING_INSTRUCTIONS: "\u5411\u91CF\u6307\u4EE4\u5FC5\u987B\u975E\u7A7A\uFF0C\u4E14\u4E0D\u8D85\u8FC7 4000 \u5B57\u7B26\u3002", INVALID_VISUAL_OCR_SETTING: "\u4E13\u7528 OCR \u5FC5\u987B\u4F7F\u7528\u72EC\u7ACB AK/SK\u3001cn-north-1 \u4E0E OCRNormal HTTPS origin\u3002", INVALID_REASONING_EFFORT: "\u63A8\u7406\u5F3A\u5EA6\u4E0D\u7B26\u5408\u8981\u6C42\u3002", INVALID_VIKING_SETTING: "VikingDB region \u6216\u91CD\u6392\u6307\u4EE4\u4E0D\u7B26\u5408\u8981\u6C42\u3002", VIKING_ENDPOINT_ORIGIN_REQUIRED: "VikingDB \u5730\u5740\u5FC5\u987B\u662F HTTPS origin\u3002", UNSUPPORTED_VIKING_MODEL: "VikingDB \u91CD\u6392\u6A21\u578B\u4E0D\u53D7\u652F\u6301\u3002", RERANK_INSTRUCTION_UNSUPPORTED_MODEL: "\u6B64\u91CD\u6392\u6A21\u578B\u4E0D\u652F\u6301\u6307\u4EE4\u3002" };
var RagSettingsController = class {
  constructor(fetchImpl = (...args) => fetch(...args)) {
    this.fetch = fetchImpl;
    this.listeners = /* @__PURE__ */ new Set();
    this.epoch = 0;
    this.disposed = false;
    this.abort = null;
    this.baseline = null;
    this.state = { phase: "loading", draft: null, catalog: { providers: [] }, providerCatalog: { version: 0, protocols: [], presets: [] }, error: "", saved: false, saving: false, failed: false };
  }
  activate = () => {
    this.disposed = false;
  };
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => {
    const errors2 = this.state.draft ? validateDraft(this.state.draft, this.state.catalog) : {};
    return { ...this.state, errors: errors2, shell: { available: !!this.state.draft, writable: this.state.phase === "ready", dirty: !!this.state.draft && signature(this.state.draft) !== signature(this.baseline), invalid: !!Object.keys(errors2).length || this.state.phase !== "ready", saving: this.state.saving, failed: this.state.failed } };
  };
  publish() {
    if (!this.disposed) for (const listener of this.listeners) listener(this.snapshot());
  }
  live(epoch) {
    return !this.disposed && epoch === this.epoch;
  }
  begin() {
    this.abort?.abort();
    this.abort = new AbortController();
    return ++this.epoch;
  }
  async request(action, epoch) {
    const response = await this.fetch(action ? `${RAG_API}/action` : RAG_API, { method: action ? "POST" : "GET", cache: "no-store", credentials: "same-origin", signal: this.abort.signal, ...action ? { headers: { "content-type": "application/json" }, body: JSON.stringify(action) } : {} });
    if (!this.live(epoch)) return null;
    if (!(response.headers.get("content-type") || "").includes("json")) throw { status: response.status };
    const data = await response.json();
    if (!this.live(epoch)) return null;
    if (!response.ok) throw { status: response.status, code: Object.hasOwn(safeCodes, data?.error) ? data.error : "" };
    return data;
  }
  accept(data) {
    const providerCatalog = publicProviderCatalog(data.providerCatalog);
    this.baseline = publicDocument(data, providerCatalog);
    this.state = { ...this.state, draft: copy(this.baseline), catalog: publicCatalog(data.modelCatalog), providerCatalog, phase: "ready", error: "", failed: false };
  }
  load = async () => {
    if (this.disposed || this.state.saving) return;
    const epoch = this.begin();
    this.state = { ...this.state, phase: "loading", error: "", saved: false };
    this.publish();
    try {
      const data = await this.request(null, epoch);
      if (!this.live(epoch)) return;
      this.accept(data);
    } catch (error) {
      if (!this.live(epoch)) return;
      this.baseline = null;
      this.state = { ...this.state, phase: "error", draft: null, error: statusMessage(error?.status) };
    }
    if (this.live(epoch)) this.publish();
  };
  edit = (role, field, value) => {
    if (!this.state.draft || this.state.saving || this.state.phase !== "ready") return;
    const draft = copy(this.state.draft);
    if (role) {
      const model = draft.models[role], oldRoute = ROUTE.map((key) => model[key]);
      model[field] = value;
      if (field === "protocol" && value === "volc-visual-ocr") model.source = "independent";
      if (["imageEnabled", "imageDocumentInstructions", "imageQueryInstructions", "multimodalQueryInstructions"].includes(field)) model.imageFieldsKnown = true;
      if (ROUTE.some((key, index) => model[key] !== oldRoute[index])) {
        clearDraftKeys(model);
        model.preset = "custom";
      }
      if (field === "provider" && model.source === "harness") model.model = "";
      if (field === "model" && model.protocol === "vikingdb-rerank" && value === "base-multilingual-rerank") model.instruction = "";
      for (const secret of CREDENTIALS) {
        if (field === CLEAR[secret] && value) model[secret] = "";
        if (field === secret && value) model[CLEAR[secret]] = false;
      }
    } else draft[field] = value;
    this.state = { ...this.state, draft, error: "", saved: false, failed: false };
    this.publish();
  };
  preset = (role, id) => {
    if (!this.state.draft || this.state.saving || this.state.phase !== "ready" || !ROLES.includes(role)) return;
    const preset = this.state.providerCatalog.presets.find((value) => value.id === id && value.roles.includes(role));
    if (id !== "custom" && !preset) return;
    const draft = copy(this.state.draft), model = draft.models[role];
    clearDraftKeys(model);
    if (preset) {
      Object.assign(model, { reasoningEffort: "", dimensions: "1024", queryInstructions: "", documentInstructions: "", imageEnabled: false, imageFieldsKnown: Object.hasOwn(preset.config, "imageEnabled"), imageDocumentInstructions: "", imageQueryInstructions: "", multimodalQueryInstructions: "", region: "cn-beijing", instruction: "" });
      for (const [field, value] of Object.entries(preset.config)) model[field] = value;
    }
    model.preset = id;
    this.state = { ...this.state, draft, error: "", saved: false, failed: false };
    this.publish();
  };
  reset = (role, field) => {
    if (this.baseline) this.edit(role, field, role ? this.baseline.models[role][field] : this.baseline[field]);
  };
  discard = () => {
    if (this.disposed) return;
    this.begin();
    this.state = { ...this.state, draft: this.baseline ? copy(this.baseline) : null, saving: false, phase: this.baseline ? "ready" : this.state.phase, error: this.baseline ? "" : this.state.error, saved: false, failed: this.baseline ? false : this.state.failed };
    this.publish();
  };
  save = async () => {
    const shell = this.snapshot().shell;
    if (this.disposed || !shell.dirty || shell.invalid || shell.saving) return;
    const epoch = this.begin();
    this.state = { ...this.state, saving: true, failed: false, error: "", saved: false };
    this.publish();
    let accepted = false;
    try {
      await this.request({ action: "settings", settings: writeSettings(this.state.draft) }, epoch);
      if (!this.live(epoch)) return;
      accepted = true;
      for (const role of ROLES) clearDraftKeys(this.state.draft.models[role]);
      this.publish();
      const data = await this.request(null, epoch);
      if (!this.live(epoch)) return;
      this.accept(data);
      this.state.saved = true;
    } catch (error) {
      if (!this.live(epoch)) return;
      const revoked = [401, 403, 404].includes(error?.status);
      if (accepted || revoked) {
        this.baseline = null;
        this.state.draft = null;
      }
      this.state = { ...this.state, phase: accepted || revoked ? "error" : "ready", failed: true, error: accepted ? "\u8BBE\u7F6E\u5DF2\u63D0\u4EA4\uFF0C\u8BFB\u53D6\u786E\u8BA4\u5931\u8D25\u3002\u8BF7\u91CD\u8BD5\u8BFB\u53D6\u8BBE\u7F6E\u3002" : safeCodes[error?.code] || statusMessage(error?.status) };
    } finally {
      if (this.live(epoch)) {
        this.state.saving = false;
        this.publish();
      }
    }
  };
  dispose = () => {
    this.disposed = true;
    this.epoch++;
    this.abort?.abort();
    this.baseline = null;
    this.state = { ...this.state, draft: null, saving: false, phase: "loading", error: "", saved: false, failed: false };
    this.listeners.clear();
  };
};

// client/knowledge-rag-operations.jsx
var import_react3 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// client/knowledge-rag-operations-model.js
var text2 = (value) => typeof value === "string" ? value : "";
var count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
var revision = (value) => typeof value === "string" || Number.isSafeInteger(value) ? value : null;
var errors = { RERANK_IMAGE_CONSENT_REQUIRED: "\u5DF2\u8DF3\u8FC7\u56FE\u6587\u91CD\u6392\uFF1A\u9700\u8981\u672C\u6B21\u5019\u9009\u56FE\u7247\u5916\u53D1\u6388\u6743\u3002", RERANK_IMAGE_UNSUPPORTED: "\u5F53\u524D\u91CD\u6392\u6A21\u578B\u4E0D\u652F\u6301\u56FE\u7247\uFF0C\u672C\u6B21\u4FDD\u7559\u539F\u68C0\u7D22\u6392\u5E8F\u3002", RERANK_IMAGE_BUDGET_EXCEEDED: "\u56FE\u6587\u91CD\u6392\u8D85\u8FC7 3 \u5F20\u5019\u9009\u56FE\u7247\u6216 20 MB \u603B\u9884\u7B97\uFF0C\u5DF2\u4FDD\u7559\u539F\u6392\u5E8F\u3002", RERANK_IMAGE_UNAVAILABLE: "\u65E0\u6CD5\u52A0\u8F7D\u5DF2\u7D22\u5F15\u5019\u9009\u56FE\u7247\uFF0C\u5DF2\u4FDD\u7559\u539F\u6392\u5E8F\u3002", RERANK_IMAGE_CHANGED: "\u5019\u9009\u56FE\u7247\u4E0E\u7D22\u5F15\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u91CD\u65B0\u7D22\u5F15\uFF1B\u672C\u6B21\u672A\u5916\u53D1\u56FE\u7247\u3002", DASHSCOPE_CREDENTIAL_NOT_CONFIGURED: "\u8BF7\u5728\u5019\u9009\u91CD\u6392\u4E2D\u4FDD\u5B58\u767E\u70BC API Key\u3002", DASHSCOPE_RERANK_FAILED: "\u767E\u70BC\u672A\u6210\u529F\u91CD\u6392\uFF0C\u8BF7\u6838\u5BF9\u6A21\u578B\u5F00\u901A\u72B6\u6001\u3001\u5730\u57DF\u548C\u51ED\u636E\u3002", RERANK_NOT_CONFIGURED: "\u8BF7\u5148\u4FDD\u5B58\u5E76\u542F\u7528\u5019\u9009\u91CD\u6392\u3002", INVALID_RERANK_RESPONSE: "\u91CD\u6392\u670D\u52A1\u8FD4\u56DE\u7684\u8BC4\u5206\u6216\u7D22\u5F15\u4E0D\u5B8C\u6574\u3002", RERANK_INPUT_TOO_LARGE: "\u91CD\u6392\u8F93\u5165\u8D85\u8FC7\u4FDD\u5B88\u5B89\u5168\u9884\u7B97\uFF0C\u8BF7\u7F29\u5C0F\u67E5\u8BE2\u3001\u5206\u5757\u6216\u5019\u9009\u6570\u91CF\uFF1B\u68C0\u7D22\u4FDD\u7559\u539F\u6392\u5E8F\u3002", RERANK_BATCH_TOO_LARGE: "\u5019\u9009\u6570\u91CF\u8D85\u8FC7\u8BE5\u91CD\u6392\u6A21\u578B\u9650\u5236\u3002", RERANK_FAILED_HYBRID_FALLBACK: "\u672C\u6B21\u91CD\u6392\u5931\u8D25\uFF0C\u7ED3\u679C\u4F7F\u7528\u539F\u68C0\u7D22\u6392\u5E8F\u3002", VIKING_CREDENTIAL_NOT_CONFIGURED: "\u8BF7\u914D\u7F6E\u91CD\u6392 AK/SK\u3002", EMBEDDING_INDEX_REQUIRED: "\u90E8\u5206\u8D44\u6599\u5C1A\u65E0\u5F53\u524D\u914D\u7F6E\u7684\u5411\u91CF\u7D22\u5F15\u3002\u8BF7\u9009\u4E2D\u8D44\u6599\u5E76\u6388\u6743\u8FDC\u7A0B\u5904\u7406\u540E\u91CD\u5EFA\uFF1B\u4FDD\u5B58\u6A21\u578B\u914D\u7F6E\u4E0D\u4F1A\u81EA\u52A8\u53D1\u9001\u8D44\u6599\u3002", EMBEDDING_REBUILD_REQUIRED: "\u5411\u91CF\u914D\u7F6E\u5DF2\u6539\u53D8\uFF0C\u8BF7\u91CD\u65B0\u5EFA\u7ACB\u6240\u9009\u8D44\u6599\u7684\u5411\u91CF\u7D22\u5F15\u3002", SEMANTIC_FAILED_KEYWORD_FALLBACK: "\u67E5\u8BE2\u5411\u91CF\u751F\u6210\u5931\u8D25\uFF0C\u672C\u6B21\u4EC5\u4F7F\u7528\u5173\u952E\u8BCD\u68C0\u7D22\u3002", EMBEDDING_NOT_CONFIGURED: "\u8BF7\u5148\u4FDD\u5B58\u5E76\u542F\u7528\u5411\u91CF\u6A21\u578B\u3002", PROVIDER_HTTP_401: "\u6A21\u578B\u670D\u52A1\u62D2\u7EDD\u51ED\u636E\uFF08401\uFF09\uFF0C\u8BF7\u68C0\u67E5 API Key\u3002", PROVIDER_HTTP_403: "\u6A21\u578B\u670D\u52A1\u62D2\u7EDD\u8BBF\u95EE\uFF08403\uFF09\uFF0C\u8BF7\u68C0\u67E5\u6A21\u578B\u5F00\u901A\u72B6\u6001\u548C\u6743\u9650\u3002", PROVIDER_HTTP_404: "\u63A5\u53E3\u6216\u6A21\u578B\u4E0D\u5B58\u5728\uFF08404\uFF09\uFF0C\u8BF7\u68C0\u67E5\u5730\u5740\u548C\u6A21\u578B ID\u3002", PROVIDER_HTTP_429: "\u6A21\u578B\u670D\u52A1\u9650\u6D41\u6216\u989D\u5EA6\u4E0D\u8DB3\uFF08429\uFF09\uFF0C\u8BF7\u68C0\u67E5\u914D\u989D\u3002", PROVIDER_NETWORK_FAILED: "\u65E0\u6CD5\u8FDE\u63A5\u6A21\u578B\u670D\u52A1\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", INVALID_EMBEDDING_RESPONSE: "\u5411\u91CF\u8FD4\u56DE\u683C\u5F0F\u6216\u7EF4\u5EA6\u4E0D\u7B26\u5408\u914D\u7F6E\u3002", SOURCE_REVISION_REQUIRED: "\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u9009\u62E9\u8D44\u6599\u7248\u672C\u4E0E\u6388\u6743\u3002", IMAGE_INDEX_REQUIRED: "\u5C1A\u65E0\u53EF\u7528\u56FE\u7247\u5411\u91CF\u7D22\u5F15\uFF0C\u8BF7\u5148\u660E\u786E\u9009\u62E9\u9875\u8303\u56F4\u5EFA\u7ACB\u7D22\u5F15\u3002", REMOTE_PROCESSING_REQUIRES_CONSENT: "\u6B64\u5904\u7406\u9700\u8981\u672C\u6B21\u660E\u786E\u5916\u53D1\u6388\u6743\u3002", REMOTE_PROCESSING_DISABLED: "\u8FDC\u7A0B\u5904\u7406\u5DF2\u5173\u95ED\uFF0C\u8BF7\u68C0\u67E5\u5DF2\u4FDD\u5B58\u8BBE\u7F6E\u3002", ARK_CREDENTIAL_NOT_CONFIGURED: "\u5F53\u524D\u5411\u91CF\u8DEF\u7531\u5C1A\u672A\u914D\u7F6E\u51ED\u636E\u3002", INVALID_OCR_RESPONSE: "OCR \u670D\u52A1\u672A\u8FD4\u56DE\u6709\u6548\u6587\u5B57\u3002", SOURCE_TOO_LARGE: "\u6E90\u6587\u4EF6\u8D85\u8FC7\u5904\u7406\u9884\u7B97\u3002", SOURCE_TEXT_TOO_LARGE: "\u6240\u9009\u6587\u5B57\u8D85\u8FC7\u5904\u7406\u9884\u7B97\uFF0C\u8BF7\u7F29\u5C0F\u8303\u56F4\u3002", UNSUPPORTED_FORMAT: "\u5F53\u524D\u5904\u7406\u4E0D\u652F\u6301\u6B64\u6587\u4EF6\u683C\u5F0F\u3002", DOCUMENT_TOO_LARGE: "\u6587\u6863\u8D85\u8FC7\u5904\u7406\u9884\u7B97\u3002", AUTHORIZATION_CHANGED: "\u8BBF\u95EE\u6743\u9650\u6216\u5904\u7406\u914D\u7F6E\u5DF2\u6539\u53D8\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u9009\u62E9\u5E76\u6388\u6743\u3002", REVISION_CHANGED: "\u6761\u76EE\u5DF2\u4FEE\u6539\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002", SOURCE_REVISION_CHANGED: "\u8D44\u6599\u7248\u672C\u5DF2\u6539\u53D8\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u9009\u62E9\u8D44\u6599\u4E0E\u6388\u6743\u3002", SOURCE_CHANGED: "\u6E90\u6587\u4EF6\u5DF2\u6539\u53D8\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u9009\u62E9\u3002", INDEX_SOURCE_CHANGED: "\u7D22\u5F15\u671F\u95F4\u6E90\u6216\u914D\u7F6E\u5DF2\u6539\u53D8\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002", AMBIGUOUS_SCOPE: "\u9879\u76EE\u5F52\u5C5E\u4E0E\u5168\u90E8\u9879\u76EE\u5171\u4EAB\u4E0D\u80FD\u540C\u65F6\u8BBE\u7F6E\u3002", INVALID_PROJECT_SCOPE: "\u9879\u76EE\u8DEF\u5F84\u4E0D\u7B26\u5408\u8981\u6C42\u3002", INVALID_QUERY: "\u67E5\u8BE2\u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u4E14\u6700\u591A 1000 \u4E2A\u5B57\u7B26\u3002", KNOWLEDGE_NOT_ACCESSIBLE: "\u6240\u9009\u8D44\u6599\u4E0D\u53EF\u8BBF\u95EE\u6216\u4E0D\u542B\u53EF\u8BFB\u53D6\u7684\u6E90\u6587\u4EF6\u3002", PROCESSING_UNAVAILABLE: "\u672C\u673A\u7F3A\u5C11\u5904\u7406\u6B64\u6587\u4EF6\u6240\u9700\u7684\u80FD\u529B\u3002", IMAGE_PAGE_SELECTION_REQUIRED: "\u8BF7\u9009\u62E9 1\u20133 \u4E2A\u4E0D\u540C\u9875\u7801\uFF0C\u9875\u7801\u4E3A 1\u2013500 \u7684\u6574\u6570\u3002", SELECTED_IMAGE_CONSENT_REQUIRED: "\u56FE\u7247\u7D22\u5F15\u9700\u8981\u6240\u9009\u9875\u8303\u56F4\u53CA\u672C\u6B21\u5916\u53D1\u6388\u6743\u3002", QUERY_IMAGE_CONSENT_REQUIRED: "\u56FE\u7247\u67E5\u8BE2\u9700\u8981\u6240\u9009\u67E5\u8BE2\u56FE\u7247\u4E0E\u672C\u6B21\u5916\u53D1\u6388\u6743\u3002", IMAGE_PAGES_UNAVAILABLE: "\u6240\u9009\u9875\u65E0\u6CD5\u63D0\u4F9B\u5B8C\u6574\u56FE\u7247\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u3002", IMAGE_BUDGET_EXCEEDED: "\u6240\u9009\u56FE\u7247\u603B\u91CF\u8D85\u8FC7\u5904\u7406\u9884\u7B97\uFF0C\u8BF7\u7F29\u5C0F\u8303\u56F4\u3002", INVALID_IMAGE_EMBEDDING_INPUT: "\u56FE\u7247\u683C\u5F0F\u3001\u5C3A\u5BF8\u6216\u5927\u5C0F\u4E0D\u7B26\u5408\u5411\u91CF\u670D\u52A1\u9650\u5236\u3002", IMAGE_INDEX_REQUIRES_REMOTE_CONFIGURATION: "\u8BF7\u5148\u4FDD\u5B58\u5E76\u542F\u7528\u8FDC\u7A0B\u5904\u7406\u3001\u5411\u91CF\u89D2\u8272\u53CA\u76F4\u63A5\u56FE\u7247\u5411\u91CF\u80FD\u529B\u3002", IMAGE_QUERY_REQUIRES_REMOTE_CONFIGURATION: "\u8BF7\u5148\u4FDD\u5B58\u5E76\u542F\u7528\u8FDC\u7A0B\u5904\u7406\u53CA\u76F4\u63A5\u56FE\u7247\u5411\u91CF\u80FD\u529B\u3002", IMAGE_EMBEDDING_NOT_CONFIGURED: "\u56FE\u7247\u5411\u91CF\u80FD\u529B\u5C1A\u672A\u914D\u7F6E\u3002", INVALID_QUERY_IMAGE_REFERENCE: "\u8BF7\u9009\u62E9\u77E5\u8BC6\u5E93\u5185\u7684\u53EF\u4FE1\u6765\u6E90\u4E0E\u6709\u6548\u9875\u7801\uFF0C\u4E0D\u80FD\u4F7F\u7528 URL \u6216\u8DEF\u5F84\u3002", OCR_CONFIGURED_REQUIRES_REMOTE: "\u4F7F\u7528\u5DF2\u914D\u7F6E OCR \u5FC5\u987B\u786E\u8BA4\u672C\u6B21\u5916\u53D1\u3002", OCR_NOT_CONFIGURED: "OCR \u89D2\u8272\u5C1A\u672A\u542F\u7528\u6216\u914D\u7F6E\u3002", VISUAL_OCR_CREDENTIAL_NOT_CONFIGURED: "\u4E13\u7528 OCR \u5F53\u524D\u8DEF\u7531\u5C1A\u672A\u914D\u7F6E AK/SK\u3002", OCR_INPUT_TOO_LARGE: "\u4E13\u7528 OCR \u7F16\u7801\u540E\u8BF7\u6C42\u8D85\u51FA\u9884\u7B97\uFF0C\u8BF7\u7F29\u5C0F\u6240\u9009\u8303\u56F4\u3002", VISUAL_OCR_FAILED: "\u4E13\u7528 OCR \u8BF7\u6C42\u672A\u6210\u529F\uFF0C\u8BF7\u68C0\u67E5\u670D\u52A1\u914D\u7F6E\u3002", INVALID_OCR_ENGINE: "\u8BF7\u9009\u62E9\u652F\u6301\u7684 OCR \u5F15\u64CE\u3002", SOURCE_CHANGED_REINDEX_REQUIRED: "\u6E90\u6587\u4EF6\u5DF2\u4FEE\u6539\uFF0C\u8BF7\u91CD\u65B0\u7D22\u5F15\u3002" };
var failure = (status) => status === 401 ? "\u767B\u5F55\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002" : status === 403 ? "\u5F53\u524D\u8D26\u53F7\u65E0\u6743\u6267\u884C\u6B64\u64CD\u4F5C\u3002" : status === 404 ? "\u77E5\u8BC6\u5E93\u6838\u5FC3\u672A\u52A0\u8F7D\u3002" : "\u64CD\u4F5C\u672A\u5B8C\u6210\uFF0C\u8BF7\u91CD\u8BD5\u3002";
function parsePages(value) {
  const parts = typeof value === "string" ? value.split(/[，,\s]+/).filter(Boolean) : [];
  if (!parts.length || parts.length > 3 || parts.some((value2) => !/^\d+$/.test(value2))) return null;
  const pages = parts.map(Number);
  return new Set(pages).size === pages.length && pages.every((value2) => Number.isSafeInteger(value2) && value2 >= 1 && value2 <= 500) ? pages : null;
}
var validPages = (pages) => Array.isArray(pages) && pages.length > 0 && pages.length <= 3 && new Set(pages).size === pages.length && pages.every((value) => Number.isSafeInteger(value) && value >= 1 && value <= 500);
function citation(value) {
  if (!value || typeof value !== "object") return null;
  const location = value.location && typeof value.location === "object" ? value.location : {};
  return { entryId: text2(value.entryId), adapter: text2(value.adapter), sourceId: text2(value.sourceId), partId: text2(value.partId), revision: revision(value.revision), chunkId: text2(value.chunkId), imageHash: text2(value.imageHash), sourceFingerprint: text2(value.sourceFingerprint), location: { pageNumber: Number.isSafeInteger(location.pageNumber) ? location.pageNumber : null, section: text2(location.section), blockId: text2(location.blockId), chunkIndex: Number.isSafeInteger(location.chunkIndex) ? location.chunkIndex : null } };
}
var RagOperationsController = class {
  constructor(fetchImpl = (...args) => fetch(...args)) {
    this.fetch = fetchImpl;
    this.listeners = /* @__PURE__ */ new Set();
    this.epoch = 0;
    this.disposed = false;
    this.abort = null;
    this.state = { busy: false, loading: true, error: "", message: "", records: [], capabilities: [], results: [], warnings: [], remote: { enabled: false, imageReady: false, ocrReady: false, ocrProtocol: "" } };
  }
  activate = () => {
    this.disposed = false;
  };
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.state;
  publish() {
    if (!this.disposed) for (const listener of this.listeners) listener(this.state);
  }
  live(epoch) {
    return !this.disposed && epoch === this.epoch;
  }
  invalidate = () => {
    if (this.disposed) return;
    this.epoch++;
    this.abort?.abort();
    this.state = { ...this.state, busy: false, error: "", message: "", results: [], warnings: [] };
    this.publish();
  };
  reject(message) {
    if (!this.disposed && !this.state.busy) {
      this.state = { ...this.state, error: message, message: "", results: [], warnings: [] };
      this.publish();
    }
    return Promise.resolve();
  }
  async request(body, epoch) {
    const response = await this.fetch(body ? `${RAG_API}/action` : RAG_API, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: this.abort.signal, ...body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {} });
    if (!this.live(epoch)) return null;
    if (!(response.headers.get("content-type") || "").includes("json")) throw { status: response.status };
    const data = await response.json();
    if (!this.live(epoch)) return null;
    if (!response.ok) throw { status: response.status, code: Object.hasOwn(errors, data?.error) ? data.error : "" };
    return data;
  }
  accept(data) {
    const settings = data?.settings || {}, embedding = settings.models?.embedding || {}, ocr = settings.models?.ocr || {};
    this.state = { ...this.state, remote: { enabled: settings.enabled === true, imageReady: settings.enabled === true && embedding.enabled === true && embedding.imageEnabled === true && embedding.protocol === "ark-multimodal", ocrReady: settings.enabled === true && ocr.enabled === true && ["openai-chat", "volc-visual-ocr"].includes(ocr.protocol), ocrProtocol: text2(ocr.protocol) }, records: (Array.isArray(data?.status) ? data.status : []).map((row) => ({ id: text2(row.id), title: text2(row.title) || text2(row.id), revision: revision(row.revision), projectId: text2(row.projectId), shared: row.shared === true, needsRebuild: row.needsRebuild === true, needsSemanticIndex: row.needsSemanticIndex === true, embeddingError: errors[row.embeddingError] || (row.embeddingError ? "\u4E0A\u6B21\u5411\u91CF\u751F\u6210\u5931\u8D25\uFF0C\u8BF7\u6D4B\u8BD5\u8FDE\u63A5\u540E\u91CD\u8BD5\u3002" : ""), semantic: row.semantic === true, textChunks: count(row.textChunks), imageChunks: count(row.imageChunks), hasImageIndex: row.hasImageIndex === true, pageNumbers: validPages(row.pageNumbers) ? [...row.pageNumbers] : null })), capabilities: Object.entries(data?.capabilities || {}).filter(([, value]) => typeof value === "boolean").map(([name, available]) => ({ name, available })) };
  }
  async run(body) {
    if (this.disposed || this.state.busy && body) return;
    this.abort?.abort();
    this.abort = new AbortController();
    const epoch = ++this.epoch;
    this.state = { ...this.state, busy: true, error: "", message: "", results: [], warnings: [] };
    this.publish();
    let accepted = false;
    try {
      const data = await this.request(body, epoch);
      if (!this.live(epoch)) return;
      if (!body) this.accept(data);
      else if (body.action === "testRerank") {
        this.state = { ...this.state, message: `\u91CD\u6392\u63A5\u53E3\u901A\u8FC7\uFF1A\u8FD4\u56DE ${count(data.documents)} \u6761\u6709\u6548\u8BC4\u5206\u3002\u8BED\u4E49\u6837\u4F8B${data.topIndex === 1 ? "\u7B26\u5408\u9884\u671F" : "\u6392\u5E8F\u672A\u7B26\u5408\u9884\u671F\uFF0C\u8BF7\u68C0\u67E5\u6A21\u578B"}\u3002` };
      } else if (body.action === "testEmbedding") {
        this.state = { ...this.state, message: `\u5411\u91CF\u8FDE\u63A5\u901A\u8FC7\uFF1A\u6587\u6863\u4E0E\u67E5\u8BE2\u5747\u8FD4\u56DE ${count(data.dimensions)} \u7EF4\u5411\u91CF\u3002\u8D44\u6599\u7D22\u5F15\u4ECD\u9700\u5355\u72EC\u5EFA\u7ACB\u3002` };
      } else if (body.action === "search") {
        const image = !!body.queryImage;
        this.state = { ...this.state, results: (Array.isArray(data.results) ? data.results : []).map((row) => ({ id: text2(row.id), title: text2(row.title), summary: row.modality === "image" ? "" : text2(row.summary), modality: row.modality === "image" ? "image" : "text", textMethod: text2(row.textMethod), score: Number.isFinite(row.score) ? row.score : null, citation: citation(row.citation) })), warnings: (Array.isArray(data.warnings) ? data.warnings : []).filter((value) => typeof value === "string" && Object.hasOwn(errors, value)).map((value) => errors[value]), message: image ? `\u68C0\u7D22\u5B8C\u6210\uFF08\u56FE\u7247\u5411\u91CF\u53EC\u56DE${body.query.trim() ? " + \u6587\u5B57\u5173\u952E\u8BCD" : ""}\uFF09\u3002` : `\u68C0\u7D22\u5B8C\u6210\uFF08${data.mode === "hybrid" ? "\u6DF7\u5408\u68C0\u7D22" : "\u5173\u952E\u8BCD\u68C0\u7D22"}\uFF09\u3002` };
      } else {
        accepted = true;
        this.state.message = body.action === "scope" ? "\u8BBF\u95EE\u8303\u56F4\u5DF2\u66F4\u65B0\u3002" : `\u7D22\u5F15\u5B8C\u6210\uFF1A${count(data.chunks)} \u4E2A\u7247\u6BB5\uFF0C${data.semantic ? "\u8BED\u4E49\u7D22\u5F15" : "\u5173\u952E\u8BCD\u7D22\u5F15"}\u3002${body.pageNumbers ? "\u5DF2\u66FF\u6362\u4E3A\u672C\u6B21\u6240\u9009\u9875\u7684\u7D22\u5F15\u3002" : ""}${data.degraded ? "\u8FDC\u7A0B\u5411\u91CF\u672A\u5B8C\u6210\uFF1A" + (errors[data.degraded] || "\u8BF7\u6D4B\u8BD5\u8FDE\u63A5\u540E\u91CD\u8BD5\u3002") + "\u5DF2\u4FDD\u7559\u5173\u952E\u8BCD\u7D22\u5F15\u3002" : ""}`;
        const refreshed = await this.request(null, epoch);
        if (!this.live(epoch)) return;
        this.accept(refreshed);
      }
    } catch (error) {
      if (!this.live(epoch)) return;
      const revoked = [401, 403, 404].includes(error.status);
      this.state = { ...this.state, error: accepted ? "\u64CD\u4F5C\u5DF2\u63D0\u4EA4\uFF0C\u8BFB\u53D6\u786E\u8BA4\u5931\u8D25\u3002\u8BF7\u5237\u65B0\u72B6\u6001\uFF0C\u4E0D\u8981\u91CD\u590D\u63D0\u4EA4\u3002" : errors[error.code] || failure(error.status), ...revoked ? { records: [], results: [], capabilities: [] } : {} };
    } finally {
      if (this.live(epoch)) {
        this.state = { ...this.state, busy: false, loading: false };
        this.publish();
      }
    }
  }
  testRerank = () => this.run({ action: "testRerank", consent: "synthetic-test" });
  testEmbedding = () => this.run({ action: "testEmbedding", consent: "synthetic-test" });
  load = () => this.run(null);
  index = (id, allowRemote = false, options = {}) => {
    const body = { action: "index", id, allowRemote: allowRemote === true, consent: "selected-document" };
    if (!id) return this.reject("\u8BF7\u5148\u9009\u62E9\u77E5\u8BC6\u6761\u76EE\u3002");
    if (options.ocrEngine !== void 0) {
      if (!["auto", "local", "configured"].includes(options.ocrEngine)) return this.reject(errors.INVALID_OCR_ENGINE);
      body.ocrEngine = options.ocrEngine;
    }
    if (options.indexImages === true) {
      if (!allowRemote) return this.reject(errors.SELECTED_IMAGE_CONSENT_REQUIRED);
      if (!this.state.remote.imageReady) return this.reject(errors.IMAGE_INDEX_REQUIRES_REMOTE_CONFIGURATION);
      body.indexImages = true;
      body.imageConsent = "selected-pages";
    }
    if (options.pageNumbers !== void 0) {
      if (!validPages(options.pageNumbers)) return this.reject(errors.IMAGE_PAGE_SELECTION_REQUIRED);
      body.pageNumbers = [...options.pageNumbers];
    }
    if (options.indexImages === true && !body.pageNumbers) return this.reject(errors.IMAGE_PAGE_SELECTION_REQUIRED);
    if (options.ocrEngine === "configured") {
      if (!allowRemote) return this.reject(errors.OCR_CONFIGURED_REQUIRES_REMOTE);
      if (!this.state.remote.ocrReady) return this.reject(errors.OCR_NOT_CONFIGURED);
    }
    if (options.indexImages === true || options.ocrEngine === "configured") {
      const row = this.state.records.find((row2) => row2.id === id);
      if (!row || typeof options.revision !== "string" || !options.revision || row.revision !== options.revision) return this.reject(errors.SOURCE_REVISION_CHANGED);
      body.revision = options.revision;
    }
    return this.run(body);
  };
  search = (query, allowRemote = false, options = {}) => {
    const image = options.queryImage;
    if (typeof query !== "string" || query.length > 1e3 || !query.trim() && !image) return this.reject(errors.INVALID_QUERY);
    const body = { action: "search", query, allowRemote: allowRemote === true, consent: "query-and-candidates", ...allowRemote && options.rerankImages === true ? { rerankImageConsent: "retrieved-images" } : {} };
    if (image) {
      if (!allowRemote) return this.reject(errors.QUERY_IMAGE_CONSENT_REQUIRED);
      if (!this.state.remote.imageReady) return this.reject(errors.IMAGE_QUERY_REQUIRES_REMOTE_CONFIGURATION);
      const row = this.state.records.find((row2) => row2.id === image.id);
      if (!row || Object.keys(image).some((key) => !["id", "pageNumber", "revision"].includes(key)) || !validPages([image.pageNumber])) return this.reject(errors.INVALID_QUERY_IMAGE_REFERENCE);
      if (typeof image.revision !== "string" || !image.revision || row.revision !== image.revision) return this.reject(errors.SOURCE_REVISION_CHANGED);
      body.queryImage = { id: row.id, pageNumber: image.pageNumber, revision: image.revision };
      body.imageConsent = "selected-query-image";
    }
    return this.run(body);
  };
  scope = (row, projectId, shared) => row ? this.run({ action: "scope", id: row.id, updatedAt: row.revision, projectId, shared: shared === true }) : Promise.resolve();
  dispose = () => {
    this.disposed = true;
    this.epoch++;
    this.abort?.abort();
    this.state = { ...this.state, busy: false, loading: true, error: "", message: "", records: [], capabilities: [], results: [], warnings: [] };
    this.listeners.clear();
  };
};

// client/knowledge-rag-operations.jsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function EntrySelect({ id, label, value, records, onChange, disabled }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dkr-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "dkr-field-label", htmlFor: id, children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { id, className: "dkr-select", value, disabled, onChange: (event) => onChange(event.target.value), children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "", children: "\u8BF7\u9009\u62E9\u77E5\u8BC6\u6761\u76EE" }),
      records.map((row) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("option", { value: row.id, children: [
        row.title,
        " \xB7 ",
        row.id
      ] }, row.id))
    ] })
  ] });
}
function ResultCard({ result }) {
  const source = result.citation, location = source?.location;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "dkr-result", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("strong", { children: [
      result.modality === "image" ? "\u56FE\u7247\u7ED3\u679C" : "\u6587\u5B57\u7ED3\u679C",
      " \xB7 ",
      result.title || result.id
    ] }),
    result.modality === "text" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: result.summary }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { className: "dkr-hint", children: [
      "\u6765\u6E90\uFF1A",
      source?.entryId || source?.sourceId || result.id,
      source?.partId && ` \xB7 ${source.partId}`,
      source?.revision != null && ` \xB7 \u7248\u672C ${source.revision}`,
      location?.pageNumber != null && ` \xB7 \u9875 ${location.pageNumber}`,
      location?.section && ` \xB7 ${location.section}`,
      location?.blockId && ` \xB7 ${location.blockId}`,
      result.score != null && ` \xB7 \u5206\u6570 ${result.score.toFixed(3)}`
    ] }),
    result.modality === "image" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { className: "dkr-hint", children: [
      "\u6B64\u7ED3\u679C\u6765\u81EA\u539F\u56FE\u5411\u91CF\uFF0C\u4E0D\u662F\u56FE\u7247\u63CF\u8FF0\u6587\u672C\u3002",
      source?.imageHash && `\u56FE\u50CF\u6307\u7EB9\uFF1A${source.imageHash}`
    ] })
  ] });
}
function KnowledgeRagOperations({ settingsBusy = false, settingsVersion = 0 }) {
  const [controller] = (0, import_react3.useState)(() => new RagOperationsController()), [state, setState] = (0, import_react3.useState)(() => controller.snapshot());
  const [selected, setSelected] = (0, import_react3.useState)(""), [selectedRevision, setSelectedRevision] = (0, import_react3.useState)(null), [indexMode, setIndexMode] = (0, import_react3.useState)("text"), [ocrEngine, setOcrEngine] = (0, import_react3.useState)("auto"), [pagesText, setPagesText] = (0, import_react3.useState)("");
  const [query, setQuery] = (0, import_react3.useState)(""), [queryMode, setQueryMode] = (0, import_react3.useState)("text"), [querySource, setQuerySource] = (0, import_react3.useState)(null), [queryPage, setQueryPage] = (0, import_react3.useState)("");
  const [remoteIndex, setRemoteIndex] = (0, import_react3.useState)(false), [remoteQuery, setRemoteQuery] = (0, import_react3.useState)(false), [rerankImages, setRerankImages] = (0, import_react3.useState)(false), [project, setProject] = (0, import_react3.useState)(""), [shared, setShared] = (0, import_react3.useState)(false);
  (0, import_react3.useEffect)(() => {
    controller.activate();
    const off = controller.subscribe(setState);
    return () => {
      off();
      controller.dispose();
    };
  }, [controller]);
  (0, import_react3.useEffect)(() => {
    controller.invalidate();
    setRemoteIndex(false);
    setRemoteQuery(false);
    setRerankImages(false);
    if (!settingsBusy) controller.load();
  }, [controller, settingsBusy, settingsVersion]);
  const needsPages = indexMode === "images" || ocrEngine === "configured";
  const row = state.records.find((value) => value.id === selected) || (!needsPages ? state.records[0] : null), queryRow = state.records.find((value) => value.id === querySource?.id);
  const staleIndex = needsPages && row && selectedRevision !== row.revision, staleQuery = querySource && (!queryRow || querySource.revision !== queryRow.revision);
  const selectedPages = parsePages(pagesText), singlePage = parsePages(queryPage), hasQueryImage = queryMode === "image";
  const busy = state.busy || state.loading || settingsBusy;
  const indexValid = !!row && !staleIndex && (!needsPages || !!selectedPages) && (indexMode !== "images" || state.remote.imageReady && remoteIndex) && (ocrEngine !== "configured" || state.remote.ocrReady && remoteIndex);
  const queryValid = query.length <= 1e3 && (hasQueryImage ? !!querySource && !staleQuery && singlePage?.length === 1 && remoteQuery && state.remote.imageReady : !!query.trim());
  const change = (update) => {
    controller.invalidate();
    setRemoteIndex(false);
    setRemoteQuery(false);
    setRerankImages(false);
    update();
  };
  (0, import_react3.useEffect)(() => {
    setProject(row?.projectId || "");
    setShared(row?.shared === true);
    setRemoteIndex(false);
  }, [row?.id, row?.revision, row?.projectId, row?.shared]);
  (0, import_react3.useEffect)(() => {
    if (staleIndex || staleQuery) {
      controller.invalidate();
      setRemoteIndex(false);
      setRemoteQuery(false);
      setRerankImages(false);
    }
  }, [controller, !!staleIndex, !!staleQuery]);
  function chooseIndex(id) {
    change(() => {
      const row2 = state.records.find((value) => value.id === id);
      setSelected(id);
      setSelectedRevision(row2?.revision ?? null);
    });
  }
  function refresh() {
    change(() => {
      setSelected("");
      setSelectedRevision(null);
      setQuerySource(null);
    });
    controller.load();
  }
  function index() {
    if (!indexValid) return;
    const allow = remoteIndex;
    setRemoteIndex(false);
    controller.index(row.id, allow, { ocrEngine, ...indexMode === "images" ? { indexImages: true } : {}, ...needsPages ? { pageNumbers: selectedPages, revision: selectedRevision } : {} });
  }
  function search() {
    if (!queryValid) return;
    const allow = remoteQuery;
    setRemoteQuery(false);
    setRerankImages(false);
    controller.search(query, allow, { rerankImages, ...hasQueryImage ? { queryImage: { id: querySource.id, revision: querySource.revision, pageNumber: singlePage[0] } } : {} });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: "dkr-details", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { children: "\u7D22\u5F15\u3001\u68C0\u7D22\u4E0E\u8BBF\u95EE\u8303\u56F4" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dkr-ops", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dkr-hint", children: "\u672C\u5730\u6587\u5B57\u7D22\u5F15\u4E0E\u5173\u952E\u8BCD\u67E5\u8BE2\u65E0\u9700\u5916\u53D1\u3002\u4E13\u7528 OCR\u3001\u89C6\u89C9\u8BC6\u5B57\u4E0E\u76F4\u63A5\u56FE\u7247\u5411\u91CF\u5206\u522B\u914D\u7F6E\uFF1B\u6BCF\u6B21\u5916\u53D1\u53EA\u9650\u672C\u6B21\u6240\u9009\u6761\u76EE\u548C\u8303\u56F4\uFF0C\u53EF\u80FD\u4EA7\u751F\u670D\u52A1\u5546\u8D39\u7528\u3002" }),
      settingsBusy && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dkr-hint", role: "status", children: "\u8BF7\u5148\u4FDD\u5B58\u6216\u53D6\u6D88\u4E0A\u65B9\u914D\u7F6E\u4FEE\u6539\uFF0C\u518D\u6267\u884C\u5904\u7406\u3002" }),
      state.error && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dkr-error", role: "alert", children: state.error }),
      state.message && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dkr-saved", role: "status", children: state.message }),
      state.loading && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dkr-hint", role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u6761\u76EE\u2026" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dkr-hint", children: "\u4FDD\u5B58\u914D\u7F6E\u4E0D\u4F1A\u81EA\u52A8\u5EFA\u7ACB\u5411\u91CF\u7D22\u5F15\u3002\u5148\u6D4B\u8BD5\u8FDE\u63A5\uFF0C\u518D\u9009\u62E9\u8D44\u6599\u5E76\u5F00\u542F\u672C\u6B21\u8FDC\u7A0B\u6388\u6743\uFF0C\u6267\u884C\u7D22\u5F15\uFF1B\u4E0D\u5F00\u542F\u6388\u6743\u53EA\u751F\u6210\u5173\u952E\u8BCD\u7D22\u5F15\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", variant: "outline", size: "sm", disabled: busy, onClick: () => controller.testEmbedding(), children: "\u6D4B\u8BD5\u5411\u91CF\u8FDE\u63A5\uFF08\u53D1\u9001\u4E24\u6761\u6D4B\u8BD5\u6587\u672C\uFF0C\u53EF\u80FD\u6536\u8D39\uFF09" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", variant: "outline", size: "sm", disabled: busy, onClick: () => controller.testRerank(), children: "\u6D4B\u8BD5\u91CD\u6392\u8FDE\u63A5\uFF08\u53D1\u9001\u516C\u5F00\u6837\u4F8B\uFF0C\u53EF\u80FD\u6536\u8D39\uFF09" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", variant: "outline", size: "sm", disabled: settingsBusy, onClick: refresh, children: "\u5237\u65B0\u6761\u76EE\u4E0E\u72B6\u6001" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dkr-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dkr-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "dkr-field-label", htmlFor: "dkr-index-mode", children: "\u7D22\u5F15\u65B9\u5F0F" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { id: "dkr-index-mode", className: "dkr-select", value: indexMode, disabled: settingsBusy, onChange: (event) => change(() => {
            setIndexMode(event.target.value);
            setSelected("");
            setSelectedRevision(null);
            setPagesText("");
          }), children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "text", children: "\u6587\u5B57\u7D22\u5F15" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "images", children: "\u6240\u9009\u9875\u539F\u56FE\u5411\u91CF\u7D22\u5F15" })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dkr-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "dkr-field-label", htmlFor: "dkr-ocr-engine", children: "\u6587\u5B57\u63D0\u53D6\u65B9\u5F0F" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { id: "dkr-ocr-engine", className: "dkr-select", value: ocrEngine, disabled: settingsBusy, onChange: (event) => change(() => {
            setOcrEngine(event.target.value);
            setSelected("");
            setSelectedRevision(null);
            setPagesText("");
          }), children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "auto", children: "\u81EA\u52A8 \xB7 \u672C\u5730\u4F18\u5148\uFF0C\u6388\u6743\u540E\u53EF\u89C6\u89C9\u8BC6\u5B57" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "local", children: "\u4EC5\u672C\u5730 OCR" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("option", { value: "configured", children: [
              "\u5DF2\u914D\u7F6E OCR \xB7 ",
              state.remote.ocrProtocol === "volc-visual-ocr" ? "\u4E13\u7528 OCR" : "\u89C6\u89C9\u8BC6\u5B57"
            ] })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(EntrySelect, { id: "dkr-index-entry", label: "\u7D22\u5F15\u6761\u76EE", value: row?.id || "", records: state.records, onChange: chooseIndex, disabled: settingsBusy }),
      row && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { className: "dkr-hint", children: [
        "\u6761\u76EE ID\uFF1A",
        row.id,
        " \xB7 \u9009\u62E9\u7248\u672C\uFF1A",
        needsPages ? selectedRevision : row.revision,
        " \xB7 \u6587\u5B57 ",
        row.textChunks,
        " / \u56FE\u7247 ",
        row.imageChunks,
        " \u4E2A\u7247\u6BB5 \xB7 ",
        row.needsSemanticIndex ? "\u5C1A\u65E0\u5F53\u524D\u914D\u7F6E\u7684\u5411\u91CF\u7D22\u5F15" : row.needsRebuild ? "\u5F85\u7D22\u5F15\u6216\u91CD\u5EFA" : row.hasImageIndex ? "\u5DF2\u6709\u56FE\u7247\u7D22\u5F15" : row.semantic ? "\u5DF2\u6709\u6587\u5B57\u8BED\u4E49\u7D22\u5F15" : "\u5173\u952E\u8BCD\u7D22\u5F15",
        row.pageNumbers && ` \xB7 \u5DF2\u7D22\u5F15\u9875 ${row.pageNumbers.join(", ")}`
      ] }),
      row?.embeddingError && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dkr-error", role: "alert", children: row.embeddingError }),
      needsPages && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dkr-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "dkr-field-label", htmlFor: "dkr-index-pages", children: "\u672C\u6B21\u6240\u9009\u9875\u7801" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Input, { id: "dkr-index-pages", value: pagesText, placeholder: "\u4F8B\u5982 1, 3\uFF08\u6700\u591A 3 \u9875\uFF09", disabled: settingsBusy, "aria-invalid": !!pagesText && !selectedPages, onChange: (event) => change(() => setPagesText(event.target.value)) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dkr-hint", children: "1\u2013500 \u7684\u4E0D\u540C\u9875\u7801\uFF0C\u6700\u591A 3 \u9875\u3002\u6267\u884C\u4F1A\u66FF\u6362\u6B64\u6761\u76EE\u7684\u73B0\u6709\u7D22\u5F15\u4E3A\u672C\u6B21\u6240\u9009\u9875\uFF0C\u4E0D\u8FFD\u52A0\uFF0C\u4E0D\u9690\u5F0F\u6269\u5C55\u5230\u5168\u4E66\u3002" }),
        indexMode === "images" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dkr-hint", children: "\u672C\u6B21\u8303\u56F4\u603B\u56FE\u50CF\u9884\u7B97 20 MiB\uFF0C\u5355\u56FE\u5411\u91CF\u8F93\u5165\u987B\u5C0F\u4E8E 10 MiB\uFF1BPNG/JPEG \u5C3A\u5BF8\u4E0E\u50CF\u7D20\u4E0A\u9650\u7531\u6838\u5FC3\u9A8C\u8BC1\u3002\u4E13\u7528 OCR \u53E6\u6709\u7F16\u7801\u540E\u8BF7\u6C42\u9650\u5236\u3002" })
      ] }),
      staleIndex && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dkr-error", role: "alert", children: "\u6761\u76EE\u7248\u672C\u5DF2\u6539\u53D8\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u9009\u62E9\u6761\u76EE\u4E0E\u9875\u7801\uFF0C\u5E76\u91CD\u65B0\u6388\u6743\u3002" }),
      indexMode === "images" && !state.remote.imageReady && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dkr-hint", children: "\u8BF7\u5148\u914D\u7F6E\u5E76\u542F\u7528\u8FDC\u7A0B\u603B\u5F00\u5173\u3001\u5411\u91CF\u89D2\u8272\u53CA\u76F4\u63A5\u56FE\u7247\u5411\u91CF\u80FD\u529B\u3002" }),
      ocrEngine === "configured" && !state.remote.ocrReady && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dkr-hint", children: "\u8BF7\u5148\u914D\u7F6E\u5E76\u542F\u7528\u8FDC\u7A0B\u603B\u5F00\u5173\u4E0E\u6240\u9009 OCR \u89D2\u8272\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dkr-toggle", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: needsPages ? "\u672C\u6B21\u6388\u6743\u53D1\u9001\u6240\u9009\u9875\u53CA\u89E3\u6790\u6587\u5B57\u5230\u5DF2\u914D\u7F6E\u7684\u5904\u7406/\u5411\u91CF\u670D\u52A1" : ocrEngine === "auto" ? "\u672C\u6B21\u6388\u6743\u53D1\u9001\u6240\u9009\u6761\u76EE\u6587\u5B57\uFF1B\u672C\u5730 OCR \u4E0D\u53EF\u7528\u65F6\u53EF\u53D1\u9001\u9875\u9762\u56FE\u7247\u7528\u4E8E\u89C6\u89C9\u8BC6\u5B57" : "\u672C\u6B21\u6388\u6743\u53D1\u9001\u6240\u9009\u6761\u76EE\u89E3\u6790\u6587\u5B57\u5230\u5904\u7406\u53CA\u5411\u91CF\u670D\u52A1" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Switch, { checked: remoteIndex, label: "\u672C\u6B21\u6388\u6743\u8FDC\u7A0B\u5904\u7406\u6240\u9009\u8D44\u6599\uFF0C\u53EF\u80FD\u6536\u8D39", disabled: busy || !row || !!staleIndex || needsPages && !selectedPages, onChange: setRemoteIndex })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", variant: "outline", disabled: busy || !indexValid, onClick: index, children: indexMode === "images" ? "\u5EFA\u7ACB\u6240\u9009\u9875\u539F\u56FE\u5411\u91CF" : ocrEngine === "configured" ? "\u8BC6\u522B\u5E76\u7D22\u5F15\u6240\u9009\u9875\u6587\u5B57" : "\u7D22\u5F15\u6240\u9009\u6761\u76EE\u6587\u5B57" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: "dkr-details", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { children: "\u6240\u9009\u6761\u76EE\u7684\u8BBF\u95EE\u8303\u56F4" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dkr-ops", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dkr-hint", children: "\u7D22\u5F15\u672C\u8EAB\u4E0D\u589E\u52A0 Agent \u6743\u9650\u3002\u7559\u7A7A\u9879\u76EE\u8DEF\u5F84\u4E3A\u64CD\u4F5C\u8005\u79C1\u6709\uFF0C\u66F4\u6539\u8303\u56F4\u662F\u72EC\u7ACB\u52A8\u4F5C\u5E76\u8BB0\u5165\u5386\u53F2\uFF1BReader \u6765\u6E90\u7EE7\u7EED\u9075\u5B88\u4E66\u7C4D\u6388\u6743\u3002" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dkr-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "dkr-field-label", htmlFor: "dkr-project", children: "\u9879\u76EE\u7EDD\u5BF9\u8DEF\u5F84" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Input, { id: "dkr-project", value: project, disabled: busy || !row, onChange: (event) => setProject(event.target.value) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dkr-toggle", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\u5141\u8BB8\u5168\u90E8\u9879\u76EE Agent \u8BBF\u95EE\u6B64\u6761\u76EE" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Switch, { checked: shared, label: "\u5141\u8BB8\u5168\u90E8\u9879\u76EE Agent \u8BBF\u95EE\u6240\u9009\u77E5\u8BC6\u6761\u76EE", disabled: busy || !row, onChange: setShared })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", variant: "outline", disabled: busy || !row || !!project && !project.startsWith("/"), onClick: () => controller.scope(row, project, shared), children: "\u66F4\u65B0\u6240\u9009\u6761\u76EE\u8BBF\u95EE\u8303\u56F4" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dkr-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "dkr-field-label", htmlFor: "dkr-query-mode", children: "\u67E5\u8BE2\u65B9\u5F0F" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { id: "dkr-query-mode", className: "dkr-select", value: queryMode, disabled: settingsBusy, onChange: (event) => change(() => {
          setQueryMode(event.target.value);
          setQuerySource(null);
          setQueryPage("");
        }), children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "text", children: "\u6587\u5B57\u67E5\u8BE2\uFF08\u53EF\u53EC\u56DE\u5DF2\u5EFA\u56FE\u7247\u5411\u91CF\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "image", children: "\u4EE5\u56FE\u67E5\u8BE2\uFF08\u53EF\u9644\u6587\u5B57\u5173\u952E\u8BCD\uFF09" })
        ] })
      ] }),
      hasQueryImage && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(EntrySelect, { id: "dkr-query-source", label: "\u67E5\u8BE2\u56FE\u7247\u7684\u53EF\u4FE1\u77E5\u8BC6\u6765\u6E90", value: querySource?.id || "", records: state.records, disabled: settingsBusy, onChange: (id) => change(() => {
          const row2 = state.records.find((value) => value.id === id);
          setQuerySource(row2 ? { id: row2.id, revision: row2.revision } : null);
          setQueryPage("");
        }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dkr-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "dkr-field-label", htmlFor: "dkr-query-page", children: "\u67E5\u8BE2\u56FE\u7247\u9875\u7801" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Input, { id: "dkr-query-page", value: queryPage, placeholder: "\u8F93\u5165\u4E00\u4E2A\u9875\u7801", disabled: settingsBusy, onChange: (event) => change(() => setQueryPage(event.target.value)) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { className: "dkr-hint", children: [
          "\u53EA\u8BFB\u53D6\u672C\u6B21\u6240\u9009\u6765\u6E90\u7684\u5355\u9875\uFF0C\u4E0D\u63A5\u53D7 URL\u3001\u8DEF\u5F84\u6216\u6D4F\u89C8\u5668\u4E0A\u4F20\u3002\u67E5\u8BE2\u56FE\u7247\u4E34\u65F6\u4F7F\u7528\uFF0C\u4E0D\u5199\u5165\u7D22\u5F15\u3002\u56FE\u7247\u5411\u91CF\u53EC\u56DE + \u6587\u5B57\u5173\u952E\u8BCD\uFF0C\u4E0D\u662F\u56FE\u6587\u8054\u5408\u5411\u91CF\u3002",
          querySource && `\u6765\u6E90 ${querySource.id} \xB7 \u56FA\u5B9A\u7248\u672C ${querySource.revision}`
        ] }),
        staleQuery && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dkr-error", role: "alert", children: "\u67E5\u8BE2\u6765\u6E90\u7248\u672C\u5DF2\u6539\u53D8\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u9009\u62E9\u6765\u6E90\u3001\u9875\u7801\u4E0E\u6388\u6743\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dkr-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "dkr-field-label", htmlFor: "dkr-query", children: hasQueryImage ? "\u8F85\u52A9\u6587\u5B57\u5173\u952E\u8BCD\uFF08\u53EF\u7559\u7A7A\uFF09" : "\u67E5\u8BE2\u6587\u5B57" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Input, { id: "dkr-query", value: query, disabled: settingsBusy, maxLength: 1e3, onChange: (event) => change(() => setQuery(event.target.value)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dkr-toggle", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: hasQueryImage ? "\u672C\u6B21\u6388\u6743\u53D1\u9001\u6240\u9009\u67E5\u8BE2\u56FE\u7247\u53CA\u6587\u5B57\u67E5\u8BE2\uFF1B\u56FE\u7247\u91CD\u6392\u9700\u4E0B\u65B9\u53E6\u884C\u6388\u6743" : "\u672C\u6B21\u6388\u6743\u53D1\u9001\u6587\u5B57\u67E5\u8BE2\u53CA\u9002\u7528\u5019\u9009\u7247\u6BB5\u5230\u5411\u91CF\u6216\u91CD\u6392\u670D\u52A1" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Switch, { checked: remoteQuery, label: "\u672C\u6B21\u6388\u6743\u8FDC\u7A0B\u68C0\u7D22\uFF0C\u53EF\u80FD\u6536\u8D39", disabled: busy || (hasQueryImage ? !querySource || staleQuery || singlePage?.length !== 1 : !query.trim()), onChange: (value) => {
          setRemoteQuery(value);
          setRerankImages(false);
        } })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dkr-toggle", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\u672C\u6B21\u53E6\u884C\u6388\u6743\u5C06\u6700\u591A 3 \u5F20\u5DF2\u7D22\u5F15\u5019\u9009\u539F\u56FE\u53CA\u67E5\u8BE2\u56FE\u7247\u53D1\u9001\u5230 Qwen3-VL \u91CD\u6392\uFF1B\u603B\u56FE\u7247\u4E0A\u9650 20 MB\u3002\u56FE\u7247\u67E5\u8BE2\u4EE5\u56FE\u7247\u4E3A\u91CD\u6392\u95EE\u9898\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Switch, { checked: rerankImages, label: "\u672C\u6B21\u6388\u6743\u56FE\u7247\u5019\u9009\u91CD\u6392\uFF0C\u53EF\u80FD\u6536\u8D39", disabled: busy || !remoteQuery, onChange: setRerankImages })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", variant: "outline", disabled: busy || !queryValid, onClick: search, children: "\u68C0\u7D22" }),
      state.results.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "dkr-results", children: state.results.map((result, index2) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ResultCard, { result }, `${result.id}:${index2}`)) }),
      state.warnings.map((warning) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dkr-hint", children: warning }, warning)),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: "dkr-details", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { children: "\u672C\u673A\u5904\u7406\u80FD\u529B" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dkr-capabilities", children: state.capabilities.map((value) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
          value.name,
          "\uFF1A",
          value.available ? "\u53EF\u7528" : "\u4E0D\u53EF\u7528"
        ] }, value.name)) })
      ] })
    ] })
  ] });
}

// client/knowledge-rag-style.js
var ragStyles = `
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
`;

// client/knowledge-rag-entry.jsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var labels = { unavailable: "\u6B63\u5728\u8BFB\u53D6\u77E5\u8BC6\u5E93\u914D\u7F6E\u2026", readOnly: "\u8BBE\u7F6E\u6682\u4E0D\u53EF\u5199\uFF0C\u8BF7\u5148\u91CD\u8BD5\u8BFB\u53D6\u3002", saveFailed: "\u4FDD\u5B58\u672A\u5B8C\u6210\uFF0C\u8BF7\u68C0\u67E5\u4E0A\u65B9\u63D0\u793A\u3002", save: "\u4FDD\u5B58\u8BBE\u7F6E", saving: "\u6B63\u5728\u4FDD\u5B58\u2026" };
function KnowledgeRagEntry({ compact = false, onOpenSettings }) {
  const [unavailable, setUnavailable] = (0, import_react4.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: `dkr-entry ${compact ? "dkr-compact" : ""}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("style", { children: ragStyles }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "\u77E5\u8BC6\u5E93\u5904\u7406\u4E0E\u68C0\u7D22" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { type: "button", size: "sm", variant: "outline", onClick: () => setUnavailable(onOpenSettings?.() !== true), disabled: !onOpenSettings, children: "\u914D\u7F6E\u5904\u7406\u4E0E\u68C0\u7D22" }),
    (!onOpenSettings || unavailable) && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dkr-hint", role: "status", children: "\u8BBE\u7F6E\u5206\u533A\u6682\u4E0D\u53EF\u7528" })
  ] });
}
function SelectField({ id, label, value, disabled, options, onChange, error }) {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dkr-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("label", { className: "dkr-field-label", htmlFor: id, children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("select", { id, className: "dkr-select", value, disabled, onChange: (event) => onChange(event.target.value), "aria-invalid": !!error, "aria-describedby": error ? `${id}-error` : void 0, children: options.map((option) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: option.value, disabled: option.disabled, children: option.label }, option.value)) }),
    error && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { id: `${id}-error`, className: "dkr-error", children: error })
  ] });
}
function ValueField({ controller, state, role, field, label, hint, numeric = false, disabled = false }) {
  const model = role ? state.draft.models[role] : state.draft;
  const baseline = role ? controller.baseline.models[role] : controller.baseline;
  const error = state.errors[role ? `${role}.${field}` : field];
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.SettingsValueField, { id: `dkr-${role || "general"}-${field}`, label, text: String(model[field]), hint, numeric, disabled: disabled || state.saving || state.phase !== "ready", overridden: model[field] !== baseline[field], overriddenLabel: "\u672A\u4FDD\u5B58", resetLabel: "\u64A4\u9500\u4FEE\u6539", invalid: !!error, invalidLabel: error || "", onEdit: (value) => controller.edit(role, field, value), onReset: () => controller.reset(role, field) });
}
function InstructionField({ role, field, label, hint, controller, state }) {
  const model = state.draft.models[role], baseline = controller.baseline.models[role], id = `dkr-${role}-${field}`, error = state.errors[`${role}.${field}`];
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dkr-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dkr-card-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("label", { className: "dkr-field-label", htmlFor: id, children: label }),
      model[field] !== baseline[field] && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { type: "button", size: "sm", disabled: state.saving, onClick: () => controller.reset(role, field), children: "\u64A4\u9500\u4FEE\u6539" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("textarea", { id, className: "dkr-instructions", rows: 4, value: model[field], disabled: state.saving || state.phase !== "ready", "aria-invalid": !!error, "aria-describedby": `${id}-hint`, onChange: (event) => controller.edit(role, field, event.target.value) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { id: `${id}-hint`, className: error ? "dkr-error" : "dkr-hint", children: error || hint })
  ] });
}
function ImageVectorFields({ role, model, controller, state }) {
  const disabled = state.saving || state.phase !== "ready";
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dkr-toggle", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u542F\u7528\u76F4\u63A5\u56FE\u7247\u5411\u91CF\u80FD\u529B" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Switch, { checked: model.imageEnabled, label: "\u542F\u7528\u76F4\u63A5\u56FE\u7247\u5411\u91CF\u80FD\u529B", disabled, onChange: (value) => controller.edit(role, "imageEnabled", value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dkr-hint", children: "\u6B64\u5F00\u5173\u53EA\u4FDD\u5B58\u80FD\u529B\u914D\u7F6E\u3002\u7D22\u5F15\u6216\u67E5\u8BE2\u4ECD\u9700\u53E6\u9009\u8D44\u6599\u3001\u9875\u7801\u4E0E\u672C\u6B21\u5916\u53D1\u6388\u6743\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u4E0A\u4F20\u56FE\u7247\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "dkr-details", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: "\u56FE\u7247\u5411\u91CF\u4EFB\u52A1\u6307\u4EE4" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(InstructionField, { controller, state, role, field: "imageDocumentInstructions", label: "\u56FE\u7247\u7D22\u5F15\u5411\u91CF\u6307\u4EE4", hint: "\u975E\u7A7A\uFF0C\u6700\u591A 4000 \u5B57\u7B26\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(InstructionField, { controller, state, role, field: "imageQueryInstructions", label: "\u56FE\u7247\u67E5\u8BE2\u5411\u91CF\u6307\u4EE4", hint: "\u4EE5\u56FE\u68C0\u7D22\u65F6\u4F7F\u7528\uFF1B\u975E\u7A7A\uFF0C\u6700\u591A 4000 \u5B57\u7B26\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(InstructionField, { controller, state, role, field: "multimodalQueryInstructions", label: "\u6587\u5B57\u68C0\u7D22\u56FE\u7247\u65F6\u7684\u5411\u91CF\u6307\u4EE4", hint: "\u6587\u5B57\u67E5\u627E\u6587\u672C\u6216\u56FE\u7247\u5019\u9009\u65F6\u4F7F\u7528\uFF1B\u4E0D\u662F\u56FE\u7247\u4E0E\u6587\u5B57\u7684\u8054\u5408\u5411\u91CF\u3002\u975E\u7A7A\uFF0C\u6700\u591A 4000 \u5B57\u7B26\u3002" })
    ] })
  ] });
}
function CredentialField({ role, field, controller, state }) {
  const model = state.draft.models[role], baseline = controller.baseline.models[role], labels2 = { apiKey: "API \u51ED\u636E", accessKey: "Access Key", secretKey: "Secret Key" };
  const clear = { apiKey: "clearCredential", accessKey: "clearAccessKey", secretKey: "clearSecretKey" }[field], configured = sameRoute(model, baseline) && model[{ apiKey: "credentialSet", accessKey: "accessKeySet", secretKey: "secretKeySet" }[field]];
  const disabled = state.saving || state.phase !== "ready", error = state.errors[`${role}.${field}`];
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.SettingsSecretField, { id: `dkr-${role}-${field}`, label: labels2[field], hint: "\u7559\u7A7A\u4FDD\u7559\u5F53\u524D\u8DEF\u7531\u5DF2\u5B58\u51ED\u636E\uFF1B\u4FDD\u5B58\u540E\u4E0D\u4F1A\u56DE\u663E\u3002", text: model[field], configured, stateLabel: model[clear] ? "\u4FDD\u5B58\u65F6\u6E05\u9664" : configured ? "\u5DF2\u4FDD\u5B58" : "\u672A\u8BBE\u7F6E", disabled: disabled || model[clear], onEdit: (value) => controller.edit(role, field, value) }),
    error && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dkr-error", role: "alert", children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dkr-toggle", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
        "\u4FDD\u5B58\u65F6\u6E05\u9664\u5DF2\u5B58 ",
        labels2[field]
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Switch, { checked: model[clear], label: `\u6E05\u9664${ROLE_INFO[role].title}\u5DF2\u5B58${labels2[field]}`, disabled, onChange: (value) => controller.edit(role, clear, value) })
    ] })
  ] });
}
function RoleCard({ role, controller, state }) {
  const model = state.draft.models[role], reuse = model.source === "harness", dedicated = model.protocol === "volc-visual-ocr", info = ROLE_INFO[role], disabled = state.saving || state.phase !== "ready";
  const providers = state.catalog.providers;
  const providerOptions = [{ value: "", label: "\u9009\u62E9 Harness \u670D\u52A1\u5546" }, ...providers.map((provider) => ({ value: provider.id, label: provider.name, disabled: provider.unavailable }))];
  if (model.provider && !providers.some((provider) => provider.id === model.provider)) providerOptions.push({ value: model.provider, label: `${model.provider}\uFF08\u5F53\u524D\u4E0D\u53EF\u7528\uFF09`, disabled: true });
  const models = modelsFor(state.catalog, model.provider, role), modelOptions = [{ value: "", label: "\u9009\u62E9\u6A21\u578B" }, ...models.map((value) => ({ value: value.id, label: value.name === value.id ? value.id : `${value.name} \xB7 ${value.id}` }))];
  if (model.model && !models.some((value) => value.id === model.model)) modelOptions.push({ value: model.model, label: `${model.model}\uFF08\u5F53\u524D\u4E0D\u53EF\u7528\uFF09`, disabled: true });
  const presets = state.providerCatalog.presets.filter((preset) => preset.roles.includes(role));
  const presetOptions = [{ value: "custom", label: "\u81EA\u5B9A\u4E49\u63A5\u53E3" }, ...presets.map((preset) => ({ value: preset.id, label: preset.label }))];
  const protocolOptions = PROTOCOLS[role].map((protocol) => ({ value: protocol, label: role === "ocr" ? protocol === "volc-visual-ocr" ? "\u4E13\u7528 OCR \xB7 volc-visual-ocr" : "\u89C6\u89C9\u8BC6\u5B57 \xB7 openai-chat" : protocol }));
  if (!PROTOCOLS[role].includes(model.protocol)) protocolOptions.push({ value: model.protocol, label: "\u5F53\u524D\u534F\u8BAE\u4E0D\u53D7\u652F\u6301", disabled: true });
  const descriptor = state.providerCatalog.protocols.find((protocol) => protocol.id === model.protocol && protocol.roles.includes(role));
  const routeChanged = !sameRoute(model, controller.baseline.models[role]);
  const supportsInstruction = descriptor ? descriptor.instructionModels.includes(model.model) : model.model === "doubao-seed-rerank";
  const reasoningOptions = REASONING.map((value) => ({ value, label: value || "\u4F7F\u7528\u6A21\u578B\u9ED8\u8BA4\u8BBE\u7F6E" }));
  if (!REASONING.includes(model.reasoningEffort)) reasoningOptions.push({ value: model.reasoningEffort, label: "\u5F53\u524D\u63A8\u7406\u5F3A\u5EA6\u4E0D\u53D7\u652F\u6301", disabled: true });
  const modelPresets = [...new Map(presets.filter((preset) => preset.config.protocol === model.protocol).map((preset) => [preset.config.model, preset])).values()];
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "dkr-card", "aria-labelledby": `dkr-${role}-title`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dkr-card-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { id: `dkr-${role}-title`, children: info.title }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Switch, { checked: model.enabled, onChange: (value) => controller.edit(role, "enabled", value), label: `\u542F\u7528${info.title}`, disabled })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dkr-hint", children: dedicated ? "\u4E13\u7528\u6587\u5B57\u8BC6\u522B\u670D\u52A1\uFF1B\u4EC5\u5C55\u793A\u670D\u52A1\u5546\u5B9E\u9645\u8FD4\u56DE\u7684\u6587\u5B57\u4E0E\u53EF\u7528\u7248\u9762\u5B9A\u4F4D\uFF0C\u4E0D\u8C03\u7528\u89C6\u89C9\u804A\u5929\u6216 MediaKit\u3002" : info.hint }),
    reusable(role) && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SelectField, { id: `dkr-${role}-source`, label: "\u914D\u7F6E\u6765\u6E90", value: model.source, disabled, options: [{ value: "independent", label: "\u72EC\u7ACB\u63A5\u53E3\u4E0E\u51ED\u636E" }, { value: "harness", label: "\u590D\u7528\u5DF2\u914D\u7F6E\u7684 Harness \u670D\u52A1", disabled: dedicated }], onChange: (value) => controller.edit(role, "source", value) }),
    reuse ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dkr-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SelectField, { id: `dkr-${role}-provider`, label: "Harness \u670D\u52A1\u5546", value: model.provider, disabled, options: providerOptions, error: state.errors[`${role}.provider`], onChange: (value) => controller.edit(role, "provider", value) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SelectField, { id: `dkr-${role}-model`, label: "\u6A21\u578B", value: model.model, disabled: disabled || !model.provider, options: modelOptions, error: state.errors[`${role}.model`], onChange: (value) => controller.edit(role, "model", value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dkr-hint", children: "\u4F7F\u7528\u5BBF\u4E3B\u5DF2\u4FDD\u5B58\u7684\u5730\u5740\u4E0E\u51ED\u636E\uFF1B\u6B64\u89D2\u8272\u7684\u72EC\u7ACB\u51ED\u636E\u4E0D\u4F1A\u7528\u4E8E Harness \u8BF7\u6C42\u3002" }),
      state.catalog.unavailable && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dkr-error", children: "Harness \u6A21\u578B\u5217\u8868\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u8BD5\u8BFB\u53D6\u8BBE\u7F6E\u3002" }),
      state.errors[`${role}.protocol`] && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dkr-error", role: "alert", children: state.errors[`${role}.protocol`] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dkr-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SelectField, { id: `dkr-${role}-preset`, label: "\u63A5\u53E3\u9884\u8BBE", value: model.preset, disabled, options: presetOptions, onChange: (value) => controller.preset(role, value) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SelectField, { id: `dkr-${role}-protocol`, label: "\u63A5\u53E3\u534F\u8BAE", value: model.protocol, disabled, options: protocolOptions, error: state.errors[`${role}.protocol`], onChange: (value) => controller.edit(role, "protocol", value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "dkr-hint", children: [
        "\u9884\u8BBE\u53EA\u4FEE\u6539\u6B64\u89D2\u8272\u7684\u8349\u7A3F\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u542F\u7528\u6216\u4FDD\u5B58\u3002\u5207\u6362\u63A5\u53E3\u540E\u8BF7\u786E\u8BA4\u51ED\u636E\u9002\u7528\u3002",
        descriptor?.path && `\u8BF7\u6C42\u63A5\u53E3\uFF1A${descriptor.path}\u3002`
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dkr-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ValueField, { controller, state, role, field: "provider", label: "\u670D\u52A1\u5546\u540D\u79F0", hint: "\u81EA\u5B9A\u4E49\u6807\u8BC6\uFF1B\u8BF7\u6C42\u4F7F\u7528\u4E0B\u65B9\u5730\u5740\u4E0E\u534F\u8BAE\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ValueField, { controller, state, role, field: "model", label: dedicated ? "OCR \u63A5\u53E3\u64CD\u4F5C\u540D" : model.protocol === "vikingdb-rerank" ? "\u91CD\u6392\u6A21\u578B ID" : "\u6A21\u578B ID / \u90E8\u7F72\u63A5\u5165\u70B9 ID", hint: dedicated ? "\u6B64\u534F\u8BAE\u4F7F\u7528\u64CD\u4F5C\u540D OCRNormal\u3002" : reusable(role) ? "\u53EF\u8F93\u5165\u6A21\u578B ID \u6216 ep \u90E8\u7F72\u63A5\u5165\u70B9 ID\u3002" : void 0 })
      ] }),
      modelPresets.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dkr-model-shortcuts", "aria-label": `${info.title}\u6A21\u578B\u5FEB\u6377\u9009\u62E9`, children: modelPresets.map((preset) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { type: "button", size: "sm", variant: "outline", disabled, onClick: () => {
        controller.edit(role, "model", preset.config.model);
        if (reusable(role) && preset.config.reasoningEffort !== void 0) controller.edit(role, "reasoningEffort", preset.config.reasoningEffort);
      }, children: preset.config.model }, preset.id)) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ValueField, { controller, state, role, field: "endpoint", label: dedicated || model.protocol === "vikingdb-rerank" ? "\u670D\u52A1 origin" : "API \u57FA\u7840\u5730\u5740", hint: model.protocol === "dashscope-rerank" ? "\u586B\u5199 https://\u5B9E\u9645\u4E1A\u52A1\u7A7A\u95F4ID.cn-beijing.maas.aliyuncs.com\uFF08\u5730\u57DF\u987B\u4E0E Key \u5339\u914D\uFF09\uFF0C\u4E0D\u542B /api/v1\uFF1B\u4F7F\u7528\u767E\u70BC API Key\u3002Qwen3-VL \u652F\u6301\u6587\u5B57\u6216\u56FE\u7247\u5019\u9009\uFF1B\u56FE\u7247\u9700\u672C\u6B21\u5355\u72EC\u6388\u6743\uFF0C\u6700\u591A 3 \u5F20\u5019\u9009\u9875\u3002\u8D85\u9884\u7B97\u56DE\u9000\u539F\u68C0\u7D22\uFF0C\u4E0D\u9759\u9ED8\u622A\u65AD\u3002" : dedicated || model.protocol === "vikingdb-rerank" ? "\u4EC5 HTTPS origin\uFF0C\u4E0D\u8981\u9644\u52A0\u8BF7\u6C42\u8DEF\u5F84\u3002" : model.protocol === "ark-multimodal" ? "\u8BF7\u6C42\u4F7F\u7528 /embeddings/multimodal\uFF0C\u4E0D\u4F7F\u7528\u666E\u901A /embeddings\u3002" : role === "rerank" ? "Cohere v2 \u57FA\u7840\u5730\u5740\u5E94\u4EE5 /v2 \u7ED3\u5C3E\u3002" : "\u8BF7\u8F93\u5165\u670D\u52A1\u5546 API \u57FA\u7840\u5730\u5740\u3002" }),
      reusable(role) && !dedicated && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SelectField, { id: `dkr-${role}-reasoningEffort`, label: "\u63A8\u7406\u5F3A\u5EA6", value: model.reasoningEffort, disabled, options: reasoningOptions, error: state.errors[`${role}.reasoningEffort`], onChange: (value) => controller.edit(role, "reasoningEffort", value) }),
      model.protocol === "ark-multimodal" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SelectField, { id: `dkr-${role}-dimensions`, label: "\u5411\u91CF\u7EF4\u5EA6", value: model.dimensions, disabled, options: [{ value: "1024", label: "1024" }, { value: "2048", label: "2048" }, ...!["1024", "2048"].includes(model.dimensions) ? [{ value: model.dimensions, label: "\u5F53\u524D\u7EF4\u5EA6\u4E0D\u53D7\u652F\u6301", disabled: true }] : []], error: state.errors[`${role}.dimensions`], onChange: (value) => controller.edit(role, "dimensions", value) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(InstructionField, { controller, state, role, field: "queryInstructions", label: "\u67E5\u8BE2\u5411\u91CF\u6307\u4EE4", hint: "\u975E\u7A7A\uFF0C\u6700\u591A 4000 \u5B57\u7B26\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(InstructionField, { controller, state, role, field: "documentInstructions", label: "\u6587\u6863\u5411\u91CF\u6307\u4EE4", hint: "\u975E\u7A7A\uFF0C\u6700\u591A 4000 \u5B57\u7B26\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dkr-hint", children: "\u4EC5\u4F7F\u7528\u5355\u4E00\u7A20\u5BC6\u5411\u91CF\uFF1B\u591A\u5411\u91CF\u4E0E\u7A00\u758F\u5411\u91CF\u56FA\u5B9A\u5173\u95ED\u3002" })
      ] }),
      model.protocol === "ark-multimodal" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ImageVectorFields, { role, model, controller, state }),
      dedicated && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ValueField, { controller, state, role, field: "region", label: "Region", hint: "\u6B64 OCR \u670D\u52A1\u8981\u6C42 cn-north-1\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dkr-hint", children: "PDF \u6309\u6240\u9009\u9875\u6E32\u67D3\u540E\u8BC6\u522B\u3002\u683C\u5F0F\u3001\u9875\u6570\u4E0E\u7F16\u7801\u540E\u8BF7\u6C42\u5927\u5C0F\u7531\u6838\u5FC3\u9A8C\u8BC1\uFF1B\u4E0D\u80FD\u4EC5\u51ED\u6E90\u56FE\u5927\u5C0F\u5224\u5B9A\u4E13\u7528 OCR \u53EF\u7528\u3002" })
      ] }),
      model.protocol === "vikingdb-rerank" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ValueField, { controller, state, role, field: "region", label: "Region", hint: "\u4F8B\u5982 cn-beijing\u3002" }),
        supportsInstruction ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(InstructionField, { controller, state, role, field: "instruction", label: "\u91CD\u6392\u6307\u4EE4", hint: "\u6700\u591A 1024 \u5B57\u7B26\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dkr-hint", children: "\u6B64\u6A21\u578B\u4E0D\u652F\u6301\u91CD\u6392\u6307\u4EE4\u3002" }),
          model.instruction && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { type: "button", size: "sm", variant: "outline", disabled, onClick: () => controller.edit(role, "instruction", ""), children: "\u6E05\u9664\u4E0D\u652F\u6301\u7684\u91CD\u6392\u6307\u4EE4" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dkr-hint", children: "\u6B64\u534F\u8BAE\u4F7F\u7528\u72EC\u7ACB Access Key / Secret Key\uFF0C\u7531\u77E5\u8BC6\u5E93\u6838\u5FC3\u7B7E\u540D\uFF1B\u4E0D\u4F7F\u7528 Ark API \u51ED\u636E\u3002" })
      ] }),
      routeChanged && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dkr-hint", role: "status", children: "\u8DEF\u7531\u5207\u6362\u4E0D\u4F1A\u7EE7\u627F\u65E7\u51ED\u636E\uFF0C\u8BF7\u4E3A\u5F53\u524D\u63A5\u53E3\u914D\u7F6E\u9002\u7528\u7684\u51ED\u636E\u3002" }),
      credentialsFor(model).map((field) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(CredentialField, { field, role, controller, state }, field))
    ] })
  ] });
}
function KnowledgeRagSettingsSection() {
  const [controller] = (0, import_react4.useState)(() => new RagSettingsController());
  const [state, setState] = (0, import_react4.useState)(() => controller.snapshot());
  (0, import_react4.useEffect)(() => {
    controller.activate();
    const unsubscribe = controller.subscribe(setState);
    controller.load();
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "dkr-section", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("style", { children: ragStyles }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { className: "dkr-title", children: "\u77E5\u8BC6\u5E93\u5904\u7406\u4E0E\u68C0\u7D22" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dkr-intro", children: "\u4E3A\u6587\u6863\u5904\u7406\u4E0E\u68C0\u7D22\u5206\u522B\u9009\u62E9\u670D\u52A1\u5546\u548C\u6A21\u578B\u3002\u914D\u7F6E\u53EA\u5728\u4FDD\u5B58\u65F6\u5199\u5165\uFF1B\u79BB\u5F00\u6B64\u9875\u4F1A\u4E22\u5F03\u672A\u4FDD\u5B58\u4FEE\u6539\u3002" }),
    state.error && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dkr-feedback", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dkr-error", children: state.error }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { size: "sm", variant: "outline", disabled: state.saving, onClick: controller.load, children: "\u91CD\u8BD5\u8BFB\u53D6" })
    ] }),
    state.saved && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dkr-saved", role: "status", children: "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u5E76\u8BFB\u56DE\u786E\u8BA4\u3002\u6A21\u578B\u6216\u5206\u5757\u53D8\u66F4\u540E\u9700\u8981\u91CD\u5EFA\u7D22\u5F15\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.SettingsForm, { labels: { ...labels, unavailable: state.phase === "error" ? "\u77E5\u8BC6\u5E93\u914D\u7F6E\u6682\u4E0D\u53EF\u7528\u3002" : labels.unavailable }, state: state.shell, onSave: controller.save, onDiscard: controller.discard, children: state.draft && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dkr-toggle", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u542F\u7528\u5DF2\u914D\u7F6E\u7684\u8FDC\u7A0B\u5904\u7406\u4E0E\u68C0\u7D22\u80FD\u529B" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Switch, { checked: state.draft.enabled, label: "\u542F\u7528\u5DF2\u914D\u7F6E\u7684\u8FDC\u7A0B\u5904\u7406\u4E0E\u68C0\u7D22\u80FD\u529B", disabled: state.saving || state.phase !== "ready", onChange: (value) => controller.edit(null, "enabled", value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dkr-hint", children: "\u6B64\u5F00\u5173\u63A7\u5236\u6587\u672C\u3001OCR\u3001\u89C6\u89C9\u3001\u5411\u91CF\u4E0E\u91CD\u6392\u7684\u8FDC\u7A0B\u5904\u7406\u3002\u672C\u5730\u89E3\u6790\u4E0E\u5173\u952E\u8BCD\u68C0\u7D22\u53EF\u72EC\u7ACB\u4F7F\u7528\u3002\u4FDD\u5B58\u8BBE\u7F6E\u4E0D\u4F1A\u53D1\u8D77\u670D\u52A1\u5546\u8BF7\u6C42\uFF1B\u6BCF\u6B21\u8FDC\u7A0B\u64CD\u4F5C\u4ECD\u9700\u660E\u786E\u6388\u6743\u8D44\u6599\u8303\u56F4\u3002\u5173\u95ED\u540E\u505C\u6B62\u540E\u7EED\u53D1\u9001\u5E76\u4E22\u5F03\u65E7\u7ED3\u679C\uFF0C\u5DF2\u53D1\u9001\u7684\u8BF7\u6C42\u65E0\u6CD5\u64A4\u56DE\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dkr-rows", children: ROLES.map((role) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(RoleCard, { role, controller, state }, role)) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "dkr-details", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: "\u5206\u5757\u8BBE\u7F6E" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dkr-grid", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ValueField, { controller, state, field: "chunkSize", label: "\u5206\u5757\u5B57\u7B26\u6570", hint: "200\u20134000 \u5B57\u7B26\u3002", numeric: true }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ValueField, { controller, state, field: "overlap", label: "\u91CD\u53E0\u5B57\u7B26\u6570", hint: "\u975E\u8D1F\uFF0C\u4E14\u5C0F\u4E8E\u5206\u5757\u5B57\u7B26\u6570\u7684\u4E00\u534A\u3002", numeric: true })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dkr-actions", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { type: "button", variant: "outline", size: "sm", disabled: state.saving || !state.shell.dirty, onClick: controller.discard, children: "\u53D6\u6D88\u4FEE\u6539" }) })
    ] }) }),
    state.phase === "ready" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(KnowledgeRagOperations, { settingsBusy: state.saving || state.shell.dirty, settingsVersion: controller.epoch })
  ] });
}

// client/knowledge.jsx
var import_react5 = __toESM(require("react"), 1);
var import_jsx_runtime4 = require("react/jsx-runtime");
function ViewButtons({ view, onChange }) {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { display: "inline-flex", gap: 3 }, children: [["list", "\u5217\u8868"], ["small", "\u5C0F\u56FE\u6807"], ["large", "\u5927\u56FE\u6807"]].map(([v, label]) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "dfm-location-row", style: { width: 32, padding: 6 }, title: label, "aria-label": label, "aria-pressed": view === v, "data-active": view === v, onClick: () => onChange(v), children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("svg", { width: "18", height: "18", viewBox: "0 0 18 18", fill: "none", stroke: "currentColor", strokeWidth: "1.3", children: v === "list" ? [4, 9, 14].map((y) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("path", { d: `M2 ${y}h2m3 0h9` }, y)) : (v === "small" ? [2, 7, 12] : [2, 10]).flatMap((y) => (v === "small" ? [2, 7, 12] : [2, 10]).map((x) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("rect", { x, y, width: v === "small" ? 3 : 6, height: v === "small" ? 3 : 6, rx: ".6" }, `${x}-${y}`))) }) }, v)) });
}
function KnowledgePanel({ api, view, writable, seed, onSeedUsed, streamUrl: streamUrl2, onOpenSettings, typeFilter = "all" }) {
  const [items, setItems] = (0, import_react5.useState)([]), [query, setQuery] = (0, import_react5.useState)(""), [next, setNext] = (0, import_react5.useState)(null), [total, setTotal] = (0, import_react5.useState)(0), [draft, setDraft] = (0, import_react5.useState)(null), [file, setFile] = (0, import_react5.useState)(null), [editing, setEditing] = (0, import_react5.useState)(false), [busy, setBusy] = (0, import_react5.useState)(false), [error, setError] = (0, import_react5.useState)(""), [revision2, setRevision] = (0, import_react5.useState)(0), [loadedKey, setLoadedKey] = (0, import_react5.useState)(null), [collection, setCollection] = (0, import_react5.useState)(""), [parent, setParent] = (0, import_react5.useState)(""), [collections, setCollections] = (0, import_react5.useState)([]), [trash, setTrash] = (0, import_react5.useState)(false), [importState, setImportState] = (0, import_react5.useState)(null), [history, setHistory] = (0, import_react5.useState)([]), [deletions, setDeletions] = (0, import_react5.useState)([]);
  const seq = (0, import_react5.useRef)(0), detailSeq = (0, import_react5.useRef)(0), listReady = (0, import_react5.useRef)(false), loadingMore = (0, import_react5.useRef)(false), importRef = (0, import_react5.useRef)(null), fileInput = (0, import_react5.useRef)(null), folderInput = (0, import_react5.useRef)(null);
  (0, import_react5.useEffect)(() => {
    let live = true;
    const n = ++seq.current;
    listReady.current = false;
    loadingMore.current = false;
    setNext(null);
    setItems([]);
    const timer = setTimeout(() => {
      api("knowledge/list", { params: { query, type: typeFilter, collectionId: collection, ...collection && typeFilter === "all" && !query && !trash ? { parent } : {}, trash } }).then((r) => {
        if (live && n === seq.current) {
          listReady.current = true;
          setLoadedKey(JSON.stringify([query, typeFilter, revision2, collection, parent, trash]));
          setItems(r.items);
          setNext(r.nextOffset);
          setTotal(r.total);
          setError("");
        }
      }).catch((e) => {
        if (live) setError(e.message);
      });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, revision2, typeFilter, collection, parent, trash]);
  (0, import_react5.useEffect)(() => () => importRef.current?.abort(), []);
  (0, import_react5.useEffect)(() => {
    api("knowledge/deletion-requests").then((r) => setDeletions(r.items || [])).catch(() => {
    });
    api("knowledge/collections").then((r) => setCollections(r.items || [])).catch(() => {
    });
  }, [revision2]);
  (0, import_react5.useEffect)(() => {
    if (seed) {
      if (seed.importDrop || seed.importPaths) {
        onSeedUsed();
        startImport(seed.importDrop || { paths: seed.importPaths });
        return;
      }
      if (busy) {
        setError("\u6B63\u5728\u4FDD\u5B58\uFF0C\u8BF7\u7A0D\u540E\u518D\u52A0\u5165\u6587\u4EF6");
        onSeedUsed();
        return;
      }
      detailSeq.current++;
      if (!editing || window.confirm("\u653E\u5F03\u5C1A\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\uFF0C\u52A0\u5165\u65B0\u7684\u6587\u4EF6\uFF1F")) {
        setDraft(seed);
        setFile(null);
        setEditing(true);
      }
      onSeedUsed();
    }
  }, [seed]);
  const allowLeave = () => !editing || window.confirm("\u653E\u5F03\u5C1A\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\uFF1F");
  async function open(id) {
    if (!allowLeave()) return;
    const n = ++detailSeq.current;
    setEditing(false);
    setDraft(null);
    setFile(null);
    try {
      const r = await api("knowledge/get", { params: { id } });
      if (n !== detailSeq.current) return;
      setDraft(r.entry);
      setFile(r.file);
      setHistory([]);
      setEditing(false);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  async function more() {
    if (loadedKey !== JSON.stringify([query, typeFilter, revision2, collection, parent, trash]) || !listReady.current || loadingMore.current || next === null) return;
    loadingMore.current = true;
    const n = seq.current;
    try {
      const r = await api("knowledge/list", { params: { query, offset: next, type: typeFilter, collectionId: collection, ...collection && typeFilter === "all" && !query && !trash ? { parent } : {}, trash } });
      if (n === seq.current) {
        setItems((old) => [...old, ...r.items.filter((i) => !old.some((o) => o.id === i.id))]);
        setNext(r.nextOffset);
      }
    } catch (e) {
      if (n === seq.current) setError(e.message);
    } finally {
      if (n === seq.current) loadingMore.current = false;
    }
  }
  async function save() {
    detailSeq.current++;
    setBusy(true);
    setError("");
    try {
      const r = await api("knowledge/save", { method: "POST", body: draft });
      const full = await api("knowledge/get", { params: { id: r.id } });
      setDraft(full.entry);
      setFile(full.file);
      setEditing(false);
      setRevision((x) => x + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm("\u79FB\u5165\u77E5\u8BC6\u5E93\u56DE\u6536\u7AD9\uFF0C\u53EF\u6062\u590D\uFF1B\u539F\u6587\u4EF6\u4E0D\u53D8\u3002\u7EE7\u7EED\uFF1F")) return;
    detailSeq.current++;
    setBusy(true);
    try {
      await api("knowledge/remove", { method: "POST", body: { id: draft.id, updatedAt: draft.updatedAt } });
      setDraft(null);
      setFile(null);
      setRevision((x) => x + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function pickFolder() {
    if (window.showDirectoryPicker) {
      try {
        const handle = await window.showDirectoryPicker({ mode: "read" });
        startImport({ handles: [handle] });
      } catch (e) {
        if (e.name !== "AbortError") setError(e.message);
      }
    } else {
      setError("\u6B64\u6D4F\u89C8\u5668\u7684\u6587\u4EF6\u5939\u9009\u62E9\u5668\u4E0D\u5305\u542B\u7A7A\u76EE\u5F55\uFF1B\u8BF7\u76F4\u63A5\u62D6\u5165\u6587\u4EF6\u5939\u4EE5\u4FDD\u7559\u7A7A\u76EE\u5F55\u3002");
      folderInput.current.click();
    }
  }
  async function startImport(input) {
    if (!writable || importRef.current || busy) return;
    if (!allowLeave()) return;
    const controller = new AbortController();
    importRef.current = controller;
    setImportState({ text: "\u51C6\u5907\u5BFC\u5165\u2026", results: [] });
    try {
      const results = await runImport(api, input, setImportState, controller.signal);
      setImportState({ text: controller.signal.aborted ? "\u5BFC\u5165\u5DF2\u505C\u6B62\uFF0C\u5DF2\u5BFC\u5165\u5185\u5BB9\u4FDD\u7559" : "\u5BFC\u5165\u5B8C\u6210", results, done: true });
      setRevision((x) => x + 1);
    } catch (e) {
      setImportState((old) => ({ ...old, text: e.message, done: true }));
      setRevision((x) => x + 1);
    } finally {
      importRef.current = null;
    }
  }
  async function restore(version) {
    setBusy(true);
    try {
      await api("knowledge/restore", { method: "POST", body: { id: draft.id, updatedAt: draft.updatedAt, version } });
      setDraft(null);
      setHistory([]);
      setRevision((x) => x + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function resolveDeletion(id, approve) {
    if (approve && !window.confirm("\u786E\u8BA4\u5C06\u7533\u8BF7\u4E2D\u7684\u6240\u6709\u6761\u76EE\u79FB\u5165\u77E5\u8BC6\u5E93\u56DE\u6536\u7AD9\uFF1F\u539F\u6587\u4EF6\u4FDD\u7559\u3002")) return;
    setBusy(true);
    try {
      const r = await api("knowledge/resolve-deletion", { method: "POST", body: { id, approve } });
      if (r.failures?.length) setError("\u90E8\u5206\u6761\u76EE\u5904\u7406\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u6838\u5BF9");
      setDraft(null);
      setRevision((x) => x + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function showHistory() {
    const id = draft.id, n = detailSeq.current;
    try {
      const r = await api("knowledge/history", { params: { id: draft.id } });
      if (n === detailSeq.current) setHistory(r.items || []);
    } catch (e) {
      setError(e.message);
    }
  }
  const field = (key, label, multi = false) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { style: { display: "grid", gap: 5, marginBottom: 12 }, children: [
    label,
    multi ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("textarea", { "aria-label": label, rows: 9, value: draft[key] || "", readOnly: !editing || busy, onChange: (e) => setDraft({ ...draft, [key]: e.target.value }) }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { "aria-label": label, value: draft[key] || "", readOnly: !editing || busy, onChange: (e) => setDraft({ ...draft, [key]: e.target.value }) })
  ] });
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dfm-kb", style: { display: "flex", flex: 1, minWidth: 0, minHeight: 0 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "dfm-main", onDragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }, onDrop: (e) => {
      e.preventDefault();
      if (writable) startImport(captureDrop(e.dataTransfer));
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dfm-toolbar", style: { flexWrap: "wrap" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("select", { "aria-label": "\u8D44\u6599\u96C6", value: collection, onChange: (e) => {
          setCollection(e.target.value);
          setParent("");
        }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "", children: "\u5168\u90E8\u8D44\u6599\u96C6" }),
          collections.map((c) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: c.id, children: c.name }, c.id))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: busy, onClick: () => {
          if (!allowLeave()) return;
          detailSeq.current++;
          setEditing(false);
          setTrash(!trash);
          setParent("");
          setDraft(null);
        }, children: trash ? "\u8FD4\u56DE\u77E5\u8BC6\u5E93" : "\u77E5\u8BC6\u5E93\u56DE\u6536\u7AD9" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: !writable || !!importRef.current, onClick: () => fileInput.current.click(), children: "\u5BFC\u5165\u6587\u4EF6" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: !writable || !!importRef.current, onClick: pickFolder, children: "\u5BFC\u5165\u6587\u4EF6\u5939" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { ref: fileInput, type: "file", multiple: true, hidden: true, onChange: (e) => {
          startImport({ files: [...e.target.files] });
          e.target.value = "";
        } }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { ref: folderInput, type: "file", multiple: true, webkitdirectory: "", hidden: true, onChange: (e) => {
          startImport({ files: [...e.target.files] });
          e.target.value = "";
        } }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { "aria-label": "\u641C\u7D22\u77E5\u8BC6\u5E93", placeholder: "\u641C\u7D22\u6807\u9898\u3001\u6B63\u6587\u3001\u6807\u7B7E", value: query, onChange: (e) => setQuery(e.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: !writable || busy, onClick: () => {
          if (allowLeave()) {
            detailSeq.current++;
            setDraft({ title: "", content: "", tags: [], category: "", sourceUrl: "", assetId: "" });
            setFile(null);
            setEditing(true);
          }
        }, children: "\u65B0\u5EFA\u77E5\u8BC6" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { onClick: () => setRevision((x) => x + 1), children: "\u5237\u65B0" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(KnowledgeRagEntry, { compact: true, onOpenSettings })
      ] }),
      deletions.map((d) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("details", { className: "dfm-notice", style: { display: "block" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("summary", { children: [
          "Agent \u8BF7\u6C42\u5220\u9664 ",
          d.items.length,
          " \u6761\u77E5\u8BC6\uFF0C\u7B49\u5F85\u4F60\u786E\u8BA4"
        ] }),
        d.items.map((i) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { children: i.title }, i.id)),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: !writable || busy, onClick: () => resolveDeletion(d.id, true), children: "\u786E\u8BA4\u79FB\u5165\u56DE\u6536\u7AD9" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: !writable || busy, onClick: () => resolveDeletion(d.id, false), children: "\u62D2\u7EDD" })
      ] }, d.id)),
      collection && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dfm-toolbar", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { onClick: () => setParent(""), children: "\u8D44\u6599\u96C6\u6839\u76EE\u5F55" }),
        parent.split("/").filter(Boolean).map((part, i, parts) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { onClick: () => setParent(parts.slice(0, i + 1).join("/")), children: part }, i))
      ] }),
      importState && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dfm-notice", style: { display: "block" }, role: "status", children: [
        importState.text,
        " \xB7 \u6210\u529F ",
        importState.results.filter((r) => r.ok && !r.duplicate).length,
        " \xB7 \u91CD\u590D ",
        importState.results.filter((r) => r.duplicate).length,
        " \xB7 \u5931\u8D25 ",
        importState.results.filter((r) => !r.ok).length,
        !importState.done && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { onClick: () => importRef.current?.abort(), children: "\u505C\u6B62\u540E\u7EED\u5BFC\u5165" }),
        importState.results.some((r) => !r.ok) && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("details", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("summary", { children: "\u5931\u8D25\u6E05\u5355" }),
          importState.results.filter((r) => !r.ok).map((r, i) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
            r.path,
            "\uFF1A",
            r.error
          ] }, i))
        ] })
      ] }),
      error && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dfm-notice", role: "alert", children: error }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: view === "list" ? "dfm-list" : "dfm-grid", "data-view": view, children: [
        !items.length && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dfm-empty", children: "\u5F53\u524D\u5206\u7C7B\u6682\u65E0\u5185\u5BB9\uFF0C\u53EF\u4ECE\u6587\u4EF6\u52A0\u5165\u6216\u65B0\u5EFA\u7B14\u8BB0" }),
        items.map((i) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { className: view === "list" ? "dfm-row" : "dfm-tile", title: i.title, "data-selected": draft?.id === i.id, style: { color: "inherit", border: 0, width: "100%" }, disabled: busy, onClick: () => {
          if (i.directory && !trash) {
            if (!allowLeave()) return;
            setCollection(i.collectionId);
            setParent(i.relativePath);
            setQuery("");
          } else open(i.id);
        }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(KnowledgeArtwork, { item: i, compact: view === "list" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dfm-kb-card-title", children: i.title }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(TypeBadge, { type: i.type || "note" }),
          i.tags?.length > 0 && view !== "list" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dfm-kb-tags", children: i.tags.slice(0, 2).map((tag) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: tag }, tag)) })
        ] }, i.id)),
        loadedKey === JSON.stringify([query, typeFilter, revision2, collection, parent, trash]) && next !== null && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { onClick: more, children: "\u52A0\u8F7D\u66F4\u591A" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dfm-status", children: [
        typeFilter === "all" ? "\u5168\u90E8\u77E5\u8BC6" : FILE_TYPES[typeFilter]?.label,
        " \xB7 ",
        total,
        " \u6761 \xB7 \u4E0E\u804A\u5929\u667A\u80FD\u4F53\u5171\u7528"
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("aside", { className: "dfm-preview", style: { padding: 16, overflow: "auto" }, children: draft ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dfm-preview-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: editing ? "\u7F16\u8F91\u77E5\u8BC6" : "\u77E5\u8BC6\u8BE6\u60C5" }),
        !editing && !draft.deletedAt && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: !writable || busy, onClick: () => {
          detailSeq.current++;
          setEditing(true);
        }, children: "\u7F16\u8F91" }),
        draft.id && !editing && !draft.deletedAt && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: !writable || busy, onClick: remove, children: "\u79FB\u5165\u56DE\u6536\u7AD9" })
      ] }),
      draft.deletedAt && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: !writable || busy, onClick: () => restore(), children: "\u6062\u590D\u77E5\u8BC6" }),
      draft.id && !editing && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: busy, onClick: showHistory, children: "\u4FEE\u6539\u5386\u53F2" }),
      history.map((h) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
        h.at,
        " \xB7 ",
        h.actor === "agent" ? "Agent" : "\u7528\u6237",
        " \xB7 ",
        h.action,
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: !writable || busy, onClick: () => restore(h.version), children: "\u6062\u590D\u6B64\u7248\u672C" })
      ] }, h.version)),
      draft.relativePath && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { style: { overflowWrap: "anywhere" }, children: [
        "\u8D44\u6599\u96C6\uFF1A",
        draft.collectionName,
        " / ",
        draft.relativePath
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { margin: "8px 0 16px" }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(TypeBadge, { type: draft.type || knowledgeType(draft) }) }),
      file && file.kind === "image" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("img", { alt: file.name, src: streamUrl2(file.path), style: { width: "100%", maxHeight: 280, objectFit: "contain", borderRadius: 8, marginBottom: 12 } }),
      file && file.kind === "video" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("video", { controls: true, preload: "metadata", src: streamUrl2(file.path), style: { width: "100%", maxHeight: 280, marginBottom: 12 } }),
      file && file.kind === "audio" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("audio", { controls: true, preload: "metadata", src: streamUrl2(file.path), style: { width: "100%", marginBottom: 12 } }),
      field("title", "\u6807\u9898"),
      field("content", "\u6B63\u6587", true),
      field("category", "\u4E3B\u9898\u5206\u7C7B"),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
        "\u6807\u7B7E\uFF08\u7528\u9017\u53F7\u5206\u9694\uFF09",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { "aria-label": "\u6807\u7B7E", readOnly: !editing || busy, value: (draft.tags || []).join(","), onChange: (e) => setDraft({ ...draft, tags: e.target.value.split(/[,，]/) }) })
      ] }),
      field("sourceUrl", "\u6765\u6E90\u7F51\u5740"),
      draft.assetId && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { style: { overflowWrap: "anywhere" }, children: [
        "\u5173\u8054\u7D20\u6750\uFF1A",
        draft.assetId
      ] }),
      draft.assetId?.startsWith("file:") && !file && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "\u6E90\u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u4E0D\u5728\u5141\u8BB8\u8BBF\u95EE\u8303\u56F4\u5185\uFF1B\u77E5\u8BC6\u6B63\u6587\u4ECD\u4FDD\u7559\u3002" }),
      file && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("a", { href: streamUrl2(file.path), target: "_blank", rel: "noreferrer", children: "\u6253\u5F00\u539F\u6587\u4EF6" }),
      draft.extractedText && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { style: { whiteSpace: "pre-wrap" }, children: [
        "\u63D0\u53D6\u6587\u672C\uFF1A",
        draft.extractedText
      ] }),
      (draft.inferredPrompt || draft.inferredModel) && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { children: [
        "\u63A8\u6D4B\u4FE1\u606F\uFF08\u672A\u7ECF\u8BC1\u5B9E\uFF09\uFF1A",
        draft.inferredModel,
        " ",
        draft.inferredPrompt
      ] }),
      editing && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", gap: 8, marginTop: 16 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: busy || !draft.title.trim() || !draft.content.trim(), onClick: save, children: busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { disabled: busy, onClick: async () => {
          const n = ++detailSeq.current;
          setEditing(false);
          if (draft.id) {
            try {
              const r = await api("knowledge/get", { params: { id: draft.id } });
              if (n === detailSeq.current) {
                setDraft(r.entry);
                setFile(r.file);
              }
            } catch (e) {
              setError(e.message);
            }
          } else setDraft(null);
        }, children: "\u53D6\u6D88" })
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dfm-empty", children: "\u9009\u62E9\u77E5\u8BC6\u67E5\u770B\u8BE6\u60C5" }) })
  ] });
}

// client/knowledge-rag-navigation.jsx
var import_react6 = require("react");
var RAG_SETTINGS_ID = "knowledge-rag";
function currentShell(slots) {
  const entry = slots.entriesOfSlot("sidebar.settings")[0];
  return entry?.store ? entry : void 0;
}
function canNavigate(slots, shell) {
  return !!shell && currentShell(slots) === shell && slots.entriesOfSlot("settings.section").some((entry) => entry.options.id === RAG_SETTINGS_ID);
}
function KnowledgeRagDeepLink({ actions, navigationIsCurrent, useSessions }) {
  const sessionsReady = useSessions?.((state) => state.phase === "ready") ?? false;
  (0, import_react6.useEffect)(() => {
    if (!sessionsReady) return;
    let firstFrame, secondFrame, stopped = false;
    const requested = () => new URL(window.location.href).searchParams.get("settings") === RAG_SETTINGS_ID;
    if (!requested() || !navigationIsCurrent?.() || typeof actions?.openSection !== "function") return;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (!stopped && requested() && navigationIsCurrent?.()) actions.openSection(RAG_SETTINGS_ID);
      });
    });
    return () => {
      stopped = true;
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== void 0) window.cancelAnimationFrame(secondFrame);
    };
  }, [actions, navigationIsCurrent, sessionsReady]);
  return null;
}
function confirmKnowledgeRagSection(Section) {
  return function ConfirmedKnowledgeRagSection(props) {
    (0, import_react6.useEffect)(() => {
      const url = new URL(window.location.href);
      if (url.searchParams.get("settings") !== RAG_SETTINGS_ID) return;
      url.searchParams.delete("settings");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }, []);
    return (0, import_react6.createElement)(Section, props);
  };
}
function registerKnowledgeSettingsNavigation(ctx, FilemanPanel2, panelId) {
  const register = (name, options, Component, allowWithoutShell = false) => ctx.slots.inject(name, () => {
    let shell, section, disposeEntry, stopped = false;
    const sync = () => {
      if (stopped) return;
      const next = currentShell(ctx.slots);
      const nextSection = ctx.slots.entriesOfSlot("settings.section").find((entry) => entry.options.id === RAG_SETTINGS_ID);
      if (next === shell && nextSection === section && disposeEntry) return;
      disposeEntry?.();
      disposeEntry = void 0;
      shell = next;
      section = nextSection;
      if (!shell && !allowWithoutShell) return;
      const captured = shell;
      disposeEntry = ctx.slots.register({
        name,
        ...options,
        ...captured ? { store: captured.store } : {},
        inject: () => ({ navigationIsCurrent: () => canNavigate(ctx.slots, captured) })
      }, Component);
    };
    const offShell = ctx.slots.subscribe("sidebar.settings", sync);
    const offSection = ctx.slots.subscribe("settings.section", sync);
    sync();
    return () => {
      stopped = true;
      offShell();
      offSection();
      disposeEntry?.();
    };
  });
  register("main", { key: panelId }, FilemanPanel2, true);
  register("sidebar.footer.action", { id: "knowledge-rag-deep-link", order: 100 }, KnowledgeRagDeepLink);
}

// client/launchpad-bridge.js
function registerLaunchpadApp(ctx, descriptor, label = "launchpad-app") {
  ctx.inject(["dshLaunchpad"], (scope) => scope.effect(
    () => scope.get("dshLaunchpad").registerApp(descriptor),
    `dsh-launchpad: ${label}`
  ));
}

// client/main.jsx
var import_react7 = require("react");
var import_react_dom = require("react-dom");

// client/media.js
var IMAGE_EXTENSIONS = /* @__PURE__ */ new Set([
  "png",
  "jpg",
  "jpeg",
  "jpe",
  "gif",
  "webp",
  "avif",
  "apng",
  "bmp",
  "ico",
  "svg",
  "tif",
  "tiff",
  "heic",
  "heif"
]);
var VIDEO_EXTENSIONS = /* @__PURE__ */ new Set([
  "mp4",
  "m4v",
  "webm",
  "ogv",
  "mov",
  "mkv",
  "avi",
  "mpg",
  "mpeg",
  "3gp",
  "m2ts"
]);
var AUDIO_EXTENSIONS = /* @__PURE__ */ new Set([
  "mp3",
  "m4a",
  "aac",
  "wav",
  "wave",
  "flac",
  "ogg",
  "oga",
  "opus",
  "weba",
  "aif",
  "aiff",
  "wma",
  "mid",
  "midi"
]);
function extensionOf(name) {
  if (typeof name !== "string") return "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}
function kindFromName(name) {
  const extension = extensionOf(name);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return "file";
}
function mediaKindOf(entry) {
  if (entry === null || typeof entry !== "object") return "file";
  if (entry.dir === true) return "dir";
  if (typeof entry.kind === "string" && entry.kind.length > 0) return entry.kind;
  return kindFromName(entry.name);
}
function isPlayableKind(kind) {
  return kind === "video" || kind === "audio";
}
function isViewerKind(kind) {
  return kind === "image" || kind === "video" || kind === "audio";
}
function isThumbnailableKind(kind) {
  return kind === "image" || kind === "video";
}
function viewerItemsOf(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => isViewerKind(mediaKindOf(entry)));
}
function formatClock(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "\u2014";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const remainder = total % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(remainder)}` : `${minutes}:${pad(remainder)}`;
}

// client/main.jsx
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime5 = require("react/jsx-runtime");
var API = "/dsh-fileman";
var PANEL_ID = "fileman";
var zh = {
  panel: "\u6587\u4EF6\u7BA1\u7406\u5668",
  locations: "\u4F4D\u7F6E",
  home: "\u4E3B\u76EE\u5F55",
  desktop: "\u684C\u9762",
  document: "\u6587\u6863",
  download: "\u4E0B\u8F7D",
  picture: "\u56FE\u7247",
  music: "\u97F3\u4E50",
  video: "\u5F71\u7247",
  public: "\u516C\u5171",
  root: "\u6839\u76EE\u5F55",
  empty: "\u6B64\u6587\u4EF6\u5939\u4E3A\u7A7A",
  loading: "\u6B63\u5728\u8BFB\u53D6\u2026",
  failed: "\u8BFB\u53D6\u5931\u8D25",
  name: "\u540D\u79F0",
  size: "\u5927\u5C0F",
  sizeCalculating: "\u8BA1\u7B97\u4E2D\u2026",
  sizeNotCalculated: "\u672A\u8BA1\u7B97",
  sizePartial: "\u672A\u5B8C\u6210",
  calculateSize: "\u8BA1\u7B97\u5927\u5C0F",
  sizeNote: "\u6587\u4EF6\u5185\u5BB9\u5927\u5C0F\u5408\u8BA1\uFF1B\u542B\u9690\u85CF\u6587\u4EF6\uFF0C\u4E0D\u8DDF\u968F\u7B26\u53F7\u94FE\u63A5\u3002\u7ED3\u679C\u4E3A\u672C\u6B21\u5FEB\u7167\uFF0C\u5237\u65B0\u540E\u9700\u91CD\u7B97\u3002",
  modified: "\u4FEE\u6539\u65E5\u671F",
  items: "\u9879",
  selected: "\u9009\u4E2D",
  search: "\u641C\u7D22",
  newFolder: "\u65B0\u5EFA\u6587\u4EF6\u5939",
  rename: "\u91CD\u547D\u540D",
  getInfo: "\u663E\u793A\u7B80\u4ECB",
  fullPath: "\u4F4D\u7F6E",
  permissions: "\u6743\u9650\uFF08\u516B\u8FDB\u5236\uFF09",
  symbolicLink: "\u7B26\u53F7\u94FE\u63A5",
  infoSnapshot: "\u4FE1\u606F\u6765\u81EA\u5F53\u524D\u76EE\u5F55\u5FEB\u7167\uFF1B\u6587\u4EF6\u5939\u5927\u5C0F\u4E3A\u6587\u4EF6\u5185\u5BB9\u5408\u8BA1\u3002",
  remove: "\u79FB\u5230\u5E9F\u7EB8\u7BD3",
  trash: "\u5E9F\u7EB8\u7BD3",
  emptyTrash: "\u6E05\u7A7A\u5E9F\u7EB8\u7BD3",
  restore: "\u653E\u56DE\u539F\u5904",
  purge: "\u5F7B\u5E95\u5220\u9664",
  downloadAction: "\u4E0B\u8F7D",
  preview: "\u9884\u89C8",
  edit: "\u7F16\u8F91",
  save: "\u4FDD\u5B58",
  cancel: "\u53D6\u6D88",
  create: "\u521B\u5EFA",
  confirm: "\u786E\u5B9A",
  parent: "\u4E0A\u7EA7",
  back: "\u540E\u9000",
  forward: "\u524D\u8FDB",
  refresh: "\u5237\u65B0",
  listView: "\u5217\u8868\u89C6\u56FE",
  iconView: "\u56FE\u6807\u89C6\u56FE",
  showHidden: "\u663E\u793A\u9690\u85CF\u9879\u76EE",
  hidePreview: "\u9690\u85CF\u9884\u89C8",
  showPreview: "\u663E\u793A\u9884\u89C8",
  open: "\u6253\u5F00",
  revealPath: "\u6240\u5728\u4F4D\u7F6E",
  copied: "\u5DF2\u590D\u5236",
  moved: "\u5DF2\u79FB\u52A8",
  trashed: "\u5DF2\u79FB\u5165\u5E9F\u7EB8\u7BD3",
  deleted: "\u5DF2\u5220\u9664",
  restored: "\u5DF2\u653E\u56DE\u539F\u5904",
  purged: "\u5DF2\u5F7B\u5E95\u5220\u9664",
  emptied: "\u5E9F\u7EB8\u7BD3\u5DF2\u6E05\u7A7A",
  saved: "\u5DF2\u4FDD\u5B58",
  noPreview: "\u8BE5\u7C7B\u578B\u4E0D\u652F\u6301\u9884\u89C8",
  readOnly: "\u53EA\u8BFB\u6A21\u5F0F",
  confirmTitle: "\u786E\u5B9A\u8981\u5220\u9664\u5417\uFF1F",
  confirmBody: "\u5220\u9664\u540E\u5C06\u79FB\u5165\u670D\u52A1\u5668\u5E9F\u7EB8\u7BD3\uFF0C\u53EF\u4ECE\u5E9F\u7EB8\u7BD3\u6062\u590D\u3002",
  restoreTitle: "\u8981\u653E\u56DE\u539F\u5904\u5417\uFF1F",
  restoreBody: "\u8FD9\u4E9B\u9879\u76EE\u5C06\u56DE\u5230\u5220\u9664\u524D\u6240\u5728\u7684\u4F4D\u7F6E\u3002",
  purgeTitle: "\u8981\u5F7B\u5E95\u5220\u9664\u5417\uFF1F",
  purgeBody: "\u8FD9\u4E9B\u9879\u76EE\u5C06\u88AB\u6C38\u4E45\u5220\u9664\uFF0C\u4E4B\u540E\u65E0\u6CD5\u6062\u590D\u3002",
  emptyTrashTitle: "\u8981\u6E05\u7A7A\u5E9F\u7EB8\u7BD3\u5417\uFF1F",
  emptyTrashBody: "\u5E9F\u7EB8\u7BD3\u4E2D\u7684\u6240\u6709\u9879\u76EE\u90FD\u5C06\u88AB\u6C38\u4E45\u5220\u9664\uFF0C\u6B64\u64CD\u4F5C\u65E0\u6CD5\u64A4\u9500\u3002",
  folderName: "\u6587\u4EF6\u5939\u540D\u79F0",
  newName: "\u65B0\u540D\u79F0",
  unsaved: "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539",
  copy: "\u590D\u5236",
  cut: "\u526A\u5207",
  paste: "\u7C98\u8D34",
  destination: "\u76EE\u6807\u6587\u4EF6\u5939",
  chooseDestination: "\u9009\u62E9\u6B64\u6587\u4EF6\u5939",
  clipboardReady: "\u5DF2\u653E\u5165\u6587\u4EF6\u526A\u8D34\u677F",
  copyAction: "\u62F7\u8D1D\u5230\u2026",
  moveAction: "\u79FB\u52A8\u5230\u2026",
  selectHere: "\u62F7\u8D1D/\u79FB\u52A8\u5230\u5F53\u524D\u6587\u4EF6\u5939",
  errorTitle: "\u64CD\u4F5C\u5931\u8D25",
  originalPath: "\u539F\u4F4D\u7F6E",
  deletedAt: "\u5220\u9664\u65F6\u95F4",
  trashNote: "\u5E9F\u7EB8\u7BD3\u4E2D\u4E0D\u80FD\u65B0\u5EFA\u9879\u76EE",
  viewer: "\u5A92\u4F53\u67E5\u770B\u5668",
  play: "\u64AD\u653E",
  mediaPreview: "\u5A92\u4F53\u9884\u89C8",
  openInTab: "\u5728\u65B0\u6807\u7B7E\u9875\u6253\u5F00",
  previous: "\u4E0A\u4E00\u4E2A",
  next: "\u4E0B\u4E00\u4E2A",
  close: "\u5173\u95ED",
  fitMode: "\u9002\u5E94\u7A97\u53E3",
  actualMode: "\u5B9E\u9645\u5927\u5C0F",
  mediaLoading: "\u6B63\u5728\u52A0\u8F7D\u5A92\u4F53\u2026",
  mediaUnsupported: "\u6D4F\u89C8\u5668\u65E0\u6CD5\u64AD\u653E\u6B64\u683C\u5F0F\uFF0C\u53EF\u4E0B\u8F7D\u540E\u7528\u672C\u5730\u64AD\u653E\u5668\u6253\u5F00",
  mediaBroken: "\u5A92\u4F53\u52A0\u8F7D\u5931\u8D25",
  showThumbnails: "\u663E\u793A\u7F29\u7565\u56FE",
  info: "\u7B80\u4ECB",
  dimensions: "\u5C3A\u5BF8",
  duration: "\u65F6\u957F",
  kindLabel: "\u79CD\u7C7B",
  where: "\u4F4D\u7F6E",
  audioTrack: "\u97F3\u9891",
  kindDir: "\u6587\u4EF6\u5939",
  kindImage: "\u56FE\u7247",
  kindVideo: "\u89C6\u9891",
  kindAudio: "\u97F3\u9891",
  kindPdf: "PDF \u6587\u6863",
  kindText: "\u6587\u672C",
  kindFile: "\u6587\u4EF6"
};
var en = {
  panel: "File Manager",
  locations: "Locations",
  home: "Home",
  desktop: "Desktop",
  document: "Documents",
  download: "Downloads",
  picture: "Pictures",
  music: "Music",
  video: "Movies",
  public: "Public",
  root: "Root",
  empty: "This folder is empty",
  loading: "Reading\u2026",
  failed: "Could not read",
  name: "Name",
  size: "Size",
  sizeCalculating: "Calculating\u2026",
  sizeNotCalculated: "Not calculated",
  sizePartial: "Partial",
  calculateSize: "Calculate size",
  sizeNote: "Total file bytes, including hidden files; symlinks excluded. Snapshot only; refresh to recalculate.",
  modified: "Date Modified",
  items: "items",
  selected: "selected",
  search: "Search",
  newFolder: "New Folder",
  rename: "Rename",
  getInfo: "Get Info",
  fullPath: "Location",
  permissions: "Permissions (octal)",
  symbolicLink: "Symbolic link",
  infoSnapshot: "Information from the current directory snapshot; folder size totals file contents.",
  remove: "Move to Trash",
  trash: "Trash",
  emptyTrash: "Empty Trash",
  restore: "Put Back",
  purge: "Delete Permanently",
  downloadAction: "Download",
  preview: "Preview",
  edit: "Edit",
  save: "Save",
  cancel: "Cancel",
  create: "Create",
  confirm: "OK",
  parent: "Enclosing Folder",
  back: "Back",
  forward: "Forward",
  refresh: "Refresh",
  listView: "List View",
  iconView: "Icon View",
  showHidden: "Show Hidden Items",
  hidePreview: "Hide Preview",
  showPreview: "Show Preview",
  open: "Open",
  revealPath: "Reveal in Path",
  copied: "Copied",
  moved: "Moved",
  trashed: "Moved to Trash",
  deleted: "Deleted",
  restored: "Put Back",
  purged: "Deleted Permanently",
  emptied: "Trash Emptied",
  saved: "Saved",
  noPreview: "No preview for this type",
  readOnly: "Read-only",
  confirmTitle: "Delete these items?",
  confirmBody: "They move to the server trash and can be restored from it.",
  restoreTitle: "Put these items back?",
  restoreBody: "They return to the location they were deleted from.",
  purgeTitle: "Delete permanently?",
  purgeBody: "These items will be gone for good and cannot be recovered.",
  emptyTrashTitle: "Empty the Trash?",
  emptyTrashBody: "Everything in the Trash is permanently deleted. This cannot be undone.",
  folderName: "Folder name",
  newName: "New name",
  unsaved: "Unsaved changes",
  copy: "Copy",
  cut: "Cut",
  paste: "Paste",
  destination: "Destination folder",
  chooseDestination: "Choose this folder",
  clipboardReady: "Added to file clipboard",
  copyAction: "Copy to\u2026",
  moveAction: "Move to\u2026",
  selectHere: "Copy/Move into the current folder",
  errorTitle: "Action failed",
  originalPath: "Original Location",
  deletedAt: "Date Deleted",
  trashNote: "Cannot create items in the Trash",
  viewer: "Media Viewer",
  play: "Play",
  mediaPreview: "Media Preview",
  openInTab: "Open in New Tab",
  previous: "Previous",
  next: "Next",
  close: "Close",
  fitMode: "Fit",
  actualMode: "Actual Size",
  mediaLoading: "Loading media\u2026",
  mediaUnsupported: "This format cannot play in the browser. Download it and open it locally.",
  mediaBroken: "Could not load media",
  showThumbnails: "Show Thumbnails",
  info: "Info",
  dimensions: "Dimensions",
  duration: "Duration",
  kindLabel: "Kind",
  where: "Where",
  audioTrack: "Audio",
  kindDir: "Folder",
  kindImage: "Image",
  kindVideo: "Video",
  kindAudio: "Audio",
  kindPdf: "PDF Document",
  kindText: "Text",
  kindFile: "Document"
};
var LOCATION_PRESENTATION = {
  home: { icon: import_dsh_client_ui_primitives3.IconFolderOpenRegular, key: "home" },
  desktop: { icon: import_dsh_client_ui_primitives3.IconFolderOpenOutlineRegular, key: "desktop" },
  document: { icon: import_dsh_client_ui_primitives3.IconFolderOpenOutlineRegular, key: "document" },
  download: { icon: import_dsh_client_ui_primitives3.IconFolderOpenOutlineRegular, key: "download" },
  picture: { icon: import_dsh_client_ui_primitives3.IconFolderOpenOutlineRegular, key: "picture" },
  music: { icon: import_dsh_client_ui_primitives3.IconFolderOpenOutlineRegular, key: "music" },
  video: { icon: import_dsh_client_ui_primitives3.IconFolderOpenOutlineRegular, key: "video" },
  public: { icon: import_dsh_client_ui_primitives3.IconFolderOpenOutlineRegular, key: "public" },
  trash: { icon: import_dsh_client_ui_primitives3.IconTrashOutlineRegular, key: "trash" },
  root: { icon: import_dsh_client_ui_primitives3.IconFolderOpenOutlineRegular, key: "root" }
};
var STYLE_ID = "dsh-fileman-styles";
var CSS = `
.dfm-root {
  position:relative;
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  font-size: 13px; color: inherit;
}
.dfm-toolbar {
  display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  flex: none;
}
.dfm-body { display: flex; flex: 1; min-height: 0; }
.dfm-locations {
  width: 178px; flex: none; overflow: auto; padding: 8px 6px;
  border-right: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}
.dfm-locations-title {
  font-size: 11px; font-weight: 600; opacity: .55; padding: 4px 8px 6px;
  text-transform: none; letter-spacing: .02em;
}
button.dfm-locations-title {
  display: flex; align-items: center; gap: 5px; width: 100%;
  border: 0; background: transparent; color: inherit; font: inherit;
  cursor: pointer; text-align: left;
}
button.dfm-locations-title:hover { background: color-mix(in srgb, currentColor 8%, transparent); opacity: .85; }
.dfm-locations-chevron { flex: none; transition: transform .15s ease; }
.dfm-locations-toggle[aria-expanded='true'] .dfm-locations-chevron { transform: rotate(90deg); }
.dfm-location-row {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 5px 8px; border: 0; border-radius: 6px; background: transparent;
  color: inherit; font: inherit; text-align: left; cursor: default;
}
.dfm-location-row:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.dfm-location-row[data-active='true'] {
  background: color-mix(in srgb, currentColor 14%, transparent); font-weight: 600;
}
.dfm-location-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dfm-main { display: flex; flex: 1; min-width: 0; flex-direction: column; }
.dfm-breadcrumb {
  display: flex; align-items: center; gap: 2px; flex: 1; min-width: 0;
  overflow: hidden; white-space: nowrap;
}
.dfm-crumb {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 6px;
  border: 0; border-radius: 6px; background: transparent; color: inherit;
  font: inherit; cursor: default; max-width: 220px;
}
.dfm-crumb:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.dfm-crumb-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dfm-crumb-static {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 6px;
  font-weight: 600; max-width: 220px;
}
.dfm-list { flex: 1; overflow: auto; min-height: 0; padding-bottom: 8px; }
.dfm-head {
  display: flex; align-items: center; gap: 10px; padding: 6px 14px;
  position: sticky; top: 0; z-index: 2; backdrop-filter: blur(8px);
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  background: color-mix(in srgb, currentColor 3%, transparent);
  font-size: 11px; font-weight: 600; opacity: .8;
}
.dfm-head-cell {
  border: 0; background: transparent; color: inherit; font: inherit; font-weight: 600;
  cursor: default; display: inline-flex; align-items: center; gap: 3px; padding: 2px 4px;
  border-radius: 5px;
}
.dfm-head-cell:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.dfm-row {
  height:30px; box-sizing:border-box;
  display: flex; align-items: center; gap: 10px; padding: 4px 14px;
  cursor: default; user-select: none;
}
.dfm-row:hover { background: color-mix(in srgb, currentColor 6%, transparent); }
.dfm-row[data-selected='true'] { background: color-mix(in srgb, currentColor 15%, transparent); }
.dfm-row[data-selected='true'] .dfm-name { font-weight: 600; }
.dfm-name { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
.dfm-name-text {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dfm-dim { flex: none; opacity: .62; font-variant-numeric: tabular-nums; }
.dfm-size { width: 92px; text-align: right; }
.dfm-date { width: 148px; text-align: right; }
.dfm-grid {
  flex: 1; overflow: auto; min-height: 0; padding: 12px;
  display: grid; gap: 6px; align-content: start;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
}
.dfm-grid[data-view='large'] {grid-template-columns:repeat(auto-fill,minmax(172px,1fr));gap:12px;}
.dfm-grid[data-view='large'] .dfm-thumb-box {width:128px;height:128px;}
.dfm-grid[data-view='small'] {grid-template-columns:repeat(auto-fill,minmax(120px,1fr));}
.dfm-kb input,.dfm-kb textarea {box-sizing:border-box;width:100%;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:6px;background:transparent;color:inherit;padding:8px;font:inherit;}
.dfm-kb button {font:inherit;color:inherit;cursor:pointer;}
.dfm-kb .dfm-toolbar button,.dfm-kb .dfm-preview button {border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:6px;background:color-mix(in srgb,currentColor 4%,transparent);padding:5px 9px;white-space:nowrap;}
.dfm-kb button:disabled {opacity:.45;cursor:default;}
.dfm-kb .dfm-preview-head {gap:8px;margin-bottom:12px;}
.dfm-kb input:read-only,.dfm-kb textarea:read-only {border-color:transparent;padding-left:0;}
.dfm-kb label {font-size:13px;}
.dfm-kb .dfm-row {gap:10px;height:36px;}
.dfm-kb .dfm-toolbar input {min-width:80px;flex:1;}
.dfm-tile {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 10px 6px 8px; border-radius: 8px; cursor: default; user-select: none;
  border: 0; background: transparent; color: inherit; font: inherit;
  text-align: center; overflow: hidden;
}
.dfm-file-art {position:relative;display:flex;justify-content:center;width:100%;flex:none;}
.dfm-type-badge {font-size:10px;line-height:1.6;padding:0 5px;border-radius:5px;white-space:nowrap;color:var(--type-color);background:color-mix(in srgb,var(--type-color) 12%,var(--dsw-alias-bg-base,white));border:1px solid color-mix(in srgb,var(--type-color) 25%,transparent);}
.dfm-file-art>.dfm-type-badge {position:absolute;right:1px;top:0;}
.dfm-kb-art {display:flex;align-items:center;justify-content:center;width:100%;height:56px;flex:none;overflow:hidden;border-radius:8px;background:color-mix(in srgb,currentColor 3%,transparent);}
.dfm-kb-art img {width:100%;height:100%;object-fit:contain;}
.dfm-kb-mini {display:flex;align-items:center;justify-content:center;width:34px;height:34px;flex:none;overflow:hidden;border-radius:4px;}
.dfm-kb-mini img {width:100%;height:100%;object-fit:cover;}
.dfm-kb .dfm-grid[data-view='large'] .dfm-kb-art {height:96px;}
.dfm-kb .dfm-tile {gap:7px;align-items:stretch;overflow:visible;}
.dfm-kb .dfm-kb-card-title {font-size:11.5px;line-height:1.35;text-align:center;display:block;height:2.7em;overflow:hidden;overflow-wrap:anywhere;}
.dfm-kb .dfm-row .dfm-kb-card-title {text-align:left;flex:1;white-space:nowrap;display:block;height:auto;align-self:center;text-overflow:ellipsis;}
.dfm-kb .dfm-tile {position:relative;}
.dfm-kb .dfm-tile>.dfm-type-badge {position:absolute;top:8px;right:8px;}
.dfm-kb-tags {display:flex;gap:4px;flex-wrap:wrap;font-size:10px;opacity:.7;}
.dfm-kb-tags span {border-radius:4px;background:color-mix(in srgb,currentColor 7%,transparent);padding:1px 4px;}
.dfm-knowledge-type {padding-left:14px;}
.dfm-tile:hover { background: color-mix(in srgb, currentColor 6%, transparent); }
.dfm-tile[data-selected='true'] { background: color-mix(in srgb, currentColor 15%, transparent); }
.dfm-tile-label {
  width: 100%; font-size: 11.5px; line-height: 1.35; max-height: 2.5em;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-all;
}
.dfm-preview {
  width: 340px; flex: none; display: flex; flex-direction: column; min-height: 0;
  border-left: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}
.dfm-preview-head {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}
.dfm-preview-body { flex: 1; min-height: 0; overflow: auto; padding: 12px; }
.dfm-pre {
  margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
}
.dfm-editor {
  width: 100%; min-height: 100%; box-sizing: border-box; resize: none;
  border: 0; outline: none; background: transparent; color: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; line-height: 1.55;
}
/* \u2500\u2500 \u5A92\u4F53\uFF1A\u9762\u677F\u5185\u9884\u89C8 \u2500\u2500 */
.dfm-stage { display: flex; flex-direction: column; gap: 10px; }
.dfm-stage-media {
  display: block; width: 100%; border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-base, rgba(127, 127, 127, .08));
}
.dfm-stage-image { max-height: 300px; object-fit: contain; cursor: zoom-in; }
.dfm-stage-video { max-height: 320px; }
.dfm-stage-frame {
  width: 100%; height: 440px; border: 0; border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-base, rgba(127, 127, 127, .08));
}
.dfm-audio-card {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 22px 14px; border-radius: var(--dsw-radius-lg, 12px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, .2));
  background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, .05));
}
.dfm-audio-card audio { width: 100%; }
.dfm-audio-name {
  font-size: 12px; max-width: 100%; text-align: center;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dfm-broken {
  padding: 18px 12px; border-radius: var(--dsw-radius-md, 8px); font-size: 12px;
  text-align: center; line-height: 1.7; opacity: .78;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(127, 127, 127, .3));
}
/* \u8BBF\u8FBE\u5F0F\u300C\u7B80\u4ECB\u300D */
.dfm-info {
  margin-top: 14px; padding-top: 10px; display: grid;
  grid-template-columns: auto minmax(0, 1fr); gap: 5px 12px; font-size: 11px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, .16));
}
.dfm-info-key { color: var(--dsw-alias-label-tertiary, currentColor); white-space: nowrap; }
.dfm-info-val { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* \u7F29\u7565\u56FE\uFF08\u56FE\u6807\u89C6\u56FE\u7528\u539F\u56FE\uFF0C\u5217\u8868\u89C6\u56FE\u4E0D\u7528\uFF09 */
.dfm-thumb-box {
  position: relative; width: 80px; height: 80px; flex: none;
  display: grid; place-items: center; overflow: hidden;
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-base, rgba(127, 127, 127, .07));
}
.dfm-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
/* \u7C7B\u9009\u62E9\u5668\u7684 display \u4F1A\u76D6\u6389 [hidden] \u7684 display:none\uFF0C\u8FD9\u91CC\u8865\u56DE\u6765 */
.dfm-thumb[hidden] { display: none; }
.dfm-thumb-fallback { position: absolute; inset: 0; display: grid; place-items: center; }
/* \u2500\u2500 \u5A92\u4F53\u67E5\u770B\u5668\uFF1A\u540C\u4E00\u76EE\u5F55\u5185\u8FDE\u7EED\u6D4F\u89C8 \u2500\u2500 */
.dfm-viewer { position: fixed; inset: 0; z-index: 90; display: flex; flex-direction: column; }
.dfm-viewer-mask {
  position: absolute; inset: 0;
  /* \u4E0D\u7528 --dsw-alias-bg-mask-1\uFF1A\u672C\u7248\u672C\u5B83\u53EA\u6709 24% \u9ED1\u3001\u4E14 --dsw-mask-blur \u662F none\uFF0C
     \u5E95\u4E0B\u7684\u5E94\u7528\u754C\u9762\u51E0\u4E4E\u539F\u6837\u900F\u51FA\u6765\uFF0C\u6807\u9898\u4F1A\u548C\u4FA7\u8FB9\u680F Logo \u649E\u5728\u4E00\u8D77\u3002\u8FD9\u91CC\u6309\u4E3B\u9898\u5E95\u8272
     \u505A\u4E00\u5C42\u9AD8\u4E0D\u900F\u660E\u5EA6\u7684\u5B9E\u906E\u7F69\uFF0C\u6D45\u8272\u4E3B\u9898\u662F\u4E73\u767D\u3001\u6DF1\u8272\u4E3B\u9898\u662F\u6DF1\u7070\uFF0C\u4E24\u79CD\u90FD\u538B\u5F97\u4F4F\u3002 */
  background: color-mix(in srgb, var(--dsw-alias-bg-base, #ffffff) 84%, transparent);
}
.dfm-viewer-bar {
  position: relative; z-index: 1; display: flex; align-items: center; gap: 10px;
  padding: 14px 18px; color: var(--dsw-alias-label-primary, inherit);
}
.dfm-viewer-title {
  font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dfm-viewer-counter { opacity: .7; font-variant-numeric: tabular-nums; flex: none; }
.dfm-viewer-tools { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; flex: none; }
.dfm-viewer-stage {
  position: relative; z-index: 1; flex: 1; min-height: 0;
  display: flex; align-items: center; justify-content: center; padding: 0 18px 18px;
}
.dfm-viewer-stage[data-actual='true'] {
  overflow: auto; align-items: flex-start; justify-content: safe center;
}
.dfm-viewer-media {
  max-width: min(100%, 1600px); max-height: 100%; object-fit: contain;
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-alias-bg-base, rgba(127, 127, 127, .18));
  box-shadow: var(--dsw-elevation-prominent, 0 12px 40px rgba(0, 0, 0, .28));
}
.dfm-viewer-media[data-actual='true'] {
  max-width: none; max-height: none; object-fit: none; cursor: zoom-out;
}
.dfm-viewer-audio {
  position: relative; z-index: 1; display: flex; flex-direction: column;
  align-items: center; gap: 20px; padding: 32px 24px; margin: 0 18px;
  min-width: min(520px, 88vw);
  border-radius: var(--dsw-radius-lg, 12px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, .2));
  background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, .12));
  box-shadow: var(--dsw-elevation-prominent, 0 12px 40px rgba(0, 0, 0, .2));
}
.dfm-viewer-audio audio { width: 100%; }
.dfm-viewer-nav {
  position: absolute; top: 50%; transform: translateY(-50%); z-index: 2;
  display: grid; place-items: center; width: 40px; height: 40px; padding: 0;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, .25));
  border-radius: 999px; cursor: pointer;
  background: var(--dsw-specific-input-major, rgba(255, 255, 255, .85));
  color: var(--dsw-alias-label-primary, inherit);
}
.dfm-viewer-nav[data-side='left'] { left: 14px; }
.dfm-viewer-nav[data-side='right'] { right: 14px; }
.dfm-viewer-nav:disabled { opacity: .3; cursor: default; }
.dfm-viewer-nav:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, Highlight);
  outline-offset: 2px;
}
.dfm-status {
  flex: none; display: flex; align-items: center; gap: 14px;
  padding: 5px 14px; font-size: 11px; opacity: .7;
  border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}
.dfm-notice {
  display: flex; align-items: center; gap: 7px; margin: 10px 14px;
  padding: 8px 10px; border-radius: 7px; font-size: 12px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  background: color-mix(in srgb, currentColor 5%, transparent);
}
.dfm-empty { padding: 40px 14px; text-align: center; opacity: .55; }
.dfm-search { width: 168px; flex: none; }
.dfm-menu {
  position: fixed; z-index: 60; min-width: 208px; padding: 5px;
  border-radius: 10px; border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  box-shadow: 0 12px 32px rgba(0, 0, 0, .22);
}
.dfm-spin { display: inline-block; animation: dfm-spin 1s linear infinite; }
@keyframes dfm-spin { to { transform: rotate(360deg); } }
.dfm-path { min-width: 0; overflow: hidden; }
.dfm-dialog-field { display: flex; flex-direction: column; gap: 6px; }
.dfm-dialog-label { font-size: 12px; opacity: .7; }
`;
function ensureStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "\u2014";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}
function formatDate(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "\u2014";
  const date = new Date(ms);
  const sameYear = date.getFullYear() === (/* @__PURE__ */ new Date()).getFullYear();
  const pad = (value) => String(value).padStart(2, "0");
  const tail = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return sameYear ? `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${tail}` : `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}
function crumbsOf(path) {
  if (typeof path !== "string" || path.length === 0) return [];
  const parts = path.split("/").filter((part) => part.length > 0);
  const out = [{ label: "/", path: "/" }];
  let cursor = "";
  for (const part of parts) {
    cursor += `/${part}`;
    out.push({ label: part, path: cursor });
  }
  return out;
}
function baseName(path) {
  if (typeof path !== "string" || path.length === 0) return "/";
  const trimmed = path.replace(/\/+$/u, "");
  const cut = trimmed.lastIndexOf("/");
  return cut < 0 ? trimmed : trimmed.slice(cut + 1) || "/";
}
async function callApi(route, options = {}) {
  const { method = "GET", params, body, signal } = options;
  const url = new URL(`${API}/${route}`, window.location.origin);
  if (params !== void 0) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== void 0 && value !== null && (value !== "" || key === "parent")) url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    signal,
    headers: method === "GET" ? void 0 : { "content-type": "application/json", "x-dsh-fileman": "1" },
    body: method === "GET" ? void 0 : JSON.stringify(body ?? {})
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = payload !== null && typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}
function FilemanPanelIcon({ size }) {
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconFolderOpenRegular, { size });
}
var KIND_LABEL_KEYS = {
  dir: "kindDir",
  image: "kindImage",
  video: "kindVideo",
  audio: "kindAudio",
  pdf: "kindPdf",
  text: "kindText",
  file: "kindFile"
};
function streamUrl(path) {
  const url = new URL(`${API}/download`, window.location.origin);
  url.searchParams.set("path", path);
  url.searchParams.set("inline", "1");
  return url.toString();
}
var THUMBNAIL_MAX_BYTES = 12 * 1024 * 1024;
function InfoRows({ rows }) {
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dfm-info", children: rows.map(([key, value]) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_react7.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-info-key", children: key }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-info-val", title: value, children: value })
  ] }, key)) });
}
function mediaInfoRows(entry, kind, meta, t) {
  const rows = [
    [t("kindLabel"), t(KIND_LABEL_KEYS[kind] ?? "kindFile")],
    [t("size"), formatSize(entry.size)]
  ];
  if (Number.isFinite(meta?.width) && Number.isFinite(meta?.height) && meta.width > 0) {
    rows.push([t("dimensions"), `${meta.width} \xD7 ${meta.height}`]);
  }
  if (isPlayableKind(kind)) rows.push([t("duration"), formatClock(meta?.duration)]);
  rows.push([t("modified"), formatDate(entry.mtime)]);
  if (typeof entry.original === "string" && entry.original.length > 0) {
    rows.push([t("originalPath"), entry.original]);
  }
  if (typeof entry.deletedAt === "string" && entry.deletedAt.length > 0) {
    rows.push([t("deletedAt"), entry.deletedAt]);
  }
  return rows;
}
function MediaStage({ entry, kind, t, onOpenViewer }) {
  const [meta, setMeta] = (0, import_react7.useState)(null);
  const [failed, setFailed] = (0, import_react7.useState)(false);
  const src = streamUrl(entry.path);
  (0, import_react7.useEffect)(() => {
    setMeta(null);
    setFailed(false);
  }, [entry.path]);
  if (failed) return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dfm-broken", children: t("mediaBroken") });
  if (kind === "image") {
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-stage", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "img",
        {
          className: "dfm-stage-media dfm-stage-image",
          src,
          alt: entry.name,
          title: t("mediaPreview"),
          onClick: () => onOpenViewer(entry),
          onLoad: (event) => setMeta({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight
          }),
          onError: () => setFailed(true)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(InfoRows, { rows: mediaInfoRows(entry, kind, meta, t) })
    ] });
  }
  if (kind === "video") {
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-stage", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "video",
        {
          className: "dfm-stage-media dfm-stage-video",
          src,
          controls: true,
          playsInline: true,
          preload: "metadata",
          onLoadedMetadata: (event) => setMeta({
            duration: event.currentTarget.duration,
            width: event.currentTarget.videoWidth,
            height: event.currentTarget.videoHeight
          }),
          onError: () => setFailed(true)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(InfoRows, { rows: mediaInfoRows(entry, kind, meta, t) })
    ] });
  }
  if (kind === "audio") {
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-stage", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-audio-card", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(TypeIcon, { entry, size: 80 }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-audio-name", title: entry.name, children: entry.name }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "audio",
          {
            src,
            controls: true,
            preload: "metadata",
            onLoadedMetadata: (event) => setMeta({ duration: event.currentTarget.duration }),
            onError: () => setFailed(true)
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(InfoRows, { rows: mediaInfoRows(entry, kind, meta, t) })
    ] });
  }
  if (kind === "pdf") {
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-stage", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("iframe", { className: "dfm-stage-frame", src, title: entry.name }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(InfoRows, { rows: mediaInfoRows(entry, kind, meta, t) })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dfm-broken", children: t("mediaUnsupported") });
}
function Thumb({ entry, kind, enabled }) {
  const ref = (0, import_react7.useRef)(null), [visible, setVisible] = (0, import_react7.useState)(false), [failed, setFailed] = (0, import_react7.useState)(false);
  (0, import_react7.useEffect)(() => {
    setFailed(false);
    setVisible(false);
    const observer = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "100px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [entry.path, entry.mtime, enabled]);
  const usable = enabled && isThumbnailableKind(kind) && entry.size > 0 && entry.size <= 256 * 1024 * 1024;
  const url = `${API}/thumbnail?path=${encodeURIComponent(entry.path)}&v=${entry.mtime}-${entry.size}`;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-thumb-box", ref, children: usable && visible && !failed ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("img", { className: "dfm-thumb", src: url, alt: "", decoding: "async", onError: () => setFailed(true) }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(TypeIcon, { entry, size: 80 }) });
}
function MediaViewer({ items, index, onIndexChange, onClose, t }) {
  const entry = items[index];
  const [actualSize, setActualSize] = (0, import_react7.useState)(false);
  const [failed, setFailed] = (0, import_react7.useState)(false);
  const mediaRef = (0, import_react7.useRef)(null);
  const kind = entry === void 0 ? "file" : mediaKindOf(entry);
  (0, import_react7.useEffect)(() => {
    setActualSize(false);
    setFailed(false);
  }, [entry?.path]);
  const step = (0, import_react7.useCallback)((delta) => {
    const next = index + delta;
    if (next >= 0 && next < items.length) onIndexChange(next);
  }, [index, items.length, onIndexChange]);
  const togglePlayback = (0, import_react7.useCallback)(() => {
    const element = mediaRef.current;
    if (element === null || typeof element.pause !== "function") return;
    if (element.paused) void element.play().catch(() => {
    });
    else element.pause();
  }, []);
  (0, import_react7.useEffect)(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        step(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        step(1);
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        togglePlayback();
        return;
      }
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, step, togglePlayback]);
  (0, import_react7.useEffect)(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  if (entry === void 0 || typeof document === "undefined") return null;
  const src = streamUrl(entry.path);
  let body;
  if (failed) {
    body = /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dfm-broken", children: t("mediaBroken") });
  } else if (kind === "image") {
    body = /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      "img",
      {
        ref: mediaRef,
        className: "dfm-viewer-media",
        "data-actual": actualSize,
        src,
        alt: entry.name,
        onClick: () => setActualSize((value) => !value),
        onError: () => setFailed(true)
      }
    );
  } else if (kind === "video") {
    body = /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      "video",
      {
        ref: mediaRef,
        className: "dfm-viewer-media",
        src,
        controls: true,
        autoPlay: true,
        playsInline: true,
        onError: () => setFailed(true)
      }
    );
  } else if (kind === "audio") {
    body = /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-viewer-audio", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(TypeIcon, { entry, size: 80 }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-audio-name", title: entry.name, children: entry.name }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("audio", { ref: mediaRef, src, controls: true, autoPlay: true, onError: () => setFailed(true) })
    ] });
  } else {
    body = /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dfm-broken", children: t("mediaUnsupported") });
  }
  return (0, import_react_dom.createPortal)(
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-viewer", role: "dialog", "aria-modal": "true", "aria-label": t("viewer"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dfm-viewer-mask", onClick: onClose }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-viewer-bar", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-viewer-title", title: entry.name, children: entry.name }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "dfm-viewer-counter", children: [
          index + 1,
          " / ",
          items.length
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "dfm-viewer-tools", children: [
          kind === "image" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Tooltip, { label: actualSize ? t("fitMode") : t("actualMode"), side: "bottom", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            import_dsh_client_ui_primitives3.Button,
            {
              variant: "ghost",
              size: "sm",
              icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconFullscreenOutlineRegular, { size: 16 }),
              onClick: () => setActualSize((value) => !value),
              "aria-label": actualSize ? t("fitMode") : t("actualMode")
            }
          ) }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Tooltip, { label: t("openInTab"), side: "bottom", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            import_dsh_client_ui_primitives3.Button,
            {
              variant: "ghost",
              size: "sm",
              icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconRightUpOutlineRegular, { size: 16 }),
              onClick: () => window.open(src, "_blank", "noopener"),
              "aria-label": t("openInTab")
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Tooltip, { label: t("close"), side: "bottom", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            import_dsh_client_ui_primitives3.Button,
            {
              variant: "ghost",
              size: "sm",
              icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconCloseOutlineRegular, { size: 16 }),
              onClick: onClose,
              "aria-label": t("close")
            }
          ) })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-viewer-stage", "data-actual": actualSize && kind === "image", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "button",
          {
            type: "button",
            className: "dfm-viewer-nav",
            "data-side": "left",
            disabled: index <= 0,
            onClick: () => step(-1),
            "aria-label": t("previous"),
            children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconChevronLeftOutlineRegular, { size: 18 })
          }
        ),
        body,
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "button",
          {
            type: "button",
            className: "dfm-viewer-nav",
            "data-side": "right",
            disabled: index >= items.length - 1,
            onClick: () => step(1),
            "aria-label": t("next"),
            children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconChevronRightOutlineRegular, { size: 18 })
          }
        )
      ] })
    ] }),
    document.body
  );
}
var FILEMAN_BROWSE_KEY = "dsh-fileman:browse:v1";
var FILEMAN_DRAFTS_KEY = "dsh-fileman:drafts:v1";
function readBrowseState() {
  try {
    const value = JSON.parse(localStorage.getItem(FILEMAN_BROWSE_KEY) || "null");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}
function readFileDrafts() {
  try {
    const rows = JSON.parse(sessionStorage.getItem(FILEMAN_DRAFTS_KEY) || "{}");
    return new Map(Object.entries(rows).filter(([, row]) => row && typeof row.content === "string" && row.content.length <= 256 * 1024));
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
var fileDrafts = readFileDrafts();
function persistFileDrafts() {
  try {
    const rows = {};
    let size = 0;
    for (const [path, row] of [...fileDrafts].reverse()) {
      const bytes = JSON.stringify([path, row]).length;
      if (size + bytes > 256 * 1024) continue;
      rows[path] = row;
      size += bytes;
    }
    sessionStorage.setItem(FILEMAN_DRAFTS_KEY, JSON.stringify(rows));
  } catch {
  }
}
function saveFileDraft(path, row) {
  fileDrafts.set(path, row);
  persistFileDrafts();
}
function forgetFileDraft(path) {
  fileDrafts.delete(path);
  persistFileDrafts();
}
function readUnconfirmed() {
  try {
    return JSON.parse(sessionStorage.getItem("dfm-unconfirmed") || "null");
  } catch {
    return null;
  }
}
function rememberOperation(value) {
  try {
    if (value) sessionStorage.setItem("dfm-unconfirmed", JSON.stringify(value));
    else sessionStorage.removeItem("dfm-unconfirmed");
  } catch {
  }
}
var unconfirmedOperation = readUnconfirmed();
var fileClipboard = null;
function FilemanPanel({ actions, navigationIsCurrent } = {}) {
  const openRagSettings = (0, import_react7.useCallback)(() => {
    if (!navigationIsCurrent?.() || typeof actions?.openSection !== "function") return false;
    actions.openSection(RAG_SETTINGS_ID);
    return true;
  }, [actions, navigationIsCurrent]);
  const strings = typeof navigator !== "undefined" && /^en/i.test(navigator.language ?? "") ? en : zh;
  const t = (0, import_react7.useCallback)((key) => strings[key] ?? key, [strings]);
  const [locations, setLocations] = (0, import_react7.useState)([]);
  const [root, setRoot] = (0, import_react7.useState)("");
  const [browseReady, setBrowseReady] = (0, import_react7.useState)(false);
  const [cwd, setCwd] = (0, import_react7.useState)("");
  const [stack, setStack] = (0, import_react7.useState)([]);
  const [cursor, setCursor] = (0, import_react7.useState)(-1);
  const [listing, setListing] = (0, import_react7.useState)(null);
  const [folderSizes, setFolderSizes] = (0, import_react7.useState)({});
  const [sizePending, setSizePending] = (0, import_react7.useState)(null);
  const sizeRequest = (0, import_react7.useRef)(null);
  async function measureFolder(entry) {
    if (sizeRequest.current || entry.link) return;
    const controller = new AbortController();
    sizeRequest.current = controller;
    setSizePending(entry.path);
    try {
      const result = await callApi("directory-size", { params: { path: entry.path }, signal: controller.signal });
      if (!controller.signal.aborted) setFolderSizes((prev) => ({ ...prev, [entry.path]: result }));
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      if (sizeRequest.current === controller) {
        sizeRequest.current = null;
        setSizePending(null);
      }
    }
  }
  function entrySize(entry) {
    if (!entry.dir) return formatSize(entry.size);
    if (entry.link) return "\u2014";
    if (sizePending === entry.path) return t("sizeCalculating");
    const result = folderSizes[entry.path];
    return result ? `${result.complete ? "" : "\u2265 "}${formatSize(result.bytes)}${result.complete ? "" : " \xB7 " + t("sizePartial")}` : t("sizeNotCalculated");
  }
  const [pending, setPending] = (0, import_react7.useState)(true);
  const [reload, setReload] = (0, import_react7.useState)(0);
  (0, import_react7.useEffect)(() => {
    setFolderSizes({});
    sizeRequest.current?.abort();
    setSizePending(null);
    return () => sizeRequest.current?.abort();
  }, [cwd, reload]);
  const [operation, setOperation] = (0, import_react7.useState)(null);
  const [unconfirmed, setUnconfirmed] = (0, import_react7.useState)(unconfirmedOperation);
  const [batchReport, setBatchReport] = (0, import_react7.useState)(null);
  const mutationRef = (0, import_react7.useRef)(null);
  const mountedRef = (0, import_react7.useRef)(true);
  const currentRef = (0, import_react7.useRef)({});
  const previewRequest = (0, import_react7.useRef)(0);
  const [draftVersion, setDraftVersion] = (0, import_react7.useState)(null);
  (0, import_react7.useEffect)(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      previewRequest.current++;
    };
  }, []);
  const [error, setError] = (0, import_react7.useState)(null);
  const [selection, setSelection] = (0, import_react7.useState)(() => /* @__PURE__ */ new Set());
  const [view, setView] = (0, import_react7.useState)(() => {
    try {
      return ["list", "small", "large"].includes(localStorage.getItem("dfm-view")) ? localStorage.getItem("dfm-view") : "list";
    } catch {
      return "list";
    }
  });
  const [knowledgeMode, setKnowledgeMode] = (0, import_react7.useState)(false);
  const [knowledgeTypeFilter, setKnowledgeTypeFilter] = (0, import_react7.useState)("all");
  const [knowledgeVisited, setKnowledgeVisited] = (0, import_react7.useState)(false);
  (0, import_react7.useEffect)(() => {
    if (knowledgeMode) setKnowledgeVisited(true);
  }, [knowledgeMode]);
  const [knowledgeSeed, setKnowledgeSeed] = (0, import_react7.useState)(null);
  const [knowledgeSectionOpen, setKnowledgeSectionOpen] = (0, import_react7.useState)(() => {
    try {
      return localStorage.getItem("dfm-knowledge-section") === "open";
    } catch {
      return false;
    }
  });
  (0, import_react7.useEffect)(() => {
    try {
      localStorage.setItem("dfm-knowledge-section", knowledgeSectionOpen ? "open" : "closed");
    } catch {
    }
  }, [knowledgeSectionOpen]);
  (0, import_react7.useEffect)(() => {
    if (knowledgeMode) setKnowledgeSectionOpen(true);
  }, [knowledgeMode]);
  (0, import_react7.useEffect)(() => {
    try {
      localStorage.setItem("dfm-view", view);
    } catch {
    }
  }, [view]);
  const browseState = readBrowseState();
  const [sortKey, setSortKey] = (0, import_react7.useState)(() => ["name", "size", "modified", "type"].includes(browseState.sortKey) ? browseState.sortKey : "name");
  const [sortAsc, setSortAsc] = (0, import_react7.useState)(() => browseState.sortAsc !== false);
  const [query, setQuery] = (0, import_react7.useState)(() => typeof browseState.query === "string" ? browseState.query : "");
  const [showHidden, setShowHidden] = (0, import_react7.useState)(() => browseState.showHidden === true);
  const [clipboard, setClipboard] = (0, import_react7.useState)(() => fileClipboard);
  const [destination, setDestination] = (0, import_react7.useState)(null);
  const [destinationListing, setDestinationListing] = (0, import_react7.useState)(null);
  const [destinationError, setDestinationError] = (0, import_react7.useState)("");
  const [destinationInput, setDestinationInput] = (0, import_react7.useState)("");
  const [menu, setMenu] = (0, import_react7.useState)(null);
  const [prompt, setPrompt] = (0, import_react7.useState)(null);
  const [infoEntry, setInfoEntry] = (0, import_react7.useState)(null);
  const [confirming, setConfirming] = (0, import_react7.useState)(null);
  const [notice, setNotice] = (0, import_react7.useState)(null);
  const [previewOpen, setPreviewOpen] = (0, import_react7.useState)(true);
  const [preview, setPreview] = (0, import_react7.useState)(null);
  const [editing, setEditing] = (0, import_react7.useState)(false);
  const [draft, setDraft] = (0, import_react7.useState)("");
  const [viewer, setViewer] = (0, import_react7.useState)(null);
  const [thumbnails, setThumbnails] = (0, import_react7.useState)(true);
  const [capabilities, setCapabilities] = (0, import_react7.useState)(null);
  currentRef.current = { cwd, preview, draft, editing, draftVersion };
  const dirty = editing && preview?.kind === "text" && draft !== preview.content;
  if (editing && preview?.kind === "text" && preview?.entry) {
    if (dirty) saveFileDraft(preview.entry.path, { content: draft, revision: draftVersion, base: preview.content });
    else forgetFileDraft(preview.entry.path);
  }
  (0, import_react7.useEffect)(() => {
    if (!browseReady) return;
    try {
      localStorage.setItem(FILEMAN_BROWSE_KEY, JSON.stringify({ root, cwd, view, sortKey, sortAsc, query, showHidden }));
    } catch {
    }
  }, [browseReady, root, cwd, view, sortKey, sortAsc, query, showHidden]);
  const allowLeave = (0, import_react7.useCallback)(() => {
    if (mutationRef.current) return false;
    const c = currentRef.current;
    return !(c.editing && c.preview?.kind === "text" && c.draft !== c.preview.content) || window.confirm("\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\u3002\u4FDD\u7559\u8349\u7A3F\u5E76\u5207\u6362\uFF1F\u8FD4\u56DE\u6B64\u6587\u4EF6\u53EF\u7EE7\u7EED\u7F16\u8F91\u3002");
  }, []);
  (0, import_react7.useEffect)(() => {
    const warn = (e) => {
      if (fileDrafts.size || mutationRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const mutate = (0, import_react7.useCallback)(async (route, body) => {
    if (mutationRef.current) throw new Error("\u5DF2\u6709\u6587\u4EF6\u64CD\u4F5C\u6B63\u5728\u6267\u884C\uFF0C\u8BF7\u7B49\u5F85\u5B8C\u6210");
    if (unconfirmedOperation) throw new Error("\u4E0A\u6B21\u64CD\u4F5C\u7ED3\u679C\u5C1A\u672A\u786E\u8BA4\uFF0C\u8BF7\u5148\u6838\u5BF9\u4E0A\u6B21\u64CD\u4F5C");
    const id = crypto.randomUUID(), record = { id, route, directory: currentRef.current.cwd, path: body.path, time: Date.now() };
    mutationRef.current = id;
    setOperation(route);
    setBatchReport(null);
    unconfirmedOperation = record;
    rememberOperation(record);
    try {
      const result = await callApi(route, { method: "POST", body: { ...body, requestId: id } });
      unconfirmedOperation = null;
      rememberOperation(null);
      return result;
    } catch (e) {
      if (e.status && e.status < 500 && e.status !== 408) {
        unconfirmedOperation = null;
        rememberOperation(null);
      } else {
        e.message = "\u8FDE\u63A5\u4E2D\u65AD\uFF0C\u64CD\u4F5C\u7ED3\u679C\u5C1A\u672A\u786E\u8BA4\u3002\u8BF7\u6838\u5BF9\u4E0A\u6B21\u64CD\u4F5C\uFF0C\u6682\u4E0D\u91CD\u590D\u63D0\u4EA4\u3002";
        if (mountedRef.current) setUnconfirmed(record);
      }
      throw e;
    } finally {
      mutationRef.current = null;
      if (mountedRef.current) setOperation(null);
    }
  }, []);
  const reconcileOperation = (0, import_react7.useCallback)(async () => {
    const record = unconfirmedOperation || unconfirmed;
    if (!record) return;
    try {
      const r = await callApi("operation-status", { params: { requestId: record.id } });
      if (r.state === "pending") {
        setNotice({ tone: "error", text: "\u4E0A\u6B21\u64CD\u4F5C\u4ECD\u5728\u6267\u884C\uFF0C\u8BF7\u7A0D\u540E\u518D\u6838\u5BF9\u3002" });
        return;
      }
      if (r.state === "unknown") {
        setNotice({ tone: "error", text: "\u670D\u52A1\u5668\u6CA1\u6709\u4FDD\u7559\u8BE5\u64CD\u4F5C\u7ED3\u679C\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u540E\u624B\u52A8\u89E3\u9664\u4FDD\u62A4\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u91CD\u8BD5\u3002" });
        return;
      }
      if (r.result?.payload?.results) setBatchReport(r.result.payload.results);
      setNotice({ tone: r.state === "completed" && r.result?.status < 400 ? "ok" : "error", text: r.error || r.result?.payload?.error || "\u5DF2\u786E\u8BA4\u4E0A\u6B21\u64CD\u4F5C\u7ED3\u679C\uFF0C\u8BF7\u5237\u65B0\u67E5\u770B\u6587\u4EF6\u3002" });
      unconfirmedOperation = null;
      rememberOperation(null);
      setUnconfirmed(null);
    } catch (e) {
      setNotice({ tone: "error", text: e.message });
    }
  }, [unconfirmed]);
  const anchorRef = (0, import_react7.useRef)(null);
  const previewPathRef = (0, import_react7.useRef)("");
  const writable = capabilities?.writable !== false;
  const thumbnailsAllowed = capabilities?.thumbnails !== false;
  const inTrash = listing?.trash === true;
  ensureStyles();
  (0, import_react7.useEffect)(() => {
    if (!destination) return;
    let live = true;
    const controller = new AbortController();
    setDestinationListing(null);
    setDestinationError("");
    setDestinationInput(destination.path);
    callApi("list", { params: { path: destination.path }, signal: controller.signal }).then((result) => {
      if (live) setDestinationListing({ ...result, requestedPath: destination.path });
    }).catch((error2) => {
      if (live) setDestinationError(error2.message);
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [destination?.path, destination?.revision]);
  (0, import_react7.useEffect)(() => {
    if (notice === null || notice.tone === "error") return void 0;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);
  (0, import_react7.useEffect)(() => {
    let live = true;
    callApi("locations").then((payload) => {
      if (!live) return;
      setLocations(Array.isArray(payload.locations) ? payload.locations : []);
      setRoot(payload.root ?? "");
      setBrowseReady(true);
      setCapabilities(payload.capabilities ?? null);
      if (payload.capabilities?.thumbnails === false) setThumbnails(false);
      const home = payload.home ?? payload.root ?? "/";
      const saved = readBrowseState();
      const target = saved.root === payload.root && typeof saved.cwd === "string" && saved.cwd ? saved.cwd : home;
      navigate(target, { reset: true });
    }).catch((cause) => {
      if (live) setError(cause.message);
    });
    return () => {
      live = false;
    };
  }, []);
  (0, import_react7.useEffect)(() => {
    if (cwd === "") return void 0;
    let live = true;
    const controller = new AbortController();
    setPending(true);
    setError(null);
    callApi("list", { params: { path: cwd }, signal: controller.signal }).then((payload) => {
      if (!live) return;
      setListing(payload);
      setSelection(/* @__PURE__ */ new Set());
      setPreview(null);
      setEditing(false);
      previewPathRef.current = "";
      setPending(false);
    }).catch((cause) => {
      if (!live) return;
      setError(cause.message);
      setListing(null);
      setPending(false);
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [cwd, reload]);
  const navigate = (0, import_react7.useCallback)((target, options = {}) => {
    if (typeof target !== "string" || target.length === 0 || !allowLeave()) return;
    previewRequest.current++;
    previewPathRef.current = "";
    if (options.reset === true) {
      setStack([target]);
      setCursor(0);
      setCwd(target);
      return;
    }
    setStack((previous) => {
      const index = cursor < 0 ? previous.length - 1 : cursor;
      const trimmed = previous.slice(0, index + 1);
      if (trimmed[trimmed.length - 1] === target) return previous;
      const next = [...trimmed, target];
      setCursor(next.length - 1);
      return next;
    });
    setCwd(target);
    setQuery("");
  }, [cursor, allowLeave]);
  const goBack = (0, import_react7.useCallback)(() => {
    if (cursor <= 0 || !allowLeave()) return;
    previewRequest.current++;
    setCursor(cursor - 1);
    setCwd(stack[cursor - 1]);
  }, [cursor, stack, allowLeave]);
  const goForward = (0, import_react7.useCallback)(() => {
    if (cursor < 0 || cursor >= stack.length - 1 || !allowLeave()) return;
    previewRequest.current++;
    setCursor(cursor + 1);
    setCwd(stack[cursor + 1]);
  }, [cursor, stack, allowLeave]);
  const visible = (0, import_react7.useMemo)(() => {
    const entries = Array.isArray(listing?.entries) ? listing.entries : [];
    const needle = query.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      if (!showHidden && entry.hidden) return false;
      if (needle.length === 0) return true;
      return entry.name.toLowerCase().includes(needle);
    });
    const factor = sortAsc ? 1 : -1;
    return [...filtered].sort((left, right) => {
      if (left.dir !== right.dir) return left.dir ? -1 : 1;
      if (sortKey === "size") {
        const a = left.dir ? folderSizes[left.path]?.bytes : left.size, b = right.dir ? folderSizes[right.path]?.bytes : right.size;
        if (a === void 0 || b === void 0) return a === b ? left.name.localeCompare(right.name) : a === void 0 ? 1 : -1;
        return (a - b) * factor;
      }
      if (sortKey === "mtime") return (left.mtime - right.mtime) * factor;
      return left.name.localeCompare(right.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" }) * factor;
    });
  }, [listing, query, showHidden, sortKey, sortAsc, folderSizes]);
  const windowed = useWindowedEntries(visible, view, `${cwd}:${query}:${view}:${sortKey}:${sortAsc}:${showHidden}`);
  const selectedEntries = (0, import_react7.useMemo)(
    () => visible.filter((entry) => selection.has(entry.path)),
    [visible, selection]
  );
  const refresh = (0, import_react7.useCallback)((target = currentRef.current.cwd, force = false) => {
    if (typeof target !== "string") target = currentRef.current.cwd;
    if (!mountedRef.current || target !== currentRef.current.cwd || !force && !allowLeave()) return;
    previewRequest.current++;
    setReload((n) => n + 1);
  }, [allowLeave]);
  const showPreviewFor = (0, import_react7.useCallback)((entry) => {
    const request = ++previewRequest.current;
    const kind = mediaKindOf(entry);
    previewPathRef.current = entry.path;
    setPreviewOpen(true);
    setEditing(false);
    if (isViewerKind(kind) || kind === "pdf") {
      setPreview({ entry, kind, status: "ready" });
      return;
    }
    if (kind !== "text") {
      setPreview({ entry, kind, status: "unsupported" });
      return;
    }
    setPreview({ entry, kind, status: "loading" });
    callApi("read", { params: { path: entry.path } }).then((payload) => {
      if (!mountedRef.current || request !== previewRequest.current || previewPathRef.current !== entry.path) return;
      const saved = fileDrafts.get(entry.path);
      setDraft(saved?.content ?? payload.content ?? "");
      setDraftVersion(saved?.revision ?? payload.revision);
      setEditing(Boolean(saved));
      setPreview({ entry, kind, status: "ready", content: saved?.base ?? payload.content ?? "", revision: payload.revision });
      if (saved && saved.revision !== payload.revision) setNotice({ tone: "error", text: "\u539F\u6587\u4EF6\u5DF2\u53D1\u751F\u53D8\u5316\uFF0C\u8349\u7A3F\u4FDD\u7559\uFF1B\u4FDD\u5B58\u65F6\u4F1A\u6821\u9A8C\u51B2\u7A81\u3002" });
    }).catch((cause) => {
      if (!mountedRef.current || request !== previewRequest.current || previewPathRef.current !== entry.path) return;
      setPreview({
        entry,
        kind,
        status: "unsupported",
        detail: cause.status === 413 ? t("noPreview") : cause.message
      });
    });
  }, [t]);
  const openViewer = (0, import_react7.useCallback)((entry) => {
    const items = viewerItemsOf(visible);
    const index = items.findIndex((item) => item.path === entry.path);
    if (index < 0) return;
    showPreviewFor(entry);
    setViewer({ items, index });
  }, [visible, showPreviewFor]);
  const goToViewerIndex = (0, import_react7.useCallback)((index) => {
    if (viewer === null) return;
    const entry = viewer.items[index];
    if (entry !== void 0) showPreviewFor(entry);
    setViewer({ ...viewer, index });
  }, [viewer, showPreviewFor]);
  const openEntry = (0, import_react7.useCallback)((entry) => {
    if (!allowLeave()) return;
    if (entry.dir) {
      navigate(entry.path);
      return;
    }
    if (isViewerKind(mediaKindOf(entry))) {
      openViewer(entry);
      return;
    }
    showPreviewFor(entry);
  }, [navigate, openViewer, showPreviewFor, allowLeave]);
  (0, import_react7.useEffect)(() => {
    if (selectedEntries.length !== 1) return;
    const entry = selectedEntries[0];
    if (entry.dir === true) return;
    if (previewPathRef.current === entry.path) return;
    showPreviewFor(entry);
  }, [selectedEntries, showPreviewFor]);
  const selectEntry = (0, import_react7.useCallback)((entry, event) => {
    if (!allowLeave()) return;
    setSelection((previous) => {
      const next = new Set(previous);
      if (event.metaKey || event.ctrlKey) {
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      }
      if (event.shiftKey && previous.size > 0) {
        const paths = visible.map((item) => item.path);
        const lastSelected = paths.findIndex((path) => previous.has(path));
        const target = paths.indexOf(entry.path);
        if (lastSelected >= 0 && target >= 0) {
          const [from, to] = lastSelected < target ? [lastSelected, target] : [target, lastSelected];
          for (let index = from; index <= to; index += 1) next.add(paths[index]);
          return next;
        }
      }
      return /* @__PURE__ */ new Set([entry.path]);
    });
  }, [visible, allowLeave]);
  const createFolder = (0, import_react7.useCallback)(async (name) => {
    if (mutationRef.current || !allowLeave()) return;
    try {
      await mutate("mkdir", { dir: cwd, name });
      setNotice({ tone: "ok", text: t("newFolder") });
      setPrompt(null);
      refresh(cwd, true);
    } catch (cause) {
      setNotice({ tone: "error", text: cause.message });
    }
  }, [cwd, refresh, t, mutate]);
  const renameEntry = (0, import_react7.useCallback)(async (entry, name) => {
    if (mutationRef.current || !allowLeave()) return;
    try {
      await mutate("rename", { path: entry.path, name });
      setNotice({ tone: "ok", text: t("rename") });
      setPrompt(null);
      setPreview(null);
      refresh(cwd, true);
    } catch (cause) {
      setNotice({ tone: "error", text: cause.message });
    }
  }, [refresh, t, cwd, mutate]);
  const runBatch = (0, import_react7.useCallback)(async (route, entries, okText) => {
    if (mutationRef.current || !allowLeave()) return;
    try {
      const payload = await mutate(route, { paths: entries.map((entry) => entry.path) });
      if (mountedRef.current) setBatchReport(payload.results ?? []);
      const failed = (payload.results ?? []).filter((item) => item.ok !== true);
      setNotice(failed.length === 0 ? { tone: "ok", text: okText } : { tone: "error", text: failed[0].error ?? t("errorTitle") });
      setConfirming(null);
      setPreview(null);
      refresh(cwd, true);
      return payload;
    } catch (cause) {
      setNotice({ tone: "error", text: cause.message });
      return null;
    }
  }, [refresh, t, cwd, mutate]);
  const trashEntries = (0, import_react7.useCallback)(
    (entries) => runBatch("trash", entries, capabilities?.trash === false ? t("deleted") : t("trashed")),
    [runBatch, t, capabilities]
  );
  const restoreEntries = (0, import_react7.useCallback)(
    (entries) => runBatch("restore", entries, t("restored")),
    [runBatch, t]
  );
  const purgeEntries = (0, import_react7.useCallback)(
    (entries) => runBatch("purge", entries, t("purged")),
    [runBatch, t]
  );
  const emptyTrash = (0, import_react7.useCallback)(async () => {
    if (mutationRef.current || !allowLeave()) return;
    try {
      await mutate("trash-empty", {});
      setNotice({ tone: "ok", text: t("emptied") });
      setConfirming(null);
      setPreview(null);
      refresh(cwd, true);
    } catch (cause) {
      setNotice({ tone: "error", text: cause.message });
    }
  }, [refresh, t, cwd, mutate]);
  const askRemove = (0, import_react7.useCallback)((entries) => {
    if (!allowLeave()) return;
    setConfirming({ action: inTrash ? "purge" : "trash", entries });
  }, [inTrash, allowLeave]);
  const confirmSpec = (0, import_react7.useMemo)(() => {
    if (confirming === null) return null;
    const entries = confirming.entries ?? [];
    if (confirming.action === "purge") {
      return { title: t("purgeTitle"), body: t("purgeBody"), ok: t("purge"), run: () => purgeEntries(entries) };
    }
    if (confirming.action === "empty") {
      return { title: t("emptyTrashTitle"), body: t("emptyTrashBody"), ok: t("emptyTrash"), run: () => emptyTrash() };
    }
    return { title: t("confirmTitle"), body: t("confirmBody"), ok: t("remove"), run: () => trashEntries(entries) };
  }, [confirming, emptyTrash, purgeEntries, t, trashEntries]);
  const transfer = (0, import_react7.useCallback)(async (route, entries, dest = cwd, fromClipboard = false) => {
    if (!writable || inTrash || !entries.length || mutationRef.current || !allowLeave()) return;
    try {
      const payload = await mutate(route, { paths: entries.map((entry) => entry.path), dest });
      if (fromClipboard && route === "move") {
        const remaining = entries.filter((entry, index) => payload.results?.[index]?.ok !== true);
        fileClipboard = remaining.length ? { route: "move", entries: remaining } : null;
        setClipboard(fileClipboard);
      }
      if (mountedRef.current) setBatchReport(payload.results ?? []);
      const failed = (payload.results ?? []).filter((item) => item.ok !== true);
      setNotice(failed.length === 0 ? { tone: "ok", text: route === "copy" ? t("copied") : t("moved") } : { tone: "error", text: failed[0].error ?? t("errorTitle") });
      if (failed.length === 0) setDestination(null);
      else if (!fromClipboard) {
        const remaining = entries.filter((entry, index) => payload.results?.[index]?.ok !== true);
        setDestination((current) => current ? { ...current, entries: remaining } : null);
        setDestinationError(failed[0].error ?? t("errorTitle"));
      }
      refresh(cwd, true);
    } catch (cause) {
      setNotice({ tone: "error", text: cause.message });
      setDestinationError(cause.message);
    }
  }, [cwd, refresh, t, mutate, writable, inTrash, allowLeave]);
  const stageClipboard = (0, import_react7.useCallback)((route, entries) => {
    if (!writable || inTrash || mutationRef.current || !entries.length) return;
    fileClipboard = { route, entries: entries.map(({ path, name, dir }) => ({ path, name, dir })) };
    setClipboard(fileClipboard);
    setNotice({ tone: "ok", text: `${t("clipboardReady")} \xB7 ${entries.length}` });
  }, [writable, inTrash, t]);
  const pasteClipboard = (0, import_react7.useCallback)(() => {
    if (clipboard) void transfer(clipboard.route, clipboard.entries, cwd, true);
  }, [clipboard, transfer, cwd]);
  const chooseTransfer = (route, entries) => {
    if (!entries.length || !allowLeave()) return;
    setDestination({ route, entries: [...entries], path: cwd });
  };
  const saveDraft = (0, import_react7.useCallback)(async () => {
    if (preview?.entry === void 0 || mutationRef.current) return;
    const path = preview.entry.path, directory = cwd, text3 = draft, version = draftVersion;
    try {
      await mutate("write", { path, content: text3, revision: version });
      if (fileDrafts.get(path)?.content === text3) forgetFileDraft(path);
      if (!mountedRef.current || currentRef.current.preview?.entry?.path !== path || currentRef.current.cwd !== directory) return;
      setPreview({ ...preview, content: text3 });
      setEditing(false);
      setNotice({ tone: "ok", text: t("saved") });
      refresh(directory, true);
    } catch (cause) {
      if (mountedRef.current) setNotice({ tone: "error", text: cause.message });
    }
  }, [draft, draftVersion, preview, cwd, mutate, refresh, t]);
  const download = (0, import_react7.useCallback)((entry) => {
    const url = new URL(`${API}/download`, window.location.origin);
    url.searchParams.set("path", entry.path);
    window.open(url.toString(), "_blank", "noopener");
  }, []);
  const openInTab = (0, import_react7.useCallback)((entry) => {
    window.open(streamUrl(entry.path), "_blank", "noopener");
  }, []);
  (0, import_react7.useEffect)(() => {
    if (menu === null) return void 0;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);
  (0, import_react7.useEffect)(() => {
    const onKey = (event) => {
      if (viewer !== null || destination !== null || knowledgeMode || mutationRef.current || infoEntry !== null || prompt !== null || confirming !== null) return;
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "s" && editing) {
        event.preventDefault();
        void saveDraft();
        return;
      }
      if (typing || target instanceof HTMLElement && target.closest('button,[role="button"],[role="menuitem"]') && !target.closest(".dfm-tile") && (event.key === "Enter" || event.key === " ")) return;
      if (meta && !event.altKey && ["c", "x", "v"].includes(event.key.toLowerCase()) && writable && !inTrash) {
        const key = event.key.toLowerCase();
        if (key === "v" && clipboard) {
          event.preventDefault();
          pasteClipboard();
          return;
        }
        if (key !== "v" && selectedEntries.length) {
          event.preventDefault();
          stageClipboard(key === "x" ? "move" : "copy", selectedEntries);
          return;
        }
      }
      if (meta && event.key.toLowerCase() === "i" && selectedEntries.length === 1) {
        event.preventDefault();
        setInfoEntry(selectedEntries[0]);
        return;
      }
      if (event.key === "F2" && writable && !inTrash && selectedEntries.length === 1) {
        event.preventDefault();
        setPrompt({ kind: "rename", entry: selectedEntries[0], value: selectedEntries[0].name });
        return;
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "n" && writable) {
        event.preventDefault();
        setPrompt({ kind: "mkdir", value: "" });
        return;
      }
      if (meta && event.shiftKey && event.key === ".") {
        event.preventDefault();
        setShowHidden((value) => !value);
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && writable && selectedEntries.length > 0) {
        event.preventDefault();
        askRemove(selectedEntries);
        return;
      }
      if (event.key === "Enter" && selectedEntries.length === 1) {
        event.preventDefault();
        if (meta && writable && !inTrash) setPrompt({ kind: "rename", entry: selectedEntries[0], value: selectedEntries[0].name });
        else openEntry(selectedEntries[0]);
        return;
      }
      if (event.key === "ArrowUp" && meta && listing?.parent) {
        event.preventDefault();
        navigate(listing.parent);
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        if (selectedEntries.length === 1) openEntry(selectedEntries[0]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [destination, clipboard, pasteClipboard, stageClipboard, knowledgeMode, askRemove, editing, listing, navigate, openEntry, saveDraft, selectedEntries, viewer, writable, inTrash, infoEntry, prompt, confirming]);
  const openMenu = (0, import_react7.useCallback)((event, entry) => {
    event.preventDefault();
    if (entry === void 0) {
      setMenu({
        x: Math.min(event.clientX, window.innerWidth - 228),
        y: Math.min(event.clientY, window.innerHeight - 320),
        entry: void 0
      });
      return;
    }
    event.stopPropagation();
    if (!selection.has(entry.path)) setSelection(/* @__PURE__ */ new Set([entry.path]));
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 228),
      y: Math.min(event.clientY, window.innerHeight - 320),
      entry
    });
  }, [selection]);
  const toggleSort = (0, import_react7.useCallback)((key) => {
    if (sortKey === key) {
      setSortAsc((value) => !value);
      return;
    }
    setSortKey(key);
    setSortAsc(true);
  }, [sortKey]);
  const arrow = sortKey === "name" ? null : sortAsc ? "\u2191" : "\u2193";
  const selectionLabel = selectedEntries.length > 0 ? `\uFF0C${t("selected")} ${selectedEntries.length} ` : "";
  const sortedBy = (key) => sortKey === key ? sortAsc ? "\u2191" : "\u2193" : "";
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-root", ref: anchorRef, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { inert: Boolean(operation), className: "dfm-toolbar", style: { display: knowledgeMode ? "none" : void 0 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Tooltip, { label: t("back"), side: "bottom", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "toolbar", size: "sm", icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconChevronLeftOutlineRegular, { size: 16 }), disabled: cursor <= 0, onClick: goBack, "aria-label": t("back") }) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Tooltip, { label: t("forward"), side: "bottom", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "toolbar", size: "sm", icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconChevronRightOutlineRegular, { size: 16 }), disabled: cursor < 0 || cursor >= stack.length - 1, onClick: goForward, "aria-label": t("forward") }) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Tooltip, { label: t("parent"), side: "bottom", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "toolbar", size: "sm", icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconChevronUpOutlineRegular, { size: 16 }), disabled: listing?.parent == null, onClick: () => listing?.parent != null && navigate(listing.parent), "aria-label": t("parent") }) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("nav", { className: "dfm-breadcrumb", "aria-label": t("revealPath"), children: inTrash ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "dfm-crumb-static", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconTrashOutlineRegular, { size: 14 }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-crumb-label", children: t("trash") })
      ] }) : crumbsOf(cwd).map((crumb, index, all) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { style: { display: "inline-flex", alignItems: "center" }, children: [
        index > 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconChevronRightOutlineRegular, { size: 12 }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", className: "dfm-crumb", onClick: () => navigate(crumb.path), title: crumb.path, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-crumb-label", children: index === 0 ? t("root") : crumb.label }) }),
        index === all.length - 1 ? null : null
      ] }, crumb.path)) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        import_dsh_client_ui_primitives3.Input,
        {
          className: "dfm-search",
          icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconSearchOutlineRegular, { size: 16 }),
          placeholder: t("search"),
          value: query,
          onChange: (event) => setQuery(event.target.value),
          "aria-label": t("search")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        import_dsh_client_ui_primitives3.Tooltip,
        {
          label: !writable ? t("readOnly") : inTrash ? t("trashNote") : t("newFolder"),
          side: "bottom",
          delayMs: 400,
          children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            import_dsh_client_ui_primitives3.Button,
            {
              variant: "toolbar",
              size: "sm",
              icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconPlusOutlineRegular, { size: 16 }),
              disabled: !writable || inTrash,
              onClick: () => setPrompt({ kind: "mkdir", value: "" }),
              "aria-label": t("newFolder")
            }
          )
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Tooltip, { label: t("refresh"), side: "bottom", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "toolbar", size: "sm", icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconRefreshOutlineRegular, { size: 16 }), onClick: refresh, "aria-label": t("refresh") }) }),
      inTrash && writable ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Tooltip, { label: t("emptyTrash"), side: "bottom", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        import_dsh_client_ui_primitives3.Button,
        {
          variant: "toolbar",
          size: "sm",
          icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconTrashOutlineRegular, { size: 16 }),
          onClick: () => setConfirming({ action: "empty", entries: [] }),
          "aria-label": t("emptyTrash")
        }
      ) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ViewButtons, { view, onChange: setView }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "toolbar", size: "sm", disabled: !writable || inTrash || selectedEntries.length !== 1 || false, onClick: () => {
        const f = selectedEntries[0];
        if (f.dir) {
          setKnowledgeSeed({ importPaths: [f.path] });
          setKnowledgeMode(true);
          return;
        }
        setKnowledgeSeed({ title: f.name, content: `\u5173\u8054\u6587\u4EF6\uFF1A${f.name}`, assetId: "file:" + f.path, tags: [], category: "\u6587\u4EF6", sourceUrl: "" });
        setKnowledgeTypeFilter("all");
        setKnowledgeMode(true);
      }, children: "\u52A0\u5165\u77E5\u8BC6\u5E93" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Tooltip, { label: previewOpen ? t("hidePreview") : t("showPreview"), side: "bottom", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "toolbar", size: "sm", icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconInfoOutlineRegular, { size: 16 }), onClick: () => setPreviewOpen((value) => !value), "aria-label": t("showPreview") }) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        import_dsh_client_ui_primitives3.Button,
        {
          variant: "toolbar",
          size: "sm",
          icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconEllipsisOutlineRegular, { size: 16 }),
          "aria-label": t("errorTitle"),
          onClick: (event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setMenu({ x: Math.min(box.left, window.innerWidth - 228), y: Math.min(box.bottom + 6, window.innerHeight - 320), entry: void 0 });
          }
        }
      )
    ] }),
    knowledgeMode && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-toolbar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("strong", { children: "\u77E5\u8BC6\u5E93" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ViewButtons, { view, onChange: setView })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-body", inert: Boolean(operation), children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("aside", { className: "dfm-locations", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dfm-locations-title", children: t("locations") }),
        locations.map((location) => {
          const presentation = LOCATION_PRESENTATION[location.kind] ?? LOCATION_PRESENTATION.root;
          const Glyph = presentation.icon;
          return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
            "button",
            {
              type: "button",
              className: "dfm-location-row",
              "data-active": !knowledgeMode && (cwd === location.path || location.kind === "home" && cwd.startsWith(location.path)),
              onClick: () => {
                setKnowledgeMode(false);
                navigate(location.path);
              },
              title: location.path,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Glyph, { size: 16 }),
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-location-label", children: t(presentation.key) })
              ]
            },
            location.path
          );
        }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("button", { type: "button", className: "dfm-locations-title dfm-locations-toggle", "aria-expanded": knowledgeSectionOpen, title: knowledgeSectionOpen ? "\u6298\u53E0\u77E5\u8BC6\u5E93\u680F\u76EE" : "\u5C55\u5F00\u77E5\u8BC6\u5E93\u680F\u76EE", onDragOver: (e) => e.preventDefault(), onDrop: (e) => {
          e.preventDefault();
          if (writable) {
            setKnowledgeSeed({ importDrop: captureDrop(e.dataTransfer) });
            setKnowledgeTypeFilter("all");
            setKnowledgeMode(true);
            setKnowledgeSectionOpen(true);
          }
        }, onClick: () => setKnowledgeSectionOpen((v) => !v), children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("svg", { className: "dfm-locations-chevron", width: "10", height: "10", viewBox: "0 0 10 10", fill: "none", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: "M2.5 1.5 7 5l-4.5 3.5" }) }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: "\u77E5\u8BC6\u5E93" })
        ] }),
        knowledgeSectionOpen && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("button", { type: "button", className: "dfm-location-row", onDragOver: (e) => e.preventDefault(), onDrop: (e) => {
            e.preventDefault();
            if (writable) {
              setKnowledgeSeed({ importDrop: captureDrop(e.dataTransfer) });
              setKnowledgeMode(true);
              setKnowledgeTypeFilter("all");
            }
          }, "data-active": knowledgeMode && knowledgeTypeFilter === "all", onClick: () => {
            setKnowledgeMode(true);
            setKnowledgeTypeFilter("all");
          }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(TypeIcon, { type: "note", size: 22 }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: "\u5168\u90E8\u77E5\u8BC6" })
          ] }),
          Object.entries(FILE_TYPES).filter(([type]) => type !== "folder").map(([type, meta]) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("button", { type: "button", className: "dfm-location-row dfm-knowledge-type", "data-active": knowledgeMode && knowledgeTypeFilter === type, onClick: () => {
            setKnowledgeMode(true);
            setKnowledgeTypeFilter(type);
          }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(TypeIcon, { type, size: 22 }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: meta.label })
          ] }, type))
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: knowledgeMode ? "none" : "contents" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className: "dfm-main", children: [
          error !== null ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-notice", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconWarningOutlineRegular, { size: 16 }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { children: [
              t("failed"),
              "\uFF1A",
              error
            ] })
          ] }) : null,
          pending ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dfm-empty", children: t("loading") }) : view === "list" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { ref: windowed.ref, className: "dfm-list", onContextMenu: (event) => openMenu(event), onClick: (event) => {
            if (event.target === event.currentTarget) setSelection(/* @__PURE__ */ new Set());
          }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-head", children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("button", { type: "button", className: "dfm-head-cell dfm-name", onClick: () => toggleSort("name"), children: [
                t("name"),
                " ",
                sortedBy("name")
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("button", { type: "button", className: "dfm-head-cell dfm-size dfm-dim", onClick: () => toggleSort("size"), style: { justifyContent: "flex-end" }, children: [
                t("size"),
                " ",
                sortedBy("size")
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("button", { type: "button", className: "dfm-head-cell dfm-date dfm-dim", onClick: () => toggleSort("mtime"), style: { justifyContent: "flex-end" }, children: [
                t("modified"),
                " ",
                sortedBy("mtime")
              ] })
            ] }),
            visible.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dfm-empty", children: t("empty") }) : null,
            windowed.top > 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { "aria-hidden": "true", style: { height: Math.max(0, windowed.top - windowed.gap), gridColumn: "1 / -1" } }),
            windowed.items.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
              "div",
              {
                draggable: !inTrash,
                onDragStart: (e) => {
                  e.dataTransfer.setData("application/x-dsh-file-paths", JSON.stringify([entry.path]));
                  e.dataTransfer.effectAllowed = "copy";
                },
                className: "dfm-row",
                "data-selected": selection.has(entry.path),
                onClick: (event) => selectEntry(entry, event),
                onDoubleClick: () => openEntry(entry),
                onContextMenu: (event) => openMenu(event, entry),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "dfm-name", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(TypeIcon, { entry, size: 22 }),
                    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-name-text", style: entry.link ? { fontStyle: "italic" } : void 0, children: entry.name })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-dim dfm-size", title: entry.dir ? t("sizeNote") : `${entry.size.toLocaleString()} B`, children: entry.dir && !entry.link ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", style: { background: "none", border: 0, color: "inherit", cursor: "pointer", font: "inherit" }, disabled: !!sizePending, title: t("calculateSize"), onDoubleClick: (e) => e.stopPropagation(), onClick: (e) => {
                    e.stopPropagation();
                    measureFolder(entry);
                  }, children: folderSizes[entry.path] || sizePending === entry.path ? entrySize(entry) : t("calculateSize") }) : entry.link && entry.dir ? "\u2014" : entrySize(entry) }),
                  /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-dim dfm-date", children: formatDate(entry.mtime) })
                ]
              },
              entry.path
            )),
            windowed.bottom > 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { "aria-hidden": "true", style: { height: Math.max(0, windowed.bottom - windowed.gap), gridColumn: "1 / -1" } })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { ref: windowed.ref, className: "dfm-grid", "data-view": view, style: { gridTemplateColumns: `repeat(${windowed.columns},minmax(0,1fr))`, gridAutoRows: "auto" }, onContextMenu: (event) => openMenu(event), onClick: (event) => {
            if (event.target === event.currentTarget) setSelection(/* @__PURE__ */ new Set());
          }, children: [
            visible.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dfm-empty", children: t("empty") }) : null,
            windowed.top > 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { "aria-hidden": "true", style: { height: Math.max(0, windowed.top - windowed.gap), gridColumn: "1 / -1" } }),
            windowed.items.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
              "button",
              {
                type: "button",
                draggable: !inTrash,
                onDragStart: (e) => {
                  e.dataTransfer.setData("application/x-dsh-file-paths", JSON.stringify([entry.path]));
                  e.dataTransfer.effectAllowed = "copy";
                },
                className: "dfm-tile",
                style: { height: windowed.rowHeight },
                "data-selected": selection.has(entry.path),
                onClick: (event) => selectEntry(entry, event),
                onDoubleClick: () => openEntry(entry),
                onContextMenu: (event) => openMenu(event, entry),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "dfm-file-art", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                      Thumb,
                      {
                        entry,
                        kind: mediaKindOf(entry),
                        enabled: thumbnails && thumbnailsAllowed
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(TypeBadge, { type: fileType(entry) })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-tile-label", children: entry.name }),
                  /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-dim", style: { fontSize: 11 }, children: entrySize(entry) })
                ]
              },
              entry.path
            )),
            windowed.bottom > 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { "aria-hidden": "true", style: { height: Math.max(0, windowed.bottom - windowed.gap), gridColumn: "1 / -1" } })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-status", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { children: [
              visible.length,
              " ",
              t("items"),
              selectionLabel
            ] }),
            selectedEntries.length === 1 && selectedEntries[0].dir && !selectedEntries[0].link ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", disabled: !!sizePending, title: t("sizeNote"), onClick: () => measureFolder(selectedEntries[0]), children: t("calculateSize") }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", disabled: selectedEntries.length !== 1, onClick: () => setInfoEntry(selectedEntries[0]), children: t("getInfo") }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", disabled: selectedEntries.length !== 1 || !writable || inTrash || Boolean(operation), onClick: () => setPrompt({ kind: "rename", entry: selectedEntries[0], value: selectedEntries[0].name }), children: t("rename") }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", disabled: !writable || inTrash || !selectedEntries.length || Boolean(operation), onClick: () => stageClipboard("copy", selectedEntries), children: t("copy") }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", disabled: !writable || inTrash || !selectedEntries.length || Boolean(operation), onClick: () => stageClipboard("move", selectedEntries), children: t("cut") }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", disabled: !writable || inTrash || !clipboard || Boolean(operation), onClick: pasteClipboard, children: [
              t("paste"),
              clipboard ? ` (${clipboard.entries.length})` : ""
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", disabled: !writable || inTrash || !selectedEntries.length || Boolean(operation), onClick: () => chooseTransfer("move", selectedEntries), children: t("moveAction") }),
            writable ? null : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("readOnly") }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-path", style: { marginLeft: "auto" }, children: inTrash ? t("trash") : cwd.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.PathLabel, { path: cwd }) : null })
          ] })
        ] }),
        previewOpen ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("aside", { className: "dfm-preview", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-preview-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: preview?.entry?.name ?? t("preview") }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { style: { marginLeft: "auto", display: "inline-flex", gap: 6 }, children: [
              isViewerKind(preview?.kind) ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Tooltip, { label: t("mediaPreview"), side: "bottom", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                import_dsh_client_ui_primitives3.Button,
                {
                  variant: "toolbar",
                  size: "sm",
                  icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconFullscreenOutlineRegular, { size: 16 }),
                  onClick: () => openViewer(preview.entry),
                  "aria-label": t("mediaPreview")
                }
              ) }) : null,
              preview?.kind === "text" && preview.status === "ready" && !editing ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Tooltip, { label: writable ? t("edit") : t("readOnly"), side: "bottom", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                import_dsh_client_ui_primitives3.Button,
                {
                  variant: "toolbar",
                  size: "sm",
                  icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconEditOutlineRegular, { size: 16 }),
                  disabled: !writable,
                  onClick: () => setEditing(true),
                  "aria-label": t("edit")
                }
              ) }) : null,
              editing ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { disabled: Boolean(operation) || Boolean(unconfirmed), variant: "primary", size: "sm", onClick: saveDraft, children: t("save") }),
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { disabled: Boolean(operation), variant: "ghost", size: "sm", onClick: () => {
                  if (window.confirm("\u653E\u5F03\u6B64\u6587\u4EF6\u7684\u8349\u7A3F\u5E76\u91CD\u65B0\u8BFB\u53D6\uFF1F")) {
                    forgetFileDraft(preview.entry.path);
                    showPreviewFor(preview.entry);
                  }
                }, children: "\u653E\u5F03\u8349\u7A3F" })
              ] }) : null,
              preview?.entry !== void 0 && preview.kind !== "text" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Tooltip, { label: t("openInTab"), side: "bottom", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                import_dsh_client_ui_primitives3.Button,
                {
                  variant: "toolbar",
                  size: "sm",
                  icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconRightUpOutlineRegular, { size: 16 }),
                  onClick: () => openInTab(preview.entry),
                  "aria-label": t("openInTab")
                }
              ) }) : null,
              preview?.entry !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Tooltip, { label: t("downloadAction"), side: "bottom", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                import_dsh_client_ui_primitives3.Button,
                {
                  variant: "toolbar",
                  size: "sm",
                  icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconDownloadOutlineRegular, { size: 16 }),
                  onClick: () => download(preview.entry),
                  "aria-label": t("downloadAction")
                }
              ) }) : null
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dfm-preview-body", children: preview === null ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { opacity: 0.55 }, children: t("preview") }) : preview.status === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { opacity: 0.6 }, children: t("loading") }) : isViewerKind(preview.kind) || preview.kind === "pdf" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(MediaStage, { entry: preview.entry, kind: preview.kind, t, onOpenViewer: openViewer }) : preview.status === "unsupported" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-broken", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { children: t("noPreview") }),
            preview.detail ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { marginTop: 6, opacity: 0.75 }, children: preview.detail }) : null
          ] }) : editing ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("textarea", { className: "dfm-editor", "aria-label": "\u6587\u4EF6\u6B63\u6587", disabled: Boolean(operation), value: draft, onChange: (event) => {
            const content = event.target.value;
            setDraft(content);
            if (content === preview.content) forgetFileDraft(preview.entry.path);
            else saveFileDraft(preview.entry.path, { content, revision: draftVersion, base: preview.content });
          }, spellCheck: false }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("pre", { className: "dfm-pre", children: preview.content }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(InfoRows, { rows: mediaInfoRows(preview.entry, "text", null, t) })
          ] }) })
        ] }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { display: knowledgeMode ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }, children: knowledgeMode || knowledgeVisited || knowledgeSeed ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(KnowledgePanel, { onOpenSettings: openRagSettings, api: callApi, view, typeFilter: knowledgeTypeFilter, writable, seed: knowledgeSeed, onSeedUsed: () => setKnowledgeSeed(null), streamUrl }) : null })
    ] }),
    menu !== null ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.MenuSurface, { className: "dfm-menu", style: { left: Math.max(8, menu.x), top: Math.max(8, menu.y), maxHeight: `calc(100vh - ${Math.max(8, menu.y) + 8}px)`, overflowY: "auto" }, onPointerDown: (event) => event.stopPropagation(), children: menu.entry !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        import_dsh_client_ui_primitives3.MenuItemButton,
        {
          icon: menu.entry.dir ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconFolderOpenOutlineRegular, { size: 16 }) : isPlayableKind(mediaKindOf(menu.entry)) ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconPlayOutlineRegular, { size: 16 }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconInspectOutlineRegular, { size: 16 }),
          onSelect: () => {
            setMenu(null);
            openEntry(menu.entry);
          },
          children: menu.entry.dir ? t("open") : isPlayableKind(mediaKindOf(menu.entry)) ? t("play") : t("preview")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.MenuItemButton, { icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconInspectOutlineRegular, { size: 16 }), onSelect: () => {
        setInfoEntry(menu.entry);
        setMenu(null);
      }, children: t("getInfo") }),
      !menu.entry.dir ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.MenuItemButton, { icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconRightUpOutlineRegular, { size: 16 }), onSelect: () => {
        setMenu(null);
        openInTab(menu.entry);
      }, children: t("openInTab") }) : null,
      !menu.entry.dir ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.MenuItemButton, { icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconDownloadOutlineRegular, { size: 16 }), separatorBefore: true, onSelect: () => {
        setMenu(null);
        download(menu.entry);
      }, children: t("downloadAction") }) : null,
      writable && inTrash ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          import_dsh_client_ui_primitives3.MenuItemButton,
          {
            icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconRefreshOutlineRegular, { size: 16 }),
            separatorBefore: true,
            onSelect: () => {
              setMenu(null);
              void restoreEntries(selectedEntries);
            },
            children: t("restore")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          import_dsh_client_ui_primitives3.MenuItemButton,
          {
            danger: true,
            icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconTrashOutlineRegular, { size: 16 }),
            onSelect: () => {
              setMenu(null);
              setConfirming({ action: "purge", entries: selectedEntries });
            },
            children: t("purge")
          }
        )
      ] }) : null,
      writable && !inTrash ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.MenuItemButton, { icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconCopyOutlineRegular, { size: 16 }), separatorBefore: true, onSelect: () => {
          setMenu(null);
          stageClipboard("copy", selectedEntries);
        }, children: t("copy") }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.MenuItemButton, { onSelect: () => {
          setMenu(null);
          stageClipboard("move", selectedEntries);
        }, children: t("cut") }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.MenuItemButton, { disabled: !clipboard, onSelect: () => {
          setMenu(null);
          pasteClipboard();
        }, children: t("paste") }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.MenuItemButton, { icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconCopyOutlineRegular, { size: 16 }), separatorBefore: true, onSelect: () => {
          setMenu(null);
          chooseTransfer("copy", selectedEntries);
        }, children: t("copyAction") }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.MenuItemButton, { onSelect: () => {
          setMenu(null);
          chooseTransfer("move", selectedEntries);
        }, children: t("moveAction") }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.MenuItemButton, { icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconEditOutlineRegular, { size: 16 }), separatorBefore: true, onSelect: () => {
          setMenu(null);
          setPrompt({ kind: "rename", entry: menu.entry, value: menu.entry.name });
        }, children: t("rename") }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.MenuItemButton, { danger: true, icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconTrashOutlineRegular, { size: 16 }), onSelect: () => {
          setMenu(null);
          askRemove(selectedEntries);
        }, children: t("remove") })
      ] }) : null
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        import_dsh_client_ui_primitives3.MenuItemButton,
        {
          icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconPlusOutlineRegular, { size: 16 }),
          disabled: !writable || inTrash,
          onSelect: () => {
            setMenu(null);
            setPrompt({ kind: "mkdir", value: "" });
          },
          children: t("newFolder")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        import_dsh_client_ui_primitives3.MenuItemButton,
        {
          icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconCopyOutlineRegular, { size: 16 }),
          disabled: !writable || inTrash || !clipboard,
          onSelect: () => {
            setMenu(null);
            pasteClipboard();
          },
          children: t("paste")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.MenuItemButton, { icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconRefreshOutlineRegular, { size: 16 }), separatorBefore: true, onSelect: () => {
        setMenu(null);
        refresh();
      }, children: t("refresh") }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_dsh_client_ui_primitives3.MenuItemButton, { onSelect: () => {
        setMenu(null);
        setShowHidden((value) => !value);
      }, children: [
        showHidden ? "\u2713 " : "",
        t("showHidden")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
        import_dsh_client_ui_primitives3.MenuItemButton,
        {
          disabled: !thumbnailsAllowed,
          onSelect: () => {
            setMenu(null);
            setThumbnails((value) => !value);
          },
          children: [
            thumbnails ? "\u2713 " : "",
            t("showThumbnails")
          ]
        }
      ),
      inTrash && writable ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        import_dsh_client_ui_primitives3.MenuItemButton,
        {
          danger: true,
          icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconTrashOutlineRegular, { size: 16 }),
          separatorBefore: true,
          onSelect: () => {
            setMenu(null);
            setConfirming({ action: "empty", entries: [] });
          },
          children: t("emptyTrash")
        }
      ) : null
    ] }) }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      import_dsh_client_ui_primitives3.Modal,
      {
        open: infoEntry !== null,
        onClose: () => setInfoEntry(null),
        title: t("getInfo"),
        closeLabel: t("close"),
        footer: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "primary", onClick: () => setInfoEntry(null), children: t("close") }),
        children: infoEntry ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { minWidth: 280, maxWidth: 560 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(TypeIcon, { entry: infoEntry, size: 48 }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("strong", { style: { overflowWrap: "anywhere" }, children: infoEntry.name })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(InfoRows, { rows: [
            [t("name"), infoEntry.name],
            ...mediaInfoRows(infoEntry, infoEntry.dir ? "dir" : mediaKindOf(infoEntry), null, t).map(([key, value]) => [key, key === t("size") ? entrySize(infoEntry) : key === t("modified") ? new Date(infoEntry.mtime).toLocaleString() : key === t("kindLabel") && infoEntry.link ? t("symbolicLink") : value]),
            [t("fullPath"), infoEntry.path],
            [t("permissions"), infoEntry.mode ?? "\u2014"]
          ] }),
          infoEntry.dir && !infoEntry.link ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", disabled: !!sizePending, onClick: () => measureFolder(infoEntry), children: t("calculateSize") }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "dfm-dim", style: { fontSize: 12, marginTop: 16 }, children: t("infoSnapshot") })
        ] }) : null
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      import_dsh_client_ui_primitives3.Modal,
      {
        open: destination !== null,
        onClose: () => {
          if (!mutationRef.current) setDestination(null);
        },
        title: destination?.route === "move" ? t("moveAction") : t("copyAction"),
        closeLabel: t("cancel"),
        footer: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", disabled: Boolean(operation), onClick: () => setDestination(null), children: t("cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "primary", disabled: Boolean(operation) || !destinationListing || destinationListing.trash || destinationListing.requestedPath !== destination?.path || destinationInput.trim() !== destination?.path, onClick: () => void transfer(destination.route, destination.entries, destinationListing.path), children: t("chooseDestination") })
        ] }),
        children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { minWidth: 300, maxWidth: 560 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("p", { children: [
            destination?.entries.length,
            " ",
            t("items")
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("form", { onSubmit: (event) => {
            event.preventDefault();
            if (destinationInput.trim()) setDestination({ ...destination, path: destinationInput.trim(), revision: (destination.revision ?? 0) + 1 });
          }, style: { display: "flex", gap: 8 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Input, { "aria-label": t("destination"), value: destinationInput, disabled: Boolean(operation), onChange: (event) => setDestinationInput(event.target.value) }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { type: "submit", disabled: Boolean(operation), children: t("open") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { style: { overflowWrap: "anywhere" }, children: destinationListing?.path }),
          destinationError ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { role: "alert", children: destinationError }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", flexDirection: "column", maxHeight: 300, overflow: "auto", gap: 4 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", disabled: Boolean(operation) || !destinationListing?.parent, onClick: () => setDestination({ ...destination, path: destinationListing.parent }), children: t("parent") }),
            (destinationListing?.entries ?? []).filter((entry) => entry.dir).map((entry) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", disabled: Boolean(operation), onClick: () => setDestination({ ...destination, path: entry.path }), children: [
              "\u{1F4C1} ",
              entry.name
            ] }, entry.path))
          ] })
        ] })
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      import_dsh_client_ui_primitives3.Modal,
      {
        open: prompt !== null,
        onClose: () => {
          if (!mutationRef.current) setPrompt(null);
        },
        title: prompt?.kind === "rename" ? t("rename") : t("newFolder"),
        closeLabel: t("cancel"),
        footer: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", disabled: Boolean(operation), onClick: () => setPrompt(null), children: t("cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            import_dsh_client_ui_primitives3.Button,
            {
              variant: "primary",
              disabled: Boolean(operation),
              onClick: () => {
                const value = (prompt?.value ?? "").trim();
                if (value.length === 0) return;
                if (prompt?.kind === "rename") void renameEntry(prompt.entry, value);
                else void createFolder(value);
              },
              children: prompt?.kind === "rename" ? t("confirm") : t("create")
            }
          )
        ] }),
        children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-dialog-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-dialog-label", children: prompt?.kind === "rename" ? t("newName") : t("folderName") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            import_dsh_client_ui_primitives3.Input,
            {
              "data-modal-autofocus": true,
              disabled: Boolean(operation),
              value: prompt?.value ?? "",
              onChange: (event) => setPrompt({ ...prompt, value: event.target.value }),
              onKeyDown: (event) => {
                if (event.key !== "Enter") return;
                const value = (prompt?.value ?? "").trim();
                if (value.length === 0) return;
                if (prompt?.kind === "rename") void renameEntry(prompt.entry, value);
                else void createFolder(value);
              }
            }
          )
        ] })
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      import_dsh_client_ui_primitives3.Modal,
      {
        open: confirming !== null,
        onClose: () => {
          if (!mutationRef.current) setConfirming(null);
        },
        title: confirmSpec?.title ?? t("confirmTitle"),
        closeLabel: t("cancel"),
        description: confirmSpec?.body,
        footer: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", disabled: Boolean(operation), onClick: () => setConfirming(null), children: t("cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "primary", disabled: Boolean(operation), onClick: () => void confirmSpec?.run(), children: confirmSpec?.ok ?? t("confirm") })
        ] }),
        children: (confirming?.entries ?? []).length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { margin: 0, padding: 0, listStyle: "none" }, children: [
          (confirming?.entries ?? []).slice(0, 12).map((entry) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "3px 0", opacity: 0.85 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(TypeIcon, { entry, size: 22 }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dfm-name-text", children: entry.name })
          ] }, entry.path)),
          (confirming?.entries ?? []).length > 12 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { opacity: 0.6 }, children: "\u2026" }) : null
        ] })
      }
    ),
    unconfirmed && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-notice", style: { position: "relative", flex: "none", margin: 8, display: "block" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: "\u4E0A\u6B21\u6587\u4EF6\u64CD\u4F5C\u7ED3\u679C\u5C1A\u672A\u786E\u8BA4\uFF0C\u5DF2\u6682\u505C\u65B0\u7684\u5199\u64CD\u4F5C\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { onClick: reconcileOperation, children: "\u6838\u5BF9\u4E0A\u6B21\u64CD\u4F5C" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { onClick: () => {
        if (window.confirm("\u786E\u8BA4\u5DF2\u68C0\u67E5\u76F8\u5173\u6587\u4EF6\uFF1F\u89E3\u9664\u540E\u53EF\u4EE5\u53D1\u8D77\u65B0\u64CD\u4F5C\uFF0C\u8BF7\u52FF\u91CD\u590D\u5DF2\u5B8C\u6210\u7684\u64CD\u4F5C\u3002")) {
          unconfirmedOperation = null;
          rememberOperation(null);
          setUnconfirmed(null);
        }
      }, children: "\u5DF2\u6838\u5BF9\u6587\u4EF6\uFF0C\u89E3\u9664\u4FDD\u62A4" })
    ] }),
    operation && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { role: "status", className: "dfm-notice", style: { position: "absolute", bottom: 44, right: 16, zIndex: 100 }, children: "\u6B63\u5728\u6267\u884C\u6587\u4EF6\u64CD\u4F5C\uFF0C\u8BF7\u7A0D\u5019\u2026" }),
    batchReport && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { role: "status", className: "dfm-notice", style: { position: "absolute", bottom: 44, left: 190, zIndex: 10, maxHeight: 220, maxWidth: 460, overflow: "auto", display: "block" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { onClick: () => setBatchReport(null), style: { float: "right" }, children: "\u5173\u95ED" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
        "\u6210\u529F ",
        batchReport.filter((r) => r.ok).length,
        " \u9879 / \u5931\u8D25 ",
        batchReport.filter((r) => !r.ok).length,
        " \u9879"
      ] }),
      batchReport.map((r, i) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { overflowWrap: "anywhere" }, children: [
        r.ok ? "\u2713" : "\xD7",
        " ",
        baseName(r.path),
        r.error ? "\uFF1A" + r.error : ""
      ] }, i))
    ] }),
    notice !== null ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dfm-notice", style: { position: "absolute", right: 16, bottom: 44, margin: 0 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconWarningOutlineRegular, { size: 16, style: { opacity: notice.tone === "ok" ? 0.4 : 1 } }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: notice.text })
    ] }) : null,
    viewer !== null ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      MediaViewer,
      {
        items: viewer.items,
        index: viewer.index,
        onIndexChange: goToViewerIndex,
        onClose: () => setViewer(null),
        t
      }
    ) : null
  ] });
}
var NS = "dsh-fileman";
var inject = ["slots", "locale"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-fileman: dictionaries");
  const t = ctx.locale.bind(NS);
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "knowledge-rag",
    order: 45,
    label: "\u77E5\u8BC6\u5E93\u5904\u7406\u4E0E\u68C0\u7D22"
  }, confirmKnowledgeRagSection(KnowledgeRagSettingsSection)));
  registerKnowledgeSettingsNavigation(ctx, FilemanPanel, PANEL_ID);
  registerLaunchpadApp(ctx, {
    id: PANEL_ID,
    name: t("panel"),
    description: "\u6D4F\u89C8\u548C\u7BA1\u7406\u5DE5\u4F5C\u533A\u6587\u4EF6\uFF0C\u9884\u89C8\u56FE\u7247\u3001\u89C6\u9891\u4E0E\u6587\u6863\u3002",
    icon: FilemanPanelIcon,
    order: 10
  }, "fileman");
}

    return module.exports;
  },
});
