import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
const result=await build({entryPoints:[new URL('./client.jsx',import.meta.url).pathname],bundle:true,write:false,format:'cjs',platform:'browser',jsx:'automatic',external:['react','react/jsx-runtime','react-dom'],loader:{'.css':'text'},target:'es2022'});
await writeFile(new URL('./client.js',import.meta.url),`window.__ModuleLoader__.load({id:"dsh-image-workshop",factory:(require)=>{const module={exports:{}};const exports=module.exports;\n${result.outputFiles[0].text}\nreturn module.exports;}});`);
