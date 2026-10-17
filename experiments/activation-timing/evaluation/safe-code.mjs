import { parse } from 'acorn';
const dangerous = new Set(['constructor','prototype','__proto__','globalThis','process','require','eval','Function','import','module','exports']);
const staticMember = node => !node.computed ? node.property.name
  : node.property.type==='Literal'&&typeof node.property.value==='string' ? node.property.value : null;
/** Positive AST language: no filesystem, network, dynamic member, loop or code construction. */
export function validateFixtureCode(code, targetName) {
  if (typeof code !== 'string' || code.length > 20000) throw new Error('UnsafeCode');
  // Parse the entire supplied body. A synthetic function wrapper can be closed
  // by the input, leaving unchecked top-level AST nodes after body[0].
  const ast=parse(code,{ecmaVersion:'latest',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true});
  const locals=new Set(), methods=new Set([targetName,'activate_tool_group','search_capabilities']);
  const visit=node=>{
    if(!node || typeof node!=='object') return;
    switch(node.type){
      case 'Program': case 'BlockStatement': for(const s of node.body) visit(s); break;
      case 'ExpressionStatement': case 'ReturnStatement': visit(node.expression??node.argument); break;
      case 'VariableDeclaration': if(node.kind!=='const'&&node.kind!=='let')throw Error('UnsafeCode');for(const d of node.declarations){if(d.id.type!=='Identifier'||dangerous.has(d.id.name)||['tools','console','JSON'].includes(d.id.name))throw Error('UnsafeCode');visit(d.init);locals.add(d.id.name);}break;
      case 'Identifier': if(!locals.has(node.name)&&!['tools','console','JSON','undefined'].includes(node.name))throw Error('UnsafeCode');break;
      case 'Literal': if(node.regex||typeof node.value==='bigint')throw Error('UnsafeCode');break;
      case 'AwaitExpression': visit(node.argument);break;
      case 'ArrayExpression': for(const e of node.elements)visit(e);break;
      case 'ObjectExpression':for(const p of node.properties){if(p.type!=='Property'||p.computed||p.method||p.kind!=='init'||dangerous.has(p.key.name??p.key.value))throw Error('UnsafeCode');visit(p.value);}break;
      case 'MemberExpression':{
        const member=staticMember(node);
        if(!member||node.object.type!=='Identifier'||dangerous.has(member)||!(node.object.name==='tools'&&methods.has(member)||node.object.name==='console'&&member==='log'||node.object.name==='JSON'&&member==='stringify'||locals.has(node.object.name)&&['name','message','toolName'].includes(member)))throw Error('UnsafeCode');break;
      }
      case 'CallExpression': if(node.callee.type!=='MemberExpression'||node.optional||!['tools','console','JSON'].includes(node.callee.object?.name))throw Error('UnsafeCode');visit(node.callee);if(node.callee.object.name==='JSON'&&node.arguments.length!==1)throw Error('UnsafeCode');for(const a of node.arguments)visit(a);break;
      case 'AssignmentExpression':if(node.operator!=='='||node.left.type!=='Identifier'||!locals.has(node.left.name)||['tools','console','JSON','undefined'].includes(node.left.name))throw Error('UnsafeCode');visit(node.right);break;
      case 'ChainExpression':if(node.expression.type!=='MemberExpression')throw Error('UnsafeCode');visit(node.expression);break;
      case 'TryStatement':visit(node.block);visit(node.handler);visit(node.finalizer);break;
      case 'CatchClause':if(node.param){if(node.param.type!=='Identifier'||dangerous.has(node.param.name)||['tools','console','JSON','undefined'].includes(node.param.name))throw Error('UnsafeCode');locals.add(node.param.name);}visit(node.body);break;
      case 'UnaryExpression':if(!['typeof','!','-','+'].includes(node.operator))throw Error('UnsafeCode');visit(node.argument);break;
      case 'BinaryExpression': case 'LogicalExpression':if(!['===','!==','==','!=','+','-','&&','||','??'].includes(node.operator))throw Error('UnsafeCode');visit(node.left);visit(node.right);break;
      case 'ConditionalExpression':visit(node.test);visit(node.consequent);visit(node.alternate);break;
      case 'IfStatement':visit(node.test);visit(node.consequent);visit(node.alternate);break;
      case 'EmptyStatement':break;
      default:throw new Error(`UnsafeCode:${node.type}`);
    }
  };
  visit(ast);return true;
}
