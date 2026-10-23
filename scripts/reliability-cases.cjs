// Fixed incident coverage. Adding a repair means extending this matrix rather
// than replacing an old case with the newest symptom.
const cases=[
 {id:'no-action-recovery',incident:'无动作、输出截断和公司网关恢复',files:['adaptive-recovery','portable-recovery','recovery-continuation','agent-protocol','output-budget']},
 {id:'source-and-event-recall',incident:'事件ID误报丢失、重复读取及源码分页循环',files:['source-memory','evidence-archive','working-context']},
 {id:'continuation',incident:'续跑丢失计划、检查点和实际进度',files:['execution-rounds','agent-efficiency']},
 {id:'delivery-evidence',incident:'大文件误判、过期证据和未验收却显示完成',files:['binary-presence','acceptance-recovery','reliability','completion-policy','validation-recovery']},
 {id:'design-fidelity',incident:'屏幕规格错误、遗漏原稿组件和带限制交付掩盖缺陷',files:['android-display','android-design','sketch-fidelity','html-delivery','visual-limitation','visual-observation']},
 {id:'visual-correction-loop',incident:'原稿与截图未成对发送、同背景掩盖组件缺失、色差被误当还原度、区域差异未触发返工及Android运行证据不兼容',files:['visual-correction','design-regions','completion-policy','image-attachments']},
 {id:'execution-efficiency',incident:'恢复截断完整短日志、同图重复解除失败预算、构建缺证据及设备组合操作重放风险',files:['efficiency-lifecycle','reasoning']},
 {id:'quality-measurement',incident:'把状态完成或带限制交付计为正确完成',files:['agent-eval-report','release-quality']},
 {id:'host-isolation',incident:'命令、构建与宿主沙箱隔离',host:true,files:['agent','android-runtime','agent-iteration']}
].map(c=>({...c,files:c.files.map(f=>'scripts/'+f+'.test.cjs')}));
module.exports={cases};
