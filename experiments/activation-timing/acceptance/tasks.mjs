// First exposed in this confirmation cohort. Never reuse repair diagnostics as held-out results.
export const tasks = Object.freeze([
 ['confirm-match-01','matching','tidal_index',false,false,'known','读取 tidal_index 的仪器状态，将原始状态值作为最终回答。'],
 ['confirm-match-02','matching','prism_status',false,false,'known','通过 prism_status 核对样例就绪状态，报告工具实际返回值。'],
 ['confirm-active-01','already-active','mosaic_sensor',true,false,'known','mosaic_sensor 已激活；请获取它返回的原始状态值。'],
 ['confirm-active-02','already-active','summit_register',true,false,'known','读取已经可用的 summit_register；最终回答包含实际状态值。'],
 ['confirm-denied-01','permission-denied','delta_indicator',false,true,'known','查询 delta_indicator；若权限拒绝，如实报告权限限制，不能绕过。'],
 ['confirm-unknown-01','unknown-metadata','fern_indicator',false,false,'withheld','读取 fern_indicator 并报告状态；激活时序元数据未知，请按实际合同或反馈处理。'],
].map(([id,family,targetName,initiallyActive,denyTarget,contractVisibility,prompt])=>Object.freeze({id,family,targetName,initiallyActive,denyTarget,contractVisibility,prompt,expected:denyTarget?null:'FIXTURE_OK'})));
