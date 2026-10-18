import { access, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const result = await build({
  absWorkingDir: root,
  entryPoints: ['client.jsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  target: 'es2022',
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  legalComments: 'none',
})
const output = result.outputFiles[0].text
if (!output.includes('require("react")') || !output.includes('require("react/jsx-runtime")')) {
  throw new Error('React imports must resolve through the host module loader')
}
await writeFile(new URL('./client.js', import.meta.url), [
  '// Generated from client.jsx by build.mjs.',
  'window.__ModuleLoader__.load({',
  '  id: "dsh-launchpad",',
  '  factory: (require) => {',
  '    const module = { exports: {} };',
  '    const exports = module.exports;',
  output,
  '    return module.exports;',
  '  },',
  '});',
  '',
].join('\n'))
await access(new URL('./client.js', import.meta.url))
console.log(`built dsh-launchpad client (${Buffer.byteLength(output)} bytes)`)
