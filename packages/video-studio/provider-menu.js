import {MODEL_CATALOG} from './model-registry.js';
export const PROVIDER_OPTIONS=[{source:'',label:'ToAPIs / 自定义兼容服务'},...MODEL_CATALOG.map(m=>({source:m.id,label:m.displayName||m.providerModel||m.id}))];
