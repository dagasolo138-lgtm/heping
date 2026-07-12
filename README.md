# 生灵

《生灵》是一个运行于 GitHub Pages 的规则驱动动态世界模拟游戏。世界先记录客观事实，再由人物传记、史书和未来对话系统解释这些事实。

## 开发交接规则

开发前可按需查阅 [`codex.md`](./codex.md)。每次完成有效更新后，必须在 `codex.md` 末尾追加版本更新概述；每次影响 Pages 的发布还必须同步更新根目录 `version.json`。

## 当前版本：v0.28.2

当前阶段已完成公共工具的耐久、维修、替换和最低保障闭环。村民会为磨损工具安排维修；同一代工具反复维修后会进入真实替换生产；关键工具退出生产时，恢复任务会被提升为最高优先级。

### 当前能力

- 10 位村民，拥有年龄、职业、技能、性格、家庭关系、库存、事实与个人记忆。
- 160 米 × 120 米起始河谷，包含河流、林地、石滩、营地和可耗竭资源。
- 村民会取水、采集、砍树、搬运、建造、维修工具、替换工具、添柴、取暖、睡眠、开垦、播种与收获。
- A* 网格寻路；资源链为“地图 → 人物背包 → 营地库存 → 工地、工具维护、篝火或生存消耗”。
- 昼夜、天气、四季、篝火、潮湿、受寒、生态恢复、踩踏道路、粟田、扩田和土壤肥力均由固定 tick 推进。
- 世界速度支持 **0.5×、1×、2×、5×、10×**。
- 桌面端使用地图主视图和右侧观察栏；手机端使用底部观察抽屉。
- 存档支持事务化导入、失败回滚、精确坐标恢复和成功读档后的 `cancel-and-replan`。
- CI 持续执行普通回归、真实移动 Chromium、第 60 日多批次一致性和第 120 日稳定性审计。

## 确定性模拟内核

```text
1 tick = 1 世界分钟 = 1 / 6 模拟秒
```

现实帧率只决定何时消费固定 tick，不改变世界结算结果。季节、环境、生态、农田、食物、道路、行动、需求和规划按固定顺序执行；主要 UI 最高 10 FPS。

统一运行时预留账本覆盖：

```text
task-slot / feature / camp-storage / building-material
tool / camp-item
```

任务完成、失败、取消、人物死亡、路线失败和读档重建都会释放对应预留。

## v0.27 生存经济

### 动态目标库存

营地按人口、季节、天气、腐败、储存保护、燃料、建造和工具维护计算未来三日安全库存。

```text
有效库存 = 营地现货 + 人物背包 + 在途采集 - 已承诺物资
```

维修或替换尚未启动时，所需材料进入未来缺口；任务已经预留材料后，需求转入已承诺物资。

```js
window.shengling.stockTargetSystem.get()
window.shengling.stockTargetSystem.refresh()
```

### 劳动成本

采集、搬运、施工、维修、替换、农事和添柴共用劳动成本模型。实际路线、负重、地形、道路、天气、精力、技能、行动强度和工具共同决定预计耗时与额外能耗。

```js
task.data.laborCost
window.shengling.laborCostSystem.estimate(personId, task)
window.shengling.laborCostSystem.getRecent(10)
```

### 统一资源流水

人物背包、营地库存和工具耐久的实际变化进入同一事实源：

```text
production / transfer / consumption / fuel
construction / spoilage / wear / repair / replacement
```

每笔流水包含世界时间、物品、数量、单位、来源、去向、类别、原因、人物、任务、预留和元数据。任务化维修与替换必须带有 `taskId / personId / toolId / maintenanceMode`；管理用途的直接修理 API 可以没有任务上下文。

```js
window.shengling.resourceFlowSystem.list({ limit: 20 })
window.shengling.resourceFlowSystem.list({ category: 'repair' })
window.shengling.resourceFlowSystem.list({ category: 'replacement' })
window.shengling.resourceFlowSystem.getDailySummary(2, 1)
window.shengling.resourceFlowSystem.verify()
```

### 每日经济摘要

```text
预期净变化
= 生产
- 消费
- 燃料
- 施工
- 维修
- 替换
- 腐败

账实差异 = 实际期末变化 - 预期净变化
```

日报同时记录劳动、任务生命周期、生存请求拒绝、三日目标库存、腐败压力、瓶颈和模拟错误。

```js
window.shengling.dailyEconomySystem.getCurrentReport()
window.shengling.dailyEconomySystem.getReport(year, day)
window.shengling.dailyEconomySystem.verify()
```

### 任务生命周期

任务统一记录 `active / completed / cancelled / failed`，并支持阶段成本、跨日结转和真实超时判定。

```js
window.shengling.taskLifecycleSystem.list()
window.shengling.taskLifecycleSystem.getDailySummary(year, day)
window.shengling.taskLifecycleSystem.verify()
```

## v0.28 工具维护经济

### v0.28.0 维修需求事实层

- 工具状态：`healthy / worn / critical / broken`。
- 维修需求保存目标耐久、材料、工时、技能、请求时间、原因和优先级。
- 工具 schema v2 可读取旧 v1 工具存档。

### v0.28.1 真实维修任务

```text
工具磨损
→ 生成 repair 需求
→ 预留目标工具与营地材料
→ 村民前往营地并投入劳动
→ 扣除材料、恢复耐久
→ 写入生命周期、人物事实、repair 流水与日报
```

材料在执行期间被移走时整单失败，不重复扣料、不改变工具，维修需求继续保留。失败读档会精确恢复活动维修任务、行动代理、工具预留和材料预留。

### v0.28.2 工具替换与最低公共保障

工具 schema 升级到 v3：

```text
generation
repairsSinceReplacement
wearSinceReplacement
```

维护需求 schema 升级到 v2，并区分：

```text
repair  = 恢复当前一代工具
replace = 消耗更多材料与劳动，制作下一代工具
```

当前替换规则：

- 同一代工具完成两次维修后，再次进入磨损区间会生成替换需求。
- 当代累计磨损达到最大耐久的 2.5 倍时，也会进入替换。
- 替换完成后耐久恢复至满值、`generation + 1`，并清零当代维修与磨损计数。
- 维修和替换共用一个并发名额，避免公共维护吞噬全部劳动力。
- 石斧、搬运篮、简易农具最低保障均为一件可用工具。
- 关键工具损坏时，恢复任务获得最高优先级；材料不足会反向形成木材库存缺口，引导村民先补材料。

| 工具 | 普通维修 | 正式替换 | 最低公共保障 |
|---|---|---|---:|
| 石斧 | 木料 1 / 90 分钟 | 木料 3 / 180 分钟 | 1 |
| 搬运篮 | 木料 1 / 70 分钟 | 木料 2 / 150 分钟 | 1 |
| 简易农具 | 木料 1 / 100 分钟 | 木料 3 / 210 分钟 | 1 |
| 石镐 | 木料 1 / 110 分钟 | 木料 3 / 220 分钟 | 暂不强制 |

```js
window.shengling.toolSystem.list()
window.shengling.toolSystem.getSummary()
window.shengling.toolSystem.getCoverage()
window.shengling.toolSystem.listMaintenanceDemands()
window.shengling.toolSystem.verifyMaintenance()
window.shengling.toolMaintenanceRuntime.listReservations()
window.shengling.toolMaintenanceRuntime.verify()
```

## 确定性回归

### 第 30 日世界基线

```text
20b2e6bea8c6f87cde6ee663ffe19ed97dedeb670679a5a7007ca6e4e412461c
```

### 第 60 日生存经济基线

```text
68cc6feff5e715fd21d6386e199d7876a11d01d5f87cff31a58014d33cd1584b
```

Stability Audit 还会使用维修经济世界分别以 batch 1、5、10 推进到第 60 日，要求最终摘要完全一致，并以 batch 10 推进到第 120 日。

## 运行

```bash
npm ci
npm run check
npm test
npm run test:mobile-smoke
npm run build
npm run dev
```

`test:mobile-smoke` 需要本机安装 Chromium、Google Chrome 或设置 `CHROME_PATH`。

## 部署确认

1. 打开 Pages 页面，检查系统菜单中的版本和构建编号。
2. 访问 `https://dagasolo138-lgtm.github.io/heping/version.json?cacheBust=任意新数字`。
3. 对比 `buildId` 与 `sourceCommit`。

## 已知限制

- 存档保存在当前浏览器，没有跨设备云存档。
- 成功读档不续接任务路径游标、工作耗时或中途动画；未完成任务会取消后重新规划。
- 维修与替换配方目前只使用既有木料；石材、纤维和零部件产业尚未形成。
- 石镐已经进入维护体系，但采石行动和石材资源尚未实现。
- 最低保障保护已有公共工具记录；尚未实现“工具记录被删除后凭空补建新 ID”。
- 休息、睡眠和空闲时间还没有形成完整时间预算。
- 草棚、储物棚和农田尚未成为寻路障碍。
- 自动移动 Chromium 覆盖核心交互；真实 iPhone 安全区和浏览器外壳仍需人工回归。

## 下一阶段

工具维修经济在 v0.28.2 收口后，下一阶段进入农业闭环：种子储备与播种消耗、休耕、堆肥、水分和多作物。完整顺序见 [ROADMAP.md](./ROADMAP.md)。
