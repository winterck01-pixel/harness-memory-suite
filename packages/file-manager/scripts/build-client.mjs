


import { access, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))


const BASELINE_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/cordis',
]


const PACKAGE_NAME = 'dsh-fileman'


async function locateEsbuild() {
  const candidates = [join(root, 'node_modules/esbuild/lib/main.js'), join(root, '../../node_modules/esbuild/lib/main.js')]
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {

    }
  }
  throw new Error('找不到 esbuild，请先在包目录执行 npm install esbuild')
}


async function loadEsbuild(entry) {
  const module = await import(`file://${entry}`)
  return module.default ?? module
}

const esbuildEntry = await locateEsbuild()
const esbuild = await loadEsbuild(esbuildEntry)

const result = await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['client/main.jsx'],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  write: false,
  legalComments: 'none',
  external: BASELINE_MODULES,
  logLevel: 'warning',
})

const bundled = result.outputFiles[0].text

const wrapper = [
  `// 由 scripts/build-client.mjs 生成；请编辑 client/main.jsx 后重新构建。`,
  `window.__ModuleLoader__.load({`,
  `  id: ${JSON.stringify(PACKAGE_NAME)},`,
  `  factory: (require) => {`,
  `    var module = { exports: {} };`,
  `    var exports = module.exports;`,
  bundled,
  `    return module.exports;`,
  `  },`,
  `});`,
  '',
].join('\n')

const target = new URL('../client.js', import.meta.url)
await writeFile(target, wrapper)


const written = await readFile(target, 'utf8')
const problems = []
if (!written.includes('window.__ModuleLoader__.load(')) problems.push('缺少 __ModuleLoader__.load 包装')
if (!written.includes(`id: "${PACKAGE_NAME}"`)) problems.push('缺少正确的插件 id')
if (/^\s*import\s/m.test(written)) problems.push('残留 ESM import 语句')
if (/\bfrom\s+['"]react['"]/u.test(written)) problems.push('React 被打进了产物（应为 external）')


const source = await readFile(new URL('../client/main.jsx', import.meta.url), 'utf8')
if (/\buse[A-Z]\w*/u.test(source) && !written.includes('require("react")')) {
  problems.push('源码使用了 React hooks，但产物没有 require("react")——检查 client/main.jsx 的 hooks 导入')
}


if (/\bcreatePortal\b/u.test(source) && !written.includes('require("react-dom")')) {
  problems.push('源码使用了 createPortal，但产物没有 require("react-dom")——检查 react-dom 是否在 external 列表里')
}

for (const marker of ['.dfm-viewer-stage', '.dfm-thumb-box', '.dfm-audio-card']) {
  if (!written.includes(marker)) problems.push(`产物里缺少样式 ${marker}`)
}


for (const specifier of ['./media.js', './icon-props.js']) {
  const moduleSource = await readFile(new URL(`../client/${specifier.slice(2)}`, import.meta.url), 'utf8')
  const exported = [...moduleSource.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/gu)].map((match) => match[1])
  const line = source.match(new RegExp(`import \\{([^}]*)\\} from '${specifier.replace('.', '\\.')}'`, 'u'))
  const imported = line === null
    ? []
    : line[1].split(',').map((item) => item.trim()).filter((item) => item.length > 0)
  const missing = exported.filter((name) => new RegExp(`\\b${name}\\s*\\(`, 'u').test(source) && !imported.includes(name))
  if (missing.length > 0) {
    problems.push(`client/main.jsx 调用了 ${specifier} 的导出却没有导入：${missing.join('、')}`)
  }
}
if (problems.length > 0) {
  console.error('构建自检失败：\n - ' + problems.join('\n - '))
  process.exit(1)
}

const size = Buffer.byteLength(written)
console.log(`已生成 client.js（${(size / 1024).toFixed(1)} KB）`)
