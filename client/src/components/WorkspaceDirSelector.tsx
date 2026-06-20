import React, { useState, useCallback } from 'react';

interface WorkspaceDirSelectorProps {
  appId: string;
  convId: string;
  toolCallId: string;
  /** 发起请求时试图访问的路径 */
  requestedPath?: string;
  onSubmitted: (path: string) => void;
  onCancelled: () => void;
}

/** 从路径中按层级拆分出各上级目录，区分 Windows 和 Unix/WSL 路径格式 */
function getHierarchyLevels(requestedPath: string): string[] {
  const levels: string[] = [];

  // 判断是否是 Windows 路径（如 C:\dir1\dir2 或 C:/dir1/dir2）
  const isWindowsPath = /^[A-Za-z]:[/\\]/i.test(requestedPath);

  if (isWindowsPath) {
    // Windows 路径：C:\dir1\dir2 → 拆分出 C:\dir1\dir2, C:\dir1, C:\
    const normalized = requestedPath.replace(/[\\/]+$/, '');
    const colonIdx = normalized.indexOf(':');
    const driveLetter = normalized.slice(0, colonIdx + 1); // "C:"
    const rest = normalized.slice(colonIdx + 1).replace(/\\/g, '/');
    const parts = rest.split('/').filter(Boolean);

    // 从最深到最浅生成
    for (let i = parts.length; i >= 0; i--) {
      const suffix = parts.slice(0, i).join('\\');
      const level = suffix ? `${driveLetter}\\${suffix}` : `${driveLetter}\\`;
      levels.push(level);
    }
  } else {
    // Unix/WSL 路径，如 /mnt/c/apps/my-project 或 /home/user/proj
    const normalized = requestedPath.replace(/\/+$/, '');
    const parts = normalized.split('/').filter(Boolean);
    // 从最深到最浅生成：/mnt/c/apps/proj, /mnt/c/apps, /mnt/c, /mnt, /
    for (let i = parts.length; i >= 0; i--) {
      const level = '/' + parts.slice(0, i).join('/');
      levels.push(level || '/');
    }
  }

  return levels;
}

export function WorkspaceDirSelector({
  appId, convId, toolCallId, requestedPath,
  onSubmitted, onCancelled,
}: WorkspaceDirSelectorProps) {
  // 从请求路径的层级生成下拉选项
  const levels = requestedPath ? getHierarchyLevels(requestedPath) : ['/'];
  const [selectedLevel, setSelectedLevel] = useState<string>(levels[0] || '/');
  const [inputPath, setInputPath] = useState<string>(selectedLevel);
  const [error, setError] = useState<string>('');
  const [validating, setValidating] = useState(false);
  const [valid, setValid] = useState<boolean | null>(null);

  // 当下拉选择变化时，更新输入框
  const handleLevelChange = (level: string) => {
    setSelectedLevel(level);
    setInputPath(level);
    setError('');
    setValid(null);
  };

  // 当输入变化时，清除校验状态
  const handleInputChange = (value: string) => {
    setInputPath(value);
    setError('');
    setValid(null);
    // 如果输入和下拉选择的某个选项匹配，同步下拉
    const match = levels.find(l => l === value);
    if (match) {
      setSelectedLevel(match);
    }
  };

  // 校验目录是否存在
  const validateDir = useCallback(async (dir: string): Promise<boolean> => {
    if (!dir || !dir.trim()) {
      setError('请输入目录路径');
      return false;
    }
    setValidating(true);
    try {
      const resp = await fetch(`/api/workspace/validate-dir`, {
        method: 'POST',
        body: JSON.stringify({ path: dir.trim() }),
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await resp.json();
      if (result.error) {
        setError(result.error);
        setValid(false);
        return false;
      }
      if (!result.exists) {
        setError(`目录不存在: ${dir.trim()}`);
        setValid(false);
        return false;
      }
      setValid(true);
      setError('');
      return true;
    } catch (e: any) {
      setError(e.message || '校验失败');
      setValid(false);
      return false;
    } finally {
      setValidating(false);
    }
  }, []);

  // 提交
  const handleConfirm = async () => {
    const ok = await validateDir(inputPath);
    if (!ok) return;
    try {
      await fetch(`/api/apps/${appId}/conversations/${convId}/workspace-response`, {
        method: 'POST',
        body: JSON.stringify({
          toolCallId,
          path: inputPath.trim(),
          cancelled: false,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      onSubmitted(inputPath.trim());
    } catch (e: any) {
      setError(e.message || '提交失败');
    }
  };

  const handleCancel = async () => {
    try {
      await fetch(`/api/apps/${appId}/conversations/${convId}/workspace-response`, {
        method: 'POST',
        body: JSON.stringify({ toolCallId, cancelled: true }),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {}
    onCancelled();
  };

  return (
    <div className="form-inline workspace-dir-selector">
      <div className="form-title">授权工作目录</div>
      <div className="form-description">
        Agent 需要访问目录 <strong>{requestedPath || '未知路径'}</strong>。
        请选择一个工作目录，设置后该会话下的文件操作将限制在此目录内。
      </div>

      {/* 层级下拉选择 */}
      <div className="form-field">
        <label className="form-label">选择目录层级</label>
        <select
          className="form-input"
          value={selectedLevel}
          onChange={e => handleLevelChange(e.target.value)}
        >
          {levels.map(level => (
            <option key={level} value={level}>{level}</option>
          ))}
        </select>
      </div>

      {/* 输入框 */}
      <div className="form-field">
        <label className="form-label">或输入目录路径</label>
        <input
          type="text"
          className={`form-input${valid === false ? ' form-input-error' : valid === true ? ' form-input-valid' : ''}`}
          value={inputPath}
          onChange={e => handleInputChange(e.target.value)}
          placeholder="例如 /mnt/c/apps/my-project"
          onBlur={() => inputPath.trim() && validateDir(inputPath)}
        />
        {validating && <div className="form-field-desc" style={{ color: 'var(--text-secondary)' }}>校验中...</div>}
        {error && <div className="form-field-desc" style={{ color: 'var(--danger)' }}>{error}</div>}
      </div>

      <div className="form-actions">
        <button className="form-submit-btn" onClick={handleConfirm} disabled={validating}>
          {validating ? '校验中...' : '确认授权'}
        </button>
        <button className="form-cancel-btn" onClick={handleCancel} disabled={validating}>
          拒绝
        </button>
      </div>
    </div>
  );
}
