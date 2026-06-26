import { useToast, type ToastType } from '../contexts/ToastContext';

export function ToastContainer() {
  const { toasts, removeToast, confirmDialog, pauseToast, resumeToast } = useToast();

  const getToastIcon = (type: ToastType) => {
    switch (type) {
      case 'success': return '✓';
      case 'error': return '✕';
      case 'warning': return '⚠';
      case 'info': return 'ℹ';
    }
  };

  return (
    <>
      {/* 确认对话框 */}
      {confirmDialog && (
        <div className="confirm-overlay" onClick={confirmDialog.onCancel}>
          <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="confirm-message">{confirmDialog.message}</div>
            <div className="confirm-actions">
              <button className="confirm-btn confirm-cancel" onClick={confirmDialog.onCancel}>取消</button>
              <button className="confirm-btn confirm-ok" onClick={confirmDialog.onConfirm}>确定</button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-container">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.type}`}
            onMouseEnter={() => pauseToast(toast.id)}
            onMouseLeave={() => resumeToast(toast.id)}
          >
            <span className="toast-icon">{getToastIcon(toast.type)}</span>
            <span className="toast-message">{toast.message}</span>
            <button
              className="toast-close"
              onClick={() => removeToast(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
