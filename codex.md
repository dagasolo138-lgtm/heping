# 《生灵》项目交接总览（CODEX）

本文件用于防止项目记忆丢失，并帮助新的对话或开发者快速接手。

**维护规则：** 开发前按需查阅；每次有效开发后在末尾追加版本概述；每次影响 Pages 的发布同步更新根目录 `version.json`；修改已有文件前重新获取最新 SHA。

---

## 当前版本：v0.28.1

《生灵》是部署在 GitHub Pages 的纯前端 ES Module 动态世界模拟游戏。v0.27 已完成确定性模拟、生存经济、世界状态守恒、存档连续性与移动浏览器审计。v0.28.0 建立工具维修需求事实层，v0.28.1 将维修接入真实任务、材料预留、劳动、失败原因、资源流水、日报和失败读档回滚。

## 不可破坏规则

- 世界事实优先；人物、传记、史书、关系与未来 AI 只读或解释事实。
- 人物不知玩家或游戏存在。
- 主观印象写入 `personal`；行动、建造、维修、睡眠、播种和收获写入 `lifeEvents`。
- AI 只负责表达，不得决定行动或修改世界状态。
- `globalThis.shengling` 是运行时模块挂接点；后挂接模块必须展开当前对象，避免覆盖已有系统。
- 世界结算必须经过固定 tick；UI 事件不得承担世界事实结算。
- 运行时占用进入统一预留账本，并在完成、失败、取消、死亡、路线失败和读档重建时释放。
- **预留账本、任务生命周期和资源流水是三套不同事实：** 预留记录未来承诺；生命周期记录任务状态；流水只记录已经发生的账户增减。
- 同一批物资的来源和去向必须配对成一笔内部转移，不得把搬运重复记成生产与消费。
- 不同人物在同一 tick 独立发生的生产和消费不得因数量相等而互相抵消。
- 工具耐久和维修需求属于长期世界事实；工具使用、维修任务和材料占用属于瞬时运行时状态。
- 维修任务必须同时预留目标工具和材料；目标工具不能在维修期间参与生产。
- 维修失败不能吞材料、恢复耐久或清除维修需求。
- 维修材料和耐久恢复必须从真实系统变更事件进入流水，禁止手写第二套重复流水。
- 日报必须以资源流水、生命周期和库存快照为事实源，不能自行创造资源或劳动数字。
- 日报账实差异不能静默忽略；`dailyEconomySystem.verify()` 必须报告。
- 跨午夜任务只记录 `carryIn / carryOut`；只有实际耗时超过预计值两倍才属于 `overdue`。
- 两阶段运输必须保持同一任务 ID，并累计每个阶段自己的成本。
- 建材交接失败不能扣除人物尚未交付的背包材料；部分交接只扣实际送达数量。
- 腐败率只能在同一物品和同一单位内计算。
- 库存缺口严重度必须按缺口占目标比例计算，不能使用固定绝对数量阈值。
- 资源流水的日查询必须同时考虑年份，避免不同年份的同一日号混合。
- 资源流水任务上下文必须在完成、失败、取消、生命周期关闭和读档重规划时清理。
- 读档保持事务性：目标快照先验证；失败时恢复长期状态、建筑瞬时预留、工具、维修运行时、流水、生命周期、日报和原行动运行时。
- 失败读档回滚必须覆盖代理任务、路径游标、工作进度、统一预留、工具分配、维修预留、规划计时器、需求计时器、日志和诊断状态。
- 成功读档采用 `cancel-and-replan`：恢复实时坐标和长期事实，取消未完成任务后重新规划。
- 动态库存必须区分现货、人物背包、在途资源和已经承诺的资源；未启动维修材料属于需求，已预留维修材料属于承诺。
- 劳动成本只影响规则驱动的选择、移动、耗时与精力，不得依赖 UI 帧率或 AI 输出。
- 高频固定 tick 热路径不得反复深拷贝完整人物、记忆或地图对象。
- `version.json.sourceCommit` 必须指向本次发布的实际功能提交。

## 固定模拟内核

```text
1 tick = 1 世界分钟 = 1 / 6 模拟秒
```

固定结算顺序：

```text
时间推进
→ simulation:pre-tick
→ 季节同步
→ 昼夜 / 天气 / 篝火
→ simulation:tick
→ 生态 / 农田 / 食物损耗 / 道路采样
→ 人物移动与工作
→ 行动规划
→ 人物需求
```

- `requestAnimationFrame` 只提供现实时间增量。
- `0.5× / 1× / 2× / 5× / 10×` 决定每帧消费的固定 tick 数量。
- `simulation:time` 只用于 UI 时间发布，最高每 100ms 一次。
- `actionSystem.advanceTicks(count)` 是无画面确定性回放入口。
- 主界面与扩展读数通过 `createUiRenderScheduler()` 合并刷新，最高 10 FPS。

## 统一预留账本

`src/modules/actions/reservationLedger.js` 当前记录：

- `task-slot`：行动并发名额。
- `feature`：树木、浆果等目标物件。
- `camp-storage`：搬运任务占用的营地剩余容量。
- `building-material`：工地材料预留映射。
- `camp-item`：维修等营地物资承诺，维修键为 `${campId}:${itemId}`。
- `tool`：公共工具占用，`key = toolId`，容量固定为 1；生产使用和维修目标共用同一约束。

预留账本是瞬时状态，不写入长期存档。成功读档重建代理时清空；失败读档通过行动系统和维修运行时检查点恢复原任务与原账本。

## v0.27 生存经济模块

### 动态目标库存 · v0.27.1

核心：`src/modules/actions/stockTargetModel.js` 与 `src/modules/actions/actionPlanner.js`。

```text
目标周期 = 未来 3 个世界日
水目标 = 人口 × 每日饮水 × 3 × 气温倍率
食物目标 = 人口 × 每日食物 × 3 × 季节倍率 × 腐败缓冲
木材目标 = 三日燃料 + 建造需求 + 维修需求 + 人口缓冲
有效库存 = 营地现货 + 人物背包 + 在途采集 - 已承诺物资
```

```js
window.shengling.stockTargetSystem.get()
window.shengling.stockTargetSystem.refresh()
```

### 劳动成本 · v0.27.2 / v0.28.1

核心：`src/modules/actions/laborCostModel.js`。

覆盖取水、采集、伐木、搬运、建材运输、施工、维修、开垦、播种、收获和添柴。实际 A* 路线、负重、地形、道路、天气、精力、技能、行动强度和工具共同决定预计耗时与能耗。维修任务使用配方声明的技能，维修目标工具本身不提供劳动加成。

```js
window.shengling.laborCostSystem.estimate(personId, task)
window.shengling.laborCostSystem.getRecent(10)
```

### 工具、耐久与维修需求 · v0.27.3 / v0.28.0

核心：

- `src/modules/tools/toolCatalog.js`
- `src/modules/tools/toolMaintenanceModel.js`
- `src/modules/tools/toolSystem.js`
- `src/bootstrap/attachToolRuntime.js`

| 类型 | ID | 最大耐久 | 当前行动 |
|---|---|---:|---|
| 石斧 | `tool-stone-axe-1` | 72 | `chopTree` |
| 搬运篮 | `tool-carrying-basket-1` | 90 | `haulToCamp`、`deliverMaterials` |
| 简易农具 | `tool-simple-farm-tool-1` | 84 | `clearField`、`sowMillet`、`harvestMillet` |
| 石镐 | `tool-stone-pick-1` | 100 | 暂无；为采石保留 |

工具状态：

```text
healthy → worn → critical → broken
```

维修需求状态：

```text
none → requested → urgent
```

- 工具 schema 为 `2`，v1 工具存档可迁移。
- 低耐久生成稳定 ID：`tool-maintenance:<toolId>`。
- 需求保存 `targetDurability / materials / workMinutes / skill / requestedAt / reason`。
- 部分修理保留原需求；达到安全阈值后才关闭。

```js
window.shengling.toolSystem.list()
window.shengling.toolSystem.getSummary()
window.shengling.toolSystem.listMaintenanceDemands()
window.shengling.toolSystem.getMaintenanceDemand(toolId)
window.shengling.toolSystem.verifyMaintenance()
```

### 真实维修任务 · v0.28.1

核心：

- `src/modules/actions/toolMaintenancePlanner.js`
- `src/modules/actions/toolMaintenanceRuntime.js`
- `src/modules/actions/toolMaintenanceEffects.js`
- `src/bootstrap/attachToolMaintenanceRuntime.js`

事实链：

```text
工具磨损
→ 生成维修需求
→ 检查营地材料和目标工具占用
→ 创建 repairTool 任务
→ 预留目标工具与 camp-item 材料
→ 人物前往营地并投入劳动
→ 完成前重新校验需求、工具、地点、预留和库存
→ 扣除材料、恢复耐久
→ 生命周期、人物事实、资源流水和日报结算
```

规划顺序：

1. 紧急饥渴和极低精力。
2. 紧急维修。
3. 普通维修与普通生产候选。

约束：

- 同时最多一个维修任务。
- 材料不足或目标工具已被占用时不创建任务。
- 维修期间目标工具不能被生产任务使用。
- 执行期间材料被其他机制移走时整单失败，不重复扣料、不改变耐久、保留需求。
- 需求失效、工具缺失、地点缺失和预留失效均使用明确失败原因。

```js
window.shengling.toolMaintenanceRuntime.listReservations()
window.shengling.toolMaintenanceRuntime.listFailures()
window.shengling.toolMaintenanceRuntime.verify()
```

### 统一资源流水 · v0.27.4 / v0.27.6 / v0.27.7 / v0.28.1

核心：

- `src/modules/economy/resourceFlowSystem.js`
- `src/modules/economy/yearAwareResourceFlowView.js`
- `src/modules/economy/resourceFlowTaskContextGuard.js`
- `src/modules/economy/toolMaintenanceResourceFlowView.js`
- `src/bootstrap/attachResourceFlowRuntime.js`

类别：`production / transfer / consumption / fuel / construction / spoilage / wear / repair`。

维修材料和耐久恢复先由营地与工具真实变更事件生成原始记录，再由维修流水视图补齐：

- `taskId`
- `personId`
- `toolId`
- `actionType = repairTool`
- `category = repair`

禁止额外手写第二笔维修流水。

```js
window.shengling.resourceFlowSystem.list({ limit: 20 })
window.shengling.resourceFlowSystem.list({ year: 2, day: 1 })
window.shengling.resourceFlowSystem.list({ category: 'repair' })
window.shengling.resourceFlowSystem.getDailySummary(2, 1)
window.shengling.resourceFlowSystem.verify()
```

### 每日经济摘要 · v0.27.5 / v0.27.6 / v0.28.1

核心：

- `src/modules/economy/dailyEconomySystem.js`
- `src/modules/economy/taskLifecycleEconomyView.js`
- `src/modules/economy/economicMetricsAuditView.js`
- `src/bootstrap/attachDailyEconomyRuntime.js`

对账：

```text
expectedDelta = production - consumption - fuel - construction - repair - spoilage
actualDelta = closingInventory - openingInventory
discrepancy = actualDelta - expectedDelta
```

没有维修支出的旧世界不会额外写入 `balance.repair: 0`，以保持第 30/60 日既有确定性指纹；发生维修时才出现真实 `repair` 数字。

### 任务生命周期 · v0.27.6 / v0.27.7 / v0.28.1

核心：

- `src/modules/economy/taskLifecycleSystem.js`
- `src/modules/economy/taskLifecycleStageCostView.js`
- `src/modules/economy/taskLifecycleEconomyView.js`
- `src/bootstrap/attachTaskLifecycleRuntime.js`

任务状态：`active / completed / cancelled / failed`。维修任务使用 `record.type = 'repairTool'`，不是 `record.actionType`。

```js
window.shengling.taskLifecycleSystem.list({ type: 'repairTool' })
window.shengling.taskLifecycleSystem.get(taskId)
window.shengling.taskLifecycleSystem.getDailySummary(year, day)
window.shengling.taskLifecycleSystem.verify()
```

### 两阶段建材运输 · v0.27.6 / v0.27.7

`deliverMaterials` 的领取与送达阶段保持同一任务 ID：

```text
collect：人物前往营地并领取材料
→ actions:stage-transition
→ deliver：按真实负重前往工地并交付
```

第二阶段重新读取背包重量、路线、地形、道路、天气、精力、技能和搬运篮。工具预留贯穿全任务，成功后只磨损一次。工地预留失效时保留全部背包材料；部分交接只扣实际送达量。

## 长期稳定性审计

核心：

- `.github/workflows/stability-audit.yml`
- `scripts/longRunAuditWorld.js`
- `scripts/runLongRunAudit.js`
- `scripts/compareStabilityReports.js`
- `test/worldStateConservation.test.js`
- `test/worldSaveContinuity.test.js`
- `test/toolMaintenanceWorld.test.js`
- `test/toolMaintenanceSaveRollback.test.js`

固定种子：`replay-seed-v0277-stability`。

检查范围：

- 第 60 日：batch 1、5、10 各推进 85,200 ticks。
- 第 120 日：batch 10 推进 171,600 ticks。
- 每 15 日检查时间、模拟错误、任务、预留、工具、维修需求、维修运行时、流水任务上下文、日报、历史日报冻结、内存与吞吐。
- 活动任务不得超过存活人口；每个活动任务只能对应一个人物和一个 `task-slot`。
- 所有预留、工具占用和维修运行时必须指向真实活动任务。
- 同时最多存在一个维修任务。
- 维修需求数量不得超过工具数量；需求状态、目标耐久、材料与工时必须有效。
- 人物库存、营地库存、食物批次和工具耐久不得越界。
- 最低区间吞吐为 20 ticks/s；最大允许堆内存约 1.25 GiB。

v0.27.7 第 60 日历史基线：

```text
final state digest: 54bb31536114dbf61630e7b88fcc1d93cb1fd2051c7df7a1ccf5e73858b254c7
```

v0.28.1 的维修经济会改变长跑世界事实，因此需要在最终 Stability Audit 完成后记录新的第 60/120 日 digest；batch 1、5、10 仍必须完全一致。

## 存档

- 主世界存档 schema 保持 `1`，应用版本为 `0.28.1`。
- 工具子系统 schema 为 `2`，v1 工具存档自动迁移。
- `systems.resourceFlow` 保存资源流水。
- `systems.dailyEconomy` 通过组合视图同时保存日报、任务生命周期和阶段成本。
- 成功读档恢复长期世界与精确坐标，采用 `cancel-and-replan`，清理未完成维修任务与瞬时材料/工具预留。
- 失败读档恢复建筑、工具、流水、日报、行动运行时和维修运行时检查点。
- 维修运行时检查点保存活动维修 bundle 与失败状态；统一账本由行动运行时检查点恢复。

## 确定性基线

### 第 30 日世界基线

```text
seed: replay-seed-v026
target: 生灵历 1 年第 30 日 12:00
fixed ticks: 42,000
SHA-256: 20b2e6bea8c6f87cde6ee663ffe19ed97dedeb670679a5a7007ca6e4e412461c
```

### 第 60 日生存经济基线

```text
seed: replay-seed-v0275-day60
target: 生灵历 1 年第 60 日 12:00
fixed ticks: 85,200
SHA-256: 68cc6feff5e715fd21d6386e199d7876a11d01d5f87cff31a58014d33cd1584b
```

这两个旧回放世界不挂接维修运行时，因此 v0.28.1 必须保持原指纹不变。

## 移动 Chromium 烟雾

脚本：`scripts/mobileBrowserSmoke.js`。

```text
启动 Vite
→ 启动 Runner 自带 Chromium
→ CDP 设置 390 × 844、3× DPR、触控和 iPhone UA
→ 检查横向溢出与运行时挂接
→ 上滑/下滑观察抽屉
→ 切换营地标签并读取工具、流水、日报
→ 切换地图拖动模式
→ 通过系统菜单手动保存
→ 推进 30 ticks
→ 连续读取同一存档两次并检查时间回退与事实链校验
→ 点击 10× 并检查模拟错误
→ 保存截图和状态工件
```

## CI

普通 CI：

```text
npm ci
npm run check
npm test
npm run test:mobile-smoke
上传移动烟雾截图与状态
提取并上传 DAY30_FINGERPRINT
提取并上传 DAY60_FINGERPRINT
npm run build
```

Stability Audit：

```text
Day 60 · batch 1
Day 60 · batch 5
Day 60 · batch 10
Compare day-60 batch digests
Day 120 · batch 10
```

## 启动链

```text
index.html
  └─ src/app.js
       ├─ src/app-v4.js
       ├─ attachEcologyRuntime.js
       ├─ attachRoadRuntime.js
       ├─ attachSeasonRuntime.js
       ├─ attachFarmRuntime.js
       ├─ attachFarmExpansionRuntime.js
       ├─ attachFoodStorageRuntime.js
       ├─ attachStockTargetRuntime.js
       ├─ attachToolRuntime.js
       ├─ attachToolMaintenanceRuntime.js
       ├─ attachLaborCostRuntime.js
       ├─ attachResourceFlowRuntime.js
       ├─ attachTaskLifecycleRuntime.js
       ├─ attachDailyEconomyRuntime.js
       ├─ attachWorldSpeedRuntime.js
       ├─ attachWorldSaveRuntime.js
       ├─ attachMapHudRuntime.js
       ├─ attachObserverUiRuntime.js
       └─ attachBuildInfoRuntime.js
```

维修运行时必须在工具系统之后、资源流水和世界存档之前挂接。

## 关键测试

| 文件 | 职责 |
|---|---|
| `test/toolSystem.test.js` | 工具耐久、需求、迁移、修理与占用。 |
| `test/toolMaintenanceTask.test.js` | 维修成功、材料短缺、工具冲突与维修流水。 |
| `test/toolMaintenanceWorld.test.js` | 世界规划到真实维修完成的闭环。 |
| `test/toolMaintenanceSaveRollback.test.js` | 活动维修任务失败读档的精确回滚。 |
| `test/taskLifecycleSystem.test.js` | 完成、取消、死亡、跨日、超时与存档。 |
| `test/taskLifecycleEconomyView.test.js` | 日报组合视图和假积压移除。 |
| `test/taskLifecycleStageCostView.test.js` | 阶段成本、跨午夜和去重。 |
| `test/taskLifecycleLaborSnapshot.test.js` | 已冻结日报劳动快照保持不变。 |
| `test/materialDeliveryLifecycle.test.js` | 建材运输阶段、失效交接、部分交接与路线阻断。 |
| `test/yearAwareResourceFlow.test.js` | 跨年查询、旧接口和筛选后 limit。 |
| `test/resourceFlowTaskContextGuard.test.js` | 终止路径、读档和孤立上下文清理。 |
| `test/resourceFlowRollingSummary.test.js` | 流水持久化上限和滚动汇总。 |
| `test/economicMetricsAudit.test.js` | 同物品腐败率与比例缺口严重度。 |
| `test/day60Economy.test.js` | 第 60 日旧经济指纹与多批次一致性。 |
| `test/worldStateConservation.test.js` | 任务、预留、维修、工具、库存和食物批次守恒。 |
| `test/worldSaveContinuity.test.js` | 连续读档、旧存档兼容和失败后行动运行时回滚。 |
| `scripts/mobileBrowserSmoke.js` | 真实 Chromium 移动端启动、保存和连续读档烟雾。 |

## 已知限制

1. 存档为浏览器本地 `localStorage`，没有跨设备云存档。
2. 成功读档不续接路径游标、工作耗时或中途动画；任务会取消后重新规划。
3. 维修配方当前只使用既有木料，石材和纤维资源尚未进入正式库存。
4. 工具替换生产、最大耐久衰减、报废和最低公共工具保障尚未实现。
5. 候选评分使用直线成本预估；实际任务使用 A* 路线精确计算。
6. 石镐已进入工具目录，但采石行动和石材资源尚未实现。
7. 生命周期覆盖劳动任务；休息、睡眠和空闲时间尚未形成完整时间预算。
8. 食物分配规则除 `firstComeFirstServed` 外仍以解释和记录为主。
9. 草棚、储物棚和农田尚未成为寻路障碍。
10. 移动 Chromium 已覆盖核心交互；真实 iPhone 的安全区、地址栏变化和极小屏仍需人工回归。

## 下一阶段

v0.28 顺序：

1. **完成 v0.28.1 封版：** 普通 CI、第 60 日三批次和第 120 日维修经济长跑全部通过。
2. **工具替换与最低保障：** 新工具配方、报废、维修次数和最大耐久衰减。
3. **农业闭环：** 种子储备、播种消耗、休耕、堆肥、水分和多作物。
4. **家庭账户：** 公共库存与家庭库存分化，所有转移继续进入统一流水。

## 版本更新记录（只追加）

- `v0.1—v0.24`：人物、地图、行动、环境、农业、关系、史书、存档和聚落观察器基础。
- `v0.25`：地图优先观察器、事务化读档、移动抽屉手势和精确坐标恢复。
- `v0.26.0`：固定 tick、UI 限频、统一预留账本、确定性 ID 与第 30 日回放。
- `v0.27.1`：未来三日动态目标库存。
- `v0.27.2`：距离、负重、地形、天气、体力、技能和工具劳动成本。
- `v0.27.3`：石斧、搬运篮、简易农具、石镐及工具耐久。
- `v0.27.4`：统一资源流水与第 30 日守恒回归。
- `v0.27.5`：每日经济摘要、第 60 日回归与多倍速一致性。

### v0.27.6 · 生存经济事实链审计

- 新增任务生命周期账本和跨日结转，移除 `assigned - completed` 假积压。
- 两阶段建材运输累计领取与负重送达成本，并拥有明确失败原因。
- 腐败压力改为同物品口径；库存缺口改为目标比例严重度。
- 资源流水支持年份和日号联合查询。
- CI 新增真实 Chromium 390 × 844 触控烟雾。
- 世界存档应用版本升级到 `0.27.6`，主 schema 继续保持 `1`。

### v0.27.7 · 长期稳定性与存档连续性审计

- 新增第 60 日三批次和第 120 日 Stability Audit，每 15 日检查世界状态守恒、历史日报冻结、内存和吞吐。
- 修复资源流水任务上下文慢性泄漏，所有终止路径和读档重规划都会清理。
- 修复建材预留失效和部分交接时人物背包材料被错误扣除。
- 失败读档新增完整行动运行时检查点，恢复任务、路径、进度、统一预留、工具分配、日志和诊断状态。
- 新增连续读档、旧存档兼容、真实行动系统回滚和移动端保存/读档回归。
- 第 60 日 batch 1、5、10 最终摘要一致，digest 为 `54bb31536114dbf61630e7b88fcc1d93cb1fd2051c7df7a1ccf5e73858b254c7`。
- 世界存档应用版本升级到 `0.27.7`，主 schema 继续保持 `1`。

### v0.28.0 · 维修需求与状态模型

- 工具 schema 升级到 `2`，兼容 v1 工具存档迁移。
- 新增四级工具状态与两级维修需求优先级。
- 每种工具定义阈值、目标耐久、原型材料、工时和技能。
- 低耐久生成唯一持久化需求，部分维修保留原请求，达到安全阈值后关闭。
- 新增维修需求 UI、摘要、守恒校验和长期审计字段。

### v0.28.1 · 真实维修任务与经济闭环

- 新增 `repairTool` 行动及真实规划优先级。
- 维修分配同时预留目标工具和营地材料，且最多并发一个任务。
- 成功维修真实消耗材料并恢复目标耐久；失败保留材料之外的既有世界状态和维修需求。
- 维修进入劳动成本、人物事实、任务生命周期、资源流水和每日经济对账。
- 失败读档恢复活动维修任务、统一预留和维修运行时检查点。
- 新增维修成功、短缺、冲突、世界闭环、守恒与失败读档回归。
- 世界存档应用版本升级到 `0.28.1`，主 schema 继续保持 `1`。
