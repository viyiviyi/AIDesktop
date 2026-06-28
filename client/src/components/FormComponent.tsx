import { useState, useCallback } from 'react';
import type { FormSchema, FormField } from '../types';
import * as api from '../services/api';

interface FormComponentProps {
  appId: string;
  convId: string;
  formId: string;
  toolCallId: string;
  schema: FormSchema;
  onSubmitted?: () => void;
  onCancelled?: () => void;
}

export function FormComponent({ appId, convId, formId, toolCallId, schema, onSubmitted, onCancelled }: FormComponentProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);

  const setValue = useCallback((name: string, value: unknown) => {
    setValues(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await api.submitFormResponse(appId, convId, formId, toolCallId, values);
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

    // options 支持两种格式：string[] 或 {label, value}[]
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
      case 'select':
        return (
          <select
            id={fieldId}
            value={(val as string) || ''}
            onChange={e => setValue(field.name, e.target.value || null)}
            className="form-input"
          >
            <option value="">-- 请选择 --</option>
            {(field.options || []).map((o, _i) => {
              const opt = normOption(o);
              return <option key={opt.value} value={opt.value}>{opt.label}</option>;
            })}
          </select>
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
    <div className="form-inline">
      <div className="form-title">{schema.title}</div>
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
        <button className="form-submit-btn" onClick={handleSubmit} disabled={submitting}>
          {submitting ? '提交中...' : '提交'}
        </button>
        <button className="form-cancel-btn" onClick={handleCancel} disabled={submitting}>
          取消
        </button>
      </div>
    </div>
  );
}
