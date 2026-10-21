// Format-specific generation advice stays outside the general agent workflow.
// These are instructions for using source data, not a claim of parser support.
const adapters=[{
 id:'sketch',extensions:['sketch'],guidance:'Sketch 还原先检查真实页面和组件结构，在小范围验证解析结果后再生成全稿。保留画板名称以绑定原稿；保留父子层级，或累计父级变换后再平铺，不能直接使用子图层的局部坐标。区分实例位置与母版位置，子图层相对于实例，不重复减母版坐标；处理实例缩放、覆盖值和隐藏状态。字体与文本颜色从 attributedString.attributes[].attributes 等实际嵌套属性读取；填充按实际类型解析，不把缺失字段当有效默认样式。核对图片路径、可见图层和组件定义；未支持的变换、蒙版或缺失组件库必须报告，不静默跳过。生成后对照原稿和实际渲染，原稿预览不能替代生成结果。'
}];
function forMaterials(materials=[]){
 const extensions=new Set(materials.flatMap(m=>[m.name,m.sourcePath]).filter(v=>typeof v==='string').map(v=>v.split('.').at(-1).toLowerCase()));
 return adapters.filter(a=>a.extensions.some(e=>extensions.has(e))).map(({id,guidance})=>({format:id,guidance}));
}
module.exports={forMaterials};
