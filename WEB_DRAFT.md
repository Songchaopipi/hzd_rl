# HZD 网页初版

## 启动

```bash
cd /home/songchao/G1_basic_locomotion_research/unitree_rl_HZD/FADA-humanoid-main
npm run dev -- --host 0.0.0.0 --port 5177
```

入口：http://localhost:5177/ 。静态发布使用 `npm run build` 生成的 `dist/`。
正式入口迁移到 GitHub Pages，目标仓库 `Songchaopipi/hzd_rl`，发布状态以 GitHub Actions 部署结果为准。
旧 `chatgpt.site` 地址存在 403 访问问题，不再作为公开入口。发布步骤见 `PUBLISH_GITHUB.md`。

## 内容

- 硬件：15 段 HZD 视频，前后速度、侧移、转向、周期四组。前后组可选 0.4 / 0.8 / 1.0 m/s。
- 单独预留可变 torso 高度和 teacher 视频。不安排与 HZD 一一对应的 teacher 录制。
- 摘要、现有框架图，以及原有 Teacher / HZD-Tube 双 MuJoCo 网页仿真。
- 四维数轨道族：8 / 16 / 20 / 24D 切换，六组 PCA，相位滑块，图例筛选和读数。
- 24D 相位距离：切换六个指令，显示整周期变化和八个初值的 IQR。
- 距离饱和：受控扰动曲线、远场敏感度分布，以及真实 rollout 校准散点。
- 三策略跟踪：vx / vy / wz 切换，响应散点和完整时间域 RMSE 分布。
- 真实同脚返回、六轴/随机 6D 恢复：按 command、phase 和 push 类型筛选。
- 额外保留可展开的 24D learned Poincare 特征值图。

所有分析图均从保存的数据绘制，而非交互包装的 PNG。原始汇总数据和完整 PDF 提供下载。
图例可切换曲线，鼠标及键盘左右键可以查看曲线读数。

## 素材位置

- 硬件素材：`public/hzd/hardware/`，配置 `manifest.json`。
- 原始视频保留在 `/home/songchao/视频/hzd`，网页复制文件不裁剪画面。
- 视频部分包含操作人员接触机器人，标注为实验原始画面。文件名中的速度为指令而非实测速度。
- 分析数据：`public/hzd/evidence/`，结构和来源见其中 `SCHEMA.md`。
- 页面入口：`src/App.tsx`。
- 视频组件：`src/research/Hardware.tsx`。
- 图表组件：`src/research/Evidence.tsx`、`Recovery.tsx`、`Spectra.tsx`、`Plot.tsx`。
- 新版样式：`src/styles/research.css`。

硬件视频不自动对应仿真分析中的历史 checkpoint。网页在线仿真使用 WBO5 部署模型，论文分析的模型来源分别记录在 JSON 中。
保留 yaw 欠跟踪、0.8 m/s 直行严格恢复偏弱等结果，不把回到宽 tube 等同于精确恢复。

## 检查

```bash
npm run build
TEST_URL=http://localhost:5177/ node tests/research-page.mjs
TEST_URL=http://localhost:5177/ node tests/browser.mjs
```
