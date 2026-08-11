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
        { id: 'style_realistic_ancient', name: '真人古风写实', content: '8K超高清电影级画质，横屏宽幅电影画幅，真人古风写实质感，ARRI Alexa 65电影摄影机质感，真实皮肤原生肌理，发丝根根分明，服装面料纹理清晰', remark: '适合古风短剧人物写实风格' },
        { id: 'style_ue5_game', name: 'UE5写实游戏风', content: 'UE5高精度写实游戏角色质感，真人比例，真实皮肤与毛发，环境光遮蔽，电影级动态光影，三维空间感强', remark: '高规格游戏角色展示效果' },
        { id: 'style_3d_anime', name: '3D国漫风', content: '新中式3D国漫角色质感，融合东方古典审美与现代动画视觉，细腻柔和皮肤质感，东方五官比例，华美古风服饰', remark: '兼具写实细节与动画表现力' },
        { id: 'style_demonic_elegant', name: '妖冶阴柔风', content: 'CG写实角色质感，妖冶阴柔的东方美学，冷白皮肤，狭长眼型，眼尾微微上挑，深色华服，低饱和冷色调，暗黑诡异氛围', remark: '神秘危险摄人心魄的东方美学' },
        { id: 'style_watercolor', name: '透明水彩 (Watercolor)', content: 'watercolor medium, paint splatters, bleeding colors', remark: '模拟水粉的边缘渗色和水渍干枯沉淀痕迹，画面清透空灵' },
        { id: 'style_impasto', name: '厚涂油画 (Impasto)', content: 'impasto, oil painting, oil brush stroke, visible textures', remark: '模拟重彩画笔和刮刀层叠的油画颜料肌理，具有丰富的立体反光块面' },
        { id: 'style_ink_sketch', name: '水墨写意 (Ink Painting)', content: 'chinese ink painting style, sumi-e, brush stroke, splash art', remark: '东方水墨的黑白写意感，配合边缘晕染' },
        { id: 'style_retro_90s', name: '90年代手绘 (Retro Anime)', content: '1990s anime style, hand-drawn, cell shading, retro aesthetics', remark: '模拟 90 年代经典赛璐珞手绘质感' },
        { id: 'style_clay', name: '黏土定格风 (Claymation)', content: 'claymation style, plasticine texture, tilt-shift, miniature', remark: '把角色塑造成黏土雕塑的玩具质感' }
    ],

    // 2. 光影与氛围 (Lighting & Atmosphere)
    expression: [
        { id: 'light_film_layered', name: '电影级分层光影', content: '正面主柔光均匀照亮面部，45°侧光塑造脸部与身形轮廓，侧后方发丝光勾勒编发与羽毛边缘，背部轮廓光分离人物与背景，银饰、宝石与唇面局部高光', remark: '暖调神秘柔光滤镜，氛围诡谲明艳' },
        { id: 'light_cold_warm', name: '冷暖光影对比', content: '冷硬侧逆光在面部形成强烈轮廓，低饱和灰调柔光渲染氛围，高对比明暗强调戏剧冲突，电影级质感', remark: '适合对峙、压迫、冲突场景' },
        { id: 'light_warm_soft', name: '暖调柔光', content: '暖黄昏暗床头光，低饱和柔光，氛围感官沉，电影级质感，暖色调滤镜', remark: '适合温柔、治愈、暧昧场景' },
        { id: 'light_golden_hour', name: '黄金时刻暖光', content: '斜射的夕阳橙红色暖光，柔光逆勾出发丝与廓线，暖射光营造甜蜜氛围，电影级质感', remark: '适合怀旧、浪漫、温馨场景' },
        { id: 'light_volumetric', name: '丁达尔/体积光 (Volumetric)', content: 'volumetric lighting, sunbeams, light particles', remark: '穿透云雾或窗户的光束，空气感和尘埃微粒感强' },
        { id: 'light_rim', name: '轮廓边缘光 (Rim Light)', content: 'rim lighting, backlighting, glowing edges', remark: '从角色后方打来的强光，勾勒出头发和身体轮廓' },
        { id: 'light_cinematic', name: '电影质感光影 (Cinematic)', content: 'cinematic lighting, dramatic shadows, warm light', remark: '大对比度戏剧性光影，冷暖色温交叠' },
        { id: 'light_neon', name: '赛博朋克霓虹 (Neon Light)', content: 'neon glow, cyberpunk color palette, purple and teal lighting', remark: '霓虹夜景反光，高对比度粉蓝/粉紫冷色调光照' },
        { id: 'light_sunset', name: '日落黄金时刻 (Golden Hour)', content: 'golden hour, sunset, warm tint, long shadows', remark: '斜射的夕阳橙红色暖光，画面柔和怀旧' }
    ],

    // 3. 人物气质与情绪 (Character Temperament & Emotion)
    character: [
        { id: 'temp_cold_elegant', name: '清冷禁欲', content: '淡漠疏离，冷静自持，眼神克制，嘴角自然下压，面部肌肉放松，下颌线清晰，情绪克制，生人勿近', remark: '适合高冷、孤高、疏离角色' },
        { id: 'temp_gentle_healing', name: '温柔治愈', content: '眼神柔和专注，眉眼舒展，唇角轻轻上扬，浅淡笑意，面部线条柔和，气质松弛，带有安抚感与宠溺感', remark: '适合温柔、宠溺、治愈角色' },
        { id: 'temp_bright_vivid', name: '明艳大气', content: '气场张扬，眉眼锐利，眼神明媚，五官舒展，唇形明艳，面部轮廓清晰，自信大方，鲜活热烈', remark: '适合明媚、张扬、热烈角色' },
        { id: 'temp_fragile_broken', name: '破碎脆弱', content: '眼眶微红，眼神湿润，目光躲闪，嘴角轻抿，眉心轻蹙，面部线条柔软，神态隐忍落寞，带有破碎感', remark: '适合委屈、隐忍、受伤角色' },
        { id: 'temp_youthful_salt', name: '少年盐系', content: '眉眼干净清澈，眼神淡然，唇角放松，面部线条平直，皮肤清透，气质松弛，干净自然，带有轻微少年感', remark: '适合清爽、干净、少年角色' },
        { id: 'temp_dangerous_sick', name: '病娇危险', content: '嘴角微微上扬，笑意诡谲，唇角带有危险感，眼神偏执而专注，瞳孔聚焦，带有侵略性，面部微微紧绷', remark: '适合偏执、危险、病娇角色' },
        { id: 'temp_domineering', name: '霸气压迫', content: '眉眼压低，眼神锐利具有压迫感，下颌紧绷，面部线条硬朗，气场强势，具有掌控感', remark: '适合强势、霸气、压制角色' },
        { id: 'preset_anime_quality', name: '极高画质 (Masterpiece)', content: 'masterpiece, best quality, ultra-detailed, illustration', remark: '动漫扩散模型基础高品质前缀' },
        { id: 'preset_real_quality', name: '写实画质 (Photorealistic)', content: 'photorealistic, hyperrealistic, 8k resolution, raw photo', remark: '抑制二次元平涂感，增加真实材质与镜头感' }
    ],

    // 4. 服装与配饰预设 (Outfit)
    outfit: [
        { id: 'outfit_ancient_noble', name: '古风贵族', content: '锦缎长袍，金线刺绣，云纹暗纹，雕花银饰，玉佩，宝石，护腕，腰牌，华美古风服饰', remark: '适合贵族、王族、高位角色' },
        { id: 'outfit_miao_style', name: '苗疆服饰', content: '苗绣纹样，银饰金属，羽毛，珠链，步摇，额饰，皮革，麻布，异域神秘风格', remark: '适合苗疆、巫蛊、异族角色' },
        { id: 'outfit_immortal_sect', name: '仙门道袍', content: '月白长衫，深青道袍，绫罗纱衣，云纹刺绣，玉佩流苏，清雅出尘风格', remark: '适合仙门、修仙、出尘角色' },
        { id: 'outfit_jianghu', name: '江湖侠客', content: '玄色锦袍，皮革护腕，腰带佩剑，简洁利落，实用机动风格', remark: '适合江湖、侠客、游侠角色' },
        { id: 'outfit_wedding', name: '古风嫁衣', content: '绛红嫁衣，金线凤凰刺绣，珠帘遮面，华美繁复，喜庆隆重风格', remark: '适合婚礼、大典、喜庆场景' },
        { id: 'outfit_school', name: '学院制服 (School Uniform)', content: 'school uniform, serafuku, pleated skirt, ribbon', remark: '经典水手服/学院百褶裙搭配' },
        { id: 'outfit_fantasy_armor', name: '轻装铠甲 (Fantasy Armor)', content: 'fantasy light armor, breastplate, leather belts, gauntlets', remark: '幻想风格轻型皮甲与金属护甲细节' }
    ],

    // 5. 运镜方式 (Camera Movement)
    camera: [
        { id: 'cam_fixed', name: '固定静止镜头', content: '全景固定机位，镜头全程静止不动，画面平稳规整，完整定格人物动作与场景环境，无任何镜头位移、推拉晃动', remark: '适合对话、对峙、静态氛围感镜头' },
        { id: 'cam_slow_push', name: '缓慢推镜', content: '镜头匀速缓慢向前推进，从全景平稳过渡到中近景，聚焦人物主体，弱化背景环境，突出人物神态与细腻动作', remark: '适合抒情、走心、安静对话场景' },
        { id: 'cam_slow_pull', name: '缓慢拉镜', content: '镜头匀速缓慢向后拉远，从人物近景缓缓拉远至全景或大远景，逐步展现完整环境，烘托孤独、辽阔、释然、落寞氛围', remark: '适合开阔氛围、孤独感展示' },
        { id: 'cam_tracking', name: '跟拍追踪镜', content: '镜头全程跟随人物移动轨迹，紧密贴合人物动作节奏，平稳滑动，锁定人物主体不脱焦', remark: '适合奔跑、追逐、逃离和移动场景' },
        { id: 'cam_fast_push', name: '快速推镜', content: '镜头快速向前推进，瞬间聚焦人物面部神态与手部动作，强化紧张感和压迫感', remark: '适合冲突爆发、强势靠近和情绪递进' },
        { id: 'cam_handheld', name: '灵动手持镜', content: '轻微真实手持晃动，小幅自然抖动，模拟真实实拍临场感，强化冲突感', remark: '适合拉扯、争执、推撞、失控与慌乱挣扎' },
        { id: 'cam_orbit', name: '环绕运镜', content: '镜头绕人物缓慢旋转环行，多角度包围人物，强化紧张感、包围感与压迫感', remark: '适合紧张、包围、全方位展示人物' },
        { id: 'cam_whip', name: '甩镜切镜', content: '镜头短促快速横向甩动切换，干脆利落，节奏紧凑爽快', remark: '适合打斗转场、势力切换和剧情爆发' },
        { id: 'cam_low_angle', name: '低位仰拍', content: '镜头从低角度向上推进，放大人物身形、力量与压迫感', remark: '适合强者对峙、霸气压制场景' },
        { id: 'cam_high_angle', name: '高位俯拍', content: '高位俯拍，镜头缓慢下拉，人物处于画面中心，四周空旷', remark: '适合孤独、失意、崩溃与落寞场景' },
        { id: 'cam_focus_shift', name: '虚实焦点运镜', content: '背景逐渐虚化，人物主体逐步清晰聚焦，锁定人物神态，放大情绪张力', remark: '适合高光名场面、虐心瞬间' },
        { id: 'cam_slow_motion', name: '慢动作运镜', content: '升格拍摄，放慢眼神、嘴角、手部、发丝、泪痕与饰品细节，突出高光动作', remark: '适合情绪高光、暧昧瞬间、动作特写' }
    ],

    // 6. 构图与镜头 (Composition & Framing)
    scenery: [
        { id: 'comp_close_up', name: '面部特写 (Close-up)', content: 'close-up, face focus, detailed eyes, 面部特写，聚焦五官神态、妆容细节与微表情', remark: '强化面部微表情与精致五官' },
        { id: 'comp_cowboy_shot', name: '半身像 (Cowboy Shot)', content: 'cowboy shot, upper body, hips focus, 半身像，展示腰部以上的姿态与服装', remark: '展示人物腰部以上的姿态与服装' },
        { id: 'comp_full_body', name: '全身照 (Full Body)', content: 'full body, wide shot, 全身站立，约9头身比例，展示完整服饰与动作', remark: '展示完整全身服饰与周围环境交互' },
        { id: 'comp_three_view', name: '三视图', content: '全身站立三视图，正面、侧面、背面依次均匀排布，严格遵循约9头身比例，肢体舒展自然，全面展示发型、服饰与配饰', remark: '适合角色设定展示、全方位设计稿' },
        { id: 'comp_dynamic_angle', name: '动态仰视 (Dynamic Low Angle)', content: 'dynamic angle, low angle shot, foreshortening, 动态仰视，透视收缩，增强视觉张力', remark: '透视收缩的低角度仰视，增强视觉张力' },
        { id: 'comp_golden_ratio', name: '三分法 (Rule of Thirds)', content: 'rule of thirds, off-center portrait, 三分法构图，主体偏置，避免居中死板', remark: '主体偏置于三分线，避免居中死板' },
        { id: 'comp_split_panel', name: '横屏分栏构图', content: '横屏分栏构图，画面左侧为人物正面人脸近景特写，画面右侧为人物全身站立三视图', remark: '适合角色海报、设定图、完整展示' }
    ],

    // 7. 打戏与动作 (Action & Combat)
    action: [
        { id: 'action_combat_base', name: '打戏基础', content: '动作符合人体力学与物理规律，短蓄力后瞬间高爆发，一招衔接一招，动作连续流畅，具有真实重量感、速度感、冲击力、受击反馈与格挡反馈', remark: '真实物理打击感基础词' },
        { id: 'action_sword_dash', name: '剑气冲刺', content: '长剑突刺，剑气贯穿，直线攻击，剑芒爆发，穿透目标，剑身周围环绕能量流光', remark: '适合剑修、剑客、单体突刺' },
        { id: 'action_dual_seal', name: '双印合击', content: '双手结印，灵力汇聚，法印叠加，金色符文环绕，能量在掌心爆发，冲击波扩散', remark: '适合法修、术士、印法攻击' },
        { id: 'action_aerial_strike', name: '破岳下坠', content: '高空俯冲，垂直坠落，剑势破山，冲击地面，碎石飞溅，尘雾爆发', remark: '适合重击、终结技、AOE攻击' },
        { id: 'action_formation', name: '镇灵封杀', content: '巨大法阵，金色符文，空间封锁，灵力镇压，阵法收束，目标被困', remark: '适合控制、封印、大范围法术' },
        { id: 'action_dodge', name: '轻云闪位', content: '快速闪身，残影移动，轻灵位移，瞬间换位，身形模糊，衣摆与发丝惯性飘动', remark: '适合闪避、位移、轻功' },
        { id: 'action_counter', name: '剑幕回防', content: '剑气成幕，连续格挡，反弹攻击，层次防御，剑光交织形成防护网', remark: '适合防御、反击、格挡' }
    ],

    // 8. 画师混合配方 (Artists Combo)
    artistsCombo: [
        { id: 'combo_fantasy_watercolor', name: '幻境水彩 (WLOP + Shinkai)', content: '1.2::artist:wlop::, 0.9::artist:makoto shinkai::', remark: 'WLOP 细腻厚涂光影与新海诚通透天空的色彩结合' },
        { id: 'combo_classic_retro', name: '复古插画 (Mucha + Yoshitaka)', content: '1.1::artist:alphonse mucha::, 1.0::artist:yoshitaka amano::', remark: '穆夏装饰线条与天野喜孝空灵奇幻水墨感的融合' },
        { id: 'combo_cyber_mecha', name: '机甲机娘 (Nidy-2D- + Humikane)', content: '1.25::artist:nidy-2d-::, 0.9::artist:shimada humikane::', remark: '高精度机娘与装甲插画首选，线条锐利反光细腻' },
        { id: 'combo_soft_kawaii', name: '空气感糖系 (Kantoku + Tiv)', content: '1.15::artist:kantoku::, 1.0::artist:tiv::', remark: '唯美少女日常感与通透细腻的光影表现' },
        { id: 'combo_editorial_cg', name: '时尚大片CG (Ruan Jia + Ilya)', content: '1.2::artist:ruan jia::, 1.1::artist:ilya kuvshinov::', remark: '厚涂梦幻色彩与现代流行肖像剪影' }
    ],

    // 9. 画师单体 (Artists Solo)
    artistsSolo: [
        { id: 'solo_wlop', name: 'WLOP (厚涂/逆光)', content: 'artist:wlop', remark: '标志性华丽微粒逆光与金属冷暖对比' },
        { id: 'solo_ask', name: 'Ask (高雅/冷调)', content: 'artist:ask', remark: '色彩高雅节制，线条纤细，面部具精致冷艳感' },
        { id: 'solo_mika_pikazo', name: 'Mika Pikazo (高饱和/撞色)', content: 'artist:mika pikazo', remark: '高纯度粉/蓝/橙拼色与色块碰撞' },
        { id: 'solo_fuzichoco', name: '藤原 (繁复华丽/背景)', content: 'artist:fuzichoco', remark: '色彩斑斓，擅长宏大且细节繁杂的幻想与和风背景' },
        { id: 'solo_swd3e2', name: 'swd3e2 (冷调光斑/故事感)', content: 'artist:swd3e2', remark: '清冷的蓝白基调与透镜光晕（Lens Flare）' },
        { id: 'solo_genga', name: '吉成曜 (动态原画线稿)', content: 'artist:yoshinari yo', remark: '动感十足的张力线条与机械特效' }
    ],

    // 10. 五官记忆点 (Facial Features)
    facialFeatures: [
        { id: 'face_phoenix_eyes', name: '狭长凤眼', content: '狭长凤眼，眼尾微微上挑，眼神锐利而具有压迫感，瞳孔边缘清晰，具有通透高光', remark: '清冷疏离、危险气质专用' },
        { id: 'face_almond_eyes', name: '圆润杏眼', content: '圆润杏眼，眼神明亮清澈，瞳孔通透，眼底温润，自然双眼皮', remark: '温柔、明媚、少年感专用' },
        { id: 'face_droopy_eyes', name: '下垂眼', content: '无辜下垂眼，眼尾自然下垂，眼神柔弱，带有委屈感与楚楚可怜气质', remark: '柔弱、委屈、破碎角色专用' },
        { id: 'face_tear_mole', name: '泪痣', content: '眼下淡淡泪痣，增强辨识度与神秘感', remark: '五官记忆点，增强人物辨识度' },
        { id: 'face_thin_lips', name: '薄唇', content: '薄唇，唇峰清晰，唇角自然下压，唇色偏淡，带有冷淡克制感', remark: '清冷、禁欲、疏离角色专用' },
        { id: 'face_full_lips', name: '厚唇', content: '厚唇明艳，饱满M形唇，唇色偏红，自然水润光泽，唇珠突出', remark: '明艳、热情、魅惑角色专用' },
        { id: 'face_high_nose', name: '高挺鼻梁', content: '鼻梁高挺笔直，鼻尖精致，东方雕塑感鼻梁，立体五官', remark: '贵气、成熟、立体感强' },
        { id: 'face_narrow_face', name: '窄长脸', content: '窄长脸，清晰下颌线，骨相干净利落，颧骨轻微突出，面中平整，棱角分明', remark: '清冷、高冷、禁欲气质专用' }
    ],

    // 11. 情境场景 (Scene Context)
    sceneContext: [
        { id: 'scene_palace', name: '宫殿大殿', content: '宫殿大殿，红柱金瓦，雕梁画栋，帷幔垂帘，宫灯摇曳，庄严肃穆氛围', remark: '适合朝堂、权谋、册封场景' },
        { id: 'scene_bamboo', name: '竹林幽境', content: '竹林幽境，翠竹摇曳，阳光斑驳，薄雾缭绕，清幽静谧氛围', remark: '适合隐居、修行、对话场景' },
        { id: 'scene_night_city', name: '古城夜景', content: '古城夜景，灯火阑珊，街道繁华，红灯笼悬挂，人声鼎沸或寂静空无', remark: '适合夜市、追逐、刺杀场景' },
        { id: 'scene_cliff', name: '悬崖峭壁', content: '悬崖峭壁，云雾缭绕，山峦起伏，险峻壮阔，风声呼啸', remark: '适合决战、跳崖、终结场景' },
        { id: 'scene_rain', name: '雨夜', content: '雨夜，暴雨倾盆，雨水打在屋檐瓦片上，水雾弥漫，氛围压抑凄凉', remark: '适合分离、悲伤、冲突场景' },
        { id: 'scene_boudoir', name: '闺房', content: '古风闺房，纱帐轻垂，铜镜梳妆台，雕花木床，烛光摇曳，温馨私密', remark: '适合暧昧、私密、日常场景' },
        { id: 'scene_battlefield', name: '战场', content: '战场，尸横遍野，旌旗猎猎，烽烟四起，残阳如血，悲壮苍凉', remark: '适合战争、牺牲、史诗场景' }
    ]
}
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
