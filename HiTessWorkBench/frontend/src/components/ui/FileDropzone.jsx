import React, { useRef, useState } from 'react';
import { FileCheck2, Upload } from 'lucide-react';

const ACCEPT_LABEL = {
  '.bdf,.dat': '.bdf / .dat',
  '.csv': '.csv',
  '.json': '.json',
};

function defaultFormatBytes(bytes) {
  if (typeof bytes !== 'number') return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileDropzone({
  file,
  accept,
  multiple = false,
  title = '파일 선택',
  placeholder = '클릭하거나 파일을 드래그하세요',
  helperText,
  disabled = false,
  accent = 'blue',
  onFile,
  onFiles,
  className = '',
}) {
  const inputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const isUploaded = !!file;
  const accentClasses = accent === 'amber'
    ? {
        active: 'border-amber-400 bg-amber-50',
        hover: 'hover:border-amber-400',
        icon: 'text-amber-600 bg-amber-50',
      }
    : {
        active: 'border-blue-400 bg-blue-50',
        hover: 'hover:border-blue-400',
        icon: 'text-blue-600 bg-blue-50',
      };

  const pickFiles = (fileList) => {
    if (disabled) return;
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    if (multiple) {
      onFiles?.(files);
      onFile?.(files[0]);
    } else {
      onFile?.(files[0]);
    }
  };

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragOver(false);
          pickFiles(event.dataTransfer.files);
        }}
        className={[
          'rounded-xl border-2 border-dashed p-5 transition-colors outline-none',
          'focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:ring-offset-1',
          disabled ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60' : `cursor-pointer ${accentClasses.hover}`,
          isDragOver ? accentClasses.active : isUploaded ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-300 hover:bg-slate-50',
        ].filter(Boolean).join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          className="hidden"
          onChange={(event) => {
            pickFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <div className="flex items-center gap-4 min-w-0">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${isUploaded ? 'bg-emerald-50 text-emerald-600' : accentClasses.icon}`}>
            {isUploaded ? <FileCheck2 size={23} /> : <Upload size={23} />}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="text-sm font-bold text-slate-700">{title}</p>
            <p className="truncate text-xs text-slate-500">
              {isUploaded ? file.name : placeholder}
            </p>
            <p className="mt-1 text-[11px] font-medium text-slate-400">
              {isUploaded ? defaultFormatBytes(file.size) : helperText || ACCEPT_LABEL[accept] || accept}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
