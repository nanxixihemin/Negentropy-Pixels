# 🌌 Negentropy Pixels (负熵像素)

An elegant, high-performance, full-stack AI conversation and image generation web application. Designed with modern neo-brutalist and glassmorphic aesthetics, Negentropy Pixels integrates multi-model AI dialog ("勾勒"), text-to-image and image-to-image workflows ("炼金"), community resonance galleries ("共振"), secure SQLite session database persistence, and robust administrative tools.

一款优雅、高性能的全栈 AI 对话与图像生成 Web 应用。采用现代新粗野主义（Neo-brutalist）与毛玻璃（Glassmorphism）视觉设计，负熵像素集成了多模型 AI 对话（“勾勒”）、文生图与图生图工作流（“炼金”）、社区共振画廊（“共振”）、基于 SQLite 的安全会话持久化存储，以及完善的管理员后台管理系统。

---

## ✨ Key Features (核心特性)

### AI Chat & Alchemy (AI 对话与“勾勒”)
- **Multi-Model Support**: Switch between Gemini (official API) and OpenAI-compatible endpoints (e.g. SiliconFlow, DeepSeek, etc.) dynamically.
- **SQLite Session Persistence**: All conversation histories and message streams are persisted securely in a local SQLite database, replacing ephemeral browser storage.
- **Auto-Naming Sessions**: Conversation sessions automatically rename themselves based on your first prompt message.
- **API Key Decoupling**: Configure credentials via unified client settings. API keys can be supplied by the user dynamically or securely injected by the server.

### AI Image Generation ("炼金"生图)
- **Generative Modes**: Supports both Text-to-Image (txt2img) and Image-to-Image (img2img) modes.
- **Preset Custom Styles**: Built-in artistic styles (Anime, Oil Painting, Watercolor, Cyberpunk, Ghibli, Pixel Art, Pencil Sketch, Photorealistic) with easy customization.
- **Quality & Aspect Ratios**: Choose from multiple detail levels (Default, HD, Ultra, Extreme) and aspect ratios (1:1, 16:9, 9:16, 4:3, 3:4) mapped to standard resolution parameters.
- **Smart Timeout Handling**: Automatically catches upstream server timeouts (status 524/504) and presents descriptive warnings instead of raw HTML pages.

### Resonance Gallery & Imprints (共振广场与个人印记)
- **Minimalist Grid Cards**: Gallery cards display only the thumbnail, optional "波源" (Featured) badge, and the creator avatar/nickname (defaults to "匿名" for privacy).
- **Interactive Details Modal**: Clicking cards triggers a popup displaying the full image, creator info, sharing caption, and the prompt (featuring one-click clipboard copying and "Use Prompt" reuse).
- **Personal Imprints**: Local history acts as a gallery of your creation traces ("个人印记") with SQLite-backed recovery.

### User Settings & Password Recovery (设置与账号系统)
- **Unified Settings Dashboard**: Glassmorphic dual-column layout combines API credentials and model configuration on the left with account management on the right.
- **Secure Password Reset**: Email-based registrations include security questions (e.g. favorite food, pet's name, city of birth) enabling zero-email password recovery.

### Admin Panel (管理员后台)
- **Shared Gallery Moderation**: Pin outstanding works as featured ("波源") or delete inappropriate content.
- **Imprints Overview**: Monitor and inspect overall usage.
- **Interactive Card Actions**: Administrative operations intercept card click triggers to prevent accidental details modal popups.

---

## Tech Stack (技术栈)

- **Frontend (前端)**: React 19, Vite, React Router DOM, Custom Vanilla CSS. Built as a high-performance single-file web app output.
- **Backend (后端)**: Node.js (ES Modules), Native HTTP server.
- **Database (数据库)**: Native SQLite via `node:sqlite` (introduced in Node.js 22.x).
- **Asset Routing**: Custom `/uploads/` static assets routing mapped to local filesystem storage.

---

## Local Quickstart (本地快速启动)

### Prerequisites
- Node.js version **22.5.0** or above (required for native `node:sqlite` support).

### 1. Clone the Repository
```bash
git clone https://github.com/nanxixihemin/001_Negentropy-Pixels.git
cd 001_Negentropy-Pixels
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Setup Environment Variables
Create a `.env` file in the root directory:
```env
# Server running port
PORT=3000

# Server-hosted API Keys (Optional, fallback if client leaves empty)
GEMINI_API_KEY=your_gemini_key_here
SILICON_API_KEY=your_silicon_flow_key_here
```

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## VPS Production Deployment (云服务器部署指南)

Since `/dist` is compiled locally and git-ignored, follow these steps to build and run production on your VPS:

### 1. Pull Latest Source
```bash
git pull origin main
```

### 2. Build Web Bundle
Compile the React single-file bundle into `dist/index.html`:
```bash
npm run build
```

### 3. Start or Restart with PM2
```bash
# Start for the first time
pm2 start server.mjs --name banana

# Or restart the running service
pm2 restart banana
```

### 4. Configure Nginx Reverse Proxy
To prevent `Gateway Time-out` (504/524) errors during slow image generation requests, adjust proxy timeout limits in Nginx (typically located in `/etc/nginx/sites-enabled/negentropy`):

```nginx
server {
    server_name negentropypixels.me www.negentropypixels.me;

    # Set proxy timeouts to 5 minutes (300 seconds)
    proxy_connect_timeout 300s;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded-for;
    }
}
```
Reload Nginx:
```bash
sudo nginx -t
sudo systemctl restart nginx
```

---

##  License
Private Repository. All rights reserved.
