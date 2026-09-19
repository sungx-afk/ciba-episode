// 配色与 ciba-pc 全站主题（src/config/theme-unify.css）保持一致
// 主色 青蓝 #4A90A4 / 辅色 青绿 #6BB5A2 / 点缀 暖橙 #F4A261 / 危险 珊瑚红 #E76F51
export const Colors = {
  primary: '#4A90A4', // 青蓝
  primaryLight: '#EDF4F6', // 青蓝浅底（primary 10%）
  primaryDark: '#3D7D90', // 青蓝深（active）

  secondary: '#6BB5A2', // 青绿（success 同色）
  accent: '#F4A261', // 暖橙（warning 同色）
  coral: '#E76F51', // 珊瑚红（danger 同色）

  background: '#F8FBFC', // 页面底
  backgroundAlt: '#EEF5F7', // 区块交替底
  card: '#FFFFFF', // 卡片
  dark: '#2C5364', // 深色（深色卡/深色底）

  textPrimary: '#1E3A4C', // 标题
  textSecondary: '#35566A', // 正文
  textTertiary: '#5A7A8A', // 次要
  textMuted: '#8BA5B5', // 占位/弱化提示
  textDisabled: '#A8BFCB', // 禁用

  border: '#D4E5EB',
  borderStrong: '#C3D9E1',
  divider: '#E8F1F4', // 分隔线（比 border 更浅）

  // 分类识别色：同时用于小圆点底色和极小号文字，故在同色系上加深以保证可读性
  pinwheelGreen: '#4A9A85',
  pinwheelYellow: '#C97F3E',
  pinwheelBlue: '#3D7D90',
  pinwheelRed: '#E76F51',

  success: '#6BB5A2',
  warning: '#F4A261',
  danger: '#E76F51',
  info: '#4A90A4',

  darkCard: '#2C5364',
  gold: '#F4A261',
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
