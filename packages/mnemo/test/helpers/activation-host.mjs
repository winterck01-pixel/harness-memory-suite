import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import * as runtime from '../../lib/activation-sandbox.js'

// A detached plugin cannot infer the host or its independently versioned companion
// plugins from its parent directory. The runner supplies explicit operator fixtures.
const configured=process.env.MNEMO_TEST_SANDBOX_OPTIONS?JSON.parse(process.env.MNEMO_TEST_SANDBOX_OPTIONS):{}
if(!configured||typeof configured!=='object'||Array.isArray(configured))throw Error('MNEMO_TEST_SANDBOX_OPTIONS must be an options object')
export const sandboxOptions={
 hostDependencyAnchor:fileURLToPath(new URL('../../package.json',import.meta.url)),
 contextPolicyPath:fileURLToPath(new URL('../../../context-policy/index.js',import.meta.url)),
 ...configured,
}
export const policyDirectory=dirname(sandboxOptions.contextPolicyPath)
export const lifecycleDirectory=sandboxOptions.contextPolicyDependencyRoots?.[0]??join(dirname(policyDirectory),'dsh-skill-lifecycle')
export const hostDependencyAnchor=sandboxOptions.hostDependencyAnchor
export const hostNodeModules=join(dirname(hostDependencyAnchor),'node_modules')
export const hostScopedPackages=join(hostNodeModules,'@deepseek-ai')
export const hostRequire=createRequire(resolve(hostDependencyAnchor))
const optionsFor=(options={})=>({...sandboxOptions,...options,...(Object.hasOwn(options,'contextPolicyPath')&&!Object.hasOwn(options,'contextPolicyDependencyRoots')?{contextPolicyDependencyRoots:undefined}:{})})
export const activationContractManifest=options=>runtime.activationContractManifest(optionsFor(options))
export const getActivationSandboxContract=activationContractManifest
export const createActivationSandbox=options=>runtime.createActivationSandbox(optionsFor(options))
export const evaluateActivationTask=options=>runtime.evaluateActivationTask(optionsFor(options))
export {activationOracle,validateActivationTask,validateFixtureCode} from '../../lib/activation-sandbox.js'
