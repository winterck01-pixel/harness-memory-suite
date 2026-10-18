import {modelSpec} from './model-registry.js';
export const ratiosFor=id=>modelSpec(id).ratios;
export const sizeForRatio=(_id,ratio)=>ratio||'16:9';
