import React, { useState, useRef, useEffect, useCallback } from 'react';

interface MediaSelectorProps {
  appId: string;
  type: 'icon' | 'background';
  currentUrl: string;
  onSelect: (url: string) => void;
}

// ============ API 辅助 ============
const API_BASE = '/api';

async function uploadMedia(appId: string, type: string, blob: Blob): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append('type', type);
  formData.append('file', blob, `${type}_${Date.now()}.png`);
  const resp = await fetch(`${API_BASE}/apps/${appId}/media`, {
    method: 'POST',
    body: formData,
  });
  if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
  return resp.json();
}

async function fetchMediaList(appId: string): Promise<{ icons: string[]; backgrounds: string[] }> {
  const resp = await fetch(`${API_BASE}/apps/${appId}/media`);
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
  return resp.json();
}

async function deleteMedia(appId: string, url: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/apps/${appId}/media`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!resp.ok) throw new Error(`Delete failed: ${resp.status}`);
}

// ============ 裁切画布逻辑 ============
interface CropState {
  img: HTMLImageElement;
  offsetX: number;
  offsetY: number;
  scale: number;
}

function useCropCanvas(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  imageSrc: string | null,
  isIcon: boolean,
  cropWidth: number,
  cropHeight: number,
) {
  const stateRef = useRef<CropState | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  // 加载图片
  useEffect(() => {
    if (!imageSrc) {
      setLoaded(false);
      stateRef.current = null;
      return;
    }
    setLoaded(false);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      // 初始缩放：让图片撑满裁切区域
      const boxSize = Math.max(cropWidth, cropHeight);
      const initialScale = Math.max(boxSize / img.naturalWidth, boxSize / img.naturalHeight);
      stateRef.current = {
        img,
        offsetX: -(img.naturalWidth * initialScale - cropWidth) / 2,
        offsetY: -(img.naturalHeight * initialScale - cropHeight) / 2,
        scale: initialScale,
      };
      setLoaded(true);
    };
    img.src = imageSrc;
  }, [imageSrc, cropWidth, cropHeight]);

  // 绘制
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const state = stateRef.current;
    if (!canvas || !state) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = cropWidth;
    canvas.height = cropHeight;

    ctx.clearRect(0, 0, cropWidth, cropHeight);

    const sw = state.img.naturalWidth * state.scale;
    const sh = state.img.naturalHeight * state.scale;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cropWidth, cropHeight);
    ctx.clip();

    ctx.drawImage(state.img, state.offsetX, state.offsetY, sw, sh);

    ctx.restore();
  }, [cropWidth, cropHeight, canvasRef]);

  useEffect(() => {
    if (loaded) draw();
  }, [loaded, draw]);

  // 拖拽
  const dragRef = useRef<{ startX: number; startY: number; startOffX: number; startOffY: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const state = stateRef.current;
    if (!state) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffX: state.offsetX,
      startOffY: state.offsetY,
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current;
    const state = stateRef.current;
    if (!drag || !state) return;
    state.offsetX = drag.startOffX + (e.clientX - drag.startX);
    state.offsetY = drag.startOffY + (e.clientY - drag.startY);
    draw();
  }, [draw]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // 滚轮缩放（以鼠标位置为中心）
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const state = stateRef.current;
    if (!state) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.max(0.1, Math.min(10, state.scale * factor));

    // 保持鼠标位置对应的图片点不变
    const imgX = (mouseX - state.offsetX) / state.scale;
    const imgY = (mouseY - state.offsetY) / state.scale;

    state.offsetX = mouseX - imgX * newScale;
    state.offsetY = mouseY - imgY * newScale;
    state.scale = newScale;

    draw();
  }, [draw, canvasRef]);

  // 获取最终裁切结果（返回 blob）
  const getResultBlob = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (!canvas) { resolve(null); return; }

      const state = stateRef.current;
      if (!state) { resolve(null); return; }

      // 裁切 canvas 当前显示 = cropWidth x cropHeight
      if (isIcon) {
        // 图标：固定输出 512x512
        const outCanvas = document.createElement('canvas');
        outCanvas.width = 512;
        outCanvas.height = 512;
        const outCtx = outCanvas.getContext('2d');
        if (!outCtx) { resolve(null); return; }
        outCtx.drawImage(canvas, 0, 0, cropWidth, cropHeight, 0, 0, 512, 512);
        outCanvas.toBlob((blob) => resolve(blob), 'image/png');
      } else {
        // 背景图：保持原始分辨率，不缩放
        const state = stateRef.current;
        if (!state) { resolve(null); return; }
        const natW = state.img.naturalWidth;
        const natH = state.img.naturalHeight;
        // 计算裁切区域在原图中的对应位置
        const scale = state.scale;
        const srcX = -state.offsetX / scale;
        const srcY = -state.offsetY / scale;
        const srcW = cropWidth / scale;
        const srcH = cropHeight / scale;

        const outCanvas = document.createElement('canvas');
        outCanvas.width = natW;
        outCanvas.height = natH;
        const outCtx = outCanvas.getContext('2d');
        if (!outCtx) { resolve(null); return; }
        // 只绘制可见区域，其余透明
        outCtx.drawImage(state.img, srcX, srcY, srcW, srcH, 0, 0, natW, natH);
        outCanvas.toBlob((blob) => resolve(blob), 'image/png');
      }
    });
  }, [canvasRef, isIcon, cropWidth, cropHeight]);

  return {
    loaded,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    getResultBlob,
    draw,
  };
}

// ============ 裁切弹窗 ============
function CropModal({
  imageSrc,
  type,
  onConfirm,
  onCancel,
}: {
  imageSrc: string;
  type: 'icon' | 'background';
  onConfirm: (blob: Blob) => Promise<void>;
  onCancel: () => void;
}) {
  const isIcon = type === 'icon';
  const cropSize = isIcon ? 300 : 400; // 裁切区域宽度
  const cropAspect = isIcon ? 1 : 16 / 9; // 图标正方形，背景图 16:9
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const cropWidth = cropSize;
  const cropHeight = Math.round(cropSize / cropAspect);

  const {
    loaded,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    getResultBlob,
  } = useCropCanvas(canvasRef, imageSrc, isIcon, cropWidth, cropHeight);

  const [confirming, setConfirming] = useState(false);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const blob = await getResultBlob();
      if (blob) {
        await onConfirm(blob);
      }
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="media-crop-overlay" onClick={onCancel}>
      <div className="media-crop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="media-crop-title">
          裁切{isIcon ? '图标' : '背景图'}
        </div>
        <div className="media-crop-hint">
          {isIcon
            ? '拖拽移动图片，滚轮缩放 — 将裁切为正方形'
            : '拖拽移动图片，滚轮缩放 — 保持原始宽高比'}
        </div>
        <div
          className="media-crop-stage"
          style={{
            width: cropWidth,
            height: cropHeight,
            position: 'relative',
            overflow: 'hidden',
            margin: '0 auto',
            cursor: 'grab',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <canvas
            ref={canvasRef}
            width={cropWidth}
            height={cropHeight}
            style={{ display: 'block', width: cropWidth, height: cropHeight }}
          />
          {!loaded && (
            <div className="media-crop-loading">加载中...</div>
          )}
        </div>
        <div className="media-crop-actions">
          <button
            className="btn-primary"
            onClick={handleConfirm}
            disabled={confirming || !loaded}
          >
            {confirming ? '上传中...' : '确认'}
          </button>
          <button className="btn-secondary" onClick={onCancel} disabled={confirming}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ 主组件 ============
export function MediaSelector({ appId, type, currentUrl, onSelect }: MediaSelectorProps) {
  const isIcon = type === 'icon';
  const label = isIcon ? '图标' : '背景图';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mediaList, setMediaList] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // 裁切状态
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);

  // 加载历史列表
  const refreshList = useCallback(async () => {
    try {
      const data = await fetchMediaList(appId);
      setMediaList(isIcon ? (data.icons || []) : (data.backgrounds || []));
    } catch (err) {
      console.error('Failed to fetch media list:', err);
    }
  }, [appId, isIcon]);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // 选择文件 → 打开裁切弹窗
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCropImageSrc(reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 裁切确认 → 上传
  const handleCropConfirm = async (blob: Blob) => {
    setUploading(true);
    try {
      const result = await uploadMedia(appId, type, blob);
      if (result.url) {
        onSelect(result.url);
        await refreshList();
      }
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
      setCropImageSrc(null);
    }
  };

  // 取消裁切
  const handleCancelCrop = () => {
    setCropImageSrc(null);
  };

  // 删除媒体
  const handleDelete = async (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteMedia(appId, url);
      if (url === currentUrl) {
        onSelect('');
      }
      await refreshList();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  // 点击缩略图切换
  const handleThumbClick = (url: string) => {
    onSelect(url);
  };

  return (
    <div className="media-selector">
      <div className="media-selector-header">
        <label>{label}</label>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />

      {/* 历史缩略图列表 — 左对齐，第一张当前在用，竖线后为历史 */}
      <div className="media-selector-thumbnails">
        {/* 当前在用的（第一张） */}
        {currentUrl && (
          <div
            className="media-thumb-item media-thumb-active"
            onClick={() => handleThumbClick(currentUrl)}
            title="当前使用"
          >
            {isIcon ? (
              <img src={currentUrl} alt="" className="media-thumb-img media-thumb-icon"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            ) : (
              <div className="media-thumb-bg-wrap">
                <img src={currentUrl} alt="" className="media-thumb-img media-thumb-bg"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            )}
            <button className="media-thumb-delete" onClick={(e) => handleDelete(currentUrl, e)} title="删除">×</button>
          </div>
        )}

        {/* 竖线分隔 */}
        {currentUrl && mediaList.filter(u => u !== currentUrl).length > 0 && (
          <div className="media-thumb-divider" />
        )}

        {/* 历史图片（不含当前） */}
        {mediaList.filter(u => u !== currentUrl).map((url) => (
          <div
            key={url}
            className="media-thumb-item"
            onClick={() => handleThumbClick(url)}
            title="点击切换"
          >
            {isIcon ? (
              <img src={url} alt="" className="media-thumb-img media-thumb-icon"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            ) : (
              <div className="media-thumb-bg-wrap">
                <img src={url} alt="" className="media-thumb-img media-thumb-bg"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            )}
            <button className="media-thumb-delete" onClick={(e) => handleDelete(url, e)} title="删除">×</button>
          </div>
        ))}

        {/* 加号按钮（放最后） */}
        <div className="media-thumb-add" onClick={() => fileInputRef.current?.click()} title="上传新图片">
          +
        </div>
      </div>

      {/* 裁切弹窗 */}
      {cropImageSrc && (
        <CropModal
          imageSrc={cropImageSrc}
          type={type}
          onConfirm={handleCropConfirm}
          onCancel={handleCancelCrop}
        />
      )}
    </div>
  );
}
