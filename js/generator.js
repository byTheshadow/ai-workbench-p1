/**
 * THE STUDIO WORKBENCH - GENERATOR MODULE
 * 纯前端生图工作室核心逻辑 - 修复与升级整合版
 */

// ==========================================================================
// 1. INDEXEDDB 本地存储控制 (防爆 localStorage)
// ==========================================================================
const DB_NAME = 'studio_workbench_gallery';
const DB_VERSION = 1;
const STORE_NAME = 'gallery';

class GalleryDB {
    static open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
        });
    }

    static async save(item) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(item);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    static async getAll() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => {
                const list = request.result || [];
                list.sort((a, b) => b.timestamp - a.timestamp);
                resolve(list);
            };
            request.onerror = () => reject(request.error);
        });
    }

    static async delete(id) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    static async deleteMultiple(ids) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            let successCount = 0;
            if (ids.length === 0) resolve(true);
            ids.forEach(id => {
                const req = store.delete(id);
                req.onsuccess = () => {
                    successCount++;
                    if (successCount === ids.length) resolve(true);
                };
            });
        });
    }
}

// ==========================================================================
// 智能跨域代理清洗与获取方法（全局通用，支持前缀模式与 Cloudflare Workers 模式）
// ==========================================================================
function getCleanProxyUrl(targetUrl, userProxy) {
    if (!userProxy || !userProxy.trim()) {
        return targetUrl;
    }
    let proxy = userProxy.trim();

    // 自动识别 Cloudflare Workers 代理格式 (?url=)
    if (proxy.includes('workers.dev') || proxy.includes('?url=') || proxy.includes('url=')) {
        if (!proxy.includes('url=')) {
            proxy = proxy.replace(/\/$/, '') + '/?url=';
        }
        if (!proxy.endsWith('=')) {
            proxy = proxy.endsWith('url') ? proxy + '=' : proxy + '&url=';
        }
        // 编码目标 URL，并拼接到 url= 后面（绝对不会有多余的斜杠）
        return proxy + encodeURIComponent(targetUrl);
    }

    // 兼容传统前缀型代理
    return proxy.replace(/\/$/, '') + '/' + targetUrl;
}

// ==========================================================================
// 2. 并发队列调度器 (Task Queue Scheduler - 已修复 unshift 报错并支持智能代理路由)
// ==========================================================================
class QueueScheduler {
    constructor(maxConcurrency = 5) {
        this.maxConcurrency = maxConcurrency;
        this.queue = [];      // 等待执行的任务
        this.active = [];     // 正在执行的任务
        this.completed = [];  // 近期已完成任务历史 (防 unshift 报错)
        this.failed = [];     // 近期失败任务历史 (防 unshift 报错)
        this.listeners = [];  // 队列状态监听器
    }

    addEventListener(callback) {
        this.listeners.push(callback);
    }

    notify() {
        const state = {
            queue: this.queue,
            active: this.active,
            completed: this.completed,
            failed: this.failed
        };
        // 兼容原有的 UI 状态更新，也同步通知悬浮窗
        this.listeners.forEach(cb => cb(state));
    }

    enqueue(task) {
        task.id = task.id || 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        task.timestamp = task.timestamp || Date.now();
        task.status = 'queued';
        task.controller = new AbortController();

        this.queue.push(task);
        this.notify();
        this.schedule();
    }

    cancel(id) {
        const index = this.queue.findIndex(t => t.id === id);
        if (index > -1) {
            this.queue.splice(index, 1);
            this.notify();
            return;
        }

        const activeTask = this.active.find(t => t.id === id);
        if (activeTask) {
            activeTask.controller.abort();
            this.active = this.active.filter(t => t.id !== id);
            this.notify();
            this.schedule();
        }
    }

    cancelAll() {
        this.queue = [];
        this.active.forEach(task => {
            if (task.controller) task.controller.abort();
        });
        this.active = [];
        this.notify();
    }

    clearHistory() {
        this.completed = [];
        this.failed = [];
        this.notify();
    }

    schedule() {
        while (this.active.length < this.maxConcurrency && this.queue.length > 0) {
            const task = this.queue.shift();
            task.status = 'generating';
            this.active.push(task);
            this.notify();
            this.executeTask(task);
        }
    }

    // 真正发起 HTTP 请求生图
    async executeTask(task) {
        try {
            const globalData = JSON.parse(localStorage.getItem('studio_workbench_data') || '{}');
            const apiConfig = globalData.apiConfig || {};

            let finalImageBlob = null;
            let finalSeed = task.params.seed;
            if (finalSeed === -1 || !finalSeed) {
                finalSeed = Math.floor(Math.random() * 9999999999);
            }

            // 使用全新经过防跨域、去前缀、多后端兼容的完美发送逻辑
            if (task.backend === 'novelai') {
                const naiUrl = apiConfig.naiUrl || 'https://api.novelai.net';
                const endpoint = `${naiUrl.replace(/\/$/, '')}/ai/generate-image`;

                const payload = {
                    input: task.prompt,
                    model: task.params.model || 'nai-diffusion-3',
                    action: 'generate',
                    parameters: {
                        width: task.params.width,
                        height: task.params.height,
                        scale: task.params.scale,
                        sampler: task.params.sampler || 'k_euler',
                        steps: task.params.steps,
                        seed: finalSeed,
                        n_samples: 1,
                        legacy: false,
                        add_original_image: true,
                        uncond_scale: 1,
                        cfg_rescale: 0,
                        noise: 0,
                        negative_prompt: task.params.negativePrompt || ''
                    }
                };

                if (task.params.smea) {
                    payload.parameters.sm = true;
                    if (task.params.smeaDyn) {
                        payload.parameters.sm_dyn = true;
                    }
                }

                // 修复 NovelAI Vibe Transfer 参考图片发送逻辑（使用最新官方数组格式并进行去前缀处理）
                if (task.params.vibeBase64) {
                    const cleanB64 = task.params.vibeBase64.includes('base64,')
                        ? task.params.vibeBase64.split('base64,')[1]
                        : task.params.vibeBase64;

                    payload.parameters.reference_images = [
                        {
                            image: cleanB64,
                            strength: task.params.vibeStrength || 0.6,
                            information_extracted: 1.0
                        }
                    ];
                    // 冗余旧字段以达成向后最大兼容性
                    payload.parameters.reference_image_multiple = [cleanB64];
                    payload.parameters.reference_strength_multiple = [task.params.vibeStrength || 0.6];
                    payload.parameters.reference_information_extracted_multiple = [1.0];
                }

                const headers = { 'Content-Type': 'application/json' };
                if (apiConfig.naiToken) {
                    headers['Authorization'] = `Bearer ${apiConfig.naiToken}`;
                }

                // NovelAI 强制走免激活代理
                const proxyUrl = getCleanProxyUrl(endpoint, apiConfig.corsProxy);
                const response = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload),
                    signal: task.controller.signal
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`NovelAI 远端报错: Status ${response.status} - ${errText}`);
                }

                const zipData = await response.arrayBuffer();
                const zip = new JSZip();
                const unzipped = await zip.loadAsync(zipData);
                const keys = Object.keys(unzipped.files);
                if (keys.length === 0) {
                    throw new Error('NovelAI 返回包中未找到任何解压文件。');
                }
                finalImageBlob = await unzipped.files[keys[0]].async('blob');

            } else if (task.backend === 'sd') {
                const sdUrl = apiConfig.sdUrl || 'http://127.0.0.1:7860';
                
                // 修复 SD 图生图发送：根据是否有参考图动态决定调用端点
                const hasVibe = !!task.params.vibeBase64;
                const endpoint = hasVibe
                    ? `${sdUrl.replace(/\/$/, '')}/sdapi/v1/img2img`
                    : `${sdUrl.replace(/\/$/, '')}/sdapi/v1/txt2img`;

                const payload = {
                    prompt: task.prompt,
                    negative_prompt: task.params.negativePrompt || '',
                    steps: task.params.steps,
                    cfg_scale: task.params.scale,
                    width: task.params.width,
                    height: task.params.height,
                    seed: finalSeed,
                    sampler_name: task.params.sampler || 'Euler a'
                };

                if (hasVibe) {
                    const cleanB64 = task.params.vibeBase64.includes('base64,')
                        ? task.params.vibeBase64.split('base64,')[1]
                        : task.params.vibeBase64;

                    payload.init_images = [cleanB64];
                    // 强度换算：SD 里的 denoising_strength 为重绘幅度，其意义与 reference_strength 相反
                    payload.denoising_strength = Math.max(0, Math.min(1, 1 - (task.params.vibeStrength || 0.6)));
                }

                const headers = { 'Content-Type': 'application/json' };
                if (apiConfig.sdAuth) {
                    headers['Authorization'] = `Basic ${btoa(apiConfig.sdAuth)}`;
                }

                // SD 优先直连，失败走代理
                let response;
                try {
                    response = await fetch(endpoint, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(payload),
                        signal: task.controller.signal
                    });
                } catch (err) {
                    const proxyUrl = getCleanProxyUrl(endpoint, apiConfig.corsProxy);
                    response = await fetch(proxyUrl, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(payload),
                        signal: task.controller.signal
                    });
                }

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`SD WebUI 报错: Status ${response.status} - ${errText}`);
                }

                const result = await response.json();
                if (!result.images || result.images.length === 0) {
                    throw new Error('SD 响应正常，但未包含生成的图像数组。');
                }

                const rawB64 = result.images[0];
                const resByte = atob(rawB64);
                const byteNumbers = new Array(resByte.length);
                for (let i = 0; i < resByte.length; i++) {
                    byteNumbers[i] = resByte.charCodeAt(i);
                }
                finalImageBlob = new Blob([new Uint8Array(byteNumbers)], { type: 'image/png' });

            } else if (task.backend === 'v1') {
                const v1Base = apiConfig.imageV1Url || '';
                if (!v1Base) {
                    throw new Error('未配置通用生图 API 接口地址，请前往设置面板填写。');
                }

                const endpoint = v1Base.replace(/\/$/, '') + '/images/generations';

                // 严格遵循豌豆 / XHUB 官方规范构建基础参数
                const payload = {
                    model: task.params.model || 'dall-e-3',
                    prompt: task.prompt,
                    n: 1,
                    size: `${task.params.width}x${task.params.height}`
                };

                // 修复通用 API 引擎参考图发送：携带参考图片 Base64 编码，实现第三方中转站的图生图/Vibe功能
                if (task.params.vibeBase64) {
                    payload.image = task.params.vibeBase64;
                    payload.init_image = task.params.vibeBase64;
                    payload.image_strength = task.params.vibeStrength || 0.6;
                }

                const headers = { 'Content-Type': 'application/json' };
                if (apiConfig.imageV1Key) {
                    headers['Authorization'] = `Bearer ${apiConfig.imageV1Key}`;
                }

                // 自动通过您的专属 Cloudflare Worker 代理转发
                const proxyUrl = getCleanProxyUrl(endpoint, apiConfig.corsProxy);

                const response = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload),
                    signal: task.controller.signal
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`通用生图 API 报错: Status ${response.status} - ${errText}`);
                }

                const result = await response.json();
                if (!result.data || result.data.length === 0) {
                    throw new Error('通用 API 响应正常，但 data 图像列表为空。');
                }

                const imgObj = result.data[0];
                const imageUrl = imgObj.url;
                const b64Json = imgObj.b64_json;

                // 下载图片实体
                if (imageUrl) {
                    const proxyImgUrl = getCleanProxyUrl(imageUrl, apiConfig.corsProxy);
                    let imgRes = await fetch(proxyImgUrl);
                    if (!imgRes.ok) {
                        // 降级尝试直连下载
                        imgRes = await fetch(imageUrl);
                    }
                    if (!imgRes.ok) throw new Error("无法从生成的 URL 地址下载图片实体");
                    finalImageBlob = await imgRes.blob();
                } else if (b64Json) {
                    const rawB64 = b64Json.replace(/^data:image\/\w+;base64,/, "");
                    const resByte = atob(rawB64);
                    const byteNumbers = new Array(resByte.length);
                    for (let i = 0; i < resByte.length; i++) {
                        byteNumbers[i] = resByte.charCodeAt(i);
                    }
                    finalImageBlob = new Blob([new Uint8Array(byteNumbers)], { type: 'image/png' });
                } else {
                    throw new Error("通用 API 返回的数据中未找到任何图片内容");
                }
            }

            // 生成轻量级缩略图，加速画廊渲染
            let thumbBase64 = null;
            if (window.StudioManager && typeof window.StudioManager.createThumbnail === 'function') {
                thumbBase64 = await window.StudioManager.createThumbnail(finalImageBlob);
            }

            // 保存到本地 IndexedDB
            const record = {
                id: task.id,
                timestamp: task.timestamp,
                backend: task.backend,
                prompt: task.prompt,
                negativePrompt: task.params.negativePrompt || '',
                params: {
                    width: task.params.width,
                    height: task.params.height,
                    steps: task.params.steps,
                    scale: task.params.scale,
                    sampler: task.params.sampler,
                    seed: finalSeed,
                    model: task.params.model || '',
                    smea: task.params.smea || false,
                    smeaDyn: task.params.smeaDyn || false,
                    vibeStrength: task.params.vibeStrength || 0.6
                },
                thumb: thumbBase64,
                imageBlob: finalImageBlob
            };

            await GalleryDB.save(record);

            // 防崩溃保护式写入历史
            if (!this.completed) this.completed = [];
            task.status = 'completed';
            task.thumb = thumbBase64;
            task.record = record;
            this.completed.unshift(task);
            if (this.completed.length > 10) this.completed.pop();

            this.active = this.active.filter(t => t.id !== task.id);
            this.notify();
            this.schedule();

            if (window.StudioManager) {
                window.StudioManager.refreshGallery();
                window.StudioManager.lastSuccessfulSeed = finalSeed;
            }

        } catch (error) {
            console.error('生图任务执行失败:', error);
            
            // 防崩溃保护式写入失败历史
            if (!this.failed) this.failed = [];
            task.status = 'failed';
            task.error = error.message || '未知错误';
            this.failed.unshift(task);
            if (this.failed.length > 10) this.failed.pop();

            this.active = this.active.filter(t => t.id !== task.id);
            this.notify();
            this.schedule();
        }
    }
}

const generatorQueue = new QueueScheduler(5);
// ==========================================================================
// 3. 生图工作室主控管理对象 (StudioManager)
// ==========================================================================
window.StudioManager = {
    drafts: [
        {
            id: 'draft_default',
            name: '草稿 A',
            prompt: '',
            subject: '', // 新增主旨默认值
            negativePrompt: '',
            targetBackend: 'novelai',
            artists: [],
            params: {
                width: 832,
                height: 1216,
                steps: 28,
                scale: 5.0,
                sampler: 'k_euler',
                seed: -1,
                model: 'nai-diffusion-4-5-full',
                smea: false,
                smeaDyn: false,
                vibeBase64: null,
                vibeStrength: 0.6
            }
        }
    ],
    activeDraftId: 'draft_default',
    modelsCache: {
        novelai: [
            { id: 'nai-diffusion-4-5-full', name: 'NovelAI Anime V4.5 (Full)' },
            { id: 'nai-diffusion-4-5-curated', name: 'NovelAI Anime V4.5 (Curated)' },
            { id: 'nai-diffusion-4-full', name: 'NovelAI Anime V4 (Full)' },
            { id: 'nai-diffusion-4-curated-preview', name: 'NovelAI Anime V4 (Curated)' },
            { id: 'nai-diffusion-3', name: 'NovelAI Anime V3' },
            { id: 'safe-diffusion', name: 'Safe Diffusion (写实)' }
        ],
        sd: [],
        v1: []
    },

    // 动态拉取服务器模型列表 (已支持 CORS 代理、错误捕获与主流模型本地预设兜底)
    async fetchModelsFromServer(backend, forceRefresh = false) {
        const self = this;
        
        // 预设的主流通用生图模型列表 (当网络出错、跨域或代理未激活时自动兜底渲染)
        const PRESET_V1_MODELS = [
            { id: 'dall-e-3', name: 'DALL-E 3 (OpenAI)' },
            { id: 'midjourney', name: 'Midjourney (XHUB/兼容)' },
            { id: 'flux', name: 'FLUX (Standard/通用)' },
            { id: 'flux-schnell', name: 'FLUX Schnell (快速生图)' },
            { id: 'flux-dev', name: 'FLUX Dev (画质精细)' },
            { id: 'stable-diffusion', name: 'Stable Diffusion (通用兼容)' },
            { id: 'gpt-4o', name: 'GPT-4o (支持图像模型拓展)' }
        ];

        if (backend === 'novelai') {
            self.renderModelOptions(self.modelsCache.novelai);
            return;
        }

        if (!forceRefresh && self.modelsCache[backend] && self.modelsCache[backend].length > 0) {
            self.renderModelOptions(self.modelsCache[backend]);
            return;
        }

        self.modelSelect.innerHTML = '<option value="">正在拉取后端模型...</option>';
        self.btnRefreshModels.classList.add('spin-icon-generating');

        const globalData = JSON.parse(localStorage.getItem('studio_workbench_data') || '{}');
        const apiConfig = globalData.apiConfig || {};

        try {
            if (backend === 'sd') {
                const sdBaseUrl = apiConfig.sdUrl || 'http://127.0.0.1:7860';
                let fullUrl = sdBaseUrl.replace(/\/$/, '') + '/sdapi/v1/sd-models';
                // 统一使用智能代理清洗函数
                fullUrl = getCleanProxyUrl(fullUrl, apiConfig.corsProxy);

                const headers = { 'Content-Type': 'application/json' };
                if (apiConfig.sdKey) {
                    headers['Authorization'] = `Bearer ${apiConfig.sdKey}`;
                }

                const response = await fetch(fullUrl, { method: 'GET', headers });
                if (!response.ok) throw new Error(`SD 接口无响应: Status ${response.status}`);
                
                const data = await response.json();
                if (Array.isArray(data)) {
                    self.modelsCache.sd = data.map(item => ({
                        id: item.title,
                        name: item.model_name
                    }));
                }
            } else if (backend === 'v1') {
                const v1Base = apiConfig.imageV1Url || '';
                if (!v1Base) {
                    throw new Error('未配置通用生图 API 接口地址');
                }
                
                let fullUrl = v1Base.replace(/\/$/, '') + '/models';
                // 统一使用智能代理清洗函数
                fullUrl = getCleanProxyUrl(fullUrl, apiConfig.corsProxy);

                const headers = {};
                if (apiConfig.imageV1Key) {
                    headers['Authorization'] = `Bearer ${apiConfig.imageV1Key}`;
                }

                const response = await fetch(fullUrl, { method: 'GET', headers });
                if (!response.ok) throw new Error(`生图 models 接口响应异常: Status ${response.status}`);
                
                const textData = await response.text();
                // 校验返回的是否为 HTML 网页（如代理阻断、Cloudflare 盾或 404）
                if (textData.trim().startsWith('<!DOCTYPE') || textData.trim().startsWith('<html')) {
                    throw new SyntaxError('接口返回了 HTML 网页而非 JSON，可能是 CORS 代理未激活或服务被阻断');
                }

                const data = JSON.parse(textData);
                if (data && Array.isArray(data.data)) {
                    self.modelsCache.v1 = data.data.map(item => ({
                        id: item.id,
                        name: item.id
                    }));
                }
            }

            const currentList = self.modelsCache[backend] || [];
            if (currentList.length === 0) {
                // 如果返回列表为空，触发降级
                throw new Error('获取的模型列表数据为空');
            } else {
                self.renderModelOptions(currentList);
                self.showNotification(`成功获取并缓存了 ${currentList.length} 个模型`);
            }
        } catch (error) {
            console.warn('获取模型失败，启动本地模型降级兜底方案:', error);
            
            // 执行优雅降级
            if (backend === 'v1') {
                self.modelsCache.v1 = PRESET_V1_MODELS;
                self.renderModelOptions(PRESET_V1_MODELS);
                self.showNotification('已启用预设通用生图模型列表 (本地降级列表)');
            } else {
                self.modelSelect.innerHTML = '<option value="">模型拉取失败，点击刷新重试</option>';
                self.showSystemError('模型拉取失败', `无法连接到 ${backend === 'sd' ? 'Stable Diffusion' : '通用 API'} 的模型接口，错误描述: ${error.message}`);
            }
        } finally {
            self.btnRefreshModels.classList.remove('spin-icon-generating');
        }
    },

    renderModelOptions(modelList) {
        const self = this;
        self.modelSelect.innerHTML = '';

        if (!modelList || modelList.length === 0) {
            self.modelSelect.innerHTML = '<option value="">未获取到可用模型</option>';
            return;
        }

        // 读取当前活跃草稿所保存的模型
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        const savedModel = (activeDraft && activeDraft.params) ? activeDraft.params.model : '';

        modelList.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            if (m.id === savedModel) {
                opt.selected = true;
            }
            self.modelSelect.appendChild(opt);
        });

        // 如果草稿中没存选定模型，默认选中第一个
        if (!self.modelSelect.value && self.modelSelect.options.length > 0) {
            self.modelSelect.selectedIndex = 0;
            self.saveUIToActiveDraft(); // 立即同步存入草稿
        }
    },

    // ==========================================================================
    // 4. UI 绑定与核心初始化 (Studio DOM Binding)
    // ==========================================================================
    async init() {
        const self = this;
        
        // 绑定真实的 DOM ID 节点 (彻底对齐 index.html)
        self.btnGenerate = document.getElementById('btn-studio-generate');
        self.btnInterrupt = document.getElementById('btn-studio-interrupt');
        self.btnRandomSeed = document.getElementById('btn-random-seed');
        self.btnLockSeed = document.getElementById('btn-lock-seed');
        self.btnRefreshModels = document.getElementById('btn-refresh-models');
        
        self.taPrompt = document.getElementById('studio-prompt-input');
        self.taSubject = document.getElementById('studio-subject-input'); // 新增绑定主旨要求
        self.taNegativePrompt = document.getElementById('studio-negative-input');
        self.taManualArtists = document.getElementById('studio-artist-manual-input');
        
        self.engineSelect = document.getElementById('studio-backend-select');
        self.modelSelect = document.getElementById('studio-model-select');
        self.samplerSelect = document.getElementById('param-sampler');
        
        // 分辨率框
        self.inputWidth = document.getElementById('param-custom-w');
        self.inputHeight = document.getElementById('param-custom-h');
        
        self.rangeSteps = document.getElementById('param-steps');
        self.valStepsNum = document.getElementById('param-steps-num');
        self.rangeScale = document.getElementById('param-scale');
        self.valScaleNum = document.getElementById('param-scale-num');
        self.inputSeed = document.getElementById('param-seed');
        
        // 引擎面板与容器
        self.naiParamsPanel = document.getElementById('nai-specific-params');
        self.cbSmea = document.getElementById('param-smea');
        self.cbSmeaDyn = document.getElementById('param-smea-dyn');
        self.smeaDynWrap = document.getElementById('smea-dyn-wrap');
        self.advancedControls = document.getElementById('param-advanced-controls');
        
        self.vibeDropzone = document.getElementById('vibe-dropzone');
        self.vibeFileInput = document.getElementById('vibe-file-input');
        self.vibePreview = document.getElementById('vibe-preview');
        self.vibePreviewImg = document.getElementById('vibe-preview-img');
        self.btnClearVibe = document.getElementById('btn-clear-vibe');
        self.vibeIntensityWrap = document.getElementById('vibe-intensity-wrap');
        self.vibeStrength = document.getElementById('vibe-strength');
        self.vibeStrengthNum = document.getElementById('vibe-strength-num');

        // 画廊节点
        self.galleryGrid = document.getElementById('studio-gallery-grid');
        self.galleryCountLabel = document.getElementById('gallery-count-label');
        self.btnToggleBatch = document.getElementById('btn-toggle-batch-mode');
        self.batchBar = document.getElementById('gallery-batch-actions-bar');
        self.batchSelectedCount = document.getElementById('batch-selected-count');
        
        self.btnBatchSelectAll = document.getElementById('btn-batch-select-all');
        self.btnBatchDownload = document.getElementById('btn-batch-download');
        self.btnBatchDelete = document.getElementById('btn-batch-delete');
        self.btnBatchCancel = document.getElementById('btn-batch-cancel');
        self.cbCleanMetadata = document.getElementById('cb-clean-metadata');

        // 提示词册导入导出
        self.btnLexiconExport = document.getElementById('btn-lexicon-export');
        self.btnLexiconImportTrigger = document.getElementById('btn-lexicon-import-trigger');
        self.fileLexiconImport = document.getElementById('file-lexicon-import');

        // 画师实验室
        self.artistLabContainer = document.getElementById('studio-artist-lab-container');
        self.btnAutoWeight = document.getElementById('btn-auto-weight');
        self.btnSaveRecipe = document.getElementById('btn-save-recipe');
        self.artistChipsWrap = document.getElementById('artist-chips-wrap');
        self.artistTensionSlider = document.getElementById('artist-tension-slider');
        self.tensionValueDisplay = document.getElementById('tension-value-display');
        self.btnRandomArtistWeight = document.getElementById('btn-random-artist-weight');

        // 草稿标签栏
        self.draftTabsList = document.getElementById('studio-draft-tabs-list');
        self.btnAddDraft = document.getElementById('btn-add-draft');

        // Lightbox
        self.lightbox = document.getElementById('lightbox-modal');
        self.lightboxImg = document.getElementById('lightbox-main-img');
        self.lightboxTimestamp = document.getElementById('lightbox-meta-timestamp');
        self.lightboxEngine = document.getElementById('lightbox-meta-engine');
        self.lightboxPrompt = document.getElementById('lightbox-meta-prompt');
        self.lightboxNegative = document.getElementById('lightbox-meta-negative');
        self.lightboxSeed = document.getElementById('lightbox-meta-seed');
        self.lightboxDimension = document.getElementById('lightbox-meta-dimension');
        self.lightboxSteps = document.getElementById('lightbox-meta-steps');
        self.lightboxScale = document.getElementById('lightbox-meta-scale');
        self.lightboxSampler = document.getElementById('lightbox-meta-sampler');
        self.cbLightboxCleanExif = document.getElementById('cb-lightbox-clean-metadata');
        
        self.btnLightboxClose = document.getElementById('btn-lightbox-close');
        self.btnLightboxReuse = document.getElementById('btn-lightbox-reuse');
        self.btnLightboxCreateTask = document.getElementById('btn-lightbox-create-task');
        self.btnLightboxRoll = document.getElementById('btn-lightbox-roll-variations');
        self.btnLightboxDownload = document.getElementById('btn-lightbox-download');
        self.btnLightboxDelete = document.getElementById('btn-lightbox-delete');

        // 报错弹窗 DOM
        self.errorModal = document.getElementById('error-custom-modal');
        self.errorModalTitle = document.getElementById('error-modal-title');
        self.errorModalMessage = document.getElementById('error-modal-message');
        self.btnCloseErrorModal = document.getElementById('btn-close-error-modal');
        self.btnCopyErrorLog = document.getElementById('btn-copy-error-log');

        self.lastSuccessfulSeed = -1;
        self.selectedImageIds = [];
        self.activeLightboxItem = null;

        // 从 LocalStorage 读取草稿
        const savedDrafts = localStorage.getItem('studio_workbench_drafts');
        if (savedDrafts) {
            try {
                self.drafts = JSON.parse(savedDrafts);
            } catch(e) {
                console.error("加载草稿历史失败，使用默认值", e);
            }
        }
        const savedActiveId = localStorage.getItem('studio_workbench_active_draft_id');
        if (savedActiveId && self.drafts.some(d => d.id === savedActiveId)) {
            self.activeDraftId = savedActiveId;
        }

        // 初始化基本监听器并渲染
        self.initEventListeners();
        self.renderDraftsList();
        self.loadActiveDraftToUI();
        self.refreshGallery();
        self.bindRatioPresets();
        self.initCustomErrorModal();

        // 初始化悬浮任务监视器 DOM
        self.initQueueMonitorDOM();

        // 监听队列状态同步更新 UI 状态与悬浮监视器
        generatorQueue.addEventListener((state) => {
            self.updateGeneratorStatusUI(state.queue, state.active);
            self.renderQueueMonitor(state);
        });

        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (activeDraft) {
            await self.fetchModelsFromServer(activeDraft.targetBackend);
        }
    },

    // 绑定所有的界面事件
    initEventListeners() {
        const self = this;

        // 1. 输入内容与参数的双向绑定与自动保存
        const autoSaveInputs = [
            self.taPrompt, self.taSubject, self.taNegativePrompt, self.taManualArtists,
            self.engineSelect, self.modelSelect, self.samplerSelect,
            self.inputWidth, self.inputHeight, self.rangeSteps,
            self.valStepsNum, self.rangeScale, self.valScaleNum,
            self.inputSeed, self.cbSmea, self.cbSmeaDyn,
            self.vibeStrength, self.vibeStrengthNum
        ];
        
        autoSaveInputs.forEach(el => {
            if (!el) return;
            const eventType = el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio' ? 'change' : 'input';
            el.addEventListener(eventType, () => {
                self.saveUIToActiveDraft();
                self.syncParameters();
            });
        });

        // 引擎切换特殊逻辑：参数显隐及通用 v1 Payload 净化
        self.engineSelect.addEventListener('change', async (e) => {
            const selectedBackend = e.target.value;
            self.saveUIToActiveDraft();
            self.toggleParametersVisibility(selectedBackend);
            
            const cache = self.modelsCache[selectedBackend] || [];
            if (cache.length === 0) {
                await self.fetchModelsFromServer(selectedBackend, true);
            } else {
                self.renderModelOptions(cache);
            }
        });

        // 手动拉取模型
        self.btnRefreshModels.addEventListener('click', async () => {
            const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
            if (activeDraft) {
                await self.fetchModelsFromServer(activeDraft.targetBackend, true);
            }
        });

        // 随机种子与锁定种子
        self.btnRandomSeed.addEventListener('click', () => {
            self.inputSeed.value = -1;
            self.saveUIToActiveDraft();
        });
        self.btnLockSeed.addEventListener('click', () => {
            if (self.lastSuccessfulSeed && self.lastSuccessfulSeed !== -1) {
                self.inputSeed.value = self.lastSuccessfulSeed;
                self.saveUIToActiveDraft();
                self.showNotification(`已锁定上一次成功的 Seed: ${self.lastSuccessfulSeed}`);
            } else {
                self.showNotification('未有生成成功的图片 Seed');
            }
        });

        // 参考图拖拽上传事件
        self.vibeDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            self.vibeDropzone.style.borderColor = 'var(--accent-color)';
        });
        self.vibeDropzone.addEventListener('dragleave', () => {
            self.vibeDropzone.style.borderColor = 'var(--border-color)';
        });
        self.vibeDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            self.vibeDropzone.style.borderColor = 'var(--border-color)';
            if (e.dataTransfer.files.length > 0) {
                self.handleVibeImageUpload(e.dataTransfer.files[0]);
            }
        });
        self.vibeDropzone.addEventListener('click', () => {
            self.vibeFileInput.click();
        });
        self.vibeFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                self.handleVibeImageUpload(e.target.files[0]);
            }
        });
        self.btnClearVibe.addEventListener('click', () => {
            self.vibePreview.style.display = 'none';
            self.vibePreviewImg.src = '';
            self.vibeIntensityWrap.style.display = 'none';
            
            const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
            if (activeDraft) {
                activeDraft.params.vibeBase64 = null;
                self.saveDraftsToStorage();
            }
        });

        // 批量多选控制条切换
        self.btnToggleBatch.addEventListener('click', () => {
            if (self.batchBar.style.display === 'none' || !self.batchBar.style.display) {
                self.batchBar.style.display = 'flex';
                self.btnToggleBatch.textContent = '取消批量';
            } else {
                self.exitBatchMode();
            }
        });

        self.btnBatchCancel.addEventListener('click', () => {
            self.exitBatchMode();
        });

        self.btnBatchSelectAll.addEventListener('click', () => {
            const cards = self.galleryGrid.querySelectorAll('.gallery-card');
            if (self.selectedImageIds.length === cards.length) {
                cards.forEach(card => card.classList.remove('selected'));
                self.selectedImageIds = [];
            } else {
                self.selectedImageIds = [];
                cards.forEach(card => {
                    card.classList.add('selected');
                    self.selectedImageIds.push(card.dataset.id);
                });
            }
            self.batchSelectedCount.textContent = self.selectedImageIds.length;
        });

        self.btnBatchDelete.addEventListener('click', async () => {
            if (self.selectedImageIds.length === 0) return;
            if (confirm(`确定要永久删除这 ${self.selectedImageIds.length} 张生成图吗？此操作不可逆。`)) {
                await GalleryDB.deleteMultiple(self.selectedImageIds);
                self.selectedImageIds = [];
                self.batchSelectedCount.textContent = '0';
                self.refreshGallery();
                self.showNotification('批量删除完成');
                self.exitBatchMode();
            }
        });

        self.btnBatchDownload.addEventListener('click', () => {
            if (self.selectedImageIds.length === 0) return;
            const cleanExif = self.cbCleanMetadata.checked;
            self.downloadMultipleImages(self.selectedImageIds, cleanExif);
        });

        // 生成与强制中断
        self.btnGenerate.addEventListener('click', () => {
            self.triggerGenerateAction();
        });

        self.btnGenerate.disabled = false;

        self.btnInterrupt.addEventListener('click', () => {
            const activeTasks = [...generatorQueue.active];
            if (activeTasks.length > 0) {
                activeTasks.forEach(task => {
                    generatorQueue.cancel(task.id);
                });
                self.showNotification('已发送强行中断信号');
            }
        });

        // Ctrl + Enter 快捷生成
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                if (!self.btnGenerate.disabled) {
                    e.preventDefault();
                    self.triggerGenerateAction();
                }
            }
        });

        // 注入位置与参数联动保存
        document.querySelectorAll('input[name="artist-inject-pos"]').forEach(radio => {
            radio.addEventListener('change', () => {
                self.saveUIToActiveDraft();
            });
        });

        // 画师风格张力与一键配平绑定
        if (self.artistTensionSlider) {
            self.artistTensionSlider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                let label = '稳定凝聚 (Cohesive)';
                if (val > 40 && val <= 75) label = '混合碰撞 (Eclectic)';
                if (val > 75) label = '狂野冲突 (Experimental)';
                self.tensionValueDisplay.textContent = label;
                self.adjustArtistTension(val);
            });
        }

        if (self.btnAutoWeight) {
            self.btnAutoWeight.addEventListener('click', () => {
                self.autoBalanceWeights();
            });
        }

        if (self.btnSaveRecipe) {
            self.btnSaveRecipe.addEventListener('click', () => {
                self.openSaveRecipeModal();
            });
        }

        // AI 随机打权重触发
        if (self.btnRandomArtistWeight) {
            self.btnRandomArtistWeight.addEventListener('click', () => {
                self.applyRandomWeights();
            });
        }

        // Lightbox 交互绑定
        if (self.btnLightboxClose) {
            self.btnLightboxClose.addEventListener('click', () => self.lightbox.classList.remove('open'));
        }
        self.lightbox.addEventListener('click', (e) => {
            if (e.target === self.lightbox) self.lightbox.classList.remove('open');
        });

        self.btnLightboxReuse.addEventListener('click', () => {
            if (self.activeLightboxItem) {
                self.sendBackToWorkbench(self.activeLightboxItem);
                self.lightbox.classList.remove('open');
            }
        });

        self.btnLightboxCreateTask.addEventListener('click', () => {
            if (self.activeLightboxItem) {
                self.createFollowUpTask(self.activeLightboxItem);
            }
        });

        self.btnLightboxDownload.addEventListener('click', async () => {
            if (self.activeLightboxItem) {
                const cleanExif = self.cbLightboxCleanExif.checked;
                await self.downloadSingleImage(self.activeLightboxItem.id, cleanExif);
            }
        });

        self.btnLightboxDelete.addEventListener('click', async () => {
            if (self.activeLightboxItem) {
                if (confirm('确定永久删除此张作品吗？')) {
                    await GalleryDB.delete(self.activeLightboxItem.id);
                    self.refreshGallery();
                    self.lightbox.classList.remove('open');
                    self.showNotification('已永久删除');
                }
            }
        });

        self.btnLightboxRoll.addEventListener('click', () => {
            if (self.activeLightboxItem) {
                self.triggerRollVariations(self.activeLightboxItem);
                self.lightbox.classList.remove('open');
            }
        });
    },

    // 绑定比例预设与数值转换
    bindRatioPresets() {
        const self = this;
        const buttons = document.querySelectorAll('#ratio-preset-group button');
        const customDiv = document.getElementById('custom-dimension-inputs');
        
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const ratio = btn.dataset.ratio;
                if (ratio) {
                    customDiv.style.display = 'none';
                    const [w, h] = ratio.split('x');
                    self.inputWidth.value = w;
                    self.inputHeight.value = h;
                } else if (btn.dataset.custom) {
                    customDiv.style.display = 'grid';
                }
                self.saveUIToActiveDraft();
            });
        });
    },

    // 针对不同引擎动态隐藏不适宜的参数
    toggleParametersVisibility(backend) {
        const self = this;
        if (backend === 'novelai') {
            self.advancedControls.style.display = 'block';
            self.naiParamsPanel.style.display = 'block';
            self.artistLabContainer.style.display = 'block';
            document.getElementById('studio-negative-section').style.display = 'block';
            document.getElementById('studio-sampler-wrapper').style.display = 'block';
            
            self.samplerSelect.innerHTML = `
                <option value="k_euler">Euler (标准快速)</option>
                <option value="k_euler_ancestral">Euler Ancestral (柔和插值)</option>
                <option value="k_dpmpp_2m">DPM++ 2M (解析质感)</option>
                <option value="k_dpmpp_sde">DPM++ SDE (多细节细节)</option>
                <option value="ddim">DDIM (复古平滑)</option>
            `;
        } else if (backend === 'sd') {
            self.advancedControls.style.display = 'block';
            self.naiParamsPanel.style.display = 'none';
            self.artistLabContainer.style.display = 'block';
            document.getElementById('studio-negative-section').style.display = 'block';
            document.getElementById('studio-sampler-wrapper').style.display = 'block';
            
            self.samplerSelect.innerHTML = `
                <option value="k_euler">Euler</option>
                <option value="k_euler_ancestral">Euler a</option>
                <option value="k_dpmpp_2m">DPM++ 2M</option>
                <option value="k_dpmpp_2m_karras">DPM++ 2M Karras</option>
                <option value="k_dpmpp_sde_karras">DPM++ SDE Karras</option>
                <option value="ddim">DDIM</option>
            `;
        } else if (backend === 'v1') {
            self.advancedControls.style.display = 'block';
            self.naiParamsPanel.style.display = 'none';
            self.artistLabContainer.style.display = 'none';
            document.getElementById('studio-negative-section').style.display = 'none';
            document.getElementById('studio-sampler-wrapper').style.display = 'none';
        }
    },

    // 处理参考图上传转换 base64
    handleVibeImageUpload(file) {
        const self = this;
        const reader = new FileReader();
        reader.onload = (event) => {
            const base64 = event.target.result;
            self.vibePreviewImg.src = base64;
            self.vibePreview.style.display = 'block';
            self.vibeIntensityWrap.style.display = 'block';
            self.vibeFileInput.value = '';
            
            const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
            if (activeDraft) {
                activeDraft.params.vibeBase64 = base64;
                self.saveDraftsToStorage();
            }
        };
        reader.readAsDataURL(file);
    },

    // 退出批量选择
    exitBatchMode() {
        const self = this;
        self.batchBar.style.display = 'none';
        self.btnToggleBatch.textContent = '批量管理';
        const cards = self.galleryGrid.querySelectorAll('.gallery-card');
        cards.forEach(card => card.classList.remove('selected'));
        self.selectedImageIds = [];
        self.batchSelectedCount.textContent = '0';
    },

    // 滑动条和数值输入框的双向同步
    syncParameters() {
        const self = this;
        if (document.activeElement === self.rangeSteps) {
            self.valStepsNum.value = self.rangeSteps.value;
        } else if (document.activeElement === self.valStepsNum) {
            self.rangeSteps.value = self.valStepsNum.value;
        }
        if (document.activeElement === self.rangeScale) {
            self.valScaleNum.value = parseFloat(self.rangeScale.value).toFixed(1);
        } else if (document.activeElement === self.valScaleNum) {
            self.rangeSteps.value = self.valScaleNum.value;
        }
        if (document.activeElement === self.vibeStrength) {
            self.vibeStrengthNum.value = parseFloat(self.vibeStrength.value).toFixed(2);
        } else if (document.activeElement === self.vibeStrengthNum) {
            self.vibeStrength.value = self.vibeStrengthNum.value;
        }

        if (self.cbSmea && self.cbSmea.checked) {
            self.smeaDynWrap.style.display = 'block';
        } else if (self.cbSmea) {
            self.smeaDynWrap.style.display = 'none';
        }
    },

    // 渲染草稿槽位标签
    renderDraftsList() {
        const self = this;
        self.draftTabsList.innerHTML = '';

        self.drafts.forEach(draft => {
            const tab = document.createElement('button');
            tab.className = `draft-tab-item ${draft.id === self.activeDraftId ? 'active' : ''}`;
            
            const span = document.createElement('span');
            span.textContent = draft.name;
            span.addEventListener('click', () => {
                self.activeDraftId = draft.id;
                self.saveDraftsToStorage();
                self.renderDraftsList();
                self.loadActiveDraftToUI();
                self.fetchModelsFromServer(draft.targetBackend);
            });

            span.addEventListener('dblclick', () => {
                const newName = prompt('重命名草稿为：', draft.name);
                if (newName && newName.trim() !== '') {
                    draft.name = newName.trim();
                    self.saveDraftsToStorage();
                    self.renderDraftsList();
                }
            });

            const delBtn = document.createElement('span');
            delBtn.className = 'tab-close-icon';
            delBtn.innerHTML = '&times;';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (self.drafts.length <= 1) {
                    alert('请至少保留一个生图草稿。');
                    return;
                }
                if (confirm(`确认永久删除草稿 "${draft.name}" 吗？`)) {
                    self.drafts = self.drafts.filter(d => d.id !== draft.id);
                    if (self.activeDraftId === draft.id) {
                        self.activeDraftId = self.drafts[0].id;
                    }
                    self.saveDraftsToStorage();
                    self.renderDraftsList();
                    self.loadActiveDraftToUI();
                    
                    const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
                    self.fetchModelsFromServer(activeDraft.targetBackend);
                }
            });

            tab.appendChild(span);
            tab.appendChild(delBtn);
            self.draftTabsList.appendChild(tab);
        });

        self.btnAddDraft.onclick = () => {
            self.createNewDraft();
        };
    },

    // 新建草稿
    createNewDraft() {
        const self = this;
        const newId = 'draft_' + Date.now();
        const letter = String.fromCharCode(65 + (self.drafts.length % 26));
        const newDraft = {
            id: newId,
            name: `草稿 ${letter}`,
            prompt: '',
            subject: '',
            negativePrompt: '',
            targetBackend: 'novelai',
            artists: [],
            params: {
                width: 832,
                height: 1216,
                steps: 28,
                scale: 5.0,
                sampler: 'k_euler',
                seed: -1,
                model: 'nai-diffusion-4-5-full',
                smea: false,
                smeaDyn: false,
                vibeBase64: null,
                vibeStrength: 0.6
            }
        };

        self.saveUIToActiveDraft();
        self.drafts.push(newDraft);
        self.activeDraftId = newId;
        self.loadActiveDraftToUI();
        self.renderDraftsList();
    },

    // 将激活的草稿数据同步到页面上
    loadActiveDraftToUI() {
        const self = this;
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (!activeDraft) return;

        self.taPrompt.value = activeDraft.prompt || '';
        self.taSubject.value = activeDraft.subject || '';
        self.taNegativePrompt.value = activeDraft.negativePrompt || '';
        self.taManualArtists.value = (activeDraft.params && activeDraft.params.manualArtists) ? activeDraft.params.manualArtists : '';

        self.engineSelect.value = activeDraft.targetBackend || 'novelai';
        self.inputSeed.value = (activeDraft.params && activeDraft.params.seed !== undefined) ? activeDraft.params.seed : -1;

        if (activeDraft.params) {
            self.inputWidth.value = activeDraft.params.width || 832;
            self.inputHeight.value = activeDraft.params.height || 1216;
            
            self.rangeSteps.value = activeDraft.params.steps || 28;
            self.valStepsNum.value = activeDraft.params.steps || 28;
            
            self.rangeScale.value = activeDraft.params.scale || 5.0;
            self.valScaleNum.value = activeDraft.params.scale || 5.0;

            if (self.cbSmea) self.cbSmea.checked = !!activeDraft.params.smea;
            if (self.cbSmeaDyn) self.cbSmeaDyn.checked = !!activeDraft.params.smeaDyn;
            if (self.vibeStrength) {
                self.vibeStrength.value = activeDraft.params.vibeStrength !== undefined ? activeDraft.params.vibeStrength : 0.6;
                self.vibeStrengthNum.value = self.vibeStrength.value;
            }
        }

        self.toggleParametersVisibility(activeDraft.targetBackend);

        if (activeDraft.params && activeDraft.params.vibeBase64) {
            self.vibePreviewImg.src = activeDraft.params.vibeBase64;
            self.vibePreview.style.display = 'block';
            self.vibeIntensityWrap.style.display = 'block';
            self.vibeDropzone.style.display = 'none';
        } else {
            self.vibePreviewImg.src = '';
            self.vibePreview.style.display = 'none';
            self.vibeIntensityWrap.style.display = 'none';
            self.vibeDropzone.style.display = 'flex';
        }

        if (activeDraft.params && activeDraft.params.sampler) {
            self.samplerSelect.value = activeDraft.params.sampler;
        }

        self.syncParameters();
        self.renderArtistChips();
    },

    // 抓取页面 UI 参数写入激活草稿
    saveUIToActiveDraft() {
        const self = this;
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (!activeDraft) return;

        activeDraft.prompt = self.taPrompt.value;
        activeDraft.subject = self.taSubject.value;
        activeDraft.negativePrompt = self.taNegativePrompt.value;
        activeDraft.targetBackend = self.engineSelect.value;
        
        if (!activeDraft.params) activeDraft.params = {};
        activeDraft.params.width = parseInt(self.inputWidth.value) || 832;
        activeDraft.params.height = parseInt(self.inputHeight.value) || 1216;
        activeDraft.params.steps = parseInt(self.rangeSteps.value) || 28;
        activeDraft.params.scale = parseFloat(self.rangeScale.value) || 5.0;
        activeDraft.params.sampler = self.samplerSelect.value;
        activeDraft.params.seed = parseInt(self.inputSeed.value) === -1 ? -1 : (parseInt(self.inputSeed.value) || -1);
        activeDraft.params.model = self.modelSelect.value;
        activeDraft.params.smea = self.cbSmea ? self.cbSmea.checked : false;
        activeDraft.params.smeaDyn = self.cbSmeaDyn ? self.cbSmeaDyn.checked : false;
        activeDraft.params.vibeStrength = self.vibeStrength ? parseFloat(self.vibeStrength.value) : 0.6;
        activeDraft.params.manualArtists = self.taManualArtists.value;

        self.saveDraftsToStorage();
    },

    saveDraftsToStorage() {
        const self = this;
        localStorage.setItem('studio_workbench_drafts', JSON.stringify(self.drafts));
        localStorage.setItem('studio_workbench_active_draft_id', self.activeDraftId);
    },

    // 智能编译拼接最终的正向生图提示词 (严格三段式拼接)
    compileFinalPrompt(draft) {
        const self = this;
        const backend = draft.targetBackend;

        let basePrompt = draft.prompt ? draft.prompt.trim() : '';
        let subjectText = draft.subject ? draft.subject.trim() : '';

        let manualArtistsArr = draft.params.manualArtists 
            ? draft.params.manualArtists.split(',').map(a => a.trim()).filter(Boolean)
            : [];
        let labArtistsArr = draft.artists || [];

        let artistCompiledStr = '';

        if (backend === 'novelai') {
            const compiledChips = labArtistsArr.map(art => {
                const w = parseFloat(art.weight || 1.0).toFixed(2);
                return `${w}::artist:${art.content || art.name}::`;
            });
            const compiledManuals = manualArtistsArr.map(art => {
                let weight = "1.00";
                let name = art;
                const match = art.match(/\(([^)]+):([0-9.]+)\)/);
                if (match) {
                    name = match[1];
                    weight = parseFloat(match[2]).toFixed(2);
                }
                return `${weight}::artist:${name}::`;
            });
            artistCompiledStr = [...compiledManuals, ...compiledChips].join(', ');
        } else {
            const compiledChips = labArtistsArr.map(art => {
                const w = parseFloat(art.weight || 1.0).toFixed(2);
                return `(artist:${art.content || art.name}:${w})`;
            });
            const compiledManuals = manualArtistsArr.map(art => {
                if (art.includes(':')) return art;
                return `(artist:${art}:1.00)`;
            });
            artistCompiledStr = [...compiledManuals, ...compiledChips].join(', ');
        }

        let finalPromptArr = [];
        if (basePrompt) finalPromptArr.push(basePrompt);
        if (subjectText) finalPromptArr.push(subjectText);
        
        let corePrompt = finalPromptArr.join(', ');

        const injectPosObj = document.querySelector('input[name="artist-inject-pos"]:checked');
        const injectPos = injectPosObj ? injectPosObj.value : 'prefix';

        if (artistCompiledStr) {
            if (injectPos === 'prefix') {
                corePrompt = artistCompiledStr + (corePrompt ? ', ' + corePrompt : '');
            } else {
                corePrompt = (corePrompt ? corePrompt + ', ' : '') + artistCompiledStr;
            }
        }

        return corePrompt;
    },

    // 发起生成动作 (解除按钮独占，支持高速并发投递)
    triggerGenerateAction() {
        const self = this;
        self.saveUIToActiveDraft();
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (!activeDraft) return;

        if (self.btnGenerate) {
            self.btnGenerate.classList.add('btn-clicked-feedback');
            setTimeout(() => {
                self.btnGenerate.classList.remove('btn-clicked-feedback');
            }, 300);
        }

        const finalPrompt = self.compileFinalPrompt(activeDraft);

        const task = {
            draftName: activeDraft.name || '草稿',
            backend: activeDraft.targetBackend,
            prompt: finalPrompt,
            params: {
                width: activeDraft.params.width,
                height: activeDraft.params.height,
                steps: activeDraft.params.steps,
                scale: activeDraft.params.scale,
                sampler: activeDraft.params.sampler,
                seed: activeDraft.params.seed,
                model: activeDraft.params.model,
                smea: activeDraft.params.smea,
                smeaDyn: activeDraft.params.smeaDyn,
                vibeBase64: activeDraft.params.vibeBase64,
                vibeStrength: activeDraft.params.vibeStrength,
                negativePrompt: activeDraft.negativePrompt
            }
        };

        generatorQueue.enqueue(task);
        self.showNotification(`任务 [${task.draftName}] 已投递至调度队列`);
    },

    // 监控更新生成状态 UI
    updateGeneratorStatusUI(queue = [], active = []) {
        const self = this;
        if (!self.btnGenerate) return;
        const total = queue.length + active.length;

        if (total > 0) {
            if (active.length > 0) {
                self.btnGenerate.innerHTML = `
                    <svg class="spin-icon-generating" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
                        <path d="M12 2C6.47715 2 2 6.47715 2 12C2 13.578 2.366 15.07 3.017 16.4" stroke-linecap="round"></path>
                    </svg>
                    <span>生成中 (${active.length} 并发 / ${queue.length} 排队)</span>
                `;
                if (self.btnInterrupt) self.btnInterrupt.style.display = 'inline-flex';
            }
        } else {
            self.btnGenerate.disabled = false;
            self.btnGenerate.classList.remove('generating');
            self.btnGenerate.innerHTML = `
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                <span>开始生成 (CTRL+ENTER)</span>
            `;
            if (self.btnInterrupt) self.btnInterrupt.style.display = 'none';
        }
    },

    // 自动挂载悬浮监视器骨架
    initQueueMonitorDOM() {
        const self = this;
        let monitor = document.getElementById('floating-queue-monitor');
        if (!monitor) {
            monitor = document.createElement('div');
            monitor.id = 'floating-queue-monitor';
            monitor.className = 'floating-queue-panel collapsed';
            monitor.innerHTML = `
                <div class="queue-header" id="queue-monitor-toggle">
                    <div class="queue-title-wrap">
                        <span class="queue-indicator-dot"></span>
                        <span class="queue-title">QUEUE MONITOR</span>
                        <span class="queue-badge-count" id="queue-total-count">0</span>
                    </div>
                    <div class="queue-header-actions">
                        <button class="btn-queue-icon" id="btn-toggle-queue-collapse" title="展开/收起">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="queue-body" id="queue-monitor-body">
                    <div class="queue-section">
                        <div class="queue-section-title">ACTIVE & QUEUED</div>
                        <div class="queue-list" id="queue-active-list">
                            <div class="queue-empty-text">当前无正在执行的任务</div>
                        </div>
                    </div>
                    <div class="queue-section">
                        <div class="queue-section-title">RECENT HISTORY</div>
                        <div class="queue-list" id="queue-history-list">
                            <div class="queue-empty-text">暂无已完成的生成历史</div>
                        </div>
                    </div>
                    <div class="queue-footer">
                        <button class="btn-queue-action" id="btn-queue-cancel-all">TERMINATE ALL</button>
                        <button class="btn-queue-action" id="btn-queue-clear-history">CLEAR HISTORY</button>
                    </div>
                </div>
            `;
            document.body.appendChild(monitor);

            const toggleHeader = monitor.querySelector('#queue-monitor-toggle');
            toggleHeader.addEventListener('click', () => {
                monitor.classList.toggle('collapsed');
            });

            monitor.querySelector('#btn-queue-cancel-all').addEventListener('click', (e) => {
                e.stopPropagation();
                generatorQueue.cancelAll();
                self.showNotification('已强行终止所有排队与生成任务');
            });

            monitor.querySelector('#btn-queue-clear-history').addEventListener('click', (e) => {
                e.stopPropagation();
                generatorQueue.clearHistory();
            });
        }
        self.queueMonitor = monitor;
    },

    // 渲染悬浮队列监视器内容
    renderQueueMonitor(state) {
        const self = this;
        if (!self.queueMonitor) return;

        const totalActive = (state.active || []).length + (state.queue || []).length;
        const countBadge = document.getElementById('queue-total-count');
        const dotIndicator = self.queueMonitor.querySelector('.queue-indicator-dot');
        
        if (countBadge) countBadge.textContent = totalActive;
        
        if (totalActive > 0) {
            if (dotIndicator) dotIndicator.classList.add('active-pulse');
            self.queueMonitor.classList.remove('collapsed');
        } else {
            if (dotIndicator) dotIndicator.classList.remove('active-pulse');
        }

        const activeContainer = document.getElementById('queue-active-list');
        if (activeContainer) {
            activeContainer.innerHTML = '';
            if ((!state.active || state.active.length === 0) && (!state.queue || state.queue.length === 0)) {
                activeContainer.innerHTML = '<div class="queue-empty-text">当前无正在执行的任务</div>';
            } else {
                (state.active || []).forEach(t => {
                    const row = document.createElement('div');
                    row.className = 'queue-item active';
                    row.innerHTML = `
                        <div class="queue-item-info">
                            <svg class="spin-icon-generating" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
                                <path d="M12 2C6.47715 2 2 6.47715 2 12C2 13.578 2.366 15.07 3.017 16.4" stroke-linecap="round"></path>
                            </svg>
                            <span class="queue-item-name">${t.draftName || '生图任务'}</span>
                            <span class="queue-item-meta">${(t.backend || '').toUpperCase()}</span>
                        </div>
                        <button class="btn-task-cancel" data-id="${t.id}" title="终止任务">ABORT</button>
                    `;
                    row.querySelector('.btn-task-cancel').addEventListener('click', (e) => {
                        e.stopPropagation();
                        generatorQueue.cancel(t.id);
                    });
                    activeContainer.appendChild(row);
                });

                (state.queue || []).forEach((t, idx) => {
                    const row = document.createElement('div');
                    row.className = 'queue-item queued';
                    row.innerHTML = `
                        <div class="queue-item-info">
                            <span class="queue-order-badge">#${idx + 1}</span>
                            <span class="queue-item-name">${t.draftName || '生图任务'}</span>
                        </div>
                        <button class="btn-task-cancel" data-id="${t.id}" title="取消排队">REMOVE</button>
                    `;
                    row.querySelector('.btn-task-cancel').addEventListener('click', (e) => {
                        e.stopPropagation();
                        generatorQueue.cancel(t.id);
                    });
                    activeContainer.appendChild(row);
                });
            }
        }

        const historyContainer = document.getElementById('queue-history-list');
        if (historyContainer) {
            historyContainer.innerHTML = '';
            const allHistory = [...(state.completed || []), ...(state.failed || [])].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            
            if (allHistory.length === 0) {
                historyContainer.innerHTML = '<div class="queue-empty-text">暂无生成历史</div>';
            } else {
                allHistory.forEach(item => {
                    const row = document.createElement('div');
                    row.className = `queue-item ${item.status}`;
                    
                    if (item.status === 'completed') {
                        row.innerHTML = `
                            <div class="queue-item-info">
                                <div class="queue-item-thumb">
                                    <img src="${item.thumb || ''}" alt="thumb" />
                                </div>
                                <div class="queue-item-text">
                                    <span class="queue-item-name">${item.draftName || '已生成作品'}</span>
                                    <span class="queue-item-meta">${(item.backend || '').toUpperCase()} · SUCCESS</span>
                                </div>
                            </div>
                        `;
                        if (item.record) {
                            row.style.cursor = 'pointer';
                            row.addEventListener('click', () => {
                                self.openLightbox(item.record);
                            });
                        }
                    } else if (item.status === 'failed') {
                        row.innerHTML = `
                            <div class="queue-item-info">
                                <span class="queue-status-tag error">FAILED</span>
                                <div class="queue-item-text">
                                    <span class="queue-item-name">${item.draftName || '任务'}</span>
                                    <span class="queue-item-error" title="${item.error || '未知错误'}">${item.error || '生成失败'}</span>
                                </div>
                            </div>
                        `;
                        row.style.cursor = 'pointer';
                        row.addEventListener('click', () => {
                            self.showSystemError('生图任务失败', item.error || '请求异常');
                        });
                    }
                    historyContainer.appendChild(row);
                });
            }
        }
    },

    // ==========================================================================
    // 5. 画师实验室交互 (Artist Lab Core)
    // ==========================================================================
    addArtistToLab(artistItem) {
        const self = this;
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (!activeDraft) return;

        if (!activeDraft.artists) activeDraft.artists = [];
        if (activeDraft.artists.some(a => a.id === artistItem.id || a.name === artistItem.name)) {
            self.showNotification('画师已在工作盘中');
            return;
        }

        activeDraft.artists.push({
            id: artistItem.id || 'art_' + Date.now() + Math.random().toString(36).substr(2, 3),
            name: artistItem.name,
            content: artistItem.content || artistItem.name,
            weight: 1.00
        });

        self.saveDraftsToStorage();
        self.renderArtistChips();
        self.showNotification(`画师 ${artistItem.name} 已装载`);
    },

    renderArtistChips() {
        const self = this;
        self.artistChipsWrap.innerHTML = '';
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (!activeDraft || !activeDraft.artists || activeDraft.artists.length === 0) {
            self.artistChipsWrap.innerHTML = '<p class="empty-chips-text">从提示词书引入画师词条，即可在此处微调权重或启用混搭调色盘。</p>';
            return;
        }

        activeDraft.artists.forEach((art, index) => {
            const chip = document.createElement('div');
            chip.className = 'artist-chip';
            chip.dataset.id = art.id;

            const name = document.createElement('span');
            name.className = 'chip-name';
            name.textContent = art.name;

            const weightVal = document.createElement('span');
            weightVal.className = 'chip-weight-display';
            weightVal.textContent = parseFloat(art.weight).toFixed(2);

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0.1';
            slider.max = '2.0';
            slider.step = '0.05';
            slider.value = art.weight;
            slider.className = 'chip-slider';
            slider.addEventListener('input', (e) => {
                const newW = parseFloat(e.target.value);
                art.weight = newW;
                weightVal.textContent = newW.toFixed(2);
                self.saveDraftsToStorage();
            });

            const del = document.createElement('button');
            del.className = 'chip-del-btn';
            del.innerHTML = '&times;';
            del.addEventListener('click', (e) => {
                e.stopPropagation();
                activeDraft.artists.splice(index, 1);
                self.saveDraftsToStorage();
                self.renderArtistChips();
            });

            chip.appendChild(name);
            chip.appendChild(slider);
            chip.appendChild(weightVal);
            chip.appendChild(del);
            self.artistChipsWrap.appendChild(chip);
        });
    },

    autoBalanceWeights() {
        const self = this;
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (!activeDraft || !activeDraft.artists || activeDraft.artists.length === 0) return;

        const scaleList = [1.25, 1.05, 0.85];
        activeDraft.artists.forEach((art, index) => {
            if (index < scaleList.length) {
                art.weight = scaleList[index];
            } else {
                art.weight = 0.70;
            }
        });

        self.saveDraftsToStorage();
        self.renderArtistChips();
        self.showNotification('AI 黄金权重配平成功');
    },

    adjustArtistTension(tensionValue) {
        const self = this;
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (!activeDraft || !activeDraft.artists || activeDraft.artists.length === 0) return;

        const base = 1.0;
        const strength = tensionValue / 100.0;

        activeDraft.artists.forEach((art, idx) => {
            const offsetFactor = (idx % 2 === 0 ? 0.35 : -0.35);
            art.weight = Math.min(2.0, Math.max(0.1, base + (offsetFactor * strength)));
        });

        self.saveDraftsToStorage();
        self.renderArtistChips();
    },

    applyRandomWeights() {
        const self = this;
        let modifiedAny = false;

        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (activeDraft && activeDraft.artists && activeDraft.artists.length > 0) {
            activeDraft.artists.forEach(art => {
                art.weight = parseFloat((Math.random() * (1.4 - 0.6) + 0.6).toFixed(2));
            });
            self.renderArtistChips();
            modifiedAny = true;
        }

        const rawText = self.taManualArtists.value.trim();
        if (rawText) {
            const parts = rawText.split(',').map(p => p.trim()).filter(Boolean);
            const randomizedParts = parts.map(part => {
                let name = part;
                
                if (part.includes('::')) {
                    const match = part.match(/([0-9.]+)::artist:(.*?)::/) || part.match(/([0-9.]+)::(.*?)::/);
                    if (match) name = match[2];
                } else if (part.startsWith('(') && part.endsWith(')')) {
                    const match = part.match(/\((.*?):([0-9.]+)\)/) || part.match(/\(artist:(.*?):([0-9.]+)\)/);
                    if (match) name = match[1];
                }

                const randWeight = (Math.random() * (1.4 - 0.6) + 0.6).toFixed(2);
                const backend = self.engineSelect.value;
                if (backend === 'novelai') {
                    return `${randWeight}::artist:${name}::`;
                } else {
                    return `(artist:${name}:${randWeight})`;
                }
            });

            self.taManualArtists.value = randomizedParts.join(', ');
            modifiedAny = true;
        }

        if (modifiedAny) {
            self.saveUIToActiveDraft();
            self.showNotification('画师随机打权完成');
        } else {
            self.showNotification('画师盘和输入框为空，无操作目标');
        }
    },

    openSaveRecipeModal() {
        const self = this;
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (!activeDraft || !activeDraft.artists || activeDraft.artists.length === 0) {
            self.showNotification('无画师配方可供保存');
            return;
        }

        const previewText = activeDraft.artists.map(a => `${a.name}(${a.weight.toFixed(2)})`).join(', ');
        document.getElementById('recipe-content-preview').textContent = previewText;
        
        const modal = document.getElementById('artist-recipe-modal');
        modal.classList.add('open');

        const confirmBtn = document.getElementById('btn-confirm-save-recipe');
        const handler = () => {
            const nameInput = document.getElementById('input-recipe-name').value.trim();
            const remarkInput = document.getElementById('input-recipe-remark').value.trim();

            if (!nameInput) {
                alert('请填写配方显示名称');
                return;
            }

            const globalData = JSON.parse(localStorage.getItem('studio_workbench_data') || '{}');
            if (!globalData.prompts) globalData.prompts = { custom: {} };
            if (!globalData.prompts.custom) globalData.prompts.custom = {};
            if (!globalData.prompts.custom['画师配方']) {
                globalData.prompts.custom['画师配方'] = [];
            }

            const recipePrompt = activeDraft.artists.map(a => {
                const backend = activeDraft.targetBackend;
                if (backend === 'novelai') {
                    return `${a.weight.toFixed(2)}::artist:${a.content}::`;
                }
                return `(artist:${a.content}:${a.weight.toFixed(2)})`;
            }).join(', ');

            globalData.prompts.custom['画师配方'].push({
                id: 'recipe_' + Date.now(),
                name: nameInput,
                content: recipePrompt,
                remark: remarkInput || '画师实验室生成配方'
            });

            localStorage.setItem('studio_workbench_data', JSON.stringify(globalData));
            
            document.getElementById('input-recipe-name').value = '';
            document.getElementById('input-recipe-remark').value = '';
            modal.classList.remove('open');
            self.showNotification('画师配方已成功保存至提示词册！');

            if (window.PromptBook && typeof window.PromptBook.init === 'function') {
                window.PromptBook.init();
            }
            confirmBtn.removeEventListener('click', handler);
        };
        
        confirmBtn.onclick = handler;

        document.getElementById('btn-close-recipe-modal').onclick = () => {
            modal.classList.remove('open');
        };
    },

    // ==========================================================================
    // 6. 画廊局部刷新与交互 (Gallery Core UI)
    // ==========================================================================
    async refreshGallery() {
        const self = this;
        try {
            const list = await GalleryDB.getAll();
            self.galleryCountLabel.textContent = `共 ${list.length} 张作品`;
            
            const filterTabs = document.querySelectorAll('.engine-filter-tabs .filter-tab-item');
            filterTabs.forEach(tab => {
                tab.onclick = () => {
                    filterTabs.forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    const engineFilter = tab.dataset.filter;
                    if (engineFilter === 'all') {
                        self.renderGalleryGrid(list);
                    } else {
                        const filtered = list.filter(item => item.backend === engineFilter);
                        self.renderGalleryGrid(filtered);
                    }
                };
            });

            const activeFilterObj = document.querySelector('.engine-filter-tabs .filter-tab-item.active');
            const activeFilter = activeFilterObj ? activeFilterObj.dataset.filter : 'all';
            if (activeFilter === 'all') {
                self.renderGalleryGrid(list);
            } else {
                self.renderGalleryGrid(list.filter(item => item.backend === activeFilter));
            }

        } catch(e) {
            console.error('刷新画廊失败:', e);
        }
    },

    renderGalleryGrid(items) {
        const self = this;
        self.galleryGrid.innerHTML = '';

        if (items.length === 0) {
            self.galleryGrid.innerHTML = `
                <div class="gallery-empty">
                    <div class="gallery-empty-wireframe"></div>
                    <h3 class="gallery-empty-title">Gallery Vacant</h3>
                    <div class="gallery-empty-status">Status: Awaiting Creator Input</div>
                    <p class="gallery-empty-desc">
                        在左侧面板调整参数并点击上方“GENERATE”按钮启动绘图线程。渲染完成的作品将以二进制形式安全缓存在本地数据库中。
                    </p>
                </div>
            `;
            return;
        }

        items.forEach(item => {
            const card = document.createElement('div');
            card.className = `gallery-card ${self.selectedImageIds.includes(item.id) ? 'selected' : ''}`;
            card.dataset.id = item.id;

            const imgWrapper = document.createElement('div');
            imgWrapper.className = 'gallery-img-wrapper';

            const img = document.createElement('img');
            img.loading = 'lazy';
            
            if (item.thumb) {
                img.src = item.thumb;
            } else if (item.imageBlob) {
                const objectUrl = URL.createObjectURL(item.imageBlob);
                img.src = objectUrl;
                img.addEventListener('load', () => {
                    URL.revokeObjectURL(objectUrl);
                });
            }

            imgWrapper.appendChild(img);

            const overlay = document.createElement('div');
            overlay.className = 'gallery-overlay';

            const overlayContent = document.createElement('div');
            overlayContent.className = 'gallery-overlay-content';

            const infoPrompt = document.createElement('p');
            infoPrompt.className = 'overlay-prompt';
            infoPrompt.textContent = item.prompt;
            infoPrompt.title = item.prompt;

            const infoMeta = document.createElement('div');
            infoMeta.className = 'overlay-meta';
            infoMeta.innerHTML = `
                <span>${item.backend.toUpperCase()}</span>
                <span>${item.params.width}x${item.params.height}</span>
                <span>SEED: ${item.params.seed}</span>
            `;

            overlayContent.appendChild(infoPrompt);
            overlayContent.appendChild(infoMeta);

            const actionContainer = document.createElement('div');
            actionContainer.className = 'overlay-actions';

            const btnSend = document.createElement('button');
            btnSend.title = '回填参数至工作台';
            btnSend.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                </svg>
            `;
            btnSend.onclick = (e) => {
                e.stopPropagation();
                self.sendBackToWorkbench(item);
            };

            const btnDetail = document.createElement('button');
            btnDetail.title = '查看完整大图参数';
            btnDetail.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    <line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line>
                </svg>
            `;
            btnDetail.onclick = (e) => {
                e.stopPropagation();
                self.openLightbox(item);
            };

            actionContainer.appendChild(btnSend);
            actionContainer.appendChild(btnDetail);

            overlay.appendChild(overlayContent);
            overlay.appendChild(actionContainer);

            card.appendChild(imgWrapper);
            card.appendChild(overlay);

            card.onclick = () => {
                if (self.batchBar.style.display !== 'none') {
                    if (self.selectedImageIds.includes(item.id)) {
                        self.selectedImageIds = self.selectedImageIds.filter(id => id !== item.id);
                        card.classList.remove('selected');
                    } else {
                        self.selectedImageIds.push(item.id);
                        card.classList.add('selected');
                    }
                    self.batchSelectedCount.textContent = self.selectedImageIds.length;
                } else {
                    self.openLightbox(item);
                }
            };

            self.galleryGrid.appendChild(card);
        });
    },

    // 开启大图 Lightbox 弹窗
    openLightbox(item) {
        const self = this;
        self.activeLightboxItem = item;

        const objectUrl = URL.createObjectURL(item.imageBlob);
        self.lightboxImg.src = objectUrl;
        self.lightboxImg.onload = () => {
            URL.revokeObjectURL(objectUrl);
        };

        const dateStr = new Date(item.timestamp).toLocaleString();
        self.lightboxTimestamp.textContent = `生成时间: ${dateStr}`;
        self.lightboxEngine.textContent = `${item.backend.toUpperCase()} - ${item.params.model || 'DALL-E 3 / Standard'}`;
        self.lightboxPrompt.textContent = item.prompt;
        
        if (item.negativePrompt) {
            document.getElementById('lightbox-meta-uc-section').style.display = 'block';
            self.lightboxNegative.textContent = item.negativePrompt;
        } else {
            document.getElementById('lightbox-meta-uc-section').style.display = 'none';
        }

        self.lightboxSeed.textContent = item.params.seed;
        self.lightboxDimension.textContent = `${item.params.width} x ${item.params.height}`;
        self.lightboxSteps.textContent = item.params.steps || '--';
        self.lightboxScale.textContent = item.params.scale || '--';
        self.lightboxSampler.textContent = item.params.sampler || '--';

        document.getElementById('btn-copy-meta-prompt').onclick = () => {
            navigator.clipboard.writeText(item.prompt).then(() => {
                self.showNotification('提示词已复制到剪贴板');
            });
        };

        self.lightbox.classList.add('open');
    },

    // 一键复用参数回工作台
    async sendBackToWorkbench(item) {
        const self = this;
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (!activeDraft) return;

        activeDraft.prompt = item.prompt;
        activeDraft.negativePrompt = item.negativePrompt || '';
        activeDraft.targetBackend = item.backend;
        
        activeDraft.params.width = item.params.width;
        activeDraft.params.height = item.params.height;
        activeDraft.params.steps = item.params.steps || 28;
        activeDraft.params.scale = item.params.scale || 5.0;
        activeDraft.params.sampler = item.params.sampler || 'k_euler';
        activeDraft.params.seed = item.params.seed;
        activeDraft.params.model = item.params.model || '';

        if (item.backend === 'novelai') {
            activeDraft.params.smea = !!item.params.smea;
            activeDraft.params.smeaDyn = !!item.params.smeaDyn;
        }

        self.saveDraftsToStorage();
        self.loadActiveDraftToUI();
        await self.fetchModelsFromServer(item.backend);

        self.showNotification('作品的全部生成参数已复用回工作台');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    // 新增功能：一键创建后续待办任务
    createFollowUpTask(item) {
        const self = this;
        const globalData = JSON.parse(localStorage.getItem('studio_workbench_data') || '{}');
        if (!globalData.todos) globalData.todos = [];

        const taskText = `优化图像细节 (Engine: ${item.backend.toUpperCase()} | Seed: ${item.params.seed})`;
        
        globalData.todos.push({
            id: 'todo_' + Date.now(),
            text: taskText,
            status: 'pending'
        });

        localStorage.setItem('studio_workbench_data', JSON.stringify(globalData));
        self.showNotification('已在 TODO 面板创建后续任务');

        if (window.JournalManager && typeof window.JournalManager.init === 'function') {
            window.JournalManager.init();
        }
    },

    // 并行生成4张变体
    triggerRollVariations(item) {
        const self = this;
        self.showNotification('开始以该参数并行生成4张不同 Seed 变体...');
        
        for (let i = 0; i < 4; i++) {
            const task = {
                backend: item.backend,
                prompt: item.prompt,
                params: {
                    ...item.params,
                    seed: Math.floor(Math.random() * 9999999999)
                }
            };
            generatorQueue.enqueue(task);
        }
    },

    // 利用 Canvas 擦除图像 Exif 信息，确保原图干净导出 (Exif Clean)
    async cleanMetadata(blob) {
        return new Promise((resolve) => {
            const img = new Image();
            img.src = URL.createObjectURL(blob);
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                canvas.toBlob((cleanBlob) => {
                    URL.revokeObjectURL(img.src);
                    resolve(cleanBlob);
                }, 'image/png');
            };
            img.onerror = () => {
                resolve(blob);
            };
        });
    },

    /**
     * 将原始二进制图像转为极轻量的缩略图 Base64 (用于画廊超快速秒开渲染)
     */
    async createThumbnail(blob, maxDimension = 384) {
        return new Promise((resolve) => {
            const img = new Image();
            const url = URL.createObjectURL(blob);
            img.src = url;
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                
                if (width > height) {
                    if (width > maxDimension) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    }
                } else {
                    if (height > maxDimension) {
                        width = Math.round((width * maxDimension) / height);
                        height = maxDimension;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'medium';
                ctx.drawImage(img, 0, 0, width, height);

                const thumbBase64 = canvas.toDataURL('image/webp', 0.8) || canvas.toDataURL('image/jpeg', 0.8);
                URL.revokeObjectURL(url);
                resolve(thumbBase64);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                resolve(null);
            };
        });
    },

    async downloadSingleImage(id, cleanExif = false) {
        const self = this;
        const all = await GalleryDB.getAll();
        const item = all.find(i => i.id === id);
        if (!item) return;

        let finalBlob = item.imageBlob;
        if (cleanExif) {
            finalBlob = await self.cleanMetadata(item.imageBlob);
        }

        const url = URL.createObjectURL(finalBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${item.backend}_${item.params.seed}_${cleanExif ? 'clean_' : ''}${item.id}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    /**
     * 批量下载图片 (已整合 JSZip 打包与 Exif/Metadata 剥离)
     */
    async downloadMultipleImages(ids, cleanExif = false) {
        const self = this;
        const all = await GalleryDB.getAll();
        const targets = all.filter(i => ids.includes(i.id));

        if (targets.length === 0) {
            self.showNotification('未选择任何作品');
            return;
        }

        if (targets.length === 1) {
            this.downloadSingleImage(targets[0].id, cleanExif);
            return;
        }

        if (typeof JSZip === 'undefined') {
            self.showNotification('JSZip 依赖未加载，将为您触发多张文件逐个直链下载');
            targets.forEach(item => {
                this.downloadSingleImage(item.id, cleanExif);
            });
            return;
        }

        self.showNotification(`正在处理并压缩打包 ${targets.length} 张图片${cleanExif ? ' (已开启 Exif 清除)' : ''}...`);
        const zip = new JSZip();

        for (let i = 0; i < targets.length; i++) {
            const item = targets[i];
            let blob = item.imageBlob;
            
            if (cleanExif) {
                blob = await self.cleanMetadata(item.imageBlob);
            }

            const filename = `${item.backend}_${item.params.seed || 'seed'}_${cleanExif ? 'clean_' : ''}${item.id}.png`;
            zip.file(filename, blob);
        }

        try {
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `studio_gallery_batch_${cleanExif ? 'clean_' : ''}${Date.now()}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            self.showNotification(`打包完成！已成功下载包含 ${targets.length} 张原图的 ZIP 包`);
        } catch (e) {
            console.error('ZIP 导出异常:', e);
            self.showSystemError('批量打包下载失败', e.message);
        }
    },

    // ==========================================================================
    // 7. 自定义杂志风格报错弹窗组件 (Error Modal Control)
    // ==========================================================================
    initCustomErrorModal() {
        const self = this;
        if (!self.errorModal) return;

        self.btnCloseErrorModal.onclick = () => {
            self.errorModal.classList.remove('open');
        };

        self.errorModal.addEventListener('click', (e) => {
            if (e.target === self.errorModal) self.errorModal.classList.remove('open');
        });

        self.btnCopyErrorLog.onclick = () => {
            const text = self.errorModalMessage.textContent;
            navigator.clipboard.writeText(text).then(() => {
                self.showNotification('错误日志已复制');
            });
        };
    },

    showSystemError(title, message) {
        const self = this;
        if (self.errorModal && self.errorModalTitle && self.errorModalMessage) {
            self.errorModalTitle.textContent = title.toUpperCase();
            self.errorModalMessage.textContent = message;
            self.errorModal.classList.add('open');
        } else {
            alert(`[${title}] ${message}`);
        }
    },

    showNotification(msg) {
        const toast = document.createElement('div');
        toast.className = 'toast-notification-system';
        toast.style.position = 'fixed';
        toast.style.bottom = '2rem';
        toast.style.left = '50%';
        toast.style.transform = 'translateX(-50%)';
        toast.style.background = 'var(--text-primary)';
        toast.style.color = 'var(--bg-base)';
        toast.style.padding = '0.6rem 1.5rem';
        toast.style.borderRadius = '2px';
        toast.style.fontSize = '0.75rem';
        toast.style.letterSpacing = '0.05em';
        toast.style.zIndex = '10000';
        toast.style.boxShadow = 'var(--shadow-lg)';
        toast.textContent = msg.toUpperCase();

        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.4s ease';
            setTimeout(() => toast.remove(), 400);
        }, 2200);
    },

    renderArtistLab() {
        // 画师实验室内部相关渲染占位
    }
};

// DOMContentLoaded 自动装配
document.addEventListener('DOMContentLoaded', () => {
    window.StudioManager.init();
});
