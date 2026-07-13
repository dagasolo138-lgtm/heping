# 生灵

《生灵》是一个部署在 GitHub Pages 的规则驱动动态世界模拟游戏。世界先产生并保存客观事实，人物记忆、关系、传记、史书和未来对话系统只解释这些事实，不能反向篡改世界。

## 当前版本：v0.30.1

v0.30.1 是 v0.30.0 世界动力引擎的发布收口版本：统一 README、交接文档、页面构建清单和世界存档应用版本，不改变固定 tick、人物选择或资源结算结果。

v0.30.0 已完成“世界动力事实层”：每日经济、农业和天气事实会形成压力、机会与共同承诺；共同承诺只能给已有合法任务候选增加有限权重，不能生成非法任务，也不能绕过生存、路线、库存、预留、并发和工具维护约束。

## 核心原则

- 世界事实优先，AI 只负责表达。
- 人物不知道玩家和游戏的存在。
- 所有世界变化必须由固定 tick 推进，UI 不承担结算。
- 预留、任务生命周期、资源流水是三套独立事实，不得混写。
- 失败不能吞材料、制造物资、留下幽灵预留或部分结算。
- 相同种子、相同输入和相同 tick 数必须得到相同世界结果。

## 当前能力

- 10 位村民，拥有年龄、职业、技能、性格、家庭关系、库存、状态、事实和个人记忆。
- 160 米 × 120 米起始河谷，包含河流、林地、石滩、营地、道路、建筑、农田和可耗竭资源。
- 村民会取水、采集、砍树、搬运、建造、添柴、取暖、睡眠、开垦、播种、收获、维修和替换工具。
- A* 网格寻路；实际路线、负重、地形、道路、天气、体力、技能和工具共同决定劳动成本。
- 昼夜、天气、四季、篝火、潮湿、受寒、生态恢复、踩踏道路、食物腐败、粟田扩张和土壤肥力均由固定 tick 推进。
- 桌面端使用地图主视图与右侧观察栏；手机端使用底部观察抽屉。
- 世界速度公开支持 **0.5×、1×、2×、5×、10×**。
- 测试环境提供隐藏 **100×** 固定 tick 推进入口，不显示在玩家界面。
- 存档支持事务化导入、失败回滚、旧存档初始化、精确坐标恢复和成功读档后的重新规划。

## 确定性模拟内核

```text
1 tick = 1 世界分钟 = 1 / 6 模拟秒
```

现实帧率只决定何时消费固定 tick，不改变结算顺序。主要 UI 读数合并刷新，避免显示层拖慢世界运行。

公开速度由正常世界循环驱动；隐藏测试入口要求先暂停正常循环：

```js
window.shengling.worldSpeedRuntime.advanceTestSeconds(seconds, { multiplier: 100 })
```

单次最多推进 36,000 ticks；0.1 测试秒在 100× 下精确推进 60 ticks。

## 生存经济事实链

### 动态目标库存

营地按人口、季节、天气、腐败、燃料、建造、农业和工具维护计算未来三日安全库存。

```text
有效库存 = 营地现货 + 人物背包 + 在途资源 - 已承诺物资
```

未启动任务需要的材料属于未来缺口；已经预留的材料属于承诺，不能重复计算。

### 统一资源流水

人物背包、营地库存、农田投入产出和工具耐久的真实变化进入同一流水系统：

```text
production / transfer / consumption / fuel
construction / spoilage / wear / repair / replacement
```

```js
window.shengling.resourceFlowSystem.list({ limit: 20 })
window.shengling.resourceFlowSystem.getDailySummary(year, day)
window.shengling.resourceFlowSystem.verify()
```

### 每日经济摘要

日报以流水、任务生命周期和库存快照为事实源，记录期初、期末、生产、消费、燃料、施工、维修、替换、腐败、农业种子、劳动、拒绝请求、目标缺口和账实差异。

```js
window.shengling.dailyEconomySystem.getCurrentReport()
window.shengling.dailyEconomySystem.getReport(year, day)
window.shengling.dailyEconomySystem.verify()
```

## 工具维护经济

工具拥有耐久、状态、代际、本代维修次数和本代磨损。石斧、搬运篮和简易农具维持最低一件可用的公共保障。

```text
磨损
→ 生成 repair 或 replace 需求
→ 预留目标工具与材料
→ 村民前往营地投入劳动
→ 原子扣料
→ 恢复耐久或推进代际
→ 写入生命周期、人物事实、流水和日报
```

工具维修与替换合计最多并发一个。材料不足、目标工具被占用、需求模式变化或代际变化都会使旧任务失败，但不会改变既有库存和工具状态。

## v0.29 粟种与播种事实链

- 粟种是营地、人物背包、农田投入、资源流水和日报中的真实物资。
- 第一块农田出现时，初始种子进入营地库存。
- 播种必须领取、运输并投入真实种子；失败与取消不会凭空消耗。
- 收获会按规则返种，种子目标随农田规模变化。
- 旧农田存档中的隐藏种子会迁移到营地库存。
- 无界面高速回放降低环境维护、人物历史复制和观察系统的长期成本。

## v0.30 世界动力引擎

每日封存经济报告后，世界动力系统计算：

### 压力

- 食物、饮水、木材和粟种目标缺口。
- 食物或饮水请求被拒绝。
- 食物腐败损失。
- 劳动任务积压。
- 土壤肥力退化。

压力保存严重度、持续日数、原因、证据、建议响应和开启/解除时间。

### 机会

- 食物或其他库存的真实富余。
- 雨天播种窗口。
- 成熟收获窗口。

机会会过期并进入历史，不直接创建任务。

### 共同承诺

持续压力达到门槛后会形成共同承诺；紧急生存拒绝可以立即形成承诺。承诺作为 `communityCommitment` 因子进入候选评分，单个候选最多增加 18 分。

承诺不能：

- 创建原本不存在的候选；
- 绕过路线、库存、预留和并发；
- 覆盖紧急饥渴、睡眠、篝火、建造、农业和工具保障的硬优先级；
- 修改已经发生的历史事实。

```js
window.shengling.worldDynamicsSystem.getSummary()
window.shengling.worldDynamicsSystem.listPressures({ state: 'active' })
window.shengling.worldDynamicsSystem.listOpportunities({ state: 'active' })
window.shengling.worldDynamicsSystem.listCommitments({ state: 'active' })
window.shengling.worldDynamicsSystem.verify()
```

## 验证体系

CI 持续执行：

- JavaScript 语法检查；
- 非回放单元测试；
- 生产构建；
- 第 30 日确定性回放；
- 第 60 日确定性回放；
- 真实移动 Chromium 核心交互；
- 隐藏 100× Chromium 冒烟测试；
- Day 60 batch 1 / 5 / 10 一致性审计；
- Day 120 batch 10 长期稳定性审计。

v0.30.0 封版验证中，Day 120 推进 171,600 ticks，世界动力、任务生命周期、资源流水、日报、工具、粟种和公共工具保障全部通过校验，无模拟错误或孤儿预留。

## 运行

```bash
npm ci
npm run check
npm test
npm run test:mobile-smoke
npm run build
npm run dev
```

`test:mobile-smoke` 需要 Chromium、Google Chrome 或 `CHROME_PATH`。

## 部署确认

1. 打开 GitHub Pages 页面，检查系统菜单中的版本和构建编号。
2. 访问 `/heping/version.json?cacheBust=任意新数字`。
3. 对比页面显示与 `version.json` 的 `buildId`、`sourceCommit`。

## 已知限制

- 存档保存在当前浏览器，没有跨设备云存档。
- 成功读档不会续接路径游标、已投入工时或中途动画，未完成任务会取消后重新规划。
- 石材、纤维和零部件产业尚未形成，工具配方仍主要使用木料。
- 石镐已进入维护体系，但正式采石行动和石材资源尚未实现。
- 休息、睡眠和空闲时间还没有形成完整时间预算。
- 草棚、储物棚和农田尚未成为寻路障碍。
- 共同承诺目前只覆盖部分生存、木材和储存响应。
- 自动 Chromium 不能完全替代真实 iPhone 安全区和浏览器外壳回归。

## 开发交接

开发前查阅 [`codex.md`](./codex.md)。每次有效更新后必须同步交接记录；影响 Pages 的发布还必须更新根目录 `version.json`。