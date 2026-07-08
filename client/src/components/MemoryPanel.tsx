import { useState, useEffect } from 'react';
import {
  listMemories,
  rememberMemory,
  forgetMemory,
  getActiveGoals,
  getArchivedGoals,
  setGoal,
  completeGoal,
  type MemoryEntry,
} from '../services/api';

interface MemoryPanelProps {
  appId: string;
  convId?: string | null;
  scope: 'app' | 'conversation';
  /** 是否显示目标管理（只有 scope=conversation 时才为 true） */
  showGoals?: boolean;
  onClose?: () => void;
}

export function MemoryPanel({ appId, convId, scope, showGoals, onClose: _onClose }: MemoryPanelProps) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [goals, setGoals] = useState<{ level1?: { value: string }; level2?: { value: string }; level3?: { value: string } } | null>(null);
  const [archivedGoals, setArchivedGoals] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newImportance, setNewImportance] = useState<'low' | 'normal' | 'high'>('normal');
  const [newGoalLevel, setNewGoalLevel] = useState<1 | 2 | 3>(3);
  const [newGoalValue, setNewGoalValue] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [editGoalTab, setEditGoalTab] = useState<'active' | 'archived'>('active');

  useEffect(() => {
    loadData();
  }, [appId, convId, scope]);

  async function loadData() {
    setIsLoading(true);
    try {
      const entriesData = await listMemories(appId, scope, convId || undefined);
      setEntries(Array.isArray(entriesData) ? entriesData : []);

      if (showGoals && convId) {
        const [activeGoals, archived] = await Promise.all([
          getActiveGoals(appId, convId),
          getArchivedGoals(appId, convId),
        ]);
        setGoals(activeGoals || {});
        setArchivedGoals(Array.isArray(archived) ? archived : []);
      }
    } catch (e) {
      console.error('Failed to load memory data:', e);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAddMemory() {
    if (!newKey.trim() || !newValue.trim()) return;
    try {
      await rememberMemory(appId, scope, {
        type: 'fact',
        key: newKey.trim(),
        value: newValue.trim(),
        content: newContent.trim() || undefined,
        importance: newImportance,
        source: 'user',
      }, convId || undefined);
      setNewKey('');
      setNewValue('');
      setNewContent('');
      setNewImportance('normal');
      setShowAddForm(false);
      await loadData();
    } catch (e) {
      console.error('Failed to add memory:', e);
    }
  }

  async function handleDeleteMemory(id: string) {
    try {
      await forgetMemory(appId, scope, id, convId || undefined);
      await loadData();
    } catch (e) {
      console.error('Failed to delete memory:', e);
    }
  }

  async function handleSetGoal() {
    if (!newGoalValue.trim() || !convId) return;
    try {
      await setGoal(appId, convId, newGoalLevel, newGoalValue.trim(), 'user');
      setNewGoalValue('');
      setShowGoalForm(false);
      await loadData();
    } catch (e) {
      console.error('Failed to set goal:', e);
    }
  }

  async function handleCompleteGoal(level: number) {
    if (!convId) return;
    try {
      await completeGoal(appId, convId, level as 1|2|3);
      await loadData();
    } catch (e) {
      console.error('Failed to complete goal:', e);
    }
  }

  const importanceColor = (imp?: string) => {
    switch (imp) {
      case 'high': return 'var(--error-color)';
      case 'normal': return 'var(--accent-color)';
      case 'low': return 'var(--text-secondary)';
      default: return 'var(--text-secondary)';
    }
  };
  const importanceLabel = (imp?: string) => {
    switch (imp) {
      case 'high': return '重要';
      case 'normal': return '普通';
      case 'low': return '低';
      default: return '-';
    }
  };

  if (isLoading) {
    return <div className="memory-panel-loading">加载中...</div>;
  }

  return (
    <div className="memory-panel">
      {/* 目标管理（仅会话级） */}
      {showGoals && convId && (
        <div className="memory-panel-section">
          <div className="memory-panel-section-header">
            <h4>会话目标</h4>
            <button className="memory-panel-btn-sm" onClick={() => setShowGoalForm(!showGoalForm)}>
              {showGoalForm ? '取消' : '+ 新目标'}
            </button>
          </div>

          {showGoalForm && (
            <div className="memory-panel-add-form">
              <div className="memory-panel-field-row">
                <select
                  value={newGoalLevel}
                  onChange={(e) => setNewGoalLevel(Number(e.target.value) as 1|2|3)}
                  className="memory-panel-select-sm"
                >
                  <option value={3}>三级目标（当前待办）</option>
                  <option value={2}>二级目标</option>
                  <option value={1}>一级目标</option>
                </select>
                <input
                  type="text"
                  placeholder="目标描述"
                  value={newGoalValue}
                  onChange={(e) => setNewGoalValue(e.target.value)}
                  className="memory-panel-input"
                />
                <button className="memory-panel-btn-sm memory-panel-btn-primary" onClick={handleSetGoal}>添加</button>
              </div>
            </div>
          )}

          {/* 目标 Tab */}
          <div className="memory-panel-tabs">
            <button
              className={`memory-panel-tab ${editGoalTab === 'active' ? 'active' : ''}`}
              onClick={() => setEditGoalTab('active')}
            >
              活跃目标
            </button>
            <button
              className={`memory-panel-tab ${editGoalTab === 'archived' ? 'active' : ''}`}
              onClick={() => setEditGoalTab('archived')}
            >
              已完成 ({archivedGoals.length})
            </button>
          </div>

          {editGoalTab === 'active' ? (
            <div className="memory-panel-goals">
              {goals?.level1 && (
                <div className="memory-panel-goal-item">
                  <div className="memory-panel-goal-level">一级</div>
                  <div className="memory-panel-goal-value">{goals.level1.value}</div>
                  <button className="memory-panel-btn-icon" onClick={() => handleCompleteGoal(1)} title="标记完成">✅</button>
                </div>
              )}
              {goals?.level2 && (
                <div className="memory-panel-goal-item">
                  <div className="memory-panel-goal-level">二级</div>
                  <div className="memory-panel-goal-value">{goals.level2.value}</div>
                  <button className="memory-panel-btn-icon" onClick={() => handleCompleteGoal(2)} title="标记完成">✅</button>
                </div>
              )}
              {goals?.level3 && (
                <div className="memory-panel-goal-item">
                  <div className="memory-panel-goal-level">三级</div>
                  <div className="memory-panel-goal-value">{goals.level3.value} <span className="memory-panel-goal-current">当前待办</span></div>
                  <button className="memory-panel-btn-icon" onClick={() => handleCompleteGoal(3)} title="标记完成">✅</button>
                </div>
              )}
              {!goals?.level1 && !goals?.level2 && !goals?.level3 && (
                <div className="memory-panel-empty">暂无活跃目标</div>
              )}
            </div>
          ) : (
            <div className="memory-panel-goals">
              {archivedGoals.length === 0 ? (
                <div className="memory-panel-empty">暂无已完成目标</div>
              ) : (
                archivedGoals.map((g: any, i: number) => (
                  <div key={i} className="memory-panel-goal-item archived">
                    <div className="memory-panel-goal-level">{g.level === 1 ? '一级' : g.level === 2 ? '二级' : '三级'}</div>
                    <div className="memory-panel-goal-value">{g.value}</div>
                    <div className="memory-panel-goal-time">{new Date(g.completedAt || g.updatedAt).toLocaleString('zh-CN')}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* 记忆条目列表 */}
      <div className="memory-panel-section">
        <div className="memory-panel-section-header">
          <h4>{scope === 'app' ? '应用级记忆' : '会话记忆'} ({entries.length})</h4>
          <button className="memory-panel-btn-sm" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? '取消' : '+ 添加'}
          </button>
        </div>

        {showAddForm && (
          <div className="memory-panel-add-form">
            <input
              type="text" placeholder="Key（如 user.name）" value={newKey}
              onChange={(e) => setNewKey(e.target.value)} className="memory-panel-input"
            />
            <input
              type="text" placeholder="Value（如 小明）" value={newValue}
              onChange={(e) => setNewValue(e.target.value)} className="memory-panel-input"
            />
            <input
              type="text" placeholder="描述（可选）" value={newContent}
              onChange={(e) => setNewContent(e.target.value)} className="memory-panel-input"
            />
            <div className="memory-panel-field-row">
              <select value={newImportance} onChange={(e) => setNewImportance(e.target.value as any)} className="memory-panel-select-sm">
                <option value="low">低</option>
                <option value="normal">普通</option>
                <option value="high">重要</option>
              </select>
              <button className="memory-panel-btn-sm memory-panel-btn-primary" onClick={handleAddMemory}>保存</button>
            </div>
          </div>
        )}

        <div className="memory-panel-list">
          {entries.length === 0 ? (
            <div className="memory-panel-empty">暂无记忆</div>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="memory-panel-item">
                <div className="memory-panel-item-header">
                  <span className="memory-panel-item-key">{entry.key}</span>
                  <span className="memory-panel-item-importance" style={{ color: importanceColor(entry.importance) }}>
                    {importanceLabel(entry.importance)}
                  </span>
                  <button className="memory-panel-btn-icon" onClick={() => handleDeleteMemory(entry.id)} title="删除">🗑️</button>
                </div>
                <div className="memory-panel-item-value">{entry.value}</div>
                {entry.content && <div className="memory-panel-item-desc">{entry.content}</div>}
                <div className="memory-panel-item-time">{new Date(entry.updatedAt).toLocaleString('zh-CN')}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
