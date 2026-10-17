export const arkImageDocumentInstructions='Instruction:Compress the image into one word.\nQuery:'
export const arkMultimodalQueryInstructions='Target_modality: text/image.\nInstruction:Retrieve text or images that answer this question.\nQuery:'
export const arkImageQueryInstructions='Target_modality: text/image.\nInstruction:Retrieve text or images related to this image.\nQuery:'
export const arkQueryInstructions='Target_modality: text.\nInstruction:Retrieve text passages that answer the query.\nQuery:'
export const arkDocumentInstructions='Instruction:Compress the text into one word.\nQuery:'
const ark='https://ark.cn-beijing.volces.com/api/v3'
export const providerCatalog={version:3,protocols:[
 {id:'openai-chat',roles:['text','ocr','vision'],endpointKind:'base-url',path:'/chat/completions',credentialFields:['apiKey']},
 {id:'openai-embeddings',roles:['embedding'],endpointKind:'base-url',path:'/embeddings',credentialFields:['apiKey']},
 {id:'ark-multimodal',roles:['embedding'],endpointKind:'base-url',path:'/embeddings/multimodal',credentialFields:['apiKey'],dimensions:[1024,2048],oneRequestPerChunk:true,denseOnly:true},
 {id:'volc-visual-ocr',roles:['ocr'],endpointKind:'origin',path:'/?Action=OCRNormal&Version=2020-08-26',credentialFields:['accessKey','secretKey'],regionRequired:true,signingService:'cv',models:['OCRNormal'],ocrMethod:'dedicated-ocr'},
 {id:'dashscope-rerank',roles:['rerank'],endpointKind:'origin',path:'/api/v1/services/rerank/text-rerank/text-rerank',credentialFields:['apiKey']},
 {id:'cohere-v2',roles:['rerank'],endpointKind:'base-url',path:'/rerank',credentialFields:['apiKey']},
 {id:'vikingdb-rerank',roles:['rerank'],endpointKind:'origin',path:'/api/knowledge/service/rerank',credentialFields:['accessKey','secretKey'],regionRequired:true,signingService:'air',instructionModels:['doubao-seed-rerank']}
],presets:[
 ...['qwen3.7-text-rerank','qwen3-rerank','gte-rerank-v2','qwen3-vl-rerank'].map(model=>({id:'aliyun-'+model,roles:['rerank'],label:'阿里云百炼 '+model+(model==='qwen3-vl-rerank'?'（图文候选）':''),config:{source:'independent',provider:'aliyun-bailian',protocol:'dashscope-rerank',endpoint:'',model,enabled:false}})),
 {id:'volcengine-visual-ocr',roles:['ocr'],label:'火山 Visual 通用文字识别',ocrMethod:'dedicated-ocr',config:{source:'independent',provider:'volcengine-visual',protocol:'volc-visual-ocr',endpoint:'https://visual.volcengineapi.com',region:'cn-north-1',model:'OCRNormal',enabled:false}},
 {id:'volcengine-ark-embedding',roles:['embedding'],label:'火山 Ark 文本与图片向量',config:{source:'independent',provider:'volcengine-ark',protocol:'ark-multimodal',endpoint:ark,model:'doubao-embedding-vision-251215',dimensions:1024,imageEnabled:false,imageDocumentInstructions:arkImageDocumentInstructions,imageQueryInstructions:arkImageQueryInstructions,multimodalQueryInstructions:arkMultimodalQueryInstructions,queryInstructions:arkQueryInstructions,documentInstructions:arkDocumentInstructions,enabled:false}},
 ...['small','standard','large'].map((size,index)=>({id:'volcengine-ark-'+['lite','turbo','pro'][index],roles:['text','ocr','vision'],label:'Ark configurable text model ('+size+')',ocrMethod:'vision-transcription',config:{source:'independent',provider:'volcengine-ark',protocol:'openai-chat',endpoint:ark,model:'configure-'+size+'-text-model',reasoningEffort:index===0?'':'minimal',enabled:false}})),
 ...['doubao-seed-rerank','base-multilingual-rerank'].map(model=>({id:'volcengine-vikingdb-'+model,roles:['rerank'],label:'VikingDB '+model,config:{source:'independent',provider:'volcengine-vikingdb',protocol:'vikingdb-rerank',endpoint:'https://api-knowledgebase.mlp.cn-beijing.volces.com',region:'cn-beijing',model,enabled:false}}))
]}
