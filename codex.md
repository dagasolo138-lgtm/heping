# 《生灵》项目交接总览（CODEX）

本文件用于防止项目记忆丢失，并帮助新的对话或开发者快速接手。

**维护规则：** 开发前按需查阅；每次有效开发后追加版本概述；影响 Pages 的发布同步更新根目录 `version.json`；修改已有文件前重新获取最新 SHA。

---

## 当前版本：v0.28.2

《生灵》是部署在 GitHub Pages 的纯前端 ES Module 动态世界模拟游戏。v0.27 已完成确定性模拟、生存经济、状态守恒、存档连续性和移动浏览器审计。v0.28 已建立工具维修需求、真实维修任务、工具代际替换和最低公共工具保障。

## 不可破坏规则

- 世界事实优先；人物、传记、史书、关系与未来 AI 只读或解释事实。
- 人物不知玩家或游戏存在。
- 主观印象写入 `personal`；行动、建造、维修、替换、睡眠、播种和收获写入 `lifeEvents`。
- AI 只负责表达，不得决定行动或修改世界状态。
- `globalThis.shengling` 是运行时模块挂接点；后挂接模块必须展开当前对象，避免覆盖已有系统。
- 世界结算必须经过固定 tick；UI 事件不得承担世界事实结算。
- 运行时占用进入统一预留账本，并在完成、失败、取消、死亡、路线失败和读档重建时释放。
- **预留、生命周期、流水是三套事实：** 预留记录未来承诺；生命周期记录任务状态；流水只记录已经发生的账户变化。
- 同一批物资的来源和去向必须配对成一笔内部转移；独立生产与消费不得因同 tick、同数量而错误抵消。
- 工具耐久、代际、维修次数、当代磨损和维护需求属于长期事实。
- 工具使用、维修/替换任务、目标工具占用和材料占用属于瞬时运行时事实。
- 维修与替换必须同时预留目标工具和材料；目标工具不能在维护期间参与生产。
- 维护失败不能吞材料、改变工具、推进代际或清除需求。
- 维修与替换材料、耐久变化必须从真实系统变更事件进入流水，禁止手写重复流水。
- 替换必须在成功扣除全部材料后一次性推进代际；部分替换不允许存在。
- 最低公共工具保障必须可验证：有缺口时至少存在对应恢复需求，并通过目标库存引导补料。
- 日报必须以资源流水、生命周期和库存快照为事实源；账实差异不得静默忽略。
- 跨午夜任务只记录 `carryIn / carryOut`；实际耗时超过 `max(30 秒, 预计耗时 × 2)` 才属于 `overdue`。
- 两阶段运输必须保持同一任务 ID，并累计每个阶段成本。
- 建材交接失败不能扣人物尚未交付的背包材料；部分交接只扣实际送达量。
- 腐败率只能在同一物品和同一单位内计算。
- 库存缺口严重度按缺口占目标比例计算。
- 资源流水日查询同时考虑年份，避免跨年同日号混合。
- 资源流水任务上下文必须在完成、失败、取消、生命周期关闭和读档重规划时清理。
- 读档保持事务性：目标快照先验证；失败时恢复长期状态、建筑预留、工具、维护运行时、流水、生命周期、日报和原行动运行时。
- 成功读档采用 `cancel-and-replan`：恢复坐标与长期事实，取消未完成任务后重新规划。
- 动态库存区分现货、人物背包、在途资源与已承诺资源；未启动维护材料属于需求，已预留材料属于承诺。
- 劳动成本只影响规则驱动选择、移动、耗时与精力，不得依赖 UI 帧率或 AI 输出。
- 高频固定 tick 热路径不得反复深拷贝完整人物、记忆或地图。
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
- 主界面和扩展读数最高 10 FPS 合并刷新。

## 统一预留账本

`src/modules/actions/reservationLedger.js` 记录：

- `task-slot`：行动并发名额。
- `feature`：树木、浆果等资源目标。
- `camp-storage`：搬运任务占用营地容量。
- `building-material`：工地材料预留。
- `camp-item`：维修与替换材料承诺，键为 `${campId}:${itemId}`。
- `tool`：公共工具占用，生产使用和维护目标共用容量 1。

预留不写入长期存档。成功读档清空并重规划；失败读档通过行动系统和维护运行时检查点恢复。

## 动态目标库存

核心：

- `src/modules/actions/stockTargetModel.js`
- `src/modules/actions/actionPlanner.js`

```text
目标周期 = 未来 3 日
水目标 = 人口 × 每日饮水 × 3 × 气温倍率
食物目标 = 人口 × 每日食物 × 3 × 季节倍率 × 腐败缓冲
木材目标 = 三日燃料 + 建造需求 + 维修/替换需求 + 人口缓冲
有效库存 = 营地现货 + 人物背包 + 在途采集 - 已承诺物资
```

维修或替换未启动时，配方材料进入 `constructionNeed`；维护任务已经预留后转入 `committed`。维修与替换活动类型都必须被识别，不能只识别 `repairTool`。

## 劳动成本

核心：`src/modules/actions/laborCostModel.js`。

覆盖取水、采集、伐木、搬运、建材运输、施工、维修、替换、开垦、播种、收获和添柴。实际 A* 路线、负重、地形、道路、天气、精力、技能、行动强度和工具决定耗时与能耗。

维修和替换使用配方声明技能，维护目标工具本身不提供劳动加成。

## 工具、代际与维护需求

核心：

- `src/modules/tools/toolCatalog.js`
- `src/modules/tools/toolMaintenanceModel.js`
- `src/modules/tools/toolSystem.js`
- `src/bootstrap/attachToolRuntime.js`

| 类型 | ID | 最大耐久 | 生产行动 | 最低保障 |
|---|---|---:|---|---:|
| 石斧 | `tool-stone-axe-1` | 72 | `chopTree` | 1 |
| 搬运篮 | `tool-carrying-basket-1` | 90 | `haulToCamp`、`deliverMaterials` | 1 |
| 简易农具 | `tool-simple-farm-tool-1` | 84 | `clearField`、`sowMillet`、`harvestMillet` | 1 |
| 石镐 | `tool-stone-pick-1` | 100 | 暂无 | 0 |

工具状态：

```text
healthy → worn → critical → broken
```

工具 schema v3：

```text
generation
repairedCount
repairsSinceReplacement
replacedCount
totalWear
wearSinceReplacement
```

维护需求 schema v2：

```text
state: none / requested / urgent
mode: repair / replace
```

需求 ID：

```text
repair  → tool-maintenance:<toolId>
replace → tool-replacement:<toolId>
```

替换触发：

- `repairsSinceReplacement >= 2` 后再次进入磨损区间。
- `wearSinceReplacement >= maxDurability × 2.5`。

替换成功：

```text
durability = maxDurability
generation += 1
replacedCount += 1
repairsSinceReplacement = 0
wearSinceReplacement = 0
```

v1/v2 工具存档迁移到 v3 时，本代维修和磨损计数从 0 开始，避免旧世界凭空生成替换需求。

```js
window.shengling.toolSystem.list()
window.shengling.toolSystem.getSummary()
window.shengling.toolSystem.getCoverage()
window.shengling.toolSystem.listMaintenanceDemands()
window.shengling.toolSystem.getMaintenanceDemand(toolId)
window.shengling.toolSystem.verifyMaintenance()
```

## 真实维修与替换任务

核心：

- `src/modules/actions/toolMaintenancePlanner.js`
- `src/modules/actions/toolMaintenanceRuntime.js`
- `src/modules/actions/toolMaintenanceEffects.js`
- `src/bootstrap/attachToolMaintenanceRuntime.js`

事实链：

```text
工具磨损
→ synchronizeMaintenance 生成 repair 或 replace 需求
→ 检查材料、目标工具、并发名额
→ 创建 repairTool 或 replaceTool
→ 预留目标工具与 camp-item 材料
→ 人物前往营地并投入劳动
→ 完成前校验需求模式、工具代际、地点、预留和库存
→ 原子扣料
→ repair 恢复目标耐久 / replace 推进下一代
→ 生命周期、人物事实、资源流水和日报
```

规划顺序：

1. 紧急饥渴与极低精力。
2. 最低公共工具保障缺口。
3. 紧急替换或维修。
4. 普通维修与普通生产候选。

约束：

- `repairTool + replaceTool` 合计最多并发一个。
- 材料不足或目标工具已占用时不创建维护任务。
- 执行期间材料被移走时整单失败。
- 任务保存工具 `generation`；代际变化后旧任务必须失败为 `maintenance-generation-stale`。
- 需求模式改变时旧任务必须失败为 `maintenance-demand-stale` 或 `maintenance-mode-mismatch`。
- 失败不能改变工具、代际或既有库存。

```js
window.shengling.toolMaintenanceRuntime.listReservations()
window.shengling.toolMaintenanceRuntime.listFailures()
window.shengling.toolMaintenanceRuntime.verify()
```

## 维护配方

| 工具 | repair 材料 / 工时 | replace 材料 / 工时 | 技能 |
|---|---|---|---|
| 石斧 | 木料 1 / 90 分钟 | 木料 3 / 180 分钟 | 建造 |
| 搬运篮 | 木料 1 / 70 分钟 | 木料 2 / 150 分钟 | 采集 |
| 简易农具 | 木料 1 / 100 分钟 | 木料 3 / 210 分钟 | 建造 |
| 石镐 | 木料 1 / 110 分钟 | 木料 3 / 220 分钟 | 建造 |

当前世界尚无正式石材、纤维和零部件库存，配方仍使用木料原型。

## 统一资源流水

核心：

- `src/modules/economy/resourceFlowSystem.js`
- `src/modules/economy/yearAwareResourceFlowView.js`
- `src/modules/economy/resourceFlowTaskContextGuard.js`
- `src/modules/economy/toolMaintenanceResourceFlowView.js`
- `src/bootstrap/attachResourceFlowRuntime.js`

类别：

```text
production / transfer / consumption / fuel
construction / spoilage / wear / repair / replacement
```

任务化维护原因格式：

```text
tool:maintenance:<mode>:<taskId>:<toolId>:<personId>
tool:maintenance-completed:<mode>:<taskId>:<toolId>:<personId>
```

维护流水视图补齐：

- `taskId`
- `personId`
- `toolId`
- `maintenanceMode`
- `actionType = repairTool | replaceTool`
- `category = repair | replacement`

旧 v0.28.1 原因格式仍按 `repair` 兼容。直接管理 API 产生的合法修理流水可以没有任务上下文；只有带 `maintenanceMode` 的任务化记录必须通过上下文校验。

## 每日经济

核心：

- `src/modules/economy/dailyEconomySystem.js`
- `src/modules/economy/taskLifecycleEconomyView.js`
- `src/modules/economy/economicMetricsAuditView.js`

```text
expectedDelta
= production
- consumption
- fuel
- construction
- repair
- replacement
- spoilage

actualDelta = closingInventory - openingInventory
discrepancy = actualDelta - expectedDelta
```

未发生维修或替换时，不写入零值 `balance.repair` / `balance.replacement`，避免破坏旧确定性基线。

## 任务生命周期

任务状态：`active / completed / cancelled / failed`。

- 维修记录类型为 `record.type = 'repairTool'`。
- 替换记录类型为 `record.type = 'replaceTool'`。
- 不使用不存在的 `record.actionType`。

## 长期稳定性审计

核心：

- `.github/workflows/stability-audit.yml`
- `scripts/longRunAuditWorld.js`
- `scripts/runLongRunAudit.js`
- `scripts/compareStabilityReports.js`
- `test/worldStateConservation.test.js`
- `test/toolMaintenanceWorld.test.js`
- `test/toolMaintenanceSaveRollback.test.js`
- `test/toolReplacementTask.test.js`
- `test/toolReplacementSaveRollback.test.js`

固定种子：`replay-seed-v0277-stability`。

范围：

- 第 60 日：batch 1、5、10，各 85,200 ticks。
- 第 120 日：batch 10，171,600 ticks。
- 每 15 日检查模拟错误、任务、预留、工具、代际、维护需求、维护运行时、公共保障、流水上下文、日报、历史报告冻结、内存和吞吐。
- 维修与替换活动合计不得超过一个。
- 每个保障缺口必须存在 `guaranteeGap` 恢复需求。
- `generation >= 1`；本代维修与磨损不得为负；本代磨损不得超过总磨损。
- 所有维护预留必须指向真实活动任务。
- 最低吞吐 20 ticks/s；最大堆内存约 1.25 GiB。

## 存档

- 主世界存档 schema 保持 `1`，应用版本为 `0.28.2`。
- 工具子系统 schema 为 `3`，兼容 v1/v2。
- 维护需求 schema 为 `2`。
- `systems.resourceFlow` 保存流水。
- `systems.dailyEconomy` 组合保存日报、生命周期和阶段成本。
- 成功读档清理未完成维修/替换任务和瞬时预留后重新规划。
- 失败读档恢复建筑、工具、流水、日报、行动运行时和维护运行时检查点。
- 维护运行时检查点保存任务模式、行动类型、目标代际、工具与材料预留及失败状态。

## 确定性基线

### 第 30 日

```text
seed: replay-seed-v026
fixed ticks: 42,000
SHA-256: 20b2e6bea8c6f87cde6ee663ffe19ed97dedeb670679a5a7007ca6e4e412461c
```

### 第 60 日旧生存经济

```text
seed: replay-seed-v0275-day60
fixed ticks: 85,200
SHA-256: 68cc6feff5e715fd21d6386e199d7876a11d01d5f87cff31a58014d33cd1584b
```

旧回放世界不挂接完整维护运行时，v0.28.2 仍应保持两个历史指纹不变。

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

维护运行时必须在工具系统之后、资源流水和世界存档之前挂接。

## 关键测试

| 文件 | 职责 |
|---|---|
| `test/toolSystem.test.js` | 工具耐久、代际、需求、迁移、修理、替换与保障。 |
| `test/toolMaintenanceTask.test.js` | 维修成功、材料短缺、工具冲突与 repair 流水。 |
| `test/toolReplacementTask.test.js` | 替换成功、材料短缺、并发、保障与 replacement 流水。 |
| `test/toolMaintenanceWorld.test.js` | 世界自动规划到真实维修完成。 |
| `test/toolMaintenanceSaveRollback.test.js` | 活动维修任务失败读档回滚。 |
| `test/toolReplacementSaveRollback.test.js` | 活动替换任务、代际和预留失败读档回滚。 |
| `test/worldStateConservation.test.js` | 任务、预留、工具、代际、保障、库存和食物批次守恒。 |
| `test/day60Economy.test.js` | 第 60 日旧经济指纹与多批次一致性。 |
| `scripts/mobileBrowserSmoke.js` | 真实 Chromium 启动、保存、连续读档与核心交互。 |

## 已知限制

1. 存档为浏览器本地 `localStorage`，没有跨设备云存档。
2. 成功读档不续接路径游标、工作耗时或中途动画。
3. 维修与替换配方只使用木料；石材、纤维和零部件产业尚未建立。
4. 最低保障保护现有工具记录；工具记录被删除后的新 ID 制造尚未实现。
5. 候选评分使用直线成本预估，实际任务使用 A* 路线精算。
6. 石镐已进入维护体系，但采石行动与石材资源尚未实现。
7. 生命周期覆盖劳动任务；休息、睡眠和空闲时间尚未形成完整时间预算。
8. 食物分配规则除 `firstComeFirstServed` 外仍以解释和记录为主。
9. 草棚、储物棚和农田尚未成为寻路障碍。
10. 自动移动 Chromium 覆盖核心交互；真实 iPhone 安全区与浏览器外壳仍需人工回归。

## 下一阶段

1. **v0.28.2 封版：** 普通 CI、第 60 日三批次与第 120 日替换经济长跑全部通过。
2. **种子事实链：** 种子储备、播种消耗、失败和收获返种。
3. **农业闭环：** 休耕、堆肥、水分和多作物。
4. **家庭账户：** 公共与家庭库存分化，全部转移继续进入统一流水。

## 版本更新记录

- `v0.1—v0.24`：人物、地图、行动、环境、农业、关系、史书、存档和观察器基础。
- `v0.25`：地图优先观察器、事务化读档、移动抽屉和精确坐标恢复。
- `v0.26.0`：固定 tick、UI 限频、统一预留、确定性 ID 和第 30 日回放。
- `v0.27.1`：未来三日动态目标库存。
- `v0.27.2`：距离、负重、地形、天气、体力、技能和工具劳动成本。
- `v0.27.3`：公共工具与耐久。
- `v0.27.4`：统一资源流水。
- `v0.27.5`：每日经济摘要与第 60 日回归。
- `v0.27.6`：任务生命周期、两阶段建材运输和指标口径审计。
- `v0.27.7`：第 60/120 日长跑、世界守恒和存档连续性。
- `v0.28.0`：维修需求与状态模型，工具 schema v2。
- `v0.28.1`：真实维修任务、材料预留、repair 流水、日报与失败读档闭环。

### v0.28.2 · 工具替换与最低公共保障

- 工具 schema 升级到 `3`，增加代际、本代维修和本代磨损。
- 维护需求 schema 升级到 `2`，区分 `repair / replace`。
- 新增 `replaceTool` 真实任务、材料/目标工具预留、代际校验和原子结算。
- 替换进入独立 `replacement` 流水与日报对账。
- 石斧、搬运篮和简易农具建立最低公共保障。
- 未启动替换材料进入目标库存缺口，已预留材料进入承诺。
- v1/v2 工具存档可迁移且不会凭空生成替换。
- 新增替换闭环、材料短缺、保障、守恒和失败读档测试。
- 世界存档应用版本升级到 `0.28.2`，主 schema 保持 `1`。
