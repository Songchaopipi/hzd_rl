# HZD 网页演示

两个独立的 MuJoCo 世界并排运行 WBO5 Teacher / HZD-Tube，同步接收
`[vx, vy, wz, T, torso_height]`。没有 swing-height command。
原 FADA 内容不再由主页引用，也不会打包到新的 dist 中。
已接入 15 段硬件视频和可交互实验图，内容与数据来源见 `WEB_DRAFT.md`。

## 公开发布

网站地址：https://hzd-humanoid.cs5816483.chatgpt.site

托管项目保存在 `.openai/hosting.json`，访问权限为公开。Git `origin` 是独立的网站源码仓库。
发布需要依次提交和推送源码、构建 `dist/`、保存版本并部署，单独 push 不会更新线上页面。
静态托管不依赖本地开发服务器运行。

## 启动

在本目录执行，Node.js 22：

```bash
npm ci
npm run dev -- --host 0.0.0.0 --port 5177
```

本机打开 http://localhost:5177/ ，仿真区域点击 Launch。
首次加载包含 MuJoCo、ONNX Runtime WASM 和 G1 网格。公开发布请使用 HTTPS。
网页完全在访客浏览器运行，不连接机器人、DDS、SSH 或训练服务。

## 控制

- 五个输入框/滑条对两侧同时生效。vx: [-1, 2]，vy/wz: [-1, 1]，T: [0.5, 1]，torso: [0.6, 0.85]。
- 播放/暂停、重置均同步。停止按钮只将 vx/vy/wz 置零，不暂停物理。
- Push Both 对两侧 torso 同时施加相同世界坐标外力，支持 +/-X、+/-Y、0--200 N、0.05--0.5 s。
- 鼠标拖动/滚轮调视角。触屏优先保留纵向页面滚动。
- 显示的是当前实测 base-frame vx/vy、base-frame z 角速度和世界坐标 torso 高度，不是 WBO 角速度或周期均值。
- Fallen 在 base 高度首次小于 0.35 m 后保持标记，直到手动 reset。没有隐藏自动重置或姿态滤波。

## 策略与控制接口

直接打包仓库中现有文件，不重新训练或修改 ONNX：
- Teacher: `deploy/robots/g1/config/policy/velocity/wbo5_teacher/exported/policy.onnx`
- Tube: `deploy/robots/g1/config/policy/velocity/wbo5_hzd_tube/exported/policy.onnx`

具体 SHA256、源路径、关节地址、PD 和 action scale 均记录在
`public/models/locomotion/manifest.json`。运行时检查 ONNX 和 XML 校验和。
当前是 102 输入、29 输出的 `wbo5_raw_102_v1`，WBO 预处理已包含在 ONNX 中。

输入顺序：
`base gyro(3), gravity(3), [vx,vy,0,0,wz,T,h](7), phase(2), q-default(29), dq(29), previous raw action(29)`。
零速门限与部署保持一致，phase 使用当前 T 和 episode-step 时钟。
每 0.02 s 推理一次，每次执行 4 个 0.005 s 力矩 PD 步。
不固定 floating base，不在网页端锁死躯干或手臂。

## 与原生仿真的边界

复用 `simulate/model_based/models/wbo5_g1.xml` 的物理参数，只修改网格搜索路径。
网页 MuJoCo WASM 为 **3.9.0**，原生 C++ 仓库头文件为 **3.3.6**，
打包工具当前使用 Python MuJoCo **3.11.0**（manifest 的 native_version 指该打包环境）。
因此同一状态下观测和 ONNX 输出可以逐值对照，但不能保证不同引擎版本的长时接触轨迹逐位一致。
网页适合交互展示，不替代论文统一环境下的定量评估。

两个世界始终前进相同数量的物理步。慢设备降低播放速度，绝不放大物理 timestep。
Speed 是仿真时间/墙钟时间。在无 GPU 的浏览器测试中可能明显低于实时，正式访问建议桌面 Chrome/Edge 开启硬件加速。

## 更新模型与论文素材

在仓库根目录，用含 mujoco、onnxruntime、numpy、pyyaml 的 Python：

```bash
python FADA-humanoid-main/scripts/prepare_assets.py
```

此命令复制当前 deployment bundle、G1 STL、论文框架图和摘要，
并生成 Python CPU ONNX 对照样本。修改来源后需重新测试。
公开页面没有使用模板中的作者、机构、录用信息或实验结果。

## 验证

在本目录：

```bash
python -m unittest discover -s tests -p test_assets.py
node --experimental-strip-types --test tests/math.test.mjs
npm run typecheck
npm run build
npx playwright install chromium
node tests/browser.mjs
python tests/check_pixels.py
```

浏览器测试默认使用正在运行的 localhost:5176，保存截图和数值到
`tests/artifacts/`。仅测试数值核心可用 `CORE_ONLY=1 node tests/browser.mjs`。
像素检查使用 Pillow。`node tests/retry.mjs` 测试下载失败后的重试，默认访问生产预览 4176。

生产预览：

```bash
npm run build
npm run preview -- --host 0.0.0.0 --port 4176
TEST_URL=http://localhost:4176/ node tests/browser.mjs
```

部署时只上传 `dist/` 到静态 HTTPS 托管。相对路径支持项目子目录。
无需 COOP/COEP 或后端。保留 WASM MIME 类型和完整模型目录。
