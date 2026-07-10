# 《生灵》项目交接总览（CODEX）

本文件用于防止项目记忆丢失，并帮助新的对话或开发者快速接手。

**维护规则：** 开发前按需查阅；每次有效开发后在末尾追加版本概述；每次影响 Pages 的发布同步更新根目录 `version.json`；修改已有文件前重新获取最新 SHA。

---

## 当前版本：v0.27.4

《生灵》是部署在 GitHub Pages 的纯前端 ES Module 动态世界模拟游戏。当前处于 v0.27 生存经济阶段，动态目标库存、统一劳动成本、工具耐久与统一资源流水已经完成。

## 不可破坏规则

- 世界事实优先；人物、传记、史书、关系与未来 AI 只读或解释事实。
- 人物不知玩家或游戏存在。
- 主观印象写入 `personal`；行动、建造、睡眠、播种和收获写入 `lifeEvents`。
- AI 只负责表达，不得决定行动或修改世界状态。
- `globalThis.shengling` 是运行时模块挂接点；后挂接模块必须展开当前对象，避免覆盖已有系统。
- 世界结算必须经过固定 tick；UI 事件不得承担世界事实结算。
- 运行时占用必须进入统一预留账本，并在完成、取消、死亡、路线失败和读档重建时释放。
- **预留账本与资源流水是两套不同事实：** 前者记录未来承诺和瞬时占用，后者只记录已经发生的账户增减和转移。
- 同一批物资的来源和去向必须配对成一笔内部转移，不得把搬运重复记成生产与消费。
- 不同人物在同一 tick 独立发生的生产和消费不得因数量相等而互相抵消。
- 工具耐久属于长期世界事实；工具任务占用属于瞬时运行时状态。
- 读档保持事务性：目标快照先验证；失败时恢复长期状态、建筑瞬时预留、工具检查点、资源流水检查点和原行动运行时。
- 成功读档采用 `cancel-and-replan`：恢复实时坐标和长期事实，取消未完成任务后重新规划。
- 动态库存必须区分现货、人物背包、在途资源和已经承诺的资源，不能重复计算同一批物资。
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
- `building-material`：工地材料预留的运行时映射。
- `tool`：公共工具占用，`key = toolId`，容量固定为 1。

运行时 API：

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

关键约束：

- 每人每日水 `0.9`；每人每日食物 `0.72`。
- 冬季食物倍率 `1.3`；冬季木材倍率 `1.75`。
- 目标库存最多使用当前储存容量的 92%。
- 人物背包按全体存活人物汇总。
- 同一规划轮的新任务立即进入在途估算。
- 工地材料预留和添柴任务计入承诺量。
- 缺口为零时，非紧急人物不再创建取水、采集浆果或伐木任务。
- 严重口渴或饥饿仍允许触发个人紧急行动。

运行时：

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

成本因素：

- **距离：** 候选评分使用直线预估；分配后使用实际 A* 路线。
- **负重：** 水 `1.1`、木材 `1.4`、浆果 `0.35`、粟米 `0.45`。
- **地形速度：** 草地 `1`、高草 `0.84`、林地 `0.86`、泥土 `1.03`、沙岸 `0.87`、石滩 `0.89`、农田 `0.92`。
- **道路：** 磨损小径 `1.07×`，土路 `1.16×`。
- **天气：** 读取 `movementMultiplier` 与 `workMultiplier`。
- **体力：** 低精力降低移动速度；低于 60 增加工作耗时，低于 50 增加额外能耗。
- **技能：** 捕鱼、采集、伐木、建造技能降低对应劳动能耗，最低为 65%。
- **工具：** 从 `toolSystem` 预览可用工具，写入任务成本快照。

任务快照 schema v2 记录距离、原始负重、有效负重、工具、技能、地形、道路、天气、疲劳、预计耗时和预计能耗。

性能边界：

- `mapSystem.getTerrainAt()` 返回原始地形编号，供固定 tick 热路径使用。
- 移动阶段不得每 tick 调用 `peopleSystem.getRuntime()`。
- 额外能耗不得按 tick 写回人物；当前在任务阶段内累计，完成时一次结算。
- 第 30 日 42,000 tick 回放必须在 CI 的 15 分钟硬限制内完成。

运行时：

```js
window.shengling.laborCostSystem.estimate(personId, task)
window.shengling.laborCostSystem.getRecent(10)
```

## v0.27.3 工具与耐久

### 工具目录

模块：`src/modules/tools/toolCatalog.js`

| 类型 | ID | 最大耐久 | 当前行动 |
|---|---|---:|---|
| 石斧 | `tool-stone-axe-1` | 72 | `chopTree` |
| 搬运篮 | `tool-carrying-basket-1` | 90 | `haulToCamp`、`deliverMaterials` |
| 简易农具 | `tool-simple-farm-tool-1` | 84 | `clearField`、`sowMillet`、`harvestMillet` |
| 石镐 | `tool-stone-pick-1` | 100 | 暂无；为采石保留 |

所有初始工具归属营地 `starting-camp`。

劳动效果：

- 石斧：工作耗时倍率 `0.70`，额外能耗倍率 `0.82`。
- 搬运篮：工作耗时倍率 `0.92`，额外能耗倍率 `0.80`，有效负重倍率 `0.64`。
- 简易农具：工作耗时倍率 `0.76`，额外能耗倍率 `0.86`。

生命周期模块：`src/modules/tools/toolSystem.js`

- `actions:assigned`：优先使用劳动成本快照中的工具，在统一账本创建 `tool` 预留。
- `actions:completed`：根据任务和 `workAmount` 扣耐久，随后删除分配记录。
- 取消、死亡、路线失败：由 `reconcile()` 删除孤立分配，不结算完整任务磨损。
- 耐久归零后状态为 `broken`，不再进入候选。
- `repair()` 与 `replace()` 当前为机制 API，尚未消耗材料或劳动。

运行时：

```js
window.shengling.toolSystem.list()
window.shengling.toolSystem.getSummary()
window.shengling.toolSystem.getAssignments()
window.shengling.toolSystem.previewForAction(actionType)
window.shengling.toolSystem.repair(toolId, amount)
window.shengling.toolSystem.replace(toolId)
```

存档：

- `systems.tools` 保存工具耐久、损坏、归属、位置、累计磨损和维修次数。
- 工具任务分配与预留不进入长期存档。
- 旧存档缺少工具字段时调用 `resetToDefaults()`。
- 失败读档使用 `toolSystem.createCheckpoint()` / `restoreCheckpoint()`。

## v0.27.4 统一资源流水

### 模块与职责

核心：`src/modules/economy/resourceFlowSystem.js`

挂接：`src/bootstrap/attachResourceFlowRuntime.js`

资源流水是已经发生的世界事实，记录格式：

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

### 同 tick 配对规则

系统维护人物背包、营地库存和工具耐久影子状态，并收集实际增减。

配对条件只能是：

1. 正负变化拥有相同且非空的 `taskId`；或
2. 账户为人物与营地，行动类型明确为 `haulToCamp` 或 `deliverMaterials`。

除此之外，即使物品、数量和 tick 相同，也不得自动配对。

示例：

```text
人物 A 背包 -3 木材
营地 +3 木材
行动 = haulToCamp
→ 一笔 person:A → camp:starting-camp 的 transfer
```

```text
人物 A 吃掉 -1 浆果
人物 B 采集 +1 浆果
同一 tick
→ 一笔 consumption + 一笔 production，不得互相抵消
```

### 未配对流向

增加：

- `fetchWater` → `environment:river`
- `gatherBerries` / `chopTree` → `map:feature:*`
- `harvestMillet` → `farm:*`
- 其他 → `world:production`

减少：

- `food:consume` / `drink` / distribution → `needs:*`
- `food:decay` / spoil → `waste:spoilage`
- 添柴 → `fire:starting-camp`
- 建材与施工 → `building:*`
- 工具耐久 → `wear:*`
- 其他 → `world:consumption`

### 检查点与存档

- 最多保留最近 5,000 笔。
- `systems.resourceFlow` 进入世界存档。
- 旧存档缺少该字段时导入空账本，不改变主 schema 1。
- `exportState()` 与 `createCheckpoint()` 会先结算悬空变化，避免将半配对事务写入存档。
- 失败读档通过资源流水检查点恢复读取前记录。
- 成功读档导入目标流水并重建影子状态。

### 校验

```js
window.shengling.resourceFlowSystem.verify()
```

检查：

- 重复流水 ID。
- 非正数量。
- 空来源、空去向或来源等于去向。
- 人物与营地负库存。
- 工具耐久低于 0 或高于最大耐久。

### 运行时 API

```js
window.shengling.resourceFlowSystem.list({ limit: 20 })
window.shengling.resourceFlowSystem.getSummary()
window.shengling.resourceFlowSystem.getDailySummary(day)
window.shengling.resourceFlowSystem.verify()
window.shengling.resourceFlowSystem.exportState()
```

营地 UI 使用 10 FPS 调度器显示当日生产、消耗、施工、腐败和转移，不参与世界结算。

`attachResourceFlowRuntime()` 必须在 `attachWorldSaveRuntime()` 前执行，保证存档系统能够发现 `runtime.resourceFlowSystem`。

## 第 30 日确定性基线

固定种子与目标时刻：

```text
replay-seed-v026
生灵历 1 年第 30 日 12:00
42,000 fixed ticks
```

v0.27.4 保持的 SHA-256 世界指纹：

```text
20b2e6bea8c6f87cde6ee663ffe19ed97dedeb670679a5a7007ca6e4e412461c
```

资源流水是浏览器旁路事实账本，不改变原模拟结算，因此旧基线必须保持。流水配对、分类、存档和校验由 `test/resourceFlowSystem.test.js` 专项覆盖。

CI 流程：

```text
npm ci
npm run check
npm test
第 30 日指纹提取与工件上传
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
       ├─ attachWorldSpeedRuntime.js
       ├─ attachWorldSaveRuntime.js
       ├─ attachMapHudRuntime.js
       ├─ attachObserverUiRuntime.js
       └─ attachBuildInfoRuntime.js
```

## 关键模块

| 文件 | 职责 |
|---|---|
| `src/core/simulation/fixedStepClock.js` | 现实时间累积、固定 tick 消费和诊断。 |
| `src/core/ui/uiRenderScheduler.js` | UI 请求合并与 10 FPS 限频。 |
| `src/core/ids/createId.js` | 可重置的确定性 ID 序列。 |
| `src/modules/actions/actionSystem.js` | 固定 tick 主循环、规划、行动、需求与运行时预留。 |
| `src/modules/actions/actionPlanner.js` | 动态库存上下文、候选过滤、在途估算和行动选择。 |
| `src/modules/actions/stockTargetModel.js` | 三日目标、容量预算、有效库存和缺口计算。 |
| `src/modules/actions/laborCostModel.js` | 距离、负重、地形、道路、天气、体力、技能、工具和行动强度。 |
| `src/modules/actions/reservationLedger.js` | 统一任务、资源、容量、建材和工具预留。 |
| `src/modules/tools/toolCatalog.js` | 工具定义、效果、磨损和初始蓝图。 |
| `src/modules/tools/toolSystem.js` | 工具耐久、损坏、占用、修理、存档和检查点。 |
| `src/modules/economy/resourceFlowSystem.js` | 账户影子、同 tick 配对、流水分类、持久化和守恒校验。 |
| `src/bootstrap/attachResourceFlowRuntime.js` | 事件观察、每日读数与浏览器 API。 |
| `src/modules/persistence/worldSaveSystem.js` | 世界快照、事务化导入、失败回滚、工具与流水检查点。 |
| `test/resourceFlowSystem.test.js` | 转移配对、独立生产消费、工具耐久、存档和校验测试。 |
| `test/deterministicKernel.test.js` | 固定步长、UI 调度、账本和第 30 日指纹。 |

## 已知限制

1. 存档为浏览器本地 `localStorage`，没有跨设备云存档。
2. 成功读档不续接路径游标、工作耗时或中途动画。
3. 动态库存、劳动成本和工具耐久参数仍是原型值，需要第 60 日回归校准。
4. 候选评分使用直线成本预估；实际任务使用 A* 路线精确计算。
5. 修理与替换已进入耐久流水，但尚未成为需要材料、劳动时间和失败原因的正式任务。
6. 石镐已进入工具目录，但采石行动和石材资源尚未实现。
7. 流水按实际账户增减记账；计划量、失败原因与完整工序批次仍需继续细化。
8. 当前每日读数只有类别汇总，尚未完成期初期末对账、瓶颈和劳动占比。
9. 食物分配规则除 `firstComeFirstServed` 外仍以解释和记录为主。
10. 草棚、储物棚和农田尚未成为寻路障碍。
11. 真实 iPhone 安全区、浏览器地址栏变化和极小屏仍需人工回归。

## v0.27 剩余顺序

1. **日报与第 60 日回归：** 日收支、期初期末库存、瓶颈、劳动占比、资源守恒与多倍速一致性。

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
- 新增流水校验器，检查重复记录、非法流向、负库存和工具耐久越界。
- 营地面板增加当日生产、消费、施工、腐败与转移读数。
- 新增 7 项资源流水专项测试；第 30 日确定性指纹保持 `20b2e6bea8c6f87cde6ee663ffe19ed97dedeb670679a5a7007ca6e4e412461c`。
