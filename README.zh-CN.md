<div align="center">

<img src="public/brand/tjm-ai-logo.png" alt="TJM" width="96" />

# TJM Design Studio

**浏览器里的类 Photoshop 图层编辑器，配一个真正会用工具的设计 Agent。**

[English](README.md) · 简体中文 · [日本語](README.ja.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Browser](https://img.shields.io/badge/Chrome%20%2F%20Edge-113%2B%20(WebGPU)-4285F4)
![Engine](https://img.shields.io/badge/engine-Rust%20%E2%86%92%20WASM-orange)
![BYOK](https://img.shields.io/badge/AI-%E8%87%AA%E5%B8%A6%20Key-8A2BE2)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-参与贡献)

[在线体验](#-在线体验) · [功能](#-功能) · [快速开始](#-快速开始) · [AI 配置](#-ai自带-key) · [协议与版权](#-协议与版权)

</div>

---

## ✨ 为什么做这个

大多数 AI 设计工具交给你的是一张拍平的图。TJM Design Studio 不一样：你描述需求，Agent 用和你**一样的编辑工具**（文字、形状、选区、蒙版、调整、图层样式）**一层一层把设计搭出来**。每一步都可以编辑、可以撤销，你随时能接手继续改。

不用安装，不用注册，也没有服务器，一切都在你的浏览器标签页里运行。

## 🚀 在线体验

`https://<用户名>.github.io/tjm-design-studio-demo/`（由 GitHub Pages 从 `main` 分支发布）

- 地址后加 `?mock=1`，可以用内置的模拟模型体验完整的 Agent 流程，不需要 Key。
- 需要 Chrome 或 Edge 113 以上版本（画布用 WebGPU 合成）。

## 🧩 功能

| | |
| --- | --- |
| **图层编辑** | 打开和保存 PSD/PSB、PNG、JPEG、WebP、TIFF 等格式。支持图层、蒙版、调整图层、滤镜、图层样式、文字、形状、变换，可多文档同时编辑，并自动保存。 |
| **文字特效** | 12 种预设（霓虹、金属、金色、贴纸……），支持文字变形和立体字。 |
| **智能选区** | 选择主体或焦点区域后，只对这块区域做抠图、移除、换色或调色。 |
| **设计 Agent** | 分析需求 → 检查素材 → 匹配 Skill → 用编辑器工具执行 → 预览自检。 |
| **AI 素材** | 文生图、图生图，结果进入素材库，再放到画布上。 |
| **字体库** | 19 套可商用的中日英字体，第一次用到时才下载。 |
| **触屏与触控笔** | iPad／手机布局，首次触摸自动全屏，双指缩放，双指轻点撤销；使用触控笔时笔画画、手指移动画布。场景工具含「触摸绘图」「触摸编辑」。 |

## ⚡ 快速开始

```bash
git clone https://github.com/<用户名>/tjm-design-studio-demo.git
cd tjm-design-studio-demo
npm ci
npm run dev            # http://127.0.0.1:5191
```

```bash
npm test               # 单元测试
npm run smoke:demo     # Chrome 端到端测试（模拟模型 + 拦截的官方接口）
npm run build          # 生成静态站点到 dist/
```

**发布你自己的一份：** 在仓库 *Settings › Pages* 中把 *Source* 设为 *GitHub Actions*。之后每次推送到 `main`，都会由 `.github/workflows/pages.yml` 自动构建并发布。

## 🔑 AI：自带 Key

本项目没有后台。Agent 的工作流、Skill 库和素材库都在页面里运行（数据用 sql.js 存进 IndexedDB），页面直接连接各家的官方接口：

| 服务商 | Agent | 生图 | 申请 Key |
| --- | :---: | :---: | --- |
| Google Gemini | ✅ | ✅ | aistudio.google.com |
| OpenAI | ✅ | ✅（GPT Image） | platform.openai.com |
| Anthropic Claude | ✅ | — | console.anthropic.com |
| 智谱 GLM | ✅ | ✅（CogView） | open.bigmodel.cn |
| DeepSeek | ✅（仅文本） | — | platform.deepseek.com |
| 通义千问（百炼） | ✅ | ✅（qwen-image） | bailian.console.aliyun.com |
| 豆包（火山方舟） | ✅ | ✅（Seedream、AI 拆层） | console.volcengine.com/ark |

> [!NOTE]
> 服务商能否在浏览器里直接调用取决于它的跨域（CORS）策略；「测试」报连接失败时多半是被浏览器拦截，请换用其他服务商。

打开 **AI 制图 → 配置 AI（自带 Key）**，或按 `Ctrl/⌘+F` 搜索「AI 设置」。填好 Key、选好模型后，点 **能力探测** 确认可用。

> [!IMPORTANT]
> Key、作品和素材**只保存在当前浏览器**。本项目没有服务器，不会把它们发到任何地方。公开体验时请用**设置了用量上限的临时 Key**，用完清除；在公共电脑上不要保存 Key。

## 🗂 目录结构

```
src/                     编辑器（React + TypeScript）
src/engine/              引擎桥接、文字特效、选区、版式检查
src/local/               浏览器内后台（sql.js + IndexedDB，拦截 fetch 请求）
src/local/backend/       Agent 工作流、工具清单、Skill、模型适配
engine/                  Rust → WASM 桥接源码（PhotoCraft v0.6.0）
public/fonts/            字体及各自的 OFL 许可
```

重新编译引擎是可选的，仓库已在 `src/engine/pkg/` 附带编译好的版本。如需自己编译，先安装 Rust（wasm32 目标）和 `wasm-bindgen-cli 0.2.129`，再运行 `engine/build.sh`。

## 🤝 参与贡献

欢迎提 Issue 和 PR。提交 PR 前请先运行 `npm test` 和 `npm run smoke:demo`。提交贡献即表示你同意以 Apache-2.0 授权你的贡献（见协议第 5 条）。

## 📄 协议与版权

- **代码**：[Apache License 2.0](LICENSE)，Copyright 2026 TJM。可以免费使用、修改、分发，包括商用。条件是保留许可证和 [NOTICE](NOTICE) 文件，并标明你改过哪些文件。协议附带专利授权，且**不提供任何担保**。
- **商标**：TJM 名称、`public/brand/` 中的标志以及小写「tjm」字标**不在**本协议授权范围内（Apache-2.0 第 6 条）。Fork 或再分发时必须替换，也不得暗示得到了我们的认可。
- **第三方代码**：PhotoCraft（MIT 或 Apache-2.0 二选一），以及 vgpu、vgpu-optimized-black-hole、ag-psd、React、zustand、sql.js（均为 MIT）。许可原文见 [`third_party/`](third_party)。
- **字体**：SIL Open Font License 1.1，许可文件放在每个字体目录里。可以免费用于设计作品，包括商用和嵌入导出文件；但不能单独出售字体文件，修改后的字体不能沿用保留的字体名称。
- **你的作品与 AI 内容**：你创作的内容归你所有。AI 生成内容还要遵守你所用服务商（Google、OpenAI、Anthropic、智谱、DeepSeek、阿里云、字节跳动）的使用条款，接口费用由你自己的账户支付。你上传或导入的素材（包括来自第三方网站的图片）需要你自己确认拥有相应权利。

<div align="center"><sub>为想要「AI 帮我改图」而不只是「AI 帮我生图」的设计师而做。</sub></div>
