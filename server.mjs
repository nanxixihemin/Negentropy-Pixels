// 统一服务器 - 同时提供网页和 API 代理
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Buffer } from 'buffer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 3031;
const API_TARGET = 'https://generativelanguage.googleapis.com';

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
    // 添加 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const SERVER_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyA0Vi6KGzqUpFCJ0-5BA1Ks1YIPT6cBYIw'; // Set your backend key here

    // API 代理 - 转发 /v1 和 /v1beta 请求
    if (req.url.startsWith('/v1')) {
        try {
            // Construct target URL
            const targetUrlObj = new URL(API_TARGET + req.url);

            // Inject API Key if not present
            if (!targetUrlObj.searchParams.has('key')) {
                targetUrlObj.searchParams.append('key', SERVER_API_KEY);
            }

            const targetUrl = targetUrlObj.toString();

            // 收集请求体
            let body = '';
            for await (const chunk of req) {
                body += chunk;
            }

            const proxyRes = await fetch(targetUrl, {
                method: req.method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': req.headers.authorization || '',
                },
                body: req.method !== 'GET' ? body : undefined,
            });

            const data = await proxyRes.text();
            res.writeHead(proxyRes.status, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            });
            res.end(data);
        } catch (err) {
            console.error('API 代理错误:', err.message);
            res.writeHead(502);
            res.end(JSON.stringify({ error: 'API 代理失败: ' + err.message }));
        }
        return;
    }

    // ============ AI 提示词炼金术 API ============
    // POST /api/refine-prompt - 使用 SiliconFlow 重构提示词
    if (req.url === '/api/refine-prompt' && req.method === 'POST') {
        console.log('[Alchemy] 收到炼金请求 (SiliconFlow)');
        try {
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            const body = JSON.parse(Buffer.concat(chunks).toString());
            const { prompt, apiKey, apiUrl } = body;

            if (!prompt) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '请输入提示词' }));
                return;
            }

            if (!apiKey) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '请先配置 API Key' }));
                return;
            }

            // 构建 SiliconFlow (OpenAI Compatible) API 请求
            const siliconFlowBaseUrl = 'https://api.siliconflow.cn/v1';
            const endpoint = `${siliconFlowBaseUrl}/chat/completions`;

            // 使用免费/高性价比模型
            const modelName = 'deepseek-ai/DeepSeek-V3';

            const systemPrompt = `你是一个专业的 AI 图像生成提示词工程师。用户会给你一个简单的想法，你需要将其扩展成一个详细、富有艺术感的图像生成提示词（English）。请直接返回提示词，不要啰嗦。`;

            const requestBody = {
                model: modelName,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: prompt }
                ],
                stream: false,
                max_tokens: 512,
                temperature: 0.7
            };

            console.log(`[Alchemy] 调用 SiliconFlow (${modelName})...`);

            const llmRes = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            const rawText = await llmRes.text();

            if (!llmRes.ok) {
                console.log(`[Alchemy] 错误响应 (Status: ${llmRes.status}):`, rawText.substring(0, 200));
                res.writeHead(llmRes.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `SiliconFlow Error: ${llmRes.status}` }));
                return;
            }

            let llmData;
            try {
                llmData = JSON.parse(rawText);
            } catch (e) {
                console.error(`[Alchemy] 响应不是 JSON:`, rawText);
                throw new Error(`Invalid JSON response from LLM`);
            }

            const refinedPrompt = llmData.choices?.[0]?.message?.content?.trim();

            if (!refinedPrompt) {
                console.error('[Alchemy] 无法解析响应:', llmData);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '无法解析 LLM 响应' }));
                return;
            }

            console.log('[Alchemy] 炼金成功:', refinedPrompt.substring(0, 50) + '...');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ refinedPrompt }));

        } catch (err) {
            console.error('[Alchemy] 内部错误:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '炼金失败: ' + err.message }));
        }
        return;
    }

    // ============ Conversational Alchemy (Co-pilot) API ============
    if (req.url === '/api/alchemy-chat' && req.method === 'POST') {
        console.log('[Alchemy-Chat] 收到对话请求');
        try {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const { messages, apiKey } = JSON.parse(Buffer.concat(chunks).toString());

            const systemPrompt = `你是一个专业的 AI 图像生成提示词专家副驾驶。
你的任务是通过与用户对话，通过一步一问的方式，引导用户补全画面的细节（颜色、构图、光影、材质等）。
规则：
1. 保持回复简短，每次只问一个问题。
2. 即使已经有了初步构思，也要尝试追问。
3. 当你觉得细节足够丰富，或者用户表示满意时，请输出最终提示词。
4. 最终结果必须包裹在 <final_prompt> 标签中，例如: <final_prompt>A highly detailed oil painting of a cat...</final_prompt>。
5. 最终提示词必须是英文。`;

            const requestBody = {
                model: 'deepseek-ai/DeepSeek-V3',
                messages: [
                    { role: "system", content: systemPrompt },
                    ...messages
                ],
                stream: false,
                temperature: 0.7
            };

            const llmRes = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            const data = await llmRes.json();
            if (!llmRes.ok) throw new Error(data.error?.message || 'LLM 请求失败');

            const content = data.choices[0].message.content;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ content }));

        } catch (err) {
            console.error('[Alchemy-Chat] 错误:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // --- AI Chat Route (New) ---
    if (req.url === '/api/chat' && req.method === 'POST') {
        console.log('[Chat] 收到对话请求');
        try {
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            const body = JSON.parse(Buffer.concat(chunks).toString());
            const { messages, apiKey, apiUrl } = body;

            if (!messages || !Array.isArray(messages)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '无效的消息格式' }));
                return;
            }

            if (!apiKey) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '请先配置 API Key' }));
                return;
            }

            // Proxy Logic (Dynamic)
            let geminiBaseUrl = 'http://127.0.0.1:8045/v1beta';
            if (apiUrl && apiUrl.startsWith('http')) {
                try {
                    const urlObj = new URL(apiUrl);
                    geminiBaseUrl = `${urlObj.origin}/v1beta`;
                } catch (e) {
                    console.warn('[Chat] 解析 apiUrl 失败，回退默认');
                }
            }

            const modelName = 'gemini-1.5-flash';
            const endpoint = `${geminiBaseUrl}/models/${modelName}:generateContent?key=${apiKey}`;

            // Convert Chat History to Gemini Format
            const contents = messages.map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }]
            }));

            const requestBody = {
                contents: contents,
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1000
                }
            };

            const llmRes = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            const rawText = await llmRes.text();
            let llmData;
            try {
                llmData = JSON.parse(rawText);
            } catch (e) {
                throw new Error(`LLM 返回无效数据: ${rawText.substring(0, 50)}`);
            }

            if (!llmRes.ok) {
                console.error('[Chat] LLM 错误:', llmData);
                throw new Error(llmData.error?.message || 'Chat 请求失败');
            }

            const reply = llmData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (!reply) {
                throw new Error('无效的 LLM 响应');
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ reply }));
            return;

        } catch (error) {
            console.error('[Chat] 请求处理失败:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message || '服务器错误' }));
            return;
        }
    }

    // ============ 共享画廊 API ============
    const GALLERY_DIR = path.join(__dirname, 'server-data', 'gallery');
    const GALLERY_META = path.join(__dirname, 'server-data', 'gallery.json');

    // 确保目录存在
    if (!fs.existsSync(path.join(__dirname, 'server-data'))) {
        fs.mkdirSync(path.join(__dirname, 'server-data'));
    }
    if (!fs.existsSync(GALLERY_DIR)) {
        fs.mkdirSync(GALLERY_DIR);
    }
    if (!fs.existsSync(GALLERY_META)) {
        fs.writeFileSync(GALLERY_META, '[]');
    }

    // POST /api/share - 分享图片到广场
    if (req.url === '/api/share' && req.method === 'POST') {
        console.log('[API] 收到分享请求');
        try {
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            const bodyBuffer = Buffer.concat(chunks);
            console.log(`[API] 请求体大小: ${bodyBuffer.length} bytes`);

            const body = bodyBuffer.toString();
            if (!body) {
                console.error('[API] 请求体为空');
                throw new Error('Empty request body');
            }

            const { image, prompt, author, deviceId, caption } = JSON.parse(body);
            console.log('[API] 解析成功, Author:', author, 'Prompt:', prompt?.substring(0, 20));

            if (!image) {
                console.warn('[API] 缺少图片数据');
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '缺少图片数据' }));
                return;
            }

            // 解析 base64 图片
            const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
            if (!matches) {
                console.error('[API] 图片格式无效 (Expect data:image/...) startswith:', image.substring(0, 50));
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '无效的图片格式 (请确保图片加载完成)' }));
                return;
            }

            const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
            const base64Data = matches[2];
            console.log(`[API] 解析图片格式: ${ext}, 数据长度: ${base64Data.length}`);

            const id = Date.now().toString();
            const filename = `${id}.${ext}`;

            // 保存图片文件
            console.log(`[API] 保存文件: ${filename}`);
            fs.writeFileSync(path.join(GALLERY_DIR, filename), Buffer.from(base64Data, 'base64'));

            // 更新元数据
            const meta = JSON.parse(fs.readFileSync(GALLERY_META, 'utf-8'));
            meta.unshift({
                id,
                filename,
                prompt: prompt || '',
                author: author || null,
                deviceId: deviceId || null,
                caption: caption || null,
                timestamp: Date.now()
            });
            // 限制最多保存 100 张
            if (meta.length > 100) meta.pop();
            fs.writeFileSync(GALLERY_META, JSON.stringify(meta, null, 2));

            console.log('[API] 分享成功');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, id }));
        } catch (err) {
            console.error('[API] 分享内部错误:', err);
            // Ensure headers haven't been sent
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '服务器内部错误: ' + err.message }));
            }
        }
        return;
    }

    // GET /api/gallery - 获取共享图片列表
    if (req.url === '/api/gallery' && req.method === 'GET') {
        try {
            const meta = JSON.parse(fs.readFileSync(GALLERY_META, 'utf-8'));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(meta));
        } catch (err) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('[]');
        }
        return;
    }

    // DELETE /api/gallery/:id - 删除共享图片
    const deleteMatch = req.url.match(/^\/api\/gallery\/(\d+)$/);
    if (deleteMatch && req.method === 'DELETE') {
        try {
            const idToDelete = deleteMatch[1];

            // 读取请求体获取 deviceId
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            const body = Buffer.concat(chunks).toString();
            const { deviceId } = JSON.parse(body);

            // 读取元数据
            const meta = JSON.parse(fs.readFileSync(GALLERY_META, 'utf-8'));
            const itemIndex = meta.findIndex(item => item.id === idToDelete);

            if (itemIndex === -1) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: '图片不存在' }));
                return;
            }

            const item = meta[itemIndex];

            // 验证设备ID
            if (item.deviceId !== deviceId) {
                res.writeHead(403);
                res.end(JSON.stringify({ error: '只能删除自己分享的图片' }));
                return;
            }

            // 删除图片文件
            const filePath = path.join(GALLERY_DIR, item.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            // 更新元数据
            meta.splice(itemIndex, 1);
            fs.writeFileSync(GALLERY_META, JSON.stringify(meta, null, 2));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (err) {
            console.error('删除错误:', err);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // 静态服务 - 共享图片访问
    if (req.url.startsWith('/uploads/')) {
        const filename = req.url.replace('/uploads/', '');
        const filePath = path.join(GALLERY_DIR, filename);

        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(404);
                res.end('Not Found');
            } else {
                const ext = path.extname(filePath);
                res.writeHead(200, {
                    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
                    'Cache-Control': 'public, max-age=86400'
                });
                res.end(content);
            }
        });
        return;
    }

    // 静态文件服务
    let filePath = path.join(__dirname, 'dist', req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath);

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // 单页应用回退到 index.html
                fs.readFile(path.join(__dirname, 'dist', 'index.html'), (err2, content2) => {
                    if (err2) {
                        res.writeHead(404);
                        res.end('Not Found');
                    } else {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(content2);
                    }
                });
            } else {
                res.writeHead(500);
                res.end('Server Error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
            res.end(content);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('🌌 Negentropy Server Started!');
    console.log(`📍 本地访问: http://localhost:${PORT}`);
    console.log(`🌐 通过 ngrok 暴露: ngrok http ${PORT}`);
    console.log('');
    console.log('确保你的 API 服务在 127.0.0.1:8045 运行中');
});
