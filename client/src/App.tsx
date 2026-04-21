import { DesktopProvider } from './contexts/DesktopContext';
import { ToastProvider } from './contexts/ToastContext';
import { MenuBar } from './components/MenuBar';
import { Desktop } from './components/Desktop';
import { Dock } from './components/Dock';
import { StartMenu } from './components/StartMenu';
import { ToastContainer } from './components/ToastContainer';
import './styles/global.css';

function App() {
  return (
    <ToastProvider>
      <DesktopProvider>
        <MenuBar />
        <Desktop />
        <Dock />
        <StartMenu />
        <ToastContainer />
      </DesktopProvider>
    </ToastProvider>
  );
}

export default App;
