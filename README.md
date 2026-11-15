# 声格 VoiceDNA

角色口吻与对白质检台。网页入口：`001.html`。

## Gemini AI 接入

本项目通过 Vercel Serverless Function 调用 Gemini API，浏览器端不会接触 API Key。

### 1. 免费 API Key

在 [Google AI Studio](https://aistudio.google.com/api-keys) 创建 API Key。保持项目在 Gemini API **Free Tier**，不要关联付费结算账号，也不要点击 Upgrade / Set up billing。

当前函数固定使用 `gemini-3.8-flash`。模型可用性与免费额度以 AI Studio 中该项目的实际显示为准。

### 2. 本地运行

需要 Node.js 20 或更新版本。复制 `.env.example` 为 `.env.local`，并在 `.env.local` 中填写密钥：

```env
GEMINI_API_KEY=粘贴你自己的密钥
```

安装 Vercel CLI 并启动：

```bash
npm install
npm install -g vercel
npm run dev
```

打开 Vercel CLI 输出的本地地址，并访问 `/001.html`。

### 3. 部署

将仓库导入 Vercel，部署后在 Vercel 项目 Settings → Environment Variables 中添加：

- Name: `GEMINI_API_KEY`
- Value: 你的 Gemini API Key
- Environment: Production（测试时可同时勾选 Preview / Development）

保存后重新部署。网页与 `/api/voice` 后端必须部署在同一个 Vercel 项目中。

### 免费与隐私说明

- 只使用 Gemini Free Tier；不设置付费回退模型、不启用 Google Search grounding 等额外付费功能。
- 免费额度耗尽时接口会返回提示并停止请求，不会自动升级或自动扣费。
- 免费层的请求速率和每日额度由 Google 按项目/模型动态限制。
- Google 免费层可能使用提交内容改进其产品；请勿提交未公开剧本、个人敏感资料或保密内容。
- API Key 只能放在 Vercel 环境变量或本地未提交的 `.env` 文件中，绝不可写入 HTML 或提交到 GitHub。
- 函数包含基础 IP 频率限制；公开比赛展示前，建议进一步增加访问控制或更稳健的限流方案。
