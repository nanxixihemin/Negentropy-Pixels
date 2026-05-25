// 统一服务器 - 同时提供网页和 API 代理
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Buffer } from 'buffer';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import 'dotenv/config';
import { createGalleryRepository } from './server/repositories/galleryRepository.mjs';
import { createImprintRepository } from './server/repositories/imprintRepository.mjs';
import { createUserRepository } from './server/repositories/userRepository.mjs';
import { createChatRepository } from './server/repositories/chatRepository.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 3031;
const API_TARGET = 'https://generativelanguage.googleapis.com';
const DATA_DIR = path.join(__dirname, 'server-data');
const GALLERY_DIR = path.join(DATA_DIR, 'gallery');
const GALLERY_META = path.join(DATA_DIR, 'gallery.json');
const DATABASE_PATH = path.join(DATA_DIR, 'negentropy.db');
const IMAGE_JOB_TTL_MS = 30 * 60 * 1000;
const imageJobs = new Map();
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
const userRepository = createUserRepository({
    dataDir: DATA_DIR,
    dbPath: DATABASE_PATH
});
const chatRepository = createChatRepository({
    dataDir: DATA_DIR,
    dbPath: DATABASE_PATH,
    maxSessions: 50
});

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString();
    return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(payload));
}

function getBearerToken(req) {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
}

function getCurrentUser(req) {
    return userRepository.getUserByToken(getBearerToken(req));
}

function publicGalleryItem(item) {
    return {
        id: item.id,
        filename: item.filename,
        prompt: item.prompt,
        author: item.author,
        deviceId: item.deviceId,
        caption: item.caption,
        isFeatured: item.isFeatured,
        featuredAt: item.featuredAt,
        timestamp: item.timestamp
    };
}

function getImageExtension(contentType, fallback = 'png') {
    const cleanType = String(contentType || '').split(';')[0].trim().toLowerCase();
    if (cleanType === 'image/jpeg' || cleanType === 'image/jpg') return 'jpg';
    if (cleanType === 'image/png') return 'png';
    if (cleanType === 'image/webp') return 'webp';
    if (cleanType === 'image/gif') return 'gif';
    return fallback;
}

async function resolveImageBuffer(image) {
    const dataUrlMatch = String(image || '').match(/^data:image\/([\w+.-]+);base64,(.+)$/);
    if (dataUrlMatch) {
        const ext = dataUrlMatch[1] === 'jpeg' ? 'jpg' : dataUrlMatch[1];
        return {
            ext,
            buffer: Buffer.from(dataUrlMatch[2], 'base64')
        };
    }

    if (String(image || '').startsWith('/uploads/')) {
        const relativePath = image.replace('/uploads/', '');
        const filePath = path.normalize(path.join(GALLERY_DIR, relativePath));
        if (filePath.startsWith(path.normalize(GALLERY_DIR)) && fs.existsSync(filePath)) {
            const ext = path.extname(filePath).replace('.', '');
            return {
                ext,
                buffer: fs.readFileSync(filePath)
            };
        }
    }

    if (/^https?:\/\//i.test(String(image || ''))) {
        const imageRes = await fetch(image);
        if (!imageRes.ok) {
            throw new Error(`远程图片下载失败 (${imageRes.status})`);
        }
        const contentType = imageRes.headers.get('content-type') || 'image/png';
        if (!contentType.startsWith('image/')) {
            throw new Error(`远程地址不是图片内容: ${contentType}`);
        }
        return {
            ext: getImageExtension(contentType),
            buffer: Buffer.from(await imageRes.arrayBuffer())
        };
    }

    throw new Error('无效的图片格式：仅支持 data:image base64 或 http(s) 图片地址');
}

// 通用 LLM 调用辅助函数 - 兼容 Gemini 和 OpenAI-compatible (GPT) 接口
function formatImageGenerationError(err) {
    let errMsg = err.message;
    if (errMsg.includes('524') || errMsg.includes('504') || errMsg.includes('timeout') || errMsg.includes('Timeout')) {
        return '生图超时：生图服务商响应时间较长，后台任务已结束。建议稍后重试，或在“设置”中更换更快的生图模型/接口。';
    }
    return err.message + (err.cause ? ` (${err.cause.message || err.cause})` : '');
}

function isRetryableImageGenerationError(err) {
    const errMsg = String(err?.message || '');
    if (errMsg.includes('400') ||
        errMsg.includes('401') ||
        errMsg.includes('403') ||
        errMsg.includes('404') ||
        errMsg.includes('429') ||
        errMsg.includes('504') ||
        errMsg.includes('524') ||
        errMsg.includes('timeout') ||
        errMsg.includes('Timeout') ||
        errMsg.includes('未配置') ||
        errMsg.includes('提示词')) {
        return false;
    }
    return errMsg.includes('ECONNRESET') ||
        errMsg.includes('ECONNREFUSED') ||
        errMsg.includes('ENOTFOUND') ||
        errMsg.includes('fetch failed') ||
        errMsg.includes('socket');
}

function extractImageUrlFromText(text) {
    if (!text || typeof text !== 'string') return null;
    const dataUrlMatch = text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/);
    if (dataUrlMatch) return dataUrlMatch[0];

    const markdownImageMatch = text.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/);
    if (markdownImageMatch) return markdownImageMatch[1];

    const urlMatch = text.match(/https?:\/\/[^\s"'<>),]+/);
    return urlMatch ? urlMatch[0] : null;
}

function extractImageUrlFromPayload(payload) {
    const queue = [payload];
    const seen = new Set();

    while (queue.length) {
        const value = queue.shift();
        if (value === null || value === undefined) continue;

        if (typeof value === 'string') {
            const extracted = extractImageUrlFromText(value);
            if (extracted) return extracted;
            continue;
        }

        if (typeof value !== 'object') continue;
        if (seen.has(value)) continue;
        seen.add(value);

        if (typeof value.b64_json === 'string') {
            return `data:image/png;base64,${value.b64_json}`;
        }
        if (typeof value.url === 'string') {
            return value.url;
        }
        if (typeof value.image_url === 'string') {
            return value.image_url;
        }
        if (value.image_url && typeof value.image_url.url === 'string') {
            return value.image_url.url;
        }
        if (typeof value.image === 'string') {
            const extracted = extractImageUrlFromText(value.image);
            if (extracted) return extracted;
        }

        for (const child of Object.values(value)) {
            queue.push(child);
        }
    }

    return null;
}

function describeImagePayload(payload) {
    if (!payload || typeof payload !== 'object') return typeof payload;
    const keys = Object.keys(payload).slice(0, 8).join(', ') || 'empty';
    const dataKeys = Array.isArray(payload.data) && payload.data[0] && typeof payload.data[0] === 'object'
        ? Object.keys(payload.data[0]).slice(0, 8).join(', ')
        : '';
    const choiceKeys = Array.isArray(payload.choices) && payload.choices[0] && typeof payload.choices[0] === 'object'
        ? Object.keys(payload.choices[0]).slice(0, 8).join(', ')
        : '';
    return `顶层字段: ${keys}${dataKeys ? `; data[0]字段: ${dataKeys}` : ''}${choiceKeys ? `; choices[0]字段: ${choiceKeys}` : ''}`;
}

function serializeImageJob(job) {
    return {
        jobId: job.id,
        status: job.status,
        imageUrl: job.imageUrl || null,
        error: job.error || null,
        elapsedMs: job.finishedAt ? job.finishedAt - job.createdAt : Date.now() - job.createdAt
    };
}

function pruneImageJobs() {
    const now = Date.now();
    for (const [id, job] of imageJobs.entries()) {
        if (now - job.createdAt > IMAGE_JOB_TTL_MS) {
            imageJobs.delete(id);
        }
    }
}

function startImageJob(params) {
    pruneImageJobs();
    const job = {
        id: crypto.randomUUID(),
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        imageUrl: null,
        error: null
    };
    imageJobs.set(job.id, job);

    Promise.resolve().then(async () => {
        try {
            job.status = 'running';
            job.updatedAt = Date.now();
            console.log(`[ImageGen] 后台任务开始, Job: ${job.id}, Model: ${params.model || 'default'}, ApiUrl: ${params.apiUrl || 'default'}`);
            
            // 自动重试逻辑
            let attempt = 1;
            const maxRetries = 3;
            const delayMs = 2000;
            let imageUrl = null;
            
            while (true) {
                try {
                    imageUrl = await callLLMImage(params);
                    break;
                } catch (err) {
                    console.error(`[ImageGen] 第 ${attempt} 次尝试失败:`, err.message);
                    if (attempt >= maxRetries || !isRetryableImageGenerationError(err)) {
                        throw err;
                    }
                    attempt++;
                    const sleepTime = delayMs * Math.pow(2, attempt - 2);
                    console.log(`[ImageGen] 等待 ${sleepTime}ms 后进行第 ${attempt} 次重试...`);
                    await new Promise(resolve => setTimeout(resolve, sleepTime));
                }
            }

            // 本地缓存逻辑
            let localImageUrl = imageUrl;
            try {
                console.log(`[ImageGen] 正在将生成的图片保存到本地...`);
                const resolvedImage = await resolveImageBuffer(imageUrl);
                const filename = `gen_${Date.now()}_${crypto.randomUUID().substring(0, 8)}.${resolvedImage.ext}`;
                
                const targetSubdir = params.userDirName || 'guests/unknown';
                const targetDir = path.join(GALLERY_DIR, targetSubdir);

                // 确保目录存在
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }
                
                fs.writeFileSync(path.join(targetDir, filename), resolvedImage.buffer);
                localImageUrl = `/uploads/${targetSubdir}/${filename}`;
                console.log(`[ImageGen] 保存本地成功: ${localImageUrl}`);
            } catch (saveErr) {
                console.error(`[ImageGen] 保存本地失败，回退到原始 URL:`, saveErr);
            }

            job.status = 'succeeded';
            job.imageUrl = localImageUrl;
            job.finishedAt = Date.now();
            job.updatedAt = job.finishedAt;
            console.log(`[ImageGen] 后台任务成功, Job: ${job.id}, 用时 ${job.finishedAt - job.createdAt}ms`);
        } catch (err) {
            job.status = 'failed';
            job.error = formatImageGenerationError(err);
            job.finishedAt = Date.now();
            job.updatedAt = job.finishedAt;
            console.error(`[ImageGen] 后台任务失败, Job: ${job.id}:`, err);
        }
    });

    return job;
}

async function callLLMChat({ messages, apiKey, apiUrl, model }) {
    const cleanApiUrl = (apiUrl && apiUrl.startsWith('http')) ? apiUrl : '';
    const isGemini = (cleanApiUrl && cleanApiUrl.includes('googleapis.com')) || (model && String(model).toLowerCase().includes('gemini'));
    console.log(`[LLMChat] Request - Model: ${model || 'default'}, Url: ${apiUrl || 'default'}, isGemini: ${isGemini}`);

    if (isGemini) {
        const resolvedApiKey = apiKey || process.env.GEMINI_API_KEY;
        if (!resolvedApiKey) {
            throw new Error('未配置 Gemini API Key');
        }

        let baseUrl = 'https://generativelanguage.googleapis.com';
        if (cleanApiUrl) {
            baseUrl = cleanApiUrl.replace(/\/$/, '');
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
        const resolvedApiUrl = cleanApiUrl || process.env.GPT_API_URL || 'https://api.siliconflow.cn/v1';
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
            throw new Error(`AI 接口错误 (${response.status}): ${errDetail}`);
        }

        let data;
        try {
            data = JSON.parse(rawText);
        } catch (e) {
            throw new Error(`AI 接口返回非 JSON 格式数据: ${rawText.substring(0, 100)}`);
        }

        const reply = data.choices?.[0]?.message?.content?.trim();
        if (reply === undefined || reply === null) {
            const apiError = data.error?.message || data.error || data.message || data.msg;
            if (apiError) {
                const cleanErr = typeof apiError === 'object' ? JSON.stringify(apiError) : apiError;
                throw new Error(`API 服务商返回了错误: ${cleanErr}`);
            }
            if (data.choices === null || (Array.isArray(data.choices) && data.choices.length === 0)) {
                throw new Error(`⚠️ API 响应异常 (Choices 为空)。\n\n这通常是由于当前调用的模型（${modelName}）临时拥堵、扣费失败，或当前节点不支持该模型。\n\n💡 建议方法：请点击右上角的 ⚙️ 设置按钮，在 Base URL 中切换为其他 API 地址（如 蜂蜜AI https://store.hachimi-ai.com）或在下方选择更换其他高可用模型（如 gpt5-4 / Qwen3_6）再试。`);
            }
            throw new Error(`⚠️ API 响应格式异常。\n\n请检查您配置的“API Base URL”、“API Key”以及“模型名称”是否完全匹配。`);
        }
        return reply;
    }
}

// 通用 AI 生图辅助函数 - 兼容 Gemini 和 OpenAI-compatible (GPT) 生图接口
async function callLLMImage({ prompt, apiKey, apiUrl, model, aspectRatio, quality, mode, uploadedImage }) {
    const cleanApiUrl = (apiUrl && apiUrl.startsWith('http')) ? apiUrl : '';
    const isGemini = (cleanApiUrl && cleanApiUrl.includes('googleapis.com')) || (model && String(model).toLowerCase().includes('gemini'));
    console.log(`[LLMImage] Request - Model: ${model || 'default'}, Url: ${apiUrl || 'default'}, isGemini: ${isGemini}`);

    if (isGemini) {
        const resolvedApiKey = apiKey || process.env.GEMINI_API_KEY;
        if (!resolvedApiKey) {
            throw new Error('未配置 Gemini API Key');
        }

        let baseUrl = 'https://generativelanguage.googleapis.com';
        if (cleanApiUrl) {
            baseUrl = cleanApiUrl.replace(/\/$/, '');
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
        const resolvedApiUrl = cleanApiUrl || 'https://api.siliconflow.cn/v1';
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
        else if (aspectRatio === '4:3') size = '1024x768';
        else if (aspectRatio === '3:4') size = '768x1024';

        const requestBody = {
            model: modelName,
            prompt: prompt,
            n: 1,
            size: size,
            response_format: 'url'
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
            // 如果是不支持 response_format 报错，尝试不带该参数（多数 OpenAI-compatible 生图接口会返回 URL）
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
                throw new Error(`AI 生图接口错误 (${response.status}): ${errDetail}`);
            }
        }

        let data;
        try {
            data = JSON.parse(rawText);
        } catch (e) {
            throw new Error(`AI 生图接口返回非 JSON 格式数据: ${rawText.substring(0, 100)}`);
        }

        const extractedImageUrl = extractImageUrlFromPayload(data);
        if (extractedImageUrl) {
            // Return URL directly to avoid slow base64 transfer causing gateway timeouts.
            return extractedImageUrl;
        }

        const apiError = data.error?.message || data.error || data.message || data.msg;
        if (apiError) {
            const cleanErr = typeof apiError === 'object' ? JSON.stringify(apiError) : apiError;
            throw new Error(`API 服务商返回了错误: ${cleanErr}`);
        }

        throw new Error(`未在生图接口响应中找到图片数据（${describeImagePayload(data)}）`);
    }
}


const server = http.createServer(async (req, res) => {
    // 添加 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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
    if (req.url === '/api/auth/register' && req.method === 'POST') {
        try {
            const result = userRepository.register(await readJsonBody(req));
            sendJson(res, 200, result);
        } catch (err) {
            sendJson(res, 400, { error: err.message });
        }
        return;
    }

    if (req.url === '/api/auth/reset-password' && req.method === 'POST') {
        try {
            const result = userRepository.resetPassword(await readJsonBody(req));
            sendJson(res, 200, result);
        } catch (err) {
            sendJson(res, 400, { error: err.message });
        }
        return;
    }

    if (req.url === '/api/auth/login' && req.method === 'POST') {
        try {
            const result = userRepository.login(await readJsonBody(req));
            sendJson(res, 200, result);
        } catch (err) {
            sendJson(res, 401, { error: err.message });
        }
        return;
    }

    if (req.url === '/api/auth/me' && req.method === 'GET') {
        const user = getCurrentUser(req);
        sendJson(res, user ? 200 : 401, user ? { user } : { error: '未登录' });
        return;
    }

    if (req.url === '/api/auth/logout' && req.method === 'POST') {
        userRepository.logout(getBearerToken(req));
        sendJson(res, 200, { success: true });
        return;
    }

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

            const systemPrompt = `你是一个专业的 AI 图像生成提示词工程师。用户会给你一个简单的想法，你需要将其扩展成一个详细、富有艺术感的图像生成提示词（English）。请直接返回提示词，禁止使用任何表情符号或 Markdown 加粗、标题、分割线格式。直接输出内容，不要啰嗦。`;
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
1. 保持回复极简，每次必须只问一个问题。
2. 绝对禁止在对话中输出任何表情符号或图标。
3. 绝对禁止使用任何 Markdown 格式，例如 Markdown 标题（如 #, ##, ### 等）、Markdown 分割线（如 --- 或 ***）或 Markdown 粗体（**）。
4. 即使已经有了初步构思，也要尝试追问。
5. 当你觉得细节足够丰富，或者用户表示满意时，请输出最终提示词。最终结果必须包裹在 <final_prompt> 标签中（必须是英文）。`;

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
1. 绝对禁止在回答中使用任何表情符号或图标（例如 🏫, 👥, ✏️, ✨, 🌸, 🚀 等）。
2. 绝对禁止使用任何 Markdown 格式，禁止使用 Markdown 标题（如 #, ##, ### 等）、Markdown 分割线（如 --- 或 ***）、Markdown 粗体（**）或深层嵌套列表。
3. 如果需要分段或列点，请直接使用普通的换行和数字（如 1. 2. 3.）或简单的连字符（-），保持排版极其清爽干净，适合直接阅读。
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

    const imageJobMatch = req.url.match(/^\/api\/generate-image\/([a-f0-9-]+)$/i);
    if (imageJobMatch && req.method === 'GET') {
        pruneImageJobs();
        const job = imageJobs.get(imageJobMatch[1]);
        if (!job) {
            sendJson(res, 404, { error: '生图任务不存在或已过期' });
            return;
        }
        sendJson(res, 200, serializeImageJob(job));
        return;
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

            if (body.async !== true) {
                sendJson(res, 409, {
                    error: '页面版本过旧：请强制刷新页面后再生图。新的生图接口需要后台任务轮询。'
                });
                return;
            }

            const currentUser = getCurrentUser(req);
            const userDirName = currentUser ? `users/${currentUser.username.replace(/[@.]/g, '_')}` : `guests/${(body.deviceId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')}`;

            const job = startImageJob({
                prompt,
                model,
                apiUrl,
                apiKey,
                aspectRatio,
                quality,
                mode,
                uploadedImage,
                userDirName
            });

            console.log(`[ImageGen] 已创建后台任务, Job: ${job.id}`);
            sendJson(res, 202, serializeImageJob(job));
        } catch (err) {
            console.error('[ImageGen] 内部错误:', err);
            let errMsg = err.message;
            if (errMsg.includes('524') || errMsg.includes('504') || errMsg.includes('timeout') || errMsg.includes('Timeout')) {
                errMsg = '生图超时：生图服务商响应时间超过了 100 秒限制。建议稍后重试，或在“设置”中更换更快的生图模型/接口。';
            } else {
                errMsg = err.message + (err.cause ? ` (${err.cause.message || err.cause})` : '');
            }
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
            const currentUser = getCurrentUser(req);
            console.log('[API] 解析成功, Author:', author, 'Prompt:', prompt?.substring(0, 20));

            if (!image) {
                console.warn('[API] 缺少图片数据');
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '缺少图片数据' }));
                return;
            }

            // 解析 data URL 或远程图片 URL
            const resolvedImage = await resolveImageBuffer(image);
            const { ext, buffer } = resolvedImage;
            console.log(`[API] Image resolved: ${ext}, bytes: ${buffer.length}`);
            const id = Date.now().toString();
            const filename = `${id}.${ext}`;

            // Determine user directory name
            const userDirName = currentUser ? `users/${currentUser.username.replace(/[@.]/g, '_')}` : `guests/${(deviceId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
            const targetDir = path.join(GALLERY_DIR, userDirName);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            // 保存图片文件到用户子目录
            const relativeFilename = `${userDirName}/${filename}`;
            console.log(`[API] 保存文件到: ${relativeFilename}`);
            fs.writeFileSync(path.join(targetDir, filename), buffer);

            // 更新元数据
            galleryRepository.add({
                id,
                filename: relativeFilename,
                prompt: prompt || '',
                author: author || null,
                deviceId: deviceId || null,
                userId: currentUser?.id || null,
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
            const meta = galleryRepository.list().map(publicGalleryItem);
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
            const currentUser = getCurrentUser(req);

            // 读取元数据
            const item = galleryRepository.findById(idToDelete);

            if (!item) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: '图片不存在' }));
                return;
            }

            // 验证设备ID
            const canDelete = (currentUser && item.userId === currentUser.id) || item.deviceId === deviceId;
            if (!canDelete) {
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
            const currentUser = getCurrentUser(req);
            if (!deviceId && !currentUser) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '缺少 deviceId' }));
                return;
            }
            const list = imprintRepository.list(currentUser ? { userId: currentUser.id } : { deviceId });
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
            const currentUser = getCurrentUser(req);

            if (!id || !url || (!deviceId && !currentUser)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '缺少必要参数 (id, url, deviceId)' }));
                return;
            }

            const item = imprintRepository.add({
                id,
                url,
                prompt,
                deviceId: deviceId || null,
                userId: currentUser?.id || null,
                timestamp
            });
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
            const currentUser = getCurrentUser(req);

            if (!deviceId && !currentUser) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '缺少 deviceId' }));
                return;
            }

            const success = imprintRepository.deleteById(
                idToDelete,
                currentUser ? { userId: currentUser.id } : { deviceId }
            );
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

    // GET /api/chat-sessions - 获取历史对话列表
    if (req.url.startsWith('/api/chat-sessions') && req.method === 'GET') {
        try {
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            const deviceId = urlObj.searchParams.get('deviceId');
            const currentUser = getCurrentUser(req);
            if (!deviceId && !currentUser) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '缺少 deviceId' }));
                return;
            }
            const list = chatRepository.list(currentUser ? { userId: currentUser.id } : { deviceId });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(list));
        } catch (err) {
            console.error('[Chat GET] 错误:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // POST /api/chat-sessions - 保存/更新历史对话
    if (req.url === '/api/chat-sessions' && req.method === 'POST') {
        try {
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            const body = JSON.parse(Buffer.concat(chunks).toString());
            const { id, title, messages, deviceId, timestamp } = body;
            const currentUser = getCurrentUser(req);

            if (!id || (!deviceId && !currentUser)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '缺少必要参数 (id, deviceId)' }));
                return;
            }

            const item = chatRepository.save({
                id,
                title: title || '新对话',
                messages: messages || [],
                deviceId: deviceId || null,
                userId: currentUser?.id || null,
                timestamp
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, item }));
        } catch (err) {
            console.error('[Chat POST] 错误:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // DELETE /api/chat-sessions/:id - 删除特定历史对话
    const deleteChatMatch = req.url.match(/^\/api\/chat-sessions\/([a-zA-Z0-9_-]+)$/);
    if (deleteChatMatch && req.method === 'DELETE') {
        try {
            const idToDelete = deleteChatMatch[1];
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            const body = JSON.parse(Buffer.concat(chunks).toString());
            const { deviceId } = body;
            const currentUser = getCurrentUser(req);

            if (!deviceId && !currentUser) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '缺少 deviceId' }));
                return;
            }

            const success = chatRepository.deleteById(
                idToDelete,
                currentUser ? { userId: currentUser.id } : { deviceId }
            );
            if (success) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '对话不存在或无权删除' }));
            }
        } catch (err) {
            console.error('[Chat DELETE] 错误:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // 静态服务 - 共享图片访问
    if (req.url === '/api/admin/images' && req.method === 'GET') {
        const currentUser = getCurrentUser(req);
        if (!currentUser || currentUser.role !== 'admin') {
            sendJson(res, 403, { error: '需要管理员权限' });
            return;
        }

        sendJson(res, 200, {
            gallery: galleryRepository.listAllForAdmin(),
            imprints: imprintRepository.listAllForAdmin()
        });
        return;
    }

    const adminGalleryDeleteMatch = req.url.match(/^\/api\/admin\/gallery\/([a-zA-Z0-9_-]+)$/);
    if (adminGalleryDeleteMatch && req.method === 'DELETE') {
        const currentUser = getCurrentUser(req);
        if (!currentUser || currentUser.role !== 'admin') {
            sendJson(res, 403, { error: '需要管理员权限' });
            return;
        }

        const idToDelete = adminGalleryDeleteMatch[1];
        const item = galleryRepository.findById(idToDelete);
        if (!item) {
            sendJson(res, 404, { error: '图片不存在' });
            return;
        }

        const filePath = path.join(GALLERY_DIR, item.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        galleryRepository.deleteById(idToDelete);
        sendJson(res, 200, { success: true });
        return;
    }

    const adminGalleryFeaturedMatch = req.url.match(/^\/api\/admin\/gallery\/([a-zA-Z0-9_-]+)\/featured$/);
    if (adminGalleryFeaturedMatch && req.method === 'POST') {
        const currentUser = getCurrentUser(req);
        if (!currentUser || currentUser.role !== 'admin') {
            sendJson(res, 403, { error: '需要管理员权限' });
            return;
        }

        try {
            const body = await readJsonBody(req);
            const item = galleryRepository.setFeatured(adminGalleryFeaturedMatch[1], Boolean(body.featured));
            if (!item) {
                sendJson(res, 404, { error: '图片不存在' });
                return;
            }

            sendJson(res, 200, { success: true, item });
        } catch (err) {
            sendJson(res, 400, { error: err.message });
        }
        return;
    }

    // --- CRC32 and ZIP Utilities for Packaging ---
    const crcTable = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        crcTable[i] = c;
    }

    function crc32(buffer) {
        let crc = 0 ^ (-1);
        for (let i = 0; i < buffer.length; i++) {
            crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xFF];
        }
        return (crc ^ (-1)) >>> 0;
    }

    function createZip(files) {
        const buffers = [];
        const cdEntries = [];
        let currentOffset = 0;

        for (const file of files) {
            const filenameBuf = Buffer.from(file.name, 'utf-8');
            const fileData = file.buffer;
            const crc = crc32(fileData);

            // Local file header
            const lfh = Buffer.alloc(30);
            lfh.writeUInt32LE(0x04034b50, 0); // Signature
            lfh.writeUInt16LE(10, 4);          // Version needed
            lfh.writeUInt16LE(0, 6);           // Flags
            lfh.writeUInt16LE(0, 8);           // Compression method (0 = STORE)
            lfh.writeUInt16LE(0, 10);          // Last mod time
            lfh.writeUInt16LE(0, 12);          // Last mod date
            lfh.writeUInt32LE(crc, 14);        // CRC32
            lfh.writeUInt32LE(fileData.length, 18); // Compressed size
            lfh.writeUInt32LE(fileData.length, 22); // Uncompressed size
            lfh.writeUInt16LE(filenameBuf.length, 26); // Filename length
            lfh.writeUInt16LE(0, 28);          // Extra field length

            buffers.push(lfh);
            buffers.push(filenameBuf);
            buffers.push(fileData);

            // Central directory entry
            const cde = Buffer.alloc(46);
            cde.writeUInt32LE(0x02014b50, 0); // Signature
            cde.writeUInt16LE(20, 4);          // Version made by (2.0)
            cde.writeUInt16LE(10, 6);          // Version needed (1.0)
            cde.writeUInt16LE(0, 8);           // Flags
            cde.writeUInt16LE(0, 10);          // Compression method
            cde.writeUInt16LE(0, 12);          // Last mod time
            cde.writeUInt16LE(0, 14);          // Last mod date
            cde.writeUInt32LE(crc, 16);        // CRC-32
            cde.writeUInt32LE(fileData.length, 20); // Compressed size
            cde.writeUInt32LE(fileData.length, 24); // Uncompressed size
            cde.writeUInt16LE(filenameBuf.length, 28); // Filename length
            cde.writeUInt16LE(0, 30);          // Extra field length
            cde.writeUInt16LE(0, 32);          // File comment length
            cde.writeUInt16LE(0, 34);          // Disk number start
            cde.writeUInt16LE(0, 36);          // Internal file attrs
            cde.writeUInt32LE(0, 38);          // External file attrs
            cde.writeUInt32LE(currentOffset, 42); // Relative offset of local header

            cdEntries.push({ header: cde, name: filenameBuf });
            
            currentOffset += lfh.length + filenameBuf.length + fileData.length;
        }

        const cdOffset = currentOffset;
        let cdSize = 0;

        for (const entry of cdEntries) {
            buffers.push(entry.header);
            buffers.push(entry.name);
            cdSize += entry.header.length + entry.name.length;
        }

        // End of central directory record
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0); // Signature
        eocd.writeUInt16LE(0, 4);          // Number of this disk
        eocd.writeUInt16LE(0, 6);          // Disk where CD starts
        eocd.writeUInt16LE(files.length, 8); // Number of CD records on this disk
        eocd.writeUInt16LE(files.length, 10); // Total number of CD records
        eocd.writeUInt32LE(cdSize, 12);     // Size of CD
        eocd.writeUInt32LE(cdOffset, 16);   // Offset of CD
        eocd.writeUInt16LE(0, 20);          // Comment length

        buffers.push(eocd);

        return Buffer.concat(buffers);
    }

    function getUserFolderInfo(userDirName, userId, deviceId) {
        let size = 0;
        const fileList = [];

        // 1. Scan user/guest subfolder if it exists
        const subDir = path.join(GALLERY_DIR, userDirName);
        if (fs.existsSync(subDir)) {
            try {
                const items = fs.readdirSync(subDir);
                for (const item of items) {
                    const itemPath = path.join(subDir, item);
                    try {
                        const stat = fs.statSync(itemPath);
                        if (stat.isFile()) {
                            size += stat.size;
                            fileList.push({
                                name: item,
                                fullPath: itemPath,
                                urlPath: `/uploads/${userDirName}/${item}`,
                                size: stat.size,
                                timestamp: stat.mtimeMs
                            });
                        }
                    } catch (err) {
                        console.error(`[AdminStats] Error reading file ${itemPath}:`, err);
                    }
                }
            } catch (dirErr) {
                console.error(`[AdminStats] Error reading directory ${subDir}:`, dirErr);
            }
        }

        // 2. Scan database records for any root GALLERY_DIR files belonging to this user
        const db = new DatabaseSync(DATABASE_PATH);
        
        let galleryQuery;
        let galleryParams;
        if (userId) {
            galleryQuery = `SELECT id, filename, prompt, caption, timestamp FROM gallery_items WHERE user_id = ?`;
            galleryParams = [userId];
        } else {
            galleryQuery = `SELECT id, filename, prompt, caption, timestamp FROM gallery_items WHERE device_id = ? AND user_id IS NULL`;
            galleryParams = [deviceId];
        }
        const dbGalleryItems = db.prepare(galleryQuery).all(...galleryParams);
        for (const dbItem of dbGalleryItems) {
            if (!dbItem.filename.includes('/') && !dbItem.filename.includes('\\')) {
                const rootFilePath = path.join(GALLERY_DIR, dbItem.filename);
                if (fs.existsSync(rootFilePath)) {
                    try {
                        const stat = fs.statSync(rootFilePath);
                        if (!fileList.some(f => f.fullPath === rootFilePath)) {
                            size += stat.size;
                            fileList.push({
                                name: dbItem.filename,
                                fullPath: rootFilePath,
                                urlPath: `/uploads/${dbItem.filename}`,
                                size: stat.size,
                                timestamp: dbItem.timestamp || stat.mtimeMs
                            });
                        }
                    } catch (err) {
                        console.error(`[AdminStats] Error reading root gallery file ${rootFilePath}:`, err);
                    }
                }
            }
        }

        let imprintQuery;
        let imprintParams;
        if (userId) {
            imprintQuery = `SELECT id, image_url, prompt, timestamp FROM imprint_items WHERE user_id = ?`;
            imprintParams = [userId];
        } else {
            imprintQuery = `SELECT id, image_url, prompt, timestamp FROM imprint_items WHERE device_id = ? AND user_id IS NULL`;
            imprintParams = [deviceId];
        }
        const dbImprintItems = db.prepare(imprintQuery).all(...imprintParams);
        for (const dbItem of dbImprintItems) {
            if (dbItem.image_url.startsWith('/uploads/')) {
                const relPath = dbItem.image_url.replace('/uploads/', '');
                if (!relPath.includes('/') && !relPath.includes('\\')) {
                    const rootFilePath = path.join(GALLERY_DIR, relPath);
                    if (fs.existsSync(rootFilePath)) {
                        try {
                            const stat = fs.statSync(rootFilePath);
                            if (!fileList.some(f => f.fullPath === rootFilePath)) {
                                size += stat.size;
                                fileList.push({
                                    name: relPath,
                                    fullPath: rootFilePath,
                                    urlPath: dbItem.image_url,
                                    size: stat.size,
                                    timestamp: dbItem.timestamp || stat.mtimeMs
                                });
                            }
                        } catch (err) {
                            console.error(`[AdminStats] Error reading root imprint file ${rootFilePath}:`, err);
                        }
                    }
                }
            }
        }

        // Map prompts to files
        const filePrompts = {};
        for (const dbItem of dbGalleryItems) {
            const nameOnly = path.basename(dbItem.filename);
            filePrompts[nameOnly] = { prompt: dbItem.prompt, caption: dbItem.caption, isGallery: true, id: dbItem.id };
        }
        for (const dbItem of dbImprintItems) {
            if (dbItem.image_url.startsWith('/uploads/')) {
                const nameOnly = path.basename(dbItem.image_url);
                if (!filePrompts[nameOnly]) {
                    filePrompts[nameOnly] = { prompt: dbItem.prompt, caption: null, isImprint: true, id: dbItem.id };
                }
            }
        }

        for (const fileInfo of fileList) {
            const info = filePrompts[fileInfo.name] || {};
            fileInfo.prompt = info.prompt || '';
            fileInfo.caption = info.caption || '';
            fileInfo.isGallery = info.isGallery || false;
            fileInfo.isImprint = info.isImprint || false;
            fileInfo.dbId = info.id || null;
        }

        return { size, fileList };
    }

    // --- Admin User & File Management APIs ---

    if (req.url === '/api/admin/users-summary' && req.method === 'GET') {
        const currentUser = getCurrentUser(req);
        if (!currentUser || currentUser.role !== 'admin') {
            sendJson(res, 403, { error: '需要管理员权限' });
            return;
        }

        try {
            const db = new DatabaseSync(DATABASE_PATH);
            const users = db.prepare(`SELECT id, username, nickname, role, created_at FROM users`).all();
            
            const guestDevices = new Set();
            const dbGuestImprints = db.prepare(`SELECT DISTINCT device_id FROM imprint_items WHERE user_id IS NULL AND device_id IS NOT NULL`).all();
            for (const row of dbGuestImprints) {
                guestDevices.add(row.device_id);
            }
            const dbGuestGallery = db.prepare(`SELECT DISTINCT device_id FROM gallery_items WHERE user_id IS NULL AND device_id IS NOT NULL`).all();
            for (const row of dbGuestGallery) {
                guestDevices.add(row.device_id);
            }

            const guestDirRoot = path.join(GALLERY_DIR, 'guests');
            if (fs.existsSync(guestDirRoot)) {
                const subDirs = fs.readdirSync(guestDirRoot);
                for (const subDir of subDirs) {
                    const fullSubPath = path.join(guestDirRoot, subDir);
                    if (fs.statSync(fullSubPath).isDirectory()) {
                        guestDevices.add(subDir);
                    }
                }
            }

            const summaryList = [];

            for (const user of users) {
                const userDirName = `users/${user.username.replace(/[@.]/g, '_')}`;
                const { size, fileList } = getUserFolderInfo(userDirName, user.id, null);
                
                const imprintCount = db.prepare(`SELECT COUNT(*) AS count FROM imprint_items WHERE user_id = ?`).get(user.id).count;
                const galleryCount = db.prepare(`SELECT COUNT(*) AS count FROM gallery_items WHERE user_id = ?`).get(user.id).count;

                summaryList.push({
                    type: 'user',
                    id: user.id,
                    username: user.username,
                    name: user.nickname || user.username,
                    role: user.role,
                    dirName: userDirName,
                    imprintCount,
                    galleryCount,
                    totalImages: fileList.length,
                    totalSize: size,
                    createdAt: user.created_at,
                    files: fileList.map(f => ({ name: f.name, size: f.size, urlPath: f.urlPath, timestamp: f.timestamp }))
                });
            }

            for (const deviceId of guestDevices) {
                const userDirName = `guests/${deviceId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                const { size, fileList } = getUserFolderInfo(userDirName, null, deviceId);
                
                const imprintCount = db.prepare(`SELECT COUNT(*) AS count FROM imprint_items WHERE device_id = ? AND user_id IS NULL`).get(deviceId).count;
                const galleryCount = db.prepare(`SELECT COUNT(*) AS count FROM gallery_items WHERE device_id = ? AND user_id IS NULL`).get(deviceId).count;

                let createdAt = Date.now();
                if (fileList.length > 0) {
                    createdAt = Math.min(...fileList.map(f => f.timestamp));
                }

                summaryList.push({
                    type: 'guest',
                    id: deviceId,
                    username: null,
                    name: `访客 (${deviceId.substring(0, 8)})`,
                    role: 'guest',
                    dirName: userDirName,
                    imprintCount,
                    galleryCount,
                    totalImages: fileList.length,
                    totalSize: size,
                    createdAt: createdAt,
                    files: fileList.map(f => ({ name: f.name, size: f.size, urlPath: f.urlPath, timestamp: f.timestamp }))
                });
            }

            sendJson(res, 200, summaryList);
        } catch (err) {
            console.error('[AdminUsersSummary] Error:', err);
            sendJson(res, 500, { error: err.message });
        }
        return;
    }

    if (req.url.startsWith('/api/admin/users/package')) {
        try {
            const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            const targetId = urlObj.searchParams.get('id');
            const targetType = urlObj.searchParams.get('type');
            const token = urlObj.searchParams.get('token');

            const user = userRepository.getUserByToken(token);
            if (!user || user.role !== 'admin') {
                sendJson(res, 403, { error: '需要管理员权限' });
                return;
            }

            if (!targetId || !targetType) {
                sendJson(res, 400, { error: '缺少 id 或 type 参数' });
                return;
            }

            let userDirName;
            let userId = null;
            let deviceId = null;
            let archiveName = 'archive.zip';

            if (targetType === 'user') {
                userId = targetId;
                const db = new DatabaseSync(DATABASE_PATH);
                const u = db.prepare('SELECT username, nickname FROM users WHERE id = ?').get(userId);
                if (!u) {
                    sendJson(res, 404, { error: '用户不存在' });
                    return;
                }
                userDirName = `users/${u.username.replace(/[@.]/g, '_')}`;
                archiveName = `user_${u.nickname || u.username}_images.zip`;
            } else {
                deviceId = targetId;
                userDirName = `guests/${deviceId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                archiveName = `guest_${deviceId.substring(0, 8)}_images.zip`;
            }

            const { fileList } = getUserFolderInfo(userDirName, userId, deviceId);
            if (fileList.length === 0) {
                sendJson(res, 404, { error: '该用户没有任何图片作品' });
                return;
            }

            const zipFiles = [];
            for (const fileInfo of fileList) {
                if (fs.existsSync(fileInfo.fullPath)) {
                    zipFiles.push({
                        name: fileInfo.name,
                        buffer: fs.readFileSync(fileInfo.fullPath)
                    });
                }
            }

            const zipBuffer = createZip(zipFiles);

            res.writeHead(200, {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="${encodeURIComponent(archiveName)}"`,
                'Content-Length': zipBuffer.length
            });
            res.end(zipBuffer);
        } catch (err) {
            console.error('[AdminPackage] Error:', err);
            sendJson(res, 500, { error: err.message });
        }
        return;
    }

    if (req.url === '/api/admin/users/clean' && req.method === 'POST') {
        const currentUser = getCurrentUser(req);
        if (!currentUser || currentUser.role !== 'admin') {
            sendJson(res, 403, { error: '需要管理员权限' });
            return;
        }

        try {
            const body = await readJsonBody(req);
            const { id: targetId, type: targetType } = body;

            if (!targetId || !targetType) {
                sendJson(res, 400, { error: '缺少 id 或 type 参数' });
                return;
            }

            let userDirName;
            let userId = null;
            let deviceId = null;

            if (targetType === 'user') {
                userId = targetId;
                const db = new DatabaseSync(DATABASE_PATH);
                const u = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
                if (!u) {
                    sendJson(res, 404, { error: '用户不存在' });
                    return;
                }
                userDirName = `users/${u.username.replace(/[@.]/g, '_')}`;
            } else {
                deviceId = targetId;
                userDirName = `guests/${deviceId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
            }

            const { fileList } = getUserFolderInfo(userDirName, userId, deviceId);
            for (const fileInfo of fileList) {
                if (fs.existsSync(fileInfo.fullPath)) {
                    try {
                        fs.unlinkSync(fileInfo.fullPath);
                    } catch (e) {
                        console.error(`[AdminClean] Failed to delete file ${fileInfo.fullPath}:`, e.message);
                    }
                }
            }

            const subDir = path.join(GALLERY_DIR, userDirName);
            if (fs.existsSync(subDir)) {
                try {
                    fs.rmSync(subDir, { recursive: true, force: true });
                } catch (e) {
                    console.error(`[AdminClean] Failed to delete directory ${subDir}:`, e.message);
                }
            }

            const db = new DatabaseSync(DATABASE_PATH);
            let galleryQuery;
            let galleryParams;
            if (userId) {
                galleryQuery = `SELECT id FROM gallery_items WHERE user_id = ?`;
                galleryParams = [userId];
            } else {
                galleryQuery = `SELECT id FROM gallery_items WHERE device_id = ? AND user_id IS NULL`;
                galleryParams = [deviceId];
            }
            const itemsToDelete = db.prepare(galleryQuery).all(...galleryParams);
            
            for (const item of itemsToDelete) {
                galleryRepository.deleteById(item.id);
            }

            db.exec('BEGIN');
            try {
                if (userId) {
                    db.prepare('DELETE FROM imprint_items WHERE user_id = ?').run(userId);
                } else {
                    db.prepare('DELETE FROM imprint_items WHERE device_id = ? AND user_id IS NULL').run(deviceId);
                }
                db.exec('COMMIT');
            } catch (dbErr) {
                db.exec('ROLLBACK');
                throw dbErr;
            }

            sendJson(res, 200, { success: true });
        } catch (err) {
            console.error('[AdminClean] Error:', err);
            sendJson(res, 500, { error: err.message });
        }
        return;
    }

    if (req.url.startsWith('/uploads/')) {
        const filename = decodeURIComponent(req.url.replace('/uploads/', ''));
        const filePath = path.normalize(path.join(GALLERY_DIR, filename));

        // 防目录穿越安全防护
        if (!filePath.startsWith(path.normalize(GALLERY_DIR))) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

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
                        res.writeHead(200, {
                            'Content-Type': 'text/html',
                            'Cache-Control': 'no-store'
                        });
                        res.end(content2);
                    }
                });
            } else {
                res.writeHead(500);
                res.end('Server Error');
            }
        } else {
            const headers = { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' };
            if (ext === '.html') {
                headers['Cache-Control'] = 'no-store';
            }
            res.writeHead(200, headers);
            res.end(content);
        }
    });
});

server.timeout = 300000;
server.keepAliveTimeout = 300000;
server.headersTimeout = 305000;

server.listen(PORT, '0.0.0.0', () => {
    console.log('🌌 Negentropy Server Started!');
    console.log(`📍 本地访问: http://localhost:${PORT}`);
    console.log(`🌐 通过 ngrok 暴露: ngrok http ${PORT}`);
    console.log('');
    console.log('确保你的 API 服务在 127.0.0.1:8045 运行中');
});
