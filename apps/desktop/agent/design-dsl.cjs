// The exported DSL carries resolved relative geometry and expanded instances.
// Normalize its source tree for existing structural checks; image comparison
// remains mandatory for effects, clipping, typography and actual fidelity.
function parse(value){
 const dsl=value?.dsl;if(!dsl||!Array.isArray(dsl.nodes)||!dsl.nodes.length)return null;
 let count=0;
 const styles=dsl.styles||{};
 function rgba(hex){if(typeof hex!=='string'||!/^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(hex))return;const s=hex.slice(1);return {red:parseInt(s.slice(0,2),16)/255,green:parseInt(s.slice(2,4),16)/255,blue:parseInt(s.slice(4,6),16)/255,alpha:s.length===8?parseInt(s.slice(6,8),16)/255:1};}
 function layer(n,depth=0){
  if(++count>30000||depth>64)throw Error('设计DSL节点超出检查范围，请按目标画板拆分，不能略过未解析节点');
  if(!n||typeof n.id!=='string'||!n.layoutStyle||!['width','height','relativeX','relativeY'].every(k=>Number.isFinite(n.layoutStyle[k])))throw Error('设计DSL缺少真实节点ID或已解析坐标，请读取原始DSL而非生成简化占位数据');
  const f=n.layoutStyle,c=rgba(n._color),text=n.type==='TEXT',spans=Array.isArray(n.text)?n.text:[],font=styles[spans[0]?.font]?.value;
  return {_class:text?'text':depth===0?'artboard':'group',do_objectID:n.id,name:n.name||n.id,isVisible:n.visible!==false,frame:{x:f.relativeX,y:f.relativeY,width:f.width,height:f.height},style:c?{fills:[{isEnabled:true,fillType:0,color:c}]}:{},...(text?{attributedString:{string:spans.map(s=>s.text||'').join(''),attributes:[{attributes:{...(font?{MSAttributedStringFontAttribute:{attributes:{name:font.family,size:font.size}}}:{}),...(c?{MSAttributedStringColorAttribute:c}:{})}}]}}:{}),layers:(n.children||[]).map(child=>layer(child,depth+1))};
 }
 return {_class:'page',layers:dsl.nodes.map(n=>layer(n)),sourceFormat:'design-dsl'};
}
module.exports={parse};
