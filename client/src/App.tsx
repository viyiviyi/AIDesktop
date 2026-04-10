import { DesktopProvider } from './contexts/DesktopContext';
import { MenuBar } from './components/MenuBar';
import { Desktop } from './components/Desktop';
import { Dock } from './components/Dock';
import { StartMenu } from './components/StartMenu';
import './styles/global.css';

function App() {
  return (
    <DesktopProvider>
      <MenuBar />
      <Desktop />
      <Dock />
      <StartMenu />
    </DesktopProvider>
  );
}

export default App;
