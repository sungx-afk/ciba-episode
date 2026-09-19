// components/ActionSheet.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../theme/colors';

/**
 * 底部动作菜单（对应 web / 小程序的 ActionSheet）：
 * 卡片右上角设置、列表长按等操作统一走这里，样式为白底圆角面板 + 分隔线 + 底部「取消」。
 *
 * 注意：这里刻意不用 RN Modal。原因是菜单项点了之后往往要打开设置面板 / 二次确认（它们都是 Modal），
 * iOS 上「同一时间关一个 Modal 再 present 另一个」会被 UIKit 吞掉，表现为点了菜单项没反应。
 * 改成页面内的动画浮层后就只剩下一个 Modal 参与 present，不会再冲突。
 */
export interface ActionSheetItem {
  key: string;
  name: string;
  /** 危险操作（删除等）用红色文字，默认与其它项一致 */
  danger?: boolean;
}

interface ActionSheetProps {
  visible: boolean;
  items: ActionSheetItem[];
  onSelect: (key: string) => void;
  onClose: () => void;
  /** 取消项文案，默认「取消」 */
  cancelText?: string;
}

/** 每行高度，同时用于估算面板高度（首次动画用） */
const ITEM_HEIGHT = 56;
/** 取消块与上方选项块的间距 */
const CANCEL_GAP = 8;
const DURATION_IN = 240;
const DURATION_OUT = 200;

/** 面板高度估算：菜单项 + 取消 + 间距 + 底部安全区 */
const estimateHeight = (count: number, bottomInset: number) =>
  (count + 1) * ITEM_HEIGHT + CANCEL_GAP * 2 + bottomInset + 16;

export const ActionSheet: React.FC<ActionSheetProps> = ({
  visible,
  items,
  onSelect,
  onClose,
  cancelText = '取消',
}) => {
  const insets = useSafeAreaInsets();
  /** 面板高度：先估算，渲染后按实际高度修正 */
  const panelHeightRef = useRef(estimateHeight(items.length, insets.bottom));
  const translateY = useRef(new Animated.Value(panelHeightRef.current)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  // 隐藏要经过退场动画，所以不能直接用 visible 控制渲染
  const [mounted, setMounted] = useState(visible);
  /** effect 里判断「此刻是否该显示」，避免退场动画的回调把刚重新打开的菜单又卸载掉 */
  const visibleRef = useRef(visible);
  /** 卸载兜底：动画回调万一不触发，也要保证浮层被移除，不能留在屏幕上挡住整页点击 */
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const handlePanelLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) panelHeightRef.current = h;
  };

  // 离开页面/组件卸载时清掉兜底定时器
  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    []
  );

  useEffect(() => {
    visibleRef.current = visible;
    if (visible) {
      clearHideTimer();
      // 还没挂载时先挂载，挂载完（下一轮 effect）再播进场动画
      if (!mounted) {
        setMounted(true);
        return;
      }
      translateY.stopAnimation();
      backdropOpacity.stopAnimation();
      translateY.setValue(panelHeightRef.current);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: DURATION_IN,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: DURATION_IN,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }
    if (!mounted) return;
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: panelHeightRef.current,
        duration: DURATION_OUT,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: DURATION_OUT,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // 期间又被打开的话（退场动画没跑完就再次点右上角），就不能卸载
      if (!visibleRef.current) setMounted(false);
    });
    // 兜底：动画回调没来也必须卸载，否则浮层留在屏幕上会让整个页面点不动
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      if (!visibleRef.current) setMounted(false);
    }, DURATION_OUT + 150);
  }, [visible, mounted, translateY, backdropOpacity]);

  if (!mounted) return null;

  return (
    // 关闭过程中立刻放通触摸：哪怕浮层还在播退场动画，也不会挡住页面上的点击
    <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <TouchableOpacity style={styles.backdropTouchable} activeOpacity={1} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          { paddingBottom: CANCEL_GAP + insets.bottom, transform: [{ translateY }] },
        ]}
        onLayout={handlePanelLayout}
      >
        <View style={styles.group}>
          {items.map((item, index) => (
            <TouchableOpacity
              key={item.key}
              style={[styles.item, index > 0 && styles.itemDivider]}
              activeOpacity={0.7}
              onPress={() => onSelect(item.key)}
            >
              <Text style={[styles.itemText, item.danger && styles.itemTextDanger]}>
                {item.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 取消单独一块，加粗，和上面的选项拉开距离（必须带 item 的高度与居中，否则会塌成一行文字高、文字贴左） */}
        <TouchableOpacity
          style={[styles.group, styles.item, styles.cancelGroup]}
          activeOpacity={0.75}
          onPress={onClose}
        >
          <Text style={styles.cancelText}>{cancelText}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  // 覆盖整屏的浮层，作为最后渲染的兄弟节点盖在页面内容之上
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 999,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  backdropTouchable: {
    flex: 1,
  },
  panel: {
    paddingHorizontal: CANCEL_GAP,
  },
  group: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    overflow: 'hidden',
  },
  cancelGroup: {
    marginTop: CANCEL_GAP,
  },
  item: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
  },
  itemText: {
    fontSize: 17,
    color: Colors.textPrimary,
  },
  itemTextDanger: {
    color: Colors.danger,
  },
  cancelText: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
});
