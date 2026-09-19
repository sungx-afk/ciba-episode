/**
 * 糍粑英语 App Store 截图配置。
 *
 * 出图（先确保 Web 服务已启动，见下方 startCommand）：
 *   npm run shots
 * 只出一部分：
 *   npm run shots -- --only 01,02
 * 侦察（页面改版后文案变了，用它重新拿可点文本）：
 *   npm run shots:recon
 *
 * 详见 skill: ~/.codebuddy/skills/ios-appstore-screenshots/
 */

/** 启动 Web 服务时必须关掉诊断浮窗，否则右下角会截进去 */
export const startCommand = 'EXPO_PUBLIC_SHOW_DIAGNOSTIC=false npx expo start --web --port 8081';

// ---------------------------------------------------------------- mock 数据

const USER = {
  id: 1001,
  nickname: '糍粑学员',
  mobile: '13800001234',
  loginName: 'demo',
};

/** 顶部「我的卡组」（parentId=0，服务端只返回 pack_type=qian_wen_cat） */
const TOP_PACKS = [
  {
    id: 9001,
    name: '托福核心词 · 意群分类',
    pack_type: 'qian_wen_cat',
    card_count: 4123,
    remembered_card_count: 1865,
    today_card_count: 36,
    today_learned_card_count: 14,
    parent_id: 0,
  },
  {
    id: 9002,
    name: '四级核心词 · 意群分类',
    pack_type: 'qian_wen_cat',
    card_count: 2600,
    remembered_card_count: 640,
    today_card_count: 24,
    today_learned_card_count: 6,
    parent_id: 0,
  },
  {
    id: 9003,
    name: '考研核心词 · 意群分类',
    pack_type: 'qian_wen_cat',
    card_count: 3200,
    remembered_card_count: 0,
    today_card_count: 30,
    today_learned_card_count: 0,
    parent_id: 0,
  },
];

/** 9001 下的分类卡组（parentId=9001） */
const SUB_PACKS = [
  { id: 9101, name: '天文与宇宙', card_count: 128, remembered_card_count: 96, today_card_count: 8, today_learned_card_count: 3, parent_id: 9001 },
  { id: 9102, name: '地质与地理', card_count: 142, remembered_card_count: 88, today_card_count: 6, today_learned_card_count: 2, parent_id: 9001 },
  { id: 9103, name: '生物与生态', card_count: 167, remembered_card_count: 61, today_card_count: 5, today_learned_card_count: 1, parent_id: 9001 },
  { id: 9104, name: '医学与健康', card_count: 153, remembered_card_count: 40, today_card_count: 4, today_learned_card_count: 0, parent_id: 9001 },
  { id: 9105, name: '心理与情感', card_count: 118, remembered_card_count: 22, today_card_count: 4, today_learned_card_count: 0, parent_id: 9001 },
  { id: 9106, name: '社会与文化', card_count: 205, remembered_card_count: 9, today_card_count: 5, today_learned_card_count: 0, parent_id: 9001 },
];

const ALL_PACKS = [...TOP_PACKS, ...SUB_PACKS];

/** [单词, 音标, 释义, 助记, 例句英文, 例句中文] */
const WORDS = [
  ['celestial', 'səˈlestʃəl', 'adj. 天体的；天空的', 'celest（天空）+ ial → 属于天空的', 'The telescope captured a detailed image of distant celestial bodies.', '望远镜拍下了遥远天体的清晰影像。'],
  ['constellation', 'ˌkɒnstəˈleɪʃn', 'n. 星座；一群杰出的人', 'con（共同）+ stell（星星）+ ation → 星星聚在一起', 'Early sailors navigated by recognizing familiar constellations.', '早期的水手靠辨认熟悉的星座来导航。'],
  ['nebula', 'ˈnebjələ', 'n. 星云', 'nebula 本义即“云”，星云就是太空中的云', 'New stars are born inside vast clouds of gas called nebulae.', '新恒星诞生于被称为星云的巨大气体云中。'],
  ['eclipse', 'ɪˈklɪps', 'n./v. 日食；月食；使黯然失色', 'ec（出）+ lipse（离开）→ 光离开', 'A total solar eclipse drew thousands of visitors to the region.', '一次日全食吸引数千名游客来到该地区。'],
  ['meteorite', 'ˈmiːtiəraɪt', 'n. 陨石', 'meteor（流星）+ ite（石头）', 'The meteorite left a crater nearly fifty meters wide.', '这块陨石留下了一个近五十米宽的陨石坑。'],
  ['rotation', 'rəʊˈteɪʃn', 'n. 旋转；（地球的）自转', 'rot（轮子）+ ation → 像轮子一样转', 'The rotation of the Earth causes day and night.', '地球的自转产生了昼夜。'],
  ['trajectory', 'trəˈdʒektəri', 'n. 轨道，轨迹', 'tra（横穿）+ ject（投掷）+ ory', 'Scientists calculated the trajectory of the asteroid precisely.', '科学家精确计算出了这颗小行星的轨道。'],
  ['terrestrial', 'təˈrestriəl', 'adj. 陆地的；地球的', 'terr（土地）+ estrial → 属于土地的', 'Plants evolved from aquatic species to terrestrial forms.', '植物从水生种类进化到陆生形态。'],
];

/** 普通卡组：note.data 是 JSON 字符串 */
const CARDS = WORDS.map((w, i) => ({
  id: 7000 + i,
  package_id: 9101,
  // 学习状态：0 未学 / 1·2·3 学习中 / 4 已掌握
  type: i < 3 ? 4 : i < 5 ? 1 : 0,
  menu_id: 1,
  note: {
    id: 8000 + i,
    name: w[0],
    data: JSON.stringify({
      word: w[0],
      phonetic: w[1],
      translation: w[2],
      memory_method: w[3],
      sentences: [{ english: w[4], chinese: w[5] }],
    }),
  },
}));

/**
 * 生词本走的是另一套解析：note.data 以 \u001F 分隔，
 * 字段序 0 单词 / 1 美音标 / 2 美音 / 3 英音标 / 4 英音 / 5 图片 / 6 中文释义 / 7 例句。
 * 用 JSON 格式喂生词本会解析出空释义。
 */
const US = '\u001f';
const BOOKMARK_PACK_ID = 5001;
const BOOKMARK_WORDS = [
  ['nebula', 'ˈnebjələ', 'n. 星云', 'New stars are born inside vast clouds of gas called nebulae.'],
  ['eclipse', 'ɪˈklɪps', 'n. 日食；月食', 'A total solar eclipse drew thousands of visitors to the region.'],
  ['trajectory', 'trəˈdʒektəri', 'n. 轨道，轨迹', 'Scientists calculated the trajectory of the asteroid precisely.'],
  ['terrestrial', 'təˈrestriəl', 'adj. 陆地的；地球的', 'Plants evolved from aquatic species to terrestrial forms.'],
];
const BOOKMARK_CARDS = BOOKMARK_WORDS.map((w, i) => ({
  id: 6000 + i,
  package_id: BOOKMARK_PACK_ID,
  type: 1,
  menu_id: 1,
  note: {
    id: 6500 + i,
    name: w[0],
    data: [w[0], w[1], '', '', '', '', w[2], w[3]].join(US),
  },
}));

const MENUS = [{ id: 1, name: '全部' }];

// ---------------------------------------------------------------- 配置

export default {
  url: 'http://localhost:8081',
  outputDir: 'AppStoreShots',

  // iPhone 6.5"/6.7"：428×926 CSS px × DPR 3 = 1284×2778 物理像素
  viewport: { width: 428, height: 926 },
  deviceScaleFactor: 3,
  locale: 'zh-CN',

  // 有数据才出现的文案，用来判断「已渲染完成」而不是盲等
  readyText: ['今日学习'],
  readyTimeoutMs: 180000,
  settleMs: 6000,

  // 首选 env 关掉浮窗；这里再兜一层，防止重渲染还原 inline style
  hideTexts: ['🛠 诊断'],

  // AuthContext 会同时写 @ciba_auth_token 和 @ciba_token 两套 key
  auth: {
    localStorage: {
      '@ciba_auth_token': 'mock-token',
      '@ciba_token': 'mock-token',
      '@ciba_user_info': USER,
    },
  },

  mockUrlPattern: '**/cibaen.com/api/**',
  mockApi: (url) => {
    const p = url.pathname;
    const parentId = Number(url.searchParams.get('parentId') || 0);

    if (p.endsWith('/users/my.json')) return { result: 0, user: USER };

    // 生词本第一步：取默认卡组 id
    if (p.includes('/anki/pack/flag/')) return { result: 0, pack: { id: BOOKMARK_PACK_ID } };

    // 卡组列表：parentId=0 是「我的卡组」，>0 是分类卡组
    if (p.endsWith('/anki/pack.json')) {
      const packs = parentId >= 1 ? SUB_PACKS : TOP_PACKS;
      return { result: 0, packs, total: packs.length };
    }

    if (p.endsWith('/anki/pack/in-store.json')) {
      return { result: 0, packs: TOP_PACKS.map((x) => ({ ...x, storeStatus: 2, cat_id: 4 })), total: TOP_PACKS.length };
    }

    const menu = p.match(/\/anki\/pack\/(\d+)\/menu\.json$/);
    if (menu) return { result: 0, menu: MENUS };

    const learn = p.match(/\/anki\/pack\/(\d+)\/(?:learn-by-menu|learn)\.json$/);
    if (learn) {
      if (Number(learn[1]) === BOOKMARK_PACK_ID) {
        return { result: 0, cards: BOOKMARK_CARDS, total: BOOKMARK_CARDS.length };
      }
      return { result: 0, cards: CARDS, total: CARDS.length };
    }

    const detail = p.match(/\/anki\/pack\/(\d+)\.json$/);
    if (detail) {
      const pack = ALL_PACKS.find((x) => Number(x.id) === Number(detail[1])) || SUB_PACKS[0];
      return { result: 0, pack };
    }

    return { result: 0 };
  },

  screens: [
    // 1) 分类首页：直接就是数据态
    { name: '01-home', file: '01-home.png', steps: [] },

    // 2) 单词列表：点子卡组的「单词列表」
    {
      name: '02-wordlist',
      file: '02-wordlist.png',
      steps: [
        { waitText: '分类卡组' },
        { click: '单词列表', afterMs: 2000 },
        { waitText: '搜索单词、释义或词根助记...' },
      ],
    },

    // 3) 闪卡背词：需要从首页重进（单词列表已把 Tab 顶掉了）
    {
      name: '03-flashcard',
      file: '03-flashcard.png',
      restart: true,
      steps: [
        { waitText: '开始背词' },
        { click: '开始背词', afterMs: 2500 },
        // 想截「翻开释义+助记」的那一面，取消下一行注释：
        // { click: '点击卡片查看中文释义与助记', afterMs: 800 },
      ],
    },

    // 4) 生词本 Tab
    {
      name: '04-bookmarks',
      file: '04-bookmarks.png',
      restart: true,
      steps: [
        { waitText: '今日学习' },
        { click: '生词本', exact: true, afterMs: 2500 },
        { waitText: '个单词' },
      ],
    },

    // 5) 生词复习（点第一张生词卡进入）
    {
      name: '05-bookmark-study',
      file: '05-bookmark-study.png',
      steps: [
        { click: 'nebula', afterMs: 2500 },
        { waitText: '生词复习' },
        // 想截翻开面：{ click: '点击卡片查看中文释义与助记', afterMs: 800 },
      ],
    },

    // 6) 我的 Tab
    {
      name: '06-profile',
      file: '06-profile.png',
      restart: true,
      steps: [
        { waitText: '今日学习' },
        { click: '我的', exact: true, afterMs: 2000 },
        { waitText: '学习统计' },
      ],
    },
  ],
};
