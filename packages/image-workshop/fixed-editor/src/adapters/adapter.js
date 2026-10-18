// 适配器接口（UI 唯一依赖面）。
// UI 只依赖本接口与契约 documentSchema/projectApi/generationAdapter/exportApi，
// 不直接 fetch、不感知真实/ mock 差异（除 mock 适配器显式标注外）。
// 集成时由 lead 将 createMockAdapter() 替换为 core 的 generation-adapter + 真实 project/asset API。

/**
 * @typedef {Object} EditorAdapter
 * @property {() => Promise<{projects: ProjectMeta[]}>} listProjects
 * @property {(input:{name:string,width:number,height:number}) => Promise<{project:Project,canvas:Canvas}>} createProject
 * @property {(projectId:string,name:string) => Promise<{project:Project}>} renameProject
 * @property {(projectId:string) => Promise<{project:Project,canvas:Canvas}>} openProject 恢复上次画布
 * @property {(projectId:string) => Promise<{canvases:CanvasMeta[]}>} listCanvases
 * @property {(projectId:string,input:{name:string,width:number,height:number}) => Promise<{canvas:Canvas}>} createCanvas
 * @property {(canvasId:string) => Promise<{canvas:Canvas,layers:Layer[],assets:Asset[]}>} getCanvas
 * @property {(canvasId:string,input:{expectedRevision:number,commands:CommandEnvelope[]}) => Promise<{canvas:Canvas,newRevision:number}>} putCanvas
 * @property {(canvasId:string,name:string) => Promise<{canvas:Canvas}>} renameCanvas
 * @property {(canvasId:string) => Promise<{ok:true}>} deleteCanvas
 * @property {(file:File) => Promise<Asset>} uploadImage
 * @property {(input:{layerId:string,bounds:'content'|'canvas'}) => Promise<Blob>} exportLayer
 * @property {(canvasId:string) => Promise<Blob>} exportComposite
 * @property {(batch:GenerationBatch) => Promise<{tasks:GenerationTask[]}>} submitGeneration
 * @property {(taskId:string) => Promise<GenerationTask>} getTask
 * @property {(taskId:string) => Promise<{ok:true}>} cancelTask
 * @property {(batchId:string) => Promise<GenerationBatch & {candidates:Candidate[]}>} getBatch
 * @property {boolean} mock 适配器必须标注 mock 身份
 */

export const ADAPTER_METHODS = [
  'listProjects', 'createProject', 'renameProject', 'openProject', 'listCanvases',
  'createCanvas', 'getCanvas', 'putCanvas', 'renameCanvas', 'deleteCanvas',
  'uploadImage', 'exportLayer', 'exportComposite',
  'submitGeneration', 'getTask', 'cancelTask', 'getBatch', 'applyCandidate', 'listBatches', 'costPreview',
];

export function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new Error('图片工坊尚未连接编辑器服务，请提供真实 adapter');
  for (const m of ADAPTER_METHODS) {
    if (typeof adapter[m] !== 'function') throw new Error(`适配器缺少方法 ${m}`);
  }
  if (adapter.mock !== true && typeof adapter.getModels !== 'function') throw new Error('真实适配器必须提供实时模型能力 getModels');
  return adapter;
}

// 契约错误形状：{ error, code, status }
export function adapterError(code, message, status = 400) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  return e;
}
