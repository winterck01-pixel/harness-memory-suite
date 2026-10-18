import {build} from 'esbuild';import {writeFile} from 'node:fs/promises';
const options={entryPoints:['client.jsx'],bundle:true,write:false,format:'cjs',platform:'browser',jsx:'automatic',external:['react','react/jsx-runtime','react-dom'],loader:{'.css':'text'},target:'es2022'};
const r=await build(options);await writeFile('client.js',`window.__ModuleLoader__.load({id:"dsh-live-film",factory:(require)=>{const module={exports:{}};const exports=module.exports;\n${r.outputFiles[0].text}\nreturn module.exports;}});`);
await build({entryPoints:['tests/preview.jsx'],outfile:'tests/preview.js',bundle:true,format:'esm',platform:'browser',jsx:'automatic',external:['react','react/jsx-runtime','react-dom'],loader:{'.css':'text'},target:'es2022'});
