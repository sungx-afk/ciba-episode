// 配色主题：学习绿 · 米金（Study Green & Champagne）
// 主色与首页头图（header-study.jpg：奶油白书桌 + 英语书 + 绿植的明亮学习场景）同一色相族，
// 把明度压到能承载文字的深度，饱和度保持偏低，整体是「白纸 + 一点绿」的清爽观感。
// 底色走暖石白（而非冷调蓝白），鎏金只做会员与点缀。
export const Colors = {
  primary: '#3B6848', // 远山苍绿
  primaryLight: '#EAF1EC', // 苍绿浅底（primary ~10%）
  primaryDark: '#2E563A', // 苍绿深（active）

  secondary: '#5C8A6E', // 苔绿
  accent: '#C29A4E', // 鎏金（会员 / 点缀）
  coral: '#AC5C4C', // 绛红

  background: '#F5F4EF', // 页面底（暖石白）
  backgroundAlt: '#ECEEE7', // 区块交替底
  card: '#FFFFFF', // 卡片
  surfaceSoft: '#F1F5F1', // 卡片内的浅米子区块（指标区 / 次级按钮）
  paper: '#FCF6E8', // 浅米黄宣纸底（提示卡）
  dark: '#263D2E', // 深色（深色卡/深色底）

  textPrimary: '#1F2B24', // 标题
  textSecondary: '#46534C', // 正文
  textTertiary: '#6B7A73', // 次要
  textMuted: '#9AA79F', // 占位/弱化提示
  textDisabled: '#BAC4BC', // 禁用

  border: '#D9DED6',
  borderStrong: '#C3CABC',
  divider: '#E8EDE7', // 分隔线（比 border 更浅）

  // 分类识别色：同时用于小圆点底色和极小号文字，故在同色系上加深以保证可读性
  pinwheelGreen: '#3F7A55',
  pinwheelYellow: '#C29A4E',
  pinwheelBlue: '#4F7F9A',
  pinwheelRed: '#AC5C4C',

  success: '#4A8362',
  warning: '#C29A4E',
  warningDeep: '#8F6A22', // 鎏金加深，用于需要承载白色文字的实心块
  danger: '#AC5C4C',
  info: '#3B6848',

  darkCard: '#263D2E', // 会员卡/结算页深色底
  gold: '#C29A4E', // 会员金（等于 accent，语义上单独命名）
};

const PINWHEEL_COLORS = [
  Colors.pinwheelYellow,
  Colors.pinwheelGreen,
  Colors.pinwheelBlue,
  Colors.pinwheelRed,
];

// 根据分类名称推导稳定的识别色（不使用随机 hash）
export function getCategoryColor(categoryName: string): string {
  if (!categoryName) return Colors.primary;
  let sum = 0;
  for (let i = 0; i < categoryName.length; i++) {
    sum += categoryName.charCodeAt(i);
  }
  return PINWHEEL_COLORS[sum % PINWHEEL_COLORS.length];
}
