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
  /** When true, use app-level header/body params instead of provider defaults */
  overrideParams?: boolean;
  /** App-level extra header params (only used when overrideParams is true) */
  headerParams?: ModelParam[];
  /** App-level extra body params (only used when overrideParams is true) */
  bodyParams?: ModelParam[];
}

export interface AppMeta {
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

export interface App {
  meta: AppMeta;
  appMd: string;
  mcpServices: string[];
  skills: string[];
  allowConfig?: AllowConfig;
}

// Skills
export interface Skill {
  id: string;
  name: string;
  prompt: string;
  config: Record<string, unknown>;
}

// Allow config
export type AllowMode = 'allow_all' | 'deny_all' | 'ask';

export interface AllowConfig {
  mode: AllowMode;
  allowedPaths: string[];
  deniedPaths: string[];
  allowedApps: string[];
  deniedApps: string[];
  allowedCommands: string[];
  deniedCommands: string[];
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

export interface MCPConfig {
  connections: MCPConnection[];
}

// Skill
export interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface SkillConfig {
  skills: Skill[];
  globalEnabled: boolean;
}

// Settings
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

// Model
export type ApiCompatType = 'openai' | 'anthropic' | 'custom';

// Model parameter entry with enable toggle
export interface ModelParam {
  key: string;
  value: string;
  enabled: boolean;
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
  /** Provider-level extra parameters sent as HTTP headers */
  headerParams?: ModelParam[];
  /** Provider-level extra parameters sent as request body fields */
  bodyParams?: ModelParam[];
}

export interface ModelProvider {
  id: string;
  name: string;
  apiType: ApiCompatType;
  apiKey?: string;
  baseUrl?: string;
  enabled: boolean;
  models: ProviderModel[];
}

// Chat
export interface ChatParams {
  model: string;
  messages: Message[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  tools?: Tool[];
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatResponse {
  content: Content[];
  toolCalls?: ToolCall[];
}

export type ChatStreamEvent =
  | { type: 'content'; content: Content }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'done' }
  | { type: 'error'; error: string };
