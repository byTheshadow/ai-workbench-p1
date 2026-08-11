/**
 * 全局数据管理器 - 统一负责本地数据读写及备份
 */
const StorageManager = {
    defaultData: {
        theme: 'light',
        apiConfig: {
            openaiUrl: 'https://api.openai.com/v1',
            openaiKey: '',
            imageV1Url: '', // 独立通用生图 Base URL
            imageV1Key: '', // 独立通用生图 API Key
            novelaiUrl: 'https://api.novelai.net',
            novelaiKey: '',
            sdUrl: 'http://127.0.0.1:7860',
            sdKey: '',
            corsProxy: 'https://cors-anywhere.herokuapp.com/'
        },
        prompts: {
            presets: {
                // 1. 画风与材质 (Style & Medium)
                style: [
                    { id: 'style_watercolor', name: '透明水彩 (Watercolor)', content: 'watercolor medium, paint splatters, bleeding colors', remark: '模拟水粉的边缘渗色和水渍干枯沉淀痕迹，画面清透空灵' },
                    { id: 'style_impasto', name: '厚涂油画 (Impasto)', content: 'impasto, oil painting, oil brush stroke, visible textures', remark: '模拟重彩画笔和刮刀层叠的油画颜料肌理，具有丰富的立体反光块面' },
                    { id: 'style_ink_sketch', name: '水墨写意 (Ink Painting)', content: 'chinese ink painting style, sumi-e, brush stroke, splash art', remark: '东方水墨的黑白写意感，配合边缘晕染' },
                    { id: 'style_retro_90s', name: '90年代手绘 (Retro Anime)', content: '1990s anime style, hand-drawn, cell shading, retro aesthetics', remark: '模拟 90 年代经典赛璐珞手绘质感' },
                    { id: 'style_clay', name: '黏土定格风 (Claymation)', content: 'claymation style, plasticine texture, tilt-shift, miniature', remark: '把角色塑造成黏土雕塑的玩具质感' }
                ],
                // 2. 光影与氛围 (Lighting & Atmosphere)
                expression: [
                    { id: 'light_volumetric', name: '丁达尔/体积光 (Volumetric)', content: 'volumetric lighting, sunbeams, light particles', remark: '穿透云雾或窗户的光束，空气感和尘埃微粒感强' },
                    { id: 'light_rim', name: '轮廓边缘光 (Rim Light)', content: 'rim lighting, backlighting, glowing edges', remark: '从角色后方打来的强光，勾勒出头发和身体轮廓' },
                    { id: 'light_cinematic', name: '电影质感光影 (Cinematic)', content: 'cinematic lighting, dramatic shadows, warm light', remark: '大对比度戏剧性光影，冷暖色温交叠' },
                    { id: 'light_neon', name: '赛博朋克霓虹 (Neon Light)', content: 'neon glow, cyberpunk color palette, purple and teal lighting', remark: '霓虹夜景反光，高对比度粉蓝/粉紫冷色调光照' },
                    { id: 'light_sunset', name: '日落黄金时刻 (Golden Hour)', content: 'golden hour, sunset, warm tint, long shadows', remark: '斜射的夕阳橙红色暖光，画面柔和怀旧' }
                ],
                // 3. 画质与基础预设 (Quality Presets)
                character: [
                    { id: 'preset_anime_quality', name: '极高画质 (Masterpiece)', content: 'masterpiece, best quality, ultra-detailed, illustration', remark: '动漫扩散模型基础高品质前缀' },
                    { id: 'preset_real_quality', name: '写实画质 (Photorealistic)', content: 'photorealistic, hyperrealistic, 8k resolution, raw photo', remark: '抑制二次元平涂感，增加真实材质与镜头感' }
                ],
                // 4. 服装与配饰预设 (Outfit)
                outfit: [
                    { id: 'outfit_school', name: '学院制服 (School Uniform)', content: 'school uniform, serafuku, pleated skirt, ribbon', remark: '经典水手服/学院百褶裙搭配' },
                    { id: 'outfit_fantasy_armor', name: '轻装铠甲 (Fantasy Armor)', content: 'fantasy light armor, breastplate, leather belts, gauntlets', remark: '幻想风格轻型皮甲与金属护甲细节' }
                ],
                // 5. 画师混合配方 (Artists Combo)
                artistsCombo: [
                    { id: 'combo_fantasy_watercolor', name: '幻境水彩 (WLOP + Shinkai)', content: '1.2::artist:wlop::, 0.9::artist:makoto shinkai::', remark: 'WLOP 细腻厚涂光影与新海诚通透天空的色彩结合' },
                    { id: 'combo_classic_retro', name: '复古插画 (Mucha + Yoshitaka)', content: '1.1::artist:alphonse mucha::, 1.0::artist:yoshitaka amano::', remark: '穆夏装饰线条与天野喜孝空灵奇幻水墨感的融合' },
                    { id: 'combo_cyber_mecha', name: '机甲机娘 (Nidy-2D- + Humikane)', content: '1.25::artist:nidy-2d-::, 0.9::artist:shimada humikane::', remark: '高精度机娘与装甲插画首选，线条锐利反光细腻' },
                    { id: 'combo_soft_kawaii', name: '空气感糖系 (Kantoku + Tiv)', content: '1.15::artist:kantoku::, 1.0::artist:tiv::', remark: '唯美少女日常感与通透细腻的光影表现' },
                    { id: 'combo_editorial_cg', name: '时尚大片CG (Ruan Jia + Ilya)', content: '1.2::artist:ruan jia::, 1.1::artist:ilya kuvshinov::', remark: '厚涂梦幻色彩与现代流行肖像剪影' }
                ], 
                // 6. 画师单体 (Artists Solo)
                artistsSolo: [
                    { id: 'solo_wlop', name: 'WLOP (厚涂/逆光)', content: 'artist:wlop', remark: '标志性华丽微粒逆光与金属冷暖对比' },
                    { id: 'solo_ask', name: 'Ask (高雅/冷调)', content: 'artist:ask', remark: '色彩高雅节制，线条纤细，面部具精致冷艳感' },
                    { id: 'solo_mika_pikazo', name: 'Mika Pikazo (高饱和/撞色)', content: 'artist:mika pikazo', remark: '高纯度粉/蓝/橙拼色与色块碰撞' },
                    { id: 'solo_fuzichoco', name: '藤原 (繁复华丽/背景)', content: 'artist:fuzichoco', remark: '色彩斑斓，擅长宏大且细节繁杂的幻想与和风背景' },
                    { id: 'solo_swd3e2', name: 'swd3e2 (冷调光斑/故事感)', content: 'artist:swd3e2', remark: '清冷的蓝白基调与透镜光晕（Lens Flare）' },
                    { id: 'solo_genga', name: '吉成曜 (动态原画线稿)', content: 'artist:yoshinari yo', remark: '动感十足的张力线条与机械特效' }
                ],  
                // 7. 构图与镜头 (Composition & Camera)
                scenery: [
                    { id: 'comp_close_up', name: '面部特写 (Close-up)', content: 'close-up, face focus, detailed eyes', remark: '强化面部微表情与精致五官' },
                    { id: 'comp_cowboy_shot', name: '半身像 (Cowboy Shot)', content: 'cowboy shot, upper body, hips focus', remark: '展示人物腰部以上的姿态与服装' },
                    { id: 'comp_full_body', name: '全身照 (Full Body)', content: 'full body, wide shot', remark: '展示完整全身服饰与周围环境交互' },
                    { id: 'comp_dynamic_angle', name: '动态仰视 (Dynamic Low Angle)', content: 'dynamic angle, low angle shot, foreshortening', remark: '透视收缩的低角度仰视，增强视觉张力' },
                    { id: 'comp_golden_ratio', name: '三分法 (Rule of Thirds)', content: 'rule of thirds, off-center portrait', remark: '主体偏置于三分线，避免居中死板' }
                ]
            },
            custom: {} 
        },
        memos: [], 
        todos: [],  
        chatSessions: [
            {
                id: 'session_default',
                title: '默认会话',
                presetId: 'chat',
                model: '',
                messages: [
                    { id: 'msg_init', role: 'assistant', content: '你好。我是你的创作助手。你可以点击上方新建不同的会话，并切换不同的专业预设身份来辅助你。', versions: ['你好。我是你的创作助手。你可以点击上方新建不同的会话，并切换不同的专业预设身份来辅助你。'], activeVersionIndex: 0 }
                ]
            }
        ],
        aiPresets: [
            { 
                id: 'chat', 
                name: '轻松漫聊', 
                systemPrompt: '你是一个懂二次元的温和助手，请以轻松随和但严谨的口吻回答问题。回答中应使用杂志感的排版、清晰的分段，且绝对不要使用任何表情符号（Emoji）。', 
                isSystem: true 
            },
            { 
                id: 'magician', 
                name: '提示词魔法师 [NovelAI]', 
                systemPrompt: '接下来你要帮助我生成一组适用于NovelAI的或其他基于Danbooru tag扩散模型的高质量图像生成prompt。构建一个结构清晰细节丰富的prompt。要求如下描述一名角色包括外观特征，服饰，姿势，背景，表情，视角等。从提供的画师串当中随机选择1-3位画师，对每位画师加上0.8到1.2之间的权重，格式为0.9::artist:画师名::并保证画师串之间有协调性风格不冲突。【约束条件】：仅使用Danbooru风格的标签。全部小写，英文，英文逗号分割。应包含常见的高质量标签，比如masterpiece,best quality,ultra-detailed,year2025等。不重复使用同一画师，避免使用可能和画师风格冲突的标签。提示词示范：artist:moccha_(mochancc),0.9::artist:uminonew::,0.4::artist:ask_(askzy)::,0.9::artist:liduke::,masterpiece,best quality,year2024,year2025,newest。请直接输出构建好的Danbooru tag串，不要包含任何多余解释与表情符号（Emoji）。', 
                isSystem: true 
            },
            { 
                id: 'structurer', 
                name: '想法理顺器', 
                systemPrompt: '你是一个专业的逻辑思维分析师。用户的输入可能比较散乱、无序。你的任务是站在资深项目管理与创意策划的角度，提取并整理其中的核心创意、隐藏冲突与逻辑链条，并自动分出关键的行动项(TODO)和核心设定。格式上使用冷峻的杂志风格排版，使用清晰的Markdown列表，禁止使用任何表情符号（Emoji）。', 
                isSystem: true 
            },
            { 
                id: 'screenplay', 
                name: '剧本编辑器', 
                systemPrompt: '你是一个资深的编剧专家。你的任务是协助创作者进行文学大纲拆解、故事起承转合论证、冲突设计、分镜脚本润色以及台词打磨。你的回答应极具专业性、直指痛点，并严格遵循专业的剧本文体结构。绝对不要使用任何表情符号（Emoji）。', 
                isSystem: true 
            }
        ]
    },

    init() {
        if (!localStorage.getItem('studio_workbench_data')) {
            this.save(this.defaultData);
        } else {
            const data = JSON.parse(localStorage.getItem('studio_workbench_data'));
            let updated = false;
            
            if (!data.apiConfig) {
                data.apiConfig = this.defaultData.apiConfig;
                updated = true;
            } else {
                if (data.apiConfig.sdUrl === undefined) {
                    data.apiConfig.sdUrl = 'http://127.0.0.1:7860';
                    updated = true;
                }
                if (data.apiConfig.sdKey === undefined) {
                    data.apiConfig.sdKey = '';
                    updated = true;
                }
                if (data.apiConfig.imageV1Url === undefined) {
                    data.apiConfig.imageV1Url = '';
                    updated = true;
                }
                if (data.apiConfig.imageV1Key === undefined) {
                    data.apiConfig.imageV1Key = '';
                    updated = true;
                }
                if (data.apiConfig.novelaiUrl === undefined) {
                    data.apiConfig.novelaiUrl = 'https://api.novelai.net';
                    updated = true;
                }
                if (!data.apiConfig.corsProxy || data.apiConfig.corsProxy.trim() === '') {
                    data.apiConfig.corsProxy = 'https://cors-anywhere.herokuapp.com/';
                    updated = true;
                }
            }

            // 补充/更新提示词预设库，防止旧数据缺少预设项
            if (!data.prompts) {
                data.prompts = this.defaultData.prompts;
                updated = true;
            } else {
                if (!data.prompts.presets) {
                    data.prompts.presets = this.defaultData.prompts.presets;
                    updated = true;
                } else {
                    const presetKeys = ['style', 'expression', 'character', 'outfit', 'artistsCombo', 'artistsSolo', 'scenery'];
                    presetKeys.forEach(k => {
                        if (!data.prompts.presets[k] || data.prompts.presets[k].length === 0) {
                            data.prompts.presets[k] = this.defaultData.prompts.presets[k];
                            updated = true;
                        }
                    });
                }
                if (!data.prompts.custom) {
                    data.prompts.custom = {};
                    updated = true;
                }
            }

            if (!data.chatSessions) {
                data.chatSessions = this.defaultData.chatSessions;
                updated = true;
            }
            if (!data.aiPresets) {
                data.aiPresets = this.defaultData.aiPresets;
                updated = true;
            } else {
                const hasMagician = data.aiPresets.some(p => p.id === 'magician');
                if (!hasMagician) {
                    data.aiPresets.push(this.defaultData.aiPresets.find(p => p.id === 'magician'));
                    updated = true;
                }
            }
            if (updated) {
                this.save(data);
            }
        }
    },

    getData() {
        this.init();
        try {
            return JSON.parse(localStorage.getItem('studio_workbench_data'));
        } catch (e) {
            console.error("读取本地数据失败，正在恢复默认数据...", e);
            return this.defaultData;
        }
    },

    save(data) {
        localStorage.setItem('studio_workbench_data', JSON.stringify(data));
    },

    updateKey(key, value) {
        const data = this.getData();
        data[key] = value;
        this.save(data);
    },

    resetData() {
        localStorage.removeItem('studio_workbench_data');
        localStorage.removeItem('studio_workbench_drafts');
        localStorage.removeItem('studio_workbench_active_draft_id');
        this.init();
    },

    exportData() {
        const dataStr = localStorage.getItem('studio_workbench_data') || JSON.stringify(this.defaultData);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        const exportFileDefaultName = `studio_workbench_backup_${new Date().toISOString().slice(0,10)}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
    },

    importData(file, callback) {
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsedData = JSON.parse(event.target.result);
                if (parsedData.hasOwnProperty('apiConfig') && parsedData.hasOwnProperty('prompts')) {
                    this.save(parsedData);
                    if (callback) callback(true);
                } else {
                    if (callback) callback(false, "文件数据结构不兼容");
                }
            } catch (e) {
                if (callback) callback(false, "无效的 JSON 数据");
            }
        };
        reader.readAsText(file);
    }
};

StorageManager.init();
