// components/ConfirmDialog.tsx
import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../theme/colors';

/**
 * 通用弹窗内容：App 内所有二次确认 / 重要提示都走这个组件，不再使用系统 Alert，
 * 保证各页面的弹窗样式与交互一致。
 */
export interface DialogPayload {
  title: string;
  message: string;
  /** 「确定」按钮文案，默认「确定」 */
  confirmText?: string;
  /** 「取消」按钮文案，默认「取消」 */
  cancelText?: string;
  /** false 时只保留「确定」，用作纯提示弹窗，默认 true */
  showCancel?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  /**
   * 关闭弹窗：父级用它把 visible 对应的 state 置回 false。
   * 组件自己不能关闭弹窗，所以「确定 / 取消」按下时都会先调它再执行业务回调，
   * 保证纯提示弹窗（没写 onConfirm）也能被关掉，不会卡住页面。
   */
  onClose?: () => void;
}

interface ConfirmDialogProps extends DialogPayload {
  visible: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  visible,
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  showCancel = true,
  onConfirm,
  onCancel,
  onClose,
}) => {
  // 先关弹窗再跑业务回调：业务回调里如果又开了新弹窗，不会被这一步覆盖掉
  const handleConfirm = () => {
    onClose?.();
    onConfirm?.();
  };

  const handleCancel = () => {
    onClose?.();
    onCancel?.();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={handleCancel}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.buttonRow}>
            {showCancel ? (
              <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
                <Text style={styles.cancelText}>{cancelText}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm}>
              <Text style={styles.confirmText}>{confirmText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  dialog: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 320,
  },
  title: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary, marginBottom: 8 },
  message: { fontSize: 14, color: Colors.textSecondary, marginBottom: 20, lineHeight: 20 },
  buttonRow: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: Colors.divider, alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  confirmBtn: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: Colors.pinwheelRed, alignItems: 'center' },
  confirmText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
});
