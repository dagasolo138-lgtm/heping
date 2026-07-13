# 《生灵》项目交接总览（CODEX）

本文件用于让新的开发者或新对话直接接手当前主线。修改已有文件前重新获取最新 SHA；每次有效开发后更新本文件；影响 GitHub Pages 的发布必须同步更新根目录 `version.json`。

---

## 当前版本：v0.30.1

- `v0.29.0`：粟种成为真实物资，完成播种消耗、返种、迁移、流水和日报闭环；建立无界面高速回放基础。
- `v0.30.0`：新增世界压力、机会、共同承诺、承诺评分权重、动力观察页、存档集成和隐藏 100× 浏览器测试。
- `v0.30.1`：发布收口，统一 README、交接文档、构建清单和世界存档应用版本；不改变固定 tick 与世界结算。

项目是部署在 GitHub Pages 的纯前端 ES Module 动态世界模拟游戏。当前主线不是聊天应用或 AI 代理项目；规则系统负责决定世界，未来 AI 只负责把已经存在的事实表达得更自然。

## 不可破坏规则

1. **世界事实优先。** 人物记忆、关系、传记、史书和未来 AI 只能解释事实，不能决定行动或修改状态。
2. **人物不知道玩家存在。** UI 观察者不属于世界内实体。
3. **固定 tick 结算。** UI 帧、动画、面板刷新和真实浏览器速度不能改变世界结果。
4. **确定性。** 相同种子、输入、模块顺序和 tick 数必须得到相同结果。
5. **预留、生命周期、流水分离。**
   - 预留：未来承诺和占用；
   - 生命周期：任务当前状态与阶段；
   - 流水：已经发生的资源或耐久变化。
6. **内部转移必须配对。** 同一批物资从地图到人物、人物到营地、营地到工地或农田不能重复计入生产和消费。
7. **失败原子性。** 任务失败、取消、路线失败、人物死亡和读档回滚不能吞材料、部分推进代际或留下幽灵预留。
8. **长期事实与运行时分离。** 工具代际、人物记忆、日报和世界动力可持久化；路径游标、正在进行的动画和预留属于瞬时运行时。
9. **高频热路径禁止完整深拷贝。** 无界面模式不得反复复制全部人物记忆、地图或增长型历史。
10. **版本必须真实。** `version.json.sourceCommit` 指向实际功能提交；后续仅文档或构建清单提交可以跟随其后。

## 固定模拟内核

```text
1 tick = 1 世界分钟 = 1 / 6 模拟秒
```

固定结算顺序的核心要求：

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
peopleSystem.get(id)          // 完整安全副本
peopleSystem.getRuntime(id)   // 轻量运行时视图
peopleSystem.getAlive()       // 完整副本，按中文姓名排序
peopleSystem.getAliveRuntime()// 轻量视图，Map 插入顺序
```

**重要顺序约束：** 社会事件系统使用 `getAliveRuntime()` 后仍显式按中文姓名排序，这是为了保持旧 `getAlive()` 的遍历顺序。不要为了“减少排序”直接删除该排序，否则见证者、传闻传播、关系更新和确定性指纹可能改变。

社会事件热路径当前策略：

- 单个事件只读取一次人物移动位置快照；
- 见证者和传闻传播复用位置快照；
- 关系视图按传播者逐轮刷新，保留原更新顺序；
- 每个人物已知的社会事件 ID 使用缓存查重；
- 人物或社会事件存档载入后清空缓存并按真实记忆重建；
- 实际记忆写入仍进入人物系统，不得只写缓存。

旧 PR #27 已关闭：它基于旧性能分支，内容已经随 v0.29 进入主线，且其旧 Day 60 回放失败，不能重复合并。

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
- 成功读档采用 `cancel-and-replan`，清理瞬时预留后重新规划。
- 失败读档通过检查点恢复原预留、活动和长期事实。

## 动态目标库存

营地计算未来三日需求：

```text
水目标 = 人口 × 每日饮水 × 3 × 温度倍率
食物目标 = 人口 × 每日食物 × 3 × 季节倍率 × 腐败缓冲
木材目标 = 三日燃料 + 建造 + 维护 + 人口缓冲
种子目标 = 农田规模与待播种需求

有效库存 = 营地现货 + 人物背包 + 在途资源 - 已承诺物资
```

- 未启动的维护、建造或播种材料属于未来需求。
- 已经预留的材料属于承诺，不再重复形成缺口。
- 粟种在营地、人物背包、运输中和农田投入中均为真实物资。

## 劳动成本

`src/modules/actions/laborCostModel.js` 覆盖取水、采集、伐木、搬运、建材运输、施工、维修、替换、开垦、播种、收获和添柴。

实际路线、负重、地形、道路、天气、精力、技能、行动强度和工具决定预计耗时与额外能耗。候选阶段可使用较便宜的估算，任务执行必须使用真实 A* 路线与实际状态。

## 工具、维修和替换

工具长期字段：

```text
generation
repairedCount
repairsSinceReplacement
replacedCount
totalWear
wearSinceReplacement
```

工具状态：

```text
healthy → worn → critical → broken
```

维护需求：

```text
state: none / requested / urgent
mode: repair / replace
```

替换触发：

- 同一代完成两次维修后再次进入磨损区间；或
- `wearSinceReplacement >= maxDurability × 2.5`。

成功替换必须在全部材料扣除后一次性执行：

```text
durability = maxDurability
generation += 1
replacedCount += 1
repairsSinceReplacement = 0
wearSinceReplacement = 0
```

石斧、搬运篮和简易农具最低保障为 1；石镐暂不强制。维修与替换合计最多并发一个。失败不能改变工具、代际、需求或既有库存。

## v0.29 粟种事实链

核心要求：

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
- `farmSystem.verifySeeds()` 必须保证种子非负、在途不超过人物携带量，并防止已有农业彻底失去种源。
- 无界面回放使用农田成长调度器，避免每 tick 扫描全部无变化农田。

## 统一资源流水

核心模块：

- `src/modules/economy/resourceFlowSystem.js`
- `src/modules/economy/resourceFlowTaskContextGuard.js`
- 工具维护与粟种的专用流水视图

类别：

```text
production / transfer / consumption / fuel
construction / spoilage / wear / repair / replacement
```

任务化流水必须携带足够上下文，如 `taskId / personId / toolId / maintenanceMode`。管理用途的直接修理 API 可没有任务上下文，但不能伪装成任务化流水。

资源流水查询必须同时考虑年份和日号，避免跨年同日混合。历史记录存在上限，长期审计要求不超过配置的保留量。

## 每日经济与任务生命周期

日报保存：

- 期初和期末人物/营地库存；
- 生产、消费、燃料、施工、腐败、维修、替换；
- 农业种子转移、投入和返种；
- 任务分配、完成、取消、失败、跨日结转和阶段成本；
- 生存请求拒绝；
- 目标库存、瓶颈、压力和模拟错误；
- 预期净变化、实际净变化和账实差异。

任务状态：

```text
active / completed / cancelled / failed
```

跨午夜任务使用 `carryIn / carryOut`。任务只有在实际耗时超过 `max(30 秒, 预计耗时 × 2)` 时才属于 overdue。

## v0.30 世界动力事实层

核心模块：

- `src/modules/dynamics/worldDynamicsSystem.js`
- `src/modules/actions/commitmentUtility.js`
- `src/bootstrap/attachWorldDynamicsRuntime.js`

每日经济报告封存后执行一次 `worldDynamicsSystem.evaluate(report)`。

### 压力来源

- 库存目标缺口；
- 食物和饮水请求被拒绝；
- 腐败损失占生产比例过高；
- 劳动积压；
- 粟种短缺；
- 土壤肥力退化。

压力保存 `severity / baseSeverity / persistenceDays / causes / evidence / suggestedResponses / openedAt / updatedAt / resolvedAt`。

### 机会来源

- 食物或其他目标库存达到明显富余；
- 雨天且存在可播农田与种子；
- 存在成熟待收获农田。

机会只提供可解释事实，不直接创建任务；消失后进入过期历史。

### 共同承诺

- 普通压力需持续至少两日且严重度达到门槛；
- 紧急食物或饮水拒绝可立即创建承诺；
- 承诺随压力缓解更新进度，压力解除后完成；
- `communityCommitment` 只给已有合法候选加权；
- 单个候选最高加 18 分；
- 每轮候选评分只读取一次承诺快照；
- 完成态承诺不得继续加分。

承诺不能生成候选、绕过路线、库存、预留和并发，也不能覆盖紧急生存、睡眠、篝火、建造、农业和工具保障的硬优先级。

## 存档与迁移

- 主世界存档 schema 保持 `1`。
- v0.30.1 的 `WORLD_SAVE_APP_VERSION` 为 `0.30.1`。
- 子系统可独立升级 schema，但必须提供旧状态迁移或明确拒绝不兼容状态。
- `systems.worldDynamics` 保存压力、机会、承诺和历史。
- 旧存档没有 `worldDynamics` 时初始化为空状态。
- 读档先验证目标，再停止世界循环并导入。
- 导入失败必须恢复建筑、工具、维护运行时、流水、日报、世界动力和行动运行时检查点。
- 成功读档恢复长期事实和坐标，取消未完成任务后重新规划。

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

v0.30.0 封版结果：

- 普通 CI 与 Stability Audit 全部成功；
- Day 60 batch 10 平均约 217 ticks/s；
- Day 120 batch 10 平均约 161 ticks/s；
- 10 人存活，世界动力、任务生命周期、流水、日报、工具、种子与公共保障全部校验通过；
- Day 120 最终摘要：`e94ed1acb02050e4fa305881ee485c3d0e823c45a380fcb0b097853fabc29f9c`。

## 已知限制

1. 存档只在浏览器 `localStorage`，没有跨设备云同步。
2. 成功读档不续接路径游标、已投入工时和中途动画。
3. 工具配方仍主要使用木料，石材、纤维和零部件产业未建立。
4. 工具记录被删除后，最低保障尚不能凭空制造新 ID。
5. 石镐没有正式采石行动与石材资源。
6. 休息、睡眠和空闲时间没有完整时间预算。
7. 草棚、储物棚和农田还不是寻路障碍。
8. 共同承诺的任务响应映射目前集中在食物、饮水、木材和储存。
9. 自动 Chromium 不能替代真实 iPhone 安全区与浏览器外壳回归。

## 推荐下一阶段

v0.30.1 合并并确认 Pages 构建后，再进入 v0.31。优先顺序：

1. 扩展共同承诺对农业、种子和储存改善的合法候选映射；
2. 增加“承诺为何影响此次选择”的可追溯解释；
3. 保持承诺只加权、不生成任务的边界；
4. 完成后再评估家庭账户与公共库存分化。

不要在发布资料仍漂移时继续叠加大型机制。

## 版本记录

- `v0.1—v0.24`：人物、地图、行动、环境、农业、关系、史书、存档与观察器基础。
- `v0.25`：地图优先观察器、事务化读档、移动抽屉与精确坐标恢复。
- `v0.26`：固定 tick、UI 限频、统一预留、确定性 ID 与 Day 30 回放。
- `v0.27`：动态目标库存、劳动成本、工具耐久、统一流水、日报、任务生命周期与长期审计。
- `v0.28`：维修需求、真实维修任务、工具代际替换与最低公共保障。
- `v0.29`：真实粟种事实链、无界面高速回放与长期热路径优化。
- `v0.30`：世界动力、压力、机会、共同承诺、隐藏 100× 与存档/观察页集成。
- `v0.30.1`：发布版本、文档、构建清单与存档应用版本统一。