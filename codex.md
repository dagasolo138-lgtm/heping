# 《生灵》项目交接总览（CODEX）

本文件用于防止项目记忆丢失，并帮助新的对话或开发者快速接手。

**维护规则：** 开发前按需查阅；每次有效开发后在末尾追加版本概述；每次影响 Pages 的发布同步更新根目录 `version.json`；修改已有文件前重新获取最新 SHA。

---

## 当前版本：v0.27.3

《生灵》是部署在 GitHub Pages 的纯前端 ES Module 动态世界模拟游戏。当前处于 v0.27 生存经济阶段，动态目标库存、统一劳动成本以及工具与耐久已经完成。

## 不可破坏规则

- 世界事实优先；人物、传记、史书、关系与未来 AI 只读或解释事实。
- 人物不知玩家或游戏存在。
- 主观印象写入 `personal`；行动、建造、睡眠、播种和收获写入 `lifeEvents`。
- AI 只负责表达，不得决定行动或修改世界状态。
- `globalThis.shengling` 是运行时模块挂接点；后挂接模块必须展开当前对象，避免覆盖已有系统。
- 世界结算必须经过固定 tick；UI 事件不得承担世界事实结算。
- 运行时占用必须进入统一预留账本，并在完成、取消、死亡、路线失败和读档重建时释放。
- 工具耐久属于长期世界事实；工具任务占用属于瞬时运行时状态，不能混为一个存档字段。
- 读档保持事务性：目标快照先验证；失败时恢复长期状态、建筑瞬时预留、工具检查点和原行动运行时。
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

账本是瞬时运行时状态，不写入长期存档。成功读档重建代理时清空；失败读档保留原行动运行时与账本。

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
- 目标库存最多使用当前储存容量的 92%，保留操作余量。
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

- **距离：** 候选评分阶段使用当前位置到目标的预估；任务分配后使用实际 A* 路线。
- **负重：** 水 `1.1`、木材 `1.4`、浆果 `0.35`、粟米 `0.45` 重量单位。
- **地形速度：** 草地 `1`、高草 `0.84`、林地 `0.86`、泥土 `1.03`、沙岸 `0.87`、石滩 `0.89`、农田 `0.92`。
- **道路：** 磨损小径 `1.07×`，土路 `1.16×`。
- **天气：** 读取 `movementMultiplier` 与 `workMultiplier`。
- **体力：** 低精力降低移动速度；低于 60 后增加工作耗时，低于 50 后增加额外能耗。
- **技能：** 捕鱼、采集、伐木、建造技能降低对应劳动额外能耗，最低为无技能能耗的 65%。
- **行动强度：** 伐木、施工、开垦高于取水、播种和添柴。
- **工具：** 从 `toolSystem` 预览可用工具，写入精确任务成本快照。

任务快照核心字段：

```js
task.data.laborCost = {
  schemaVersion: 2,
  distance,
  loadWeight,
  effectiveLoadWeight,
  tool,
  skill,
  skillLevel,
  intensity,
  factors: {
    terrain,
    road,
    load,
    weatherMovement,
    weatherWork,
    fatigueSpeed,
    fatigueWork,
    skillEnergy,
    toolWork,
    toolEnergy,
    toolLoad
  },
  effectiveWorkDuration,
  travelSeconds,
  expectedDuration,
  movementExtraEnergyRate,
  workExtraEnergyRate,
  expectedEnergy
}
```

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

所有初始工具归属：

```js
owner = { type: 'camp', id: 'starting-camp' }
location = { type: 'camp', id: 'starting-camp' }
```

### 劳动效果

- 石斧：工作耗时倍率 `0.70`，额外能耗倍率 `0.82`。
- 搬运篮：工作耗时倍率 `0.92`，额外能耗倍率 `0.80`，有效负重倍率 `0.64`。
- 简易农具：工作耗时倍率 `0.76`，额外能耗倍率 `0.86`。
- 石镐已定义效果，但在采石行动出现前不会被选中。

工具效果进入 `laborCostModel`，不能只显示在 UI 或背包中。

### 生命周期

模块：`src/modules/tools/toolSystem.js`

- `actions:assigned`：优先使用 `task.data.laborCost.tool.id`，在统一账本创建 `tool` 预留。
- `people:changed` 且活动归零：先释放工具账本占用，但暂留任务分配记录。
- `actions:completed`：根据任务类型和 `workAmount` 扣耐久，随后删除分配记录。
- 取消、死亡、路线失败：不会产生 `actions:completed`，下一次 `simulation:tick` 通过 `reconcile()` 删除孤立分配。
- 耐久归零后状态为 `broken`，不再进入 `previewForAction()`。
- `repair()` 恢复指定耐久；`replace()` 恢复满耐久。当前两者是机制 API，尚未消耗材料或劳动。

运行时：

```js
window.shengling.toolSystem.list()
window.shengling.toolSystem.getSummary()
window.shengling.toolSystem.getAssignments()
window.shengling.toolSystem.previewForAction(actionType)
window.shengling.toolSystem.repair(toolId, amount)
window.shengling.toolSystem.replace(toolId)
```

### 存档与回滚

- 世界存档 `systems.tools` 保存工具耐久、损坏、归属、位置、累计磨损和维修次数。
- 工具任务分配与预留不进入长期存档。
- 读取 v0.27.2 及更早存档时，缺少 `systems.tools` 会调用 `resetToDefaults()`。
- 成功读档后，行动代理重建会清空旧运行时预留并重新规划。
- 失败读档前保存 `toolSystem.createCheckpoint()`；回滚时用 `restoreCheckpoint()` 恢复原耐久和原任务分配。
- `toolSystem.importState()` 不主动清除统一账本，避免失败读档破坏原行动运行时；成功路径由 `actionSystem.resetRuntimeAgents()` 统一清账。

### UI

模块：`src/bootstrap/attachToolRuntime.js`

营地面板显示：

```text
工具名 当前耐久/最大耐久（可用 / 使用中 / 损坏）
```

`attachToolRuntime()` 必须在 `attachWorldSaveRuntime()` 前执行，保证世界存档系统能够发现 `runtime.toolSystem`。

## 第 30 日确定性基线

固定种子与目标时刻：

```text
replay-seed-v026
生灵历 1 年第 30 日 12:00
42,000 fixed ticks
```

v0.27.3 保持的 SHA-256 世界指纹：

```text
20b2e6bea8c6f87cde6ee663ffe19ed97dedeb670679a5a7007ca6e4e412461c
```

该回放测试不挂接浏览器工具运行时，因此用于证明工具扩展没有破坏无工具确定性内核。工具耐久、互斥占用、取消回收、存档和劳动效果由 `test/toolSystem.test.js` 的 8 项专项测试覆盖。

CI 流程：

```text
npm ci
npm run check
npm test
第 30 日指纹提取与工件上传
npm run build
```

v0.27.3 首轮结果：`47/47` 测试通过，生产构建通过。

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
| `src/modules/actions/actionExecutor.js` | A* 路线劳动快照、移动倍率、工作耗时和额外精力结算。 |
| `src/modules/actions/utilityScorer.js` | 个人需求、动态库存、技能、劳动成本和社会因素评分。 |
| `src/modules/actions/reservationLedger.js` | 统一任务、资源、容量、建材和工具预留账本。 |
| `src/modules/tools/toolCatalog.js` | 工具定义、效果、磨损和初始工具蓝图。 |
| `src/modules/tools/toolSystem.js` | 工具耐久、损坏、占用、修理、存档与回滚检查点。 |
| `src/bootstrap/attachToolRuntime.js` | 工具事件生命周期、营地读数与浏览器 API。 |
| `src/modules/map/mapSystem.js` | 地图查询与固定 tick 原始地形读取。 |
| `src/modules/people/peopleSystem.js` | 完整人物状态与轻量运行时视图。 |
| `src/modules/persistence/worldSaveSystem.js` | 世界快照、事务化导入、失败回滚和工具检查点。 |
| `test/dynamicStockTargets.test.js` | 动态目标、季节、有效库存、在途与停止过采测试。 |
| `test/laborCostModel.test.js` | 地形、道路、负重、天气、疲劳、技能与运行时能耗测试。 |
| `test/toolSystem.test.js` | 工具目录、互斥、磨损、取消、损坏、存档、回滚和劳动效果测试。 |
| `test/deterministicKernel.test.js` | 固定步长、UI 调度、账本和第 30 日指纹。 |

## 已知限制

1. 存档为浏览器本地 `localStorage`，没有跨设备云存档。
2. 成功读档不续接路径游标、工作耗时或中途动画。
3. 动态库存、劳动成本和工具耐久参数仍是原型值，需要第 60 日回归和长期平衡校准。
4. 候选评分使用直线成本预估；实际任务使用 A* 路线精确计算。
5. 修理与替换尚未成为需要材料、劳动时间和失败原因的正式任务。
6. 石镐已进入工具目录，但采石行动和石材资源尚未实现。
7. 统一预留账本尚未形成完整资源流水与每日收支报表。
8. 食物分配规则除 `firstComeFirstServed` 外仍以解释和记录为主。
9. 草棚、储物棚和农田尚未成为寻路障碍。
10. 真实 iPhone 安全区、浏览器地址栏变化和极小屏仍需人工回归。

## v0.27 剩余顺序

1. **资源流水：** 采集、搬运、施工、进食、饮水、添柴、腐败、农业和工具维修统一记账。
2. **日报与第 60 日回归：** 日收支、瓶颈、资源守恒与多倍速一致性。

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

- 新增未来三日水、食物和木材目标，读取人口、季节、温度、天气、腐败、储存保护、燃料和建造需求。
- 当前容量不足时按 92% 容量预算压缩目标，储物棚完成后自动恢复完整需求。
- 有效库存统一计算现货、人物背包、在途采集与工地/添柴承诺，避免重复接单。
- 库存目标满足后停止非紧急过度采集；紧急个人生存需求继续保留。
- 营地面板和 `stockTargetSystem` 暴露目标、有效库存、在途量、承诺量和容量约束。
- 新增 5 项动态库存专项测试；第 30 日基线更新为 `c170c6ced37c5c3629112087d57dbb18ec29a8b01bce967c0c20b53716aeaa37`。

### v0.27.2 · 劳动成本模型

- 新增统一劳动成本模型，覆盖距离、负重、地形、道路、天气、体力、技能和行动强度。
- 候选评分新增 `laborCost` 因子；任务分配后按实际 A* 路线锁定精确成本快照。
- 磨损小径与土路降低通勤成本；困难地形、重载、恶劣天气和疲劳增加耗时与能耗。
- 额外精力在任务阶段内累计并在完成时一次结算，避免 10× 高频人物事务。
- 新增原始地形热路径和劳动成本浏览器诊断 API。
- 新增 6 项劳动成本专项测试；第 30 日基线更新为 `20b2e6bea8c6f87cde6ee663ffe19ed97dedeb670679a5a7007ca6e4e412461c`。

### v0.27.3 · 工具与耐久

- 新增石斧、搬运篮、简易农具和石镐四件营地公共工具。
- 石斧、搬运篮和农具直接进入劳动成本，影响工作耗时、额外能耗和有效负重。
- 工具占用接入统一 `tool` 预留，同一件工具不能被多个任务同时使用。
- 完成任务扣耐久；取消、死亡、路线失败和孤立任务释放工具且不结算完整任务磨损。
- 工具损坏后退出候选；提供修理与替换机制 API。
- 工具耐久进入长期存档，旧存档恢复默认工具，失败读档恢复工具检查点。
- 营地面板显示耐久与使用状态；新增 8 项工具专项测试，首轮全量测试 `47/47` 通过。
- 第 30 日无工具确定性内核指纹保持 `20b2e6bea8c6f87cde6ee663ffe19ed97dedeb670679a5a7007ca6e4e412461c`。
