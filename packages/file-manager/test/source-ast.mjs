import assert from 'node:assert/strict'
import {Parser} from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
export function parseSource(source) {
  return JsxParser.parse(source, {ecmaVersion: 'latest', sourceType: 'module'})
}
export function nodes(root, predicate) {
  const found=[]
  function visit(value) {
    if (!value || typeof value!=='object') return
    if (Array.isArray(value)) { for (const child of value) visit(child); return }
    if (typeof value.type==='string' && predicate(value)) found.push(value)
    for (const child of Object.values(value)) visit(child)
  }
  visit(root)
  return found
}
export function unique(matches, label) {
  assert.equal(matches.length,1,`Expected exactly one ${label}; AST extraction must not silently select another function`)
  return matches[0]
}
export function functionNode(ast, name) {
  return unique(nodes(ast,n=>n.type==='FunctionDeclaration' && n.id?.name===name),`function ${name}`)
}
export function namedStatement(body, name) {
  return unique(body.filter(n=>n.type==='VariableDeclaration' && n.declarations.some(d=>d.id.type==='Identifier' && d.id.name===name)),`declaration ${name}`)
}
