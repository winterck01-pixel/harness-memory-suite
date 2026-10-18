// Package-local read adapter for the shared image-studio name catalog.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function readAssetNames(dir){try{return JSON.parse(await readFile(join(dir,'asset-names.json'),'utf8'))}catch(e){if(e.code==='ENOENT')return {};throw e}}
export function namedAssets(rows,names){return rows.map(a=>Object.prototype.hasOwnProperty.call(names,a.id)?{...a,name:names[a.id]}:a)}
