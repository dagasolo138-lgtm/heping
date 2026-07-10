# v0.25.3.1 验证记录

已在隔离 Node 环境执行：

- `node --check`：`actionRuntimeSnapshot.js`、`worldSaveSystem.js`、`buildingSystem.js`
- `worldSaveTransaction.test.js` 与 `loadRollbackHardening.test.js`：6/6 通过

覆盖：

1. 失败读档恢复长期状态并恢复模拟循环。
2. 失败读档不重建行动代理。
3. 建筑 `reserved/carried` 瞬时预留由检查点恢复。
4. 被中断睡眠清除 `sleeping/sheltered/exposed` 临时标签。
5. 成功读档仍只重建一次运行时。
6. 顶层格式与缺失导入器继续在停止模拟前拒绝。

当前执行环境无法解析 `github.com`，因此未重新克隆完整仓库执行 Vite 构建；v0.25.3 原专项与事务回归 13/13 已在其合并 PR 中通过。
