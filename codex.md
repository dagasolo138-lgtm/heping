# 《生灵》项目交接总览（CODEX）

本文件用于防止项目记忆丢失，并帮助新的对话或开发者快速接手。

**维护规则：** 开发前可按需查阅本文件；每次完成有效更新后，必须在本文末尾“版本更新记录”中追加一条概述。不要删除既有版本记录。每次会影响 Pages 的发布还必须同步更新根目录 `version.json`。

---

## 1. 项目定位

《生灵》是一个纯前端、无打包器、部署在 GitHub Pages 的动态世界模拟游戏。

核心规则：

- 世界先产生并保存客观事实。
- 人物、传记、史书、关系和未来 AI 对话只能读取或解释事实，不能直接篡改世界。
- 人物不知道玩家或游戏存在。
- 相遇、印象、好奇属于人物 `personal` 记忆；行动、建造、睡眠、农事与收获结果写入 `lifeEvents`。
- `globalThis.shengling` 与 `globalThis.__shenglingEventBus` 是独立运行时模块的扩展机制。异步运行时更新全局对象时必须以当时的 `globalThis.shengling` 为准，不能覆盖后挂接模块。

## 2. 当前版本：v0.13.1

已完成：

1. 十位初始村民：年龄、职业、技能、性格、家庭关系、库存、状态、`lifeEvents`、`personal`。
2. 起始河谷：160 × 120 格；1 格 = 1 米；16 × 16 格区块；一年固定 360 天。
3. 行动：取水、采集、砍树、搬运、休息、建造、睡眠、添柴、取暖、开垦、播种、收获。
4. 建筑序列：草棚 → 储物棚。储物棚提供容量 +72 与储存保护 0.6。
5. 昼夜、天气、篝火、潮湿、受寒；树木和浆果会按世界日恢复。
6. 经过地块积累踏行热度：4 次形成踩踏路径、10 次形成土路；土路速度 ×1.16。
7. 食物批次、储存损耗与天气保护：浆果、粟米按批次保存；每 30 世界分钟结算新鲜度；储物棚降低损耗。
8. 四季：春 1–90 日、夏 91–180 日、秋 181–270 日、冬 271–360 日；温度修正依次 +2℃、+7℃、-1℃、-8℃。
9. 粟米：春季可播种；夏季成长 ×1.25；秋季 ×0.62；冬季 ×0；成熟作物全年可收。基础生长要求 1440 有效世界分钟，收获 8 粟米，返种 2。
10. 第一块粟田：储物棚完成后自动选择 6×4 草地，开垦需 8 工作量。
11. 第二块人工扩田：第一块田首次收获后解锁，在营地周边候选草地中选址；尺寸 6×4，开垦需 10 工作量；随后完全复用原有播种、成长、收获、搬运和食物保存链路。
12. 页面与地图：天气、季节、生态、路径、农事、扩田、食物保存读数。
13. 可验证部署：页面右下角显示构建版本、构建编号与源码短提交号；点击“部署清单”可读取根目录 `version.json`。请求使用 `cache: 'no-store'` 与 `cacheBust` 参数穿透缓存。

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
       ├─ attachFoodStorageRuntime.js
       │    └─ FoodStorageSystem
       └─ attachBuildInfoRuntime.js
            └─ 读取 version.json，显示部署构建标记
```

启动顺序：主世界 → 生态 → 路径 → 季节 → 农田 → 扩田 → 食物储存 → 构建信息。`attachBuildInfoRuntime` 必须放在最后，避免其异步读取过程基于过期 runtime 覆盖后来挂接的系统。

## 4. 模块地图与连接点

```text
version.json                  # 发布清单：version、buildId、sourceCommit
src/
  core/                       # ID、事件总线、时间、确定性随机数
  data/                       # 技能、职业、性格、关系、地形常量
  modules/
    people/                   # 人物数据与人物系统
    map/                      # 地图生成、查询、修改与服务入口
    settlements/              # 营地库存、容量、食物批次与储存升级
    actions/                  # 任务规划、寻路、执行、睡眠、添柴、农事
    buildings/                # 建筑目录、工地、施工、居住与储物棚
    environment/              # 昼夜、天气、篝火、暴露
    ecology/                  # 资源耗尽与恢复
    roads/                    # 踏行热度与土路
    seasons/                  # 四季日历、温度趋势、农业窗口
    farming/                  # 粟米、农田、扩田规划、生长、收获
    storage/                  # 食物批次、新鲜度、天气损耗、储物保护
  bootstrap/                  # 独立运行时挂接
  ui/map/                     # Canvas 图层与地图交互
  styles/                     # 样式
```

| 文件 | 职责 |
|---|---|
| `src/app.js` | 只负责编排启动器；不要把规则堆进这里。 |
| `src/app-v4.js` | 主装配器：创建基础世界系统与 UI，启动行动循环。 |
| `src/modules/farming/farmSystem.js` | 农田状态、开垦、播种、生长、收获、种子、第一块田和扩田创建接口。 |
| `src/modules/farming/fieldExpansionPlanner.js` | 第二块田的 ID、候选偏移、解锁条件、尺寸与开垦工作量。 |
| `src/bootstrap/attachFarmRuntime.js` | 农事读数、粟米资源芯片、挂接 `farmSystem`。 |
| `src/bootstrap/attachFarmExpansionRuntime.js` | 监听第一块田收获，调用 `farmSystem.ensureExpansionField()`。 |
| `src/modules/actions/farmPlanner.js` | 按优先级从 `FarmSystem.nextWorkField()` 取得农事任务。 |
| `src/modules/actions/farmEffects.js` | 农事完成后写入人物事实；必须使用具体田名。 |
| `src/modules/seasons/seasonSystem.js` | 四季、季内日数、进度、温度修正、作物规则。 |
| `src/modules/environment/weatherSystem.js` | 保留天气种类，叠加季节温度趋势。 |
| `src/bootstrap/attachBuildInfoRuntime.js` | 读取 `version.json`，右下角显示部署构建读数。 |
| `src/styles/environment.css` | 地图覆盖层、扩田读数与构建读数样式。 |

## 5. 农业、季节与扩田

### 粟米基础

| 字段 | 值 |
|---|---:|
| 初始种子 | 2 |
| 每次播种消耗 | 1 |
| 生长要求 | 1440 有效世界分钟 |
| 收获 | 8 粟米 |
| 返种 | 2 |

天气成长倍率：晴朗 1.00；阴天 0.86；降雨 1.28；寒冷 0.54；冷雨 0.70。

```text
有效成长 = 经过世界分钟 × 天气成长倍率 × 季节成长倍率
```

### 季节农业规则

| 季节 | 天数 | 温度修正 | 播种 | 粟米成长倍率 |
|---|---:|---:|---|---:|
| 春 | 1–90 | +2℃ | 可 | 1.00 |
| 夏 | 91–180 | +7℃ | 不可 | 1.25 |
| 秋 | 181–270 | -1℃ | 不可 | 0.62 |
| 冬 | 271–360 | -8℃ | 不可 | 0 |

农田状态：

```text
planned → clearing → readyToSow → growing → mature → readyToSow
```

展示状态：`待开垦`、`开垦中`、`可播种`、`等待春播`、`生长中`、`冬季停长`、`成熟待收`。

农事任务优先级：

```text
成熟待收 → 当前季节可播种的田 → 待开垦 / 开垦中的田
```

### 第二块人工扩田

```text
第一块粟田首次收获
→ FarmSystem 发出 farms:changed（field:harvested）
→ attachFarmExpansionRuntime 监听
→ FarmSystem.ensureExpansionField()
→ fieldExpansionPlanner 选择第一个可用候选草地
→ second-millet-field
→ 开垦累计 10 工作量
→ 进入既有春播、成长、收获循环
```

`SECOND_FIELD_EXPANSION`：

| 字段 | 值 |
|---|---|
| ID | `second-millet-field` |
| 标签 | 第二块粟田 |
| 尺寸 | 6×4 格 |
| 解锁条件 | 第一块田收获次数 ≥ 1 |
| 开垦工作量 | 10 |
| 候选位置 | 营地周边 8 个固定偏移点，按顺序选择可用点 |

候选地块条件：未与农田或建筑重叠、地块存在、地形为草地或高草地、没有地图物件。

## 6. 事件与渲染连接点

| 事件 | 发出方 | 用途 |
|---|---|---|
| `simulation:time` | ActionSystem | 时间、天气、季节、生态、作物成长与食物损耗共同入口。 |
| `seasons:changed` | SeasonSystem | 跨季刷新季节、天气趋势与农田状态。 |
| `farms:changed` | FarmSystem | 农田创建、开垦、播种、成长、收获、扩田计划。 |
| `farms:matured` | FarmSystem | 提醒成熟作物可收获。 |
| `environment:weather` | WeatherSystem | 刷新天气、温度和环境影响。 |
| `camp:changed` | CampStore | 刷新资源栏与粟米芯片。 |
| `storage:food-aged` / `storage:food-spoiled` | FoodStorageSystem | 刷新食物保存状态。 |
| `ecology:changed` / `roads:changed` | 对应模块 | 刷新地图覆盖层。 |

地图绘制顺序：

```text
地貌 → 路径 → 农田 → 昼夜光照 → 资源/篝火/树桩/恢复灌丛 → 建筑/工地 → 人物 → 雨层 → 页面覆盖层
```

## 7. Pages 部署验证机制

### 发布清单

根目录 `version.json` 是静态部署信标，当前字段：

```text
schemaVersion  清单格式版本
project        项目名
version        产品版本
buildId        人工可比对的构建编号
sourceCommit   与本轮页面代码对应的 Git 提交
branch         发布分支
verificationPath  Pages 上清单路径
```

### 页面行为

`attachBuildInfoRuntime` 在最后挂接，执行：

```text
GET version.json?cacheBust=<Date.now()>
cache: no-store
→ 校验 JSON 对象
→ 页面右下角显示 version / buildId / sourceCommit 前 7 位
→ 提供“部署清单”链接
```

### 以后如何确认部署

1. 每次发布前，先完成页面代码改动并记录其提交 SHA。
2. 最后更新 `version.json`：写入新 `version`、唯一 `buildId` 与页面代码提交的 `sourceCommit`。
3. 在 Pages 打开页面，确认右下角读数。
4. 点击“部署清单”，或访问：
   ```text
   https://dagasolo138-lgtm.github.io/heping/version.json?cacheBust=<任意新数字>
   ```
5. 页面读数与清单的 `buildId`、`sourceCommit` 一致，即可确认线上页面已读到对应构建。

注意：`version.json` 的提交本身通常会晚于 `sourceCommit`，这是设计结果。`sourceCommit` 用来指向该清单所验证的页面代码提交；清单文件自身作为“该版本已进入 Pages 发布内容”的证据。

## 8. 已知限制

1. 刷新页面会重新开局；农田、种子、扩田、路径、生态和食物批次不持久化。
2. 当前没有浏览器端自动化测试。
3. 草棚、储物棚与农田没有作为寻路障碍。
4. 当前农业只有两块田和一种粟米。
5. 第二块田使用固定候选点，未包含玩家点选、地形评分、劳动力预算或长期土地规划。
6. 四季温度、作物倍率、扩田门槛、食物损耗和天气倍率仍是原型数值，尚未完成平衡测试。
7. 当前部署验证能证明静态页面已读到预期构建清单，但不替代浏览器端交互回归测试。
8. 未来 AI 只能读取 `lifeEvents`，不得直接修改世界状态。

## 9. 下一阶段建议

1. **土壤肥力**：每块农田记录肥力，收获消耗、休耕恢复，成长或产量受影响。
2. **更多作物**：不同播种季、成长周期、产量和耐寒性。
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
- 新增路径运行时提示和路径地图图层。
- 成型土路提供 16% 移动速度加成。

### v0.10 · 第一块粟田与稳定食物来源
- 新增 `FarmSystem`、粟米作物目录、农田渲染、农事运行时和开垦/播种/收获行动。
- 储物棚建成后自动选择 6×4 草地或高草地，开垦完成后批量转为农地。
- 粟米按天气生长；成熟后收获 8 份粟米、返还 2 份种子，粟米可搬入营地并在浆果不足时作为食物消耗。

### v0.11 · 食物批次、储存损耗与天气保护
- 营地食物改为按批次保存；浆果和粟米批次记录数量、新鲜度、进入时间与更新时间。
- 每 30 个世界分钟按食物基础率、天气倍率和储物保护倍率结算新鲜度；完全腐败后从库存移除并累计损耗。
- 降雨和冷雨显著加快损耗；储物棚 protection 直接降低损耗倍率。

### v0.12 · 农业深化与季节
- 新增季节系统与季节运行时；一年 360 天，春夏秋冬各 90 天，跨季发出 `seasons:changed`。
- 固定温度趋势 +2℃、+7℃、-1℃、-8℃；天气基础行为不变。
- 粟米仅春季播种；夏 ×1.25、秋 ×0.62、冬 ×0；成熟全年可收。
- 地图与农事读数新增季节、可播种、等待春播、生长中、冬季停长和成熟待收。

### v0.13 · 第二块人工扩田
- 新增 `fieldExpansionPlanner.js` 与 `attachFarmExpansionRuntime.js`。
- 第一块田首次收获后解锁第二块 6×4 粟田；开垦需 10 工作量；完全复用现有农业与食物链路。
- 农事 `lifeEvents` 改为记录具体田名；地图新增扩田读数；页面阶段更新为 Foundation 13。

### v0.13.1 · 可验证 GitHub Pages 部署
- 新增根目录 `version.json`，记录版本、构建编号、源码提交、分支与清单路径。
- 新增 `src/bootstrap/attachBuildInfoRuntime.js`，页面右下角显示构建读数并提供部署清单链接。
- 读取清单使用 `cache: 'no-store'` 与 `cacheBust` 参数，降低旧缓存导致误判的风险。
- `src/app.js` 在食物储存运行时之后挂接构建信息运行时；`environment.css` 新增构建读数样式。
- README 增加部署确认步骤；今后每次 Pages 发布必须同步更新 `version.json`。
