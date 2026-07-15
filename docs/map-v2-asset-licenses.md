# Map V2 候选算法与素材许可记录

本文件记录候选来源，不代表已经导入。当前分支没有打包任何第三方算法、图片、精灵图或字体。

| ID | 来源仓库 | 计划用途 | 许可状态 | 当前决定 |
|---|---|---|---|---|
| `mapgen4` | `redblobgames/mapgen4` | 水文、生态区与地图数据分层参考 | Apache-2.0 | 候选；使用前保留许可与署名 |
| `simplex-noise` | `jwagner/simplex-noise.js` | 确定性连续地理场 | MIT | 候选；使用前锁定版本并保留许可 |
| `poisson-sampling` | `kchapelier/fast-2d-poisson-disk-sampling` | 植物、动物、岩石与建筑点位 | MIT | 候选；使用前锁定版本并保留许可 |
| `pixijs` | `pixijs/pixijs` | Map V2 分层渲染器 | MIT | 候选；尚未加入依赖 |
| `pixi-tilemap` | `pixijs-userland/tilemap` | 大批量瓦片渲染 | MIT | 候选；尚未加入依赖 |
| `wave-function-collapse` | `mxgmn/WaveFunctionCollapse` | 局部地块与装饰拼接算法 | 代码 MIT；示例素材需单独审查 | 只考虑算法，不复制示例素材 |
| `universal-lpc` | `LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator` | 人物身体、服装、头发与动作原料 | 逐素材混合许可 | 阻断；禁止整仓导入，必须逐项记录作者与许可 |

## 导入规则

1. 每一个第三方文件必须有唯一素材 ID、来源仓库、来源路径、作者、许可证、修改记录和署名文本。
2. `reviewStatus` 只有变为 `approved` 后才允许 `bundled: true`。
3. 混合许可素材按单文件审核，不能以仓库级许可证代替素材许可证。
4. 算法许可证与示例图片许可证分开处理。
5. 未能确认作者或许可的素材直接拒绝。
6. 正式构建应能生成完整第三方署名清单。

机器可校验记录位于 `src/modules/map-v2/mapV2AssetManifest.js`。
