# GitHub Pages 发布

## 目标

- 网页仓库：`Songchaopipi/hzd_rl`，Public。
- 预期网址：`https://songchaopipi.github.io/hzd_rl/`。
- 首次发布状态以 GitHub Actions 部署结果为准，仓库已由用户创建。

## 首次设置

1. 使用 https://github.com/Songchaopipi/hzd_rl 网页仓库。
2. 仓库 Settings > Pages > Build and deployment > Source 选择 **GitHub Actions**。
3. 只推送当前网页目录的已跟踪文件，不能在上级训练仓库执行 `git add .`。

本机具有该 GitHub 仓库写入认证后，在本目录执行：

```bash
git remote add github git@github.com:Songchaopipi/hzd_rl.git
git push -u github main
```

`origin` 暂时保留历史 Sites 托管仓库。若 `github` 已存在，先用 `git remote -v` 核对地址，不重复添加。
不要把 GitHub token 写进 remote URL、脚本或聊天。

## 自动发布与验证

`.github/workflows/deploy.yml` 在 main push 时执行 Node.js 22 下的 `npm ci` 和 `npm run build`，
然后将 `dist/` 作为 Pages artifact 发布。构建仅复制 HZD 素材和 locomotion 模型，不复制原 FADA 视频。
Vite 使用相对资源路径，支持 `/hzd_rl/` 子路径。

只有 Actions 中部署成功、匿名浏览器也能访问后，才把该地址作为已上线网站分发。
除首页外还应检查硬件视频、交互图表、双策略 MuJoCo 的 WASM/ONNX 加载与运行。

```bash
TEST_URL=https://songchaopipi.github.io/hzd_rl/ node tests/research-page.mjs
TEST_URL=https://songchaopipi.github.io/hzd_rl/ SCENE_SMOKE_SECONDS=1 node tests/browser.mjs
python tests/check_pixels.py
```

GitHub Pages 也不能保证所有网络都无障碍访问，不能只凭单个代理出口的测试作出这类承诺。

官方说明：https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
