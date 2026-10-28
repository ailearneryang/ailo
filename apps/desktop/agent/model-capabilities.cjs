// Modality knowledge is scoped to an exact public model ID and documented
// provider hosts. Display names, aliases and arbitrary proxy URLs are not proof.
// Keep this boundary aligned with the Aliyun host boundary in reasoning.cjs.
const GLM52_SOURCE='https://help.aliyun.com/zh/model-studio/glm-5-2';
function documentedTextModel(model={}){
 if(model.model!=='glm-5.2')return null;
 try{
  const url=new URL(model.baseUrl);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash)return null;
  if(url.hostname!=='dashscope.aliyuncs.com'&&!/^[a-z0-9-]+\.(cn-beijing|ap-southeast-1|us-east-1|eu-central-1|cn-hongkong)\.maas\.aliyuncs\.com$/.test(url.hostname))return null;
  return {source:'documented_text_model',sourceUrl:GLM52_SOURCE,reason:'服务商文档将该精确模型列为纯文本输入；接受请求不证明能够理解图片。'};
 }catch{return null;}
}
// This is a static declaration, not a semantic image test. HTTP status, image
// block counts or successful decoding must never promote its understanding level.
function observationCapabilities(model={}, {images,browser}={}){
 const imageInput=model.imageInput||'auto';
 const base={browser:!!browser,imageInput};
 if(model.id==='auto'&&model.autoRouting){
  const available=model.autoRouting.visionAvailable===true;
  return {...base,imageTransport:true,images:available&&!!images,visualReview:available&&!!images,imageUnderstanding:available?'delegated_user_confirmed':'unavailable',source:'auto_routing',reason:available?'由用户指定的视觉模型分析图片，主模型接收带来源的观察；观察不代表验收通过。':'Auto 未配置视觉模型；请在模型设置中选择已确认支持图像的模型。'};
 }
 if(imageInput==='disabled')return {...base,imageTransport:false,images:false,visualReview:false,imageUnderstanding:'disabled',source:'user_configuration',reason:'用户已关闭图像输入。'};
 const known=documentedTextModel(model);
 if(known)return {...base,imageTransport:false,images:false,visualReview:false,imageUnderstanding:'unsupported',...known};
 const confirmed=imageInput==='enabled';
 return {...base,imageTransport:true,images:!!images,visualReview:!!images,imageUnderstanding:confirmed?'user_confirmed':'unconfirmed',source:confirmed?'user_configuration':'unconfirmed_endpoint',reason:confirmed?'用户声明该端点支持图像输入；此设置不能证明实际理解或判断准确。':'该精确模型与端点的图像理解能力尚未确认；请求成功仅证明接受输入。'};
}
function projectVisualConstraint(snapshot){
 if(snapshot.observationCapabilities?.images!==false)return snapshot;
 const instruction='当前模型不能观察图片。不要重复 view_image、截图或视觉 verify 来解决能力缺口。继续依据原始设计的字体、颜色、资源与坐标，以及 verificationEvidence.androidStructure 的真实控件位置，定点修改实现、构建并执行功能检查。旧截图送达不证明模型看懂；结构或色块相似也不能标为视觉通过。已知差异必须修复，尚未核验要求保留。';
 const visualFocus=focus=>{
  if(!focus)return false;
  if(['VISUAL_REVIEW_READY','VISUAL_REVIEW_REFRESH_REQUIRED'].includes(focus.code))return true;
  const navigation=focus.navigation||focus.evidenceNavigation;
  return focus.code==='VISUAL_REVIEW_PENDING'&&(navigation?.issue==='paired_image_required'||focus.message==='自动截图预览不能替代原稿成对核验；请先 view_image(path=当前截图,reference=正确原稿)，再按实际图像检查。');
 };
 const replacement=focus=>({...focus,code:'VISUAL_CAPABILITY_UNAVAILABLE',navigation:{issue:'image_understanding_unavailable'},message:instruction,priorCode:focus.priorCode||focus.code});
 const state=snapshot.executionState;
 return {...snapshot,visualReviewConstraint:{automatic:false,reason:snapshot.observationCapabilities.reason,unverifiedCriterionIds:(snapshot.acceptanceCriteria||[]).filter(c=>c.type==='visual').map(c=>c.id),instruction},
  ...(state&&visualFocus(state.blocker)?{executionState:{...state,blocker:replacement(state.blocker),nextAction:state.nextAction==='view_image'?'read_file':state.nextAction}}:{}),
  ...(snapshot.decisionRecovery&&visualFocus(snapshot.decisionRecovery.focus)?{decisionRecovery:{...snapshot.decisionRecovery,focus:replacement(snapshot.decisionRecovery.focus)}}:{}),
  pendingVisualReview:{status:'unavailable',instruction}};
}
module.exports={observationCapabilities,documentedTextModel,projectVisualConstraint};
