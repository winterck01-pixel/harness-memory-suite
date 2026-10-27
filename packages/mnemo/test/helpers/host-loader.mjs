import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
const options=JSON.parse(process.env.MNEMO_TEST_SANDBOX_OPTIONS??'{}')
const anchor=options.hostDependencyAnchor??new URL('../../package.json',import.meta.url)
const require=createRequire(anchor)
// Only bare host imports made by this detached plugin need bridging. SDK-internal
// imports continue resolving from their own physical packages and export maps.
const bridged=new Set(['@deepseek-ai/cordis','@deepseek-ai/dsh-system-prompt'])
export async function resolve(specifier,context,nextResolve){
 return nextResolve(bridged.has(specifier)?pathToFileURL(require.resolve(specifier)).href:specifier,context)
}
