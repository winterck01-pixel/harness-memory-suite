/** Keep prompt references aligned with the actual shared/local submission order. */
export function shotRefs(project,shot){return [...new Map([...(project?.sharedRefs||[]),...(shot?.refs||[])].map(r=>[r.id,r])).values()]}
export function mentionAssets(refs,assets){
 const counts={image:0,video:0,audio:0};
 return refs.map(ref=>{const asset=assets.find(a=>a.id===ref.id),kind=asset?.type?.split('/')[0];if(!Object.hasOwn(counts,kind))return null;const index=++counts[kind],label=({image:'图片',video:'视频',audio:'音频'}[kind])+index;return {...ref,asset,kind,index,label,token:'@'+label}}).filter(Boolean);
}
const tokenPattern=()=>/@(图片|视频|音频)([1-9]\d*)(?!\d)/gu;
const removedPattern=/【已移除参考：[图片视频音频]+\d+】/u;
export function remapShotMentions(prompt,before,after,assets){
 if(before.some(ref=>!assets.some(asset=>asset.id===ref.id)))return prompt.replace(tokenPattern(),token=>'【已移除参考：'+token.slice(1)+'】');
 const old=mentionAssets(before,assets),next=mentionAssets(after,assets);
 return prompt.replace(tokenPattern(),(token,label,n)=>{const row=old.find(r=>r.token===token);if(!row)return token;return next.find(r=>r.id===row.id)?.token||'【已移除参考：'+label+n+'】'});
}
export function compileShotMentions(prompt,refs,assets){
 if(removedPattern.test(prompt))throw Error('提示词引用的素材已移除，请删除标记或重新选择参考素材');
 const rows=mentionAssets(refs,assets);
 return prompt.replace(tokenPattern(),token=>{const row=rows.find(r=>r.token===token);if(!row)throw Error(token+' 没有对应的参考素材，请重新选择');return row.label+'（'+(row.asset.name||'参考素材')+'）'});
}
