# Ailo 的配对评测与视觉校准

这些入口把评测变成可重复执行的流程。离线测试、预检、模板和未审核样本均不证明实际任务效果提高。当前模型和 Auto 路由不作替换；不使用真实任务、外部写入或模拟器。

## 冻结公开配置与试验计划

`agent-eval-reference` 只读取公开模型元数据，不解密凭据。Auto 引用冻结主模型、视觉模型、所有已配置备用模型、切换参数以及各模型端点哈希、容量和图像设置。引用或源码变化后必须生成新计划。

```sh
node scripts/agent-eval-reference.cjs --model-id auto --output .local/eval-reference.json
node scripts/agent-eval-net-gain.cjs --reference-config .local/eval-reference.json --baseline-source .local/eval-baselines/0.1.89 --candidate-source . --repeats 1 --output .local/eval-plan
node scripts/agent-eval-run-plan.cjs --plan .local/eval-plan/plan.json --reference-config .local/eval-reference.json --output .local/eval-trials --manifest .local/eval-command-review.json
```

最后一条默认只生成可审查命令和硬上限，不调用模型。完成具体授权后，加 `--execute` 才执行。`--include-ablation` 额外评测关闭可选候选快照机制的版本；必要视觉、原要求、安全和证据核验全部保留。控制与消融按 AB/BA 交错。

上述一轮计划包含八类任务各一轮、基线和候选配对，共 16 次试验、最坏 640 次模型请求；它只能发现问题和检查机制，收益结论保持 `unproven`。完整收益计划使用新目录及 `--repeats 3`，共 48 次试验。默认每次最多 40 次真实模型请求，执行阶段最多 180 秒，续跑共享同一预算。包含视觉通道、重试和备用请求。独立交互核验另有 60 秒上限，执行器对每批进程设置总时限，并在每批启动前重新核对运行时和判分器指纹。完整三轮最坏 1920 次模型请求；消融另 24 次试验、最多 960 次请求。它们是上限，不是预计用量。进程超时保留原始记录与 `.started`，不会自动重放未知操作。

八类场景为内容 HTML/MD、消息快照、界面修复、不同表述代码任务、安全点补充附件、独立新目标、明确未发出故障后纯继续，以及真实写入成功但回执丢失。动态控制使用正常 `chat.steer` / `chat.complete` 路径；副作用核对由原运行时根据实际文件哈希完成，驱动器不会清理未知操作账目。

## 实际结果的独立审核

```sh
node scripts/agent-eval-review.cjs prepare --trial .local/eval-trials/candidate/content-html-md-1 --output .local/review.json
# 实际审阅成果，逐项填写 reviewer、at、outcome、criteria 与 reason。
node scripts/agent-eval-review.cjs record --trial .local/eval-trials/candidate/content-html-md-1 --decision .local/review.json
node scripts/agent-eval-report.cjs .local/eval-trials
```

审核记录绑定原始结果、固定验收口径以及成果和观察图片字节。事后更改文件会使审核失效。人工待验、部分成果、带限制交付、未完成和完整正确交付分别统计。没有完整动态触发与核对证据的试验不能支持收益结论。

## 视觉校准

需要八种真实图像场景。不能用模板中的预期类别充当标注。输入清单每条包含固定场景 `id`、一至四条原始 `requirements`、可选 `context` 及 `images: [{path,role:"actual"},{path,role:"reference"}]`。图像首先来自当前实际产物，参考图按需提供。

```sh
node scripts/agent-eval-visual-calibration.cjs prepare --input .local/real-images.json --root /absolute/image-source --reference-config .local/eval-reference.json --output .local/calibration-frozen
# 打开 calibration-frozen/review.html，先按原要求盲审图像并填写 review-template.json。
node scripts/agent-eval-visual-calibration.cjs review --input .local/calibration-frozen/dataset.json --root /absolute/calibration-frozen --labels .local/human-labels.json --output .local/calibration-reviewed.json
apps/desktop/node_modules/.bin/electron scripts/agent-visual-live-eval.cjs --dataset .local/calibration-frozen/dataset.json --root /absolute/calibration-frozen --output .local/calibration-predictions --preflight
# 独立授权真实观察后，同命令去掉 --preflight。
node scripts/agent-eval-visual-calibration.cjs score --input .local/calibration-reviewed.json --root /absolute/calibration-frozen --predictions .local/calibration-predictions/predictions.json --output .local/calibration-score.json
```

校准调用真实现有 Auto 视觉路由与报告协议，冻结模型、源码版本、原要求、图片、原始报告和预测。评分会重新检查这些字节；没有人工标注或真实预测时不发布准确率。统计精确率、召回率、误阻塞和误关闭，小样本结论不能外推真实任务总体。

## 只从真实文件生成收益结论

```sh
node scripts/agent-eval-evidence.cjs --plan .local/eval-plan/plan.json --directory .local/eval-trials --calibration-review .local/calibration-reviewed.json --calibration-root /absolute/calibration-frozen --predictions-root /absolute/calibration-predictions --output .local/eval-gain.json
```

发布门槛同时要求至少三轮完整配对、人审、动态证据、宿主一致、原验收未放宽、零错误完成、零未知副作用重放、真实视觉校准、每类任务无退步，以及配对收益证据。校准须覆盖至少三个真实缺陷、三个无缺陷和两个不确定样本，并作出正确判断，不能仅靠少数类别获得满分。耗时和请求量默认最多增加 10%。只有满足所有条件才输出 `pilot_gain_verified`；它表示固定试点集收益，不能宣称总体能力已提升。缺失证据保持 `unproven`，安全红线直接拒绝。
