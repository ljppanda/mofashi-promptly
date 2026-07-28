// 提示词模板数据（等价于 Markdown + frontmatter）。
// 字段：slug, title, industry, task, summary, tags[], model, variables[], prompt
// variable: { name, label, type: textarea|text|select|multiselect, options?, required?, placeholder? }

export const TEMPLATES = [
  // ===== 法律 =====
  {
    slug: "legal-advisor",
    title: "法律顾问",
    industry: "法律",
    task: "法律顾问",
    summary: "让 AI 扮演某法域的法律顾问，就用户问题给出结构化法律分析与建议",
    tags: ["合同", "合规", "咨询"],
    model: "general",
    variables: [
      { name: "jurisdiction", label: "适用法域", type: "select", options: ["中国大陆", "中国香港", "美国", "欧盟"], required: true },
      { name: "role", label: "顾问角色", type: "text", required: true, placeholder: "如：初创公司外部法务" },
      { name: "question", label: "用户问题", type: "textarea", required: true, placeholder: "描述你遇到的法律情境或问题" },
      { name: "scope", label: "输出范围", type: "multiselect", options: ["风险点", "合规建议", "条款草稿", "下一步行动"], required: false }
    ],
    prompt: "你是一名持有 {{jurisdiction}} 执业资格的资深法律顾问，当前角色是 {{role}}。\n请就以下问题给出结构化分析，覆盖 {{scope}}：\n\n问题：\n{{question}}\n\n要求：区分“法律建议”与“实操建议”，标注不确定性，必要时提示咨询持证律师。"
  },
  {
    slug: "contract-review",
    title: "合同审查",
    industry: "法律",
    task: "合同审查",
    summary: "对合同文本做风险与合规审查，输出问题清单与修改建议",
    tags: ["合同", "风险", "审查"],
    model: "general",
    variables: [
      { name: "contract_type", label: "合同类型", type: "select", options: ["劳务", "采购", "保密", "许可", "其他"], required: true },
      { name: "party_role", label: "我方角色", type: "text", required: true, placeholder: "如：甲方/乙方" },
      { name: "contract_text", label: "合同文本", type: "textarea", required: true, placeholder: "粘贴合同全文或关键条款" },
      { name: "focus", label: "关注重点", type: "multiselect", options: ["权责对等", "付款条款", "违约责任", "保密与知识产权", "终止与争议解决"], required: false }
    ],
    prompt: "你是一名资深合同审查律师。我方为 {{party_role}}，合同类型为 {{contract_type}}。\n请审查以下合同，重点关注 {{focus}}，输出：①风险点清单（按严重程度）②修改建议（附理由）③可直接替换的条款草稿。\n\n合同：\n{{contract_text}}"
  },
  {
    slug: "clause-explain",
    title: "条款解释",
    industry: "法律",
    task: "条款解释",
    summary: "把晦涩法律条款翻译成普通人能懂的说明，并提示隐含风险",
    tags: ["解释", "科普"],
    model: "general",
    variables: [
      { name: "clause", label: "待解释条款", type: "textarea", required: true, placeholder: "粘贴条款原文" },
      { name: "jurisdiction", label: "适用法域", type: "select", options: ["中国大陆", "中国香港", "美国", "欧盟"], required: true },
      { name: "audience", label: "读者水平", type: "select", options: ["普通用户", "专业人士"], required: false }
    ],
    prompt: "请用{{audience}}能理解的语言解释下述{{jurisdiction}}法律条款的含义、适用场景与潜在不利影响，并举例说明。\n\n条款：\n{{clause}}"
  },

  // ===== 医疗健康 =====
  {
    slug: "family-doctor",
    title: "家庭医生",
    industry: "医疗健康",
    task: "家庭医生",
    summary: "基于症状与病史给出可能的方向、居家建议与就医信号（非诊断）",
    tags: ["问诊", "健康"],
    model: "general",
    variables: [
      { name: "age_group", label: "人群", type: "select", options: ["儿童", "成人", "老人", "孕妇"], required: true },
      { name: "symptom", label: "症状描述", type: "textarea", required: true, placeholder: "描述主要症状、持续时间、加重/缓解因素" },
      { name: "history", label: "既往史", type: "text", required: false, placeholder: "慢性病/用药/过敏史（无可留空）" },
      { name: "want", label: "希望获得", type: "multiselect", options: ["可能原因", "居家建议", "就医信号", "就诊科室建议"], required: false }
    ],
    prompt: "你是一名耐心尽责的家庭医生。面对{{age_group}}患者，症状如下，既往史：{{history}}。\n请就 {{want}} 给出通俗说明。强调：这不是正式诊断，出现危险信号须及时线下就医。\n\n症状：\n{{symptom}}"
  },
  {
    slug: "symptom-triage",
    title: "症状初判",
    industry: "医疗健康",
    task: "症状初判",
    summary: "对症状做紧急程度初判与分诊建议",
    tags: ["分诊", "急诊"],
    model: "general",
    variables: [
      { name: "symptom", label: "症状", type: "textarea", required: true, placeholder: "描述症状" },
      { name: "severity", label: "当前严重程度", type: "select", options: ["轻微", "中等", "严重"], required: true },
      { name: "duration", label: "持续时间", type: "text", required: false, placeholder: "如：2 天" },
      { name: "output", label: "输出内容", type: "multiselect", options: ["紧急程度", "可能原因", "居家处理", "立即就医指征"], required: false }
    ],
    prompt: "你是一名急诊分诊护士。患者症状严重程度{{severity}}，持续{{duration}}。\n请输出 {{output}}，并明确列出“需立即拨打急救电话”的危险信号。\n\n症状：\n{{symptom}}"
  },
  {
    slug: "health-science",
    title: "健康科普",
    industry: "医疗健康",
    task: "健康科普",
    summary: "把医学话题写成易懂、严谨的科普文",
    tags: ["科普", "写作"],
    model: "general",
    variables: [
      { name: "topic", label: "科普主题", type: "text", required: true, placeholder: "如：幽门螺杆菌" },
      { name: "audience", label: "读者", type: "select", options: ["大众", "宝妈", "中老年", "健身人群"], required: true },
      { name: "length", label: "篇幅", type: "select", options: ["短文 200 字", "中篇 600 字", "长文 1200 字"], required: false },
      { name: "tone", label: "语气", type: "select", options: ["亲切", "专业", "轻松"], required: false }
    ],
    prompt: "写一篇关于《{{topic}}》的健康科普，面向{{audience}}，篇幅{{length}}，语气{{tone}}。\n要求：结论有依据、标注“个体差异，仅供参考”、避免绝对化表述。"
  },

  // ===== 职场办公 =====
  {
    slug: "weekly-report",
    title: "周报生成",
    industry: "职场办公",
    task: "周报生成",
    summary: "把零散工作产出结构化为一份周报",
    tags: ["周报", "效率"],
    model: "general",
    variables: [
      { name: "achievements", label: "本周成果", type: "textarea", required: true, placeholder: "逐条列出做了什么" },
      { name: "next_week", label: "下周计划", type: "textarea", required: false, placeholder: "下周打算做什么" },
      { name: "style", label: "风格", type: "select", options: ["简洁", "详尽", "突出价值"], required: false }
    ],
    prompt: "根据以下素材生成一份{{style}}风格的周报，分“本周完成 / 进行中 / 下周计划 / 风险与需要支持”四块，用量化结果代替模糊描述。\n\n本周成果：\n{{achievements}}\n\n下周计划：\n{{next_week}}"
  },
  {
    slug: "email-draft",
    title: "邮件起草",
    industry: "职场办公",
    task: "邮件起草",
    summary: "按目的与要点起草得体的工作邮件",
    tags: ["邮件", "沟通"],
    model: "general",
    variables: [
      { name: "recipient", label: "收件人", type: "text", required: true, placeholder: "如：客户张总" },
      { name: "purpose", label: "邮件目的", type: "select", options: ["请求", "告知", "道歉", "跟进", "拒绝"], required: true },
      { name: "key_points", label: "要点", type: "textarea", required: true, placeholder: "要表达的关键信息" },
      { name: "tone", label: "语气", type: "select", options: ["正式", "礼貌", "直接"], required: false }
    ],
    prompt: "起草一封发给{{recipient}}的邮件，目的为{{purpose}}，语气{{tone}}。\n包含清晰主题行、开场、要点（{{key_points}}）、明确下一步。正文不超过 200 字。"
  },
  {
    slug: "meeting-minutes",
    title: "会议纪要",
    industry: "职场办公",
    task: "会议纪要",
    summary: "把会议记录整理成结构化纪要",
    tags: ["会议", "整理"],
    model: "general",
    variables: [
      { name: "transcript", label: "会议记录", type: "textarea", required: true, placeholder: "粘贴原始记录/转录" },
      { name: "attendees", label: "参会人", type: "text", required: false, placeholder: "如：产品、研发、设计" },
      { name: "format", label: "输出结构", type: "multiselect", options: ["决议", "待办（含负责人/时限）", "开放问题", "下次会议议题"], required: false }
    ],
    prompt: "将以下会议记录整理为纪要，参会人：{{attendees}}。输出包含 {{format}}。\n待办必须含负责人与时限；决议与讨论区分清楚。\n\n记录：\n{{transcript}}"
  },

  // ===== 教育培训 =====
  {
    slug: "course-outline",
    title: "课程大纲",
    industry: "教育培训",
    task: "课程大纲",
    summary: "生成一门课程的结构化大纲",
    tags: ["课程", "设计"],
    model: "general",
    variables: [
      { name: "subject", label: "课程主题", type: "text", required: true, placeholder: "如：Python 数据分析" },
      { name: "level", label: "难度", type: "select", options: ["入门", "进阶", "高级"], required: true },
      { name: "weeks", label: "周数", type: "text", required: false, placeholder: "如：8 周" },
      { name: "goal", label: "学习目标", type: "textarea", required: false, placeholder: "学完能做什么" }
    ],
    prompt: "设计一门《{{subject}}》课程大纲，难度{{level}}，周期{{weeks}}。\n每章含：目标、核心知识点、实践项目、评估方式。总体目标：{{goal}}。"
  },
  {
    slug: "quiz-gen",
    title: "习题生成",
    industry: "教育培训",
    task: "习题生成",
    summary: "按主题与类型生成练习题与答案",
    tags: ["习题", "测评"],
    model: "general",
    variables: [
      { name: "topic", label: "知识点", type: "text", required: true, placeholder: "如：二叉树遍历" },
      { name: "type", label: "题型", type: "select", options: ["选择题", "简答题", "编程题"], required: true },
      { name: "count", label: "数量", type: "select", options: ["3", "5", "10"], required: false },
      { name: "difficulty", label: "难度", type: "select", options: ["易", "中", "难"], required: false }
    ],
    prompt: "生成 {{count}} 道关于《{{topic}}》的{{difficulty}}难度{{type}}，附参考答案与简要解析。题目表述清晰、无歧义。"
  },
  {
    slug: "grading-feedback",
    title: "批改反馈",
    industry: "教育培训",
    task: "批改反馈",
    summary: "对学生作答给出有建设性的批改与反馈",
    tags: ["批改", "反馈"],
    model: "general",
    variables: [
      { name: "answer", label: "学生作答", type: "textarea", required: true, placeholder: "粘贴学生答案" },
      { name: "rubric", label: "评分标准", type: "textarea", required: false, placeholder: "评分维度/要点" },
      { name: "level", label: "学段", type: "select", options: ["小学", "中学", "大学", "职业培训"], required: false }
    ],
    prompt: "请以{{level}}教师身份批改以下作答，依据评分标准（{{rubric}}）：先给总体评价，再指出具体优点与不足，最后给出可操作的改进建议。语气鼓励且具体。\n\n作答：\n{{answer}}"
  },

  // ===== 电商运营 =====
  {
    slug: "product-copy",
    title: "商品文案",
    industry: "电商运营",
    task: "商品文案",
    summary: "写具备转化力的商品卖点文案",
    tags: ["文案", "转化"],
    model: "general",
    variables: [
      { name: "product", label: "商品", type: "text", required: true, placeholder: "如：便携咖啡机" },
      { name: "platform", label: "平台", type: "select", options: ["淘宝", "抖音", "小红书", "独立站"], required: true },
      { name: "selling_point", label: "核心卖点", type: "textarea", required: true, placeholder: "列出 2-3 个卖点" },
      { name: "tone", label: "风格", type: "select", options: ["种草", "专业", "促销"], required: false }
    ],
    prompt: "为{{platform}}上的《{{product}}》写一篇{{tone}}风格商品文案，围绕卖点 {{selling_point}}。\n结构：抓眼标题 + 痛点引入 + 卖点展开 + 信任背书 + 行动号召。避免夸大与违禁词。"
  },
  {
    slug: "cs-script",
    title: "客服话术",
    industry: "电商运营",
    task: "客服话术",
    summary: "生成得体、能化解矛盾的客服回复",
    tags: ["客服", "话术"],
    model: "general",
    variables: [
      { name: "scenario", label: "场景", type: "select", options: ["退款", "差评", "物流", "咨询", "投诉"], required: true },
      { name: "customer_issue", label: "用户诉求", type: "textarea", required: true, placeholder: "用户说了什么" },
      { name: "brand_tone", label: "品牌语气", type: "select", options: ["温暖", "专业", "高效"], required: false }
    ],
    prompt: "你是对外客服。场景：{{scenario}}，用户诉求：{{customer_issue}}。\n请用{{brand_tone}}语气回复：先共情、再给明确解决方案与时限、最后留联系方式。不推诿、不承诺超出权限的事。"
  },
  {
    slug: "campaign-plan",
    title: "活动方案",
    industry: "电商运营",
    task: "活动方案",
    summary: "产出可执行的营销活动方案",
    tags: ["活动", "策划"],
    model: "general",
    variables: [
      { name: "goal", label: "活动目标", type: "text", required: true, placeholder: "如：新品首发拉新" },
      { name: "channel", label: "渠道", type: "multiselect", options: ["短视频", "社群", "直播", "私域", "信息流"], required: true },
      { name: "budget", label: "预算", type: "text", required: false, placeholder: "如：5 万" },
      { name: "duration", label: "周期", type: "text", required: false, placeholder: "如：2 周" }
    ],
    prompt: "制定一个营销活动方案，目标：{{goal}}；渠道：{{channel}}；预算：{{budget}}；周期：{{duration}}。\n包含：主题、节奏排期、各渠道动作、预算分配、KPI 与风险预案。"
  },

  // ===== 金融 =====
  {
    slug: "finance-edu",
    title: "理财科普",
    industry: "金融",
    task: "理财科普",
    summary: "把金融概念讲明白，并提示风险",
    tags: ["科普", "理财"],
    model: "general",
    variables: [
      { name: "concept", label: "概念", type: "text", required: true, placeholder: "如：复利" },
      { name: "audience", label: "读者", type: "select", options: ["小白", "有一定基础", "进阶投资者"], required: true },
      { name: "risk_note", label: "风险提示", type: "select", options: ["需要", "不需要"], required: false }
    ],
    prompt: "用通俗语言向{{audience}}解释“{{concept}}”，配生活化例子。{{risk_note}}请在文末给出投资风险提醒，强调非投资建议。"
  },
  {
    slug: "risk-assess",
    title: "风险评估",
    industry: "金融",
    task: "风险评估",
    summary: "对资产/投资组合做风险画像与建议",
    tags: ["风险", "配置"],
    model: "general",
    variables: [
      { name: "asset", label: "资产描述", type: "textarea", required: true, placeholder: "描述持仓/组合" },
      { name: "horizon", label: "投资期限", type: "select", options: ["短期<1年", "中期1-5年", "长期>5年"], required: true },
      { name: "risk_tolerance", label: "风险承受", type: "select", options: ["低", "中", "高"], required: true },
      { name: "output", label: "输出", type: "multiselect", options: ["风险点", "配置建议", "压力情景", "再平衡建议"], required: false }
    ],
    prompt: "你是持牌投资顾问（仅作教育用途）。资产：{{asset}}；期限{{horizon}}；风险承受{{risk_tolerance}}。\n请输出 {{output}}，并声明“非个性化投资建议”。"
  },
  {
    slug: "report-summary",
    title: "研报摘要",
    industry: "金融",
    task: "研报摘要",
    summary: "把长篇研报压缩成要点摘要",
    tags: ["摘要", "研究"],
    model: "general",
    variables: [
      { name: "report", label: "研报内容", type: "textarea", required: true, placeholder: "粘贴研报正文" },
      { name: "focus", label: "关注重点", type: "multiselect", options: ["核心结论", "数据亮点", "风险提示", "投资建议"], required: true },
      { name: "length", label: "篇幅", type: "select", options: ["一段话", "要点列表", "详细摘要"], required: false }
    ],
    prompt: "将以下研报摘要为{{length}}，重点覆盖 {{focus}}，保留关键数字与出处。\n\n研报：\n{{report}}"
  },

  // ===== 写作创作 =====
  {
    slug: "catchy-title",
    title: "爆款标题",
    industry: "写作创作",
    task: "爆款标题",
    summary: "批量生成吸引点击的标题",
    tags: ["标题", "流量"],
    model: "general",
    variables: [
      { name: "topic", label: "主题", type: "text", required: true, placeholder: "如：早起习惯" },
      { name: "platform", label: "平台", type: "select", options: ["公众号", "小红书", "抖音", "知乎"], required: true },
      { name: "count", label: "数量", type: "select", options: ["5", "10", "20"], required: false },
      { name: "style", label: "风格", type: "multiselect", options: ["悬念", "数字", "情绪", "干货"], required: false }
    ],
    prompt: "为{{platform}}上关于《{{topic}}》的内容生成{{count}}个标题，风格偏向 {{style}}。\n标题要有点击欲、与平台调性匹配、不标题党造假。"
  },
  {
    slug: "script-outline",
    title: "脚本大纲",
    industry: "写作创作",
    task: "脚本大纲",
    summary: "生成短视频/直播/播客的脚本结构",
    tags: ["脚本", "内容"],
    model: "general",
    variables: [
      { name: "theme", label: "主题", type: "text", required: true, placeholder: "如：职场沟通技巧" },
      { name: "format", label: "形式", type: "select", options: ["短视频", "直播", "播客"], required: true },
      { name: "episodes", label: "集数/时长", type: "text", required: false, placeholder: "如：单集 3 分钟 / 共 5 集" }
    ],
    prompt: "为{{format}}《{{theme}}》写脚本大纲，规模{{episodes}}。\n包含：钩子开场、分段结构、转折点、结尾引导（关注/转化）。节奏明快。"
  },
  {
    slug: "style-rewrite",
    title: "风格改写",
    industry: "写作创作",
    task: "风格改写",
    summary: "把文本改写成指定语气/风格",
    tags: ["改写", "润色"],
    model: "general",
    variables: [
      { name: "text", label: "原文", type: "textarea", required: true, placeholder: "粘贴要改写的文本" },
      { name: "target_style", label: "目标风格", type: "select", options: ["小红书风", "严肃新闻", "口语化", "文言", "极简"], required: true },
      { name: "keep", label: "保留", type: "select", options: ["原意", "长度", "原意与长度"], required: false }
    ],
    prompt: "将下面文本改写为{{target_style}}风格，{{keep}}。\n\n文本：\n{{text}}"
  },

  // ===== 编程开发（兜底/自身用） =====
  {
    slug: "code-review",
    title: "代码审查",
    industry: "编程开发",
    task: "代码审查",
    summary: "让 AI 扮演资深工程师，按指定关注点审查代码",
    tags: ["python", "go", "typescript", "security", "performance"],
    model: "general",
    variables: [
      { name: "language", label: "编程语言", type: "select", options: ["Python", "Go", "TypeScript", "Java", "Rust"], required: true },
      { name: "focus_areas", label: "关注重点", type: "multiselect", options: ["性能", "安全", "可读性", "边界情况", "测试覆盖"], required: false },
      { name: "code", label: "待审查代码", type: "textarea", required: true, placeholder: "在此粘贴代码" }
    ],
    prompt: "你是一名资深 {{language}} 工程师。请审查下面这段代码，重点关注 {{focus_areas}}。\n输出：问题定位、严重程度、修改建议、修改后的代码片段。\n\n代码：\n{{code}}"
  },
  {
    slug: "debug-fix",
    title: "调试修复",
    industry: "编程开发",
    task: "调试修复",
    summary: "根据报错与代码定位并修复 bug",
    tags: ["debug", "fix"],
    model: "general",
    variables: [
      { name: "language", label: "编程语言", type: "select", options: ["Python", "Go", "TypeScript", "Java", "Rust"], required: true },
      { name: "error", label: "报错信息", type: "textarea", required: true, placeholder: "粘贴完整报错" },
      { name: "code", label: "相关代码", type: "textarea", required: true, placeholder: "粘贴相关代码" },
      { name: "goal", label: "目标", type: "select", options: ["最小修复", "根因分析+修复", "顺带重构"], required: false }
    ],
    prompt: "你是{{language}}调试专家。报错：\n{{error}}\n\n相关代码：\n{{code}}\n\n请按{{goal}}给出方案：先解释根因，再给修复后代码，并指出如何避免。"
  },
  {
    slug: "refactor",
    title: "重构优化",
    industry: "编程开发",
    task: "重构优化",
    summary: "在保持行为不变的前提下重构提升代码质量",
    tags: ["refactor", "clean"],
    model: "general",
    variables: [
      { name: "language", label: "编程语言", type: "select", options: ["Python", "Go", "TypeScript", "Java", "Rust"], required: true },
      { name: "code", label: "待重构代码", type: "textarea", required: true, placeholder: "在此粘贴代码" },
      { name: "goal", label: "重构目标", type: "multiselect", options: ["可读性", "性能", "去掉重复", "更易测试", "解耦"], required: false }
    ],
    prompt: "你是{{language}}架构师。请重构以下代码，目标 {{goal}}，保持外部行为不变。\n输出：重构后代码 + 改动说明 + 注意事项。\n\n代码：\n{{code}}"
  },

  // ===== 法律（补充）=====
  {
    slug: "legal-labor-contract",
    title: "劳动合同审查",
    industry: "法律",
    task: "合同审查",
    summary: "以劳动者或用人单位视角审查劳动合同，输出风险清单与可替换条款",
    tags: ["劳动", "合同", "风险"],
    model: "general",
    variables: [
      { name: "jurisdiction", label: "适用法域", type: "select", options: ["中国大陆", "中国香港", "美国", "欧盟"], required: true },
      { name: "party", label: "代表方", type: "select", options: ["劳动者", "用人单位"], required: true },
      { name: "contract_text", label: "合同文本", type: "textarea", required: true, placeholder: "粘贴合同全文" },
      { name: "concerns", label: "重点审查", type: "multiselect", options: ["试用期", "加班费", "竞业限制", "社保", "解除条件"], required: false }
    ],
    prompt: "你是一名{{jurisdiction}}劳动法律师，代表{{party}}审查以下劳动合同。\n\n合同文本：\n{{contract_text}}\n\n请重点审查：{{concerns}}。\n输出结构化报告：\n1. 风险摘要（高/中/低）\n2. 逐条问题（条款位置、违规点、法律依据）\n3. 修改建议（可直接替换的条款表述）\n4. 谈判要点\n要求：引用具体法条，区分强制性与约定性条款，提示协商空间。"
  },
  {
    slug: "legal-divorce-agreement",
    title: "离婚协议起草",
    industry: "法律",
    task: "文书起草",
    summary: "起草可执行、无歧义的离婚协议书，含抚养与财产分割",
    tags: ["婚姻", "文书", "协议"],
    model: "general",
    variables: [
      { name: "jurisdiction", label: "适用法域", type: "select", options: ["中国大陆", "中国香港", "美国", "欧盟"], required: true },
      { name: "assets", label: "涉及财产", type: "multiselect", options: ["房产", "存款", "股权", "车辆", "债务"], required: true },
      { name: "has_child", label: "子女抚养", type: "select", options: ["有", "无"], required: true },
      { name: "notes", label: "特别说明", type: "textarea", required: false, placeholder: "如特殊财产、抚养安排偏好" }
    ],
    prompt: "你是{{jurisdiction}}婚姻家事律师，起草一份离婚协议书。\n涉及财产：{{assets}}；子女抚养：{{has_child}}。\n特别说明：{{notes}}\n\n请按结构起草：\n一、自愿离婚意思表示\n二、子女抚养（抚养权/抚养费/探视权）\n三、财产分割（逐项列明归属与过户）\n四、债务承担\n五、违约责任与生效\n要求：条款可执行、无歧义；对敏感条款给出提示。"
  },

  // ===== 医疗健康（补充）=====
  {
    slug: "medical-report-interpret",
    title: "体检报告解读",
    industry: "医疗健康",
    task: "报告解读",
    summary: "把体检异常指标翻译成通俗解释与就医分级建议（非诊断）",
    tags: ["体检", "科普", "就医"],
    model: "general",
    variables: [
      { name: "report", label: "报告内容", type: "textarea", required: true, placeholder: "粘贴异常指标或全文" },
      { name: "age", label: "年龄区间", type: "select", options: ["30以下", "30-45", "45-60", "60以上"], required: true },
      { name: "concern", label: "特别关切", type: "textarea", required: false, placeholder: "如某项指标特别担心" }
    ],
    prompt: "你是一名全科医生，帮助用户解读体检报告（非诊断，仅科普与就医建议）。\n报告：\n{{report}}\n用户年龄区间：{{age}}；特别关切：{{concern}}\n\n输出：\n1. 异常指标清单（指标名、数值、参考范围、偏离方向）\n2. 可能原因（通俗解释，不吓人）\n3. 风险分级（观察/复查/尽快就医）\n4. 生活建议\n免责声明：本解读不能替代医生诊断。"
  },
  {
    slug: "medical-medication-guide",
    title: "用药咨询结构化",
    industry: "医疗健康",
    task: "用药科普",
    summary: "提供药品作用、用法、副作用与禁忌的结构化科普（非处方建议）",
    tags: ["用药", "科普", "药师"],
    model: "general",
    variables: [
      { name: "drug", label: "药品/成分", type: "text", required: true, placeholder: "如：布洛芬" },
      { name: "condition", label: "适用情况", type: "text", required: true, placeholder: "如：退烧" },
      { name: "age_group", label: "适用人群", type: "select", options: ["儿童", "成人", "老人", "孕产妇"], required: true },
      { name: "allergies", label: "过敏史", type: "text", required: false, placeholder: "如：青霉素过敏" }
    ],
    prompt: "你是药师，提供用药科普（非处方建议，提醒遵医嘱）。\n药品/成分：{{drug}}；适用情况：{{condition}}；人群：{{age_group}}；过敏史：{{allergies}}\n\n输出：\n1. 作用机制（一句话）\n2. 用法用量要点\n3. 常见副作用与应对\n4. 禁忌与相互作用\n5. 何时需就医\n强调：具体用药请遵医嘱。"
  },

  // ===== 职场办公（补充）=====
  {
    slug: "office-weekly-report",
    title: "周报生成",
    industry: "职场办公",
    task: "写作辅助",
    summary: "把零散工作整理成动作+结果+数据的专业周报",
    tags: ["周报", "写作", "职场"],
    model: "general",
    variables: [
      { name: "achievements", label: "本周完成", type: "textarea", required: true, placeholder: "逐条粘贴零散工作" },
      { name: "next_week", label: "下周计划", type: "textarea", required: true, placeholder: "打算做的事" },
      { name: "blocker", label: "是否有阻塞", type: "select", options: ["有", "无"], required: true },
      { name: "tone", label: "风格", type: "select", options: ["简洁", "详尽", "向上管理"], required: false }
    ],
    prompt: "你是职场写作教练，帮我把零散工作整理成专业周报。\n本周完成：{{achievements}}\n下周计划：{{next_week}}\n是否有阻塞：{{blocker}}\n风格：{{tone}}\n\n输出 Markdown 周报：\n# 本周工作总结\n- 用「动作+结果+数据」句式，每条一行\n# 下周计划\n- 按优先级排序，标注目标\n# 风险与需支持\n要求：去掉流水账，突出价值；数字量化；语气{{tone}}。"
  },
  {
    slug: "office-email-chase",
    title: "催办邮件",
    industry: "职场办公",
    task: "写作辅助",
    summary: "写一封礼貌但不软弱、明确时限的催办邮件",
    tags: ["邮件", "催办", "职场"],
    model: "general",
    variables: [
      { name: "recipient", label: "收件人", type: "text", required: true, placeholder: "如：张总" },
      { name: "matter", label: "事项", type: "text", required: true, placeholder: "如：合同回签" },
      { name: "deadline", label: "时限", type: "select", options: ["紧急", "本周", "无硬性"], required: true },
      { name: "relationship", label: "关系", type: "select", options: ["平级", "上级", "外部", "下属"], required: true }
    ],
    prompt: "你是商务邮件写作专家，写一封得体的催办邮件。\n收件人：{{recipient}}；事项：{{matter}}；时限：{{deadline}}；关系：{{relationship}}\n\n输出：主题行 + 正文（3-5 句）。\n要求：礼貌但不软弱，明确诉求与时限，给对方台阶（如提供选项），避免指责语气。"
  },

  // ===== 教育培训（补充）=====
  {
    slug: "edu-wrong-question",
    title: "错题讲解",
    industry: "教育培训",
    task: "教学辅助",
    summary: "用学生能懂的语言讲透一道错题的思路与变式",
    tags: ["错题", "讲解", "教学"],
    model: "general",
    variables: [
      { name: "subject", label: "学科", type: "select", options: ["数学", "物理", "化学", "语文", "英语", "其他"], required: true },
      { name: "question", label: "题目/作答", type: "textarea", required: true, placeholder: "粘贴题目与学生作答" },
      { name: "student_level", label: "学段", type: "select", options: ["小学", "初中", "高中", "大学"], required: true }
    ],
    prompt: "你是{{subject}}老师，给{{student_level}}学生讲一道错题。\n题目/作答：\n{{question}}\n\n输出：\n1. 错在哪（点出具体误区）\n2. 正确思路（分步，用学生能懂的语言）\n3. 关键知识点\n4. 同类题变式 1 道 + 提示\n要求：先共情不打击，再讲方法而非只给答案。"
  },
  {
    slug: "edu-lesson-plan",
    title: "教案设计",
    industry: "教育培训",
    task: "教学辅助",
    summary: "生成含目标、重难点、过程与评估的可落地教案",
    tags: ["教案", "备课", "教学"],
    model: "general",
    variables: [
      { name: "subject", label: "学科", type: "select", options: ["语文", "数学", "英语", "物理", "其他"], required: true },
      { name: "grade", label: "年级", type: "text", required: true, placeholder: "如：初二" },
      { name: "topic", label: "主题", type: "text", required: true, placeholder: "如：勾股定理" },
      { name: "duration", label: "时长", type: "select", options: ["1课时", "2课时", "单元"], required: true }
    ],
    prompt: "你是{{subject}}教研员，设计一节{{grade}}的教案，主题《{{topic}}》，时长{{duration}}。\n\n输出：\n一、教学目标（知识/能力/情感）\n二、重难点\n三、教学过程（导入-新授-活动-小结-作业，含时间分配）\n四、评估方式\n五、板书设计\n要求：可落地、有互动环节。"
  },

  // ===== 电商运营（补充）=====
  {
    slug: "ecom-xhs-seeding",
    title: "小红书种草",
    industry: "电商运营",
    task: "内容创作",
    summary: "写像真人分享、有钩子有标签的小红书种草笔记",
    tags: ["小红书", "种草", "文案"],
    model: "general",
    variables: [
      { name: "product", label: "产品", type: "text", required: true, placeholder: "如：某保湿精华" },
      { name: "audience", label: "目标人群", type: "select", options: ["学生党", "上班族", "宝妈", "精致党", "通用"], required: true },
      { name: "tone", label: "风格", type: "select", options: ["真诚分享", "测评向", "情绪价值", "干货"], required: false }
    ],
    prompt: "你是小红书爆款文案写手，为一款产品写种草笔记。\n产品：{{product}}；目标人群：{{audience}}；风格：{{tone}}\n\n输出：\n- 标题（带 emoji、有钩子，≤20字）\n- 正文（分段，每段带 emoji，含痛点-体验-效果-呼吁，自然植入）\n- 5-8 个话题标签\n要求：像真人分享不像广告，避免绝对化用语。"
  },
  {
    slug: "ecom-live-script",
    title: "直播话术",
    industry: "电商运营",
    task: "内容创作",
    summary: "按直播阶段写有节奏、有互动指令的口播稿",
    tags: ["直播", "话术", "带货"],
    model: "general",
    variables: [
      { name: "product", label: "产品", type: "text", required: true, placeholder: "如：空气炸锅" },
      { name: "stage", label: "阶段", type: "select", options: ["开场留人", "痛点塑造", "卖点讲解", "逼单", "答疑"], required: true },
      { name: "highlights", label: "亮点", type: "text", required: false, placeholder: "如：不加油更健康" }
    ],
    prompt: "你是直播带货话术策划，写一段{{stage}}阶段的直播口播。\n产品：{{product}}；亮点：{{highlights}}\n\n输出：30-60 秒口播稿（口语化、有节奏、含互动指令如扣「想要」）。\n要求：对应阶段目标（留人/塑品/转化），有紧迫感但不夸大。"
  },

  // ===== 金融（补充）=====
  {
    slug: "finance-fund-plan",
    title: "基金定投计划",
    industry: "金融",
    task: "理财规划",
    summary: "按风险与期限给出基金定投配置思路（科普非建议）",
    tags: ["定投", "基金", "理财"],
    model: "general",
    variables: [
      { name: "amount", label: "每月可投", type: "text", required: true, placeholder: "如：2000元" },
      { name: "horizon", label: "期限", type: "select", options: ["1-3年", "3-5年", "5年以上"], required: true },
      { name: "risk", label: "风险偏好", type: "select", options: ["保守", "平衡", "进取"], required: true },
      { name: "experience", label: "经验", type: "select", options: ["新手", "有经验"], required: false }
    ],
    prompt: "你是理财规划师，制定基金定投计划（科普，非投资建议）。\n每月可投：{{amount}}；期限：{{horizon}}；风险偏好：{{risk}}；经验：{{experience}}\n\n输出：\n1. 配置思路（股债比逻辑）\n2. 基金类型建议（宽基/行业/债基角色）\n3. 定投频率与再平衡\n4. 风险提示与误区\n声明：市场有风险，仅供参考。"
  },
  {
    slug: "finance-insurance-compare",
    title: "保险方案对比",
    industry: "金融",
    task: "理财规划",
    summary: "按角色与预算对比多套保障方案并给配置顺序",
    tags: ["保险", "对比", "规划"],
    model: "general",
    variables: [
      { name: "role", label: "角色", type: "select", options: ["家庭支柱", "新手父母", "单身", "临近退休"], required: true },
      { name: "budget", label: "年预算", type: "text", required: true, placeholder: "如：1万元" },
      { name: "concern", label: "关注", type: "multiselect", options: ["重疾", "医疗", "寿险", "意外", "养老"], required: true }
    ],
    prompt: "你是保险规划师，做方案对比（科普，非代销）。\n角色：{{role}}；年预算：{{budget}}；关注：{{concern}}\n\n输出：\n1. 保障优先级排序与理由\n2. 2-3 套方案对比表（保额/保费/适合谁）\n3. 配置顺序建议\n4. 常见坑\n声明：按需配置，货比三家。"
  },

  // ===== 写作创作（补充）=====
  {
    slug: "writing-novel-outline",
    title: "小说大纲",
    industry: "写作创作",
    task: "创作辅助",
    summary: "构思有戏剧张力的人物、三幕结构与章节节拍",
    tags: ["小说", "大纲", "创作"],
    model: "general",
    variables: [
      { name: "genre", label: "类型", type: "select", options: ["都市", "悬疑", "言情", "科幻", "历史", "其他"], required: true },
      { name: "theme", label: "核心主题", type: "text", required: true, placeholder: "如：复仇与和解" },
      { name: "length", label: "篇幅", type: "select", options: ["短篇", "中篇", "长篇"], required: true }
    ],
    prompt: "你是小说创作教练，帮构思《{{genre}}》大纲。\n核心主题：{{theme}}；篇幅：{{length}}\n\n输出：\n一、一句话梗概\n二、人物小传（主角欲望/缺陷/弧光）\n三、三幕结构（引发事件-中点-高潮）\n四、核心冲突与悬念\n五、章节节拍（{{length}}粒度）\n要求：有戏剧张力，避免套路。"
  },
  {
    slug: "writing-wechat-topic",
    title: "公众号选题",
    industry: "写作创作",
    task: "创作辅助",
    summary: "按账号定位与目标产出可分享的选题清单",
    tags: ["公众号", "选题", "内容"],
    model: "general",
    variables: [
      { name: "account", label: "账号定位", type: "text", required: true, placeholder: "如：职场成长类" },
      { name: "audience", label: "受众", type: "text", required: true, placeholder: "如：25-35上班族" },
      { name: "goal", label: "目标", type: "select", options: ["涨粉", "转化", "品牌", "互动"], required: true }
    ],
    prompt: "你是公众号内容策划，为账号产出选题。\n账号定位：{{account}}；受众：{{audience}}；目标：{{goal}}\n\n输出 10 个选题：每条含「标题+角度+为什么值得写+预估类型（干货/故事/观点）」。\n要求：贴合受众痛点，有分享欲，避免自嗨。"
  },

  // ===== 编程开发（补充）=====
  {
    slug: "dev-sql-optimize",
    title: "SQL 优化",
    industry: "编程开发",
    task: "调试修复",
    summary: "分析瓶颈并给出优化后 SQL 与索引建议",
    tags: ["SQL", "性能", "数据库"],
    model: "general",
    variables: [
      { name: "dialect", label: "数据库", type: "select", options: ["MySQL", "PostgreSQL", "ClickHouse", "其他"], required: true },
      { name: "sql", label: "SQL", type: "textarea", required: true, placeholder: "粘贴待优化 SQL" },
      { name: "symptom", label: "症状", type: "select", options: ["慢查询", "死锁", "全表扫描", "其他"], required: true }
    ],
    prompt: "你是{{dialect}}数据库性能专家，优化以下 SQL。\nSQL：\n{{sql}}\n症状：{{symptom}}\n\n输出：\n1. 性能瓶颈分析（执行计划要点）\n2. 优化后 SQL\n3. 索引/结构建议\n4. 验证方法\n要求：给出可落地的具体改法。"
  },
  {
    slug: "dev-api-design",
    title: "API 设计评审",
    industry: "编程开发",
    task: "架构设计",
    summary: "评审 API 划分、结构与版本鉴权，给最佳实践",
    tags: ["API", "架构", "评审"],
    model: "general",
    variables: [
      { name: "language", label: "后端语言", type: "select", options: ["Python", "Go", "TypeScript", "Java", "Rust"], required: true },
      { name: "scenario", label: "场景描述", type: "textarea", required: true, placeholder: "描述业务与实体关系" },
      { name: "style", label: "风格", type: "select", options: ["REST", "GraphQL", "gRPC"], required: true }
    ],
    prompt: "你是{{language}}后端架构师，评审 API 设计（风格：{{style}}）。\n场景：\n{{scenario}}\n\n输出：\n1. 资源/接口划分建议\n2. 请求/响应结构示例（含字段命名、状态码）\n3. 版本与鉴权建议\n4. 易错点\n要求：符合该风格最佳实践。"
  },

  // ===== 法律（继续扩展）=====
  {
    slug: "legal-borrow-agreement",
    title: "借条/欠款协议",
    industry: "法律",
    task: "文书起草",
    summary: "起草可执行、合法利率内的借款协议，提示无效条款风险",
    tags: ["借贷", "合同", "文书"],
    model: "general",
    variables: [
      { name: "jurisdiction", label: "适用法域", type: "select", options: ["中国大陆", "中国香港", "美国", "欧盟"], required: true },
      { name: "borrower", label: "借款方", type: "text", required: true, placeholder: "如：甲方（出借人）/乙方（借款人）" },
      { name: "amount", label: "金额", type: "text", required: true, placeholder: "如：10 万元" },
      { name: "term", label: "期限", type: "text", required: true, placeholder: "如：12 个月" },
      { name: "interest", label: "是否计息", type: "select", options: ["计息", "不计息"], required: true },
      { name: "collateral", label: "担保", type: "select", options: ["无", "抵押", "质押", "保证人"], required: false }
    ],
    prompt: "你是{{jurisdiction}}民商事律师，起草一份借款协议。借款方关系：{{borrower}}；金额：{{amount}}；期限：{{term}}；计息：{{interest}}；担保：{{collateral}}。\n输出结构：\n一、借款金额与交付方式\n二、期限与还款方式\n三、利息（计息时写清计算与上限，并提示合法利率上限）\n四、担保/抵押（如有，写清标的与登记）\n五、违约责任\n六、争议解决与生效\n要求：条款可执行、无歧义；对超限利息与可能导致无效的条款给出明确提示。"
  },
  {
    slug: "legal-will",
    title: "遗嘱要点起草",
    industry: "法律",
    task: "文书起草",
    summary: "协助梳理遗嘱内容与法定形式要件（草稿非正式文书）",
    tags: ["遗嘱", "继承", "家事"],
    model: "general",
    variables: [
      { name: "jurisdiction", label: "适用法域", type: "select", options: ["中国大陆", "中国香港", "美国", "欧盟"], required: true },
      { name: "estate", label: "涉及财产", type: "multiselect", options: ["房产", "存款", "股权", "其他"], required: true },
      { name: "heir", label: "继承安排", type: "textarea", required: true, placeholder: "各继承人及份额/特留份意愿" },
      { name: "special", label: "特别说明", type: "textarea", required: false, placeholder: "如监护安排、宠物、特定遗愿" }
    ],
    prompt: "你是{{jurisdiction}}家事律师，协助起草自书遗嘱的内容要点（提示：正式遗嘱须符合法定形式，本稿仅为内容框架）。\n财产：{{estate}}；继承安排：{{heir}}；特别说明：{{special}}\n\n输出：\n一、财产清单与归属\n二、债务处理\n三、执行人/监护人指定\n四、备注（附该法域遗嘱形式要件提示，如自书/见证/公证）\n强调：最终以符合法定形式为准，必要时办理公证。"
  },
  {
    slug: "legal-pleading",
    title: "答辩状/诉讼文书",
    industry: "法律",
    task: "文书起草",
    summary: "按原告诉求逐条组织答辩思路与文书框架",
    tags: ["诉讼", "答辩", "文书"],
    model: "general",
    variables: [
      { name: "jurisdiction", label: "适用法域", type: "select", options: ["中国大陆", "中国香港", "美国", "欧盟"], required: true },
      { name: "case_type", label: "案件类型", type: "select", options: ["民事", "行政", "其他"], required: true },
      { name: "claim", label: "原告诉求", type: "textarea", required: true, placeholder: "粘贴诉讼请求" },
      { name: "evidence", label: "我方证据", type: "textarea", required: false, placeholder: "关键证据清单" },
      { name: "defense", label: "答辩要点", type: "textarea", required: true, placeholder: "我方核心抗辩" }
    ],
    prompt: "你是{{jurisdiction}}诉讼律师，代写答辩思路与文书框架。案件：{{case_type}}；原告诉求：{{claim}}；我方证据：{{evidence}}；答辩要点：{{defense}}。\n\n输出：\n一、程序性质疑（如管辖/主体，如有）\n二、事实答辩（逐条回应原告诉求）\n三、法律意见（引用法条）\n四、证据清单与对应关系\n五、答辩请求\n要求：围绕争议焦点、逻辑清晰、不遗漏关键抗辩。"
  },
  {
    slug: "legal-company-bylaw",
    title: "公司章程要点",
    industry: "法律",
    task: "文书起草",
    summary: "梳理有限公司章程核心条款与自定义空间",
    tags: ["公司", "治理", "股权"],
    model: "general",
    variables: [
      { name: "jurisdiction", label: "适用法域", type: "select", options: ["中国大陆", "中国香港", "美国", "欧盟"], required: true },
      { name: "entity", label: "主体类型", type: "select", options: ["有限责任公司", "股份有限公司", "合伙"], required: true },
      { name: "focus", label: "关注重点", type: "multiselect", options: ["股权结构", "治理权限", "分红", "退出机制"], required: true }
    ],
    prompt: "你是{{jurisdiction}}公司法律师，起草公司章程要点框架。主体：{{entity}}；关注：{{focus}}。\n\n输出：\n1. 核心条款清单（股东会/董事/表决权/分红/股权转让与退出/僵局解决）\n2. 各条款「默认规则 vs 自定义空间」提示\n3. 常见雷区（如一股独大、退出无约定）\n提示：章程需与股东协议配套，正式文本由法务复核。"
  },
  {
    slug: "legal-labor-arbitration",
    title: "劳动仲裁申请",
    industry: "法律",
    task: "文书起草",
    summary: "组织仲裁请求、事实理由与证据清单框架",
    tags: ["劳动", "仲裁", "维权"],
    model: "general",
    variables: [
      { name: "jurisdiction", label: "适用法域", type: "select", options: ["中国大陆", "中国香港", "美国", "欧盟"], required: true },
      { name: "claim", label: "仲裁请求", type: "textarea", required: true, placeholder: "如：支付拖欠工资/经济补偿" },
      { name: "fact", label: "事实经过", type: "textarea", required: true, placeholder: "按时间线描述" },
      { name: "evidence", label: "证据", type: "textarea", required: false, placeholder: "劳动合同/工资条/聊天记录等" }
    ],
    prompt: "你是劳动法律师，帮写仲裁申请书框架。请求：{{claim}}；事实：{{fact}}；证据：{{evidence}}。\n\n输出：\n一、申请人/被申请人信息（占位）\n二、仲裁请求（具体、可支持）\n三、事实与理由（按时间线，对应请求）\n四、证据清单（名称/证明目的）\n五、法律依据\n提示：注意仲裁时效与管辖，证据尽量原件。"
  },

  // ===== 医疗健康（继续扩展）=====
  {
    slug: "medical-fitness",
    title: "健身训练计划",
    industry: "医疗健康",
    task: "健身规划",
    summary: "按目标与器材定制分化训练，含热身拉伸与饮食配合",
    tags: ["健身", "训练", "教练"],
    model: "general",
    variables: [
      { name: "goal", label: "训练目标", type: "select", options: ["减脂", "增肌", "塑形", "体能"], required: true },
      { name: "level", label: "训练水平", type: "select", options: ["新手", "进阶", "资深"], required: true },
      { name: "days", label: "每周天数", type: "select", options: ["3", "4", "5", "6"], required: true },
      { name: "equipment", label: "器材条件", type: "select", options: ["无器械", "家用小器械", "健身房"], required: true },
      { name: "limit", label: "伤病限制", type: "textarea", required: false, placeholder: "如：膝盖不适" }
    ],
    prompt: "你是持证健身教练，制定{{level}}的{{goal}}训练计划，每周{{days}}天，器材：{{equipment}}，限制：{{limit}}。\n\n输出：\n1. 每周分化安排（训练日/动作/组次/休息日）\n2. 热身与拉伸流程\n3. 进阶建议（何时加量）\n4. 饮食配合要点\n5. 风险提示（循序渐进、疼痛即停）\n非医疗建议，伤病请咨询医生。"
  },
  {
    slug: "medical-nutrition",
    title: "饮食营养方案",
    industry: "医疗健康",
    task: "营养规划",
    summary: "按目标与忌口给出三餐示例与营养结构",
    tags: ["营养", "饮食", "食谱"],
    model: "general",
    variables: [
      { name: "goal", label: "饮食目标", type: "select", options: ["减脂", "增肌", "控糖", "均衡"], required: true },
      { name: "preference", label: "饮食偏好", type: "select", options: ["荤食", "素食", "低盐", "低糖", "无特定"], required: true },
      { name: "allergy", label: "过敏/忌口", type: "text", required: false, placeholder: "如：海鲜过敏" },
      { name: "calorie", label: "目标热量", type: "text", required: false, placeholder: "如：1800 kcal" }
    ],
    prompt: "你是注册营养师，给{{preference}}饮食的{{goal}}方案，忌口：{{allergy}}，目标热量：{{calorie}}。\n\n输出：\n1. 一日三餐示例（食材与大致份量）\n2. 营养结构（蛋白/碳水/脂肪比例）\n3. 采购清单\n4. 外食替换建议\n5. 注意事项\n强调：个体差异，慢病需遵医嘱。"
  },
  {
    slug: "medical-visit-prep",
    title: "就医准备清单",
    industry: "医疗健康",
    task: "就医辅助",
    summary: "帮用户整理就诊资料与高效问诊模板（非诊断）",
    tags: ["就诊", "准备", "就医"],
    model: "general",
    variables: [
      { name: "dept", label: "就诊科室", type: "text", required: true, placeholder: "如：内分泌科" },
      { name: "symptom", label: "症状描述", type: "textarea", required: true, placeholder: "主要症状与持续时间" },
      { name: "history", label: "既往史", type: "textarea", required: false, placeholder: "用药/过敏/病史" },
      { name: "question", label: "想问医生", type: "textarea", required: false, placeholder: "最关心的几个问题" }
    ],
    prompt: "你是医务社工，帮用户准备就诊。拟去{{dept}}；症状：{{symptom}}；病史：{{history}}；想问：{{question}}。\n\n输出：\n① 就诊前准备（资料/检查单/用药清单）\n② 向医生高效描述病情的模板\n③ 务必询问的 5 个问题\n④ 可能的检查与费用预期提示\n非诊断，仅为沟通辅助。"
  },
  {
    slug: "medical-baby",
    title: "母婴育儿问答",
    industry: "医疗健康",
    task: "育儿科普",
    summary: "按宝宝月龄解答育儿问题并提示危险信号",
    tags: ["育儿", "母婴", "科普"],
    model: "general",
    variables: [
      { name: "age", label: "宝宝月龄", type: "text", required: true, placeholder: "如：8 个月" },
      { name: "topic", label: "问题", type: "textarea", required: true, placeholder: "描述具体困扰" },
      { name: "concern", label: "特别担心", type: "text", required: false, placeholder: "如：睡眠" }
    ],
    prompt: "你是儿科科普作者，解答{{age}}宝宝的育儿问题。问题：{{topic}}；特别担心：{{concern}}。\n\n输出：\n1. 科学解释（结合该月龄发育特点）\n2. 可操作做法\n3. 危险信号（需就医）\n4. 常见误区\n强调：个体差异，异常及时就医。"
  },
  {
    slug: "medical-chronic",
    title: "慢病管理计划",
    industry: "医疗健康",
    task: "健康管理",
    summary: "按病种给出监测、用药提醒与生活方式处方（非医嘱）",
    tags: ["慢病", "管理", "健康"],
    model: "general",
    variables: [
      { name: "condition", label: "慢病类型", type: "text", required: true, placeholder: "如：2 型糖尿病" },
      { name: "meds", label: "当前用药", type: "text", required: false, placeholder: "如：二甲双胍" },
      { name: "goal", label: "管理目标", type: "select", options: ["控指标", "减药", "提升生活质量"], required: true },
      { name: "stage", label: "阶段", type: "select", options: ["新确诊", "长期管理"], required: true }
    ],
    prompt: "你是慢病管理师，做{{condition}}管理计划（非医嘱替代）。用药：{{meds}}；目标：{{goal}}；阶段：{{stage}}。\n\n输出：\n1. 监测指标与频率\n2. 用药提醒要点\n3. 饮食运动处方\n4. 并发症预警信号\n5. 随访节奏\n强调：遵医嘱、不擅自调药。"
  },

  // ===== 职场办公（继续扩展）=====
  {
    slug: "office-resume",
    title: "简历优化",
    industry: "职场办公",
    task: "写作辅助",
    summary: "诊断简历问题并重写量化的经历 bullet",
    tags: ["简历", "求职", "写作"],
    model: "general",
    variables: [
      { name: "target_role", label: "目标岗位", type: "text", required: true, placeholder: "如：后端工程师" },
      { name: "experience", label: "工作经历", type: "textarea", required: true, placeholder: "粘贴现有经历" },
      { name: "level", label: "求职阶段", type: "select", options: ["校招", "社招初级", "资深"], required: true },
      { name: "highlight", label: "想突出", type: "text", required: false, placeholder: "如：高并发经验" }
    ],
    prompt: "你是简历顾问，优化一份投向{{target_role}}的简历（{{level}}）。现有经历：{{experience}}；想突出：{{highlight}}。\n\n输出：\n① 简历诊断（问题清单）\n② 改写后的经历 bullet（动作+量化结果）\n③ 关键词与 ATS 友好建议\n④ 可删减项\n要求：真实不夸大。"
  },
  {
    slug: "office-performance",
    title: "述职报告",
    industry: "职场办公",
    task: "写作辅助",
    summary: "结果导向的述职：目标达成、方法论、下期规划",
    tags: ["述职", "汇报", "向上"],
    model: "general",
    variables: [
      { name: "period", label: "周期", type: "text", required: true, placeholder: "如：2026 H1" },
      { name: "achievements", label: "成果", type: "textarea", required: true, placeholder: "做了什么" },
      { name: "metric", label: "核心指标", type: "text", required: true, placeholder: "如：DAU +30%" },
      { name: "next", label: "下一步", type: "textarea", required: false, placeholder: "下期方向" }
    ],
    prompt: "帮写一份{{period}}述职报告。成果：{{achievements}}；核心指标：{{metric}}；下一步：{{next}}。\n\n输出：\n一、目标回顾与达成\n二、关键成果（量化）\n三、方法论沉淀\n四、不足与改进\n五、下期规划\n语气：向上管理、结果导向。"
  },
  {
    slug: "office-competitor",
    title: "竞品分析",
    industry: "职场办公",
    task: "商业分析",
    summary: "多维度对比竞品并给出机会与行动建议",
    tags: ["竞品", "分析", "商业"],
    model: "general",
    variables: [
      { name: "product", label: "自家产品", type: "text", required: true, placeholder: "如：我们的 App" },
      { name: "competitor", label: "竞品", type: "text", required: true, placeholder: "如：竞品 X" },
      { name: "dimension", label: "对比维度", type: "multiselect", options: ["功能", "定价", "用户", "渠道", "口碑"], required: true },
      { name: "depth", label: "深度", type: "select", options: ["速览", "详细"], required: false }
    ],
    prompt: "你是商业分析师，做竞品分析。自家：{{product}}；竞品：{{competitor}}；维度：{{dimension}}；深度：{{depth}}。\n\n输出：\n1. 对比表（维度/自家/竞品/差距）\n2. 机会点与威胁\n3. 行动建议\n要求：客观、有依据、避免主观臆断。"
  },
  {
    slug: "office-okr",
    title: "OKR 制定",
    industry: "职场办公",
    task: "目标规划",
    summary: "把方向拆成可量化 KR 并设计周节奏",
    tags: ["OKR", "目标", "管理"],
    model: "general",
    variables: [
      { name: "team", label: "对象", type: "text", required: true, placeholder: "如：增长团队/个人" },
      { name: "objective", label: "目标方向", type: "text", required: true, placeholder: "如：提升新用户留存" },
      { name: "quarter", label: "周期", type: "text", required: true, placeholder: "如：Q3" },
      { name: "idea", label: "已有想法", type: "textarea", required: false, placeholder: "初步 KR" }
    ],
    prompt: "你是目标管理教练，帮定 OKR。对象：{{team}}；方向：{{objective}}；周期：{{quarter}}；已有想法：{{idea}}。\n\n输出：\n1 个鼓舞性 Objective + 3-5 个可量化 Key Results（含基线/目标值/信心指数）+ 每周节奏建议。\n要求：KR 可衡量、不堆任务。"
  },
  {
    slug: "office-interview",
    title: "面试模拟",
    industry: "职场办公",
    task: "求职准备",
    summary: "按岗位与薄弱点出递进问题并给高分示范",
    tags: ["面试", "模拟", "求职"],
    model: "general",
    variables: [
      { name: "role", label: "目标岗位", type: "text", required: true, placeholder: "如：产品经理" },
      { name: "level", label: "级别", type: "select", options: ["初级", "中级", "高级"], required: true },
      { name: "style", label: "面试类型", type: "select", options: ["行为", "技术", "综合"], required: true },
      { name: "weak", label: "薄弱点", type: "text", required: false, placeholder: "如：算法" }
    ],
    prompt: "你是{{role}}面试官，做一场{{style}}模拟面试（{{level}}）。候选人薄弱点：{{weak}}。\n\n输出：\n① 10 道递进问题（含追问）\n② 每题考察的能力\n③ 评分维度\n④ 候选人如何高分回答的示范\n帮助候选人针对性准备。"
  },
  {
    slug: "office-daily",
    title: "日报",
    industry: "职场办公",
    task: "写作辅助",
    summary: "把当日工作整理为简洁量化日报",
    tags: ["日报", "写作", "职场"],
    model: "general",
    variables: [
      { name: "tasks", label: "今日工作", type: "textarea", required: true, placeholder: "逐条" },
      { name: "plan", label: "明日计划", type: "textarea", required: true, placeholder: "打算做" },
      { name: "block", label: "阻塞", type: "text", required: false, placeholder: "如有" }
    ],
    prompt: "写一份日报。今日：{{tasks}}；明日：{{plan}}；阻塞：{{block}}。\n\n输出：今日完成（动作+结果）、进行中、明日计划、风险/需支持。简洁、量化、3 分钟可读完。"
  },
  {
    slug: "office-project-retro",
    title: "项目复盘",
    industry: "职场办公",
    task: "复盘分析",
    summary: "目标 vs 实际，沉淀方法论与行动项",
    tags: ["复盘", "项目", "总结"],
    model: "general",
    variables: [
      { name: "project", label: "项目", type: "text", required: true, placeholder: "如：v2 上线" },
      { name: "result", label: "结果", type: "textarea", required: true, placeholder: "实际产出" },
      { name: "good", label: "做得好", type: "textarea", required: false, placeholder: "亮点" },
      { name: "bad", label: "不足", type: "textarea", required: false, placeholder: "待改进" }
    ],
    prompt: "写一份{{project}}复盘。结果：{{result}}；亮点：{{good}}；不足：{{bad}}。\n\n输出：目标 vs 实际、做得好的（沉淀为方法论）、待改进（根因）、行动项（负责人/时限）、可复用模板。客观、对事不对人。"
  },
  {
    slug: "office-standup",
    title: "周会/站会主持稿",
    industry: "职场办公",
    task: "会议主持",
    summary: "高效控场的站会/周会流程与话术",
    tags: ["会议", "主持", "效率"],
    model: "general",
    variables: [
      { name: "type", label: "会议类型", type: "select", options: ["日站会", "周会", "双周会"], required: true },
      { name: "team", label: "团队", type: "text", required: true, placeholder: "如：研发组" },
      { name: "focus", label: "重点", type: "textarea", required: false, placeholder: "本期重点" },
      { name: "size", label: "人数", type: "text", required: false, placeholder: "如：8" }
    ],
    prompt: "你是会议 facilitator，写{{type}}主持稿。团队：{{team}}；重点：{{focus}}；规模：{{size}}。\n\n输出：开场（目标/时长）、固定环节（进展/阻塞/计划）、控场话术（跑题拉回/沉默激活）、收尾（结论与待办）。高效不拖堂。"
  },

  // ===== 教育培训（继续扩展）=====
  {
    slug: "edu-study-plan",
    title: "学习计划",
    industry: "教育培训",
    task: "学习规划",
    summary: "按目标与基础拆阶段、定资源与自测",
    tags: ["学习计划", "规划", "自学"],
    model: "general",
    variables: [
      { name: "subject", label: "学科/技能", type: "text", required: true, placeholder: "如：机器学习" },
      { name: "goal", label: "学习目标", type: "textarea", required: true, placeholder: "学完能做什么" },
      { name: "weeks", label: "周期", type: "text", required: true, placeholder: "如：12 周" },
      { name: "level", label: "基础", type: "select", options: ["零基础", "入门", "进阶"], required: true }
    ],
    prompt: "你是学习规划师，帮定{{subject}}学习计划。目标：{{goal}}；周期：{{weeks}}；基础：{{level}}。\n\n输出：阶段划分（每阶段目标+资源+产出）+ 周节奏 + 自测方式 + 常见放弃点对策。可落地、有里程碑。"
  },
  {
    slug: "edu-reading-notes",
    title: "读书笔记",
    industry: "教育培训",
    task: "整理输出",
    summary: "提炼观点、方法并生成行动清单",
    tags: ["读书", "笔记", "整理"],
    model: "general",
    variables: [
      { name: "book", label: "书名", type: "text", required: true, placeholder: "如：《思考，快与慢》" },
      { name: "type", label: "书型", type: "select", options: ["实用", "文学", "专业"], required: true },
      { name: "focus", label: "关注点", type: "textarea", required: false, placeholder: "想提炼什么" },
      { name: "format", label: "形式", type: "select", options: ["卡片", "要点", "长文"], required: false }
    ],
    prompt: "帮做《{{book}}》的读书笔记（{{type}}）。关注：{{focus}}；形式：{{format}}。\n\n输出：核心观点提炼、金句、可迁移方法、我的行动清单、开放疑问。要求：忠于原书、有自己的反思，不堆摘抄。"
  },
  {
    slug: "edu-speech",
    title: "演讲提纲",
    industry: "教育培训",
    task: "创作辅助",
    summary: "钩子开场+三段主线+行动号召，含 Q&A 预案",
    tags: ["演讲", "提纲", "表达"],
    model: "general",
    variables: [
      { name: "topic", label: "主题", type: "text", required: true, placeholder: "如： AI 时代的终身学习" },
      { name: "audience", label: "听众", type: "text", required: true, placeholder: "如：大学生" },
      { name: "length", label: "时长", type: "select", options: ["5分钟", "15分钟", "30分钟"], required: true },
      { name: "purpose", label: "目的", type: "select", options: ["说服", "告知", "激励"], required: true }
    ],
    prompt: "你是演讲教练，写{{length}}演讲提纲。主题：{{topic}}；听众：{{audience}}；目的：{{purpose}}。\n\n输出：钩子开场、主线三段（论点+故事+数据）、转折、结尾行动号召、可能的 Q&A 预案。有感染力、节奏清晰。"
  },
  {
    slug: "edu-exam-plan",
    title: "考试/考研规划",
    industry: "教育培训",
    task: "备考规划",
    summary: "倒计时分阶段、分科与模考节奏",
    tags: ["备考", "考研", "规划"],
    model: "general",
    variables: [
      { name: "exam", label: "考试名", type: "text", required: true, placeholder: "如：考研英语" },
      { name: "date", label: "考试日期", type: "text", required: true, placeholder: "如：2026-12-21" },
      { name: "base", label: "当前水平", type: "text", required: false, placeholder: "如：四级水平" },
      { name: "daily", label: "每日可用", type: "text", required: true, placeholder: "如：3 小时" }
    ],
    prompt: "你是备考规划师，制定{{exam}}冲刺计划。考试日：{{date}}；当前水平：{{base}}；每天{{daily}}。\n\n输出：倒计时阶段（基础/强化/冲刺/模考）+ 各科时间分配 + 每周任务 + 模考节点 + 心态与作息建议。切实可行。"
  },
  {
    slug: "edu-parent-comm",
    title: "家校沟通话术",
    industry: "教育培训",
    task: "沟通辅助",
    summary: "不同场景的家校沟通模板，聚焦孩子成长",
    tags: ["家校", "沟通", "教育"],
    model: "general",
    variables: [
      { name: "scenario", label: "场景", type: "select", options: ["成绩下滑", "行为问题", "请假", "表扬", "矛盾"], required: true },
      { name: "child", label: "孩子情况", type: "text", required: true, placeholder: "如：三年级男生，好动" },
      { name: "tone", label: "语气", type: "select", options: ["诚恳", "坚定", "委婉"], required: false }
    ],
    prompt: "你是班主任沟通顾问，写{{scenario}}场景的家校沟通话术。孩子情况：{{child}}；语气：{{tone}}。\n\n输出：开场共情、事实陈述、合作建议、后续跟进。要求：不指责家长、聚焦孩子成长、给可操作建议。"
  },
  {
    slug: "edu-class-activity",
    title: "课堂互动设计",
    industry: "教育培训",
    task: "教学辅助",
    summary: "按知识点设计有趣且服务目标的互动活动",
    tags: ["课堂", "互动", "教学"],
    model: "general",
    variables: [
      { name: "subject", label: "学科", type: "select", options: ["语文", "数学", "英语", "物理", "其他"], required: true },
      { name: "grade", label: "年级", type: "text", required: true, placeholder: "如：初一" },
      { name: "topic", label: "知识点", type: "text", required: true, placeholder: "如：光合作用" },
      { name: "minutes", label: "时长", type: "text", required: true, placeholder: "如：15 分钟" },
      { name: "goal", label: "目标", type: "text", required: false, placeholder: "如：提升参与" }
    ],
    prompt: "设计{{grade}}《{{topic}}》({{subject}})的课堂互动。时长{{minutes}}；目标：{{goal}}。\n\n输出：2-3 个互动活动（形式/步骤/时长/材料）+ 分组与角色 + 评估方式 + 突发情况预案。有趣且服务于目标。"
  },

  // ===== 电商运营（继续扩展）=====
  {
    slug: "ecom-short-video",
    title: "短视频脚本",
    industry: "电商运营",
    task: "内容创作",
    summary: "按平台与钩子类型写分镜脚本",
    tags: ["短视频", "脚本", "带货"],
    model: "general",
    variables: [
      { name: "product", label: "产品", type: "text", required: true, placeholder: "如：挂烫机" },
      { name: "platform", label: "平台", type: "select", options: ["抖音", "快手", "视频号", "小红书"], required: true },
      { name: "hook", label: "钩子类型", type: "select", options: ["痛点", "反差", "悬念", "种草"], required: true },
      { name: "duration", label: "时长", type: "select", options: ["15秒", "30秒", "60秒"], required: true }
    ],
    prompt: "写一条{{platform}}的{{duration}}{{hook}}向短视频脚本。产品：{{product}}。\n\n输出：分镜（画面/口播/字幕/时长）+ 开头 3 秒钩子 + 结尾引导（关注/下单）。节奏快、信息密度高、不啰嗦。"
  },
  {
    slug: "ecom-xhs-positioning",
    title: "账号定位",
    industry: "电商运营",
    task: "账号策划",
    summary: "小红书账号一句话定位+栏目+冷启动",
    tags: ["小红书", "定位", "起号"],
    model: "general",
    variables: [
      { name: "field", label: "赛道", type: "text", required: true, placeholder: "如：职场穿搭" },
      { name: "persona", label: "人设", type: "text", required: true, placeholder: "如：理性种草的姐姐" },
      { name: "audience", label: "受众", type: "text", required: true, placeholder: "如：22-30 上班族" },
      { name: "diff", label: "差异点", type: "text", required: false, placeholder: "如：只推实测" }
    ],
    prompt: "你是小红书操盘手，做账号定位。赛道：{{field}}；人设：{{persona}}；受众：{{audience}}；差异点：{{diff}}。\n\n输出：账号一句话定位、内容栏目（3-5 个）、人设关键词、爆款选题方向、视觉与语气建议、冷启动打法。可落地。"
  },
  {
    slug: "ecom-shop-diagnosis",
    title: "店铺诊断",
    industry: "电商运营",
    task: "经营诊断",
    summary: "基于数据归因流量/转化/复购问题",
    tags: ["诊断", "店铺", "运营"],
    model: "general",
    variables: [
      { name: "platform", label: "平台", type: "select", options: ["淘宝", "京东", "抖音", "拼多多"], required: true },
      { name: "data", label: "经营数据", type: "textarea", required: true, placeholder: "流量/转化/客单/复购等" },
      { name: "pain", label: "痛点", type: "text", required: false, placeholder: "如：转化低" }
    ],
    prompt: "你是电商运营顾问，诊断店铺。平台：{{platform}}；数据：{{data}}；痛点：{{pain}}。\n\n输出：问题归因（流量/转化/客单/复购）、优先级排序、3 个马上能做的动作、1 个中期策略。基于数据，不空谈。"
  },
  {
    slug: "ecom-private-domain",
    title: "私域社群运营",
    industry: "电商运营",
    task: "用户运营",
    summary: "社群定位、内容日历与转化 SOP",
    tags: ["私域", "社群", "运营"],
    model: "general",
    variables: [
      { name: "biz", label: "业务", type: "text", required: true, placeholder: "如：母婴电商" },
      { name: "stage", label: "阶段", type: "select", options: ["新建", "成长期", "瓶颈期"], required: true },
      { name: "goal", label: "目标", type: "select", options: ["留存", "转化", "裂变"], required: true },
      { name: "size", label: "群规模", type: "text", required: false, placeholder: "如：500 人" }
    ],
    prompt: "你是私域运营专家，设计社群方案。业务：{{biz}}；阶段：{{stage}}；目标：{{goal}}；规模：{{size}}。\n\n输出：社群定位与规则、内容日历（日/周）、促活与转化 SOP、裂变玩法、数据指标。强调价值先于转化。"
  },
  {
    slug: "ecom-seo-title",
    title: "商品标题优化",
    industry: "电商运营",
    task: "搜索文案",
    summary: "兼顾搜索权重与可读性的标题方案",
    tags: ["标题", "SEO", "搜索"],
    model: "general",
    variables: [
      { name: "product", label: "产品", type: "text", required: true, placeholder: "如：瑜伽垫" },
      { name: "keywords", label: "核心词", type: "textarea", required: true, placeholder: "如：加厚/防滑/TPE" },
      { name: "platform", label: "平台", type: "select", options: ["淘宝", "京东", "拼多多", "亚马逊"], required: true },
      { name: "limit", label: "字数限制", type: "text", required: false, placeholder: "如：30 字" }
    ],
    prompt: "写{{platform}}商品标题（限{{limit}}）。产品：{{product}}；核心词：{{keywords}}。\n\n输出：3-5 个标题方案（覆盖不同搜索意图）+ 关键词布局逻辑 + 避坑（堆砌/违禁词）。兼顾搜索权重与可读性。"
  },
  {
    slug: "ecom-live-selection",
    title: "直播选品",
    industry: "电商运营",
    task: "直播策划",
    summary: "按账号阶段设计引流/利润/形象款结构",
    tags: ["直播", "选品", "带货"],
    model: "general",
    variables: [
      { name: "account", label: "账号定位", type: "text", required: true, placeholder: "如：平价美妆" },
      { name: "audience", label: "受众", type: "text", required: true, placeholder: "如：学生党" },
      { name: "stage", label: "阶段", type: "select", options: ["新号", "成长期", "成熟"], required: true },
      { name: "goal", label: "目标", type: "select", options: ["拉新", "利润", "清仓"], required: true }
    ],
    prompt: "你是直播操盘手，做选品策略。账号：{{account}}；受众：{{audience}}；阶段：{{stage}}；目标：{{goal}}。\n\n输出：选品漏斗（引流款/利润款/形象款比例）+ 每类 3 个示例方向 + 排品节奏 + 避坑（货不对板/高退）。数据驱动。"
  },
  {
    slug: "ecom-review-reply",
    title: "评价/差评回复",
    industry: "电商运营",
    task: "客服话术",
    summary: "不同评价类型的得体回复与内部改进",
    tags: ["评价", "差评", "客服"],
    model: "general",
    variables: [
      { name: "platform", label: "平台", type: "select", options: ["淘宝", "京东", "抖音", "美团"], required: true },
      { name: "type", label: "评价类型", type: "select", options: ["好评", "中评", "差评"], required: true },
      { name: "content", label: "用户评价", type: "textarea", required: true, placeholder: "粘贴评价" },
      { name: "brand_tone", label: "品牌语气", type: "select", options: ["温暖", "专业", "幽默"], required: false }
    ],
    prompt: "写{{platform}}的{{type}}回复，语气{{brand_tone}}。用户评价：{{content}}。\n\n输出：回复文案（好评致谢/中差评共情+解决方案+补偿尺度提示）+ 内部改进动作建议。不删评、不硬怼、留好印象。"
  },

  // ===== 金融（继续扩展）=====
  {
    slug: "finance-budget",
    title: "个人预算表",
    industry: "金融",
    task: "理财规划",
    summary: "按月收入支出做结构与自动储蓄建议",
    tags: ["预算", "记账", "理财"],
    model: "general",
    variables: [
      { name: "income", label: "月收入", type: "text", required: true, placeholder: "如：1.5 万" },
      { name: "fixed", label: "固定支出", type: "textarea", required: true, placeholder: "房租/贷/通勤等" },
      { name: "goal", label: "储蓄目标", type: "text", required: false, placeholder: "如：月存 3000" },
      { name: "style", label: "粒度", type: "select", options: ["极简", "详细"], required: false }
    ],
    prompt: "你是理财规划师，做月度预算（科普非建议）。月收入：{{income}}；固定支出：{{fixed}}；储蓄目标：{{goal}}；粒度：{{style}}。\n\n输出：收入-支出结构、必要/可选支出划分、储蓄率与自动储蓄建议、缓冲金设置、常见漏项。强调量入为出。"
  },
  {
    slug: "finance-loan",
    title: "房贷/贷款说明",
    industry: "金融",
    task: "金融科普",
    summary: "月供测算逻辑与提前还款要点（非建议）",
    tags: ["贷款", "房贷", "科普"],
    model: "general",
    variables: [
      { name: "type", label: "贷款类型", type: "select", options: ["房贷", "车贷", "消费贷"], required: true },
      { name: "amount", label: "金额", type: "text", required: true, placeholder: "如：200 万" },
      { name: "rate", label: "利率", type: "text", required: true, placeholder: "如：3.5%" },
      { name: "term", label: "期限", type: "text", required: true, placeholder: "如：30 年" }
    ],
    prompt: "你是金融科普作者，解释一笔{{type}}。金额：{{amount}}；利率：{{rate}}；期限：{{term}}。\n\n输出：月供测算逻辑（等额本息/本金区别）、总利息、提前还款要点、月供与收入比健康线、风险提示。非贷款建议。"
  },
  {
    slug: "finance-retire",
    title: "养老规划",
    industry: "金融",
    task: "理财规划",
    summary: "三支柱配置思路与缺口测算方法",
    tags: ["养老", "规划", "科普"],
    model: "general",
    variables: [
      { name: "age", label: "当前年龄", type: "text", required: true, placeholder: "如：30" },
      { name: "income", label: "月收入", type: "text", required: true, placeholder: "如：2 万" },
      { name: "risk", label: "风险偏好", type: "select", options: ["保守", "平衡", "进取"], required: true },
      { name: "pension", label: "已有储备", type: "text", required: false, placeholder: "如：社保+少量基金" }
    ],
    prompt: "你是养老规划师，做养老储备思路（科普非建议）。年龄：{{age}}；月收入：{{income}}；风险：{{risk}}；已有：{{pension}}。\n\n输出：目标替代率概念、三支柱（社保/年金/个人）配置思路、定投/商业养老角色、缺口测算方法、越早越好的逻辑。声明仅供参考。"
  },
  {
    slug: "finance-statement",
    title: "财报解读",
    industry: "金融",
    task: "财务分析",
    summary: "把财报关键科目翻成白话与健康度信号",
    tags: ["财报", "分析", "投资"],
    model: "general",
    variables: [
      { name: "statement", label: "财报片段", type: "textarea", required: true, placeholder: "粘贴科目数据" },
      { name: "focus", label: "关注", type: "select", options: ["营收", "利润", "现金流", "负债", "全部"], required: true },
      { name: "audience", label: "读者", type: "select", options: ["小白", "投资者", "专业"], required: true }
    ],
    prompt: "你是财务分析师，解读财报。片段：{{statement}}；重点：{{focus}}；读者：{{audience}}。\n\n输出：关键科目白话解释、健康度信号（如现金流 vs 利润）、异常与红旗、一句话结论。非投资建议。"
  },
  {
    slug: "finance-tax",
    title: "个税/税务科普",
    industry: "金融",
    task: "税务科普",
    summary: "解释适用税目、抵扣与申报要点（非筹划）",
    tags: ["税务", "个税", "科普"],
    model: "general",
    variables: [
      { name: "region", label: "适用地区", type: "select", options: ["中国大陆", "美国", "其他"], required: true },
      { name: "type", label: "所得类型", type: "select", options: ["工资薪金", "经营", "稿酬", "综合"], required: true },
      { name: "scenario", label: "场景", type: "textarea", required: true, placeholder: "描述情况" }
    ],
    prompt: "你是税务科普作者，解释{{region}}的{{type}}税务场景。场景：{{scenario}}。\n\n输出：适用税目与逻辑、可抵扣项、申报要点、常见误区、风险提示（以税法为准，非筹划建议）。"
  },
  {
    slug: "finance-fund-compare",
    title: "基金对比",
    industry: "金融",
    task: "投资分析",
    summary: "多基金业绩/风险/费用对比与适用人群",
    tags: ["基金", "对比", "分析"],
    model: "general",
    variables: [
      { name: "funds", label: "基金列表", type: "textarea", required: true, placeholder: "基金名或代码" },
      { name: "metric", label: "关注指标", type: "multiselect", options: ["业绩", "风险", "费用", "规模"], required: true },
      { name: "horizon", label: "持有期", type: "select", options: ["1年", "3年", "5年+"], required: true }
    ],
    prompt: "你是基金分析科普作者，对比几只基金。列表：{{funds}}；关注：{{metric}}；持有：{{horizon}}。\n\n输出：对比表（年化/最大回撤/夏普/费率/规模）+ 适用人群 + 风险提示（过往业绩不代表未来）。非推荐。"
  },

  // ===== 写作创作（继续扩展）=====
  {
    slug: "writing-moments",
    title: "朋友圈文案",
    industry: "写作创作",
    task: "社交文案",
    summary: "不同场景与语气的朋友圈短文案",
    tags: ["朋友圈", "文案", "社交"],
    model: "general",
    variables: [
      { name: "occasion", label: "场景", type: "select", options: ["日常", "晒娃", "旅行", "成就", "吐槽"], required: true },
      { name: "tone", label: "语气", type: "select", options: ["真诚", "幽默", "文艺", "低调"], required: true },
      { name: "point", label: "想表达", type: "text", required: true, placeholder: "核心意思" }
    ],
    prompt: "写一条{{occasion}}的朋友圈文案，语气{{tone}}。想表达：{{point}}。\n\n输出：2-3 个版本（不同角度）+ 配图建议 + 是否加话题。克制不矫情。"
  },
  {
    slug: "writing-microfiction",
    title: "微小说/故事",
    industry: "写作创作",
    task: "创作辅助",
    summary: "有起承转合与余味的完整小故事",
    tags: ["故事", "微小说", "创作"],
    model: "general",
    variables: [
      { name: "theme", label: "主题", type: "text", required: true, placeholder: "如：错过" },
      { name: "length", label: "篇幅", type: "select", options: ["50字", "200字", "500字"], required: true },
      { name: "twist", label: "是否有反转", type: "select", options: ["有反转", "无反转"], required: true },
      { name: "style", label: "风格", type: "select", options: ["温情", "悬疑", "讽刺", "治愈"], required: true }
    ],
    prompt: "写一则{{style}}微小说，主题《{{theme}}》，{{length}}，{{twist}}。\n\n输出：完整小故事（起承转合/反转），结尾有余味。文字精炼有画面感。"
  },
  {
    slug: "writing-xhs-teardown",
    title: "爆文拆解",
    industry: "写作创作",
    task: "内容分析",
    summary: "拆解爆款结构并给出可复用技巧",
    tags: ["拆解", "爆款", "分析"],
    model: "general",
    variables: [
      { name: "text", label: "原文", type: "textarea", required: true, placeholder: "粘贴原文" },
      { name: "platform", label: "平台", type: "select", options: ["小红书", "公众号", "抖音"], required: true },
      { name: "angle", label: "拆解角度", type: "multiselect", options: ["标题", "结构", "情绪", "钩子"], required: true }
    ],
    prompt: "拆解一篇{{platform}}爆款。原文：{{text}}；角度：{{angle}}。\n\n输出：标题公式、开头钩子、结构骨架、情绪曲线、可复用的 3 个技巧、模仿练习题。学了能用。"
  },
  {
    slug: "writing-newsletter",
    title: "邮件 Newsletter",
    industry: "写作创作",
    task: "内容文案",
    summary: "有信息量、不群发感的定期邮件",
    tags: ["Newsletter", "邮件", "内容"],
    model: "general",
    variables: [
      { name: "topic", label: "主题", type: "text", required: true, placeholder: "如：本周 AI 工具" },
      { name: "audience", label: "受众", type: "text", required: true, placeholder: "如：产品经理" },
      { name: "issue", label: "期数", type: "text", required: false, placeholder: "如：第 12 期" },
      { name: "cta", label: "行动号召", type: "text", required: false, placeholder: "如：回复你的看法" }
    ],
    prompt: "写一期 Newsletter。主题：{{topic}}；受众：{{audience}}；期数：{{issue}}；CTA：{{cta}}。\n\n输出：开场钩子、2-3 个价值模块（含可读标题）、个人观点、CTA、签名。亲切、有信息量、不群发感。"
  },
  {
    slug: "writing-personal-brand",
    title: "个人品牌宣言",
    industry: "写作创作",
    task: "品牌文案",
    summary: "一句话定位+简介+故事切入点",
    tags: ["个人品牌", "定位", "文案"],
    model: "general",
    variables: [
      { name: "field", label: "领域", type: "text", required: true, placeholder: "如：前端性能" },
      { name: "value", label: "价值主张", type: "text", required: true, placeholder: "如：让页面快 50%" },
      { name: "audience", label: "受众", type: "text", required: true, placeholder: "如：创业团队" },
      { name: "tone", label: "语气", type: "select", options: ["专业", "犀利", "温暖"], required: false }
    ],
    prompt: "帮写个人品牌一句话宣言 + 简介。领域：{{field}}；价值：{{value}}；受众：{{audience}}；语气：{{tone}}。\n\n输出：①一句定位 ②3 句版 bio ③个人故事切入点 ④不做的边界。鲜明不套路。"
  },
  {
    slug: "writing-speech-polish",
    title: "演讲/文稿润色",
    industry: "写作创作",
    task: "润色优化",
    summary: "提升感染力：节奏、重音、金句强化",
    tags: ["润色", "演讲", "文稿"],
    model: "general",
    variables: [
      { name: "draft", label: "草稿", type: "textarea", required: true, placeholder: "粘贴文稿" },
      { name: "occasion", label: "场合", type: "text", required: true, placeholder: "如：发布会" },
      { name: "tone", label: "语气", type: "select", options: ["有力", "亲切", "幽默", "正式"], required: true }
    ],
    prompt: "润色一篇演讲稿。草稿：{{draft}}；场合：{{occasion}}；语气：{{tone}}。\n\n输出：润色后全文 + 改动说明（节奏/重音/过渡/金句强化）+ 朗读提示（停顿/重音）。更有感染力。"
  },
  {
    slug: "writing-copy-ab",
    title: "文案 A/B",
    industry: "写作创作",
    task: "转化文案",
    summary: "同一卖点的多版本与检验维度",
    tags: ["A/B", "文案", "转化"],
    model: "general",
    variables: [
      { name: "product", label: "产品", type: "text", required: true, placeholder: "如：在线课程" },
      { name: "audience", label: "受众", type: "text", required: true, placeholder: "如：职场新人" },
      { name: "channel", label: "渠道", type: "select", options: ["信息流", "社群", "详情页", "朋友圈"], required: true },
      { name: "variant", label: "变体数", type: "select", options: ["2", "3", "4"], required: true }
    ],
    prompt: "为{{product}}写{{variant}}个{{channel}}文案变体，受众{{audience}}。\n\n输出：每个变体（不同钩子/卖点/语气）+ 假设检验的差异化维度 + 看哪个指标。可用于 A/B。"
  },

  // ===== 编程开发（继续扩展）=====
  {
    slug: "dev-readme",
    title: "技术文档/README",
    industry: "编程开发",
    task: "文档写作",
    summary: "清晰可复制、新人不懵的项目文档",
    tags: ["README", "文档", "开源"],
    model: "general",
    variables: [
      { name: "language", label: "语言", type: "select", options: ["Python", "Go", "TypeScript", "Java", "Rust", "其他"], required: true },
      { name: "repo", label: "项目说明", type: "textarea", required: true, placeholder: "项目是做什么的" },
      { name: "sections", label: "章节", type: "multiselect", options: ["安装", "用法", "API", "贡献", "许可"], required: true }
    ],
    prompt: "你是技术写手，写项目 README（{{language}}）。项目：{{repo}}；需含：{{sections}}。\n\n输出：项目简介、特性、快速开始（安装/最小示例）、API/配置要点、贡献指南、许可与致谢。清晰、可复制、新人不懵。"
  },
  {
    slug: "dev-unit-test",
    title: "单元测试生成",
    industry: "编程开发",
    task: "测试生成",
    summary: "按边界与异常生成可运行测试",
    tags: ["测试", "unit", "quality"],
    model: "general",
    variables: [
      { name: "language", label: "语言", type: "select", options: ["Python", "Go", "TypeScript", "Java"], required: true },
      { name: "code", label: "函数/代码", type: "textarea", required: true, placeholder: "粘贴代码" },
      { name: "framework", label: "测试框架", type: "text", required: true, placeholder: "如：pytest" },
      { name: "focus", label: "覆盖", type: "select", options: ["正常", "边界", "异常", "全要"], required: true }
    ],
    prompt: "为以下{{language}}代码生成单元测试（框架：{{framework}}），覆盖{{focus}}。代码：\n{{code}}\n\n输出：测试用例清单（用例名/输入/期望）+ 测试代码 + 边界与异常说明。可读、可运行。"
  },
  {
    slug: "dev-regex",
    title: "正则/小脚本",
    industry: "编程开发",
    task: "工具生成",
    summary: "开箱即用的小工具/正则与测试",
    tags: ["正则", "脚本", "工具"],
    model: "general",
    variables: [
      { name: "language", label: "语言", type: "select", options: ["Python", "JavaScript", "其他"], required: true },
      { name: "task", label: "需求", type: "textarea", required: true, placeholder: "描述要做什么" },
      { name: "sample", label: "样例输入", type: "text", required: false, placeholder: "如：user@x.com" }
    ],
    prompt: "写一段{{language}}小工具/正则，满足需求。需求：{{task}}；样例输入：{{sample}}。\n\n输出：完整代码（含注释）+ 用法示例 + 边界处理 + 测试用例。开箱即用。"
  },
  {
    slug: "dev-architecture",
    title: "架构方案",
    industry: "编程开发",
    task: "架构设计",
    summary: "务实的分层架构与技术选型理由",
    tags: ["架构", "设计", "方案"],
    model: "general",
    variables: [
      { name: "language", label: "语言", type: "select", options: ["Python", "Go", "TypeScript", "Java"], required: true },
      { name: "requirement", label: "业务需求", type: "textarea", required: true, placeholder: "描述需求与约束" },
      { name: "scale", label: "规模", type: "select", options: ["小型", "中型", "高并发"], required: true },
      { name: "concern", label: "关注", type: "multiselect", options: ["可扩展", "性能", "可观测", "成本"], required: false }
    ],
    prompt: "你是{{language}}架构师，给方案。需求：{{requirement}}；规模：{{scale}}；关注：{{concern}}。\n\n输出：整体架构（文字/分层）、核心组件与职责、数据流转、技术选型与理由、风险与演进。务实不炫技。"
  },
  {
    slug: "dev-prd",
    title: "需求文档 PRD",
    industry: "编程开发",
    task: "产品文档",
    summary: "研发能直接估的需求文档结构",
    tags: ["PRD", "需求", "产品"],
    model: "general",
    variables: [
      { name: "role", label: "你的角色", type: "text", required: true, placeholder: "如：高级 PM" },
      { name: "feature", label: "功能", type: "textarea", required: true, placeholder: "要做什么" },
      { name: "goal", label: "目标", type: "text", required: true, placeholder: "解决什么问题" },
      { name: "non_goal", label: "非目标", type: "textarea", required: false, placeholder: "暂不做什么" }
    ],
    prompt: "你是产品{{role}}，写一份 PRD。功能：{{feature}}；目标：{{goal}}；非目标：{{non_goal}}。\n\n输出：背景与目标、用户故事、功能需求（优先级）、边界与异常、成功指标、暂不考虑项。结构清晰、研发能直接估。"
  },
  {
    slug: "dev-code-comment",
    title: "代码注释生成",
    industry: "编程开发",
    task: "文档生成",
    summary: "解释为什么而非是什么的精准注释",
    tags: ["注释", "文档", "code"],
    model: "general",
    variables: [
      { name: "language", label: "语言", type: "select", options: ["Python", "Go", "TypeScript", "Java", "Rust"], required: true },
      { name: "code", label: "代码", type: "textarea", required: true, placeholder: "粘贴代码" },
      { name: "level", label: "详尽度", type: "select", options: ["简明", "教学", "详尽"], required: true },
      { name: "style", label: "风格", type: "select", options: ["行内", "文档字符串"], required: false }
    ],
    prompt: "为{{language}}代码生成{{style}}注释（{{level}}）。代码：\n{{code}}\n\n输出：带注释的代码 + 关键逻辑/参数/返回/边界说明。清晰不废话，解释「为什么」而非「是什么」。"
  },
  {
    slug: "dev-git-commit",
    title: "提交信息规范",
    industry: "编程开发",
    task: "规范生成",
    summary: "Conventional Commits 规范提交信息",
    tags: ["git", "commit", "规范"],
    model: "general",
    variables: [
      { name: "language", label: "语言", type: "select", options: ["Python", "Go", "TypeScript", "Java", "其他"], required: true },
      { name: "changes", label: "改动说明", type: "textarea", required: true, placeholder: "描述改动" },
      { name: "type", label: "类型", type: "select", options: ["feat", "fix", "refactor", "docs", "chore"], required: true },
      { name: "scope", label: "影响范围", type: "text", required: false, placeholder: "如：auth" }
    ],
    prompt: "按 Conventional Commits 写提交信息（{{language}}）。改动：{{changes}}；类型：{{type}}；范围：{{scope}}。\n\n输出：规范标题（type(scope): 摘要）+ 正文（动机/改动点）+ 关联 issue 占位。简洁、可机器解析。"
  },

  // ===== 生活/个人效率（新行业）=====
  {
    slug: "life-travel",
    title: "旅行攻略",
    industry: "生活/个人效率",
    task: "行程规划",
    summary: "松弛有重点的每日行程与避坑",
    tags: ["旅行", "攻略", "规划"],
    model: "general",
    variables: [
      { name: "dest", label: "目的地", type: "text", required: true, placeholder: "如：京都" },
      { name: "days", label: "天数", type: "text", required: true, placeholder: "如：5 天" },
      { name: "budget", label: "预算", type: "text", required: false, placeholder: "如：8000" },
      { name: "style", label: "风格", type: "select", options: ["穷游", "舒适", "深度", "亲子"], required: true },
      { name: "prefer", label: "偏好", type: "textarea", required: false, placeholder: "如：爱吃、不爱赶" }
    ],
    prompt: "你是旅行规划师，做{{dest}}{{days}}天攻略，预算{{budget}}，风格{{style}}。偏好：{{prefer}}。\n\n输出：每日行程（景点/交通/用餐/时长）、必吃必玩、避坑、预算拆分、行李清单。松弛有重点。"
  },
  {
    slug: "life-decision",
    title: "决策分析",
    industry: "生活/个人效率",
    task: "决策辅助",
    summary: "选项对比表+隐性成本+最坏情况",
    tags: ["决策", "分析", "选择"],
    model: "general",
    variables: [
      { name: "decision", label: "待决策", type: "textarea", required: true, placeholder: "描述选择" },
      { name: "options", label: "选项", type: "text", required: true, placeholder: "如：A/B/C" },
      { name: "criteria", label: "看重因素", type: "textarea", required: true, placeholder: "如：成本/成长" },
      { name: "risk", label: "风险承受", type: "select", options: ["低", "中", "高"], required: true }
    ],
    prompt: "你是决策教练，帮理清一个选择。决策：{{decision}}；选项：{{options}}；看重：{{criteria}}；风险承受：{{risk}}。\n\n输出：选项对比表（因素/打分/权衡）、隐性成本、最坏情况、建议与下一步。结构化、不替你做决定。"
  },
  {
    slug: "life-gift",
    title: "礼物推荐",
    industry: "生活/个人效率",
    task: "推荐",
    summary: "分档走心的礼物与贺卡文案",
    tags: ["礼物", "推荐", "社交"],
    model: "general",
    variables: [
      { name: "recipient", label: "对象", type: "text", required: true, placeholder: "如：妈妈" },
      { name: "occasion", label: "场合", type: "text", required: true, placeholder: "如：生日" },
      { name: "budget", label: "预算", type: "text", required: true, placeholder: "如：500" },
      { name: "relation", label: "关系", type: "text", required: false, placeholder: "如：母女" },
      { name: "hint", label: "线索", type: "textarea", required: false, placeholder: "如：喜欢花草" }
    ],
    prompt: "推荐礼物。对象：{{recipient}}；场合：{{occasion}}；预算：{{budget}}；关系：{{relation}}；线索：{{hint}}。\n\n输出：5 个分档推荐（理由/预算/渠道）+ 避雷 + 一句贺卡文案。走心不敷衍。"
  },
  {
    slug: "life-self-intro",
    title: "自我介绍/破冰",
    industry: "生活/个人效率",
    task: "表达辅助",
    summary: "不同场景让对方记住你的开场",
    tags: ["自我介绍", "破冰", "社交"],
    model: "general",
    variables: [
      { name: "scene", label: "场景", type: "select", options: ["面试", "社交", "约会", "新团队"], required: true },
      { name: "who", label: "你是谁", type: "text", required: true, placeholder: "背景/标签" },
      { name: "goal", label: "目的", type: "text", required: true, placeholder: "想达成" },
      { name: "style", label: "语气", type: "select", options: ["真诚", "幽默", "专业"], required: false }
    ],
    prompt: "写一段{{scene}}的自我介绍，语气{{style}}。你是：{{who}}；目的：{{goal}}。\n\n输出：30 秒版 + 1 分钟版 + 一个让人记住的钩子。自然不背稿。"
  },
  {
    slug: "life-moving",
    title: "搬家清单",
    industry: "生活/个人效率",
    task: "事务规划",
    summary: "倒推时间表与分房打包不遗漏",
    tags: ["搬家", "清单", "规划"],
    model: "general",
    variables: [
      { name: "distance", label: "距离", type: "select", options: ["同城", "跨城", "跨国"], required: true },
      { name: "house", label: "户型", type: "text", required: true, placeholder: "如：两室一厅" },
      { name: "family", label: "家庭情况", type: "text", required: false, placeholder: "如：三口之家" },
      { name: "pet", label: "有宠物", type: "select", options: ["无", "有"], required: false }
    ],
    prompt: "做{{distance}}搬家清单。户型：{{house}}；家庭：{{family}}；宠物：{{pet}}。\n\n输出：倒推时间表（T-30 到当天）、分房间打包清单、贵重/易碎处理、搬家前后手续（水电网/地址变更）、入住首日必备包。不遗漏。"
  },
  {
    slug: "life-habit",
    title: "习惯打卡计划",
    industry: "生活/个人效率",
    task: "习惯养成",
    summary: "触发-行动-奖励回路与挫折应对",
    tags: ["习惯", "打卡", "自律"],
    model: "general",
    variables: [
      { name: "habit", label: "习惯", type: "text", required: true, placeholder: "如：晨跑" },
      { name: "reason", label: "动机", type: "text", required: true, placeholder: "为什么想做" },
      { name: "freq", label: "频率", type: "select", options: ["每日", "每周3次", "工作日"], required: true },
      { name: "obstacle", label: "障碍", type: "text", required: false, placeholder: "如：起不来" }
    ],
    prompt: "设计{{habit}}养成计划。动机：{{reason}}；频率：{{freq}}；障碍：{{obstacle}}。\n\n输出：微习惯起步、触发-行动-奖励回路、打卡表模板、挫折应对、里程碑奖励。科学可持续。"
  },
  {
    slug: "life-book-club",
    title: "读书会策划",
    industry: "生活/个人效率",
    task: "活动策划",
    summary: "有深度不冷场的流程与讨论题",
    tags: ["读书会", "活动", "社交"],
    model: "general",
    variables: [
      { name: "book", label: "书目", type: "text", required: true, placeholder: "如：《活着》" },
      { name: "size", label: "人数", type: "text", required: true, placeholder: "如：10 人" },
      { name: "format", label: "形式", type: "select", options: ["线下", "线上"], required: true },
      { name: "goal", label: "目标", type: "select", options: ["共读", "社交", "深读"], required: true }
    ],
    prompt: "策划一场读书会。书目《{{book}}》；{{size}}人；{{format}}；目标：{{goal}}。\n\n输出：流程（破冰-领读-讨论-总结）、讨论题 5 个、时间分配、物料清单、后续行动。有深度不冷场。"
  },
  {
    slug: "life-declutter",
    title: "断舍离/整理",
    industry: "生活/个人效率",
    task: "整理规划",
    summary: "分类标准与维持习惯，温柔不焦虑",
    tags: ["整理", "断舍离", "收纳"],
    model: "general",
    variables: [
      { name: "space", label: "区域", type: "select", options: ["衣橱", "书房", "厨房", "全屋"], required: true },
      { name: "goal", label: "目标", type: "select", options: ["减负", "收纳", "搬家前"], required: true },
      { name: "style", label: "风格", type: "select", options: ["极简", "实用"], required: false }
    ],
    prompt: "做{{space}}整理方案。目标：{{goal}}；风格：{{style}}。\n\n输出：分类标准（留/捐/扔/存）、逐步流程、收纳原则（常用就近）、维持习惯、决策树（拿不准怎么办）。温柔不焦虑。"
  },

  // ===== 补充：补齐 100+ =====
  {
    slug: "legal-nda",
    title: "保密协议要点",
    industry: "法律",
    task: "文书起草",
    summary: "起草 NDA 核心条款框架并提示单方/双方差异",
    tags: ["保密", "NDA", "合同"],
    model: "general",
    variables: [
      { name: "jurisdiction", label: "适用法域", type: "select", options: ["中国大陆", "中国香港", "美国", "欧盟"], required: true },
      { name: "parties", label: "双方", type: "text", required: true, placeholder: "如：公司与候选人" },
      { name: "scope", label: "保密范围", type: "multiselect", options: ["技术", "商业", "客户", "其他"], required: true },
      { name: "term", label: "期限", type: "text", required: false, placeholder: "如：2 年" }
    ],
    prompt: "你是{{jurisdiction}}公司法律师，起草保密协议（NDA）要点框架。双方：{{parties}}；保密范围：{{scope}}；期限：{{term}}。\n\n输出：保密信息定义、义务与例外、使用限制、期限与终止后义务、违约责任、争议解决。提示：区分单方/双方 NDA，正式文本需法务复核。"
  },
  {
    slug: "medical-sleep",
    title: "睡眠改善方案",
    industry: "医疗健康",
    task: "健康管理",
    summary: "基于睡眠卫生的改善步骤与就医信号（非诊断）",
    tags: ["睡眠", "健康", "改善"],
    model: "general",
    variables: [
      { name: "problem", label: "睡眠问题", type: "textarea", required: true, placeholder: "如：入睡超 1 小时" },
      { name: "habit", label: "作息习惯", type: "text", required: false, placeholder: "如：凌晨睡、睡前刷手机" },
      { name: "goal", label: "目标", type: "select", options: ["入睡快", "少夜醒", "时长够"], required: true },
      { name: "severity", label: "程度", type: "select", options: ["轻", "中", "重"], required: true }
    ],
    prompt: "你是睡眠健康科普作者，给睡眠改善方案（非诊断）。问题：{{problem}}；习惯：{{habit}}；目标：{{goal}}；程度：{{severity}}。\n\n输出：睡眠卫生清单、作息调整步骤、环境优化、放松技巧、何时就医的信号。强调：长期失眠需看医生。"
  },
  {
    slug: "finance-insurance-term",
    title: "保险条款解释",
    industry: "金融",
    task: "保险科普",
    summary: "把保险条款翻成白话，提示免责与理赔要点",
    tags: ["保险", "条款", "科普"],
    model: "general",
    variables: [
      { name: "term_text", label: "条款原文", type: "textarea", required: true, placeholder: "粘贴条款" },
      { name: "type", label: "险种", type: "select", options: ["重疾", "医疗", "寿险", "意外"], required: true },
      { name: "audience", label: "读者", type: "select", options: ["小白", "进阶"], required: true }
    ],
    prompt: "你是保险科普作者，解释一段保险条款（{{type}}），读者{{audience}}。条款：{{term_text}}。\n\n输出：白话解释（保什么/不保什么/关键定义）、易踩坑点、理赔要点、与其他条款的差异提示。非代销，强调看清免责。"
  }
];
