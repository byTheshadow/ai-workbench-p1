/**
 * THE STUDIO WORKBENCH - GENERATOR MODULE
 * 纯前端生图工作室核心逻辑 - 美化适配与全能兼容整合版
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

    // 传统的前缀型代理 (直接在 URL 前追加)
    if (!proxy.endsWith('/')) {
        proxy += '/';
    }
    return proxy + targetUrl;
}

// ==========================================================================
// 2. 调度队列机制 (Scheduling Queue)
// ==========================================================================
class GeneratorQueue extends EventTarget {
    constructor() {
        super();
        this.queue = [];
        this.active = [];
        this.completed = [];
        this.failed = [];
        this.maxConcurrent = 1;
        this.listeners = [];
    }

    addEventListener(callback) {
        this.listeners.push(callback);
    }

    emit() {
        const state = {
            queue: [...this.queue],
            active: [...this.active],
            completed: [...this.completed],
            failed: [...this.failed]
        };
        this.listeners.forEach(fn => fn(state));
    }

    enqueue(task) {
        const self = this;
        const taskItem = {
            id: 'task_' + Date.now() + Math.random().toString(36).substr(2, 3),
            backend: task.backend,
            prompt: task.prompt,
            params: task.params,
            timestamp: Date.now(),
            status: 'waiting',
            controller: new AbortController()
        };

        this.queue.push(taskItem);
        this.emit();
        this.next();
    }

    cancel(taskId) {
        const qIdx = this.queue.findIndex(t => t.id === taskId);
        if (qIdx !== -1) {
            this.queue.splice(qIdx, 1);
            this.emit();
            return;
        }

        const aIdx = this.active.findIndex(t => t.id === taskId);
        if (aIdx !== -1) {
            const task = this.active[aIdx];
            task.controller.abort();
            this.active.splice(aIdx, 1);
            this.emit();
            this.next();
        }
    }

    cancelAll() {
        this.active.forEach(t => t.controller.abort());
        this.active = [];
        this.queue = [];
        this.emit();
    }

    clearHistory() {
        this.completed = [];
        this.failed = [];
        this.emit();
    }

    async next() {
        const self = this;
        if (self.active.length >= self.maxConcurrent) return;
        if (self.queue.length === 0) return;

        const task = this.queue.shift();
        task.status = 'generating';
        self.active.push(task);
        self.emit();

        try {
            const record = await window.StudioManager.executeGenerationTask(task, task.controller);
            task.status = 'completed';
            task.record = record;
            
            // 移入完成列表并截断保留最近10个记录
            self.completed.unshift(task);
            if (self.completed.length > 10) self.completed.pop();
            
            self.active = self.active.filter(t => t.id !== task.id);
            self.emit();
            
            window.StudioManager.showNotification('绘图线程渲染完毕，已存盘');
            window.StudioManager.refreshGallery();
        } catch (err) {
            if (err.name === 'AbortError') {
                task.status = 'cancelled';
                task.error = 'User Interrupted';
            } else {
                task.status = 'failed';
                task.error = err.message || String(err);
                
                // 仅在任务未被取消且出真错时抛出气泡弹窗
                window.StudioManager.showSystemError('生图线程异常中断', task.error);
            }
            self.failed.unshift(task);
            if (self.failed.length > 10) self.failed.pop();

            self.active = self.active.filter(t => t.id !== task.id);
            self.emit();
        } finally {
            self.next();
        }
    }
}

const generatorQueue = new GeneratorQueue();

// ==========================================================================
// 3. WORKBENCH MANAGER 主类对象
// ==========================================================================
window.StudioManager = {
    // 数据模型
    drafts: [
        {
            id: 'draft-default',
            name: '默认草稿 #1',
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
                sampler: 'k_euler_ancestral',
                seed: -1,
                model: 'nai-diffusion-3',
                smea: false,
                smeaDyn: false,
                vibeStrength: 0.6,
                vibeBase64: null,
                manualArtists: ''
            }
        }
    ],
    activeDraftId: 'draft-default',

    // 模型数据缓存
    modelsCache: {
        novelai: [],
        sd_webui: [],
        comfyui: []
    },

    // ==========================================================================
    // 3.1 跨域代理安全策略与 API 请求器
    // ==========================================================================
    async callAPI(url, options = {}, backendName = '') {
        const globalSettingsStr = localStorage.getItem('studio_settings');
        let parsed = {};
        if (globalSettingsStr) {
            try { parsed = JSON.parse(globalSettingsStr); } catch(e){}
        }

        const proxy = parsed.apiProxyUrl || '';
        const userAgent = parsed.customUserAgent || '';

        // 获取对应的 API Key / Token
        let token = '';
        if (backendName === 'novelai') {
            token = parsed.novelaiToken || '';
        } else if (backendName === 'sd_webui') {
            token = parsed.sdWebuiAuth || '';
        } else if (backendName === 'comfyui') {
            token = parsed.comfyuiAuth || '';
        }

        // 构建 headers
        if (!options.headers) options.headers = {};
        
        if (token && token.trim()) {
            if (backendName === 'novelai') {
                options.headers['Authorization'] = `Bearer ${token.trim()}`;
            } else {
                // SD WebUI / ComfyUI Token 兼容
                options.headers['Authorization'] = token.trim().startsWith('Basic ') 
                    ? token.trim() 
                    : `Bearer ${token.trim()}`;
            }
        }

        if (userAgent && userAgent.trim()) {
            options.headers['X-User-Agent'] = userAgent.trim();
        }

        // 转换请求代理
        const cleanUrl = getCleanProxyUrl(url, proxy);

        // 发起网络请求
        return fetch(cleanUrl, options);
    },

    // ==========================================================================
    // 3.2 动态获取并更新模型列表
    // ==========================================================================
    async fetchModelsFromServer(backend, forceRefresh = false) {
        const self = this;
        if (!forceRefresh && self.modelsCache[backend] && self.modelsCache[backend].length > 0) {
            self.renderModelOptions(self.modelsCache[backend]);
            return;
        }

        const globalSettingsStr = localStorage.getItem('studio_settings');
        let parsed = {};
        if (globalSettingsStr) {
            try { parsed = JSON.parse(globalSettingsStr); } catch(e){}
        }

        // 默认空状态时加载本地降级模型库
        if (backend === 'novelai') {
            const fallbackNaiModels = [
                { id: 'nai-diffusion-3', name: 'NovelAI Diffusion V3 (最新推荐)' },
                { id: 'safe-diffusion-3', name: 'NovelAI Diffusion V3 (Safe)' },
                { id: 'furry-diffusion-3', name: 'NovelAI Furry V3 (兽人专化)' },
                { id: 'nai-diffusion-2', name: 'NovelAI Diffusion V2' },
                { id: 'furry-diffusion', name: 'NovelAI Furry V1' }
            ];
            self.modelsCache.novelai = fallbackNaiModels;
            self.renderModelOptions(fallbackNaiModels);
            return;
        }

        let endpoint = '';
        if (backend === 'sd_webui') {
            endpoint = parsed.sdWebuiUrl || 'http://127.0.0.1:7860';
            endpoint = endpoint.replace(/\/$/, '') + '/sdapi/v1/sd-models';
        } else if (backend === 'comfyui') {
            endpoint = parsed.comfyuiUrl || 'http://127.0.0.1:8188';
            endpoint = endpoint.replace(/\/$/, '') + '/api/models'; 
        }

        if (!endpoint) return;

        try {
            const res = await self.callAPI(endpoint, { method: 'GET' }, backend);
            if (!res.ok) throw new Error(`HTTP 状态异常: ${res.status}`);
            const data = await res.json();

            let currentList = [];
            if (backend === 'sd_webui') {
                currentList = data.map(item => ({
                    id: item.title,
                    name: item.model_name
                }));
            } else if (backend === 'comfyui') {
                if (Array.isArray(data)) {
                    currentList = data.map(item => ({ id: item, name: item }));
                } else if (data.checkpoints) {
                    currentList = data.checkpoints.map(item => ({ id: item, name: item }));
                } else {
                    currentList = Object.keys(data).map(k => ({ id: k, name: k }));
                }
            }

            self.modelsCache[backend] = currentList;
            self.renderModelOptions(currentList);
            self.showNotification(`成功获取并缓存了 ${currentList.length} 个模型`);
        } catch (err) {
            console.warn(`无法在线获取 ${backend} 模型列表，使用本地预置缓存`, err);
            let localFallback = [];
            if (backend === 'sd_webui') {
                localFallback = [{ id: 'v1-5-pruned-emaonly.safetensors', name: 'Stable Diffusion v1.5 (本地降级)' }];
            } else if (backend === 'comfyui') {
                localFallback = [{ id: 'v1-5-pruned-emaonly.safetensors', name: 'v1-5-pruned-emaonly (本地降级)' }];
            }
            self.modelsCache[backend] = localFallback;
            self.renderModelOptions(localFallback);
            self.showNotification('已启用预设通用生图模型列表 (本地降级列表)');
        }
    },

    renderModelOptions(modelList) {
        const self = this;
        if (!self.modelSelect) return;
        self.modelSelect.innerHTML = '';
        modelList.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            self.modelSelect.appendChild(opt);
        });

        if (!self.modelSelect.value && self.modelSelect.options.length > 0) {
            self.modelSelect.selectedIndex = 0;
            self.saveUIToActiveDraft();
        }
    },

    // ==========================================================================
    // 4. UI 绑定与核心初始化 (Studio DOM Binding)
    // ==========================================================================
    async init() {
        const self = this;
        
        // 绑定沉浸式编辑器 DOM 节点
        self.composerModal = document.getElementById('studio-composer-modal');
        self.btnOpenComposer = document.getElementById('btn-open-composer');
        self.btnCloseComposer = document.getElementById('btn-close-composer');
        
        self.composerSubject = document.getElementById('composer-subject');
        self.composerPrompt = document.getElementById('composer-prompt');
        self.composerNegative = document.getElementById('composer-negative');
        
        self.composerCharCount = document.getElementById('composer-char-count');
        self.composerTokenCount = document.getElementById('composer-token-count');
        
        self.composerBtnApply = document.getElementById('composer-btn-apply');
        self.composerBtnGenerate = document.getElementById('composer-btn-generate');
        self.composerBtnCancel = document.getElementById('composer-btn-cancel');

        self.btnGenerate = document.getElementById('btn-studio-generate');
        self.btnInterrupt = document.getElementById('btn-studio-interrupt');
        self.btnRandomSeed = document.getElementById('btn-random-seed');
        self.btnLockSeed = document.getElementById('btn-lock-seed');
        self.btnRefreshModels = document.getElementById('btn-refresh-models');
        
        self.taPrompt = document.getElementById('studio-prompt-input');
        self.taSubject = document.getElementById('studio-subject-input');
        self.taNegativePrompt = document.getElementById('studio-negative-input');
        self.taManualArtists = document.getElementById('studio-artist-manual-input');
        
        self.engineSelect = document.getElementById('studio-backend-select');
        self.modelSelect = document.getElementById('studio-model-select');
        self.samplerSelect = document.getElementById('param-sampler');
        
        self.inputWidth = document.getElementById('param-custom-w');
        self.inputHeight = document.getElementById('param-custom-h');
        
        self.rangeSteps = document.getElementById('param-steps');
        self.valStepsNum = document.getElementById('param-steps-num');
        self.rangeScale = document.getElementById('param-scale');
        self.valScaleNum = document.getElementById('param-scale-num');
        self.inputSeed = document.getElementById('param-seed');
        
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

        self.btnLexiconExport = document.getElementById('btn-lexicon-export');
        self.btnLexiconImportTrigger = document.getElementById('btn-lexicon-import-trigger');
        self.fileLexiconImport = document.getElementById('file-lexicon-import');

        self.artistLabContainer = document.getElementById('studio-artist-lab-container');
        self.btnAutoWeight = document.getElementById('btn-auto-weight');
        self.btnSaveRecipe = document.getElementById('btn-save-recipe');
        self.artistChipsWrap = document.getElementById('artist-chips-wrap');
        self.artistTensionSlider = document.getElementById('artist-tension-slider');
        self.tensionValueDisplay = document.getElementById('tension-value-display');
        self.btnRandomArtistWeight = document.getElementById('btn-random-artist-weight');

        self.draftTabsList = document.getElementById('studio-draft-tabs-list');
        self.btnAddDraft = document.getElementById('btn-add-draft');

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

        self.errorModal = document.getElementById('error-custom-modal');
        self.errorModalTitle = document.getElementById('error-modal-title');
        self.errorModalMessage = document.getElementById('error-modal-message');
        self.btnCloseErrorModal = document.getElementById('btn-close-error-modal');
        self.btnCopyErrorLog = document.getElementById('btn-copy-error-log');

        self.lastSuccessfulSeed = -1;
        self.selectedImageIds = [];
        self.activeLightboxItem = null;

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

        self.initEventListeners();
        self.renderDraftsList();
        self.loadActiveDraftToUI();
        self.refreshGallery();
        self.bindRatioPresets();
        self.initCustomErrorModal();

        self.initQueueMonitorDOM();

        generatorQueue.addEventListener((state) => {
            self.updateGeneratorStatusUI(state.queue, state.active);
            self.renderQueueMonitor(state);
        });

        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (activeDraft) {
            await self.fetchModelsFromServer(activeDraft.targetBackend);
        }
    },

    initEventListeners() {
        const self = this;

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

        self.btnRefreshModels.addEventListener('click', async () => {
            const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
            if (activeDraft) {
                await self.fetchModelsFromServer(activeDraft.targetBackend, true);
            }
        });

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
            const cards = self.galleryGrid.querySelectorAll('.gallery-item-card');
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

        // 绑定打开沉浸式编辑器事件
        if (self.btnOpenComposer) {
            self.btnOpenComposer.addEventListener('click', () => {
                self.openComposerModal();
            });
        }

        // 绑定关闭编辑器（各种放弃和取消操作）
        const closeComposerFn = () => {
            if (self.composerModal) self.composerModal.classList.remove('active');
        };
        
        if (self.btnCloseComposer) self.btnCloseComposer.addEventListener('click', closeComposerFn);
        if (self.composerBtnCancel) self.composerBtnCancel.addEventListener('click', closeComposerFn);
        
        // 确认应用逻辑
        if (self.composerBtnApply) {
            self.composerBtnApply.addEventListener('click', () => {
                self.applyComposerData();
                closeComposerFn();
            });
        }
        
        // 保存并生图逻辑
        if (self.composerBtnGenerate) {
            self.composerBtnGenerate.addEventListener('click', () => {
                self.applyComposerData();
                closeComposerFn();
                self.triggerGenerateAction();
            });
        }

        // 弹窗内的实时输入监控，用于统计字数和估算 Token
        const updateStatsFn = () => {
            const sText = self.composerSubject.value || '';
            const pText = self.composerPrompt.value || '';
            const nText = self.composerNegative.value || '';
            
            const totalChars = sText.length + pText.length + nText.length;
            self.composerCharCount.textContent = totalChars;
            
            // 极简 Token 估算：按空格/逗号分割并以 1.2 放大系数拟合
            const cleanText = `${sText} ${pText}`.trim();
            const words = cleanText.split(/[\s,，.。;；]+/).filter(Boolean);
            const estTokens = Math.ceil(words.length * 1.25);
            self.composerTokenCount.textContent = estTokens;
        };

        if (self.composerSubject) self.composerSubject.addEventListener('input', updateStatsFn);
        if (self.composerPrompt) self.composerPrompt.addEventListener('input', updateStatsFn);
        if (self.composerNegative) self.composerNegative.addEventListener('input', updateStatsFn);

        // 键盘监听（Esc 关闭，Ctrl + Enter 发起生成）
        document.addEventListener('keydown', (e) => {
            if (self.composerModal && self.composerModal.classList.contains('active')) {
                if (e.key === 'Escape') {
                    closeComposerFn();
                }
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    self.applyComposerData();
                    closeComposerFn();
                    self.triggerGenerateAction();
                }
            }
        });

        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                if (!self.btnGenerate.disabled) {
                    e.preventDefault();
                    self.triggerGenerateAction();
                }
            }
        });

        document.querySelectorAll('input[name="artist-inject-pos"]').forEach(radio => {
            radio.addEventListener('change', () => {
                self.saveUIToActiveDraft();
            });
        });

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

        if (self.btnRandomArtistWeight) {
            self.btnRandomArtistWeight.addEventListener('click', () => {
                self.applyRandomWeights();
            });
        }

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

    bindRatioPresets() {
        const self = this;
        const buttons = document.querySelectorAll('#ratio-preset-group button');
        const customDiv = document.getElementById('custom-dimension-inputs');
        
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const w = btn.dataset.w;
                const h = btn.dataset.h;
                
                if (w === 'custom') {
                    customDiv.style.display = 'grid';
                } else {
                    customDiv.style.display = 'none';
                    self.inputWidth.value = w;
                    self.inputHeight.value = h;
                    self.saveUIToActiveDraft();
                }
            });
        });
    },

    toggleParametersVisibility(backend) {
        const self = this;
        if (!self.naiParamsPanel) return;

        if (backend === 'novelai') {
            self.naiParamsPanel.style.display = 'block';
            if (self.advancedControls) self.advancedControls.style.display = 'block';
        } else {
            self.naiParamsPanel.style.display = 'none';
            if (self.advancedControls) self.advancedControls.style.display = 'block'; 
        }
    },

    syncParameters() {
        const self = this;
        if (self.valStepsNum && self.rangeSteps) self.valStepsNum.textContent = self.rangeSteps.value;
        if (self.valScaleNum && self.rangeScale) self.valScaleNum.textContent = parseFloat(self.rangeScale.value).toFixed(1);
        if (self.vibeStrengthNum && self.vibeStrength) self.vibeStrengthNum.textContent = parseFloat(self.vibeStrength.value).toFixed(1);
    },

    loadActiveDraftToUI() {
        const self = this;
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (!activeDraft) return;

        self.taPrompt.value = activeDraft.prompt || '';
        self.taSubject.value = activeDraft.subject || '';
        self.taNegativePrompt.value = activeDraft.negativePrompt || '';
        
        self.engineSelect.value = activeDraft.targetBackend || 'novelai';
        self.toggleParametersVisibility(activeDraft.targetBackend);

        if (activeDraft.params) {
            self.inputWidth.value = activeDraft.params.width || 832;
            self.inputHeight.value = activeDraft.params.height || 1216;
            self.rangeSteps.value = activeDraft.params.steps || 28;
            self.rangeScale.value = activeDraft.params.scale || 5.0;
            self.samplerSelect.value = activeDraft.params.sampler || 'k_euler_ancestral';
            self.inputSeed.value = activeDraft.params.seed !== undefined ? activeDraft.params.seed : -1;
            
            if (self.cbSmea) self.cbSmea.checked = activeDraft.params.smea || false;
            if (self.cbSmeaDyn) self.cbSmeaDyn.checked = activeDraft.params.smeaDyn || false;
            if (self.vibeStrength) self.vibeStrength.value = activeDraft.params.vibeStrength || 0.6;
            
            self.taManualArtists.value = activeDraft.params.manualArtists || '';
        }

        // 还原长宽比按钮状态
        const buttons = document.querySelectorAll('#ratio-preset-group button');
        const customDiv = document.getElementById('custom-dimension-inputs');
        let matched = false;
        buttons.forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.w === String(self.inputWidth.value) && btn.dataset.h === String(self.inputHeight.value)) {
                btn.classList.add('active');
                matched = true;
            }
        });
        if (!matched && buttons.length > 0) {
            const lastBtn = buttons[buttons.length - 1]; // "自定义" 按钮
            lastBtn.classList.add('active');
            if (customDiv) customDiv.style.display = 'grid';
        } else {
            if (customDiv) customDiv.style.display = 'none';
        }

        // 还原 Vibe 图像预览
        if (activeDraft.params && activeDraft.params.vibeBase64) {
            self.vibePreview.style.display = 'block';
            self.vibePreviewImg.src = activeDraft.params.vibeBase64;
            self.vibeIntensityWrap.style.display = 'flex';
        } else {
            self.vibePreview.style.display = 'none';
            self.vibePreviewImg.src = '';
            self.vibeIntensityWrap.style.display = 'none';
        }

        self.syncParameters();
        self.renderArtistChips();
    },

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

    // 打开沉浸式编辑器弹窗，并载入当前 UI 数据
    openComposerModal() {
        const self = this;
        if (!self.composerModal) return;
        
        // 读取当前工作台面板的提示词
        self.composerSubject.value = self.taSubject ? self.taSubject.value : '';
        self.composerPrompt.value = self.taPrompt ? self.taPrompt.value : '';
        self.composerNegative.value = self.taNegativePrompt ? self.taNegativePrompt.value : '';
        
        // 触发一次统计更新
        self.composerSubject.dispatchEvent(new Event('input'));
        
        // 激活弹窗显现
        self.composerModal.classList.add('active');
        
        // 聚焦于主旨输入框
        setTimeout(() => {
            self.composerSubject.focus();
        }, 100);
    },

    // 将弹窗中的数据写回当前工作台，并存入 LocalStorage 草稿
    applyComposerData() {
        const self = this;
        
        if (self.taSubject) self.taSubject.value = self.composerSubject.value;
        if (self.taPrompt) self.taPrompt.value = self.composerPrompt.value;
        if (self.taNegativePrompt) self.taNegativePrompt.value = self.composerNegative.value;
        
        // 触发高度自适应（若使用了 textarea 自动高度）
        if (self.taSubject) self.taSubject.dispatchEvent(new Event('input'));
        if (self.taPrompt) self.taPrompt.dispatchEvent(new Event('input'));
        
        // 立即存入草稿箱，刷新缓冲区
        self.saveUIToActiveDraft();
        self.showNotification('编辑器内容已成功同步至工作台');
    },

    saveDraftsToStorage() {
        const self = this;
        localStorage.setItem('studio_workbench_drafts', JSON.stringify(self.drafts));
        localStorage.setItem('studio_workbench_active_draft_id', self.activeDraftId);
    },

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

    // 自动挂载悬浮监控胶囊与侧边抽屉骨架 (完美适配美化 CSS)
    initQueueMonitorDOM() {
        const self = this;
        
        // 1. 创建队列监控胶囊 (Capsule)
        let capsule = document.querySelector('.queue-monitor-capsule');
        if (!capsule) {
            capsule = document.createElement('div');
            capsule.className = 'queue-monitor-capsule';
            capsule.innerHTML = `
                <span class="queue-status-glow"></span>
                <svg class="queue-sandglass-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M5 2h14v2c0 2-1 3-3 5l-4 4 4 4c2 2 3 3 3 5v2H5v-2c0-2 1-3 3-5l4-4-4-4c-2-2-3-3-3-5V2z"></path>
                </svg>
                <span>QUEUE</span>
                <span id="queue-capsule-count">0</span>
            `;
            document.body.appendChild(capsule);
            
            // 点击胶囊唤起侧边栏抽屉
            capsule.addEventListener('click', () => {
                const drawer = document.querySelector('.queue-monitor-drawer');
                if (drawer) drawer.classList.toggle('active');
            });
        }
        self.queueCapsule = capsule;

        // 2. 创建侧边抽屉 (Drawer)
        let drawer = document.querySelector('.queue-monitor-drawer');
        if (!drawer) {
            drawer = document.createElement('div');
            drawer.className = 'queue-monitor-drawer';
            drawer.innerHTML = `
                <div class="queue-drawer-header">
                    <h3>QUEUE MONITOR</h3>
                    <button class="btn-cancel-task" id="btn-close-queue-drawer" style="font-size: 1.25rem;">&times;</button>
                </div>
                <div class="queue-drawer-list" id="queue-monitor-body">
                    <div class="queue-empty-text">当前无正在执行的任务</div>
                </div>
                <div class="queue-footer" style="padding: 1.5rem; border-top: 1px solid var(--glass-border); display: flex; gap: 0.5rem;">
                    <button class="batch-buttons-group btn-danger" id="btn-queue-cancel-all" style="flex-grow: 1; padding: 0.5rem; border-radius: 4px; font-size: 0.75rem; cursor: pointer; text-align: center; border: none;">TERMINATE ALL</button>
                    <button class="filter-tab-item active" id="btn-queue-clear-history" style="flex-grow: 1; padding: 0.5rem; border-radius: 4px; font-size: 0.75rem; cursor: pointer; border: 1px solid var(--glass-border);">CLEAR HISTORY</button>
                </div>
            `;
            document.body.appendChild(drawer);

            // 关闭抽屉事件
            drawer.querySelector('#btn-close-queue-drawer').addEventListener('click', () => {
                drawer.classList.remove('active');
            });

            drawer.querySelector('#btn-queue-cancel-all').addEventListener('click', (e) => {
                e.stopPropagation();
                generatorQueue.cancelAll();
                self.showNotification('已强行终止所有排队与生成任务');
            });

            drawer.querySelector('#btn-queue-clear-history').addEventListener('click', (e) => {
                e.stopPropagation();
                generatorQueue.clearHistory();
            });
        }
        self.queueDrawer = drawer;
    },

    // 渲染悬浮队列监视器与抽屉内容
    renderQueueMonitor(state) {
        const self = this;
        if (!self.queueCapsule || !self.queueDrawer) return;

        const totalActive = (state.active || []).length + (state.queue || []).length;
        const countCapsuleBadge = document.getElementById('queue-capsule-count');
        const glowDot = self.queueCapsule.querySelector('.queue-status-glow');
        
        if (countCapsuleBadge) countCapsuleBadge.textContent = totalActive;
        
        // 呼吸灯闪烁控制与自动展开
        if (totalActive > 0) {
            if (glowDot) glowDot.style.animation = 'breathingGlow 1.5s infinite ease-in-out';
            self.queueDrawer.classList.add('active'); // 有新任务自动唤起侧边抽屉
        } else {
            if (glowDot) glowDot.style.animation = 'none';
        }

        const container = document.getElementById('queue-monitor-body');
        if (container) {
            container.innerHTML = '';
            
            const allHistory = [
                ...(state.active || []).map(t => ({ ...t, status: 'generating' })),
                ...(state.queue || []).map((t, idx) => ({ ...t, status: 'waiting', index: idx + 1 })),
                ...(state.completed || []),
                ...(state.failed || [])
            ];

            if (allHistory.length === 0) {
                container.innerHTML = '<div class="queue-empty-text">当前无正在执行的任务</div>';
                return;
            }

            allHistory.forEach(item => {
                const card = document.createElement('div');
                card.className = 'queue-task-item';
                
                let statusLabel = (item.status || '').toUpperCase();
                let statusClass = item.status;
                let excerpt = item.prompt || '正在载入参数...';

                // 生成状态与进度控制逻辑
                let progressHtml = '';
                if (item.status === 'generating') {
                    progressHtml = `
                        <div class="task-progress-track">
                            <div class="task-progress-bar" style="width: 60%; background: #4dadf7; animation: pulse-status 1.2s infinite ease-in-out; height: 100%;"></div>
                        </div>
                    `;
                }

                card.innerHTML = `
                    <div class="queue-task-meta">
                        <span class="task-backend-badge">${(item.backend || 'API').toUpperCase()}</span>
                        <span class="task-status-text ${statusClass}">${statusLabel} ${item.index ? '#' + item.index : ''}</span>
                    </div>
                    <div class="task-prompt-excerpt">${excerpt}</div>
                    ${progressHtml}
                    ${(item.status === 'generating' || item.status === 'waiting') ? `<button class="btn-cancel-task" data-id="${item.id}">CANCEL</button>` : ''}
                `;

                // 绑定单个取消事件
                const cancelBtn = card.querySelector('.btn-cancel-task');
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        generatorQueue.cancel(item.id);
                    });
                }

                // 点击已完成的卡片大图预览
                if (item.status === 'completed' && item.record) {
                    card.style.cursor = 'pointer';
                    card.addEventListener('click', () => {
                        self.openLightbox(item.record);
                    });
                } else if (item.status === 'failed') {
                    card.style.cursor = 'pointer';
                    card.addEventListener('click', () => {
                        self.showSystemError('生图任务失败', item.error || '请求异常');
                    });
                }

                container.appendChild(card);
            });
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
    // 6. 画廊局部刷新与交互 (Gallery Core UI - 完全对齐美化 CSS)
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
            card.className = `gallery-item-card ${self.selectedImageIds.includes(item.id) ? 'selected' : ''}`;
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
            } else if (item.imageSrc) {
                // 如果是base64
                img.src = item.imageSrc;
            }

            imgWrapper.appendChild(img);

            const overlay = document.createElement('div');
            overlay.className = 'gallery-hover-overlay';

            const infoPrompt = document.createElement('p');
            infoPrompt.className = 'gallery-prompt-snippet';
            infoPrompt.textContent = item.prompt;
            infoPrompt.title = item.prompt;

            const infoMeta = document.createElement('div');
            infoMeta.className = 'gallery-meta-snippet';
            
            const seedVal = (item.params && item.params.seed !== undefined) ? item.params.seed : (item.seed !== undefined ? item.seed : -1);
            const wVal = (item.params && item.params.width) ? item.params.width : (item.width || 512);
            const hVal = (item.params && item.params.height) ? item.params.height : (item.height || 512);
            
            infoMeta.innerHTML = `
                <span>${item.backend.toUpperCase()}</span>
                <span>${wVal}x${hVal}</span>
                <span>SEED: ${seedVal}</span>
            `;

            const actionContainer = document.createElement('div');
            actionContainer.className = 'gallery-card-actions';

            const btnSend = document.createElement('button');
            btnSend.className = 'gallery-card-btn';
            btnSend.title = '回填参数至工作台';
            btnSend.innerHTML = `
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                </svg>
                <span>填入</span>
            `;
            btnSend.onclick = (e) => {
                e.stopPropagation();
                self.sendBackToWorkbench(item);
            };

            const btnDetail = document.createElement('button');
            btnDetail.className = 'gallery-card-btn';
            btnDetail.title = '查看完整大图参数';
            btnDetail.innerHTML = `
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    <line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line>
                </svg>
                <span>参数</span>
            `;
            btnDetail.onclick = (e) => {
                e.stopPropagation();
                self.openLightbox(item);
            };

            actionContainer.appendChild(btnSend);
            actionContainer.appendChild(btnDetail);

            overlay.appendChild(infoPrompt);
            overlay.appendChild(infoMeta);
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

    openLightbox(item) {
        const self = this;
        self.activeLightboxItem = item;

        if (item.imageBlob) {
            const objectUrl = URL.createObjectURL(item.imageBlob);
            self.lightboxImg.src = objectUrl;
            self.lightboxImg.onload = () => {
                URL.revokeObjectURL(objectUrl);
            };
        } else if (item.imageSrc) {
            self.lightboxImg.src = item.imageSrc;
        }

        const dateStr = new Date(item.timestamp).toLocaleString();
        self.lightboxTimestamp.textContent = `生成时间: ${dateStr}`;
        
        const seedVal = (item.params && item.params.seed !== undefined) ? item.params.seed : (item.seed !== undefined ? item.seed : -1);
        const modelVal = (item.params && item.params.model) ? item.params.model : (item.model || 'Standard');
        const wVal = (item.params && item.params.width) ? item.params.width : (item.width || 512);
        const hVal = (item.params && item.params.height) ? item.params.height : (item.height || 512);
        const stepsVal = (item.params && item.params.steps) ? item.params.steps : (item.steps || '--');
        const scaleVal = (item.params && item.params.scale) ? item.params.scale : (item.scale || '--');
        const samplerVal = (item.params && item.params.sampler) ? item.params.sampler : (item.sampler || '--');

        self.lightboxEngine.textContent = `${item.backend.toUpperCase()} - ${modelVal}`;
        self.lightboxPrompt.textContent = item.prompt;
        
        if (item.negativePrompt) {
            document.getElementById('lightbox-meta-uc-section').style.display = 'block';
            self.lightboxNegative.textContent = item.negativePrompt;
        } else {
            document.getElementById('lightbox-meta-uc-section').style.display = 'none';
        }

        self.lightboxSeed.textContent = seedVal;
        self.lightboxDimension.textContent = `${wVal} x ${hVal}`;
        self.lightboxSteps.textContent = stepsVal;
        self.lightboxScale.textContent = scaleVal;
        self.lightboxSampler.textContent = samplerVal;

        document.getElementById('btn-copy-meta-prompt').onclick = () => {
            navigator.clipboard.writeText(item.prompt).then(() => {
                self.showNotification('提示词已复制到剪贴板');
            });
        };

        self.lightbox.classList.add('open');
    },

    async sendBackToWorkbench(item) {
        const self = this;
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (!activeDraft) return;

        const seedVal = (item.params && item.params.seed !== undefined) ? item.params.seed : (item.seed !== undefined ? item.seed : -1);
        const modelVal = (item.params && item.params.model) ? item.params.model : (item.model || '');
        const wVal = (item.params && item.params.width) ? item.params.width : (item.width || 832);
        const hVal = (item.params && item.params.height) ? item.params.height : (item.height || 1216);
        const stepsVal = (item.params && item.params.steps) ? item.params.steps : (item.steps || 28);
        const scaleVal = (item.params && item.params.scale) ? item.params.scale : (item.scale || 5.0);
        const samplerVal = (item.params && item.params.sampler) ? item.params.sampler : (item.sampler || 'k_euler');

        activeDraft.prompt = item.prompt;
        activeDraft.negativePrompt = item.negativePrompt || '';
        activeDraft.targetBackend = item.backend;
        
        activeDraft.params.width = wVal;
        activeDraft.params.height = hVal;
        activeDraft.params.steps = stepsVal;
        activeDraft.params.scale = scaleVal;
        activeDraft.params.sampler = samplerVal;
        activeDraft.params.seed = seedVal;
        activeDraft.params.model = modelVal;

        if (item.backend === 'novelai' && item.params) {
            activeDraft.params.smea = !!item.params.smea;
            activeDraft.params.smeaDyn = !!item.params.smeaDyn;
        }

        self.saveDraftsToStorage();
        self.loadActiveDraftToUI();
        await self.fetchModelsFromServer(item.backend);

        self.showNotification('作品的全部生成参数已复用回工作台');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    createFollowUpTask(item) {
        const self = this;
        const globalData = JSON.parse(localStorage.getItem('studio_workbench_data') || '{}');
        if (!globalData.todos) globalData.todos = [];

        const seedVal = (item.params && item.params.seed !== undefined) ? item.params.seed : (item.seed !== undefined ? item.seed : -1);
        const taskText = `优化图像细节 (Engine: ${item.backend.toUpperCase()} | Seed: ${seedVal})`;
        
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

    triggerRollVariations(item) {
        const self = this;
        self.showNotification('开始以该参数并行生成4张不同 Seed 变体...');
        
        const baseParams = item.params || {
            width: item.width || 832,
            height: item.height || 1216,
            steps: item.steps || 28,
            scale: item.scale || 5.0,
            sampler: item.sampler || 'k_euler',
            model: item.model || ''
        };

        for (let i = 0; i < 4; i++) {
            const task = {
                backend: item.backend,
                prompt: item.prompt,
                params: {
                    ...baseParams,
                    seed: Math.floor(Math.random() * 9999999999)
                }
            };
            generatorQueue.enqueue(task);
        }
    },

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
        const seedVal = (item.params && item.params.seed !== undefined) ? item.params.seed : (item.seed !== undefined ? item.seed : -1);

        if (finalBlob) {
            if (cleanExif) {
                finalBlob = await self.cleanMetadata(item.imageBlob);
            }
            const url = URL.createObjectURL(finalBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${item.backend}_${seedVal}_${cleanExif ? 'clean_' : ''}${item.id}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } else if (item.imageSrc) {
            // base64 下载兼容
            const link = document.createElement('a');
            link.href = item.imageSrc;
            link.download = `${item.backend}_${seedVal}_${cleanExif ? 'clean_' : ''}${item.id}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    },

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
            const seedVal = (item.params && item.params.seed !== undefined) ? item.params.seed : (item.seed !== undefined ? item.seed : 'seed');
            const filename = `${item.backend}_${seedVal}_${cleanExif ? 'clean_' : ''}${item.id}.png`;

            if (item.imageBlob) {
                let blob = item.imageBlob;
                if (cleanExif) {
                    blob = await self.cleanMetadata(item.imageBlob);
                }
                zip.file(filename, blob);
            } else if (item.imageSrc) {
                // 如果是base64数据，去除前缀后写入
                let rawBase64 = item.imageSrc;
                if (rawBase64.includes(';base64,')) {
                    rawBase64 = rawBase64.split(';base64,')[1];
                }
                zip.file(filename, rawBase64, { base64: true });
            }
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
    },

    // 智能图像处理 (Vibe base64 读取)
    handleVibeImageUpload(file) {
        const self = this;
        if (!file.type.startsWith('image/')) {
            self.showNotification('只允许上传图片作为 Vibe 参考图');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target.result;
            
            // 写入当前草稿
            const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
            if (activeDraft) {
                if (!activeDraft.params) activeDraft.params = {};
                activeDraft.params.vibeBase64 = base64;
                self.saveDraftsToStorage();

                // UI 更新
                self.vibePreview.style.display = 'block';
                self.vibePreviewImg.src = base64;
                self.vibeIntensityWrap.style.display = 'flex';
                self.showNotification('已成功加载 Vibe 图片');
            }
        };
        reader.readAsDataURL(file);
    },

    // 编译 NovelAI 的 ZIP 响应包转成 base64
    async unzipNovelAIResponse(buffer) {
        const view = new Uint8Array(buffer);
        let pngOffset = -1;
        for (let i = 0; i < view.length - 3; i++) {
            if (view[i] === 0x89 && view[i+1] === 0x50 && view[i+2] === 0x4e && view[i+3] === 0x47) {
                pngOffset = i;
                break;
            }
        }
        if (pngOffset === -1) {
            throw new Error('生图返回的二进制包中未能匹配到标准的 PNG 图像文件头');
        }

        const pngBytes = view.subarray(pngOffset);
        let binary = '';
        const len = pngBytes.byteLength;
        const chunkSize = 65536;
        for (let i = 0; i < len; i += chunkSize) {
            const slice = pngBytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, slice);
        }
        return 'data:image/png;base64,' + btoa(binary);
    },

    // 智能化 ComfyUI 占位符检测替换
    replaceComfyUIPlaceholders(workflow, vars) {
        const str = JSON.stringify(workflow);
        let replacedStr = str
            .replace(/\${prompt}/g, () => JSON.stringify(vars.prompt).slice(1, -1))
            .replace(/\${negative}/g, () => JSON.stringify(vars.negative).slice(1, -1))
            .replace(/\${seed}/g, () => String(vars.seed))
            .replace(/\${width}/g, () => String(vars.width))
            .replace(/\${height}/g, () => String(vars.height))
            .replace(/\${steps}/g, () => String(vars.steps))
            .replace(/\${cfg}/g, () => String(vars.cfg))
            .replace(/\${sampler}/g, () => JSON.stringify(vars.sampler).slice(1, -1))
            .replace(/\${model}/g, () => JSON.stringify(vars.model || '').slice(1, -1));
        
        return JSON.parse(replacedStr);
    },

    // ComfyUI 结果轮询
    async pollComfyUIStatus(baseUrl, promptId, clientUUID, abortController) {
        const self = this;
        const historyUrl = baseUrl.replace(/\/$/, '') + '/history/' + promptId;

        const maxAttempts = 120; // 最多等 2 分钟
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (abortController.signal.aborted) {
                throw new Error('AbortError');
            }

            await new Promise(r => setTimeout(r, 1000));

            try {
                const res = await self.callAPI(historyUrl, { method: 'GET' }, 'comfyui');
                if (res.ok) {
                    const data = await res.json();
                    if (data[promptId]) {
                        const historyInfo = data[promptId];
                        const outputs = historyInfo.outputs;
                        let filename = '';
                        let subfolder = '';
                        let type = 'output';

                        for (const nodeId in outputs) {
                            if (outputs[nodeId].images && outputs[nodeId].images.length > 0) {
                                filename = outputs[nodeId].images[0].filename;
                                subfolder = outputs[nodeId].images[0].subfolder || '';
                                type = outputs[nodeId].images[0].type || 'output';
                                break;
                            }
                        }

                        if (!filename) throw new Error('任务历史显示已完成，但无法定位任何输出图像文件。');

                        const viewUrl = `${baseUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}`;
                        const imgRes = await self.callAPI(viewUrl, { method: 'GET' }, 'comfyui');
                        if (!imgRes.ok) throw new Error('拉取 ComfyUI 输出图片失败');
                        
                        const blob = await imgRes.blob();
                        return new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                    }
                }
            } catch (err) {
                console.warn("轮询 ComfyUI 发生瞬态错误:", err);
            }
        }
        throw new Error('ComfyUI 任务执行超时');
    },

    // 执行后台生图任务的细分逻辑
    async executeGenerationTask(taskItem, abortController) {
        const self = this;
        const globalSettingsStr = localStorage.getItem('studio_settings');
        let parsed = {};
        if (globalSettingsStr) {
            try { parsed = JSON.parse(globalSettingsStr); } catch(e){}
        }

        const seedVal = parseInt(taskItem.params.seed) === -1 
            ? Math.floor(Math.random() * 9999999999) 
            : parseInt(taskItem.params.seed);

        const backend = taskItem.backend;

        if (backend === 'novelai') {
            const endpoint = (parsed.novelaiUrl || 'https://api.novelai.net').replace(/\/$/, '') + '/ai/generate-image';
            
            const payload = {
                input: taskItem.prompt,
                model: taskItem.params.model || 'nai-diffusion-3',
                action: 'generate',
                parameters: {
                    width: taskItem.params.width || 832,
                    height: taskItem.params.height || 1216,
                    scale: parseFloat(taskItem.params.scale) || 5.0,
                    sampler: taskItem.params.sampler || 'k_euler_ancestral',
                    steps: parseInt(taskItem.params.steps) || 28,
                    seed: seedVal,
                    n_samples: 1,
                    ucPreset: 0,
                    qualityToggle: true,
                    sm: !!taskItem.params.smea,
                    smDyn: !!taskItem.params.smeaDyn,
                    dynamic_thresholding: false,
                    controlnet_strength: 1,
                    legacy_v2_enjoy_except_recreative: false,
                    add_original_image: true,
                    uncond_scale: 1,
                    cfg_rescale: 0,
                    negative_prompt: taskItem.params.negativePrompt || ''
                }
            };

            if (taskItem.params.vibeBase64) {
                let pureBase64 = taskItem.params.vibeBase64;
                if (pureBase64.includes(';base64,')) {
                    pureBase64 = pureBase64.split(';base64,')[1];
                }
                const strength = parseFloat(taskItem.params.vibeStrength) || 0.6;
                payload.parameters.reference_image_multiple = [pureBase64];
                payload.parameters.reference_information_extracted_multiple = [strength];
                payload.parameters.reference_strength_multiple = [1.0];
            }

            const res = await self.callAPI(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                signal: abortController.signal
            }, 'novelai');

            if (!res.ok) {
                let errMsg = `HTTP ${res.status}`;
                try {
                    const errData = await res.json();
                    errMsg += ` - ${errData.message || JSON.stringify(errData)}`;
                } catch(e){}
                throw new Error(errMsg);
            }

            const buffer = await res.arrayBuffer();
            const base64Data = await self.unzipNovelAIResponse(buffer);

            // 将 base64 转回 Blob 安全存储到 IndexedDB
            const responseBlob = await fetch(base64Data).then(r => r.blob());
            const thumbBase64 = await self.createThumbnail(responseBlob);

            const galleryItem = {
                id: 'gallery_' + Date.now() + Math.random().toString(36).substr(2, 3),
                timestamp: Date.now(),
                backend: 'novelai',
                prompt: taskItem.prompt,
                negativePrompt: taskItem.params.negativePrompt || '',
                imageBlob: responseBlob,
                thumb: thumbBase64,
                params: {
                    width: taskItem.params.width,
                    height: taskItem.params.height,
                    steps: taskItem.params.steps,
                    scale: taskItem.params.scale,
                    sampler: taskItem.params.sampler,
                    seed: seedVal,
                    model: taskItem.params.model,
                    smea: taskItem.params.smea,
                    smeaDyn: taskItem.params.smeaDyn
                }
            };

            await GalleryDB.save(galleryItem);
            self.lastSuccessfulSeed = seedVal;
            return galleryItem;

        } else if (backend === 'sd_webui') {
            const baseUrl = parsed.sdWebuiUrl || 'http://127.0.0.1:7860';
            const endpoint = baseUrl.replace(/\/$/, '') + '/sdapi/v1/txt2img';

            const payload = {
                prompt: taskItem.prompt,
                negative_prompt: taskItem.params.negativePrompt || '',
                seed: seedVal,
                sampler_name: taskItem.params.sampler || 'Euler a',
                batch_size: 1,
                steps: parseInt(taskItem.params.steps) || 28,
                cfg_scale: parseFloat(taskItem.params.scale) || 7.0,
                width: taskItem.params.width || 512,
                height: taskItem.params.height || 512,
                override_settings: {
                    sd_model_checkpoint: taskItem.params.model
                }
            };

            const res = await self.callAPI(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                signal: abortController.signal
            }, 'sd_webui');

            if (!res.ok) throw new Error(`SD WebUI HTTP 异常 ${res.status}`);
            const data = await res.json();
            if (!data.images || data.images.length === 0) throw new Error('未收到生成的图片数据');

            const base64Data = 'data:image/png;base64,' + data.images[0];
            const responseBlob = await fetch(base64Data).then(r => r.blob());
            const thumbBase64 = await self.createThumbnail(responseBlob);

            const galleryItem = {
                id: 'gallery_' + Date.now() + Math.random().toString(36).substr(2, 3),
                timestamp: Date.now(),
                backend: 'sd_webui',
                prompt: taskItem.prompt,
                negativePrompt: taskItem.params.negativePrompt || '',
                imageBlob: responseBlob,
                thumb: thumbBase64,
                params: {
                    width: taskItem.params.width,
                    height: taskItem.params.height,
                    steps: taskItem.params.steps,
                    scale: taskItem.params.scale,
                    sampler: taskItem.params.sampler,
                    seed: seedVal,
                    model: taskItem.params.model
                }
            };

            await GalleryDB.save(galleryItem);
            self.lastSuccessfulSeed = seedVal;
            return galleryItem;

        } else if (backend === 'comfyui') {
            const baseUrl = parsed.comfyuiUrl || 'http://127.0.0.1:8188';
            const clientUUID = 'studio-client-' + Math.random().toString(36).substring(2, 10);
            
            const workflowJsonStr = parsed.comfyuiWorkflow || '';
            if (!workflowJsonStr.trim()) {
                throw new Error('未在全局设置中找到配置的 ComfyUI 工作流 JSON 结构');
            }

            let workflowObj = {};
            try {
                workflowObj = JSON.parse(workflowJsonStr);
            } catch(e) {
                throw new Error('ComfyUI 工作流格式解析失败，请确保其为合法的 JSON。');
            }

            const processedPrompt = self.replaceComfyUIPlaceholders(workflowObj, {
                prompt: taskItem.prompt,
                negative: taskItem.params.negativePrompt || '',
                seed: seedVal,
                width: taskItem.params.width || 512,
                height: taskItem.params.height || 512,
                steps: parseInt(taskItem.params.steps) || 20,
                cfg: parseFloat(taskItem.params.scale) || 8.0,
                sampler: taskItem.params.sampler || 'euler',
                model: taskItem.params.model
            });

            const promptUrl = baseUrl.replace(/\/$/, '') + '/prompt';
            const submitRes = await self.callAPI(promptUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: processedPrompt, client_id: clientUUID }),
                signal: abortController.signal
            }, 'comfyui');

            if (!submitRes.ok) throw new Error(`ComfyUI 任务提交失败 HTTP ${submitRes.status}`);
            const submitData = await submitRes.json();
            const promptId = submitData.prompt_id;

            const base64Data = await self.pollComfyUIStatus(baseUrl, promptId, clientUUID, abortController);
            const responseBlob = await fetch(base64Data).then(r => r.blob());
            const thumbBase64 = await self.createThumbnail(responseBlob);

            const galleryItem = {
                id: 'gallery_' + Date.now() + Math.random().toString(36).substr(2, 3),
                timestamp: Date.now(),
                backend: 'comfyui',
                prompt: taskItem.prompt,
                negativePrompt: taskItem.params.negativePrompt || '',
                imageBlob: responseBlob,
                thumb: thumbBase64,
                params: {
                    width: taskItem.params.width,
                    height: taskItem.params.height,
                    steps: taskItem.params.steps,
                    scale: taskItem.params.scale,
                    sampler: taskItem.params.sampler,
                    seed: seedVal,
                    model: taskItem.params.model
                }
            };

            await GalleryDB.save(galleryItem);
            self.lastSuccessfulSeed = seedVal;
            return galleryItem;
        } else {
            throw new Error(`暂不支持的引擎后端: ${backend}`);
        }
    }
};

// DOMContentLoaded 自动装配
document.addEventListener('DOMContentLoaded', () => {
    window.StudioManager.init();
});
