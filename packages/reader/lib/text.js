import { reject } from './validate.js'

export function decodeText(input) {
  let encoding='utf-8',data=input
  if(input[0]===255&&input[1]===254){encoding='utf-16le';data=input.subarray(2)}
  else if(input[0]===254&&input[1]===255){encoding='utf-16be';data=input.subarray(2)}
  let text
  try{text=new TextDecoder(encoding,{fatal:true}).decode(data)}catch{
    if(encoding!=='utf-8')reject(415,'INVALID_TEXT_ENCODING')
    encoding='gb18030';try{text=new TextDecoder(encoding,{fatal:true}).decode(data)}catch{reject(415,'INVALID_TEXT_ENCODING')}
  }
  if(text.includes('\0')||/[\x01-\x08\x0b\x0c\x0e-\x1f]/.test(text))reject(415,'INVALID_TEXT_ENCODING')
  return {text:text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n'),encoding}
}
