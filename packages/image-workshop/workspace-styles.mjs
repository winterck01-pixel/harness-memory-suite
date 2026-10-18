import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {transform} from 'esbuild';

// Compile namespace isolation into ordinary CSS; no runtime browser feature required.
export async function compileWorkspaceStyles(css,workspace){
 let root;
 if(workspace==='editor'){
  root='.iw-fixed-editor';
  css=css.replace(/:root(?=\s*\{)/g,'&').replace(/html,\s*body,\s*#root(?=\s*\{)/g,'&').replace(/(^|\})\s*body(?=\s*\{)/g,'$1\n&');
 }else if(workspace==='legacy'){
  // PreviewFrame portals live outside the main workspace, with their own surface.
  root='.iw, .dsh-history-preview';
  css=css.replace(/\.iw(?=\s*\{)/g,'&.iw');
 }else throw Error('Unknown image workspace stylesheet');
 return (await transform(root+' {\n'+css+'\n}',{loader:'css',supported:{nesting:false}})).code;
}
export function workspaceStylePlugin(){
 const kinds=new Map([[fileURLToPath(new URL('./style.css',import.meta.url)),'legacy'],[fileURLToPath(new URL('./fixed-editor/src/styles.css',import.meta.url)),'editor']]);
 return {name:'image-workspace-style-isolation',setup(build){build.onLoad({filter:/\.css$/},async({path})=>{const kind=kinds.get(path);if(!kind)return;return {contents:await compileWorkspaceStyles(await readFile(path,'utf8'),kind),loader:'text'};});}};
}
