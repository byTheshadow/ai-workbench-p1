function getCleanProxyUrl(targetUrl, userProxy) {
    if (!userProxy || !userProxy.trim()) {
        return targetUrl;
    }
    let proxy = userProxy.trim();
    if (proxy.includes('workers.dev') || proxy.includes('?url=') || proxy.includes('url=')) {
        if (!proxy.includes('url=')) {
            proxy = proxy.replace(/\/$/, '') + '/?url=';
        }
        if (!proxy.endsWith('=')) {
            proxy = proxy.endsWith('url') ? proxy + '=' : proxy + '&url=';
        }
        return proxy + encodeURIComponent(targetUrl);
    }
    return proxy.replace(/\/$/, '') + '/' + targetUrl;
}

document.addEventListener('DOMContentLoaded', () => {
    // 页面跳转逻辑 (SPA)
    const navItems = document.querySelectorAll('.nav-item');
    const panes = document.querySelectorAll('.pane');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(i => i.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));

            item.classList.add('active');
            const targetId = `pane-${item.getAttribute('data-target')}`;
            document.getElementById(targetId).classList.add('active');
        });
    });

    // AI 助手栏展开与折叠
    const aiToggleBtn = document.getElementById('ai-toggle-btn');
    const aiSidebar = document.getElementById('ai-sidebar');
    const aiCloseBtn = document.getElementById('ai-close-btn');

    if (aiToggleBtn && aiSidebar && aiCloseBtn) {
        aiToggleBtn.addEventListener('click', () => {
            aiSidebar.classList.add('open');
        });

        aiCloseBtn.addEventListener('click', () => {
            aiSidebar.classList.remove('open');
        });
    }

    // 主题切换管理
    const themeSelector = document.getElementById('theme-selector');
    const currentData = StorageManager.getData();
    const savedTheme = currentData.theme || 'light';
    
    document.documentElement.setAttribute('data-theme', savedTheme);
    themeSelector.value = savedTheme;

    themeSelector.addEventListener('change', (e) => {
        const selectedTheme = e.target.value;
        document.documentElement.setAttribute('data-theme', selectedTheme);
        StorageManager.updateKey('theme', selectedTheme);
    });

    // 填充 API 配置初始值
    const inputOpenaiUrl = document.getElementById('input-openai-url');
    const inputOpenaiKey = document.getElementById('input-openai-key');
    const inputImageV1Url = document.getElementById('input-image-v1-url');
    const inputImageV1Key = document.getElementById('input-image-v1-key');
    const inputNovelaiUrl = document.getElementById('input-novelai-url');
    const inputNovelaiKey = document.getElementById('input-novelai-key');
    const inputSdUrl = document.getElementById('input-sd-url');
    const inputSdKey = document.getElementById('input-sd-key');
    const inputCorsProxy = document.getElementById('input-cors-proxy');
    const btnSaveApiConfig = document.getElementById('btn-save-api-config');

    if (currentData.apiConfig) {
        if (inputOpenaiUrl) inputOpenaiUrl.value = currentData.apiConfig.openaiUrl || '';
        if (inputOpenaiKey) inputOpenaiKey.value = currentData.apiConfig.openaiKey || '';
        if (inputImageV1Url) inputImageV1Url.value = currentData.apiConfig.imageV1Url || '';
        if (inputImageV1Key) inputImageV1Key.value = currentData.apiConfig.imageV1Key || '';
        if (inputNovelaiUrl) inputNovelaiUrl.value = currentData.apiConfig.novelaiUrl || '';
        if (inputNovelaiKey) inputNovelaiKey.value = currentData.apiConfig.novelaiKey || '';
        if (inputSdUrl) inputSdUrl.value = currentData.apiConfig.sdUrl || '';
        if (inputSdKey) inputSdKey.value = currentData.apiConfig.sdKey || '';
        if (inputCorsProxy) inputCorsProxy.value = currentData.apiConfig.corsProxy || '';
    }

    // 抽取公共的保存 API 配置逻辑，供保存按钮和连接测试成功时复用
    async function saveApiConfig() {
        const data = StorageManager.getData();
        data.apiConfig = {
            openaiUrl: inputOpenaiUrl ? inputOpenaiUrl.value.trim() : '',
            openaiKey: inputOpenaiKey ? inputOpenaiKey.value.trim() : '',
            imageV1Url: inputImageV1Url ? inputImageV1Url.value.trim() : '',
            imageV1Key: inputImageV1Key ? inputImageV1Key.value.trim() : '',
            novelaiUrl: inputNovelaiUrl ? inputNovelaiUrl.value.trim() : '',
            novelaiKey: inputNovelaiKey ? inputNovelaiKey.value.trim() : '',
            sdUrl: inputSdUrl ? inputSdUrl.value.trim() : '',
            sdKey: inputSdKey ? inputSdKey.value.trim() : '',
            corsProxy: inputCorsProxy ? inputCorsProxy.value.trim() : ''
        };
        StorageManager.save(data);
        
        // 同步触发 AI 助手大模型列表拉取
        if (window.ChatManager && typeof window.ChatManager.fetchModels === 'function') {
            await window.ChatManager.fetchModels();
        }

        // 同步触发生图工作室模型下拉列表刷新
        if (window.StudioManager && typeof window.StudioManager.fetchModelsFromServer === 'function') {
            const backendSelect = document.getElementById('studio-backend-select');
            if (backendSelect) {
                const curBackend = backendSelect.value;
                await window.StudioManager.fetchModelsFromServer(curBackend);
            }
        }
    }

    // 绑定 API 保存按钮事件
    if (btnSaveApiConfig) {
        btnSaveApiConfig.addEventListener('click', async () => {
            await saveApiConfig();
            alert('配置已成功保存！');
        });
    }

    // --- API 测试功能模块 ---
    const btnTestOpenai = document.getElementById('btn-test-openai');
    const statusTestOpenai = document.getElementById('status-test-openai');

    const btnTestImageV1 = document.getElementById('btn-test-image-v1');
    const statusTestImageV1 = document.getElementById('status-test-image-v1');
    
    const btnTestNovelai = document.getElementById('btn-test-novelai');
    const statusTestNovelai = document.getElementById('status-test-novelai');

    const btnTestSd = document.getElementById('btn-test-sd');
    const statusTestSd = document.getElementById('status-test-sd');

    // 状态更新辅助器
    function setIndicatorStatus(indicator, type, text) {
        if (!indicator) return;
        indicator.textContent = text;
        indicator.className = 'api-status-indicator ' + type;
    }

    // 1. [聊天接口测试] 自动识别并拼接 CORS 代理
    if (btnTestOpenai) {
        btnTestOpenai.addEventListener('click', async () => {
            const url = inputOpenaiUrl.value.trim();
            const key = inputOpenaiKey.value.trim();
            const corsProxy = inputCorsProxy.value.trim(); // 获取跨域代理

            if (!url) {
                setIndicatorStatus(statusTestOpenai, 'error', '地址不能为空');
                return;
            }

            setIndicatorStatus(statusTestOpenai, 'testing', '连接聊天接口中...');
            const startTime = Date.now();

            try {
                let targetUrl = url.replace(/\/$/, '') + '/chat/completions';
                targetUrl = getCleanProxyUrl(targetUrl, corsProxy); // 👈 使用安全函数拼接

                const headers = { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                };
                const pingPayload = {
                    model: "gpt-3.5-turbo", 
                    messages: [{ role: "user", content: "p" }],
                    max_tokens: 1
                };

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);

                const response = await fetch(targetUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(pingPayload),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (response.ok) {
                    const elapsed = Date.now() - startTime;
                    setIndicatorStatus(statusTestOpenai, 'success', `成功 (${elapsed}ms)`);
                    // 测试成功时直接保存配置以提升体验
                    await saveApiConfig();
                } else {
                    const errText = await response.text();
                    console.error("聊天接口测试失败:", errText);
                    setIndicatorStatus(statusTestOpenai, 'error', `错误 (HTTP ${response.status})`);
                }
            } catch (err) {
                console.error("测试出错日志:", err);
                setIndicatorStatus(statusTestOpenai, 'error', err.name === 'AbortError' ? '超时' : '网络错误 (请检查代理)');
            }
        });
    }

    // 2. [生图接口测试] 自动识别并拼接 CORS 代理
    if (btnTestImageV1) {
        btnTestImageV1.addEventListener('click', async () => {
            const url = inputImageV1Url.value.trim();
            const key = inputImageV1Key.value.trim();
            const corsProxy = inputCorsProxy.value.trim(); // 获取用户输入的跨域代理

            if (!url) {
                setIndicatorStatus(statusTestImageV1, 'error', '地址不能为空');
                return;
            }

            setIndicatorStatus(statusTestImageV1, 'testing', '正在建立生图心跳...');
            const startTime = Date.now();

            try {
                let genUrl = url.replace(/\/$/, '') + '/images/generations';
                genUrl = getCleanProxyUrl(genUrl, corsProxy); // 👈 使用安全函数拼接

                const headers = { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                };
                const pingPayload = {
                    model: "dall-e-3",
                    prompt: "ping",
                    n: 1,
                    size: "256x256"
                };

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);

                const response = await fetch(genUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(pingPayload),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (response.ok) {
                    const elapsed = Date.now() - startTime;
                    setIndicatorStatus(statusTestImageV1, 'success', `成功 (${elapsed}ms)`);
                    // 测试成功时直接保存配置以提升体验
                    await saveApiConfig();
                } else {
                    const errText = await response.text();
                    if (errText.includes('balance') || errText.includes('quota') || response.status === 400) {
                        setIndicatorStatus(statusTestImageV1, 'success', '鉴权通过 (探针连通)');
                        await saveApiConfig();
                    } else {
                        console.error("生图接口测试失败:", errText);
                        setIndicatorStatus(statusTestImageV1, 'error', `失败 (HTTP ${response.status})`);
                    }
                }
            } catch (err) {
                console.error("生图测试出错日志:", err);
                
                // 智能捕获跨域或网络断开
                if (err.name === 'AbortError') {
                    setIndicatorStatus(statusTestImageV1, 'error', '连接超时 (8s)');
                } else if (!corsProxy) {
                    // 没有配置代理导致的报错
                    setIndicatorStatus(statusTestImageV1, 'error', '跨域拦截 (未配置代理)');
                    alert("【跨域拦截警告】\n检测到浏览器安全策略阻止了直连请求。\n请在设置面板最下方配置 CORS 跨域代理（如填入默认的 https://cors-anywhere.herokuapp.com/ ），然后保存后再试。");
                } else if (corsProxy.includes('cors-anywhere.herokuapp.com')) {
                    // 使用了默认代理但未进行 Demo 激活授权
                    setIndicatorStatus(statusTestImageV1, 'error', '代理未激活');
                    if (confirm("您使用的是公共 CORS-Anywhere 代理，需要先进行一次性临时授权激活。\n\n是否立即打开激活网页？\n(打开后点击页面中心的 \"Get temporary access\" 按钮即可激活)")) {
                        window.open("https://cors-anywhere.herokuapp.com/corsdemo", "_blank");
                    }
                } else {
                    setIndicatorStatus(statusTestImageV1, 'error', '网络异常/代理无法连接');
                }
            }
        });
    }


    // 3. 测试 NovelAI 接口
    if (btnTestNovelai) {
        btnTestNovelai.addEventListener('click', async () => {
            const url = inputNovelaiUrl.value.trim() || 'https://api.novelai.net';
            const key = inputNovelaiKey.value.trim();
            if (!key) {
                setIndicatorStatus(statusTestNovelai, 'error', '缺少 API Key');
                return;
            }

            setIndicatorStatus(statusTestNovelai, 'testing', '正在测试 NAI 认证...');
            const startTime = Date.now();

            try {
                // 访问 NovelAI 用户订阅信息端点检测 Key 是否有效
                const fullUrl = url.replace(/\/$/, '') + '/user/information';
                const headers = { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                };

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);

                const response = await fetch(fullUrl, { 
                    method: 'GET', 
                    headers, 
                    signal: controller.signal 
                });
                clearTimeout(timeoutId);

                if (response.ok) {
                    const elapsed = Date.now() - startTime;
                    setIndicatorStatus(statusTestNovelai, 'success', `连通且授权成功 (${elapsed}ms)`);
                    // 测试成功时直接保存配置以提升体验
                    await saveApiConfig();
                } else {
                    setIndicatorStatus(statusTestNovelai, 'error', `未授权 (HTTP ${response.status})`);
                }
            } catch (err) {
                setIndicatorStatus(statusTestNovelai, 'error', err.name === 'AbortError' ? '超时' : '请求失败/网络阻断');
            }
        });
    }

    // 4. 测试 Stable Diffusion / 第三方生图 API 接口
    if (btnTestSd) {
        btnTestSd.addEventListener('click', async () => {
            const url = inputSdUrl.value.trim();
            const key = inputSdKey ? inputSdKey.value.trim() : '';
            if (!url) {
                setIndicatorStatus(statusTestSd, 'error', '生图地址不能为空');
                return;
            }

            setIndicatorStatus(statusTestSd, 'testing', '正在连接生图服务端...');
            const startTime = Date.now();

            try {
                // 请求 SD 模型列表接口确认正常运作
                const fullUrl = url.replace(/\/$/, '') + '/sdapi/v1/sd-models';
                const headers = { 'Content-Type': 'application/json' };
                if (key) headers['Authorization'] = `Bearer ${key}`;

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);

                const response = await fetch(fullUrl, { 
                    method: 'GET', 
                    headers, 
                    signal: controller.signal 
                });
                clearTimeout(timeoutId);

                if (response.ok) {
                    const elapsed = Date.now() - startTime;
                    setIndicatorStatus(statusTestSd, 'success', `成功 (${elapsed}ms)`);
                    // 测试成功时直接保存配置以提升体验
                    await saveApiConfig();
                } else {
                    setIndicatorStatus(statusTestSd, 'error', `认证错误 (HTTP ${response.status})`);
                }
            } catch (err) {
                setIndicatorStatus(statusTestSd, 'error', err.name === 'AbortError' ? '连接超时' : '拒绝连接/CORS跨域问题');
            }
        });
    }

    // --- 自定义 AI 身份预设管理器逻辑 ---
    const presetListContainer = document.getElementById('preset-manager-list');
    const inputNewPresetName = document.getElementById('input-new-preset-name');
    const inputNewPresetPrompt = document.getElementById('input-new-preset-prompt');
    const btnAddCustomPreset = document.getElementById('btn-add-custom-preset');

    // 渲染设置面板中的预设列表
    function renderPresetManagerList() {
        if (!presetListContainer) return;
        const data = StorageManager.getData();
        const presets = data.aiPresets || [];

        presetListContainer.innerHTML = presets.map(p => {
            const typeLabel = p.isSystem ? '内置预设' : '自定义';
            const deleteBtn = p.isSystem 
                ? `<span style="font-size:0.7rem; color:var(--text-muted);">系统锁</span>` 
                : `<button class="btn-text-danger btn-mini btn-delete-preset" data-id="${p.id}">删除</button>`;
            
            return `
                <div class="preset-manager-item">
                    <div class="preset-info">
                        <span class="preset-info-name">${escapeHTML(p.name)}</span>
                        <span class="preset-info-type">${typeLabel}</span>
                    </div>
                    <div>
                        ${deleteBtn}
                    </div>
                </div>
            `;
        }).join('');

        // 绑定删除自定义预设事件
        presetListContainer.querySelectorAll('.btn-delete-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idToDelete = e.target.getAttribute('data-id');
                deleteCustomPreset(idToDelete);
            });
        });
    }

    // 新增预设
    if (btnAddCustomPreset) {
        btnAddCustomPreset.addEventListener('click', () => {
            const name = inputNewPresetName.value.trim();
            const prompt = inputNewPresetPrompt.value.trim();

            if (!name || !prompt) {
                alert('请填写完整的显示名称与指令设定。');
                return;
            }

            // 过滤 emoji 安全限制 (非聊天消息防报错)
            const cleanName = removeEmojis(name);
            const cleanPrompt = removeEmojis(prompt);

            const data = StorageManager.getData();
            const newPreset = {
                id: `preset_custom_${Date.now()}`,
                name: cleanName,
                systemPrompt: cleanPrompt,
                isSystem: false
            };

            data.aiPresets.push(newPreset);
            StorageManager.save(data);

            inputNewPresetName.value = '';
            inputNewPresetPrompt.value = '';

            renderPresetManagerList();
            
            // 同步通知 AI 侧边栏刷新预设下拉菜单
            if (window.ChatManager && typeof window.ChatManager.loadData === 'function') {
                window.ChatManager.loadData();
                window.ChatManager.renderPresets();
            }

            alert('自定义身份预设保存成功。');
        });
    }

    // 删除自定义预设
    function deleteCustomPreset(id) {
        const confirmDelete = confirm('确定要删除这个自定义预设吗？');
        if (!confirmDelete) return;

        const data = StorageManager.getData();
        data.aiPresets = data.aiPresets.filter(p => p.id !== id);
        
        // 兼容处理
        if (data.chatSessions) {
            data.chatSessions.forEach(s => {
                if (s.presetId === id) s.presetId = 'chat';
            });
        }

        StorageManager.save(data);
        renderPresetManagerList();

        // 同步通知 AI 侧边栏
        if (window.ChatManager && typeof window.ChatManager.loadData === 'function') {
            window.ChatManager.loadData();
            window.ChatManager.renderPresets();
            window.ChatManager.renderSessions();
        }
    }

    function escapeHTML(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function removeEmojis(str) {
        const emojiReg = /[\u{1F300}-\u{1F9FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{27BF}]|[\u{1F1E6}-\u{1F1FF}]|[\u{1F191}-\u{1F251}]|[\u{1F004}]|[\u{1F0CF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F300}-\u{1F5FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{27BF}]|[\u{1F1E6}-\u{1F1FF}]|[\u{1F191}-\u{1F251}]/gu;
        return str.replace(emojiReg, '');
    }

    // 初始化渲染设置中的预设管理器
    renderPresetManagerList();

    // 数据导入与导出交互 (系统级全局 LocalStorage 备份)
    const btnExport = document.getElementById('btn-export');
    const btnImportTrigger = document.getElementById('btn-import-trigger');
    const fileImportInput = document.getElementById('file-import');
    const btnResetData = document.getElementById('btn-reset-data');

    if (btnExport) {
        btnExport.addEventListener('click', () => {
            StorageManager.exportData();
        });
    }

    if (btnImportTrigger) {
        btnImportTrigger.addEventListener('click', () => {
            fileImportInput.click();
        });
    }

    if (fileImportInput) {
        fileImportInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                StorageManager.importData(file, (success, errorMsg) => {
                    if (success) {
                        alert("数据导入成功，页面即将刷新...");
                        window.location.reload();
                    } else {
                        alert(`导入失败: ${errorMsg}`);
                    }
                });
            }
        });
    }

    // 一键格式化清空数据
    if (btnResetData) {
        btnResetData.addEventListener('click', () => {
            const confirmFirst = confirm("警告：此操作将永久清空本地存储的所有提示词书、备忘录和API Key配置！\n确定要格式化工作台吗？");
            if (confirmFirst) {
                const confirmSecond = confirm("请再次确认，这会导致所有本地数据丢失且不可找回。输入确定开始格式化。");
                if (confirmSecond) {
                    StorageManager.resetData();
                    alert("工作台已格式化恢复至初始状态。");
                    window.location.reload();
                }
            }
        });
    }

    // 教程指南浮窗模态框打开与关闭
    const guideModal = document.getElementById('guide-modal');
    const btnCloseGuide = document.getElementById('btn-close-guide');
    const guideTriggers = document.querySelectorAll('.btn-guide-trigger');

    if (guideModal && btnCloseGuide) {
        guideTriggers.forEach(btn => {
            btn.addEventListener('click', () => {
                guideModal.classList.add('open');
            });
        });

        btnCloseGuide.addEventListener('click', () => {
            guideModal.classList.remove('open');
        });

        guideModal.addEventListener('click', (e) => {
            if (e.target === guideModal) {
                guideModal.classList.remove('open');
            }
        });
    }

    // ==========================================================================
    // 新增：提示词册 (Lexicon) 导入与导出去重合并交互
    // ==========================================================================
    const btnLexiconExport = document.getElementById('btn-lexicon-export');
    const btnLexiconImportTrigger = document.getElementById('btn-lexicon-import-trigger');
    const fileLexiconImport = document.getElementById('file-lexicon-import');

    if (btnLexiconExport) {
        btnLexiconExport.addEventListener('click', () => {
            const data = StorageManager.getData();
            const prompts = data.prompts || { presets: {}, custom: {} };
            const dataStr = JSON.stringify(prompts, null, 2);
            const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
            const exportName = `studio_lexicon_backup_${new Date().toISOString().slice(0, 10)}.json`;
            
            const link = document.createElement('a');
            link.setAttribute('href', dataUri);
            link.setAttribute('download', exportName);
            link.click();
        });
    }

    if (btnLexiconImportTrigger && fileLexiconImport) {
        btnLexiconImportTrigger.addEventListener('click', () => {
            fileLexiconImport.click();
        });

        fileLexiconImport.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const parsed = JSON.parse(event.target.result);
                        if (parsed.presets || parsed.custom) {
                            const data = StorageManager.getData();
                            data.prompts = data.prompts || { presets: {}, custom: {} };
                            
                            // 合并内置预设
                            const keys = ['style', 'expression', 'character', 'outfit', 'artistsCombo', 'artistsSolo', 'scenery'];
                            keys.forEach(k => {
                                const oldArr = data.prompts.presets[k] || [];
                                const newArr = parsed.presets?.[k] || [];
                                const merged = [...oldArr, ...newArr];
                                // 根据 ID 去重
                                const unique = merged.filter((item, index, self) =>
                                    self.findIndex(t => t.id === item.id) === index
                                );
                                data.prompts.presets[k] = unique;
                            });

                            // 合并自定义词包
                            const parsedCustom = parsed.custom || {};
                            for (let catName in parsedCustom) {
                                const oldCat = data.prompts.custom[catName] || [];
                                const newCat = parsedCustom[catName] || [];
                                const mergedCat = [...oldCat, ...newCat];
                                // 去重
                                const uniqueCat = mergedCat.filter((item, index, self) =>
                                    self.findIndex(t => t.id === item.id) === index
                                );
                                data.prompts.custom[catName] = uniqueCat;
                            }

                            StorageManager.save(data);
                            alert("提示词库导入并去重合并成功，页面即将刷新...");
                            window.location.reload();
                        } else {
                            alert("导入失败：非法提示词册 JSON 格式");
                        }
                    } catch(err) {
                        alert("导入失败：无法正确解析 JSON 数据");
                    }
                };
                reader.readAsText(file);
            }
        });
    }

    // ==========================================================================
    // 新增：针对“单个分类”的导入与导出逻辑
    // ==========================================================================
    const btnCategoryExport = document.getElementById('btn-category-export');
    const btnCategoryImportTrigger = document.getElementById('btn-category-import-trigger');
    const fileCategoryImport = document.getElementById('file-category-import');

    // 辅助函数：获取当前选中的分类名或分类 ID
    function getActiveCategory() {
        // 尝试从 prompt-book 的 DOM 结构中抓取当前 active 的 tab
        const activeTab = document.querySelector('#category-tabs .category-tab.active') || 
                          document.querySelector('#category-tabs .tab-item.active') ||
                          document.querySelector('#category-tabs .active');
        if (activeTab) {
            // 优先获取绑定的 key 或分类名，若无则获取 textContent
            return activeTab.dataset.category || activeTab.dataset.key || activeTab.textContent.trim();
        }
        // 降级使用全局 PromptBook 对象状态
        if (window.PromptBook && window.PromptBook.currentCategory) {
            return window.PromptBook.currentCategory;
        }
        return null;
    }

    // 1. 导出当前分类
    if (btnCategoryExport) {
        btnCategoryExport.addEventListener('click', () => {
            const currentCat = getActiveCategory();
            if (!currentCat) {
                alert('无法识别当前分类，请先在下方选择一个分类页签。');
                return;
            }

            const data = StorageManager.getData();
            let categoryPrompts = [];

            // 区分是 presets 内置分类还是 custom 自定义分类
            if (data.prompts.presets && data.prompts.presets[currentCat]) {
                categoryPrompts = data.prompts.presets[currentCat];
            } else if (data.prompts.custom && data.prompts.custom[currentCat]) {
                categoryPrompts = data.prompts.custom[currentCat];
            } else {
                // 有些情况下分类名和 presets 键名不完全一致，做模糊检索
                categoryPrompts = data.prompts.custom[currentCat] || [];
            }

            if (categoryPrompts.length === 0) {
                alert(`当前分类 "${currentCat}" 下暂无提示词条，无需导出。`);
                return;
            }

            const exportObj = {
                categoryName: currentCat,
                exportTime: Date.now(),
                prompts: categoryPrompts
            };

            const dataStr = JSON.stringify(exportObj, null, 2);
            const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
            const exportName = `lexicon_category_${currentCat}_${new Date().toISOString().slice(0, 10)}.json`;
            
            const link = document.createElement('a');
            link.setAttribute('href', dataUri);
            link.setAttribute('download', exportName);
            link.click();
        });
    }

    // 2. 触发并执行导入到当前分类
    if (btnCategoryImportTrigger && fileCategoryImport) {
        btnCategoryImportTrigger.addEventListener('click', () => {
            const currentCat = getActiveCategory();
            if (!currentCat) {
                alert('无法识别目标分类，请先在下方激活一个分类页签。');
                return;
            }
            fileCategoryImport.click();
        });

        fileCategoryImport.addEventListener('change', (e) => {
            const file = e.target.files[0];
            const currentCat = getActiveCategory();
            if (!file || !currentCat) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const parsed = JSON.parse(event.target.result);
                    let newItems = [];

                    // 兼容格式：如果导入的是分类结构包 { categoryName, prompts: [] }
                    if (parsed.prompts && Array.isArray(parsed.prompts)) {
                        newItems = parsed.prompts;
                    } else if (Array.isArray(parsed)) {
                        // 如果用户直接导入的是纯数组 [{name, content}]
                        newItems = parsed;
                    } else {
                        throw new Error("格式错误");
                    }

                    const data = StorageManager.getData();
                    data.prompts = data.prompts || { presets: {}, custom: {} };

                    // 检索并合并去重
                    let isPreset = false;
                    let targetList = [];

                    if (data.prompts.presets && data.prompts.presets.hasOwnProperty(currentCat)) {
                        targetList = data.prompts.presets[currentCat] || [];
                        isPreset = true;
                    } else {
                        if (!data.prompts.custom) data.prompts.custom = {};
                        if (!data.prompts.custom[currentCat]) {
                            data.prompts.custom[currentCat] = [];
                        }
                        targetList = data.prompts.custom[currentCat];
                    }

                    // 合并去重 (以 content 提示词内容作为唯一标志，防止重名/重词)
                    const merged = [...targetList, ...newItems];
                    const unique = merged.filter((item, index, self) =>
                        self.findIndex(t => t.content === item.content) === index
                    );

                    // 重新补全遗漏的 ID
                    unique.forEach(item => {
                        if (!item.id) item.id = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                    });

                    // 写回
                    if (isPreset) {
                        data.prompts.presets[currentCat] = unique;
                    } else {
                        data.prompts.custom[currentCat] = unique;
                    }

                    StorageManager.save(data);
                    alert(`导入成功！共导入并去重合并了 ${unique.length - targetList.length} 条提示词到当前分类 [${currentCat}]。`);
                    window.location.reload();

                } catch (err) {
                    alert("导入失败：请确认上传的是合法的分类提示词 JSON 格式备份文件。");
                }
                // 清除 value 保证重复上传同名文件能正常触发
                fileCategoryImport.value = '';
            };
            reader.readAsText(file);
        });
    }
});
