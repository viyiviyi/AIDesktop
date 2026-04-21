import { useDesktop } from '../contexts/DesktopContext';
import { LogPanel } from './LogPanel';

export function LogWindow() {
  const { state, closeWindow } = useDesktop();

  // Find the log window state
  const windowState = state.windows.find((w) => w.appId === 'logs');

  if (!windowState) return null;

  return (
    <LogPanel onClose={() => closeWindow(windowState.id)} />
  );
}
