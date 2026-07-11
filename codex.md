# 《生灵》项目交接总览（CODEX）

本文件用于防止项目记忆丢失，并帮助新的对话或开发者快速接手。

**维护规则：** 开发前按需查阅；每次有效开发后在末尾追加版本概述；每次影响 Pages 的发布同步更新根目录 `version.json`；修改已有文件前重新获取最新 SHA。

---

## 当前版本：v0.27.6

《生灵》是部署在 GitHub Pages 的纯前端 ES Module 动态世界模拟游戏。v0.27 生存经济阶段已经完成并经过事实链审计：动态目标库存、劳动成本、工具耐久、统一资源流水、任务生命周期、每日经济摘要、指标口径、第 60 日长期回归和移动 Chromium 烟雾均已落地。

## 不可破坏规则

- 世界事实优先；人物、传记、史书、关系与未来 AI 只读或解释事实。
- 人物不知玩家或游戏存在。
- 主观印象写入 `personal`；行动、建造、睡眠、播种和收获写入 `lifeEvents`。
- AI 只负责表达，不得决定行动或修改世界状态。
- `globalThis.shengling` 是运行时模块挂接点；后挂接模块必须展开当前对象，避免覆盖已有系统。
- 世界结算必须经过固定 tick；UI 事件不得承担世界事实结算。
- 运行时占用进入统一预留账本，并在完成、取消、死亡、路线失败和读档重建时释放。
- **预留账本、任务生命周期和资源流水是三套不同事实：** 预留记录未来承诺；生命周期记录任务状态；流水只记录已经发生的账户增减。
- 同一批物资的来源和去向必须配对成一笔内部转移，不得把搬运重复记成生产与消费。
- 不同人物在同一 tick 独立发生的生产和消费不得因数量相等而互相抵消。
- 工具耐久属于长期世界事实；工具任务占用属于瞬时运行时状态。
- 日报必须以资源流水、生命周期和库存快照为事实源，不能自行创造资源或劳动数字。
- 日报账实差异不能静默忽略；`dailyEconomySystem.verify()` 必须报告。
- 跨午夜任务只记录 `carryIn / carryOut`；只有实际耗时超过预计值两倍才属于 `overdue`。
- 两阶段运输必须保持同一任务 ID，并累计每个阶段自己的成本。
- 腐败率只能在同一物品和同一单位内计算。
- 库存缺口严重度必须按缺口占目标比例计算，不能使用固定绝对数量阈值。
- 资源流水的日查询必须同时考虑年份，避免不同年份的同一日号混合。
- 读档保持事务性：目标快照先验证；失败时恢复长期状态、建筑瞬时预留、工具、流水、生命周期、日报和原行动运行时。
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

预留账本是瞬时状态，不写入长期存档。成功读档重建代理时清空；失败读档保留原行动运行时与账本。

## v0.27 生存经济模块

### 动态目标库存 · v0.27.1

核心：`src/modules/actions/stockTargetModel.js`

```text
目标周期 = 未来 3 个世界日
水目标 = 人口 × 每日饮水 × 3 × 气温倍率
食物目标 = 人口 × 每日食物 × 3 × 季节倍率 × 腐败缓冲
木材目标 = 三日燃料 + 未预留建造需求 + 人口缓冲
有效库存 = 营地现货 + 人物背包 + 在途采集 - 已承诺物资
```

```js
window.shengling.stockTargetSystem.get()
window.shengling.stockTargetSystem.refresh()
```

### 劳动成本 · v0.27.2

核心：`src/modules/actions/laborCostModel.js`

覆盖取水、采集、伐木、搬运、建材运输、施工、开垦、播种、收获和添柴。实际 A* 路线、负重、地形、道路、天气、精力、技能、行动强度和工具共同决定预计耗时与能耗。

```js
window.shengling.laborCostSystem.estimate(personId, task)
window.shengling.laborCostSystem.getRecent(10)
```

### 工具与耐久 · v0.27.3

| 类型 | ID | 最大耐久 | 当前行动 |
|---|---|---:|---|
| 石斧 | `tool-stone-axe-1` | 72 | `chopTree` |
| 搬运篮 | `tool-carrying-basket-1` | 90 | `haulToCamp`、`deliverMaterials` |
| 简易农具 | `tool-simple-farm-tool-1` | 84 | `clearField`、`sowMillet`、`harvestMillet` |
| 石镐 | `tool-stone-pick-1` | 100 | 暂无；为采石保留 |

任务完成扣耐久；取消、死亡和路线失败只释放占用。`systems.tools` 保存耐久、损坏、归属、位置、累计磨损和维修次数；任务占用不进入长期存档。

### 统一资源流水 · v0.27.4 / v0.27.6

核心：

- `src/modules/economy/resourceFlowSystem.js`
- `src/modules/economy/yearAwareResourceFlowView.js`
- `src/bootstrap/attachResourceFlowRuntime.js`

类别：`production / transfer / consumption / fuel / construction / spoilage / wear / repair`。

同 tick 配对条件只能是：

1. 正负变化拥有相同且非空的 `taskId`；或
2. 账户为人物与营地，行动为 `haulToCamp` 或 `deliverMaterials`。

```js
window.shengling.resourceFlowSystem.list({ limit: 20 })
window.shengling.resourceFlowSystem.list({ year: 2, day: 1 })
window.shengling.resourceFlowSystem.getDailySummary(2, 1)
window.shengling.resourceFlowSystem.getDailySummary({ year: 2, day: 1 })
window.shengling.resourceFlowSystem.verify()
```

单参数 `getDailySummary(day)` 继续按当前年份解释。`limit` 必须在年份和日号筛选完成后应用。

### 每日经济摘要 · v0.27.5 / v0.27.6

核心：

- `src/modules/economy/dailyEconomySystem.js`
- `src/modules/economy/taskLifecycleEconomyView.js`
- `src/modules/economy/economicMetricsAuditView.js`
- `src/bootstrap/attachDailyEconomyRuntime.js`

对账：

```text
expectedDelta = production - consumption - fuel - construction - spoilage
actualDelta = closingInventory - openingInventory
discrepancy = actualDelta - expectedDelta
```

v0.27.6 指标：

```text
spoilageRatio(item) = spoilage(item) / (opening(item) + production(item))
stockGapRatio = shortage / target
high >= 50%
medium >= 20%
low < 20%
```

日报新增 `stockGapRatios`、`stockGapMetrics`、`spoilagePressure` 和 `economicMetricsVersion = 2`。

### 任务生命周期 · v0.27.6

核心：

- `src/modules/economy/taskLifecycleSystem.js`
- `src/modules/economy/taskLifecycleStageCostView.js`
- `src/bootstrap/attachTaskLifecycleRuntime.js`

任务状态：`active / completed / cancelled / failed`。

- `actions:assigned` 创建任务记录。
- `actions:stage-transition` 累计阶段成本。
- `actions:completed / cancelled / failed` 关闭任务。
- 无显式关闭事件时，通过 `people:changed` 延迟一 tick 推断。
- `carryIn / carryOut` 表示跨日结转。
- `overdue` 只表示实际耗时超过 `max(30 秒, 预计耗时 × 2)`。
- 关闭时间使用活动真正清空的时间，午夜前中断不会误归入次日。

```js
window.shengling.taskLifecycleSystem.list()
window.shengling.taskLifecycleSystem.get(taskId)
window.shengling.taskLifecycleSystem.getDailySummary(year, day)
window.shengling.taskLifecycleSystem.verify()
```

### 两阶段建材运输 · v0.27.6

`deliverMaterials` 的领取与送达阶段保持同一任务 ID：

```text
collect：人物前往营地并领取材料
→ actions:stage-transition
→ deliver：按真实负重前往工地并交付
```

第二阶段重新读取背包重量、路线、地形、道路、天气、精力、技能和搬运篮。工具预留贯穿全任务，成功后只磨损一次；材料不足和路线阻断只释放占用。

## 存档

- 主世界存档 schema 保持 `1`，应用版本为 `0.27.6`。
- `systems.resourceFlow` 保存资源流水。
- `systems.dailyEconomy` 通过组合视图同时保存日报、任务生命周期和阶段成本。
- 旧存档缺少新增字段时，流水从空账本开始，日报从当前状态建立草稿，生命周期重置并重新规划。
- 失败读档使用各系统的 `createCheckpoint()` / `restoreCheckpoint()` 恢复读取前状态。

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

第 60 日指纹覆盖完整世界状态、60 份日报、流水总计、最近 40 笔流水、劳动、拒绝、瓶颈和账实状态。多倍速一致性测试以 1、5、10 三种批次调用 `advanceTicks()`，最终世界指纹必须相同。

## 移动 Chromium 烟雾

脚本：`scripts/mobileBrowserSmoke.js`

```text
启动 Vite
→ 启动 Runner 自带 Chromium
→ CDP 设置 390 × 844、3× DPR、触控和 iPhone UA
→ 检查横向溢出与运行时挂接
→ 上滑/下滑观察抽屉
→ 切换营地标签并读取工具、流水、日报
→ 切换地图拖动模式
→ 点击 10× 并检查模拟错误
→ 保存截图和状态工件
```

该测试不引入 Playwright、Puppeteer 或额外前端依赖。本机运行需要 Chrome/Chromium 或设置 `CHROME_PATH`。

## CI

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
       ├─ attachTaskLifecycleRuntime.js
       ├─ attachDailyEconomyRuntime.js
       ├─ attachWorldSpeedRuntime.js
       ├─ attachWorldSaveRuntime.js
       ├─ attachMapHudRuntime.js
       ├─ attachObserverUiRuntime.js
       └─ attachBuildInfoRuntime.js
```

流水、生命周期和日报必须在世界存档运行时前完成挂接。

## 关键测试

| 文件 | 职责 |
|---|---|
| `test/taskLifecycleSystem.test.js` | 完成、取消、死亡、跨日、超时与存档。 |
| `test/taskLifecycleEconomyView.test.js` | 日报组合视图和假积压移除。 |
| `test/taskLifecycleStageCostView.test.js` | 阶段成本、跨午夜和去重。 |
| `test/materialDeliveryLifecycle.test.js` | 建材运输阶段、材料不足与路线阻断。 |
| `test/yearAwareResourceFlow.test.js` | 跨年查询、旧接口和筛选后 limit。 |
| `test/economicMetricsAudit.test.js` | 同物品腐败率与比例缺口严重度。 |
| `test/day60Economy.test.js` | 第 60 日经济指纹与多批次一致性。 |
| `scripts/mobileBrowserSmoke.js` | 真实 Chromium 移动端启动和交互烟雾。 |

## 已知限制

1. 存档为浏览器本地 `localStorage`，没有跨设备云存档。
2. 成功读档不续接路径游标、工作耗时或中途动画。
3. 动态库存、劳动成本和工具耐久参数仍需根据第 60 日报告继续校准。
4. 候选评分使用直线成本预估；实际任务使用 A* 路线精确计算。
5. 修理与替换已进入耐久流水，但尚未成为消耗材料和劳动的正式任务。
6. 石镐已进入工具目录，但采石行动和石材资源尚未实现。
7. 生命周期覆盖劳动任务；休息、睡眠和空闲时间尚未形成完整时间预算。
8. 食物分配规则除 `firstComeFirstServed` 外仍以解释和记录为主。
9. 草棚、储物棚和农田尚未成为寻路障碍。
10. 移动 Chromium 已覆盖核心交互；真实 iPhone 的安全区、地址栏变化和极小屏仍需人工回归。

## 下一阶段

v0.28 顺序：

1. **农业闭环：** 种子储备、播种消耗、休耕、堆肥、水分和多作物。
2. **正式维修经济：** 工具修理需要材料、劳动、地点和失败原因。
3. **家庭账户：** 公共库存与家庭库存分化，所有转移继续进入统一流水。

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
- 新增跨午夜、跨年、混合单位、材料不足、路线阻断和存档回归。
- CI 新增真实 Chromium 390 × 844 触控烟雾，并保存截图与状态工件。
- 世界存档应用版本升级到 `0.27.6`，主 schema 继续保持 `1`。
