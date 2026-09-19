/**
 * 极简全局 Toast：任何模块直接 showToast()，由 App 里挂载的 ToastHost 负责显示。
 * 不依赖导航栈，所以在任意页面/组件里都能调用。
 */

export type ToastType = 'success' | 'info';

export interface ToastPayload {
  message: string;
  type: ToastType;
}

type Listener = (payload: ToastPayload) => void;

let listener: Listener | null = null;

/** 供 ToastHost 注册/注销监听 */
export function registerToastListener(next: Listener | null) {
  listener = next;
}

/** 弹出一条 Toast */
export function showToast(message: string, type: ToastType = 'success') {
  listener?.({ message, type });
}
