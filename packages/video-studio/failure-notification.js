export function failureNotification(task={},delivery={}){
 const error=String(task.error||'');const http=/HTTP (\d{3})/.exec(error)?.[1];let type='生成失败',reason='服务未提供具体原因。',advice='请检查任务详情后决定是否重试。';
 if(task.stage==='download_failed'){type='结果保存失败';reason='服务已完成生成，但结果尚未保存到工坊。';advice='请在工坊重新下载原任务结果，不要重新生成；下载恢复不会发起生成计费。';}
 else if(/safety review|content.?policy|moderation|安全审核|内容审核/i.test(error)){type='内容审核拦截';reason='服务商的审核拦截了输入或生成内容；服务未说明具体触发项。';advice='请检查参考图和提示词，按服务商要求调整后再提交。';}
 else if(task.status==='timed_out'){type='查询超时';reason='在查询期限内未获得最终结果，远程任务可能仍在运行。';advice='请先查询原任务，避免重复提交产生费用。';}
 else if(delivery.status==='attention'){type='媒体推送失败';const statuses=(delivery.items||[]).map(x=>x.status);reason=statuses.includes('too_large')?'文件已保存，但超过渠道50 MB发送上限；请在工坊下载原件。':statuses.includes('unsupported')?'该渠道不支持此媒体类型。':statuses.includes('file_unavailable')?'生成结果文件无法读取。':statuses.includes('binding_changed')?'会话的远程聊天绑定发生了变化。':'视频已生成，但渠道未确认发送成功。';advice='请保留生成结果，检查渠道连接；无需重新生视频。';}
 else if(http){type=/参考图上传/.test(error)?'参考图上传失败':'接口拒绝或异常';reason=({'400':'请求参数或参考图上传格式被服务商拒绝。','401':'API Key 无效或已过期。','403':'服务商拒绝访问，可能缺少权限。','413':'上传文件超过服务商允许的大小。','429':'服务商限流或配额受限。'}[http]||'服务商接口异常。')+'（HTTP '+http+'）';advice='请按具体原因检查接口设置、权限或服务商状态。';}
 else if(/fetch failed|network|ECONN|ENOTFOUND|timeout|aborted/i.test(error)){type='网络或请求超时';reason='连接服务商失败或请求未得到响应，提交结果可能未确认。';advice='请先查询原任务，避免重复提交。';}
 else if(task.status==='uncertain'){type='提交结果未确认';reason='未取得视频或可查询的任务 ID，无法确认服务商是否已接收任务。';advice='请先检查服务商任务记录，避免重复计费。';}
 // Only structured provider messages are forwarded; redact credentials, URLs and local paths.
 let detail=error.match(/(?:服务返回生成失败|HTTP \d{3})[：:]\s*([\s\S]+)/)?.[1]?.replace(/；未自动重试提交。$/,'');
 if(detail&&!/safety review|content.?policy|moderation/i.test(detail)){
  detail=detail.replace(/Bearer\s+\S+/gi,'Bearer [已隐藏]').replace(/\b(?:sk-|sk_)[A-Za-z0-9_-]+/g,'[密钥已隐藏]').replace(/(?:api[_-]?key|token|authorization|password)\s*[:=]\s*[^\s,;]+/gi,'凭据=[已隐藏]').replace(/https?:\/\/[^\s]+/g,'[服务地址已隐藏]').replace(/\/(?:home|Users|tmp)\/[^\s]+/g,'[路径已隐藏]').slice(0,350);
  reason+='\n服务说明：'+detail;
 }
 if(http&&!reason.includes('HTTP '+http))reason+='（最近接口状态：HTTP '+http+'）';
 return '视频任务未完成\n失败类型：'+type+'\n原因：'+reason+'\n建议：'+advice+'\n任务 ID：'+task.id+'\n未自动重新生成或重发。';
}
