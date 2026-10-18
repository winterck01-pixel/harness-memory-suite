// Source video is a distinct native binding; it must never become a reference_asset.
export function workrallySource(refs,extra={}){
 const videos=refs.filter(r=>r?.type?.startsWith('video/'));
 if(extra.sourceVideoId!==undefined){if(typeof extra.sourceVideoId!=='string'||!extra.sourceVideoId)throw Error('编辑源视频 ID 无效');const source=videos.find(r=>r.id===extra.sourceVideoId);if(!source)throw Error('编辑源视频须在本次参考素材中选择');return source;}
 if(videos.length!==1)throw Error('请选择一个编辑源视频；有多个视频时须明确指定源视频');return videos[0];
}
export function workrallyEditProblem(spec,refs,request={}){
 try{
  const source=workrallySource(refs,request.extra),row=spec.workrally.declaration;
  if(!Number.isFinite(source.duration)||source.duration<=0||!Number.isInteger(source.width)||source.width<=0||!Number.isInteger(source.height)||source.height<=0)throw Error('编辑源视频必须具有实际宽度、高度和时长');
  const references=refs.filter(r=>r!==source),counts={image:0,video:0,audio:0},seconds={video:0,audio:0};
  if(references.length>(row.max_file_count??200))throw Error('编辑参考素材总数超过模型限制');
  for(const ref of references){const kind=ref?.type?.split('/')[0];if(!(kind in counts)||!row['can_upload_'+kind]||++counts[kind]>(row['max_'+kind+'_count']||0))throw Error('编辑参考素材类型或数量超过模型限制');if(kind!=='image'){if(!Number.isFinite(ref.duration)||ref.duration<=0)throw Error('编辑参考音视频缺少实际时长');seconds[kind]+=ref.duration;}}
  for(const kind of ['video','audio'])if(row['max_'+kind+'_duration']>0&&seconds[kind]>row['max_'+kind+'_duration']+0.001)throw Error('编辑参考音视频总时长超过模型限制');
  const erase=request.extra?.enable_erase_subtitles;if(erase!==undefined&&(typeof erase!=='boolean'||!row.support_erase_subtitles))throw Error('当前编辑型号不支持此字幕抹除参数');
  return '';
 }catch(e){return e.message;}
}
