// 统一服务器 - 同时提供网页和 API 代理
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Buffer } from 'buffer';
import 'dotenv/config';
import { createGalleryRepository } from './server/repositories/galleryRepository.mjs';
import { createImprintRepository } from './server/repositories/imprintRepository.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 3031;
const API_TARGET = 'https://generativelanguage.googleapis.com';
const DATA_DIR = path.join(__dirname, 'server-data');
const GALLERY_DIR = path.join(DATA_DIR, 'gallery');
const GALLERY_META = path.join(DATA_DIR, 'gallery.json');
const DATABASE_PATH = path.join(DATA_DIR, 'negentropy.db');
const galleryRepository = createGalleryRepository({
    dataDir: DATA_DIR,
    dbPath: DATABASE_PATH,
    legacyMetaPath: GALLERY_META,
    maxItems: 100
});
const imprintRepository = createImprintRepository({
    dataDir: DATA_DIR,
    dbPath: DATABASE_PATH,
    maxItems: 20
});

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

// 通用 LLM 调用辅助函数 - 兼容 Gemini 和 OpenAI-compatible (GPT) 接口
async function callLLMChat({ messages, apiKey, apiUrl, model }) {
    const isGemini = (!apiUrl || apiUrl.includes('googleapis.com') || (model && model.startsWith('gemini')));
    console.log(`[LLMChat] Request - Model: ${model || 'default'}, Url: ${apiUrl || 'default'}, isGemini: ${isGemini}`);

    if (isGemini) {
        const resolvedApiKey = apiKey || process.env.GEMINI_API_KEY;
        if (!resolvedApiKey) {
            throw new Error('未配置 Gemini API Key');
        }

        let baseUrl = 'https://generativelanguage.googleapis.com';
        if (apiUrl && apiUrl.startsWith('http')) {
            baseUrl = apiUrl.replace(/\/$/, '');
        }

        const modelName = model || 'gemini-1.5-flash';
        const apiPath = baseUrl.includes('/v1beta') ? '' : '/v1beta';
        const endpoint = `${baseUrl}${apiPath}/models/${modelName}:generateContent?key=${resolvedApiKey}`;

        const systemMessage = messages.find(m => m.role === 'system');
        const contents = messages
            .filter(m => m.role !== 'system')
            .map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }]
            }));

        const requestBody = {
            contents,
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1000
            }
        };

        if (systemMessage) {
            requestBody.systemInstruction = {
                parts: [{ text: systemMessage.content }]
            };
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error?.message || `Gemini API Error: ${response.statusText}`);
        }

        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (!reply) {
            throw new Error('未在 Gemini 响应中找到文本数据');
        }
        return reply;
    } else {
        const resolvedApiKey = apiKey || process.env.GPT_API_KEY || process.env.SILICON_API_KEY;
        const resolvedApiUrl = apiUrl || process.env.GPT_API_URL || 'https://api.siliconflow.cn/v1';
        let modelName = model || process.env.GPT_MODEL_NAME || 'deepseek-ai/DeepSeek-V3';
        if (modelName === 'gpt-image2' || modelName === 'gpt-image-2') {
            modelName = 'gpt5-4'; // Fallback to chat model for refinement/dialogues
        }

        if (!resolvedApiKey) {
            throw new Error('未配置 API Key');
        }

        let endpoint = resolvedApiUrl;
        if (!endpoint.includes('/v1') && !endpoint.includes('/v1beta')) {
            endpoint = endpoint.replace(/\/$/, '') + '/v1';
        }
        if (!endpoint.endsWith('/chat/completions') && !endpoint.endsWith('/completions')) {
            endpoint = endpoint.replace(/\/$/, '') + '/chat/completions';
        }

        const formattedMessages = messages.map(msg => ({
            role: msg.role === 'model' || msg.role === 'assistant' ? 'assistant' : (msg.role === 'system' ? 'system' : 'user'),
            content: msg.content
        }));

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${resolvedApiKey}`
            },
            body: JSON.stringify({
                model: modelName,
                messages: formattedMessages,
                temperature: 0.7
            })
        });

        const rawText = await response.text();
        if (!response.ok) {
            let errDetail = rawText;
            try {
                const parsed = JSON.parse(rawText);
                errDetail = parsed.error?.message || parsed.error || rawText;
            } catch (e) {}
            throw new Error(`GPT API Error (${response.status}): ${errDetail}`);
        }

        let data;
        try {
            data = JSON.parse(rawText);
        } catch (e) {
            throw new Error(`GPT API 返回非 JSON 格式数据: ${rawText.substring(0, 100)}`);
        }

        const reply = data.choices?.[0]?.message?.content?.trim();
        if (reply === undefined || reply === null) {
            const apiError = data.error?.message || data.error || data.message || data.msg;
            if (apiError) {
                throw new Error(`API 错误: ${JSON.stringify(apiError)}`);
            }
            throw new Error(`未在 GPT 响应中找到文本数据。原始响应: ${rawText.substring(0, 200)}`);
        }
        return reply;
    }
}

// 通用 AI 生图辅助函数 - 兼容 Gemini 和 OpenAI-compatible (GPT) 生图接口
async function callLLMImage({ prompt, apiKey, apiUrl, model, aspectRatio, quality, mode, uploadedImage }) {
    const isGemini = (!apiUrl || apiUrl.includes('googleapis.com') || (model && model.includes('gemini')));
    console.log(`[LLMImage] Request - Model: ${model || 'default'}, Url: ${apiUrl || 'default'}, isGemini: ${isGemini}`);

    if (isGemini) {
        const resolvedApiKey = apiKey || process.env.GEMINI_API_KEY;
        if (!resolvedApiKey) {
            throw new Error('未配置 Gemini API Key');
        }

        let baseUrl = 'https://generativelanguage.googleapis.com';
        if (apiUrl && apiUrl.startsWith('http')) {
            baseUrl = apiUrl.replace(/\/$/, '');
        }

        const modelName = model || 'gemini-3-pro-image-preview';
        const apiPath = baseUrl.includes('/v1beta') ? '' : '/v1beta';
        const endpoint = `${baseUrl}${apiPath}/models/${modelName}:generateContent?key=${resolvedApiKey}`;

        const parts = [];
        if (mode === 'img2img' && uploadedImage) {
            parts.push({
                inlineData: {
                    mimeType: uploadedImage.mimeType,
                    data: uploadedImage.base64
                }
            });
        }
        parts.push({ text: prompt });

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts }]
            })
        });

        const rawText = await response.text();
        if (!response.ok) {
            let errDetail = rawText;
            try {
                const parsed = JSON.parse(rawText);
                errDetail = parsed.error?.message || parsed.error || rawText;
            } catch (e) {}
            throw new Error(`Gemini API Error (${response.status}): ${errDetail}`);
        }

        let data;
        try {
            data = JSON.parse(rawText);
        } catch (e) {
            throw new Error(`Gemini API 返回非 JSON 格式数据: ${rawText.substring(0, 100)}`);
        }

        let url = null;
        const candidates = data.candidates || [];
        for (const candidate of candidates) {
            const parts = candidate.content?.parts || [];
            for (const part of parts) {
                if (part.inlineData && part.inlineData.mimeType.startsWith('image/')) {
                    url = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                    break;
                }
            }
            if (url) break;
        }

        if (!url) {
            const textPart = candidates[0]?.content?.parts?.[0]?.text;
            if (textPart) {
                throw new Error(`生成失败，模型返回了文本而非图片: "${textPart.substring(0, 50)}..."`);
            }
            throw new Error('未在响应中找到图片数据');
        }
        return url;
    } else {
        const resolvedApiKey = apiKey || process.env.GPT_API_KEY || process.env.SILICON_API_KEY;
        const resolvedApiUrl = apiUrl || 'https://api.siliconflow.cn/v1';
        let modelName = model || 'gpt-image-2';
        if (modelName === 'gpt-image2') {
            modelName = 'gpt-image-2';
        }

        if (!resolvedApiKey) {
            throw new Error('未配置 API Key');
        }

        let endpoint = resolvedApiUrl;
        if (!endpoint.includes('/v1') && !endpoint.includes('/v1beta')) {
            endpoint = endpoint.replace(/\/$/, '') + '/v1';
        }
        if (!endpoint.endsWith('/images/generations')) {
            endpoint = endpoint.replace(/\/$/, '') + '/images/generations';
        }

        // 尝试映射宽高比，虽然很多自定义 OpenAI-compatible 生图接口直接通过 prompt 接收比例，但这里保留标准尺寸映射
        let size = '1024x1024';
        if (aspectRatio === '16:9') size = '1024x768';
        else if (aspectRatio === '9:16') size = '768x1024';

        const requestBody = {
            model: modelName,
            prompt: prompt,
            n: 1,
            size: size,
            response_format: 'b64_json'
        };

        let response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${resolvedApiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        let rawText = await response.text();
        if (!response.ok) {
            // 如果是因为不支持 response_format: b64_json 报错，尝试不带该参数（返回 url）
            try {
                const parsedErr = JSON.parse(rawText);
                if (parsedErr.error?.message?.includes('response_format') || parsedErr.error?.includes('format')) {
                    delete requestBody.response_format;
                    response = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${resolvedApiKey}`
                        },
                        body: JSON.stringify(requestBody)
                    });
                    rawText = await response.text();
                }
            } catch (e) {}

            if (!response.ok) {
                let errDetail = rawText;
                try {
                    const parsed = JSON.parse(rawText);
                    errDetail = parsed.error?.message || parsed.error || rawText;
                } catch (e) {}
                throw new Error(`GPT Image API Error (${response.status}): ${errDetail}`);
            }
        }

        let data;
        try {
            data = JSON.parse(rawText);
        } catch (e) {
            throw new Error(`GPT Image API 返回非 JSON 格式数据: ${rawText.substring(0, 100)}`);
        }

        const imgData = data.data?.[0];
        if (!imgData) {
            throw new Error('未在 GPT Image 响应中找到图片数据');
        }

        if (imgData.b64_json) {
            return `data:image/png;base64,${imgData.b64_json}`;
        } else if (imgData.url) {
            // 服务端代理下载图片，避免前端跨域 (CORS) 或混淆内容阻止
            try {
                const imgRes = await fetch(imgData.url);
                if (imgRes.ok) {
                    const arrayBuffer = await imgRes.arrayBuffer();
                    const base64 = Buffer.from(arrayBuffer).toString('base64');
                    const contentType = imgRes.headers.get('content-type') || 'image/png';
                    return `data:${contentType};base64,${base64}`;
                }
            } catch (e) {
                console.error('Failed to download image URL, returning URL directly:', e);
            }
            return imgData.url;
        }

        throw new Error('GPT Image 响应中缺少 b64_json 或 url');
    }
}


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

    const SERVER_API_KEY = process.env.GEMINI_API_KEY;
    const ALCHEMY_KEY = process.env.SILICON_API_KEY;

    if (!SERVER_API_KEY) {
        console.warn("⚠️ Warning: GEMINI_API_KEY is not set in .env file.");
    }

    if (!ALCHEMY_KEY) {
        console.warn("⚠️ Warning: SILICON_API_KEY is not set in .env file.");
    }

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
    // POST /api/refine-prompt - 重构提示词 (支持自定义 GPT/OpenAI)
    if (req.url === '/api/refine-prompt' && req.method === 'POST') {
        console.log('[Alchemy] 收到炼金请求');
        try {
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            const body = JSON.parse(Buffer.concat(chunks).toString());
            const { prompt, apiKey, apiUrl, model } = body;

            if (!prompt) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '请输入提示词' }));
                return;
            }

            const systemPrompt = `你是一个专业的 AI 图像生成提示词工程师。用户会给你一个简单的想法，你需要将其扩展成一个详细、富有艺术感的图像生成提示词（English）。请直接返回提示词，不要啰嗦。`;
            const messages = [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt }
            ];

            console.log(`[Alchemy] 调用 LLM 进行提示词提炼...`);
            const refinedPrompt = await callLLMChat({ messages, apiKey, apiUrl, model });

            console.log('[Alchemy] 炼金成功:', refinedPrompt.substring(0, 50) + '...');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ refinedPrompt }));
        } catch (err) {
            console.error('[Alchemy] 内部错误:', err);
            const errMsg = err.message + (err.cause ? ` (${err.cause.message || err.cause})` : '');
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '炼金失败: ' + errMsg }));
        }
        return;
    }

    // ============ Conversational Alchemy (Co-pilot) API ============
    if (req.url === '/api/alchemy-chat' && req.method === 'POST') {
        console.log('[Alchemy-Chat] 收到对话请求');
        try {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const { messages, apiKey, apiUrl, model } = JSON.parse(Buffer.concat(chunks).toString());

            const systemPrompt = `你是一个专业的 AI 图像生成提示词专家副驾驶。
你的任务是通过与用户对话，通过一步一问的方式，引导用户补全画面的细节（颜色、构图、光影、材质等）。
规则：
1. 保持回复简短，每次只问一个问题。
2. 即使已经有了初步构思，也要尝试追问。
3. 当你觉得细节足够丰富，或者用户表示满意时，请输出最终提示词。
4. 最终结果必须包裹在 <final_prompt> 标签中，例如: <final_prompt>A highly detailed oil painting of a cat...</final_prompt>。
5. 最终提示词必须是英文。
6. 禁止在对话中使用任何表情符号或图标。保持排版清爽干净，不需要使用 markdown 粗体、标题或分割线格式。`;

            const fullMessages = [
                { role: "system", content: systemPrompt },
                ...messages
            ];

            console.log(`[Alchemy-Chat] 调用 LLM 进行副驾驶对话...`);
            const content = await callLLMChat({ messages: fullMessages, apiKey, apiUrl, model });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ content }));
        } catch (err) {
            console.error('[Alchemy-Chat] 错误:', err);
            const errMsg = err.message + (err.cause ? ` (${err.cause.message || err.cause})` : '');
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: errMsg }));
        }
        return;
    }

    // --- AI Chat Route ---
    if (req.url === '/api/chat' && req.method === 'POST') {
        console.log('[Chat] 收到对话请求');
        try {
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            const body = JSON.parse(Buffer.concat(chunks).toString());
            const { messages, apiKey, apiUrl, model } = body;

            if (!messages || !Array.isArray(messages)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '无效的消息格式' }));
                return;
            }

            const systemPrompt = `你是一个友好、专业的创意和对话助手。请用清晰、自然、易读的纯文本回答用户，回答时应遵循以下严格规则：
1. 禁止在回答中使用任何表情符号或图标（例如 🏫, 👥, ✏️, ✨, 🌸, 🚀 等）。
2. 使用最基础的文字排版，禁止使用 Markdown 标题（如 #, ##, ### 等）、Markdown 分割线（如 --- 或 ***）或深层嵌套列表。
3. 如果需要分段或列点，请直接使用普通的换行 and 数字（如 1. 2. 3.）或简单的连字符（-），保持排版极其清爽干净，适合直接阅读。
4. 语气要诚恳、简洁，不要有过多废话，直接切入正题。`;

            const messagesWithSystem = [
                { role: 'system', content: systemPrompt },
                ...messages
            ];

            const reply = await callLLMChat({ messages: messagesWithSystem, apiKey, apiUrl, model });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ reply }));
            return;
        } catch (error) {
            console.error('[Chat] 请求处理失败:', error);
            const errMsg = error.message + (error.cause ? ` (${error.cause.message || error.cause})` : '');
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: errMsg }));
            return;
        }
    }

    // --- AI Image Generation Route ---
    if (req.url === '/api/generate-image' && req.method === 'POST') {
        console.log('[ImageGen] 收到生图请求');
        try {
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            const body = JSON.parse(Buffer.concat(chunks).toString());
            const { prompt, model, apiUrl, apiKey, aspectRatio, quality, mode, uploadedImage } = body;

            if (!prompt) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '请输入提示词' }));
                return;
            }

            console.log(`[ImageGen] 开始生成图片, Model: ${model || 'default'}, ApiUrl: ${apiUrl || 'default'}`);
            const imageUrl = await callLLMImage({
                prompt,
                model,
                apiUrl,
                apiKey,
                aspectRatio,
                quality,
                mode,
                uploadedImage
            });

            console.log('[ImageGen] 生图成功');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ imageUrl }));
        } catch (err) {
            console.error('[ImageGen] 内部错误:', err);
            const errMsg = err.message + (err.cause ? ` (${err.cause.message || err.cause})` : '');
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: errMsg }));
        }
        return;
    }

    // ============ 共享画廊 API ============

    // 确保目录存在
    if (!fs.existsSync(GALLERY_DIR)) {
        fs.mkdirSync(GALLERY_DIR, { recursive: true });
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
            galleryRepository.add({
                id,
                filename,
                prompt: prompt || '',
                author: author || null,
                deviceId: deviceId || null,
                caption: caption || null,
                timestamp: Date.now()
            });

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
            const meta = galleryRepository.list();
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
            const item = galleryRepository.findById(idToDelete);

            if (!item) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: '图片不存在' }));
                return;
            }

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
            galleryRepository.deleteById(idToDelete);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (err) {
            console.error('删除错误:', err);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // ============ 个人印记 (Imprints) API ============
    // GET /api/imprints?deviceId=... - 获取个人历史印记
    if (req.url.startsWith('/api/imprints') && req.method === 'GET') {
        try {
            const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            const deviceId = urlObj.searchParams.get('deviceId');
            if (!deviceId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '缺少 deviceId' }));
                return;
            }
            const list = imprintRepository.list(deviceId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(list));
        } catch (err) {
            console.error('[Imprints GET] 错误:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // POST /api/imprints - 保存/更新历史印记
    if (req.url === '/api/imprints' && req.method === 'POST') {
        try {
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            const body = JSON.parse(Buffer.concat(chunks).toString());
            const { id, url, prompt, deviceId, timestamp } = body;

            if (!id || !url || !deviceId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '缺少必要参数 (id, url, deviceId)' }));
                return;
            }

            const item = imprintRepository.add({ id, url, prompt, deviceId, timestamp });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, item }));
        } catch (err) {
            console.error('[Imprints POST] 错误:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // DELETE /api/imprints/:id - 删除历史印记
    const deleteImprintMatch = req.url.match(/^\/api\/imprints\/([a-zA-Z0-9_-]+)$/);
    if (deleteImprintMatch && req.method === 'DELETE') {
        try {
            const idToDelete = deleteImprintMatch[1];
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            const body = JSON.parse(Buffer.concat(chunks).toString());
            const { deviceId } = body;

            if (!deviceId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '缺少 deviceId' }));
                return;
            }

            const success = imprintRepository.deleteById(idToDelete, deviceId);
            if (success) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '印记不存在或无权删除' }));
            }
        } catch (err) {
            console.error('[Imprints DELETE] 错误:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
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
