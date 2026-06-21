# 《生灵》项目交接总览（CODEX）

这份文件用于防止项目记忆丢失，并让新的对话或开发者快速接手。

**强制规则：** 每次开始开发前，必须完整阅读一次本文件；每次完成有效更新后，必须在本文末尾“版本更新记录”中追加一条概述。不要删除既有更新记录。

本文件是项目导航，不替代源代码。改动某个系统前，先读本文对应章节，再读对应源文件。

---

## 1. 项目定位

《生灵》是一个纯前端、无打包器、部署在 GitHub Pages 的动态世界模拟游戏。

核心原则：

- 世界先产生并保存客观事实。
- 人物、传记、史书、关系和未来 AI 对话读取事实，不反向篡改事实。
- 人物在地图中生存、移动、采集、建造、形成关系，并逐步扩展为聚落与文明。
- 当前仅实现“起始河谷的十位村民”最小原型。
- 未来宗教、疾病、政治、经济、家族、战争、科技等都应以独立模块接入。
- 人物不知道“玩家”或“游戏”存在。对陌生人的相遇、印象和好奇属于人物 `personal` 记忆。

## 2. 当前进度：v0.4

已完成：

1. 十位初始村民：年龄、职业、技能、性格、家庭关系、状态、库存、事实和个人记忆。
2. 起始河谷：160m × 120m；1 格 = 1m × 1m；16m × 16m 区块。
3. 地形与物件：河流、林地、石滩、营地、树、石头、浆果、篝火、物资箱。
4. 自主行动：取水、采集、砍树、搬运、休息。
5. A* 网格寻路与人物平滑移动。
6. 共享营地库存：清水、浆果、木材。
7. 自动草棚建造：建立工地、领料、送料、施工、完工、入住。
8. 页面：地图、人物卡、即时日志、营地库存、建造进度。
9. GitHub Pages 自动部署；部署前执行 JavaScript 语法检查。

尚未完成：自动存档、昼夜、天气、睡位、建筑碰撞、道路、农田、资源再生、正式人物立绘、AI 传记/史书/对话、浏览器端自动化测试。

## 3. 浏览器启动链路

```text
index.html
  └─ src/app.js
       └─ src/app-v4.js
            ├─ EventBus / GameTime
            ├─ PeopleSystem / MapSystem
            ├─ CampStore / BuildingSystem
            ├─ ActionSystem
            ├─ MapView 与页面面板
            └─ actionSystem.start()
```

入口职责：

| 文件 | 作用 |
|---|---|
| `index.html` | 页面骨架、Canvas、人物列表、资源栏、建造栏、日志栏。 |
| `src/app.js` | 极薄入口，只导入 `app-v4.js`。不要继续堆业务逻辑。 |
| `src/app-v4.js` | 当前主装配器：初始化系统、连接事件、渲染 UI、启动模拟。 |
| `src/styles/main.css` | 主界面样式。 |
| `src/styles/construction.css` | 建造状态栏样式。 |

## 4. 目录与模块组合逻辑

```text
src/
  core/          # ID、事件总线、时间、确定性随机数
  data/          # 技能、职业、性格、关系、地形等常量
  modules/
    people/      # 人物数据与人物系统
    map/         # 地图生成、查询、修改、服务入口
    settlements/ # 营地共享库存
    actions/     # 任务规划、寻路、执行、行动结果、运行时调度
    buildings/   # 建筑目录、工地、选址、施工状态
  ui/map/        # Canvas 地形、物件、建筑、人物与交互
  styles/        # CSS
```

### 4.1 核心层

- `core/events/eventBus.js`：系统间通信；模块通过事件通知 UI，不直接操控页面。
- `core/time/gameTime.js`：年、日、分钟、tick 和时间戳。
- `core/random/seededRandom.js`：固定种子生成地图。
- `core/ids/createId.js`：系统 ID。

### 4.2 人物层：`modules/people/`

重点文件：

- `personSchema.js`：人物结构，当前 `PEOPLE_SCHEMA_VERSION = 3`。
- `personFactory.js`：创建人物。
- `personValidation.js`：校验结构和状态值。
- `personMutations.js`：受控修改状态、位置、职业、行动。
- `personMemory.js`：写入人生事实与个人记忆。
- `peopleSystem.js`：人物系统总入口，提供事务、导入导出、旧存档迁移和公开 API。
- `createFounders.js`：生成十位开局村民。

人物核心字段：

```text
identity     姓名、出生、存活、死亡
location     regionId、tileX、tileY、homeId
work         职业、技能、偏好
state        饥饿、口渴、精力、健康、心情、压力
activity     当前行动、阶段、上次完成动作、完成次数
family       父母、子女、伴侣、手足
relations    社会关系
memories     lifeEvents、personal、recent
inventory    物品、装备、资源、声明
extensions   后续模块扩展槽
```

记忆规则：

- `lifeEvents`：客观世界事实，行动完成、出生、死亡、建造等写入这里。
- `personal`：人物主观记忆，如相遇、印象、对陌生人的好奇。
- 不使用“玩家记忆”或 `player memory`。

### 4.3 地图层：`modules/map/`

- `mapSchema.js`：地图结构与数组。
- `startingValleyGenerator.js`：固定种子生成起始河谷。
- `mapQueries.js`：地形、资源、水源、通行和邻格查询。
- `mapMutations.js`：修改地形、添加和移除物件。
- `mapSystem.js`：地图服务入口。
- `placeStartingSettlers.js`：把十人放到营地周围。

关键地图参数：

| 参数 | 当前值 |
|---|---|
| 区域 ID | `starting-valley` |
| 地图尺寸 | 160 × 120 格 / 米 |
| 精度 | 1 格 = 1m × 1m |
| 区块 | 16 × 16 格，共 10 × 8 块 |
| 地图种子 | `shengling-starting-valley-v1` |
| 营地中心 | 约 `(79, 74)` |

地图拥有地形、资源物件、建筑和未来道路/土地；人物只保存位置引用，不复制地图状态。

### 4.4 营地、行动与建筑

`modules/settlements/campStore.js`

- 共享营地库存。
- 当前重点物资：`water`、`berries`、`wood`。
- 资源流：地图资源 → 人物背包 → 营地库存 → 建筑工地 / 人物消耗。

`modules/actions/`

- `actionTypes.js`：行动类型与中文名称。
- `pathfinding.js`：A* 网格寻路。
- `actionPlanner.js`：生存任务规划。
- `actionExecutor.js`：移动与工作时长推进。
- `actionEffects.js`：取水、采集、砍树、搬运、休息结果。
- `constructionPlanner.js`：草棚何时建立、何时运料、何时施工。
- `constructionEffects.js`：领料、送料、施工结果。
- `actionSystem.js`：运行时总调度。

当前行动：

| 行动 | 结果 |
|---|---|
| 取水 | 水进入人物背包。 |
| 采集浆果 | 浆果进入背包，浆果丛移除。 |
| 砍树 | 木材进入背包，树移除。 |
| 搬回营地 | 背包资源进入共享库存。 |
| 休息 | 恢复精力，降低压力。 |
| 运送建材 | 从营地领木材，送到草棚工地。 |
| 施工 | 推进草棚施工量。 |

`modules/buildings/`

- `buildingCatalog.js`：建筑定义。
- `buildingSchema.js`：工地结构。
- `buildingPlacement.js`：选址与建筑中心点。
- `buildingSystem.js`：开工、预留材料、送达、施工、完工、入住。

当前建筑：

| 类型 | 材料 | 施工量 | 容量 | 状态 |
|---|---:|---:|---:|---|
| `communalShelter` 集体草棚 | 木材 12 | 10 | 12 人 | 自动建造目标。 |
| `storageShed` 简易储物棚 | 木材 8 | 6 | 0 | 已定义，未接入自动规划。 |

工地状态：`planned → building → complete`。

工地材料：

```text
required      总需求
delivered     已到达工地
reservations  已预留、已搬运中的材料
```

## 5. 当前行动决策

大致优先级：

```text
人物背包有资源 → 先搬回营地
精力过低 → 休息
口渴或饥饿严重 → 生存任务优先
非紧急状态 → 草棚运料或施工
其余情况 → 根据职业和营地缺口取水、采集或砍树
```

职业影响偏好和效率，不锁死人物行为。

运行时说明：`actionSystem` 内维护平滑移动的 `agents` 坐标和路径；正式人物坐标在动作完成时写回，因此刷新前正在移动的位置不会保存。

## 6. 事件连接点

| 事件 | 发出方 | 用途 |
|---|---|---|
| `people:changed` | PeopleSystem | 刷新人物卡、列表、状态栏。 |
| `map:changed` | MapSystem | 刷新地图。 |
| `camp:changed` | CampStore | 刷新营地库存。 |
| `actions:log` | ActionSystem | 刷新即时动向。 |
| `simulation:time` | ActionSystem | 刷新世界时间。 |
| `buildings:changed` | BuildingSystem | 刷新工地进度与建筑地图层。 |
| `buildings:completed` | BuildingSystem | 分配草棚入住者，写入人物 `homeId`。 |

地图绘制顺序：

```text
地貌 → 资源物件 → 建筑/工地 → 人物令牌 → 页面覆盖层
```

## 7. UI 与视觉现状

- 地图逻辑仍为 1m 精度，视觉层已尽量隐藏格子感。
- 村民当前是临时小令牌。用户明确认为人物仍不够好。
- 后续人物美术应改成更可辨认的国风小立绘；不得改变人物坐标、人物系统 API 或地图物件逻辑。

## 8. 部署与检查

- 仓库：`dagasolo138-lgtm/heping`
- 分支：`main`
- 页面：`https://dagasolo138-lgtm.github.io/heping/`
- 工作流：`.github/workflows/deploy-pages.yml`

工作流：

```text
Checkout → 对 src 下所有 JS 执行 node --check → Configure Pages → Upload → Deploy
```

`node --check` 只检查语法。它不检查运行时逻辑、DOM、移动端效果或游戏平衡。重要更新仍要在手机页面实测。

## 9. 已知限制与风险

1. 刷新页面会重新开局；自动存档尚未接入。
2. CI 没有浏览器测试，只有 JS 语法检查。
3. 草棚目前是视觉与居住数据，尚未作为寻路障碍。
4. 极端情况下运输路径失效时，已领出的建材没有完整的落地或归还机制。
5. 树和浆果丛不会再生。
6. 草棚尚未真正提供夜间恢复、防雨或防寒效果。
7. 人口扩大后，需要节流、分区更新和更强的渲染策略。
8. 未来 AI 只能读取 `lifeEvents`，不得直接修改世界状态。

## 10. 下一阶段

下一阶段：**昼夜、睡位与居住效果。**

建议顺序：

1. 世界时间区分白天、黄昏、夜晚，地图加入光照层。
2. 夜晚人物回营地或草棚休息。
3. 草棚提供睡位、精力恢复增益、防雨/防寒基础值。
4. 没有住所或睡位不足的人出现露宿状态、压力与健康惩罚。
5. 后续再做储物棚、独立住宅、道路、农田与复杂分工。

## 11. 版本更新记录（只追加）

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
- 以后每次有效开发完成后，必须在本节末尾追加新记录。
