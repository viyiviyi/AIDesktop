/**
 * EventBus — 全局事件总线
 *
 * Agent 产生的所有事件都推送到这里，WebSocket 服务从这里读取并推送给前端。
 * 未来 agent 调用应用、工具执行等事件都通过这个总线分发。
 */

export type ConvEventType =
  | 'thinking'
  | 'message_start'
  | 'message_update'
  | 'text_chunk'
  | 'message_end'
  | 'tool_call'
  | 'tool_result'
  | 'done'
  | 'error'
  | 'user_input_request'
  | 'user_input_response'
  | 'agent_call_start'
  | 'agent_call_end'
  | 'agent_call_end_auto'
  | 'form_request'
  | 'form_response'
  | 'form_cancelled';

export interface ConvEvent {
  type: ConvEventType;
  appId: string;
  convId: string;
  data: Record<string, unknown>;
}

type Listener = (event: ConvEvent) => void;

class EventBusClass {
  private listeners = new Map<string, Set<Listener>>();

  /** 订阅指定会话的事件 */
  subscribe(convId: string, listener: Listener): () => void {
    if (!this.listeners.has(convId)) {
      this.listeners.set(convId, new Set());
    }
    this.listeners.get(convId)!.add(listener);
    return () => {
      this.listeners.get(convId)?.delete(listener);
    };
  }

  /** 订阅所有会话的事件（用于 WebSocket 广播） */
  subscribeAll(listener: Listener): () => void {
    const id = '__all__';
    if (!this.listeners.has(id)) {
      this.listeners.set(id, new Set());
    }
    this.listeners.get(id)!.add(listener);
    return () => {
      this.listeners.get(id)?.delete(listener);
    };
  }

  /** 推送事件到总线 */
  emit(event: ConvEvent): void {
    // 通知该 conv 的订阅者
    const convListeners = this.listeners.get(event.convId);
    if (convListeners) {
      for (const listener of convListeners) {
        try { listener(event); } catch { /* ignore */ }
      }
    }
    // 通知全局订阅者
    const allListeners = this.listeners.get('__all__');
    if (allListeners) {
      for (const listener of allListeners) {
        try { listener(event); } catch { /* ignore */ }
      }
    }
  }
}

export const eventBus = new EventBusClass();
