<div align="center">

<img src="public/brand/tjm-ai-logo.png" alt="TJM" width="96" />

# TJM Design Studio

**ブラウザで動く Photoshop ライクなレイヤーエディタ。ツールを実際に使って作業するデザイン Agent 付き。**

[English](README.md) · [简体中文](README.zh-CN.md) · 日本語

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Browser](https://img.shields.io/badge/Chrome%20%2F%20Edge-113%2B%20(WebGPU)-4285F4)
![Engine](https://img.shields.io/badge/engine-Rust%20%E2%86%92%20WASM-orange)
![BYOK](https://img.shields.io/badge/AI-%E8%87%AA%E5%88%86%E3%81%AE%E3%82%AD%E3%83%BC-8A2BE2)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-コントリビュート)

[デモ](#-デモ) · [機能](#-機能) · [クイックスタート](#-クイックスタート) · [AI 設定](#-aiapi-キーは自分で用意) · [ライセンスと著作権](#-ライセンスと著作権)

</div>

---

## ✨ なぜ作ったか

多くの AI デザインツールは、1 枚に統合された画像を返すだけです。TJM Design Studio は違います。要望を伝えると、Agent が**あなたと同じ編集ツール**（テキスト、シェイプ、選択範囲、マスク、色調補正、レイヤースタイル）を使い、**レイヤーを 1 枚ずつ重ねて**デザインを組み立てます。どの手順も編集・取り消しができ、いつでも作業を引き継げます。

インストールもアカウントもサーバーも不要で、すべてブラウザのタブの中で動きます。

## 🚀 デモ

`https://<user>.github.io/tjm-design-studio-demo/`（`main` から GitHub Pages で公開）

- URL に `?mock=1` を付けると、内蔵のシミュレーションモデルで Agent の流れをひと通り試せます。キーは不要です。
- Chrome / Edge 113 以上が必要です（キャンバスの合成に WebGPU を使用）。

## 🧩 機能

| | |
| --- | --- |
| **レイヤー編集** | PSD/PSB、PNG、JPEG、WebP、TIFF などの読み込みと保存。レイヤー、マスク、調整レイヤー、フィルター、レイヤースタイル、テキスト、シェイプ、変形、複数ドキュメント、自動保存に対応。 |
| **文字エフェクト** | 12 種類のプリセット（ネオン、メタル、ゴールド、ステッカーなど）、ワープテキスト、立体文字。 |
| **スマート選択** | 被写体や焦点領域を選択し、その範囲だけを切り抜き・削除・色替え・色調補正。 |
| **デザイン Agent** | 要件分析 → 素材確認 → Skill 選択 → エディタのツールで実行 → プレビューで自己チェック。 |
| **AI 素材** | テキストから画像、画像から画像。生成結果は素材ライブラリに保存し、そこからキャンバスへ配置。 |
| **フォント** | 商用利用できる中国語・日本語・欧文フォント 19 種。初めて使うときにダウンロード。 |
| **タッチ・ペン** | iPad／スマホ用レイアウト、最初のタッチで全画面、ピンチでズーム、2 本指タップで取り消し。ペン使用時はペンで描画、指でキャンバス移動。タッチ描画・タッチ編集のシーンツール付き。 |

## ⚡ クイックスタート

```bash
git clone https://github.com/<user>/tjm-design-studio-demo.git
cd tjm-design-studio-demo
npm ci
npm run dev            # http://127.0.0.1:5191
```

```bash
npm test               # ユニットテスト
npm run smoke:demo     # Chrome での E2E（シミュレーションモデル + インターセプトした公式 API）
npm run build          # dist/ に静的サイトを出力
```

**自分のコピーを公開するには：** *Settings › Pages* で *Source* を *GitHub Actions* に設定します。以降は `main` に push するたびに、`.github/workflows/pages.yml` が自動でビルド・公開します。

## 🔑 AI：API キーは自分で用意

バックエンドはありません。Agent のワークフロー、Skill ライブラリ、素材ライブラリはページ内で動作し（sql.js を使って IndexedDB に保存）、各社の公式 API に直接接続します。

| プロバイダ | Agent | 画像生成 | キーの取得 |
| --- | :---: | :---: | --- |
| Google Gemini | ✅ | ✅ | aistudio.google.com |
| OpenAI | ✅ | ✅（GPT Image） | platform.openai.com |
| Anthropic Claude | ✅ | — | console.anthropic.com |
| Zhipu GLM | ✅ | ✅（CogView） | open.bigmodel.cn |
| DeepSeek | ✅（テキストのみ） | — | platform.deepseek.com |
| Alibaba Qwen（百炼） | ✅ | ✅（qwen-image） | bailian.console.aliyun.com |
| ByteDance Doubao（Ark） | ✅ | ✅（Seedream、AI レイヤー分解） | console.volcengine.com/ark |

> [!NOTE]
> ブラウザから直接呼び出せるかどうかはプロバイダの CORS 設定によります。「测试」で接続エラーになる場合はブラウザにブロックされている可能性が高いので、別のプロバイダをお使いください。

**AI 制图 → 配置 AI（自带 Key）** を開くか、`Ctrl/⌘+F` で「AI 设置」を検索します。キーを入力してモデルを選び、**能力探测**（接続テスト）で使えることを確認してください。

> [!IMPORTANT]
> キー、作品、素材は**このブラウザ内にのみ**保存されます。本プロジェクトはサーバーを持たないため、どこにも送信されません。公開デモでは**利用上限を設定した一時キー**を使い、使い終わったら削除してください。共用 PC にはキーを保存しないでください。

## 🗂 構成

```
src/                     エディタ（React + TypeScript）
src/engine/              エンジンブリッジ、文字エフェクト、選択範囲、レイアウトチェック
src/local/               ブラウザ内バックエンド（sql.js + IndexedDB、fetch インターセプタ）
src/local/backend/       Agent ワークフロー、ツール定義、Skill、モデルアダプタ
engine/                  Rust → WASM ブリッジのソース（PhotoCraft v0.6.0）
public/fonts/            フォントと各 OFL ライセンス
```

エンジンの再ビルドは任意です（ビルド済みのものを `src/engine/pkg/` に同梱）。再ビルドする場合は Rust（wasm32 ターゲット）と `wasm-bindgen-cli 0.2.129` を用意し、`engine/build.sh` を実行します。

## 🤝 コントリビュート

Issue と PR を歓迎します。PR を出す前に `npm test` と `npm run smoke:demo` を実行してください。コントリビュートした内容は Apache-2.0 で提供されるものとします（ライセンス第 5 条）。

## 📄 ライセンスと著作権

- **コード**：[Apache License 2.0](LICENSE)、Copyright 2026 TJM。商用を含め、利用・改変・再配布が自由にできます。条件は、ライセンスと [NOTICE](NOTICE) を残し、変更したファイルにその旨を明記することです。特許の許諾を含み、**保証は一切ありません**。
- **商標**：TJM の名称、`public/brand/` 内のロゴ、小文字の「tjm」ワードマークは本ライセンスの対象**外**です（Apache-2.0 第 6 条）。フォークや再配布の際は差し替えてください。公認を受けているかのような表示もしないでください。
- **サードパーティ**：PhotoCraft（MIT と Apache-2.0 のいずれかを選択可能）、vgpu、vgpu-optimized-black-hole、ag-psd、React、zustand、sql.js（MIT）。ライセンス本文は [`third_party/`](third_party) にあります。
- **フォント**：SIL Open Font License 1.1。ライセンスは各フォントフォルダにあります。商用を含むデザインへの使用や、書き出したファイルへの埋め込みは自由です。ただしフォントファイル単体の販売はできず、改変したフォントで予約フォント名を使うこともできません。
- **作品と AI 出力**：あなたが作った作品はあなたのものです。AI 生成物には、利用するプロバイダ（Google、OpenAI、Anthropic、Zhipu、DeepSeek、Alibaba、ByteDance）の規約も適用されます。API の利用料はあなた自身のアカウントに請求されます。アップロード・取り込みする素材（第三者サイトの画像を含む）については、必要な権利をお持ちであることをご自身でご確認ください。

<div align="center"><sub>「生成するだけ」でなく「編集してくれる」AI を求めるデザイナーのために。</sub></div>
