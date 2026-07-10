# 《生灵》项目交接总览（CODEX）

本文件用于防止项目记忆丢失，并帮助新的对话或开发者快速接手。

**维护规则：** 开发前按需查阅；每次有效开发后在末尾追加版本概述；每次影响 Pages 的发布同步更新根目录 `version.json`；修改已有文件前重新获取最新 SHA。

---

## 当前版本：v0.27.5

《生灵》是部署在 GitHub Pages 的纯前端 ES Module 动态世界模拟游戏。v0.27 生存经济阶段已经完成：动态目标库存、劳动成本、工具耐久、统一资源流水、每日经济摘要和第 60 日长期回归均已落地。

## 不可破坏规则

- 世界事实优先；人物、传记、史书、关系与未来 AI 只读或解释事实。
- 人物不知玩家或游戏存在。
- 主观印象写入 `personal`；行动、建造、睡眠、播种和收获写入 `lifeEvents`。
- AI 只负责表达，不得决定行动或修改世界状态。
- `globalThis.shengling` 是运行时模块挂接点；后挂接模块必须展开当前对象，避免覆盖已有系统。
- 世界结算必须经过固定 tick；UI 事件不得承担世界事实结算。
- 运行时占用进入统一预留账本，并在完成、取消、死亡、路线失败和读档重建时释放。
- **预留账本与资源流水是两套不同事实：** 前者记录未来承诺和瞬时占用，后者只记录已经发生的账户增减和转移。
- 同一批物资的来源和去向必须配对成一笔内部转移，不得把搬运重复记成生产与消费。
- 不同人物在同一 tick 独立发生的生产和消费不得因数量相等而互相抵消。
- 工具耐久属于长期世界事实；工具任务占用属于瞬时运行时状态。
- 日报必须以资源流水和库存快照为事实源，不能自行创造资源数字。
- 日报账实差异不能静默忽略；`dailyEconomySystem.verify()` 必须报告。
- 读档保持事务性：目标快照先验证；失败时恢复长期状态、建筑瞬时预留、工具检查点、资源流水检查点、日报检查点和原行动运行时。
- 成功读档采用 `cancel-and-replan`：恢复实时坐标和长期事实，取消未完成任务后重新规划。
- 动态库存必须区分现货、人物背包、在途资源和已经承诺的资源。
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
- `tool`：公共工具占用，`key = toolId`，容量固定为 1。

```js
window.shengling.reservationLedger.list()
window.shengling.reservationLedger.getSummary()
window.shengling.actionSystem.getDiagnostics().reservations
```

预留账本是瞬时状态，不写入长期存档。成功读档重建代理时清空；失败读档保留原行动运行时与账本。

## v0.27.1 动态目标库存

模块：`src/modules/actions/stockTargetModel.js`

```text
目标周期 = 未来 3 个世界日
水目标 = 人口 × 每日饮水 × 3 × 气温倍率
食物目标 = 人口 × 每日食物 × 3 × 季节倍率 × 腐败缓冲
木材目标 = 三日燃料 + 未预留建造需求 + 人口缓冲
有效库存 = 营地现货 + 人物背包 + 在途采集 - 已承诺物资
```

约束：

- 每人每日水 `0.9`；每人每日食物 `0.72`。
- 冬季食物倍率 `1.3`；冬季木材倍率 `1.75`。
- 目标库存最多使用当前储存容量的 92%。
- 同一规划轮的新任务立即进入在途估算。
- 工地材料和添柴任务计入承诺量。
- 缺口为零时停止非紧急重复采集。

```js
window.shengling.stockTargetSystem.get()
window.shengling.stockTargetSystem.refresh()
```

## v0.27.2 劳动成本模型

模块：`src/modules/actions/laborCostModel.js`

覆盖取水、采集、伐木、搬运、建材运输、施工、开垦、播种、收获和添柴。

```text
预计总耗时 = 预计通勤时间 + 有效工作时间
预计精力 = 基础工作精力 + 地形 / 负重 / 天气 / 疲劳 / 技能 / 工具带来的额外精力
```

因素：实际 A* 路线、负重、地形、道路、天气、当前精力、技能、行动强度和工具。

- 磨损小径 `1.07×`，土路 `1.16×`。
- 移动阶段不得每 tick 深拷贝完整人物。
- 额外能耗在任务阶段内累计，完成时一次结算。

```js
window.shengling.laborCostSystem.estimate(personId, task)
window.shengling.laborCostSystem.getRecent(10)
```

## v0.27.3 工具与耐久

| 类型 | ID | 最大耐久 | 当前行动 |
|---|---|---:|---|
| 石斧 | `tool-stone-axe-1` | 72 | `chopTree` |
| 搬运篮 | `tool-carrying-basket-1` | 90 | `haulToCamp`、`deliverMaterials` |
| 简易农具 | `tool-simple-farm-tool-1` | 84 | `clearField`、`sowMillet`、`harvestMillet` |
| 石镐 | `tool-stone-pick-1` | 100 | 暂无；为采石保留 |

- 工具归属营地 `starting-camp`。
- 同一工具不能同时被多个任务占用。
- 完成任务扣耐久；取消、死亡和路线失败只释放占用。
- 耐久归零后状态为 `broken`。
- `repair()` 与 `replace()` 当前为机制 API，尚未形成正式维修任务。

```js
window.shengling.toolSystem.list()
window.shengling.toolSystem.getSummary()
window.shengling.toolSystem.getAssignments()
window.shengling.toolSystem.repair(toolId, amount)
window.shengling.toolSystem.replace(toolId)
```

`systems.tools` 保存耐久、损坏、归属、位置、累计磨损和维修次数；任务占用不进入长期存档。

## v0.27.4 统一资源流水

核心：`src/modules/economy/resourceFlowSystem.js`

挂接：`src/bootstrap/attachResourceFlowRuntime.js`

记录格式：

```js
{
  schemaVersion: 1,
  id,
  sequence,
  tick,
  time,
  itemId,
  amount,
  unit,
  from,
  to,
  category,
  reason,
  personId,
  taskId,
  reservationId,
  metadata
}
```

类别：

- `production`：河流、地图物件、农田或其他生产源进入账户。
- `transfer`：人物、营地、工地等账户之间移动。
- `consumption`：食物和水进入人物需求。
- `fuel`：木材进入篝火。
- `construction`：材料进入工地或建筑消耗。
- `spoilage`：食物进入腐败废弃。
- `wear`：工具耐久进入磨损。
- `repair`：维修恢复工具耐久。

同 tick 配对条件只能是：

1. 正负变化拥有相同且非空的 `taskId`；或
2. 账户为人物与营地，行动为 `haulToCamp` 或 `deliverMaterials`。

其他独立变化不得自动抵消。

- 最多保留最近 5,000 笔。
- `systems.resourceFlow` 进入世界存档。
- `exportState()` 与检查点先结算悬空变化。
- 旧存档从空账本开始。
- 失败读档恢复读取前流水检查点。

```js
window.shengling.resourceFlowSystem.list({ limit: 20 })
window.shengling.resourceFlowSystem.getSummary()
window.shengling.resourceFlowSystem.getDailySummary(day)
window.shengling.resourceFlowSystem.verify()
```

## v0.27.5 每日经济摘要

核心：`src/modules/economy/dailyEconomySystem.js`

挂接：`src/bootstrap/attachDailyEconomyRuntime.js`

每日报告保存：

- `openingInventory`：当日期初人物背包与营地库存。
- `closingInventory`：查询或锁定日报时的期末库存。
- `flow`：当日流水按类别和物品汇总。
- `balances`：每种资源的期初、期末、生产、消费、燃料、施工、腐败、内部转移和差异。
- `labor`：分配数、完成数、预计秒数、预计精力和行动分类。
- `denials`：食物、水和其他生存请求拒绝次数与原因。
- `stockTargets` / `stockGaps`：三日目标与缺口。
- `bottlenecks`：生存短缺、库存缺口、腐败压力、劳动积压和账实差异。
- `simulationErrors`：日报期间捕获的模拟错误。

对账：

```text
expectedDelta = production - consumption - fuel - construction - spoilage
actualDelta = closingInventory - openingInventory
discrepancy = actualDelta - expectedDelta
```

跨日流程：

```text
simulation:pre-tick 检测日期变化
→ 锁定旧日报
→ 建立新日期初库存
→ 发布 daily-economy:finalized / opened
```

跨日事务必须使用重入保护，避免日报事件经通配监听器再次触发 rollover。

运行时：

```js
window.shengling.dailyEconomySystem.getCurrentReport()
window.shengling.dailyEconomySystem.getReport(year, day)
window.shengling.dailyEconomySystem.listReports({ limit: 7 })
window.shengling.dailyEconomySystem.verify()
```

存档：

- `systems.dailyEconomy` 保存历史日报和当前草稿。
- 旧存档缺少该字段时调用 `reset()`，以当前世界状态建立当日草稿。
- 失败读档使用 `createCheckpoint()` / `restoreCheckpoint()` 恢复原日报。
- 主世界存档 schema 保持 `1`，应用版本为 `0.27.5`。

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

第 60 日指纹覆盖：

- 完整世界状态。
- 60 份日级经济报告。
- 流水总计和最近 40 笔流水。
- 劳动分配、拒绝事件、瓶颈和账实状态。

多倍速一致性测试使用同一种子和相同 tick 数，以 1、5、10 三种批次调用 `advanceTicks()`，最终世界指纹必须相同。

CI：

```text
npm ci
npm run check
npm test
提取并上传 DAY30_FINGERPRINT
提取并上传 DAY60_FINGERPRINT
npm run build
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
       ├─ attachLaborCostRuntime.js
       ├─ attachResourceFlowRuntime.js
       ├─ attachDailyEconomyRuntime.js
       ├─ attachWorldSpeedRuntime.js
       ├─ attachWorldSaveRuntime.js
       ├─ attachMapHudRuntime.js
       ├─ attachObserverUiRuntime.js
       └─ attachBuildInfoRuntime.js
```

`attachResourceFlowRuntime()` 和 `attachDailyEconomyRuntime()` 必须在 `attachWorldSaveRuntime()` 前执行。

## 关键模块

| 文件 | 职责 |
|---|---|
| `src/core/simulation/fixedStepClock.js` | 现实时间累积、固定 tick 消费和诊断。 |
| `src/core/ui/uiRenderScheduler.js` | UI 请求合并与 10 FPS 限频。 |
| `src/core/ids/createId.js` | 可重置的确定性 ID 序列。 |
| `src/modules/actions/actionSystem.js` | 固定 tick 主循环、规划、行动、需求与运行时预留。 |
| `src/modules/actions/stockTargetModel.js` | 三日目标、容量预算、有效库存和缺口。 |
| `src/modules/actions/laborCostModel.js` | 距离、负重、地形、道路、天气、体力、技能和工具。 |
| `src/modules/actions/reservationLedger.js` | 任务、资源、容量、建材和工具预留。 |
| `src/modules/tools/toolSystem.js` | 工具耐久、损坏、占用、修理、存档和检查点。 |
| `src/modules/economy/resourceFlowSystem.js` | 账户影子、同 tick 配对、流水分类、持久化和校验。 |
| `src/modules/economy/dailyEconomySystem.js` | 日级库存快照、流水对账、劳动、拒绝和瓶颈。 |
| `src/bootstrap/attachResourceFlowRuntime.js` | 流水事件观察、读数与浏览器 API。 |
| `src/bootstrap/attachDailyEconomyRuntime.js` | 日报观察、营地读数与浏览器 API。 |
| `src/modules/persistence/worldSaveSystem.js` | 世界快照、事务导入、失败回滚及各检查点。 |
| `test/resourceFlowSystem.test.js` | 流水配对、分类、存档和校验。 |
| `test/dailyEconomySystem.test.js` | 日级对账、劳动、拒绝、跨日、瓶颈和存档。 |
| `test/day60Economy.test.js` | 第 60 日经济指纹与 1/5/10 批次一致性。 |
| `test/deterministicKernel.test.js` | 固定步长、UI 调度、预留账本和第 30 日指纹。 |

## 已知限制

1. 存档为浏览器本地 `localStorage`，没有跨设备云存档。
2. 成功读档不续接路径游标、工作耗时或中途动画。
3. 动态库存、劳动成本和工具耐久参数仍需根据第 60 日报告继续校准。
4. 候选评分使用直线成本预估；实际任务使用 A* 路线精确计算。
5. 修理与替换已进入耐久流水，但尚未成为消耗材料和劳动的正式任务。
6. 石镐已进入工具目录，但采石行动和石材资源尚未实现。
7. 日报记录任务分配与完成，尚未细分休息、睡眠和空闲时间的完整劳动预算。
8. 食物分配规则除 `firstComeFirstServed` 外仍以解释和记录为主。
9. 草棚、储物棚和农田尚未成为寻路障碍。
10. 真实 iPhone 安全区、浏览器地址栏变化和极小屏仍需人工回归。

## 下一阶段

v0.27 生存经济已完成。v0.28 顺序：

1. **农业闭环：** 种子储备、播种消耗、休耕、堆肥、水分和多作物。
2. **正式维修经济：** 工具修理需要材料、劳动、地点和失败原因。
3. **家庭账户：** 公共库存与家庭库存分化，所有转移继续进入统一流水。

## 版本更新记录（只追加）

- `v0.1`：人物系统基础。
- `v0.2`：起始河谷地图。
- `v0.3`：自主行动循环与 A* 寻路。
- `v0.4`：建造、运料、施工与居住。
- `v0.5`：昼夜、睡眠和居住效果。
- `v0.6`：天气、篝火与环境暴露。
- `v0.7`：储物棚与营地容量。
- `v0.8`：自然资源恢复。
- `v0.9`：踩踏路径与土路。
- `v0.10—v0.14`：粟田、食物损耗、四季、扩田、土壤与地图交互。
- `v0.15`：世界速度与高倍速审计。
- `v0.16`：世界存档、自动保存和读取入口。
- `v0.17—v0.23`：效用行动、关系反馈、冬季稀缺、营地规则、事件传播、史书与 LLM 只读边界。
- `v0.24`：聚落观察器 UI 与第四日稳定性修复。
- `v0.25`：地图优先观察器、事务化读档、移动抽屉手势和精确坐标恢复。
- `v0.26.0`：固定 tick、UI 限频、统一预留账本、确定性 ID 与第 30 日回放。

### v0.27.1 · 动态目标库存

- 新增未来三日水、食物和木材目标。
- 有效库存统一计算现货、背包、在途采集与工地/添柴承诺。
- 新增 5 项专项测试；第 30 日基线更新为 `c170c6ced37c5c3629112087d57dbb18ec29a8b01bce967c0c20b53716aeaa37`。

### v0.27.2 · 劳动成本模型

- 新增距离、负重、地形、道路、天气、体力、技能和行动强度模型。
- 候选评分新增 `laborCost`；任务分配后按实际 A* 路线锁定快照。
- 新增 6 项专项测试；第 30 日基线更新为 `20b2e6bea8c6f87cde6ee663ffe19ed97dedeb670679a5a7007ca6e4e412461c`。

### v0.27.3 · 工具与耐久

- 新增石斧、搬运篮、简易农具和石镐。
- 工具占用接入统一预留，完成任务扣耐久，取消和失败释放占用。
- 工具耐久进入长期存档，旧存档恢复默认工具，失败读档恢复检查点。
- 新增 8 项专项测试，全量测试 `47/47` 通过。

### v0.27.4 · 统一资源流水

- 新增人物、营地和工具账户影子以及同 tick 增减配对机制。
- 搬运与运料合并成单笔内部转移；独立生产与消费不会错误抵消。
- 采集、农业、进食、饮水、添柴、施工、腐败、工具磨损和维修进入统一分类。
- 流水保留最近 5,000 笔并进入事务存档；旧存档从空账本开始。
- 新增 7 项资源流水专项测试；第 30 日指纹保持 `20b2e6bea8c6f87cde6ee663ffe19ed97dedeb670679a5a7007ca6e4e412461c`。

### v0.27.5 · 每日经济摘要与第 60 日回归

- 新增期初期末库存、资源收支、账实差异、劳动、拒绝事件和瓶颈日报。
- 日报进入长期存档与失败读档检查点；旧存档从当前状态建立当日草稿。
- 修复跨日锁定事件经通配监听器递归触发的问题，加入 rollover 重入保护。
- 新增 6 项日报专项测试。
- 新增第 60 日 85,200 tick 生存经济回放，锁定指纹 `68cc6feff5e715fd21d6386e199d7876a11d01d5f87cff31a58014d33cd1584b`。
- 新增 1×、5×、10× 批次推进一致性测试。
- 全量测试目标为 `62/62`，并同时上传第 30 日与第 60 日指纹工件。
