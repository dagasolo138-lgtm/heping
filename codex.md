# 《生灵》项目交接总览（CODEX）

本文件用于防止项目记忆丢失，并帮助新的对话或开发者快速接手。

**维护规则：** 开发前可按需查阅本文件；每次完成有效更新后，必须在本文末尾“版本更新记录”中追加一条概述。不要删除既有版本记录。

---

## 1. 项目定位

《生灵》是一个纯前端、无打包器、部署在 GitHub Pages 的动态世界模拟游戏。

核心原则：

- 世界先产生并保存客观事实。
- 人物、传记、史书、关系和未来 AI 对话只能读取或解释事实，不能反向篡改事实。
- 人物会在地图中生存、移动、采集、建造、居住、储存资源、形成路径并逐步形成聚落。
- 人物不知道“玩家”或“游戏”存在；相遇、印象、好奇等属于人物 `personal` 记忆。
- 宗教、疾病、政治、经济、家族、战争、科技等都应作为独立模块接入。

## 2. 当前版本：v0.9

已完成：

1. 十位初始村民：年龄、职业、技能、性格、家庭关系、状态、库存、`lifeEvents` 与 `personal` 记忆。
2. 起始河谷：160m × 120m；1 格 = 1m × 1m；16m × 16m 区块。
3. 地图资源：树、石头、浆果、河流、篝火、物资箱；人物采用 A* 网格寻路并有平滑运行时坐标。
4. 行动：取水、采集、砍树、搬运、休息、运料、施工、睡眠、添柴、取暖。
5. 建筑序列：集体草棚 → 简易储物棚；两者复用工地、预留材料、领料、运料、施工和完工流程。
6. 营地库存：初始 24 单位露天容量；储物棚建成后增加 72 容量，并写入 0.6 储存保护值。
7. 昼夜、天气、篝火与人物暴露：降雨、寒冷、潮湿、受寒、暖区、露宿。
8. 自然资源恢复：树被砍后留下树桩，3 个世界日后尝试恢复；浆果被采后留下恢复灌丛，1 个世界日后尝试恢复。占用位置时顺延 1 天。
9. 聚落路径：人物反复进入同一地块会积累踏行热度；4 次经过形成踩踏路径，10 次经过形成土路；土路使移动速度提高 16%。
10. GitHub Pages 自动部署；部署前对 `src` 下全部 JS 执行 `node --check`。

当前未完成：自动存档、农田、作物、生长季、食物腐败/雨损、建筑碰撞、正式人物立绘、AI 传记/史书/对话、浏览器端自动化测试。

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
       ├─ src/bootstrap/attachEcologyRuntime.js
       │    └─ ResourceRenewalSystem 监听地图资源移除与世界时间推进
       └─ src/bootstrap/attachRoadRuntime.js
            └─ RoadSystem 采样人物实际移动并累积踏行热度
```

入口职责：

| 文件 | 作用 |
|---|---|
| `index.html` | 页面骨架、Canvas、人物列表、资源栏、建造栏、天气栏、日志栏。 |
| `src/app.js` | 先启动主世界，再挂接生态与路径运行时模块。 |
| `src/app-v4.js` | 主装配器：创建世界系统、连接 UI、启动模拟。 |
| `src/bootstrap/attachEcologyRuntime.js` | 挂接资源恢复系统与生态提示。 |
| `src/bootstrap/attachRoadRuntime.js` | 挂接踏行热度、路径提示与道路生成。 |
| `src/styles/main.css` | 主界面样式。 |
| `src/styles/construction.css` | 建造状态栏样式。 |
| `src/styles/environment.css` | 天气、篝火、暴露、生态和路径提示样式。 |

**约束：** 新功能优先新增独立模块；不要把业务逻辑堆进 `index.html` 或 `app.js`。

## 4. 模块地图

```text
src/
  core/          # ID、事件总线、时间、确定性随机数
  data/          # 技能、职业、性格、关系、地形常量
  modules/
    people/      # 人物数据与人物系统
    map/         # 地图生成、查询、修改、服务入口
    settlements/ # 营地共享库存、容量与储存升级
    actions/     # 任务规划、寻路、执行、睡眠、添柴、总调度
    buildings/   # 建筑目录、工地、选址、施工、居住与储物棚
    environment/ # 昼夜、天气、篝火、环境暴露
    ecology/     # 资源耗尽、恢复队列、树桩和灌丛标记
    roads/       # 踏行热度、路径阶段、土路移动倍率
  bootstrap/     # 运行时挂接模块
  ui/map/        # Canvas 地形、路径、光照、天气、资源、建筑、人物与交互
  styles/        # CSS
```

### 4.1 核心层

- `core/events/eventBus.js`：系统间通信；创建时会将当前总线暴露为 `globalThis.__shenglingEventBus`，供启动器挂接独立运行时模块。
- `core/time/gameTime.js`：年、日、分钟、tick 和时间戳。
- `core/random/seededRandom.js`：确定性地图和天气选择。
- `core/ids/createId.js`：系统唯一 ID。

### 4.2 人物层：`modules/people/`

人物关键字段：

```text
identity     姓名、出生、存活、死亡
location     regionId、tileX、tileY、homeId
work         职业、技能、偏好
state        饥饿、口渴、精力、健康、心情、压力、statusTags
activity     当前行动、阶段、上次完成动作、完成次数
family       父母、子女、伴侣、手足
relations    社会关系
memories     lifeEvents、personal、recent
inventory    物品、装备、资源、声明
extensions   后续模块扩展槽
```

记忆规则：

- `lifeEvents`：客观世界事实。行动、睡眠、添柴、取暖、建造等写入这里。
- `personal`：人物主观记忆，如相遇、印象、对陌生人的好奇。
- 不使用“玩家记忆”或 `player memory`。

重点文件：`personSchema.js`、`personFactory.js`、`personValidation.js`、`personMutations.js`、`personMemory.js`、`peopleSystem.js`、`createFounders.js`。

### 4.3 地图层：`modules/map/`

- `mapSchema.js`：地图结构。
- `startingValleyGenerator.js`：固定种子生成起始河谷。
- `mapQueries.js`：地形、资源、水源、通行和邻格查询。
- `mapMutations.js`：添加/移除物件；`removeFeature()` 会返回被移除物件数据。
- `mapSystem.js`：地图服务入口；资源移除时发出 `map:feature-removed`。
- `placeStartingSettlers.js`：把十人放到营地周围。

关键参数：

| 参数 | 当前值 |
|---|---|
| 区域 ID | `starting-valley` |
| 尺寸 | 160 × 120 格 / 米 |
| 精度 | 1 格 = 1m × 1m |
| 区块 | 16 × 16 格，共 10 × 8 块 |
| 地图种子 | `shengling-starting-valley-v1` |
| 营地中心 | 约 `(79, 74)` |

### 4.4 营地、建筑、行动与环境

`modules/settlements/campStore.js`

- 管理共享库存、容量、剩余空间和储存升级。
- 初始容量 24；储物棚升级后容量 +72。
- `change()` 存入资源时会受剩余容量限制；满仓时只接收可容纳部分。
- `applyStorageUpgrade()` 按建筑 ID 去重应用扩容和保护。

`modules/buildings/`

| 建筑 | 材料 | 施工量 | 效果 | 条件 |
|---|---:|---:|---|---|
| `communalShelter` 集体草棚 | 木材 12 | 10 | 12 睡位、夜间遮蔽 | 第一个自动目标。 |
| `storageShed` 简易储物棚 | 木材 8 | 6 | 容量 +72、保护 +0.6 | 草棚完成后自动目标。 |

`modules/actions/`

- `actionPlanner.js`：日常生存任务。
- `pathfinding.js`：A*。
- `actionExecutor.js`：移动和工作时长；读取 `globalThis.shengling.roadSystem`，在土路格上叠加 1.16 移动倍率。
- `actionEffects.js`：取水、采集、砍树、搬运和休息结果。资源移除会触发生态监听。
- `constructionPlanner.js` / `constructionEffects.js`：建筑序列、领料、运料、施工。
- `nightPlanner.js` / `sleepEffects.js`：夜间睡眠与露宿。
- `weatherPlanner.js` / `fireEffects.js`：添柴和取暖。
- `actionSystem.js`：行动、天气、篝火、暴露与时间总调度。

当前行动：取水、采集浆果、砍树、搬回营地、休息、运送建材、施工、睡眠、添柴、取暖。

`modules/environment/`

- `dayCycle.js`：黎明 05:00–07:00；白昼 07:00–17:00；黄昏 17:00–20:00；夜晚 20:00–05:00。
- `weatherSystem.js`：每 4 小时世界时间更新天气。
- `fireSystem.js`：篝火燃料、燃烧、熄灭、7m 暖区。
- `exposureSystem.js`：潮湿、受寒、草棚遮蔽、篝火温暖、状态与惩罚。

当前模拟速度：约 1 秒现实时间 = 6 分钟世界时间。

### 4.5 生态层：`modules/ecology/`

`resourceRenewalSystem.js`：

```text
树 / 浆果丛被地图移除
→ MapSystem 发出 map:feature-removed
→ ResourceRenewalSystem 登记恢复条目
→ 添加 treeStump / berryPatch 标记
→ simulation:time 推进时检查到期条目
→ 原位置空闲则删除标记、恢复原资源
→ 位置被建筑或物件占用则顺延 1 个世界日
```

| 资源 | 标记 | 恢复时间 |
|---|---|---|
| 树 | `treeStump` | 3 个世界日 / 4320 分钟 |
| 浆果丛 | `berryPatch` | 1 个世界日 / 1440 分钟 |

### 4.6 路径层：`modules/roads/`

`roadSystem.js` 保存踏行热度，不改变地图地形数组。

```text
人物实际移动坐标（每 240ms 采样）
→ 人物跨入新的整格
→ 记录该格交通次数
→ 4 次经过：wornTrail（视觉踩踏路径）
→ 10 次经过：dirtRoad（成型土路）
→ actionExecutor 读取土路格，移动速度 × 1.16
```

关键约束：

- 只记录跨入的新格，避免连续采样重复累计原地格。
- 当前路径没有自然消退；存档接入后需一并持久化。
- 路径图层仅负责视觉和移动倍率，不修改通行性、不改变 A* 寻路目标。
- `roadRenderer.js` 在地貌之后、昼夜光照之前绘制，建筑和人物会盖在路径上方。

## 5. 当前决策与数据流

决策优先级：

```text
人物背包有资源 → 先搬回营地
精力过低 → 休息
口渴或饥饿严重 → 生存任务优先
严重受寒/潮湿 → 优先篝火取暖
篝火燃料低且营地有木材 → 一人前去添柴
非紧急、非夜晚 → 当前建筑工地的运料或施工
其余情况 → 根据职业和营地缺口取水、采集或砍树
夜晚 → 不派发新的生产或建造任务；村民回草棚睡眠或回营地露宿
```

资源流：

```text
地图资源 → 人物背包 → 营地库存 → 工地 / 篝火 / 人物消耗
自然资源被耗尽 → 树桩或恢复灌丛 → 定时恢复为地图资源
人物实际移动 → 踏行热度 → 踩踏路径 / 土路 → 移动倍率
```

环境效果：

- 户外降雨增加潮湿；草棚内部和篝火暖区降低潮湿。
- 寒冷、冷雨和潮湿会累积受寒。
- 潮湿/受寒较高时，人物获得 `soaked`、`chilled` 状态，增加精力消耗和压力；重度受寒会损害健康。
- 天气通过移动/工作乘数降低户外效率。
- 储物棚当前只记录保护值；食物腐败、雨损和材料损耗尚未结算。

## 6. 事件与渲染连接点

| 事件 | 发出方 | 用途 |
|---|---|---|
| `people:changed` | PeopleSystem | 刷新人物卡、人物列表和状态栏。 |
| `map:changed` | MapSystem | 刷新地图。 |
| `map:feature-removed` | MapSystem | 生态系统登记树或浆果恢复。 |
| `camp:changed` | CampStore | 更新资源、篝火和容量栏。 |
| `actions:log` | ActionSystem | 更新即时动向。 |
| `simulation:time` | ActionSystem | 更新世界时间、天气、篝火，并触发生态到期检查。 |
| `ecology:changed` / `ecology:regrown` | ResourceRenewalSystem | 更新生态提示与地图。 |
| `roads:changed` | RoadSystem | 更新路径提示、地图和土路形成状态。 |
| `environment:phase/weather/fire` | 环境系统 | 更新昼夜、天气、篝火视觉状态。 |
| `buildings:completed` | BuildingSystem | 草棚分配住户；储物棚扩容。 |

地图渲染顺序：

```text
地貌 → 路径 → 昼夜光照 → 资源/篝火/树桩/恢复灌丛 → 建筑/工地 → 人物 → 雨层 → 页面覆盖层
```

## 7. 已知限制与风险

1. 刷新页面会重新开局；生态恢复队列和路径热度也不会持久化。
2. CI 只有 JS 语法检查，没有浏览器测试。
3. 草棚和储物棚尚未作为寻路障碍。
4. 极端情况下运输路径失效时，已领出的建材没有完整的落地或归还机制。
5. 当前资源恢复只针对树和浆果；石料、水源和其他资源仍未建立循环。
6. 当前路径没有衰退、雨天泥泞或人工铺设系统。
7. 资源恢复时长、天气、路径阈值和移动倍率仍是原型参数，尚未做平衡测试。
8. 生态与路径启动器依赖 `globalThis.__shenglingEventBus` 和 `globalThis.shengling`；重构主启动架构时需同步调整。
9. 未来 AI 只能读取 `lifeEvents`，不得直接修改世界状态。

## 8. 下一阶段

下一阶段：**稳定食物来源。**

建议顺序：

1. 选择营地附近的可耕地，建立第一块小农田。
2. 引入一种基础作物：播种 → 生长 → 收获 → 存入营地。
3. 农田产出接入天气、土路和储物棚容量。
4. 再让储物棚保护值实际影响食物腐败与雨损。

## 9. 版本更新记录（只追加）

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
