import { captureDrop } from './knowledge-import.js'
import { FILE_TYPES, fileType } from '../lib/file-types.js'
import { TypeIcon, TypeBadge } from './type-visual.jsx'
import { useWindowedEntries } from './windowed.js'
import { KnowledgePanel, ViewButtons } from './knowledge.jsx'
import { KnowledgeRagSettingsSection } from './knowledge-rag-entry.jsx'
import { registerKnowledgeSettingsNavigation, confirmKnowledgeRagSection, RAG_SETTINGS_ID } from './knowledge-rag-navigation.jsx'
import { registerLaunchpadApp } from './launchpad-bridge.js'


import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { fileIconProps } from './icon-props.js'
import { formatClock, isPlayableKind, isThumbnailableKind, isViewerKind, mediaKindOf, viewerItemsOf } from './media.js'

import {
  Button,
  FileTypeIcon,
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconChevronUpOutlineRegular,
  IconChevronRightOutlineRegular as IconBreadcrumbSeparator,
  IconCloseOutlineRegular,
  IconCompactOutlineRegular,
  IconCopyOutlineRegular,
  IconDownloadOutlineRegular,
  IconEditOutlineRegular,
  IconEllipsisOutlineRegular,
  IconFlatListOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconFolderOpenRegular,
  IconFullscreenOutlineRegular,
  IconInfoOutlineRegular,
  IconInspectOutlineRegular,
  IconPlayOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconRightUpOutlineRegular,
  IconSearchOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
  Input,
  MenuItemButton,
  MenuSurface,
  Modal,
  PathLabel,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'


const API = '/dsh-fileman'


const PANEL_ID = 'fileman'


const zh = {
  panel: '文件管理器',
  locations: '位置',
  home: '主目录',
  desktop: '桌面',
  document: '文档',
  download: '下载',
  picture: '图片',
  music: '音乐',
  video: '影片',
  public: '公共',
  root: '根目录',
  empty: '此文件夹为空',
  loading: '正在读取…',
  failed: '读取失败',
  name: '名称',
  size: '大小', sizeCalculating:'计算中…', sizeNotCalculated:'未计算', sizePartial:'未完成', calculateSize:'计算大小', sizeNote:'文件内容大小合计；含隐藏文件，不跟随符号链接。结果为本次快照，刷新后需重算。',
  modified: '修改日期',
  items: '项',
  selected: '选中',
  search: '搜索',
  newFolder: '新建文件夹',
  rename: '重命名', getInfo:'显示简介', fullPath:'位置', permissions:'权限（八进制）', symbolicLink:'符号链接', infoSnapshot:'信息来自当前目录快照；文件夹大小为文件内容合计。',
  remove: '移到废纸篓',
  trash: '废纸篓',
  emptyTrash: '清空废纸篓',
  restore: '放回原处',
  purge: '彻底删除',
  downloadAction: '下载',
  preview: '预览',
  edit: '编辑',
  save: '保存',
  cancel: '取消',
  create: '创建',
  confirm: '确定',
  parent: '上级',
  back: '后退',
  forward: '前进',
  refresh: '刷新',
  listView: '列表视图',
  iconView: '图标视图',
  showHidden: '显示隐藏项目',
  hidePreview: '隐藏预览',
  showPreview: '显示预览',
  open: '打开',
  revealPath: '所在位置',
  copied: '已复制',
  moved: '已移动',
  trashed: '已移入废纸篓',
  deleted: '已删除',
  restored: '已放回原处',
  purged: '已彻底删除',
  emptied: '废纸篓已清空',
  saved: '已保存',
  noPreview: '该类型不支持预览',
  readOnly: '只读模式',
  confirmTitle: '确定要删除吗？',
  confirmBody: '删除后将移入服务器废纸篓，可从废纸篓恢复。',
  restoreTitle: '要放回原处吗？',
  restoreBody: '这些项目将回到删除前所在的位置。',
  purgeTitle: '要彻底删除吗？',
  purgeBody: '这些项目将被永久删除，之后无法恢复。',
  emptyTrashTitle: '要清空废纸篓吗？',
  emptyTrashBody: '废纸篓中的所有项目都将被永久删除，此操作无法撤销。',
  folderName: '文件夹名称',
  newName: '新名称',
  unsaved: '有未保存的修改',
  copy: '复制', cut: '剪切', paste: '粘贴', destination: '目标文件夹', chooseDestination: '选择此文件夹', clipboardReady: '已放入文件剪贴板',
  copyAction: '拷贝到…',
  moveAction: '移动到…',
  selectHere: '拷贝/移动到当前文件夹',
  errorTitle: '操作失败',
  originalPath: '原位置',
  deletedAt: '删除时间',
  trashNote: '废纸篓中不能新建项目',

  viewer: '媒体查看器',
  play: '播放',
  mediaPreview: '媒体预览',
  openInTab: '在新标签页打开',
  previous: '上一个',
  next: '下一个',
  close: '关闭',
  fitMode: '适应窗口',
  actualMode: '实际大小',
  mediaLoading: '正在加载媒体…',
  mediaUnsupported: '浏览器无法播放此格式，可下载后用本地播放器打开',
  mediaBroken: '媒体加载失败',
  showThumbnails: '显示缩略图',
  info: '简介',
  dimensions: '尺寸',
  duration: '时长',
  kindLabel: '种类',
  where: '位置',
  audioTrack: '音频',
  kindDir: '文件夹',
  kindImage: '图片',
  kindVideo: '视频',
  kindAudio: '音频',
  kindPdf: 'PDF 文档',
  kindText: '文本',
  kindFile: '文件',
}

const en = {
  panel: 'File Manager',
  locations: 'Locations',
  home: 'Home',
  desktop: 'Desktop',
  document: 'Documents',
  download: 'Downloads',
  picture: 'Pictures',
  music: 'Music',
  video: 'Movies',
  public: 'Public',
  root: 'Root',
  empty: 'This folder is empty',
  loading: 'Reading…',
  failed: 'Could not read',
  name: 'Name',
  size: 'Size', sizeCalculating:'Calculating…', sizeNotCalculated:'Not calculated', sizePartial:'Partial', calculateSize:'Calculate size', sizeNote:'Total file bytes, including hidden files; symlinks excluded. Snapshot only; refresh to recalculate.',
  modified: 'Date Modified',
  items: 'items',
  selected: 'selected',
  search: 'Search',
  newFolder: 'New Folder',
  rename: 'Rename', getInfo:'Get Info', fullPath:'Location', permissions:'Permissions (octal)', symbolicLink:'Symbolic link', infoSnapshot:'Information from the current directory snapshot; folder size totals file contents.',
  remove: 'Move to Trash',
  trash: 'Trash',
  emptyTrash: 'Empty Trash',
  restore: 'Put Back',
  purge: 'Delete Permanently',
  downloadAction: 'Download',
  preview: 'Preview',
  edit: 'Edit',
  save: 'Save',
  cancel: 'Cancel',
  create: 'Create',
  confirm: 'OK',
  parent: 'Enclosing Folder',
  back: 'Back',
  forward: 'Forward',
  refresh: 'Refresh',
  listView: 'List View',
  iconView: 'Icon View',
  showHidden: 'Show Hidden Items',
  hidePreview: 'Hide Preview',
  showPreview: 'Show Preview',
  open: 'Open',
  revealPath: 'Reveal in Path',
  copied: 'Copied',
  moved: 'Moved',
  trashed: 'Moved to Trash',
  deleted: 'Deleted',
  restored: 'Put Back',
  purged: 'Deleted Permanently',
  emptied: 'Trash Emptied',
  saved: 'Saved',
  noPreview: 'No preview for this type',
  readOnly: 'Read-only',
  confirmTitle: 'Delete these items?',
  confirmBody: 'They move to the server trash and can be restored from it.',
  restoreTitle: 'Put these items back?',
  restoreBody: 'They return to the location they were deleted from.',
  purgeTitle: 'Delete permanently?',
  purgeBody: 'These items will be gone for good and cannot be recovered.',
  emptyTrashTitle: 'Empty the Trash?',
  emptyTrashBody: 'Everything in the Trash is permanently deleted. This cannot be undone.',
  folderName: 'Folder name',
  newName: 'New name',
  unsaved: 'Unsaved changes',
  copy: 'Copy', cut: 'Cut', paste: 'Paste', destination: 'Destination folder', chooseDestination: 'Choose this folder', clipboardReady: 'Added to file clipboard',
  copyAction: 'Copy to…',
  moveAction: 'Move to…',
  selectHere: 'Copy/Move into the current folder',
  errorTitle: 'Action failed',
  originalPath: 'Original Location',
  deletedAt: 'Date Deleted',
  trashNote: 'Cannot create items in the Trash',

  viewer: 'Media Viewer',
  play: 'Play',
  mediaPreview: 'Media Preview',
  openInTab: 'Open in New Tab',
  previous: 'Previous',
  next: 'Next',
  close: 'Close',
  fitMode: 'Fit',
  actualMode: 'Actual Size',
  mediaLoading: 'Loading media…',
  mediaUnsupported: 'This format cannot play in the browser. Download it and open it locally.',
  mediaBroken: 'Could not load media',
  showThumbnails: 'Show Thumbnails',
  info: 'Info',
  dimensions: 'Dimensions',
  duration: 'Duration',
  kindLabel: 'Kind',
  where: 'Where',
  audioTrack: 'Audio',
  kindDir: 'Folder',
  kindImage: 'Image',
  kindVideo: 'Video',
  kindAudio: 'Audio',
  kindPdf: 'PDF Document',
  kindText: 'Text',
  kindFile: 'Document',
}


const LOCATION_PRESENTATION = {
  home: { icon: IconFolderOpenRegular, key: 'home' },
  desktop: { icon: IconFolderOpenOutlineRegular, key: 'desktop' },
  document: { icon: IconFolderOpenOutlineRegular, key: 'document' },
  download: { icon: IconFolderOpenOutlineRegular, key: 'download' },
  picture: { icon: IconFolderOpenOutlineRegular, key: 'picture' },
  music: { icon: IconFolderOpenOutlineRegular, key: 'music' },
  video: { icon: IconFolderOpenOutlineRegular, key: 'video' },
  public: { icon: IconFolderOpenOutlineRegular, key: 'public' },

  trash: { icon: IconTrashOutlineRegular, key: 'trash' },
  root: { icon: IconFolderOpenOutlineRegular, key: 'root' },
}


const STYLE_ID = 'dsh-fileman-styles'


const CSS = `
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
/* ── 媒体：面板内预览 ── */
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
/* 访达式「简介」 */
.dfm-info {
  margin-top: 14px; padding-top: 10px; display: grid;
  grid-template-columns: auto minmax(0, 1fr); gap: 5px 12px; font-size: 11px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, .16));
}
.dfm-info-key { color: var(--dsw-alias-label-tertiary, currentColor); white-space: nowrap; }
.dfm-info-val { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* 缩略图（图标视图用原图，列表视图不用） */
.dfm-thumb-box {
  position: relative; width: 80px; height: 80px; flex: none;
  display: grid; place-items: center; overflow: hidden;
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-base, rgba(127, 127, 127, .07));
}
.dfm-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
/* 类选择器的 display 会盖掉 [hidden] 的 display:none，这里补回来 */
.dfm-thumb[hidden] { display: none; }
.dfm-thumb-fallback { position: absolute; inset: 0; display: grid; place-items: center; }
/* ── 媒体查看器：同一目录内连续浏览 ── */
.dfm-viewer { position: fixed; inset: 0; z-index: 90; display: flex; flex-direction: column; }
.dfm-viewer-mask {
  position: absolute; inset: 0;
  /* 不用 --dsw-alias-bg-mask-1：本版本它只有 24% 黑、且 --dsw-mask-blur 是 none，
     底下的应用界面几乎原样透出来，标题会和侧边栏 Logo 撞在一起。这里按主题底色
     做一层高不透明度的实遮罩，浅色主题是乳白、深色主题是深灰，两种都压得住。 */
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
`


function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}


function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value >= 100 || unit === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}


function formatDate(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const date = new Date(ms)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  const pad = (value) => String(value).padStart(2, '0')
  const tail = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return sameYear
    ? `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${tail}`
    : `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
}


function crumbsOf(path) {
  if (typeof path !== 'string' || path.length === 0) return []
  const parts = path.split('/').filter((part) => part.length > 0)
  const out = [{ label: '/', path: '/' }]
  let cursor = ''
  for (const part of parts) {
    cursor += `/${part}`
    out.push({ label: part, path: cursor })
  }
  return out
}


function baseName(path) {
  if (typeof path !== 'string' || path.length === 0) return '/'
  const trimmed = path.replace(/\/+$/u, '')
  const cut = trimmed.lastIndexOf('/')
  return cut < 0 ? trimmed : (trimmed.slice(cut + 1) || '/')
}


async function callApi(route, options = {}) {
  const { method = 'GET', params, body, signal } = options
  const url = new URL(`${API}/${route}`, window.location.origin)
  if (params !== undefined) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && (value !== '' || key === 'parent')) url.searchParams.set(key, String(value))
    }
  }
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    signal,
    headers: method === 'GET'
      ? undefined
      : { 'content-type': 'application/json', 'x-dsh-fileman': '1' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) {
    const message = payload !== null && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`
    const error = new Error(message)
    error.status = response.status
    throw error
  }
  return payload
}


export function FilemanPanelIcon({ size }) {
  return <IconFolderOpenRegular size={size} />
}


const KIND_LABEL_KEYS = {
  dir: 'kindDir',
  image: 'kindImage',
  video: 'kindVideo',
  audio: 'kindAudio',
  pdf: 'kindPdf',
  text: 'kindText',
  file: 'kindFile',
}


function streamUrl(path) {
  const url = new URL(`${API}/download`, window.location.origin)
  url.searchParams.set('path', path)
  url.searchParams.set('inline', '1')
  return url.toString()
}


const THUMBNAIL_MAX_BYTES = 12 * 1024 * 1024


function InfoRows({ rows }) {
  return (
    <div className="dfm-info">
      {rows.map(([key, value]) => (
        <Fragment key={key}>
          <span className="dfm-info-key">{key}</span>
          <span className="dfm-info-val" title={value}>{value}</span>
        </Fragment>
      ))}
    </div>
  )
}


function mediaInfoRows(entry, kind, meta, t) {
  const rows = [
    [t('kindLabel'), t(KIND_LABEL_KEYS[kind] ?? 'kindFile')],
    [t('size'), formatSize(entry.size)],
  ]
  if (Number.isFinite(meta?.width) && Number.isFinite(meta?.height) && meta.width > 0) {
    rows.push([t('dimensions'), `${meta.width} × ${meta.height}`])
  }
  if (isPlayableKind(kind)) rows.push([t('duration'), formatClock(meta?.duration)])
  rows.push([t('modified'), formatDate(entry.mtime)])

  if (typeof entry.original === 'string' && entry.original.length > 0) {
    rows.push([t('originalPath'), entry.original])
  }
  if (typeof entry.deletedAt === 'string' && entry.deletedAt.length > 0) {
    rows.push([t('deletedAt'), entry.deletedAt])
  }
  return rows
}


function MediaStage({ entry, kind, t, onOpenViewer }) {
  const [meta, setMeta] = useState(null)
  const [failed, setFailed] = useState(false)
  const src = streamUrl(entry.path)


  useEffect(() => {
    setMeta(null)
    setFailed(false)
  }, [entry.path])

  if (failed) return <div className="dfm-broken">{t('mediaBroken')}</div>

  if (kind === 'image') {
    return (
      <div className="dfm-stage">
        <img
          className="dfm-stage-media dfm-stage-image"
          src={src}
          alt={entry.name}
          title={t('mediaPreview')}
          onClick={() => onOpenViewer(entry)}
          onLoad={(event) => setMeta({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })}
          onError={() => setFailed(true)}
        />
        <InfoRows rows={mediaInfoRows(entry, kind, meta, t)} />
      </div>
    )
  }

  if (kind === 'video') {
    return (
      <div className="dfm-stage">
        <video
          className="dfm-stage-media dfm-stage-video"
          src={src}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => setMeta({
            duration: event.currentTarget.duration,
            width: event.currentTarget.videoWidth,
            height: event.currentTarget.videoHeight,
          })}
          onError={() => setFailed(true)}
        />
        <InfoRows rows={mediaInfoRows(entry, kind, meta, t)} />
      </div>
    )
  }

  if (kind === 'audio') {
    return (
      <div className="dfm-stage">
        <div className="dfm-audio-card">
          <TypeIcon entry={entry} size={80} />
          <span className="dfm-audio-name" title={entry.name}>{entry.name}</span>
          <audio
            src={src}
            controls
            preload="metadata"
            onLoadedMetadata={(event) => setMeta({ duration: event.currentTarget.duration })}
            onError={() => setFailed(true)}
          />
        </div>
        <InfoRows rows={mediaInfoRows(entry, kind, meta, t)} />
      </div>
    )
  }

  if (kind === 'pdf') {
    return (
      <div className="dfm-stage">
        <iframe className="dfm-stage-frame" src={src} title={entry.name} />
        <InfoRows rows={mediaInfoRows(entry, kind, meta, t)} />
      </div>
    )
  }

  return <div className="dfm-broken">{t('mediaUnsupported')}</div>
}


function Thumb({ entry, kind, enabled }) {
  const ref=useRef(null),[visible,setVisible]=useState(false),[failed,setFailed]=useState(false)
  useEffect(()=>{setFailed(false);setVisible(false);const observer=new IntersectionObserver(([e])=>setVisible(e.isIntersecting),{rootMargin:'100px'});if(ref.current)observer.observe(ref.current);return()=>observer.disconnect()},[entry.path,entry.mtime,enabled])
  const usable=enabled && isThumbnailableKind(kind) && entry.size>0 && entry.size<=256*1024*1024
  const url=`${API}/thumbnail?path=${encodeURIComponent(entry.path)}&v=${entry.mtime}-${entry.size}`
  return <span className="dfm-thumb-box" ref={ref}>{usable&&visible&&!failed?<img className="dfm-thumb" src={url} alt="" decoding="async" onError={()=>setFailed(true)}/>:<TypeIcon entry={entry} size={80}/>}</span>
}


function MediaViewer({ items, index, onIndexChange, onClose, t }) {
  const entry = items[index]
  const [actualSize, setActualSize] = useState(false)
  const [failed, setFailed] = useState(false)
  const mediaRef = useRef(null)
  const kind = entry === undefined ? 'file' : mediaKindOf(entry)


  useEffect(() => {
    setActualSize(false)
    setFailed(false)
  }, [entry?.path])

  const step = useCallback((delta) => {
    const next = index + delta
    if (next >= 0 && next < items.length) onIndexChange(next)
  }, [index, items.length, onIndexChange])


  const togglePlayback = useCallback(() => {
    const element = mediaRef.current
    if (element === null || typeof element.pause !== 'function') return
    if (element.paused) void element.play().catch(() => {})
    else element.pause()
  }, [])


  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        event.stopPropagation()
        step(-1)
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        event.stopPropagation()
        step(1)
        return
      }
      if (event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        togglePlayback()
        return
      }
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, step, togglePlayback])


  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  if (entry === undefined || typeof document === 'undefined') return null
  const src = streamUrl(entry.path)

  let body
  if (failed) {
    body = <div className="dfm-broken">{t('mediaBroken')}</div>
  } else if (kind === 'image') {
    body = (
      <img
        ref={mediaRef}
        className="dfm-viewer-media"
        data-actual={actualSize}
        src={src}
        alt={entry.name}
        onClick={() => setActualSize((value) => !value)}
        onError={() => setFailed(true)}
      />
    )
  } else if (kind === 'video') {
    body = (
      <video
        ref={mediaRef}
        className="dfm-viewer-media"
        src={src}
        controls
        autoPlay
        playsInline
        onError={() => setFailed(true)}
      />
    )
  } else if (kind === 'audio') {
    body = (
      <div className="dfm-viewer-audio">
        <TypeIcon entry={entry} size={80} />
        <span className="dfm-audio-name" title={entry.name}>{entry.name}</span>
        <audio ref={mediaRef} src={src} controls autoPlay onError={() => setFailed(true)} />
      </div>
    )
  } else {
    body = <div className="dfm-broken">{t('mediaUnsupported')}</div>
  }

  return createPortal(
    <div className="dfm-viewer" role="dialog" aria-modal="true" aria-label={t('viewer')}>
      <div className="dfm-viewer-mask" onClick={onClose} />
      <div className="dfm-viewer-bar">
        <span className="dfm-viewer-title" title={entry.name}>{entry.name}</span>
        <span className="dfm-viewer-counter">{index + 1} / {items.length}</span>
        <span className="dfm-viewer-tools">
          {
                                                     }
          {kind === 'image' ? (
            <Tooltip label={actualSize ? t('fitMode') : t('actualMode')} side="bottom" delayMs={400}>
              <Button
                variant="ghost"
                size="sm"
                icon={<IconFullscreenOutlineRegular size={16} />}
                onClick={() => setActualSize((value) => !value)}
                aria-label={actualSize ? t('fitMode') : t('actualMode')}
              />
            </Tooltip>
          ) : null}
          <Tooltip label={t('openInTab')} side="bottom" delayMs={400}>
            <Button
              variant="ghost"
              size="sm"
              icon={<IconRightUpOutlineRegular size={16} />}
              onClick={() => window.open(src, '_blank', 'noopener')}
              aria-label={t('openInTab')}
            />
          </Tooltip>
          <Tooltip label={t('close')} side="bottom" delayMs={400}>
            <Button
              variant="ghost"
              size="sm"
              icon={<IconCloseOutlineRegular size={16} />}
              onClick={onClose}
              aria-label={t('close')}
            />
          </Tooltip>
        </span>
      </div>
      <div className="dfm-viewer-stage" data-actual={actualSize && kind === 'image'}>
        <button
          type="button"
          className="dfm-viewer-nav"
          data-side="left"
          disabled={index <= 0}
          onClick={() => step(-1)}
          aria-label={t('previous')}
        >
          <IconChevronLeftOutlineRegular size={18} />
        </button>
        {body}
        <button
          type="button"
          className="dfm-viewer-nav"
          data-side="right"
          disabled={index >= items.length - 1}
          onClick={() => step(1)}
          aria-label={t('next')}
        >
          <IconChevronRightOutlineRegular size={18} />
        </button>
      </div>
    </div>,
    document.body,
  )
}


const FILEMAN_BROWSE_KEY='dsh-fileman:browse:v1'
const FILEMAN_DRAFTS_KEY='dsh-fileman:drafts:v1'
function readBrowseState(){try{const value=JSON.parse(localStorage.getItem(FILEMAN_BROWSE_KEY)||'null');return value&&typeof value==='object'?value:{}}catch{return {}}}
function readFileDrafts(){try{const rows=JSON.parse(sessionStorage.getItem(FILEMAN_DRAFTS_KEY)||'{}');return new Map(Object.entries(rows).filter(([,row])=>row&&typeof row.content==='string'&&row.content.length<=256*1024))}catch{return new Map()}}
const fileDrafts = readFileDrafts()
function persistFileDrafts(){try{const rows={};let size=0;for(const [path,row] of [...fileDrafts].reverse()){const bytes=JSON.stringify([path,row]).length;if(size+bytes>256*1024)continue;rows[path]=row;size+=bytes}sessionStorage.setItem(FILEMAN_DRAFTS_KEY,JSON.stringify(rows))}catch{}}
function saveFileDraft(path,row){fileDrafts.set(path,row);persistFileDrafts()}
function forgetFileDraft(path){fileDrafts.delete(path);persistFileDrafts()}
function readUnconfirmed(){try{return JSON.parse(sessionStorage.getItem('dfm-unconfirmed')||'null')}catch{return null}}
function rememberOperation(value){try{if(value)sessionStorage.setItem('dfm-unconfirmed',JSON.stringify(value));else sessionStorage.removeItem('dfm-unconfirmed')}catch{}}
let unconfirmedOperation = readUnconfirmed()


let fileClipboard = null

export function FilemanPanel({ actions, navigationIsCurrent } = {}) {
  const openRagSettings = useCallback(() => {
    if (!navigationIsCurrent?.() || typeof actions?.openSection !== 'function') return false
    actions.openSection(RAG_SETTINGS_ID)
    return true
  }, [actions, navigationIsCurrent])

  const strings = (typeof navigator !== 'undefined' && /^en/i.test(navigator.language ?? '')) ? en : zh

  const t = useCallback((key) => strings[key] ?? key, [strings])

  const [locations, setLocations] = useState([])
  const [root, setRoot] = useState('')
  const [browseReady,setBrowseReady]=useState(false)
  const [cwd, setCwd] = useState('')
  const [stack, setStack] = useState([])
  const [cursor, setCursor] = useState(-1)
  const [listing, setListing] = useState(null)
  const [folderSizes,setFolderSizes]=useState({})
  const [sizePending,setSizePending]=useState(null)
  const sizeRequest=useRef(null)
  async function measureFolder(entry){
    if(sizeRequest.current || entry.link)return
    const controller=new AbortController();sizeRequest.current=controller;setSizePending(entry.path)
    try {
      const result=await callApi('directory-size',{params:{path:entry.path},signal:controller.signal})
      if(!controller.signal.aborted)setFolderSizes(prev=>({...prev,[entry.path]:result}))
    }catch(e){if(!controller.signal.aborted)setError(e.message)}
    finally{if(sizeRequest.current===controller){sizeRequest.current=null;setSizePending(null)}}
  }
  function entrySize(entry){
    if(!entry.dir)return formatSize(entry.size)
    if(entry.link)return '—'
    if(sizePending===entry.path)return t('sizeCalculating')
    const result=folderSizes[entry.path]
    return result?`${result.complete?'':'≥ '}${formatSize(result.bytes)}${result.complete?'':' · '+t('sizePartial')}`:t('sizeNotCalculated')
  }

  const [pending, setPending] = useState(true)
  const [reload,setReload] = useState(0)
  useEffect(()=>{setFolderSizes({});sizeRequest.current?.abort();setSizePending(null);return()=>sizeRequest.current?.abort()},[cwd,reload])

  const [operation,setOperation] = useState(null)
  const [unconfirmed,setUnconfirmed] = useState(unconfirmedOperation)
  const [batchReport,setBatchReport] = useState(null)
  const mutationRef = useRef(null)
  const mountedRef = useRef(true)
  const currentRef = useRef({})
  const previewRequest = useRef(0)
  const [draftVersion,setDraftVersion] = useState(null)
  useEffect(()=>{mountedRef.current=true;return()=>{mountedRef.current=false;previewRequest.current++}},[])

  const [error, setError] = useState(null)
  const [selection, setSelection] = useState(() => new Set())
  const [view, setView] = useState(() => {try{return ['list','small','large'].includes(localStorage.getItem('dfm-view')) ? localStorage.getItem('dfm-view') : 'list'}catch{return 'list'}})
  const [knowledgeMode,setKnowledgeMode] = useState(false)
  const [knowledgeTypeFilter,setKnowledgeTypeFilter] = useState('all')
  const [knowledgeVisited,setKnowledgeVisited] = useState(false)
  useEffect(()=>{if(knowledgeMode)setKnowledgeVisited(true)},[knowledgeMode])
  const [knowledgeSeed,setKnowledgeSeed] = useState(null)

  const [knowledgeSectionOpen,setKnowledgeSectionOpen] = useState(()=>{try{return localStorage.getItem('dfm-knowledge-section')==='open'}catch{return false}})
  useEffect(()=>{try{localStorage.setItem('dfm-knowledge-section',knowledgeSectionOpen?'open':'closed')}catch{}},[knowledgeSectionOpen])


  useEffect(()=>{if(knowledgeMode)setKnowledgeSectionOpen(true)},[knowledgeMode])
  useEffect(()=>{try{localStorage.setItem('dfm-view',view)}catch{}},[view])
  const browseState=readBrowseState()
  const [sortKey, setSortKey] = useState(() => ['name','size','modified','type'].includes(browseState.sortKey)?browseState.sortKey:'name')
  const [sortAsc, setSortAsc] = useState(() => browseState.sortAsc!==false)
  const [query, setQuery] = useState(() => typeof browseState.query==='string'?browseState.query:'')
  const [showHidden, setShowHidden] = useState(() => browseState.showHidden===true)
  const [clipboard, setClipboard] = useState(() => fileClipboard)
  const [destination, setDestination] = useState(null)
  const [destinationListing, setDestinationListing] = useState(null)
  const [destinationError, setDestinationError] = useState('')
  const [destinationInput, setDestinationInput] = useState('')
  const [menu, setMenu] = useState(null)
  const [prompt, setPrompt] = useState(null)
  const [infoEntry,setInfoEntry]=useState(null)

  const [confirming, setConfirming] = useState(null)
  const [notice, setNotice] = useState(null)
  const [previewOpen, setPreviewOpen] = useState(true)
  const [preview, setPreview] = useState(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [viewer, setViewer] = useState(null)
  const [thumbnails, setThumbnails] = useState(true)
  const [capabilities, setCapabilities] = useState(null)
  currentRef.current={cwd,preview,draft,editing,draftVersion}
  const dirty = editing && preview?.kind==='text' && draft !== preview.content
  if(editing && preview?.kind==='text' && preview?.entry){
    if(dirty)saveFileDraft(preview.entry.path,{content:draft,revision:draftVersion,base:preview.content})
    else forgetFileDraft(preview.entry.path)
  }
  useEffect(()=>{if(!browseReady)return;try{localStorage.setItem(FILEMAN_BROWSE_KEY,JSON.stringify({root,cwd,view,sortKey,sortAsc,query,showHidden}))}catch{}},[browseReady,root,cwd,view,sortKey,sortAsc,query,showHidden])
  const allowLeave = useCallback(()=>{
    if(mutationRef.current)return false
    const c=currentRef.current
    return !(c.editing && c.preview?.kind==='text' && c.draft!==c.preview.content) || window.confirm('有未保存的修改。保留草稿并切换？返回此文件可继续编辑。')
  },[])
  useEffect(()=>{const warn=e=>{if(fileDrafts.size || mutationRef.current){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[])
  const mutate = useCallback(async(route,body)=>{
    if(mutationRef.current)throw new Error('已有文件操作正在执行，请等待完成')
    if(unconfirmedOperation)throw new Error('上次操作结果尚未确认，请先核对上次操作')
    const id=crypto.randomUUID(), record={id,route,directory:currentRef.current.cwd,path:body.path,time:Date.now()}
    mutationRef.current=id;setOperation(route);setBatchReport(null)
    unconfirmedOperation=record;rememberOperation(record)
    try{
      const result=await callApi(route,{method:'POST',body:{...body,requestId:id}})
      unconfirmedOperation=null;rememberOperation(null);return result
    }catch(e){
      if(e.status && e.status<500 && e.status!==408){unconfirmedOperation=null;rememberOperation(null)}
      else{e.message='连接中断，操作结果尚未确认。请核对上次操作，暂不重复提交。';if(mountedRef.current)setUnconfirmed(record)}
      throw e
    }finally{mutationRef.current=null;if(mountedRef.current)setOperation(null)}
  },[])
  const reconcileOperation = useCallback(async()=>{
    const record=unconfirmedOperation || unconfirmed
    if(!record)return
    try{
      const r=await callApi('operation-status',{params:{requestId:record.id}})
      if(r.state==='pending'){setNotice({tone:'error',text:'上次操作仍在执行，请稍后再核对。'});return}
      if(r.state==='unknown'){setNotice({tone:'error',text:'服务器没有保留该操作结果，请检查文件后手动解除保护，不会自动重试。'});return}
      if(r.result?.payload?.results)setBatchReport(r.result.payload.results)
      setNotice({tone:r.state==='completed' && r.result?.status<400?'ok':'error',text:r.error||r.result?.payload?.error||'已确认上次操作结果，请刷新查看文件。'})
      unconfirmedOperation=null;rememberOperation(null);setUnconfirmed(null)
    }catch(e){setNotice({tone:'error',text:e.message})}
  },[unconfirmed])
  const anchorRef = useRef(null)

  const previewPathRef = useRef('')


  const writable = capabilities?.writable !== false
  const thumbnailsAllowed = capabilities?.thumbnails !== false


  const inTrash = listing?.trash === true

  ensureStyles()

  useEffect(() => {
    if (!destination) return
    let live = true
    const controller = new AbortController()
    setDestinationListing(null); setDestinationError(''); setDestinationInput(destination.path)
    callApi('list', {params:{path:destination.path}, signal:controller.signal})
      .then(result => {if(live)setDestinationListing({...result,requestedPath:destination.path})})
      .catch(error => {if(live)setDestinationError(error.message)})
    return () => {live=false;controller.abort()}
  }, [destination?.path,destination?.revision])


  useEffect(() => {
    if (notice === null || notice.tone==='error') return undefined
    const timer = window.setTimeout(() => setNotice(null), 2600)
    return () => window.clearTimeout(timer)
  }, [notice])


  useEffect(() => {
    let live = true
    callApi('locations')
      .then((payload) => {
        if (!live) return
        setLocations(Array.isArray(payload.locations) ? payload.locations : [])
        setRoot(payload.root ?? '')
        setBrowseReady(true)
        setCapabilities(payload.capabilities ?? null)

        if (payload.capabilities?.thumbnails === false) setThumbnails(false)
        const home=payload.home ?? payload.root ?? '/'
        const saved=readBrowseState()
        const target=saved.root===payload.root&&typeof saved.cwd==='string'&&saved.cwd? saved.cwd:home
        navigate(target, { reset: true })
      })
      .catch((cause) => { if (live) setError(cause.message) })
    return () => { live = false }

  }, [])


  useEffect(() => {
    if (cwd === '') return undefined
    let live = true
    const controller=new AbortController()
    setPending(true)
    setError(null)
    callApi('list', { params: { path: cwd }, signal:controller.signal })
      .then((payload) => {
        if (!live) return
        setListing(payload)
        setSelection(new Set())
        setPreview(null)
        setEditing(false)
        previewPathRef.current = ''
        setPending(false)
      })
      .catch((cause) => {
        if (!live) return
        setError(cause.message)
        setListing(null)
        setPending(false)
      })
    return () => { live = false; controller.abort() }
  }, [cwd,reload])


  const navigate = useCallback((target, options = {}) => {
    if (typeof target !== 'string' || target.length === 0 || !allowLeave()) return
    previewRequest.current++; previewPathRef.current=''
    if (options.reset === true) {
      setStack([target])
      setCursor(0)
      setCwd(target)
      return
    }
    setStack((previous) => {
      const index = cursor < 0 ? previous.length - 1 : cursor
      const trimmed = previous.slice(0, index + 1)
      if (trimmed[trimmed.length - 1] === target) return previous
      const next = [...trimmed, target]
      setCursor(next.length - 1)
      return next
    })
    setCwd(target)
    setQuery('')
  }, [cursor,allowLeave])

  const goBack = useCallback(() => {
    if (cursor <= 0 || !allowLeave()) return
    previewRequest.current++
    setCursor(cursor - 1)
    setCwd(stack[cursor - 1])
  }, [cursor, stack,allowLeave])

  const goForward = useCallback(() => {
    if (cursor < 0 || cursor >= stack.length - 1 || !allowLeave()) return
    previewRequest.current++
    setCursor(cursor + 1)
    setCwd(stack[cursor + 1])
  }, [cursor, stack,allowLeave])


  const visible = useMemo(() => {
    const entries = Array.isArray(listing?.entries) ? listing.entries : []
    const needle = query.trim().toLowerCase()
    const filtered = entries.filter((entry) => {
      if (!showHidden && entry.hidden) return false
      if (needle.length === 0) return true
      return entry.name.toLowerCase().includes(needle)
    })
    const factor = sortAsc ? 1 : -1
    return [...filtered].sort((left, right) => {
      if (left.dir !== right.dir) return left.dir ? -1 : 1
      if (sortKey === 'size') {
        const a=left.dir?folderSizes[left.path]?.bytes:left.size,b=right.dir?folderSizes[right.path]?.bytes:right.size
        if(a===undefined||b===undefined)return a===b?left.name.localeCompare(right.name):a===undefined?1:-1
        return (a-b)*factor
      }
      if (sortKey === 'mtime') return (left.mtime - right.mtime) * factor
      return left.name.localeCompare(right.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }) * factor
    })
  }, [listing, query, showHidden, sortKey, sortAsc, folderSizes])

  const windowed = useWindowedEntries(visible,view,`${cwd}:${query}:${view}:${sortKey}:${sortAsc}:${showHidden}`)
  const selectedEntries = useMemo(
    () => visible.filter((entry) => selection.has(entry.path)),
    [visible, selection],
  )


  const refresh = useCallback((target = currentRef.current.cwd, force=false) => {
    if(typeof target!=='string')target=currentRef.current.cwd
    if(!mountedRef.current || target!==currentRef.current.cwd || (!force&&!allowLeave()))return
    previewRequest.current++;setReload(n=>n+1)
  }, [allowLeave])


  const showPreviewFor = useCallback((entry) => {
    const request=++previewRequest.current
    const kind = mediaKindOf(entry)
    previewPathRef.current = entry.path
    setPreviewOpen(true)
    setEditing(false)
    if (isViewerKind(kind) || kind === 'pdf') {
      setPreview({ entry, kind, status: 'ready' })
      return
    }
    if (kind !== 'text') {
      setPreview({ entry, kind, status: 'unsupported' })
      return
    }
    setPreview({ entry, kind, status: 'loading' })
    callApi('read', { params: { path: entry.path } })
      .then((payload) => {
        if (!mountedRef.current || request!==previewRequest.current || previewPathRef.current !== entry.path) return
        const saved=fileDrafts.get(entry.path)
        setDraft(saved?.content ?? payload.content ?? '')
        setDraftVersion(saved?.revision ?? payload.revision)
        setEditing(Boolean(saved))
        setPreview({ entry, kind, status: 'ready', content: saved?.base ?? payload.content ?? '', revision:payload.revision })
        if(saved && saved.revision!==payload.revision)setNotice({tone:'error',text:'原文件已发生变化，草稿保留；保存时会校验冲突。'})
      })
      .catch((cause) => {
        if (!mountedRef.current || request!==previewRequest.current || previewPathRef.current !== entry.path) return
        setPreview({
          entry,
          kind,
          status: 'unsupported',
          detail: cause.status === 413 ? t('noPreview') : cause.message,
        })
      })
  }, [t])


  const openViewer = useCallback((entry) => {
    const items = viewerItemsOf(visible)
    const index = items.findIndex((item) => item.path === entry.path)
    if (index < 0) return

    showPreviewFor(entry)
    setViewer({ items, index })
  }, [visible, showPreviewFor])


  const goToViewerIndex = useCallback((index) => {
    if (viewer === null) return
    const entry = viewer.items[index]
    if (entry !== undefined) showPreviewFor(entry)
    setViewer({ ...viewer, index })
  }, [viewer, showPreviewFor])


  const openEntry = useCallback((entry) => {
    if(!allowLeave())return
    if (entry.dir) {
      navigate(entry.path)
      return
    }
    if (isViewerKind(mediaKindOf(entry))) {
      openViewer(entry)
      return
    }
    showPreviewFor(entry)
  }, [navigate, openViewer, showPreviewFor,allowLeave])


  useEffect(() => {
    if (selectedEntries.length !== 1) return
    const entry = selectedEntries[0]
    if (entry.dir === true) return
    if (previewPathRef.current === entry.path) return
    showPreviewFor(entry)
  }, [selectedEntries, showPreviewFor])


  const selectEntry = useCallback((entry, event) => {
    if(!allowLeave())return
    setSelection((previous) => {
      const next = new Set(previous)
      if (event.metaKey || event.ctrlKey) {
        if (next.has(entry.path)) next.delete(entry.path)
        else next.add(entry.path)
        return next
      }
      if (event.shiftKey && previous.size > 0) {
        const paths = visible.map((item) => item.path)
        const lastSelected = paths.findIndex((path) => previous.has(path))
        const target = paths.indexOf(entry.path)
        if (lastSelected >= 0 && target >= 0) {
          const [from, to] = lastSelected < target ? [lastSelected, target] : [target, lastSelected]
          for (let index = from; index <= to; index += 1) next.add(paths[index])
          return next
        }
      }
      return new Set([entry.path])
    })
  }, [visible,allowLeave])


  const createFolder = useCallback(async (name) => {
    if(mutationRef.current || !allowLeave())return
    try {
      await mutate('mkdir', { dir: cwd, name })
      setNotice({ tone: 'ok', text: t('newFolder') })
      setPrompt(null)
      refresh(cwd,true)
    } catch (cause) {
      setNotice({ tone: 'error', text: cause.message })
    }
  }, [cwd, refresh, t,mutate])


  const renameEntry = useCallback(async (entry, name) => {
    if(mutationRef.current || !allowLeave())return
    try {
      await mutate('rename', { path: entry.path, name })
      setNotice({ tone: 'ok', text: t('rename') })
      setPrompt(null)
      setPreview(null)
      refresh(cwd,true)
    } catch (cause) {
      setNotice({ tone: 'error', text: cause.message })
    }
  }, [refresh,t,cwd,mutate])


  const runBatch = useCallback(async (route, entries, okText) => {
    if(mutationRef.current || !allowLeave())return
    try {
      const payload = await mutate(route, { paths: entries.map((entry) => entry.path) })
      if(mountedRef.current)setBatchReport(payload.results ?? [])
      const failed = (payload.results ?? []).filter((item) => item.ok !== true)
      setNotice(failed.length === 0
        ? { tone: 'ok', text: okText }
        : { tone: 'error', text: failed[0].error ?? t('errorTitle') })
      setConfirming(null)
      setPreview(null)
      refresh(cwd,true)
      return payload
    } catch (cause) {
      setNotice({ tone: 'error', text: cause.message })
      return null
    }
  }, [refresh,t,cwd,mutate])


  const trashEntries = useCallback(
    (entries) => runBatch('trash', entries, capabilities?.trash === false ? t('deleted') : t('trashed')),
    [runBatch, t, capabilities],
  )


  const restoreEntries = useCallback(
    (entries) => runBatch('restore', entries, t('restored')),
    [runBatch, t],
  )


  const purgeEntries = useCallback(
    (entries) => runBatch('purge', entries, t('purged')),
    [runBatch, t],
  )


  const emptyTrash = useCallback(async () => {
    if(mutationRef.current || !allowLeave())return
    try {
      await mutate('trash-empty', {})
      setNotice({ tone: 'ok', text: t('emptied') })
      setConfirming(null)
      setPreview(null)
      refresh(cwd,true)
    } catch (cause) {
      setNotice({ tone: 'error', text: cause.message })
    }
  }, [refresh,t,cwd,mutate])


  const askRemove = useCallback((entries) => {
    if(!allowLeave())return
    setConfirming({ action: inTrash ? 'purge' : 'trash', entries })
  }, [inTrash,allowLeave])


  const confirmSpec = useMemo(() => {
    if (confirming === null) return null
    const entries = confirming.entries ?? []
    if (confirming.action === 'purge') {
      return { title: t('purgeTitle'), body: t('purgeBody'), ok: t('purge'), run: () => purgeEntries(entries) }
    }
    if (confirming.action === 'empty') {
      return { title: t('emptyTrashTitle'), body: t('emptyTrashBody'), ok: t('emptyTrash'), run: () => emptyTrash() }
    }
    return { title: t('confirmTitle'), body: t('confirmBody'), ok: t('remove'), run: () => trashEntries(entries) }
  }, [confirming, emptyTrash, purgeEntries, t, trashEntries])


  const transfer = useCallback(async (route, entries, dest = cwd, fromClipboard = false) => {
    if(!writable || inTrash || !entries.length || mutationRef.current || !allowLeave())return
    try {
      const payload = await mutate(route, { paths: entries.map((entry) => entry.path), dest })
      if(fromClipboard && route === 'move') {
        const remaining = entries.filter((entry,index) => payload.results?.[index]?.ok !== true)
        fileClipboard = remaining.length ? {route:'move',entries:remaining} : null
        setClipboard(fileClipboard)
      }
      if(mountedRef.current)setBatchReport(payload.results ?? [])
      const failed = (payload.results ?? []).filter((item) => item.ok !== true)
      setNotice(failed.length === 0
        ? { tone: 'ok', text: route === 'copy' ? t('copied') : t('moved') }
        : { tone: 'error', text: failed[0].error ?? t('errorTitle') })
      if(failed.length===0)setDestination(null)
      else if(!fromClipboard){
        const remaining=entries.filter((entry,index)=>payload.results?.[index]?.ok!==true)
        setDestination(current=>current?{...current,entries:remaining}:null)
        setDestinationError(failed[0].error ?? t('errorTitle'))
      }
      refresh(cwd,true)
    } catch (cause) {
      setNotice({ tone: 'error', text: cause.message })
      setDestinationError(cause.message)
    }
  }, [cwd, refresh, t,mutate,writable,inTrash,allowLeave])

  const stageClipboard = useCallback((route, entries) => {
    if(!writable || inTrash || mutationRef.current || !entries.length)return
    fileClipboard={route,entries:entries.map(({path,name,dir})=>({path,name,dir}))}
    setClipboard(fileClipboard)
    setNotice({tone:'ok',text:`${t('clipboardReady')} · ${entries.length}`})
  },[writable,inTrash,t])
  const pasteClipboard = useCallback(() => {
    if(clipboard)void transfer(clipboard.route,clipboard.entries,cwd,true)
  },[clipboard,transfer,cwd])
  const chooseTransfer = (route,entries) => {
    if(!entries.length || !allowLeave())return
    setDestination({route,entries:[...entries],path:cwd})
  }


  const saveDraft = useCallback(async () => {
    if (preview?.entry === undefined || mutationRef.current) return
    const path=preview.entry.path, directory=cwd, text=draft, version=draftVersion
    try {
      await mutate('write', {path,content:text,revision:version})
      if(fileDrafts.get(path)?.content===text)forgetFileDraft(path)
      if(!mountedRef.current || currentRef.current.preview?.entry?.path!==path || currentRef.current.cwd!==directory)return
      setPreview({...preview,content:text});setEditing(false)
      setNotice({tone:'ok',text:t('saved')});refresh(directory,true)
    } catch(cause){if(mountedRef.current)setNotice({tone:'error',text:cause.message})}
  }, [draft,draftVersion,preview,cwd,mutate,refresh,t])


  const download = useCallback((entry) => {
    const url = new URL(`${API}/download`, window.location.origin)
    url.searchParams.set('path', entry.path)
    window.open(url.toString(), '_blank', 'noopener')
  }, [])


  const openInTab = useCallback((entry) => {
    window.open(streamUrl(entry.path), '_blank', 'noopener')
  }, [])


  useEffect(() => {
    if (menu === null) return undefined
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])


  useEffect(() => {
    const onKey = (event) => {

      if (viewer !== null || destination !== null || knowledgeMode || mutationRef.current || infoEntry !== null || prompt !== null || confirming !== null) return
      const target = event.target
      const typing = target instanceof HTMLElement
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 's' && editing) {
        event.preventDefault()
        void saveDraft()
        return
      }
      if (typing || (target instanceof HTMLElement && target.closest('button,[role="button"],[role="menuitem"]') && !target.closest('.dfm-tile') && (event.key==='Enter' || event.key===' '))) return
      if(meta && !event.altKey && ['c','x','v'].includes(event.key.toLowerCase()) && writable && !inTrash){
        const key=event.key.toLowerCase()
        if(key==='v' && clipboard){event.preventDefault();pasteClipboard();return}
        if(key!=='v' && selectedEntries.length){event.preventDefault();stageClipboard(key==='x'?'move':'copy',selectedEntries);return}
      }
      if(meta && event.key.toLowerCase()==='i' && selectedEntries.length===1){
        event.preventDefault();setInfoEntry(selectedEntries[0]);return
      }
      if(event.key==='F2'&&writable&&!inTrash&&selectedEntries.length===1){
        event.preventDefault();setPrompt({kind:'rename',entry:selectedEntries[0],value:selectedEntries[0].name});return
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === 'n' && writable) {
        event.preventDefault()
        setPrompt({ kind: 'mkdir', value: '' })
        return
      }
      if (meta && event.shiftKey && event.key === '.') {
        event.preventDefault()
        setShowHidden((value) => !value)
        return
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && writable && selectedEntries.length > 0) {
        event.preventDefault()
        askRemove(selectedEntries)
        return
      }
      if (event.key === 'Enter' && selectedEntries.length === 1) {
        event.preventDefault()
        if (meta && writable && !inTrash) setPrompt({ kind: 'rename', entry: selectedEntries[0], value: selectedEntries[0].name })
        else openEntry(selectedEntries[0])
        return
      }
      if (event.key === 'ArrowUp' && meta && listing?.parent) {
        event.preventDefault()
        navigate(listing.parent)
        return
      }
      if (event.key === ' ') {
        event.preventDefault()
        if (selectedEntries.length === 1) openEntry(selectedEntries[0])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [destination, clipboard, pasteClipboard, stageClipboard, knowledgeMode, askRemove, editing, listing, navigate, openEntry, saveDraft, selectedEntries, viewer, writable, inTrash, infoEntry, prompt, confirming])


  const openMenu = useCallback((event, entry) => {
    event.preventDefault()
    if (entry === undefined) {
      setMenu({
        x: Math.min(event.clientX, window.innerWidth - 228),
        y: Math.min(event.clientY, window.innerHeight - 320),
        entry: undefined,
      })
      return
    }
    event.stopPropagation()
    if (!selection.has(entry.path)) setSelection(new Set([entry.path]))
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 228),
      y: Math.min(event.clientY, window.innerHeight - 320),
      entry,
    })
  }, [selection])


  const toggleSort = useCallback((key) => {
    if (sortKey === key) {
      setSortAsc((value) => !value)
      return
    }
    setSortKey(key)
    setSortAsc(true)
  }, [sortKey])

  const arrow = sortKey === 'name' ? null : (sortAsc ? '↑' : '↓')
  const selectionLabel = selectedEntries.length > 0 ? `，${t('selected')} ${selectedEntries.length} ` : ''
  const sortedBy = (key) => (sortKey === key ? (sortAsc ? '↑' : '↓') : '')

  return (
    <div className="dfm-root" ref={anchorRef}>
      {         }
      <div inert={Boolean(operation)} className="dfm-toolbar" style={{display:knowledgeMode?'none':undefined}}>
        <Tooltip label={t('back')} side="bottom" delayMs={400}>
          <Button variant="toolbar" size="sm" icon={<IconChevronLeftOutlineRegular size={16} />} disabled={cursor <= 0} onClick={goBack} aria-label={t('back')} />
        </Tooltip>
        <Tooltip label={t('forward')} side="bottom" delayMs={400}>
          <Button variant="toolbar" size="sm" icon={<IconChevronRightOutlineRegular size={16} />} disabled={cursor < 0 || cursor >= stack.length - 1} onClick={goForward} aria-label={t('forward')} />
        </Tooltip>
        <Tooltip label={t('parent')} side="bottom" delayMs={400}>
          <Button variant="toolbar" size="sm" icon={<IconChevronUpOutlineRegular size={16} />} disabled={listing?.parent == null} onClick={() => listing?.parent != null && navigate(listing.parent)} aria-label={t('parent')} />
        </Tooltip>

        <nav className="dfm-breadcrumb" aria-label={t('revealPath')}>
          {inTrash ? (


            <span className="dfm-crumb-static">
              <IconTrashOutlineRegular size={14} />
              <span className="dfm-crumb-label">{t('trash')}</span>
            </span>
          ) : crumbsOf(cwd).map((crumb, index, all) => (
            <span key={crumb.path} style={{ display: 'inline-flex', alignItems: 'center' }}>
              {index > 0 ? <IconBreadcrumbSeparator size={12} /> : null}
              <button type="button" className="dfm-crumb" onClick={() => navigate(crumb.path)} title={crumb.path}>
                <span className="dfm-crumb-label">{index === 0 ? t('root') : crumb.label}</span>
              </button>
              {index === all.length - 1 ? null : null}
            </span>
          ))}
        </nav>

        <Input
          className="dfm-search"
          icon={<IconSearchOutlineRegular size={16} />}
          placeholder={t('search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t('search')}
        />
        <Tooltip
          label={!writable ? t('readOnly') : inTrash ? t('trashNote') : t('newFolder')}
          side="bottom"
          delayMs={400}
        >
          <Button
            variant="toolbar"
            size="sm"
            icon={<IconPlusOutlineRegular size={16} />}
            disabled={!writable || inTrash}
            onClick={() => setPrompt({ kind: 'mkdir', value: '' })}
            aria-label={t('newFolder')}
          />
        </Tooltip>
        <Tooltip label={t('refresh')} side="bottom" delayMs={400}>
          <Button variant="toolbar" size="sm" icon={<IconRefreshOutlineRegular size={16} />} onClick={refresh} aria-label={t('refresh')} />
        </Tooltip>
        {inTrash && writable ? (
          <Tooltip label={t('emptyTrash')} side="bottom" delayMs={400}>
            <Button
              variant="toolbar"
              size="sm"
              icon={<IconTrashOutlineRegular size={16} />}
              onClick={() => setConfirming({ action: 'empty', entries: [] })}
              aria-label={t('emptyTrash')}
            />
          </Tooltip>
        ) : null}
        <ViewButtons view={view} onChange={setView} />
        <Button variant="toolbar" size="sm" disabled={!writable || inTrash || selectedEntries.length!==1 || false} onClick={()=>{const f=selectedEntries[0];if(f.dir){setKnowledgeSeed({importPaths:[f.path]});setKnowledgeMode(true);return}setKnowledgeSeed({title:f.name,content:`关联文件：${f.name}`,assetId:'file:'+f.path,tags:[],category:'文件',sourceUrl:''});setKnowledgeTypeFilter('all');setKnowledgeMode(true)}}>加入知识库</Button>
        <Tooltip label={previewOpen ? t('hidePreview') : t('showPreview')} side="bottom" delayMs={400}>
          <Button variant="toolbar" size="sm" icon={<IconInfoOutlineRegular size={16} />} onClick={() => setPreviewOpen((value) => !value)} aria-label={t('showPreview')} />
        </Tooltip>
        <Button
          variant="toolbar"
          size="sm"
          icon={<IconEllipsisOutlineRegular size={16} />}
          aria-label={t('errorTitle')}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            setMenu({ x: Math.min(box.left, window.innerWidth - 228), y: Math.min(box.bottom + 6, window.innerHeight - 320), entry: undefined })
          }}
        />
      </div>

      {knowledgeMode && <div className="dfm-toolbar"><strong>知识库</strong><ViewButtons view={view} onChange={setView}/></div>}
      <div className="dfm-body" inert={Boolean(operation)}>
        {         }
        <aside className="dfm-locations">
          <div className="dfm-locations-title">{t('locations')}</div>
          {locations.map((location) => {
            const presentation = LOCATION_PRESENTATION[location.kind] ?? LOCATION_PRESENTATION.root
            const Glyph = presentation.icon
            return (
              <button
                type="button"
                key={location.path}
                className="dfm-location-row"
                data-active={!knowledgeMode && (cwd === location.path || (location.kind === 'home' && cwd.startsWith(location.path)))}
                onClick={() => {setKnowledgeMode(false);navigate(location.path)}}
                title={location.path}
              >
                <Glyph size={16} />
                <span className="dfm-location-label">{t(presentation.key)}</span>
              </button>
            )
          })}
          <button type="button" className="dfm-locations-title dfm-locations-toggle" aria-expanded={knowledgeSectionOpen} title={knowledgeSectionOpen?'折叠知识库栏目':'展开知识库栏目'} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(writable){setKnowledgeSeed({importDrop:captureDrop(e.dataTransfer)});setKnowledgeTypeFilter('all');setKnowledgeMode(true);setKnowledgeSectionOpen(true)}}} onClick={()=>setKnowledgeSectionOpen(v=>!v)}><svg className="dfm-locations-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 1.5 7 5l-4.5 3.5"/></svg><span>知识库</span></button>
          {knowledgeSectionOpen&&<>
          <button type="button" className="dfm-location-row" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(writable){setKnowledgeSeed({importDrop:captureDrop(e.dataTransfer)});setKnowledgeMode(true);setKnowledgeTypeFilter("all")}}} data-active={knowledgeMode && knowledgeTypeFilter==='all'} onClick={()=>{setKnowledgeMode(true);setKnowledgeTypeFilter('all')}}><TypeIcon type="note" size={22}/><span>全部知识</span></button>
          {Object.entries(FILE_TYPES).filter(([type])=>type!=='folder').map(([type,meta])=><button key={type} type="button" className="dfm-location-row dfm-knowledge-type" data-active={knowledgeMode&&knowledgeTypeFilter===type} onClick={()=>{setKnowledgeMode(true);setKnowledgeTypeFilter(type)}}><TypeIcon type={type} size={22}/><span>{meta.label}</span></button>)}
          </>}
        </aside>

        <div style={{display:knowledgeMode?'none':'contents'}}>
        {        }
        <section className="dfm-main">
          {error !== null ? (
            <div className="dfm-notice">
              <IconWarningOutlineRegular size={16} />
              <span>{t('failed')}：{error}</span>
            </div>
          ) : null}

          {pending ? (
            <div className="dfm-empty">{t('loading')}</div>
          ) : view === 'list' ? (
            <div ref={windowed.ref} className="dfm-list" onContextMenu={(event) => openMenu(event)} onClick={(event) => { if (event.target === event.currentTarget) setSelection(new Set()) }}>
              <div className="dfm-head">
                <button type="button" className="dfm-head-cell dfm-name" onClick={() => toggleSort('name')}>
                  {t('name')} {sortedBy('name')}
                </button>
                <button type="button" className="dfm-head-cell dfm-size dfm-dim" onClick={() => toggleSort('size')} style={{ justifyContent: 'flex-end' }}>
                  {t('size')} {sortedBy('size')}
                </button>
                <button type="button" className="dfm-head-cell dfm-date dfm-dim" onClick={() => toggleSort('mtime')} style={{ justifyContent: 'flex-end' }}>
                  {t('modified')} {sortedBy('mtime')}
                </button>
              </div>
              {visible.length === 0 ? <div className="dfm-empty">{t('empty')}</div> : null}
              {windowed.top>0 && <div aria-hidden="true" style={{height:Math.max(0,windowed.top-windowed.gap),gridColumn:'1 / -1'}}/>}
              {windowed.items.map((entry) => (
                <div
                  key={entry.path}
                  draggable={!inTrash} onDragStart={e=>{e.dataTransfer.setData("application/x-dsh-file-paths",JSON.stringify([entry.path]));e.dataTransfer.effectAllowed="copy"}}
                  className="dfm-row"
                  data-selected={selection.has(entry.path)}
                  onClick={(event) => selectEntry(entry, event)}
                  onDoubleClick={() => openEntry(entry)}
                  onContextMenu={(event) => openMenu(event, entry)}
                >
                  <span className="dfm-name">
                    <TypeIcon entry={entry} size={22} />
                    <span className="dfm-name-text" style={entry.link ? { fontStyle: 'italic' } : undefined}>{entry.name}</span>
                  </span>
                  <span className="dfm-dim dfm-size" title={entry.dir?t('sizeNote'):`${entry.size.toLocaleString()} B`}>
                    {entry.dir&&!entry.link ? <button type="button" style={{background:'none',border:0,color:'inherit',cursor:'pointer',font:'inherit'}} disabled={!!sizePending} title={t('calculateSize')} onDoubleClick={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();measureFolder(entry)}}>{folderSizes[entry.path]||sizePending===entry.path?entrySize(entry):t('calculateSize')}</button>:entry.link&&entry.dir?'—':entrySize(entry)}
                  </span>
                  <span className="dfm-dim dfm-date">{formatDate(entry.mtime)}</span>
                </div>
              ))}
              {windowed.bottom>0 && <div aria-hidden="true" style={{height:Math.max(0,windowed.bottom-windowed.gap),gridColumn:'1 / -1'}}/>}
            </div>
          ) : (
            <div ref={windowed.ref} className="dfm-grid" data-view={view} style={{gridTemplateColumns:`repeat(${windowed.columns},minmax(0,1fr))`,gridAutoRows:'auto'}} onContextMenu={(event) => openMenu(event)} onClick={(event) => { if (event.target === event.currentTarget) setSelection(new Set()) }}>
              {visible.length === 0 ? <div className="dfm-empty">{t('empty')}</div> : null}
              {windowed.top>0 && <div aria-hidden="true" style={{height:Math.max(0,windowed.top-windowed.gap),gridColumn:'1 / -1'}}/>}
              {windowed.items.map((entry) => (
                <button
                  type="button"
                  key={entry.path}
                  draggable={!inTrash} onDragStart={e=>{e.dataTransfer.setData("application/x-dsh-file-paths",JSON.stringify([entry.path]));e.dataTransfer.effectAllowed="copy"}}
                  className="dfm-tile" style={{height:windowed.rowHeight}}
                  data-selected={selection.has(entry.path)}
                  onClick={(event) => selectEntry(entry, event)}
                  onDoubleClick={() => openEntry(entry)}
                  onContextMenu={(event) => openMenu(event, entry)}
                >
                  <span className="dfm-file-art"><Thumb
                    entry={entry}
                    kind={mediaKindOf(entry)}
                    enabled={thumbnails && thumbnailsAllowed}
                  /><TypeBadge type={fileType(entry)}/></span>
                  <span className="dfm-tile-label">{entry.name}</span><span className="dfm-dim" style={{fontSize:11}}>{entrySize(entry)}</span>
                </button>
              ))}
              {windowed.bottom>0 && <div aria-hidden="true" style={{height:Math.max(0,windowed.bottom-windowed.gap),gridColumn:'1 / -1'}}/>}
            </div>
          )}

          {         }
          <div className="dfm-status">
            <span>{visible.length} {t('items')}{selectionLabel}</span>
            {selectedEntries.length===1&&selectedEntries[0].dir&&!selectedEntries[0].link ? <button type="button" disabled={!!sizePending} title={t('sizeNote')} onClick={()=>measureFolder(selectedEntries[0])}>{t('calculateSize')}</button>:null}
            <Button variant="ghost" disabled={selectedEntries.length!==1} onClick={()=>setInfoEntry(selectedEntries[0])}>{t('getInfo')}</Button>
            <Button variant="ghost" disabled={selectedEntries.length!==1||!writable||inTrash||Boolean(operation)} onClick={()=>setPrompt({kind:'rename',entry:selectedEntries[0],value:selectedEntries[0].name})}>{t('rename')}</Button>
            <Button variant="ghost" disabled={!writable||inTrash||!selectedEntries.length||Boolean(operation)} onClick={()=>stageClipboard('copy',selectedEntries)}>{t('copy')}</Button>
            <Button variant="ghost" disabled={!writable||inTrash||!selectedEntries.length||Boolean(operation)} onClick={()=>stageClipboard('move',selectedEntries)}>{t('cut')}</Button>
            <Button variant="ghost" disabled={!writable||inTrash||!clipboard||Boolean(operation)} onClick={pasteClipboard}>{t('paste')}{clipboard ? ` (${clipboard.entries.length})` : ''}</Button>
            <Button variant="ghost" disabled={!writable||inTrash||!selectedEntries.length||Boolean(operation)} onClick={()=>chooseTransfer('move',selectedEntries)}>{t('moveAction')}</Button>
            {writable ? null : <span>{t('readOnly')}</span>}
            <span className="dfm-path" style={{ marginLeft: 'auto' }}>
              {
                                        }
              {inTrash ? t('trash') : cwd.length > 0 ? <PathLabel path={cwd} /> : null}
            </span>
          </div>
        </section>

        {             }
        {previewOpen ? (
          <aside className="dfm-preview">
            <div className="dfm-preview-head">
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {preview?.entry?.name ?? t('preview')}
              </span>
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                {isViewerKind(preview?.kind) ? (
                  <Tooltip label={t('mediaPreview')} side="bottom" delayMs={400}>
                    <Button
                      variant="toolbar"
                      size="sm"
                      icon={<IconFullscreenOutlineRegular size={16} />}
                      onClick={() => openViewer(preview.entry)}
                      aria-label={t('mediaPreview')}
                    />
                  </Tooltip>
                ) : null}
                {preview?.kind === 'text' && preview.status === 'ready' && !editing ? (
                  <Tooltip label={writable ? t('edit') : t('readOnly')} side="bottom" delayMs={400}>
                    <Button
                      variant="toolbar"
                      size="sm"
                      icon={<IconEditOutlineRegular size={16} />}
                      disabled={!writable}
                      onClick={() => setEditing(true)}
                      aria-label={t('edit')}
                    />
                  </Tooltip>
                ) : null}
                {editing ? (
                  <><Button disabled={Boolean(operation)||Boolean(unconfirmed)} variant="primary" size="sm" onClick={saveDraft}>{t('save')}</Button><Button disabled={Boolean(operation)} variant="ghost" size="sm" onClick={()=>{if(window.confirm('放弃此文件的草稿并重新读取？')){forgetFileDraft(preview.entry.path);showPreviewFor(preview.entry)}}}>放弃草稿</Button></>
                ) : null}
                {preview?.entry !== undefined && preview.kind !== 'text' ? (
                  <Tooltip label={t('openInTab')} side="bottom" delayMs={400}>
                    <Button
                      variant="toolbar"
                      size="sm"
                      icon={<IconRightUpOutlineRegular size={16} />}
                      onClick={() => openInTab(preview.entry)}
                      aria-label={t('openInTab')}
                    />
                  </Tooltip>
                ) : null}
                {preview?.entry !== undefined ? (
                  <Tooltip label={t('downloadAction')} side="bottom" delayMs={400}>
                    <Button
                      variant="toolbar"
                      size="sm"
                      icon={<IconDownloadOutlineRegular size={16} />}
                      onClick={() => download(preview.entry)}
                      aria-label={t('downloadAction')}
                    />
                  </Tooltip>
                ) : null}
              </span>
            </div>
            <div className="dfm-preview-body">
              {preview === null ? (
                <div style={{ opacity: 0.55 }}>{t('preview')}</div>
              ) : preview.status === 'loading' ? (
                <div style={{ opacity: 0.6 }}>{t('loading')}</div>
              ) : isViewerKind(preview.kind) || preview.kind === 'pdf' ? (
                <MediaStage entry={preview.entry} kind={preview.kind} t={t} onOpenViewer={openViewer} />
              ) : preview.status === 'unsupported' ? (
                <div className="dfm-broken">
                  <div>{t('noPreview')}</div>
                  {preview.detail ? <div style={{ marginTop: 6, opacity: 0.75 }}>{preview.detail}</div> : null}
                </div>
              ) : editing ? (
                <textarea className="dfm-editor" aria-label="文件正文" disabled={Boolean(operation)} value={draft} onChange={(event) => {const content=event.target.value;setDraft(content);if(content===preview.content)forgetFileDraft(preview.entry.path);else saveFileDraft(preview.entry.path,{content,revision:draftVersion,base:preview.content})}} spellCheck={false} />
              ) : (
                <>
                  <pre className="dfm-pre">{preview.content}</pre>
                  {
                                                       }
                  <InfoRows rows={mediaInfoRows(preview.entry, 'text', null, t)} />
                </>
              )}
            </div>
          </aside>
        ) : null}
        </div>
        <div style={{display:knowledgeMode?'flex':'none',flex:1,minWidth:0,minHeight:0}}>
          {knowledgeMode || knowledgeVisited || knowledgeSeed ? <KnowledgePanel onOpenSettings={openRagSettings} api={callApi} view={view} typeFilter={knowledgeTypeFilter} writable={writable} seed={knowledgeSeed} onSeedUsed={()=>setKnowledgeSeed(null)} streamUrl={streamUrl}/> : null}
        </div>
      </div>

      {           }
      {menu !== null ? (
        <MenuSurface className="dfm-menu" style={{ left: Math.max(8,menu.x), top: Math.max(8,menu.y), maxHeight: `calc(100vh - ${Math.max(8,menu.y)+8}px)`, overflowY: 'auto' }} onPointerDown={(event) => event.stopPropagation()}>
          {menu.entry !== undefined ? (
            <>
              <MenuItemButton
                icon={menu.entry.dir
                  ? <IconFolderOpenOutlineRegular size={16} />
                  : isPlayableKind(mediaKindOf(menu.entry))
                    ? <IconPlayOutlineRegular size={16} />
                    : <IconInspectOutlineRegular size={16} />}
                onSelect={() => { setMenu(null); openEntry(menu.entry) }}
              >
                {menu.entry.dir
                  ? t('open')
                  : isPlayableKind(mediaKindOf(menu.entry)) ? t('play') : t('preview')}
              </MenuItemButton>
              <MenuItemButton icon={<IconInspectOutlineRegular size={16} />} onSelect={()=>{setInfoEntry(menu.entry);setMenu(null)}}>{t('getInfo')}</MenuItemButton>
              {!menu.entry.dir ? (
                <MenuItemButton icon={<IconRightUpOutlineRegular size={16} />} onSelect={() => { setMenu(null); openInTab(menu.entry) }}>
                  {t('openInTab')}
                </MenuItemButton>
              ) : null}
              {!menu.entry.dir ? (
                <MenuItemButton icon={<IconDownloadOutlineRegular size={16} />} separatorBefore onSelect={() => { setMenu(null); download(menu.entry) }}>
                  {t('downloadAction')}
                </MenuItemButton>
              ) : null}
              {
                                                           }
              {writable && inTrash ? (
                <>
                  <MenuItemButton
                    icon={<IconRefreshOutlineRegular size={16} />}
                    separatorBefore
                    onSelect={() => { setMenu(null); void restoreEntries(selectedEntries) }}
                  >
                    {t('restore')}
                  </MenuItemButton>
                  <MenuItemButton
                    danger
                    icon={<IconTrashOutlineRegular size={16} />}
                    onSelect={() => { setMenu(null); setConfirming({ action: 'purge', entries: selectedEntries }) }}
                  >
                    {t('purge')}
                  </MenuItemButton>
                </>
              ) : null}
              {writable && !inTrash ? (
                <>
                  <MenuItemButton icon={<IconCopyOutlineRegular size={16} />} separatorBefore onSelect={() => {setMenu(null);stageClipboard('copy',selectedEntries)}}>{t('copy')}</MenuItemButton>
                  <MenuItemButton onSelect={() => {setMenu(null);stageClipboard('move',selectedEntries)}}>{t('cut')}</MenuItemButton>
                  <MenuItemButton disabled={!clipboard} onSelect={() => {setMenu(null);pasteClipboard()}}>{t('paste')}</MenuItemButton>
                  <MenuItemButton icon={<IconCopyOutlineRegular size={16} />} separatorBefore onSelect={() => { setMenu(null); chooseTransfer('copy', selectedEntries) }}>
                    {t('copyAction')}
                  </MenuItemButton>
                  <MenuItemButton onSelect={() => { setMenu(null); chooseTransfer('move', selectedEntries) }}>
                    {t('moveAction')}
                  </MenuItemButton>
                  <MenuItemButton icon={<IconEditOutlineRegular size={16} />} separatorBefore onSelect={() => { setMenu(null); setPrompt({ kind: 'rename', entry: menu.entry, value: menu.entry.name }) }}>
                    {t('rename')}
                  </MenuItemButton>
                  <MenuItemButton danger icon={<IconTrashOutlineRegular size={16} />} onSelect={() => { setMenu(null); askRemove(selectedEntries) }}>
                    {t('remove')}
                  </MenuItemButton>
                </>
              ) : null}
            </>
          ) : (
            <>
              <MenuItemButton
                icon={<IconPlusOutlineRegular size={16} />}
                disabled={!writable || inTrash}
                onSelect={() => { setMenu(null); setPrompt({ kind: 'mkdir', value: '' }) }}
              >
                {t('newFolder')}
              </MenuItemButton>
              <MenuItemButton
                icon={<IconCopyOutlineRegular size={16} />}
                disabled={!writable || inTrash || !clipboard}
                onSelect={() => { setMenu(null); pasteClipboard() }}
              >
                {t('paste')}
              </MenuItemButton>
              <MenuItemButton icon={<IconRefreshOutlineRegular size={16} />} separatorBefore onSelect={() => { setMenu(null); refresh() }}>
                {t('refresh')}
              </MenuItemButton>
              <MenuItemButton onSelect={() => { setMenu(null); setShowHidden((value) => !value) }}>
                {showHidden ? '✓ ' : ''}{t('showHidden')}
              </MenuItemButton>
              <MenuItemButton
                disabled={!thumbnailsAllowed}
                onSelect={() => { setMenu(null); setThumbnails((value) => !value) }}
              >
                {thumbnails ? '✓ ' : ''}{t('showThumbnails')}
              </MenuItemButton>
              {inTrash && writable ? (
                <MenuItemButton
                  danger
                  icon={<IconTrashOutlineRegular size={16} />}
                  separatorBefore
                  onSelect={() => { setMenu(null); setConfirming({ action: 'empty', entries: [] }) }}
                >
                  {t('emptyTrash')}
                </MenuItemButton>
              ) : null}
            </>
          )}
        </MenuSurface>
      ) : null}

      <Modal open={infoEntry!==null} onClose={()=>setInfoEntry(null)} title={t('getInfo')} closeLabel={t('close')}
        footer={<Button variant="primary" onClick={()=>setInfoEntry(null)}>{t('close')}</Button>}>
        {infoEntry ? <div style={{minWidth:280,maxWidth:560}}>
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:18}}><TypeIcon entry={infoEntry} size={48}/><strong style={{overflowWrap:'anywhere'}}>{infoEntry.name}</strong></div>
          <InfoRows rows={[
            [t('name'),infoEntry.name],
            ...mediaInfoRows(infoEntry,infoEntry.dir?'dir':mediaKindOf(infoEntry),null,t).map(([key,value])=>[key,key===t('size')?entrySize(infoEntry):key===t('modified')?new Date(infoEntry.mtime).toLocaleString():key===t('kindLabel')&&infoEntry.link?t('symbolicLink'):value]),
            [t('fullPath'),infoEntry.path],
            [t('permissions'),infoEntry.mode??'—'],
          ]}/>
          {infoEntry.dir&&!infoEntry.link?<Button variant="ghost" disabled={!!sizePending} onClick={()=>measureFolder(infoEntry)}>{t('calculateSize')}</Button>:null}
          <p className="dfm-dim" style={{fontSize:12,marginTop:16}}>{t('infoSnapshot')}</p>
        </div>:null}
      </Modal>

      <Modal open={destination !== null} onClose={()=>{if(!mutationRef.current)setDestination(null)}} title={destination?.route==='move'?t('moveAction'):t('copyAction')} closeLabel={t('cancel')}
        footer={<><Button variant="ghost" disabled={Boolean(operation)} onClick={()=>setDestination(null)}>{t('cancel')}</Button><Button variant="primary" disabled={Boolean(operation)||!destinationListing||destinationListing.trash||destinationListing.requestedPath!==destination?.path||destinationInput.trim()!==destination?.path} onClick={()=>void transfer(destination.route,destination.entries,destinationListing.path)}>{t('chooseDestination')}</Button></>}>
        <div style={{minWidth:300,maxWidth:560}}>
          <p>{destination?.entries.length} {t('items')}</p>
          <form onSubmit={event=>{event.preventDefault();if(destinationInput.trim())setDestination({...destination,path:destinationInput.trim(),revision:(destination.revision??0)+1})}} style={{display:'flex',gap:8}}>
            <Input aria-label={t('destination')} value={destinationInput} disabled={Boolean(operation)} onChange={event=>setDestinationInput(event.target.value)}/>
            <Button type="submit" disabled={Boolean(operation)}>{t('open')}</Button>
          </form>
          <p style={{overflowWrap:'anywhere'}}>{destinationListing?.path}</p>
          {destinationError?<p role="alert">{destinationError}</p>:null}
          <div style={{display:'flex',flexDirection:'column',maxHeight:300,overflow:'auto',gap:4}}>
            <Button variant="ghost" disabled={Boolean(operation)||!destinationListing?.parent} onClick={()=>setDestination({...destination,path:destinationListing.parent})}>{t('parent')}</Button>
            {(destinationListing?.entries??[]).filter(entry=>entry.dir).map(entry=><Button key={entry.path} variant="ghost" disabled={Boolean(operation)} onClick={()=>setDestination({...destination,path:entry.path})}>📁 {entry.name}</Button>)}
          </div>
        </div>
      </Modal>

      {              }
      <Modal
        open={prompt !== null}
        onClose={() => {if(!mutationRef.current)setPrompt(null)}}
        title={prompt?.kind === 'rename' ? t('rename') : t('newFolder')}
        closeLabel={t('cancel')}
        footer={(
          <>
            <Button variant="ghost" disabled={Boolean(operation)} onClick={() => setPrompt(null)}>{t('cancel')}</Button>
            <Button
              variant="primary"
              disabled={Boolean(operation)}
              onClick={() => {
                const value = (prompt?.value ?? '').trim()
                if (value.length === 0) return
                if (prompt?.kind === 'rename') void renameEntry(prompt.entry, value)
                else void createFolder(value)
              }}
            >
              {prompt?.kind === 'rename' ? t('confirm') : t('create')}
            </Button>
          </>
        )}
      >
        <div className="dfm-dialog-field">
          <span className="dfm-dialog-label">{prompt?.kind === 'rename' ? t('newName') : t('folderName')}</span>
          <Input
            data-modal-autofocus
            disabled={Boolean(operation)}
            value={prompt?.value ?? ''}
            onChange={(event) => setPrompt({ ...prompt, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              const value = (prompt?.value ?? '').trim()
              if (value.length === 0) return
              if (prompt?.kind === 'rename') void renameEntry(prompt.entry, value)
              else void createFolder(value)
            }}
          />
        </div>
      </Modal>

      {                                 }
      <Modal
        open={confirming !== null}
        onClose={() => {if(!mutationRef.current)setConfirming(null)}}
        title={confirmSpec?.title ?? t('confirmTitle')}
        closeLabel={t('cancel')}
        description={confirmSpec?.body}
        footer={(
          <>
            <Button variant="ghost" disabled={Boolean(operation)} onClick={() => setConfirming(null)}>{t('cancel')}</Button>
            <Button variant="primary" disabled={Boolean(operation)} onClick={() => void confirmSpec?.run()}>{confirmSpec?.ok ?? t('confirm')}</Button>
          </>
        )}
      >
        {(confirming?.entries ?? []).length === 0 ? null : (
          <div style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {(confirming?.entries ?? []).slice(0, 12).map((entry) => (
              <div key={entry.path} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', opacity: 0.85 }}>
                <TypeIcon entry={entry} size={22} />
                <span className="dfm-name-text">{entry.name}</span>
              </div>
            ))}
            {(confirming?.entries ?? []).length > 12 ? <div style={{ opacity: 0.6 }}>…</div> : null}
          </div>
        )}
      </Modal>

      {unconfirmed && <div className="dfm-notice" style={{position:'relative',flex:'none',margin:8,display:'block'}}><p>上次文件操作结果尚未确认，已暂停新的写操作。</p><button onClick={reconcileOperation}>核对上次操作</button><button onClick={()=>{if(window.confirm('确认已检查相关文件？解除后可以发起新操作，请勿重复已完成的操作。')){unconfirmedOperation=null;rememberOperation(null);setUnconfirmed(null)}}}>已核对文件，解除保护</button></div>}
      {operation && <div role="status" className="dfm-notice" style={{position:'absolute',bottom:44,right:16,zIndex:100}}>正在执行文件操作，请稍候…</div>}
      {batchReport && <div role="status" className="dfm-notice" style={{position:'absolute',bottom:44,left:190,zIndex:10,maxHeight:220,maxWidth:460,overflow:'auto',display:'block'}}><button onClick={()=>setBatchReport(null)} style={{float:'right'}}>关闭</button><div>成功 {batchReport.filter(r=>r.ok).length} 项 / 失败 {batchReport.filter(r=>!r.ok).length} 项</div>{batchReport.map((r,i)=><div key={i} style={{overflowWrap:'anywhere'}}>{r.ok?'✓':'×'} {baseName(r.path)}{r.error?'：'+r.error:''}</div>)}</div>}
      {          }
      {notice !== null ? (
        <div className="dfm-notice" style={{ position: 'absolute', right: 16, bottom: 44, margin: 0 }}>
          <IconWarningOutlineRegular size={16} style={{ opacity: notice.tone === 'ok' ? 0.4 : 1 }} />
          <span>{notice.text}</span>
        </div>
      ) : null}

      {                                           }
      {viewer !== null ? (
        <MediaViewer
          items={viewer.items}
          index={viewer.index}
          onIndexChange={goToViewerIndex}
          onClose={() => setViewer(null)}
          t={t}
        />
      ) : null}
    </div>
  )
}


const NS = 'dsh-fileman'


export const inject = ['slots', 'locale']


export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-fileman: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'knowledge-rag', order: 45, label: '知识库处理与检索',
  }, confirmKnowledgeRagSection(KnowledgeRagSettingsSection)))


  registerKnowledgeSettingsNavigation(ctx, FilemanPanel, PANEL_ID)

  registerLaunchpadApp(ctx, {
    id: PANEL_ID,
    name: t('panel'),
    description: '浏览和管理工作区文件，预览图片、视频与文档。',
    icon: FilemanPanelIcon,
    order: 10,
  }, 'fileman')
}
