# 生灵

《生灵》是一个运行于 GitHub Pages 的规则驱动动态世界模拟游戏。世界先记录客观事实，再由人物传记、史书和未来对话系统解释这些事实。

## 开发交接规则

开发前可按需查阅 [`codex.md`](./codex.md)。**每次完成有效更新后，必须在 `codex.md` 末尾追加版本更新概述；每次影响 Pages 的发布还必须同步更新根目录 `version.json`。**

## 当前阶段：长期稳定性与存档连续性审计完成 v0.27.7

### 当前能力

- 10 位村民，拥有年龄、职业、技能、性格、家庭关系、库存、事实与个人记忆。
- 起始河谷为 160 米 × 120 米，包含河流、林地、石滩、营地和资源物件。
- 村民会取水、采集浆果、砍树、搬运资源、休息、建造、添柴、取暖、睡眠、开垦、播种与收获。
- A* 网格寻路；资源链为“地图 → 人物背包 → 营地库存 → 工地、篝火或生存消耗”。
- 草棚建成后自动规划简易储物棚；储物棚增加容量并提供食物储存保护。
- 世界包含昼夜、天气、篝火、潮湿、受寒、四季、生态恢复、踩踏路径、粟田、扩田和土壤肥力。
- 世界速度支持 **0.5×、1×、2×、5×、10×**。
- 地图支持鼠标与触控操作；桌面端使用地图主视图和右侧观察栏，手机端使用底部观察抽屉。
- 存档支持事务化导入、失败回滚、精确运行时坐标恢复和 `cancel-and-replan` 任务中断策略。
- CI 持续执行普通回归、真实移动 Chromium 烟雾、第 60 日多批次一致性和第 120 日稳定性审计。

## v0.26 确定性模拟内核

- 模拟固定为 **每 tick 推进 1 个世界分钟**，对应 `1/6` 模拟秒。
- 现实帧率和界面刷新不改变世界结算结果。
- 季节、天气、篝火、生态、农田、食物损耗、道路、行动、需求和规划按固定顺序结算。
- `simulation:time` 只承担 UI 时间发布，主要界面最高 **10 FPS**。
- 统一运行时预留账本覆盖任务名额、资源物件、营地容量、工地材料和工具占用。
- 人物、任务、建筑、记忆和日志 ID 使用可重置的世界种子序列生成。

## v0.27 生存经济

### v0.27.1 动态目标库存

营地按人口、季节、天气、腐败、储物保护、燃料和未完成建造计算未来三日安全库存。

```text
有效库存 = 营地现货 + 人物背包 + 在途采集 - 已承诺物资
```

库存目标满足后，非紧急村民不会继续重复取水、采集或伐木；严重饥渴仍保留个人生存例外。

```js
window.shengling.stockTargetSystem.get()
window.shengling.stockTargetSystem.refresh()
```

### v0.27.2 劳动成本模型

采集、搬运、施工、农事和添柴共用统一劳动成本。距离、实际 A* 路线、负重、地形、道路、天气、体力、技能、行动强度和工具共同决定任务预计耗时与额外精力。

```js
task.data.laborCost
window.shengling.laborCostSystem.estimate(personId, task)
window.shengling.laborCostSystem.getRecent(10)
```

额外精力在任务阶段内累计并在完成时一次结算；固定 tick 热路径不会反复深拷贝完整人物、记忆或地图。

### v0.27.3 工具与耐久

| 工具 | 当前用途 | 劳动效果 |
|---|---|---|
| 石斧 | 伐木 | 缩短砍伐时间并降低额外能耗 |
| 搬运篮 | 搬运资源、运送建材 | 降低有效负重、移动与搬运能耗 |
| 简易农具 | 开垦、播种、收获 | 缩短农事耗时并降低能耗 |
| 石镐 | 后续采石接口 | 当前进入工具库但尚无可执行采石任务 |

工具属于营地公共资产，同一件工具不能被两个任务同时占用。任务完成后扣耐久；取消、死亡、路线失败或孤立任务只释放占用。耐久归零后工具退出候选，修理或替换后恢复使用。

```js
window.shengling.toolSystem.list()
window.shengling.toolSystem.getSummary()
window.shengling.toolSystem.getAssignments()
window.shengling.toolSystem.repair(toolId, amount)
window.shengling.toolSystem.replace(toolId)
```

### v0.27.4 统一资源流水

人物背包、营地库存和工具耐久的实际变化进入同一套可追溯流水。每笔记录包含世界时间、物品、数量、单位、来源、去向、类别、原因、人物、任务、预留和元数据。

```text
production / transfer / consumption / fuel
construction / spoilage / wear / repair
```

同一世界 tick 内，属于同一任务或明确搬运链的账户增减会配对为一笔内部转移。独立发生的生产和消费不会相互抵消。

```js
window.shengling.resourceFlowSystem.list({ limit: 20 })
window.shengling.resourceFlowSystem.list({ year: 2, day: 1 })
window.shengling.resourceFlowSystem.getSummary()
window.shengling.resourceFlowSystem.getDailySummary(2, 1)
window.shengling.resourceFlowSystem.verify()
```

流水最多保存最近 5,000 笔。`verify()` 检查重复记录、非法数量、无效流向、负库存和工具耐久越界。

### v0.27.5 每日经济摘要

每日经济摘要以统一资源流水为事实源，并保存当日期初库存快照。日报记录期初和期末库存、生产、消费、燃料、施工、腐败、内部转移、劳动、生存请求拒绝、三日目标库存、模拟错误和账实差异。

```text
预期净变化 = 生产 - 消费 - 燃料 - 施工 - 腐败
账实差异 = 实际期末变化 - 预期净变化
```

```js
window.shengling.dailyEconomySystem.getCurrentReport()
window.shengling.dailyEconomySystem.getReport(year, day)
window.shengling.dailyEconomySystem.listReports({ limit: 7 })
window.shengling.dailyEconomySystem.verify()
```

### v0.27.6 生存经济事实链审计

- 新增任务生命周期账本，统一记录 `active / completed / cancelled / failed`。
- 记录 `carryIn`、`carryOut` 和真正超过预计耗时两倍的 `overdue`；跨午夜任务不再被当成当日积压。
- 延迟一 tick 推断无完成事件的任务中断，避免正常完成被误判取消。
- 两阶段建材运输保持单一任务 ID，分别记录领取与负重送达的路线、耗时和精力。
- 腐败压力按同一种物品计算：`腐败量 /（期初库存 + 当日产出）`。
- 库存缺口严重度按缺口占目标比例计算：`≥50% high`、`20%–50% medium`、其余 `low`。
- 资源流水查询加入年份，避免不同年份的同一日号混合。
- CI 使用真实 Chromium 在 390 × 844 触控视口执行页面烟雾测试。

```js
window.shengling.taskLifecycleSystem.list()
window.shengling.taskLifecycleSystem.getDailySummary(year, day)
window.shengling.taskLifecycleSystem.verify()
```

### v0.27.7 长期稳定性与存档连续性审计

本版把 v0.27 的事实链放入长期运行、状态守恒、失败读档和真实移动端操作中验证，并修复三类长期风险：

- 资源流水任务上下文会在完成、失败、取消、生命周期关闭和读档重规划时统一清理；`verify()` 会拒绝孤立上下文。
- 建材工地预留失效时，人物背包中的材料不再凭空消失；部分交付只扣除实际送达数量。
- 失败读档除恢复长期系统外，也恢复原代理任务、路径游标、工作进度、统一预留、工具分配、运行时日志和诊断状态。
- 同一快照连续读取保持幂等；旧存档缺少工具、流水、日报或行动运行时字段时安全降级。
- 移动 Chromium 烟雾通过系统菜单执行手动保存、推进世界、连续读取两次并验证时间回退与事实链校验。
- Stability Audit 以固定种子推进到第 60 日和第 120 日，每 15 日检查任务、预留、工具、流水、日报、历史报告冻结、内存和吞吐。

第 60 日审计中，batch 1、5、10 得到完全相同的最终状态摘要：

```text
seed: replay-seed-v0277-stability
fixed ticks: 85,200
final state digest: 54bb31536114dbf61630e7b88fcc1d93cb1fd2051c7df7a1ccf5e73858b254c7
```

三个批次均无模拟错误、孤立预留或孤立工具；生命周期、任务上下文、资源流水和每日经济校验全部通过。第 60 日最大观测堆内存约 120 MB，所有 15 日区间吞吐均高于 20 ticks/s 安全下限。

长跑同时暴露出明确的平衡结论：第 45 日后四件公共工具仅剩一件可用，因此 v0.28 首要任务调整为正式维修经济。

## 确定性回归

### 第 30 日世界基线

```text
20b2e6bea8c6f87cde6ee663ffe19ed97dedeb670679a5a7007ca6e4e412461c
```

### 第 60 日生存经济基线

固定种子 `replay-seed-v0275-day60`，从第 1 日 08:00 推进 **85,200 fixed ticks** 到第 60 日 12:00：

```text
68cc6feff5e715fd21d6386e199d7876a11d01d5f87cff31a58014d33cd1584b
```

CI 还会使用 `replay-seed-v0277-stability` 以 1、5、10 三种 tick 批次推进，并要求最终完整世界摘要完全一致。

## 目录

```text
version.json      # GitHub Pages 部署清单与构建标记
.github/workflows # CI 与长期 Stability Audit
scripts/          # 浏览器烟雾、长跑世界装配、报告比较和维护脚本
src/
  core/           # 固定时钟、UI 调度和确定性 ID
  modules/
    people/       # 人物、关系、库存与记忆
    map/          # 地图生成、查询与原始地形服务
    actions/      # 规划、劳动成本、固定 tick 与预留账本
    tools/        # 公共工具、耐久、修理和占用
    economy/      # 资源流水、生命周期、日报和指标审计
    persistence/  # 世界快照、运行时坐标与事务化读档
  bootstrap/      # 浏览器运行时扩展和模块 UI
  ui/map/         # 地图渲染与交互
  styles/         # 桌面与移动端样式
test/             # 单元、集成、守恒、连续性与确定性回归
```

## 运行

```bash
npm ci
npm run check
npm test
npm run test:mobile-smoke
npm run build
npm run dev
```

`test:mobile-smoke` 需要本机安装 Chromium、Google Chrome 或设置 `CHROME_PATH`。长期审计由 `.github/workflows/stability-audit.yml` 在 GitHub Actions 中执行。

## 部署确认

1. 打开 Pages 页面，确认系统菜单中的构建读数显示预期版本和构建编号。
2. 访问 `https://dagasolo138-lgtm.github.io/heping/version.json?cacheBust=任意新数字`。
3. 对比 `buildId` 和 `sourceCommit`。

## 已知限制

- 存档保存在当前浏览器，没有跨设备云存档。
- 成功读档恢复精确位置和长期事实，但不会续接原任务的路径游标、工作耗时或中途动画；未完成任务会取消后重新规划。
- 动态库存、劳动成本和工具耐久参数仍是原型平衡值。
- 长跑显示公共工具会在缺少维修任务时逐步退出生产，因此正式维修经济是 v0.28 第一优先级。
- 石镐已进入工具目录，采石行动和石材资源尚未实现。
- 任务账本已经覆盖劳动任务；休息、睡眠和空闲时间仍未形成完整时间预算。
- 草棚、储物棚和农田尚未成为寻路障碍。
- Chromium 移动烟雾覆盖核心交互；真实 iPhone 的安全区、浏览器地址栏变化和极小屏可读性仍需人工回归。

## 下一阶段

v0.27 生存经济已经完成长期稳定性与存档连续性审计。下一阶段进入 **v0.28 农业与家庭**：先把工具修理和替换升级为真实生产任务，再补齐种子、休耕、堆肥、水分和多作物，最后把公共营地库存逐步拆分为家庭与公共账户。完整顺序见 [ROADMAP.md](./ROADMAP.md)。
