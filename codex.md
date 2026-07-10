# 《生灵》项目交接总览（CODEX）

本文件用于防止项目记忆丢失，并帮助新的对话或开发者快速接手。

**维护规则：** 开发前按需查阅；每次有效开发后在末尾追加版本概述；每次影响 Pages 的发布同步更新根目录 `version.json`；修改已有文件前重新获取最新 SHA。

---

## 当前版本：v0.27.1

《生灵》是部署在 GitHub Pages 的纯前端 ES Module 动态世界模拟游戏。当前处于 v0.27 生存经济阶段，第一步“动态目标库存”已完成。

## 不可破坏规则

- 世界事实优先；人物、传记、史书、关系与未来 AI 只读或解释事实。
- 人物不知玩家或游戏存在。
- 主观印象写入 `personal`；行动、建造、睡眠、播种和收获写入 `lifeEvents`。
- AI 只负责表达，不得决定行动或修改世界状态。
- `globalThis.shengling` 是运行时模块挂接点；后挂接模块必须展开当前对象，避免覆盖已有系统。
- 世界结算必须经过固定 tick；UI 事件不得承担世界事实结算。
- 运行时占用必须进入统一预留账本，并在完成、取消、死亡、路线失败和读档重建时释放。
- 读档保持事务性：目标快照先验证；失败时恢复长期状态、建筑瞬时预留和原行动运行时。
- 成功读档采用 `cancel-and-replan`：恢复实时坐标和长期事实，取消未完成任务后重新规划。
- 动态库存必须区分现货、人物背包、在途资源和已经承诺的资源，不能重复计算同一批物资。
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

运行时 API：

```js
window.shengling.reservationLedger.list()
window.shengling.reservationLedger.getSummary()
window.shengling.actionSystem.getDiagnostics().reservations
```

账本是瞬时运行时状态，不写入长期存档。成功读档重建代理时清空；失败读档保留原行动运行时与账本。

## v0.27.1 动态目标库存

### 目标模型

模块：`src/modules/actions/stockTargetModel.js`

```text
目标周期 = 未来 3 个世界日
水目标 = 人口 × 每日饮水 × 3 × 气温倍率
食物目标 = 人口 × 每日食物 × 3 × 季节倍率 × 腐败缓冲
木材目标 = 三日燃料 + 未预留建造需求 + 人口缓冲
```

当前原型参数：

- 每人每日水：`0.9` 单位。
- 每人每日食物：`0.72` 单位。
- 冬季食物倍率：`1.3`；冬季木材倍率：`1.75`。
- 食物腐败缓冲读取天气风险与储存保护。
- 木材读取夜间燃料、恶劣天气燃料和工地未预留需求。

### 容量约束

- 目标库存最多使用当前储存容量的 92%，保留操作余量。
- 初始 24 容量的自然目标会按比例压缩到 22 单位预算。
- 储物棚建成后容量扩大，目标自动恢复完整三日需求。
- 非目标物资会先占用预算，避免目标总和超过真实可用空间。

### 有效库存

```text
有效库存 = 营地现货 + 人物背包 + 在途采集 - 已承诺物资
```

- 人物背包按全体存活人物汇总。
- 在途资源按已分配取水、浆果采集和伐木任务估算。
- 同一规划轮中新分配的任务会立刻增加 `actionCounts`，后续人物看到更新后的在途量。
- 工地材料预留和添柴任务计入承诺量。
- `buildingSystem.getMaterialNeed()` 已扣除已交付与已预留材料，因此未预留建造需求不会和工地承诺重复。

### 行动规则

- 动态库存缺口进入 utility scorer 的 `campScarcity` 因素。
- 缺口为零时，非紧急人物不再创建取水、采集浆果或伐木任务。
- 个人严重口渴或饥饿仍允许触发紧急取水/采集，避免聚落库存目标压过个体生存。
- 任务 `data.stockTarget` 记录资源种类、目标、有效库存、缺口、周期和容量约束，便于人物面板解释。

### 浏览器运行时

模块：`src/bootstrap/attachStockTargetRuntime.js`

```js
window.shengling.stockTargetSystem.get()
window.shengling.stockTargetSystem.refresh()
```

营地面板显示：

```text
三日目标 · 水 有效/目标 · 食物 有效/目标 · 木材 有效/目标
```

读数中的有效库存已经包含背包和在途资源，并扣除承诺量。

## 第 30 日确定性基线

固定种子与目标时刻：

```text
replay-seed-v026
生灵历 1 年第 30 日 12:00
42,000 fixed ticks
```

v0.27.1 SHA-256 世界指纹：

```text
c170c6ced37c5c3629112087d57dbb18ec29a8b01bce967c0c20b53716aeaa37
```

指纹覆盖人物状态与坐标、库存、关系计数、建筑、篝火、农田、生态、道路、食物储存、社会事件、史书、地图物件、运行时预留和近期日志。

CI 流程：

```text
npm ci
npm run check
npm test
第 30 日指纹提取与工件上传
npm run build
```

测试失败时仍提取和上传指纹，便于区分预期世界变化与真实逻辑错误。

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
| `src/modules/actions/scarcityUtility.js` | 将动态缺口转换为行动稀缺度。 |
| `src/modules/actions/utilityScorer.js` | 将个人需求、动态库存、技能、距离和社会因素合并评分。 |
| `src/bootstrap/attachStockTargetRuntime.js` | 营地读数与浏览器调试 API。 |
| `src/modules/actions/reservationLedger.js` | 统一任务和资源预留账本。 |
| `src/modules/people/peopleSystem.js` | 完整人物状态与轻量运行时视图。 |
| `src/modules/persistence/worldSaveSystem.js` | 世界快照、事务化导入、失败回滚和运行时恢复。 |
| `test/dynamicStockTargets.test.js` | 动态目标、季节/天气、有效库存、在途与停止过采测试。 |
| `test/deterministicKernel.test.js` | 固定步长、UI 调度、账本和第 30 日指纹。 |

## 已知限制

1. 存档为浏览器本地 `localStorage`，没有跨设备云存档。
2. 成功读档不续接路径游标、工作耗时或中途动画。
3. 在途采集量当前按行动类型的标准产量估算，尚未读取每个运行中任务的精确产量。
4. 动态库存参数仍是原型值，需要第 60 日回归和长期平衡校准。
5. 统一预留账本尚未形成完整资源流水与每日收支报表。
6. 食物分配规则除 `firstComeFirstServed` 外仍以解释和记录为主。
7. 草棚、储物棚和农田尚未成为寻路障碍。
8. 真实 iPhone 安全区、浏览器地址栏变化和极小屏仍需人工回归。

## v0.27 剩余顺序

1. **劳动成本模型：** 距离、负重、地形、天气、道路、体力与技能共同决定净收益。
2. **工具与耐久：** 石斧、搬运篮、简单农具、石镐及工具预留。
3. **资源流水：** 采集、搬运、施工、进食、饮水、添柴、腐败与农业统一记账。
4. **日报与第 60 日回归：** 日收支、瓶颈、资源守恒与多倍速一致性。

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
