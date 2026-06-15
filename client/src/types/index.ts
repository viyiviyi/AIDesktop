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

/** Assistant 消息中的 ToolCall 块（映射 pi-ai 的 ToolCall） */
export interface ToolCallBlock {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 工具调用结果记录（存储会话时使用） */
export interface ToolResultContent {
  type: 'tool_result';
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

/** AI 思考过程内容块 */
export interface ThinkingContent {
  type: 'thinking';
  text: string;
}

export type Content = TextContent | ImageContent | AudioContent | VideoContent | FileContent | ToolCallBlock | ToolResultContent | ThinkingContent;

// Message
export type MessageRole = 'user' | 'assistant' | 'system' | 'toolResult';

export interface ToolResultMeta {
  toolCallId: string;
  toolName: string;
  isError: boolean;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: Content[];
  timestamp: string;
  toolCalls?: ToolCall[];
  toolResultMeta?: ToolResultMeta;
  replyTo?: string;
  edited?: boolean;
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
  source?: 'user' | 'agent' | 'system';
  callChain?: Array<{ callerAppId: string; callerConvId?: string; callId?: string; timestamp: string }>;
  pendingUserInput?: string | null;
}

// App types
export type AppSource = 'system' | 'user' | 'marketplace';
export type AppType = 'desktop' | 'background';

// Model parameter entry with enable toggle
export interface ModelParam {
  key: string;
  value: string;
  enabled: boolean;
}

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
  overrideParams?: boolean;
  headerParams?: ModelParam[];
  bodyParams?: ModelParam[];
}

export interface AppInfo {
  id: string;
  name: string;
  description: string;
  source: AppSource;
  type: AppType;
  icon: string;
  backgroundImage?: string;
  models: ModelConfig[];
  supportedInputs: ContentType[];
  inputDescription: string;
  outputDescription: string;
  visibleApps: string[];
  visibleServices: string[];
  tools: string[];
  enabled?: boolean;
}

export interface AppConfig {
  enabled?: boolean;
  backgroundImage?: string;
  supportedInputs?: ContentType[];
  inputDescription?: string;
  outputDescription?: string;
  visibleApps?: string[];
  visibleServices?: string[];
  tools?: string[];
  models?: ModelConfig[];
}

export interface App {
  meta: AppInfo;
  appMd: string;
  mcpServices: string[];
  skills: string[];
  config: AppConfig;
}

// Skills
export interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

// Settings
export interface MCPConnection {
  id: string;
  name: string;
  transportType: 'stdio' | 'sse' | 'http';
  command: string;
  args: string[];
  url?: string;
  headers?: Array<{ key: string; value: string }>;
  enabled: boolean;
  services: Array<{ name: string; description: string; methods: string[] }>;
  enabledTools?: string[];
}

export interface ProviderModel {
  id: string;
  name: string;
  maxTokens: number;
  supports: ContentType[];
  params: {
    temperature?: number;
    top_p?: number;
  };
  headerParams?: ModelParam[];
  bodyParams?: ModelParam[];
}

export interface ModelProvider {
  id: string;
  name: string;
  apiType: string;
  apiKey?: string;
  baseUrl?: string;
  enabled: boolean;
  models: ProviderModel[];
}

// Desktop settings
export interface WindowSettings {
  defaultSize: { width: number; height: number };
  minSize: { width: number; height: number };
  maximized: boolean;
}

export interface DockSettings {
  position: 'bottom' | 'left' | 'right';
  magnification: boolean;
  autoHide: boolean;
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

export interface WindowState {
  id: string;
  title: string;
  app?: AppInfo;
  icon: string;
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
  minSize: { width: number; height: number };
  type?: 'startMenu' | 'settings' | 'app';
}
