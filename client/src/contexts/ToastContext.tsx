import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

export interface ConfirmDialog {
  message: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
  pauseToast: (id: string) => void;
  resumeToast: (id: string) => void;
  confirm: (message: string) => Promise<boolean>;
  confirmDialog: ConfirmDialog | null;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const addToast = useCallback((type: ToastType, message: string, duration?: number) => {
    // 错误默认 15 秒，其他 5 秒
    const defaultDuration = type === 'error' ? 15000 : 5000;
    const dur = duration ?? defaultDuration;
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setToasts((prev) => [...prev, { id, type, message, duration: dur }]);

    if (dur > 0) {
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        timersRef.current.delete(id);
      }, dur);
      timersRef.current.set(id, timer);
    }
  }, []);

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pauseToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
  }, []);

  const resumeToast = useCallback((id: string) => {
    setToasts((prev) => {
      const toast = prev.find((t) => t.id === id);
      if (!toast || toast.duration <= 0) return prev;
      const timer = setTimeout(() => {
        setToasts((p) => p.filter((t) => t.id !== id));
        timersRef.current.delete(id);
      }, toast.duration);
      timersRef.current.set(id, timer);
      return prev;
    });
  }, []);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmDialog({
        message,
        onConfirm: () => { setConfirmDialog(null); resolve(true); },
        onCancel: () => { setConfirmDialog(null); resolve(false); },
      });
    });
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, pauseToast, resumeToast, confirm, confirmDialog }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

// Helper hook for common error handling
export function useErrorHandler() {
  const { addToast } = useToast();

  const handleError = useCallback((error: unknown, fallbackMessage?: string) => {
    const message = error instanceof Error ? error.message : fallbackMessage || '发生未知错误';
    addToast('error', message);
    return error;
  }, [addToast]);

  return handleError;
}
