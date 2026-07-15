# v0.32 第一步：Map V2 隔离层

## 目标

在不改变现有世界行为、存档格式、A* 寻路和 Canvas 地图显示的前提下，为后续程序化地图与新渲染器建立独立边界。

## 当前状态

- 现有 `mapSystem` 仍是唯一模拟地图事实源。
- 现有 `mapView` 仍是唯一玩家地图渲染器。
- Map V2 默认模式固定为 `legacy`，预览未启用。
- Map V2 只能创建只读预览计划，不能写入地图、人物、建筑、农田、道路或存档。
- 世界存档 schema 保持 `1`，确定性基准不应变化。

## 新增模块

- `src/modules/map-v2/mapV2Boundary.js`：隔离边界、种子规范化、预览计划和总校验。
- `src/modules/map-v2/mapV2LayerCatalog.js`：十层地图事实与显示目录。
- `src/modules/map-v2/mapV2AssetManifest.js`：候选算法、渲染器和素材许可状态。
- `src/bootstrap/attachMapV2Runtime.js`：将只读 API 挂接为 `window.shengling.mapV2Runtime`。

## 运行时接口

```js
window.shengling.mapV2Runtime.getState()
window.shengling.mapV2Runtime.getLayers()
window.shengling.mapV2Runtime.getAssetCandidates()
window.shengling.mapV2Runtime.createPreviewPlan({ seed: 'valley-42' })
window.shengling.mapV2Runtime.verify()
```

`createPreviewPlan()` 只返回未来生成计划，其中 `enabled` 和 `appliesToSimulation` 固定为 `false`，并明确保留旧地图和旧渲染器回退。

## 图层边界

1. 基础地表
2. 地形过渡
3. 道路
4. 农田
5. 建筑
6. 低矮植物
7. 人物与动物
8. 高层遮挡
9. 天气与光照
10. 诊断覆盖层

每一层必须标明事实源和职责。渲染层不得反向修改模拟事实。

## 验收条件

- Map V2 边界结构校验通过。
- 图层 ID 唯一且顺序严格递增。
- 未审核素材不能被标记为已打包。
- 混合许可 LPC 素材继续保持阻断状态。
- 旧地图仍使用 `shengling-starting-valley-v1`。
- 不新增持久化字段，不改变世界推进顺序。

## 下一步

第二步在该边界内部实现确定性地理场：海拔、湿度、肥力、温度与崎岖度。生成结果先作为离线快照验证，仍不接管当前世界。
