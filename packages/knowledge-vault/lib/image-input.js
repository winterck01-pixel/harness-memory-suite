export function validateImage(image){
 if(!(image?.bytes instanceof Uint8Array)||!image.bytes.length||image.bytes.length>=10*1024*1024)throw new Error('INVALID_IMAGE_EMBEDDING_INPUT');const b=Buffer.from(image.bytes);let width,height,mime;
 if(b.length>=24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){mime='image/png';width=b.readUInt32BE(16);height=b.readUInt32BE(20)}else if(b[0]===255&&b[1]===216){let i=2;while(i+8<b.length){if(b[i++]!==255)break;const marker=b[i++],n=b.readUInt16BE(i);if(n<2)break;if([192,193,194].includes(marker)){mime='image/jpeg';height=b.readUInt16BE(i+3);width=b.readUInt16BE(i+5);break}i+=n}}
 if(mime!==image.mediaType||!width||!height||width<=14||height<=14||width*height>=36000000)throw new Error('INVALID_IMAGE_EMBEDDING_INPUT');return {bytes:b,mediaType:mime,width,height}
}
export function selectedPages(pages){if(!Array.isArray(pages)||!pages.length||pages.length>3||new Set(pages).size!==pages.length||pages.some(p=>!Number.isSafeInteger(p)||p<1||p>500))throw new Error('IMAGE_PAGE_SELECTION_REQUIRED');return pages}
