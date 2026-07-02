import { useState, useCallback, useEffect } from 'react';
import type { FormSchema, FormField } from '../types';
import * as api from '../services/api';

interface FormComponentProps {
  appId: string;
  convId: string;
  formId: string;
  toolCallId: string;
  schema: FormSchema;
  /** 如果已提交过，传之前提交的数据过来显示摘要 */
  submittedData?: Record<string, unknown> | null;
  /** 如果已取消 */
  cancelled?: boolean;
  onSubmitted?: () => void;
  onCancelled?: () => void;
}

export function FormComponent({ appId, convId, formId, toolCallId, schema, submittedData, cancelled, onSubmitted, onCancelled }: FormComponentProps) {
  const [values, setValues] = useState<Record<string, unknown>>(submittedData || {});
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  // submittedData 变化时同步到 values（如覆盖提交后刷新数据）
  useEffect(() => {
    if (submittedData) setValues(submittedData);
  }, [submittedData]);

  const isDone = cancelled || justSubmitted;

  const setValue = useCallback((name: string, value: unknown) => {
    setValues(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await api.submitFormResponse(appId, convId, formId, toolCallId, values);
      setJustSubmitted(true);
      onSubmitted?.();
    } catch (err) {
      console.error('Form submit failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setSubmitting(true);
    try {
      await api.submitFormResponse(appId, convId, formId, toolCallId, undefined, true);
      onCancelled?.();
    } catch (err) {
      console.error('Form cancel failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  const renderField = (field: FormField) => {
    const val = values[field.name];
    const fieldId = `form-field-${formId}-${field.name}`;

    const normOption = (o: unknown): { label: string; value: string } => {
      if (o && typeof o === 'object' && 'label' in (o as any) && 'value' in (o as any)) {
        return { label: (o as any).label as string, value: (o as any).value as string };
      }
      return { label: String(o), value: String(o) };
    };

    switch (field.type) {
      case 'textarea':
        return (
          <textarea
            id={fieldId}
            value={(val as string) || ''}
            onChange={e => setValue(field.name, e.target.value)}
            placeholder={field.placeholder}
            rows={3}
            className="form-input form-textarea"
          />
        );
      case 'number':
        return (
          <input
            id={fieldId}
            type="number"
            value={(val as number | string) ?? ''}
            onChange={e => setValue(field.name, e.target.value ? Number(e.target.value) : '')}
            placeholder={field.placeholder}
            className="form-input"
          />
        );
      case 'tags':
        return (
          <div className="form-tags-input">
            <div className="form-tags-list">
              {((val as string[]) || []).map((tag, ti) => (
                <span key={ti} className="form-tag">
                  {tag}
                  <button type="button" className="form-tag-remove" onClick={() => {
                    const arr = [...((val as string[]) || [])];
                    arr.splice(ti, 1);
                    setValue(field.name, arr);
                  }}>&times;</button>
                </span>
              ))}
            </div>
            <input
              type="text"
              placeholder={field.placeholder || '输入后按 Enter 添加'}
              className="form-input form-tag-input"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const input = e.currentTarget;
                  const text = input.value.trim();
                  if (text) {
                    const arr = [...((val as string[]) || [])];
                    arr.push(text);
                    setValue(field.name, arr);
                    input.value = '';
                  }
                }
              }}
            />
            {field.description && <div className="form-field-desc">{field.description}</div>}
          </div>
        );
      case 'radio':
        return (
          <div className="form-radio-group">
            {(field.options || []).map((o, _i) => {
              const opt = normOption(o);
              return (
                <label key={opt.value} className="form-radio-label">
                  <input
                    type="radio"
                    name={fieldId}
                    value={opt.value}
                    onChange={() => setValue(field.name, opt.value)}
                  />
                  <span>{opt.label}</span>
                </label>
              );
            })}
          </div>
        );
      case 'checkbox':
        return (
          <label className="form-checkbox-label">
            <input
              type="checkbox"
              checked={!!val}
              onChange={e => setValue(field.name, e.target.checked)}
            />
            <span>{field.label}</span>
          </label>
        );
      default:
        return (
          <input
            id={fieldId}
            type="text"
            value={(val as string) || ''}
            onChange={e => setValue(field.name, e.target.value)}
            placeholder={field.placeholder}
            className="form-input"
          />
        );
    }
  };

  return (
    <div className={`form-inline ${isDone ? 'form-submitted' : ''}`}>
      <div className="form-title">
        {schema.title}
        {cancelled && <span className="form-status-badge form-status-cancelled">已取消</span>}
        {(justSubmitted || submittedData) && !cancelled && (
          <span className="form-status-badge form-status-submitted">已提交 ✓</span>
        )}
      </div>
      {schema.description && <div className="form-description">{schema.description}</div>}
      <div className="form-fields">
        {schema.fields.map((field, i) => (
          <div key={field.name || i} className="form-field">
            {field.type !== 'checkbox' && (
              <label className="form-label" htmlFor={`form-field-${formId}-${field.name}`}>
                {field.label}
                {field.required && <span className="form-required">*</span>}
              </label>
            )}
            {field.description && <div className="form-field-desc">{field.description}</div>}
            {renderField(field)}
          </div>
        ))}
      </div>
      <div className="form-actions">
        <button className="form-submit-btn" onClick={handleSubmit} disabled={submitting || cancelled}>
          {submitting ? '提交中...' : (justSubmitted || submittedData ? '重新提交' : '提交')}
        </button>
        <button className="form-cancel-btn" onClick={handleCancel} disabled={submitting || cancelled}>
          取消
        </button>
      </div>
    </div>
  );
}
