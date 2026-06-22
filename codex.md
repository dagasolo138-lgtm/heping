# 《生灵》项目交接总览（CODEX）

本文件用于防止项目记忆丢失，并帮助新的对话或开发者快速接手。

**维护规则：** 开发前按需查阅；每次有效开发后在末尾追加版本概述；每次影响 Pages 的发布同步更新根目录 `version.json`；修改已有文件前重新获取最新 SHA。

---

## 当前版本：v0.15

《生灵》是一个纯前端 ES Module 动态世界模拟游戏，部署在 GitHub Pages。

### 不可破坏规则

- 世界事实优先。人物、传记、史书、关系和未来 AI 只能读取或解释事实。
- 人物不知玩家或游戏存在。
- 感受与印象写入 `personal`；行动、建造、睡眠、播种、收获写入 `lifeEvents`。
- `globalThis.shengling` 是运行时模块挂接点；异步模块挂接必须展开当前对象，避免覆盖其他模块。
- 刷新开新局；当前无持久化。

### 当前能力

- 10 位村民、河谷地图、A* 寻路、资源采集、营地库存、草棚、储物棚、昼夜、天气、篝火、环境暴露。
- 资源恢复、踩踏路径与土路、食物批次与腐败、四季、粟米、两块农田、土壤肥力。
- 地图支持拖动、双指缩放、滚轮、键盘、Home 回营地与村民点选。
- 手机端默认收起地图状态；营地信息单列；人物列表横向滚动；构建信息位于页面底部。
- 世界速度支持 0.5×、1×、2×、5×、10×，默认 1×。

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
       ├─ attachWorldSpeedRuntime.js
       ├─ attachMapHudRuntime.js
       └─ attachBuildInfoRuntime.js
```

启动顺序：主世界 → 生态 → 路径 → 季节 → 农田 → 扩田 → 食物储存 → 世界速度 → 地图 HUD → 构建信息。

`attachFoodStorageRuntime` 不能覆盖阶段标题。Foundation 15 的标题、说明和倍速 UI 由 `attachWorldSpeedRuntime` 设置。

## 关键模块

| 文件 | 职责 |
|---|---|
| `src/app.js` | 启动器编排，不堆叠业务规则。 |
| `src/app-v4.js` | 创建核心世界、动作系统、地图 UI 并启动循环。 |
| `src/modules/time/worldSpeedSystem.js` | 倍率枚举、当前速度、速度事件。 |
| `src/bootstrap/attachWorldSpeedRuntime.js` | 挂接速度系统、按钮 UI、阶段文案、倍速样式。 |
| `src/styles/worldSpeed.css` | 倍速选择器桌面与移动端样式。 |
| `src/modules/actions/actionSystem.js` | 按模拟 delta 推进世界。 |
| `src/ui/map/mapView.js` | 相机、拖动、双指缩放、键盘、村民点选。 |
| `src/bootstrap/attachMapHudRuntime.js` | 手机端地图状态收起/展开。 |
| `src/modules/farming/farmSystem.js` | 农田、播种、生长、收获、扩田、土壤结算。 |
| `src/modules/farming/soilModel.js` | 肥力、恢复、成长/产量倍率、收获消耗。 |
| `src/bootstrap/attachBuildInfoRuntime.js` | Pages 构建信息读数。 |

## 世界速度模型

允许倍率：`0.5× / 1× / 2× / 5× / 10×`。

基础速率 `WORLD_MINUTES_PER_REAL_SECOND = 6`：

| 倍率 | 世界分钟 / 现实秒 |
|---:|---:|
| 0.5× | 3 |
| 1× | 6 |
| 2× | 12 |
| 5× | 30 |
| 10× | 60 |

核心公式：

```text
realDelta = clamp((now - previous) / 1000, 0, 0.12)
simulationDelta = realDelta × 当前倍率
```

`simulationDelta` 用于世界时间、人物移动与工作、行动规划、饥饿口渴精力、环境暴露、天气、篝火、季节、生态恢复、作物、土壤和食物损耗。高倍速不是只快进时钟。

速度变化事件：

```text
simulation:speed
{ speed: { value, label, worldMinutesPerRealSecond }, previous, reason, time }
```

运行时 API：

```js
window.shengling.worldSpeedSystem.get()
window.shengling.worldSpeedSystem.set(5)
window.shengling.worldSpeedRuntime.set(2)
```

速度不持久化；刷新后恢复 1×。当前没有暂停 0×。

## 农业关键参数

- 一年 360 天；春夏秋冬各 90 天。
- 粟米：春季可播种；夏 ×1.25；秋 ×0.62；冬 ×0；成熟全年可收。
- 粟米基础收获 8，返种 2，收获后肥力 -18。
- 土壤：初始 78；休耕每世界分钟 +0.0015；肥沃/尚可/贫瘠/瘠薄的成长倍率为 1.06/0.96/0.78/0.60，产量倍率为 1.12/1.00/0.80/0.62。
- 第二块田由第一块田首次收获解锁，开垦需要 10 工作量。

## 移动端规则

- `map-canvas-wrap.is-hud-collapsed` 时仅展示时间与天气。
- 点击“地图信息”才展开季节、生态、路径、农事、扩田、食物条。
- 移动端 `.settlement-strip` 必须单列。
- 倍速选择器位于地图画布外，始终可见，五个按钮一行均分。
- 构建信息不得 `position: fixed`。

## Pages 验证

`version.json` 必须记录 `version`、`buildId`、`sourceCommit` 和 `branch`。页面用 `cache: no-store` 加 `cacheBust` 读取清单，并在页面底部显示构建读数。

验证地址：

```text
https://dagasolo138-lgtm.github.io/heping/version.json?cacheBust=<任意新数字>
```

页面底部和清单的 `buildId`、`sourceCommit` 一致，即可确认线上读取目标构建。

## 已知限制

1. 无持久化和浏览器自动化测试。
2. 草棚、储物棚、农田没有作为寻路障碍。
3. 农业只有两块田和一种粟米。
4. 扩田使用固定候选点，没有玩家点选、地形评分或劳动力预算。
5. 肥力、天气、季节、食物损耗和高倍速参数尚未平衡测试。
6. 10× 会更快产生日志与状态刷新；没有日志聚合或后台跳帧优化。

## 下一阶段建议

1. 施肥/堆肥与休耕策略。
2. 更多作物：不同播种季、耐寒性、肥力消耗、成长周期和产量。
3. 灌溉、虫害、洪涝、干旱与粮食储备。

## 版本更新记录（只追加）

### v0.1 · 人物系统基础
- 十位村民、状态、技能、关系、库存、人生事实和个人记忆。

### v0.2 · 起始河谷地图
- 160m × 120m、1m 精度、河流、森林、石滩、营地与资源物件。

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
- 手机端地图状态默认收起；营地信息恢复单列；构建信息移入文档流；食物模块不再覆盖阶段文案。

### v0.15 · 世界速度
- 新增 `WorldSpeedSystem` 与 `attachWorldSpeedRuntime`，支持 0.5×、1×、2×、5×、10×。
- `ActionSystem` 将真实帧间隔乘以当前倍率得到模拟 delta；世界时间、人物移动/工作、行动规划、需求与环境结算同步加速或减速。
- 地图面板新增倍率控制器，当前倍率高亮；手机端五个按钮同一行均分。
- 新增 `simulation:speed` 事件与 `window.shengling.worldSpeedSystem` / `worldSpeedRuntime` API。
- 页面阶段更新为 Foundation 15；下一步建议仍为施肥/堆肥与更多作物。
