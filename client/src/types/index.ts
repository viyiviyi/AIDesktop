// Content types
export type ContentType = 'text' | 'image' | 'audio' | 'video' | 'file';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  url: string;
  alt?: string;
}

export interface AudioContent {
  type: 'audio';
  url: string;
}

export interface VideoContent {
  type: 'video';
  url: string;
}

export interface FileContent {
  type: 'file';
  path: string;
  name: string;
  size: number;
}

export type Content = TextContent | ImageContent | AudioContent | VideoContent | FileContent;

// Message
export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: Content[];
  timestamp: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  tool: string;
  method: string;
  args: Record<string, unknown>;
}

// Conversation
export interface Conversation {
  id: string;
  appId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

// App types
export type AppSource = 'system' | 'user' | 'marketplace';
export type AppType = 'desktop' | 'background';

export interface ModelConfig {
  provider: string;
  model: string;
  priority: number;
  maxTokens: number;
  supports: ContentType[];
  params: {
    temperature?: number;
    top_p?: number;
  };
}

export interface AppInfo {
  id: string;
  name: string;
  description: string;
  source: AppSource;
  type: AppType;
  icon: string;
}

export interface App extends AppInfo {
  backgroundImage?: string;
  models: ModelConfig[];
  supportedInputs: ContentType[];
  inputDescription: string;
  outputDescription: string;
  visibleApps: string[];
  visibleServices: string[];
  tools: string[];
  appMd?: string;
}

// Desktop Settings
export interface DockSettings {
  position: 'bottom' | 'left' | 'right';
  magnification: boolean;
  autoHide: boolean;
}

export interface WindowSettings {
  defaultSize: { width: number; height: number };
  minSize: { width: number; height: number };
  maximized: boolean;
}

export interface MenuBarSettings {
  autoHide: boolean;
}

export interface StartMenuSettings {
  width: number;
  height: number;
}

export interface DesktopSettings {
  theme: 'light' | 'dark' | 'auto';
  wallpaper: string;
  dock: DockSettings;
  window: WindowSettings;
  menuBar: MenuBarSettings;
  startMenu: StartMenuSettings;
}

// Model Provider
export interface ModelProvider {
  name: string;
  apiKey?: string;
  baseUrl?: string;
}

// MCP
export interface MCPService {
  name: string;
  description: string;
  methods: string[];
}

export interface MCPConnection {
  id: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  services: MCPService[];
}

// Skill
export interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

// Window State
export interface WindowState {
  id: string;
  appId: string;
  title: string;
  icon: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  isMaximized: boolean;
  isMinimized: boolean;
  zIndex: number;
  conversationId?: string;
}

// Desktop State
export interface DesktopState {
  settings: DesktopSettings;
  installedApps: AppInfo[];
  windows: WindowState[];
  focusedWindowId: string | null;
  startMenuOpen: boolean;
  startMenuMode: 'click' | 'voice';
  taskbarApps: string[];
}
