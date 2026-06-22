# 《生灵》项目交接总览（CODEX）

本文件用于防止项目记忆丢失，并帮助新的对话或开发者快速接手。

**维护规则：** 开发前按需查阅；每次完成有效更新后，在本文末尾追加版本概述；每次影响 GitHub Pages 的发布，必须同步更新根目录 `version.json`。修改已有文件前重新获取最新 SHA。

---

## 1. 项目定位与不可破坏规则

《生灵》是部署在 GitHub Pages 的纯前端 ES Module 动态世界模拟游戏。

- 世界事实优先：人物、传记、史书、关系与未来 AI 只能读取或解释客观事实，不能直接改写世界。
- 人物不知玩家或游戏存在。
- 相遇、印象、好奇归入人物 `personal`；行动、建造、睡眠、播种、收获等结果写入 `lifeEvents`。
- `globalThis.shengling` 是运行时模块的挂接点；`globalThis.__shenglingEventBus` 是事件总线入口。异步挂接时必须基于当前 `globalThis.shengling` 展开，不能覆盖后挂模块。
- 刷新页面开新局；当前无持久化。

## 2. 当前版本：v0.14.1

### 当前世界能力

1. 10 位村民，拥有年龄、职业、技能、性格、家庭关系、库存、状态、`lifeEvents`、`personal`。
2. 起始河谷：160 × 120 格，1 格 = 1 米，包含河流、林地、石滩、营地和资源物件。
3. 自主行动：取水、采集、砍树、搬运、休息、建造、睡眠、添柴、取暖、开垦、播种、收获。
4. A* 寻路；资源流为地图 → 人物背包 → 营地库存 → 工地/篝火/消耗。
5. 草棚、储物棚、营地容量、储存保护、食物批次与损耗已完成。
6. 树与浆果资源会恢复；踩踏形成路径，土路提供移动速度加成。
7. 360 天世界年，春夏秋冬各 90 天；季节改变天气温度趋势和粟米农业窗口。
8. 第一块粟田与第二块人工扩田已完成；第二块田由第一块田首次收获解锁。
9. 土壤肥力已完成：新田 78，休耕恢复，成长与收获受肥力影响，粟米每次收获消耗 18 肥力。
10. 地图支持拖动、双指缩放、滚轮、键盘、Home 回营地与村民点选。
11. 手机端默认收起地图状态，点击“地图信息”才展开季节、生态、路径、农事、扩田、食物信息；营地三区块单列显示；人物列表横向卡片滚动。
12. 页面底部显示构建版本、构建编号与源码短提交，并提供部署清单链接；构建信息不再悬浮遮挡游戏内容。

## 3. 启动链

```text
index.html
  └─ src/app.js
       ├─ src/app-v4.js
       │    ├─ EventBus / GameTime
       │    ├─ PeopleSystem / MapSystem / CampStore
       │    ├─ BuildingSystem / WeatherSystem / FireSystem
       │    ├─ ActionSystem / MapView / 页面 UI
       │    └─ actionSystem.start()
       ├─ attachEcologyRuntime.js
       ├─ attachRoadRuntime.js
       ├─ attachSeasonRuntime.js
       ├─ attachFarmRuntime.js
       ├─ attachFarmExpansionRuntime.js
       ├─ attachFoodStorageRuntime.js
       ├─ attachMapHudRuntime.js
       └─ attachBuildInfoRuntime.js
```

顺序要求：主世界 → 生态 → 路径 → 季节 → 农田 → 扩田 → 食物储存 → 地图 HUD → 构建信息。

`attachFoodStorageRuntime` 只负责食物系统，不能再覆盖页面的阶段标题或说明。当前阶段文案由农田运行时设置为 Foundation 14。

## 4. 关键模块

| 文件 | 职责 |
|---|---|
| `src/app.js` | 只编排启动器，禁止堆叠业务规则。 |
| `src/app-v4.js` | 创建核心系统、挂接 UI、启动行动循环。 |
| `src/ui/map/mapView.js` | 相机、画布、拖动、双指缩放、滚轮、键盘、村民点选。 |
| `src/bootstrap/attachMapHudRuntime.js` | 手机端地图状态收起/展开控制器。 |
| `src/styles/experience.css` | 触控目标、地图 HUD、移动端单列布局、焦点态、手势提示。 |
| `src/modules/farming/farmSystem.js` | 农田状态、开垦、播种、生长、收获、扩田、土壤结算。 |
| `src/modules/farming/soilModel.js` | 土壤肥力、分级、恢复、成长倍率、产量倍率、消耗。 |
| `src/modules/farming/fieldExpansionPlanner.js` | 第二块田的解锁条件、候选位置、尺寸与开垦量。 |
| `src/modules/actions/farmEffects.js` | 农事完成后写人物事实，记录具体田名和肥力变化。 |
| `src/bootstrap/attachFarmRuntime.js` | 农事与土壤读数、粟米资源芯片。 |
| `src/bootstrap/attachFarmExpansionRuntime.js` | 第一块田首次收获后创建第二块田。 |
| `src/bootstrap/attachFoodStorageRuntime.js` | 食物批次、损耗读数与损耗事件。 |
| `src/bootstrap/attachBuildInfoRuntime.js` | 读取 `version.json` 并在页面底部显示构建信息。 |
| `src/styles/environment.css` | 地图环境覆盖层、资源芯片、构建信息布局。 |

## 5. 农业与土壤模型

### 粟米

| 字段 | 数值 |
|---|---:|
| 初始种子 | 2 |
| 每次播种消耗 | 1 |
| 生长要求 | 1440 有效世界分钟 |
| 基础收获 | 8 粟米 |
| 返种 | 2 |
| 收获肥力消耗 | 18 |

天气成长倍率：晴朗 1.00；阴天 0.86；降雨 1.28；寒冷 0.54；冷雨 0.70。

### 季节

| 季节 | 天数 | 温度修正 | 播种 | 粟米成长倍率 |
|---|---:|---:|---|---:|
| 春 | 1–90 | +2℃ | 可 | 1.00 |
| 夏 | 91–180 | +7℃ | 不可 | 1.25 |
| 秋 | 181–270 | -1℃ | 不可 | 0.62 |
| 冬 | 271–360 | -8℃ | 不可 | 0 |

### 土壤

`field.soil`：

```text
fertility   0–100，初始 78
lastTick    上次结算 tick
harvests    收获次数
```

| 肥力 | 标签 | 成长倍率 | 产量倍率 |
|---:|---|---:|---:|
| 80–100 | 肥沃 | 1.06 | 1.12 |
| 55–79 | 尚可 | 0.96 | 1.00 |
| 30–54 | 贫瘠 | 0.78 | 0.80 |
| 0–29 | 瘠薄 | 0.60 | 0.62 |

```text
有效成长 = 经过世界分钟 × 天气倍率 × 季节倍率 × 土壤成长倍率
收获数量 = max(3, round(基础产量 × 土壤产量倍率))
```

- `planned`、`clearing`、`readyToSow` 属于休耕状态，每世界分钟 +0.0015 肥力。
- `growing` 与 `mature` 不恢复肥力。
- 收获后扣 18 点肥力并增加 `soil.harvests`。

### 农田与扩田状态

```text
planned → clearing → readyToSow → growing → mature → readyToSow
```

展示状态：待开垦、开垦中、可播种、等待春播、生长中、冬季停长、成熟待收。

农事任务优先级：成熟待收 → 当前季节可播种田 → 待开垦/开垦中田。

第二块田：第一块田首次收获 → `farms:changed(field:harvested)` → `attachFarmExpansionRuntime` → `ensureExpansionField()` → 选择第一个可用候选草地 → 开垦 10 工作量。

## 6. 地图交互与移动端规则

### 地图操作

```text
单指 / 左键拖动     平移相机
双指缩放            缩放并随双指中心平移
轻点村民            查看人物详情
滚轮                以指针位置缩放
方向键              平移
+ / -               缩放
Home                回营地
```

### 手机端 HUD

- 初始 `map-canvas-wrap` 带 `is-hud-collapsed`。
- 收起时显示世界时间与天气；季节、生态、路径、农事、扩田、食物状态隐藏。
- `#map-hud-toggle` 展开完整状态，文本切换为“收起信息”。
- 展开状态允许覆盖部分地图，因为由用户主动请求；默认状态必须保持地图清晰。
- 地图状态条和按钮都必须避开系统 Safari 底部工具栏；构建读数不可使用 `position: fixed`。

### 页面布局

- 移动端 `.settlement-strip` 必须 `grid-template-columns: 1fr`。
- `camp-stock`、`construction-watch`、`action-feed` 各占一行，标题可换行。
- 任何后加载样式都不能重新覆盖移动端单列规则。

## 7. 事件

| 事件 | 发出方 | 用途 |
|---|---|---|
| `simulation:time` | ActionSystem | 天气、季节、生态、作物成长、土壤恢复、食物损耗共同时间入口。 |
| `seasons:changed` | SeasonSystem | 刷新季节、天气趋势与农田状态。 |
| `farms:changed` | FarmSystem | 农田、开垦、播种、成长、收获、扩田、土壤恢复。 |
| `farms:matured` | FarmSystem | 成熟提示。 |
| `camp:changed` | CampStore | 资源栏与粟米芯片。 |
| `storage:food-aged` / `storage:food-spoiled` | FoodStorageSystem | 食物损耗和保存状态。 |
| `ecology:changed` / `roads:changed` | 对应系统 | 刷新地图覆盖层。 |

## 8. Pages 部署验证

`version.json` 是静态发布信标：

```text
version        产品版本
buildId        人工可对比构建编号
sourceCommit   页面实现提交
branch         main
verificationPath  /heping/version.json
```

页面使用：

```text
GET version.json?cacheBust=<Date.now()>
cache: no-store
→ 页面底部显示 version / buildId / sourceCommit 前 7 位
```

确认部署：打开 Pages 页面 → 核对页面底部构建信息 → 点击“部署清单”或访问：

```text
https://dagasolo138-lgtm.github.io/heping/version.json?cacheBust=<任意新数字>
```

页面与清单的 `buildId`、`sourceCommit` 一致即可确认线上页面已读到对应构建。

## 9. 已知限制

1. 无持久化；刷新会重开局。
2. 没有浏览器端自动化测试。
3. 草棚、储物棚、农田尚未作为寻路障碍。
4. 农业当前只有两块田和一种粟米。
5. 第二块田仍使用固定候选点，无玩家点选、地形评分、劳动力预算或长期规划。
6. 肥力恢复、季节倍率、作物成长、损耗、扩田门槛均未做平衡测试。
7. 部署清单只能证明静态页面已读取目标构建，不替代交互回归测试。

## 10. 下一阶段建议

1. 施肥/堆肥与休耕策略：让恢复肥力有资源代价和任务决策。
2. 更多作物：不同播种季、耐寒性、肥力消耗、成长周期和产量。
3. 灌溉、虫害、洪涝、干旱与粮食储备策略。

## 11. 版本更新记录（只追加）

### v0.1 · 人物系统基础
- 十位村民、状态、技能、关系、库存、人生事实和个人记忆。

### v0.2 · 起始河谷地图
- 160m × 120m、1m 精度、16m 区块、河流、森林、石滩、营地与资源物件。

### v0.3 · 自主行动循环
- 取水、采集、砍树、搬运、休息、A* 寻路和营地库存。

### v0.4 · 建造与分工
- 草棚工地、运料、施工、居住分配和建造 UI。

### v0.4.1 · 项目交接文档
- 新建 `codex.md`。

### v0.4.2 · 交接规则调整
- 开发前按需查阅 `codex.md`；每次有效开发后追加版本概述。

### v0.5 · 昼夜、睡眠与居住效果
- 昼夜光照、夜间睡眠、露宿和草棚恢复效果。

### v0.6 · 天气、篝火与环境暴露
- 天气、降雨、温度、篝火、添柴、潮湿与受寒。

### v0.7 · 储物棚与营地容量
- 初始露天容量、储物棚容量与保护效果。

### v0.8 · 自然资源恢复
- 树木和浆果恢复队列；资源耗尽标记与占用延后恢复。

### v0.9 · 聚落路径
- 踩踏路径、土路、移动速度加成。

### v0.10 · 第一块粟田
- 粟米、农田、开垦、播种、收获与稳定食物来源。

### v0.11 · 食物批次、储存损耗与天气保护
- 食物批次、新鲜度、腐败、储物保护。

### v0.12 · 农业深化与季节
- 四季、温度趋势、春播与季节成长倍率。

### v0.13 · 第二块人工扩田
- 首次收获解锁第二块田，复用农业与食物链路。

### v0.13.1 · 可验证 GitHub Pages 部署
- `version.json`、构建读数、部署清单验证。

### v0.14 · 地图交互优化与土壤肥力
- 双指缩放、键盘导航、移动端卡片布局、土壤肥力与肥力可视化。

### v0.14.1 · 移动端界面修复
- 新增 `attachMapHudRuntime.js`；手机端地图状态默认收起，点击“地图信息”展开。
- `experience.css` 修复被后加载样式覆盖的移动端单列布局；营地储备、建造、即时动向不再并排挤压。
- 构建读数移入页面正常文档流，不再固定悬浮遮挡内容。
- 食物储存运行时不再覆盖当前阶段文案，页面稳定显示 Foundation 14。
