# 《生灵》项目交接总览（CODEX）

本文件用于防止项目记忆丢失，并帮助新的对话或开发者快速接手。

**维护规则：** 开发前可按需查阅本文件；每次完成有效更新后，必须在本文末尾“版本更新记录”中追加一条概述。不要删除既有版本记录。

---

## 1. 项目定位

《生灵》是一个纯前端、无打包器、部署在 GitHub Pages 的动态世界模拟游戏。

核心规则：

- 世界先产生并保存客观事实。
- 人物、未来传记、史书、关系、AI 对话只能读取或解释事实，不能直接篡改世界。
- 人物不知道玩家或游戏存在。
- 相遇、印象、好奇属于人物 `personal` 记忆。
- 人物行动、建造、睡眠、收获等客观结果写入 `lifeEvents`。
- `globalThis.shengling` 与 `globalThis.__shenglingEventBus` 是当前独立运行时模块的扩展机制；重构时必须谨慎。

## 2. 当前版本：v0.13

当前完成：

1. 十位初始村民，包含年龄、职业、技能、家庭关系、库存、状态、`lifeEvents` 与 `personal`。
2. 起始河谷：160 × 120 格；1 格 = 1 米；一年固定 360 天。
3. 自主行动：取水、采浆果、砍树、搬运、休息、建造、睡眠、添柴、取暖、开垦农田、播种、收获。
4. 建筑链：草棚 → 储物棚；草棚提供住处，储物棚提供 72 容量与 `protection = 0.6`。
5. 昼夜、天气、降雨、冷雨、篝火、潮湿、受寒。
6. 树木 3 个世界日恢复，浆果 1 个世界日恢复。
7. 人物经过同一格 4 次形成踩踏路径，10 次形成土路；土路移动速度 ×1.16。
8. 第一块粟田：6×4 格，开垦 8 工作量，初始粟种 2，播种消耗 1，1440 有效世界分钟成熟，收获 8 粟米并返还 2 粟种。
9. 食物批次与储存损耗：浆果、粟米按批次保存；每 30 个世界分钟结算损耗；储物棚降低损耗。
10. 四季：春 1–90 日、夏 91–180 日、秋 181–270 日、冬 271–360 日；温度趋势依次为 +2℃、+7℃、-1℃、-8℃。
11. 粟米季节规则：春季可播种、成长 ×1.00；夏季禁止播种、成长 ×1.25；秋季禁止播种、成长 ×0.62；冬季禁止播种、成长 ×0；成熟作物全年可收获。
12. 第二块人工扩田：第一块粟田完成首次收获后，系统在营地周边自动选择可用草地，规划 `第二块粟田`；开垦需要 10 工作量；之后复用现有播种、生长、收获、搬运和储存链路。
13. 页面和地图显示天气、季节、农事、扩田、生态、路径与食物保存读数。
14. GitHub Pages 的预期检查命令为：`find src -type f -name '*.js' -print0 | xargs -0 -n 1 node --check`。

## 3. 启动与运行链

```text
index.html
  └─ src/app.js
       ├─ src/app-v4.js
       │    ├─ EventBus / GameTime
       │    ├─ PeopleSystem / MapSystem
       │    ├─ CampStore / BuildingSystem
       │    ├─ WeatherSystem / FireSystem
       │    ├─ ActionSystem / MapView / 页面 UI
       │    └─ actionSystem.start()
       ├─ attachEcologyRuntime.js
       │    └─ ResourceRenewalSystem
       ├─ attachRoadRuntime.js
       │    └─ RoadSystem
       ├─ attachSeasonRuntime.js
       │    └─ SeasonSystem
       ├─ attachFarmRuntime.js
       │    └─ FarmSystem
       ├─ attachFarmExpansionRuntime.js
       │    └─ 第二块人工扩田解锁、扩田读数和状态提示
       └─ attachFoodStorageRuntime.js
            └─ FoodStorageSystem
```

启动顺序必须保持：先主世界、生态、路径、季节、农田、扩田、食物储存。扩田运行时依赖已经挂入 `globalThis.shengling` 的 `farmSystem`。

## 4. 关键文件与连接点

| 文件 | 作用 |
|---|---|
| `src/app.js` | 只负责编排独立启动器，不承载农业或扩田规则。 |
| `src/app-v4.js` | 主装配器：创建事件总线、游戏时间、人物、地图、营地、建筑、天气、篝火、行动和地图 UI。 |
| `src/modules/farming/farmSystem.js` | 田地状态、开垦、播种、成长、收获、种子、第一块田与第二块扩田创建接口。 |
| `src/modules/farming/fieldExpansionPlanner.js` | 第二块田的解锁条件、候选地块与参数，不接触 UI。 |
| `src/bootstrap/attachFarmRuntime.js` | 第一层农事读数、粟米资源芯片、农田系统注入。 |
| `src/bootstrap/attachFarmExpansionRuntime.js` | 监听第一块田收获；调用 `farmSystem.ensureExpansionField()`；显示扩田读数。 |
| `src/modules/actions/farmPlanner.js` | 从 `FarmSystem.nextWorkField()` 获取开垦、播种、收获候选任务。 |
| `src/modules/actions/farmEffects.js` | 农事完成后写入人物 `lifeEvents`；记录具体田名。 |
| `src/modules/seasons/seasonSystem.js` | 提供季节 id、中文名、季内日数、进度、温度修正和作物规则。 |
| `src/modules/environment/weatherSystem.js` | 保留天气类型；在基础温度与随机扰动上叠加季节趋势。 |
| `src/ui/map/farmRenderer.js` | 绘制农地、作物和田地标签。 |
| `src/styles/environment.css` | 天气、季节、生态、路径、农事、扩田和食物读数位置与样式。 |

## 5. 农业与扩田数据

### 5.1 粟米

| 字段 | 数值 |
|---|---:|
| 初始种子 | 2 |
| 每次播种消耗 | 1 |
| 生长要求 | 1440 有效世界分钟 |
| 收获 | 8 粟米 |
| 返种 | 2 |

天气成长倍率：晴朗 1.00；阴天 0.86；降雨 1.28；寒冷 0.54；冷雨 0.70。

最终成长计算：

```text
有效成长 = 经过世界分钟 × 天气成长倍率 × 季节成长倍率
```

### 5.2 第一块田

```text
储物棚完成
→ FarmSystem.ensureFirstField()
→ 营地附近寻找 6×4 可用草地
→ planned / clearing
→ 开垦累计 8 工作量
→ FARMLAND
→ 春季播种
→ 成长 / 成熟 / 收获
```

### 5.3 第二块人工扩田

```text
第一块粟田首次收获
→ FarmSystem 发出 farms:changed（field:harvested）
→ attachFarmExpansionRuntime 监听
→ 检查营地与扩田条件
→ FarmSystem.ensureExpansionField()
→ fieldExpansionPlanner 在营地周边候选点中选择可用位置
→ 新建 second-millet-field
→ 开垦累计 10 工作量
→ 进入与第一块田相同的春播、成长、收获循环
```

`SECOND_FIELD_EXPANSION` 当前参数：

| 字段 | 值 |
|---|---|
| ID | `second-millet-field` |
| 标签 | 第二块粟田 |
| 尺寸 | 6×4 格 |
| 解锁条件 | 第一块田收获次数 ≥ 1 |
| 开垦工作量 | 10 |
| 候选位置 | 营地周边 8 个固定偏移点，按顺序选择第一个可用点 |

候选地块必须满足：未与已有农田重叠、未与建筑重叠、地块存在、地形为草地或高草地、没有地图物件。

## 6. 农田状态与行动优先级

字段 `status`：

```text
planned → clearing → readyToSow → growing → mature → readyToSow
```

字段 `seasonal` 用于地图与页面展示：

```text
planned          待开垦
clearing         开垦中
sowable          可播种
waiting-spring   等待春播
growing          生长中
dormant          冬季停长
mature           成熟待收
```

农事候选优先级：

```text
成熟待收
→ 当前季节可播种的田
→ 待开垦 / 开垦中的田
```

因此，非春季 `readyToSow` 田不会无限派发播种任务；冬季作物留在田内但成长倍率为 0；成熟作物全年可收。

## 7. 事件与渲染连接点

| 事件 | 发出方 | 用途 |
|---|---|---|
| `simulation:time` | ActionSystem | 时间、天气、季节、生态、作物成长、食物损耗的共同时间入口。 |
| `seasons:changed` | SeasonSystem | 跨季刷新季节读数、天气趋势与农田状态。 |
| `farms:changed` | FarmSystem | 农田创建、开垦、播种、成长、收获、扩田计划；扩田运行时在这里监听第一块田收获。 |
| `farms:matured` | FarmSystem | 提醒成熟作物可收获。 |
| `environment:weather` | WeatherSystem | 刷新天气、温度和环境影响。 |
| `camp:changed` | CampStore | 刷新营地资源与粟米资源芯片。 |
| `storage:food-aged` / `storage:food-spoiled` | FoodStorageSystem | 刷新食物保存状态。 |
| `ecology:changed` / `roads:changed` | 对应独立系统 | 刷新地图覆盖层。 |

地图渲染顺序：

```text
地貌 → 路径 → 农田 → 昼夜光照 → 资源/篝火/树桩/恢复灌丛 → 建筑/工地 → 人物 → 雨层 → 页面覆盖层
```

## 8. 已知限制

1. 刷新页面会重新开局；农田、种子、扩田、路径、生态和食物批次不会持久化。
2. 当前没有浏览器端自动化测试。
3. 草棚、储物棚和农田没有作为寻路障碍。
4. 当前农业只有两块田和一种粟米。
5. 第二块田仍由固定候选地块选址，不包含玩家点选、地形评分、劳动力预算或长期土地规划。
6. 四季温度、作物倍率、扩田门槛、食物损耗和天气倍率仍是原型数值，尚未做平衡测试。
7. 未来 AI 只能读取 `lifeEvents`，不得直接修改世界状态。

## 9. 下一阶段建议

优先级：

1. **土壤肥力**：每块农田独立记录肥力，收获消耗肥力，休耕逐步恢复，产量或成长速度受肥力影响。
2. **更多作物**：加入不同播种季、成长周期、产量和耐寒性的作物。
3. 灌溉、虫害、洪涝、干旱与粮食储备策略。

## 10. 版本更新记录（只追加）

### v0.1 · 人物系统基础

- 十位村民、状态、技能、关系、库存、人生事实和个人记忆。
- 确立“人物记忆”用词，不使用“玩家记忆”。

### v0.2 · 起始河谷地图

- 160m × 120m、1m 精度、16m 区块地图。
- 河流、森林、石滩、营地和资源物件。

### v0.3 · 自主行动循环

- 取水、采集、砍树、搬运、休息。
- A* 寻路、营地库存、即时动向和人物行动记录。

### v0.4 · 建造与分工

- 草棚工地、材料预留、领料、运料、施工、完工和居所分配。
- 工地/草棚地图绘制、建造状态栏、Pages 语法检查。

### v0.4.1 · 项目交接文档

- 新建 `codex.md`，记录架构、模块关系、数据约束、连接点、限制和后续规则。

### v0.4.2 · 交接规则调整

- 开发前改为按需查阅 `codex.md`。
- 保留每次完成有效更新后，必须在末尾追加版本概述的规则。

### v0.5 · 昼夜、睡眠与居住效果

- 加入昼夜光照、夜间睡眠、露宿状态和草棚恢复效果。

### v0.6 · 天气、篝火与环境暴露

- 加入天气、降雨、温度、篝火燃料、添柴、暖区、潮湿、受寒与环境状态面板。

### v0.7 · 储物棚与营地容量

- 营地加入初始 24 单位露天容量。
- 草棚完成后自动规划储物棚；储物棚建成后容量 +72，并记录储存保护效果。

### v0.8 · 自然资源恢复

- 树木和浆果丛被耗尽后，自动生成树桩或恢复灌丛标记。
- 树 3 个世界日、浆果 1 个世界日后尝试在原位置恢复；建筑或物件占用时顺延 1 天。
- 生态系统监听 `map:feature-removed` 与 `simulation:time`，不直接耦合进人物行动调度器。

### v0.9 · 聚落路径

- 新增 `RoadSystem`：人物跨入新格时积累踏行热度，4 次经过形成踩踏路径，10 次经过形成土路。
- 新增 `roadRenderer`、路径运行时提示和路径地图图层。
- 成型土路通过 `actionExecutor` 提供 16% 移动速度加成。
- 路径系统独立于地图地形与 A* 通行规则，当前不持久化也不衰退。

### v0.10 · 第一块粟田与稳定食物来源

- 新增 `FarmSystem`、粟米作物目录、农田渲染、农事运行时和开垦/播种/收获行动。
- 储物棚建成后自动选择营地附近 6×4 的草地或高草地，开垦完成后批量转为农地。
- 粟米按天气生长；成熟后收获 8 份粟米、返还 2 份种子，粟米可搬入营地并在浆果不足时作为食物消耗。

### v0.11 · 食物批次、储存损耗与天气保护

- 营地食物改为按批次保存；浆果和粟米批次记录数量、新鲜度、进入时间与更新时间。
- 每 30 个世界分钟按食物基础率、天气倍率和储物保护倍率结算新鲜度；食物完全腐败后从库存移除并累计损耗。
- 降雨和冷雨显著加快损耗；储物棚 protection 直接降低损耗倍率。
- 页面新增食物保存提示：浆果/粟米新鲜度、累计损耗、当前储物防护和雨损风险。

### v0.12 · 农业深化与季节

- 新增 `src/modules/seasons/seasonSystem.js` 与 `src/bootstrap/attachSeasonRuntime.js`；季节系统通过 `simulation:time` 读取 360 天世界年，并在春夏秋冬切换时发出 `seasons:changed`。
- 固定季节区间：春季第 1–90 日、夏季第 91–180 日、秋季第 181–270 日、冬季第 271–360 日；温度趋势依次为 +2℃、+7℃、-1℃、-8℃。
- `WeatherSystem` 保留晴朗、阴天、降雨、寒冷、冷雨的原有选择与效率参数；展示温度、篝火需求与人物受寒计算使用天气基础温度叠加季节修正后的结果。
- 粟米仅能在春季播种；夏季成长倍率 1.25、秋季 0.62、冬季 0。最终成长仍乘以现有天气倍率。非春季待播种农田不再派发播种任务；成熟作物全年可收获。
- 地图右侧新增季节读数：季节名称、季内日数、温度趋势。农田标签和农事读数新增“可播种、等待春播、生长中、冬季停长、成熟待收”。
- 已知限制：四季、天气与作物参数尚未平衡测试；刷新会重开局；没有浏览器端自动化测试；农田和建筑仍不阻挡寻路。
- 下一步建议：第二块人工扩田、土壤肥力或更多作物。

### v0.13 · 第二块人工扩田

- 新增 `src/modules/farming/fieldExpansionPlanner.js`：集中定义第二块粟田的 ID、标签、6×4 尺寸、10 点开垦工作量、首次收获解锁条件与营地周边候选地块。
- 新增 `src/bootstrap/attachFarmExpansionRuntime.js`：监听第一块田的 `field:harvested` 事件，调用 `farmSystem.ensureExpansionField()`，显示扩田读数和状态提示。
- 第一块田首次收获后，第二块田进入 `planned → clearing → readyToSow → growing → mature` 循环；季节播种限制、成长倍率、成熟收获、粮食搬运与食物保存均复用既有规则。
- 农事 `lifeEvents` 改为记录具体田名，第二块田的开垦、播种和收获不会再被写成“第一块粟田”。
- 地图新增扩田覆盖读数；页面阶段更新为 Foundation 13。
- 已知限制：扩田采用固定候选点，没有土地质量评估、人工点选、劳动力预算或持久化；参数尚未平衡测试。
- 下一步建议：土壤肥力或更多作物。
