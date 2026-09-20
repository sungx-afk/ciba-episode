// 配色主题：松墨绿 · 鎏金（Stone Pine & Champagne）
// 与 ciba-pc / 旧 ciba 的青蓝体系完全区分开：墨绿做主色稳重偏高端，鎏金做会员与点缀。
// 底色走暖石白（而非冷调蓝白），整体更接近「精装词典 / 学院派」的观感。
export const Colors = {
  primary: '#1B4B3F', // 松墨绿
  primaryLight: '#E9EFEA', // 松墨绿浅底（primary ~10%）
  primaryDark: '#143B31', // 松墨绿深（active）

  secondary: '#4E7C63', // 苔绿
  accent: '#C0923F', // 鎏金（会员 / 点缀）
  coral: '#B2503F', // 绛红

  background: '#F5F4EF', // 页面底（暖石白）
  backgroundAlt: '#EDEBE3', // 区块交替底
  card: '#FFFFFF', // 卡片
  surfaceSoft: '#F4F3ED', // 卡片内的浅米子区块（指标区 / 次级按钮）
  paper: '#FCF6E8', // 浅米黄宣纸底（提示卡）
  dark: '#10281F', // 深色（深色卡/深色底）

  textPrimary: '#17231E', // 标题
  textSecondary: '#3C4A43', // 正文
  textTertiary: '#63736B', // 次要
  textMuted: '#93A199', // 占位/弱化提示
  textDisabled: '#B4BFB8', // 禁用

  border: '#DDDBD0',
  borderStrong: '#C8C5B7',
  divider: '#EAE8DF', // 分隔线（比 border 更浅）

  // 分类识别色：同时用于小圆点底色和极小号文字，故在同色系上加深以保证可读性
  pinwheelGreen: '#2F6F4E',
  pinwheelYellow: '#C0923F',
  pinwheelBlue: '#3C6E8F',
  pinwheelRed: '#B2503F',

  success: '#3F7A57',
  warning: '#C0923F',
  danger: '#B2503F',
  info: '#1B4B3F',

  darkCard: '#10281F', // 会员卡/结算页深色底
  gold: '#C0923F', // 会员金（等于 accent，语义上单独命名）
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
