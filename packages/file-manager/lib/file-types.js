
export const FILE_TYPES = {
  folder: {label:'文件夹',color:'#3499d4'},
  image: {label:'图片',color:'#8b63d2'},
  video: {label:'视频',color:'#d76a4d'},
  audio: {label:'音频',color:'#ce5797'},
  spreadsheet: {label:'表格',color:'#399369'},
  document: {label:'文档',color:'#4c83cc'},
  code: {label:'代码',color:'#bd8431'},
  archive: {label:'压缩包',color:'#9c7b60'},
  webpage: {label:'网页',color:'#339a9f'},
  note: {label:'笔记',color:'#c19738'},
  other: {label:'其他',color:'#7b8595'},
}
const groups = {
  image:'png jpg jpeg jpe gif webp avif apng bmp ico svg tif tiff heic heif',
  video:'mp4 m4v webm ogv mov mkv avi mpg mpeg 3gp m2ts',
  audio:'mp3 m4a aac wav wave flac ogg oga opus weba aif aiff wma mid midi',
  spreadsheet:'xls xlsx xlsm ods csv tsv numbers',
  document:'pdf doc docx odt rtf txt md markdown pages ppt pptx odp key',
  code:'js mjs cjs jsx ts tsx vue svelte py rb go rs java kt c h cc cpp hpp cs swift dart sh bash zsh fish ps1 sql graphql proto json jsonc yaml yml toml xml html htm css scss less ini cfg conf env',
  archive:'zip rar 7z tar gz bz2 xz tgz',
}
const extensions = new Map(Object.entries(groups).flatMap(([type,list])=>list.split(' ').map(ext=>[ext,type])))
export function fileType(entry) {
  if(entry?.dir || entry?.kind==='dir')return 'folder'
  const path=String(entry?.path || entry?.name || ''),name=path.split('/').at(-1),ext=name.includes('.')?name.split('.').at(-1).toLowerCase():''
  return extensions.get(ext) || (['image','video','audio'].includes(entry?.kind)?entry.kind:'other')
}
const categories={image:'image',picture:'image','image-prompt':'image','图片':'image',video:'video','视频':'video',audio:'audio','音频':'audio',spreadsheet:'spreadsheet','表格':'spreadsheet',document:'document',article:'document','文档':'document',text:'document','文本':'document',code:'code','代码':'code',webpage:'webpage','网页':'webpage',note:'note',idea:'note','笔记':'note',archive:'archive','压缩包':'archive'}
export function knowledgeType(entry) {
  if(entry?.directory)return "folder"
  if(entry?.assetId?.startsWith('file:'))return fileType({path:entry.assetId.slice(5)})
  const explicit=categories[String(entry?.category||'').toLowerCase()]
  if(explicit)return explicit
  if(entry?.sourceUrl){try{const u=new URL(entry.sourceUrl);const kind=fileType({path:u.pathname});return kind==='other'?'webpage':kind}catch{}}
  if(entry?.assetId)return 'other'
  return 'note'
}
