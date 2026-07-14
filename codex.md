# 《生灵》项目交接总览（CODEX）

本文件用于让新的开发者或新对话直接接手当前主线。修改已有文件前重新获取最新 SHA；每次有效开发后更新本文件；影响 GitHub Pages 发布时同步更新根目录 `version.json`。

---

## 当前版本：v0.31.0

- `v0.29.0`：粟种成为真实物资，完成播种消耗、返种、迁移、流水和日报闭环；建立无界面高速回放基础。
- `v0.30.0`：新增世界压力、机会、共同承诺、动力观察页、存档集成和隐藏 100× 浏览器测试。
- `v0.30.1`：统一 README、交接文档、构建清单和世界存档应用版本。
- `v0.31` 第一步：建立全部候选行动的统一效果描述层。
- `v0.31` 第二步：建立组合级共同承诺劳动力规划器。
- `v0.31` 第三步：将候选效果与劳动力缺口接入共同承诺评分；目标人数满足后停止继续加分。
- `v0.31` 第四步：补齐农业、种子、储存建设、土壤休耕与劳动积压的正式响应闭环。
- `v0.31` 第五步：统一当前行动原因链与观察器解释，显示促成因素、共同承诺、硬规则、政策约束和替代候选。
- `v0.31.0`：完成版本清单、README、存档应用版本、构建编号与 sourceCommit 发布收口。

项目是部署在 GitHub Pages 的纯前端 ES Module 动态世界模拟游戏。规则系统决定世界事实，未来 AI 只负责解释已经发生的事实。

## 不可破坏规则

1. **世界事实优先。** 人物记忆、关系、传记、史书和未来 AI 只能解释事实，不能决定行动或修改状态。
2. **人物不知道玩家存在。** UI 观察者不属于世界内实体。
3. **固定 tick 结算。** UI 帧、动画、面板刷新和真实浏览器速度不能改变世界结果。
4. **确定性。** 相同种子、输入、模块顺序和 tick 数必须得到相同结果。
5. **预留、生命周期、流水分离。**
   - 预留：未来承诺和占用；
   - 生命周期：任务当前状态与阶段；
   - 流水：已经发生的资源或耐久变化。
6. **内部转移必须配对。** 同一批物资不能在地图、人物、营地、工地或农田间重复计入生产和消费。
7. **失败原子性。** 任务失败、取消、路线失败、人物死亡和读档回滚不能吞材料、部分推进代际或留下幽灵预留。
8. **长期事实与运行时分离。** 工具代际、人物记忆、日报和世界动力可持久化；路径游标、动画和预留属于瞬时运行时。
9. **高频热路径禁止完整深拷贝。** 无界面模式不得反复复制全部人物记忆、地图或增长型历史。
10. **版本必须真实。** `version.json.sourceCommit` 指向实际功能提交；后续仅文档或构建清单提交可以跟随其后。

## 固定模拟内核

```text
1 tick = 1 世界分钟 = 1 / 6 模拟秒
```

固定结算顺序：

```text
时间推进
→ simulation:pre-tick
→ 季节 / 昼夜 / 天气 / 篝火
→ simulation:tick
→ 生态 / 农田 / 食物损耗 / 道路
→ 人物移动与工作
→ 行动规划
→ 人物需求
```

- `requestAnimationFrame` 只提供现实时间增量。
- 公开倍率为 `0.5× / 1× / 2× / 5× / 10×`。
- `simulation:time` 只用于 UI，主要读数最高约 10 FPS 合并刷新。
- `actionSystem.advanceTicks(count)` 是无画面确定性推进入口。
- 隐藏测试倍率通过 `worldSpeedRuntime.advanceTestSeconds()` 驱动，使用前必须暂停正常循环。

```js
window.shengling.worldSpeedRuntime.advanceTestSeconds(0.1, { multiplier: 100 })
```

0.1 测试秒在 100× 下必须精确推进 60 ticks；单次上限 36,000 ticks。100× 不得出现在玩家速度按钮中。

## 启动链

```text
index.html
  └─ src/app.js
       ├─ app-v4.js
       ├─ attachEcologyRuntime
       ├─ attachRoadRuntime
       ├─ attachSeasonRuntime
       ├─ attachFarmRuntime
       ├─ attachFarmExpansionRuntime
       ├─ attachFoodStorageRuntime
       ├─ attachStockTargetRuntime
       ├─ attachToolRuntime
       ├─ attachToolMaintenanceRuntime
       ├─ attachLaborCostRuntime
       ├─ attachResourceFlowRuntime
       ├─ attachTaskLifecycleRuntime
       ├─ attachDailyEconomyRuntime
       ├─ attachWorldDynamicsRuntime
       ├─ attachWorldSpeedRuntime
       ├─ attachWorldSaveRuntime
       ├─ attachMapHudRuntime
       ├─ attachObserverUiRuntime
       └─ attachBuildInfoRuntime
```

挂接顺序不可随意调整：世界动力依赖日报；存档必须在所有可持久化系统挂接后建立；后挂接模块必须展开当前 `globalThis.shengling`，不能覆盖已有运行时。

## 人物系统与社会事件性能

人物系统在安全模式下返回深拷贝；无界面模式提供按 `revision` 缓存的轻量运行时视图，不携带增长型记忆历史。

```js
peopleSystem.get(id)           // 完整安全副本
peopleSystem.getRuntime(id)    // 轻量运行时视图
peopleSystem.getAlive()        // 完整副本，按中文姓名排序
peopleSystem.getAliveRuntime() // 轻量视图，Map 插入顺序
```

社会事件系统使用 `getAliveRuntime()` 后仍显式按中文姓名排序，以保持旧 `getAlive()` 的遍历顺序。删除该排序会改变见证者、传闻、关系更新和确定性指纹。

社会事件热路径：

- 单个事件只读取一次人物移动位置快照；
- 见证者和传闻传播复用位置快照；
- 关系视图按传播者逐轮刷新；
- 每个人物已知的社会事件 ID 使用缓存查重；
- 人物或社会事件存档载入后清空缓存并按真实记忆重建；
- 实际记忆写入仍进入人物系统。

旧 PR #27 已关闭：其内容已经随 v0.29 进入主线，且旧 Day 60 回放失败，不能重复合并。

## 统一预留账本

`src/modules/actions/reservationLedger.js` 记录：

```text
task-slot
feature
camp-storage
building-material
camp-item
tool
```

- 任务完成、失败、取消、人物死亡、路线失败和读档重规划必须释放对应预留。
- 维修与替换同时预留目标工具和营地材料。
- 目标工具维护期间不能参与生产。
- 成功读档采用 `cancel-and-replan`。
- 失败读档通过检查点恢复原预留、活动和长期事实。

## 动态目标库存

```text
水目标 = 人口 × 每日饮水 × 3 × 温度倍率
食物目标 = 人口 × 每日食物 × 3 × 季节倍率 × 腐败缓冲
木材目标 = 三日燃料 + 建造 + 维护 + 人口缓冲
种子目标 = 农田规模与待播种需求

有效库存 = 营地现货 + 人物背包 + 在途资源 - 已承诺物资
```

未启动的维护、建造或播种材料属于未来需求；已经预留的材料属于承诺，不再重复形成缺口。粟种在营地、人物背包、运输中和农田投入中均为真实物资。

## 劳动成本

`src/modules/actions/laborCostModel.js` 覆盖取水、采集、伐木、搬运、建材运输、施工、维修、替换、开垦、播种、收获和添柴。

实际路线、负重、地形、道路、天气、精力、技能、行动强度和工具决定预计耗时与额外能耗。候选阶段可使用较便宜的估算，任务执行必须使用真实 A* 路线与实际状态。

## 工具、维修和替换

工具状态：

```text
healthy → worn → critical → broken
```

长期字段：

```text
generation
repairedCount
repairsSinceReplacement
replacedCount
totalWear
wearSinceReplacement
```

维护需求区分 `repair / replace`。同一代完成两次维修后再次磨损，或 `wearSinceReplacement >= maxDurability × 2.5` 时进入替换。替换成功必须在全部材料扣除后一次性恢复耐久、推进代际并清零本代计数。

石斧、搬运篮和简易农具最低保障为 1；维修与替换合计最多并发一个。失败不能改变工具、代际、需求或既有库存。

## v0.29 粟种事实链

```text
营地种子
→ 村民领取并形成 transfer 流水
→ 运输到农田
→ 成功播种才形成真实投入
→ 作物成熟并收获
→ 粟米与返种进入人物或营地
→ 流水、日报和种子校验对账
```

- 第一块农田出现时，初始两份种子进入营地库存。
- 旧农田存档的隐藏 `seedStock` 迁移到营地库存。
- 播种失败、取消或路径失败不能静默消耗种子。
- `farmSystem.verifySeeds()` 保证种子非负、在途不超过人物携带量，并防止农业彻底失去种源。
- 无界面回放使用农田成长调度器，避免每 tick 扫描全部无变化农田。

## 统一资源流水与日报

核心模块：

- `src/modules/economy/resourceFlowSystem.js`
- `src/modules/economy/resourceFlowTaskContextGuard.js`
- 工具维护与粟种专用流水视图

流水类别：

```text
production / transfer / consumption / fuel
construction / spoilage / wear / repair / replacement
```

任务化流水必须携带足够上下文，如 `taskId / personId / toolId / maintenanceMode`。查询同时考虑年份和日号，避免跨年同日混合。

日报保存期初与期末库存、生产、消费、燃料、施工、腐败、维修、替换、种子、任务生命周期、生存拒绝、目标库存、压力、模拟错误和账实差异。

任务状态：

```text
active / completed / cancelled / failed
```

跨午夜任务使用 `carryIn / carryOut`。实际耗时超过 `max(30 秒, 预计耗时 × 2)` 才属于 overdue。

## v0.30 世界动力事实层

核心模块：

- `src/modules/dynamics/worldDynamicsSystem.js`
- `src/modules/actions/commitmentUtility.js`
- `src/bootstrap/attachWorldDynamicsRuntime.js`

每日经济报告封存后执行一次 `worldDynamicsSystem.evaluate(report)`。压力来源包括库存缺口、生存供给失败、腐败损失、劳动积压、粟种短缺和土壤退化；机会包括库存富余、雨天播种窗口和成熟收获窗口。

共同承诺：

- 普通压力持续至少两日且达到门槛后形成；
- 紧急食物或饮水拒绝可立即形成；
- 承诺随压力缓解更新，压力解除后完成；
- 只给已有合法候选加权；
- 不能生成候选、绕过路线、库存、预留和并发；
- 不能覆盖紧急生存、睡眠、篝火、建造、农业和工具保障等硬优先级。

## v0.31 第一步：候选行动效果描述层

核心模块：

- `src/modules/actions/candidateEffects.js`
- `test/candidateEffects.test.js`

全部 `ACTION_TYPES` 都有至少一项效果描述：

```text
metric / subjectId / direction / amount / unit / horizon / estimateKey
```

主要接口：

```js
candidateEffectProfile(actionType)
listCandidateEffectProfiles()
describeCandidateEffects({ candidate, estimates, subjects })
verifyCandidateEffectCatalog()
```

约束：

- 效果目录和返回值为冻结对象；
- 数量只能是非负数，增减语义由 `direction` 表达；
- 显式 `estimates` 优先于 `candidate.effectEstimates` 和目录默认估算；
- 未知行动返回空效果；
- 收获同时描述食物、返种和成熟农田变化；
- 播种同时描述种子消耗、已播农田和未来食物能力。

## v0.31 第二步：共同承诺劳动力规划器

核心模块：

- `src/modules/actions/commitmentResponses.js`
- `src/modules/actions/commitmentLaborPlanner.js`
- `test/commitmentLaborPlanner.test.js`

需求强度：

```text
demandStrength = priority / 100 × (1 - progress)
```

期望人数：

```text
desiredWorkers
= ceil(population × 0.30 × demandStrength)
= 活跃且有剩余需求时至少 1 人
= 不超过人口
= 绝对上限 4 人
```

组合规划按 `priority 降序 → createdAt.tick 升序 → commitmentId 字典序` 分配当前响应者。同一个正在执行的行动只能分配给一个承诺。

主要字段：

```text
desiredWorkers      原始需求人数
targetWorkers       当前约束下可达到的人数
currentResponders   已经响应的人数
remainingDemand     尚未由当前响应者覆盖的需求
attractionSlots     仍可继续吸引的名额
unmetWorkers        受容量或可执行性限制后仍无法满足的人数
saturation          currentResponders / desiredWorkers
capacitySaturation  currentResponders / targetWorkers
```

状态：

```text
inactive     承诺无效或目标完成
blocked      无人口、无响应行动或无合法行动
constrained  仍有需求但响应容量已耗尽
saturated    目标人数已经满足
attracting   仍应继续吸引村民
```

主要接口：

```js
estimateCommitmentDemandStrength(commitment)
planCommitmentLabor({ commitment, ...context })
planCommitmentLaborPortfolio({ commitments, population, actionCounts, availableActions, capacityByAction })
verifyCommitmentLaborPortfolio(portfolio)
```

## v0.31 第三步：效果与劳动力承诺评分

核心模块：

- `src/modules/actions/commitmentResponses.js`
- `src/modules/actions/commitmentUtility.js`
- `src/modules/actions/utilityScorer.js`
- `test/commitmentUtility.test.js`

评分公式：

```text
单项承诺加分
= 18 × demandStrength × remainingDemand / desiredWorkers

候选共同承诺总分
= min(18, 所有匹配承诺加分之和)
```

候选获得承诺加分必须同时满足：

1. 候选行动在该承诺的响应目录中；
2. 候选存在与承诺目标匹配的正向效果；
3. 匹配效果的 `amount > 0`；
4. 劳动力计划状态为 `attracting`；
5. 该候选类型仍有 `slotAllocation`。

行为结果：

- 第一个响应者获得最高加分；
- 当前响应人数增加时，加分按未满足劳动力比例衰减；
- 达到 `desiredWorkers` 后，后续候选承诺分归零；
- 完成态、无有效效果、无合法响应或容量耗尽的承诺不加分，并返回阻断原因；
- 单个候选承诺总分仍封顶 18；
- 每轮 `utilityScorer` 只读取一次承诺快照并建立一次组合劳动力计划，所有候选复用；
- 评分只影响已有合法候选，不生成任务，也不改变硬优先级顺序。

第三步专项测试覆盖效果匹配、零产出、分数衰减、满员停止、总分封顶、单次快照读取和阻断诊断。

## v0.31 第四步：农业与生产链响应闭环

核心模块：

- `src/modules/actions/commitmentPolicy.js`
- `src/modules/actions/commitmentTaskResponse.js`
- `src/modules/actions/farmPlanner.js`
- `src/modules/actions/constructionPlanner.js`
- `src/modules/actions/commitmentResponses.js`
- `src/modules/actions/commitmentUtility.js`

正式响应：

- `restore-seed-reserve` 通过成熟粟米收获增加真实种子库存；
- 雨天播种与成熟收获机会转换为运行时临时承诺，不写入存档；
- `improve-storage` 只认可储物棚建材运输和真实施工；
- 肥力低于 55 的农田在土壤恢复承诺下进入休耕；
- 种子不足以在播种后保留目标缓冲时暂缓播种；
- 劳动积压暂停新开垦，并对长耗时非紧急采集施加最高 12 分的有限负分。

农业与施工硬规划任务会先形成合法候选，再附加效果匹配、劳动力缺口和政策阻断诊断。农田规划逐田跳过受限目标，健康田可继续生产。粟米最低返种由 1 调整为 2，保证两田系统能够积累安全种子缓冲。

约束：

- 不新增行动类型，不伪造人工改良土壤效果；
- 不绕过路线、库存、预留、种子与并发上限；
- 成熟收获、已有施工收尾和生存硬优先级不受积压政策阻断；
- 正向共同承诺总分继续封顶 18；
- 存档 schema 不升级。

第四步建立的新确定性基准：

```text
Day 30: 7dbccaf399ddb0de0814f0b5f931e464c80dfc34304c1fe1b1a8d4ddeb11b232
Day 60: f8b659191027a8aa3801329018006f0ec66c7a1add4ae19c1fbf34ec9f7baa49
```

## v0.31 第五步：行动原因链与观察器解释

核心模块：

- `src/modules/actions/actionExplanation.js`
- `src/modules/actions/actionPlanner.js`
- `src/modules/actions/actionSystem.js`
- `src/modules/actions/farmPlanner.js`
- `src/app-v4.js`

`actionSystem.getActionExplanation(personId)` 根据人物当前运行时任务即时生成只读解释，结构版本为 `1`，包含：

```text
planner / plannerLabel
score / summary
factors
commitments / blockedCommitments
policies
hardRules
alternatives
effects
```

解释覆盖综合效用、紧急生存、携带物资、农业、建设、工具维护、篝火、环境恢复和夜间睡眠。综合效用行动保留各项分值、共同承诺劳动力状态、被阻断承诺、政策约束以及替代候选；农业调度会记录被休耕或留种政策跳过的农田，再解释为何改选其他合法农田。

观察器人物详情页显示调度器、总分或规则优先级、行动摘要、硬规则、促成因素、共同承诺、政策约束和候选比较。解释只读取已经形成的任务，不写入人物存档、任务生命周期、资源流水或确定性人物活动视图，因此不改变行为与存档 schema。

第五步验证结果：

- 语法、全部专项与非回放测试、生产构建成功；
- 移动 Chromium 与隐藏 100× 成功；
- Day 30 与 Day 60 原确定性指纹成功，无需更新基准；
- Day 60 batch 1 / 5 / 10 成功，三批最终摘要一致；
- Day 120 batch 10 共 171,600 ticks 成功；
- 任务生命周期、资源流水、世界动力、工具维护、公共工具保障、种子守恒和预留检查全部通过。

## 存档与迁移

- 主世界存档 schema 保持 `1`。
- v0.31.0 的 `WORLD_SAVE_APP_VERSION` 为 `0.31.0`。
- `systems.worldDynamics` 保存压力、机会、承诺和历史。
- 旧存档没有 `worldDynamics` 时初始化为空状态。
- 读档先验证目标，再停止世界循环并导入。
- 导入失败恢复建筑、工具、维护运行时、流水、日报、世界动力和行动运行时检查点。
- 成功读档恢复长期事实和坐标，取消未完成任务后重新规划。
- v0.31.0 没有新增持久化字段，存档 schema 保持 `1`。

## CI 与长期稳定性

普通 CI：

```text
npm run check
非回放 node --test
npm run build
Day 30 deterministic replay
Day 60 deterministic replay
真实移动 Chromium
隐藏 100× Chromium
```

Stability Audit：

- Day 60：batch 1 / 5 / 10，各 85,200 ticks；
- Day 120：batch 10，共 171,600 ticks；
- 每 15 日检查任务、预留、工具、农业、流水、日报、世界动力、内存和吞吐；
- Day 60 各 batch 最终摘要必须一致；
- 最低吞吐门槛 20 ticks/s；
- 堆内存上限约 1.25 GiB；
- 不允许模拟错误、孤儿资源预留或孤儿工具预留。

v0.31.0 封版验证结果：

- 语法、全部专项与非回放测试、生产构建成功；
- 移动 Chromium 与隐藏 100× 成功；
- Day 30 与 Day 60 新确定性指纹成功；
- Day 60 batch 1 / 5 / 10 成功，三批最终摘要一致；
- Day 120 batch 10 共 171,600 ticks 成功；
- Day 120 期末 10 人存活、种子 22、短缺 0、累计收获 40 次；
- 任务生命周期、资源流水、世界动力、工具维护、公共工具保障、种子守恒和预留检查全部通过。

## 已知限制

1. 存档只在浏览器 `localStorage`，没有跨设备云同步。
2. 成功读档不续接路径游标、已投入工时和中途动画。
3. 工具配方仍主要使用木料，石材、纤维和零部件产业未建立。
4. 工具记录被删除后，最低保障尚不能凭空制造新 ID。
5. 石镐没有正式采石行动与石材资源。
6. 休息、睡眠和空闲时间没有完整时间预算。
7. 草棚、储物棚和农田还不是寻路障碍。
8. 当前行动解释只保留正在执行任务的轻量快照，不保存完整候选历史。
9. 自动 Chromium 不能替代真实 iPhone 安全区与浏览器外壳回归。

## v0.32 建议方向

1. 将草棚、储物棚和农田边界纳入空间占用与寻路障碍，建立统一可通行性事实。
2. 在不破坏固定 tick 与确定性的前提下，设计地图空间规划算法，处理道路、建筑、农田和聚落扩张。

## 版本记录

- `v0.1—v0.24`：人物、地图、行动、环境、农业、关系、史书、存档与观察器基础。
- `v0.25`：地图优先观察器、事务化读档、移动抽屉与精确坐标恢复。
- `v0.26`：固定 tick、UI 限频、统一预留、确定性 ID 与 Day 30 回放。
- `v0.27`：动态目标库存、劳动成本、工具耐久、统一流水、日报、任务生命周期与长期审计。
- `v0.28`：维修需求、真实维修任务、工具代际替换与最低公共保障。
- `v0.29`：真实粟种事实链、无界面高速回放与长期热路径优化。
- `v0.30`：世界动力、压力、机会、共同承诺、隐藏 100× 与存档/观察页集成。
- `v0.30.1`：发布版本、文档、构建清单与存档应用版本统一。
- `v0.31.0`：完成候选效果目录、组合级劳动力规划、承诺评分、农业与生产链响应闭环、当前行动解释和正式发布收口。
