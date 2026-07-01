import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_SIZE_MB } from '../constants/limits.js';

const ACCEPT = '.mp3,.mp4,.wav,.m4a,.webm';

export default function UploadForm({ onSubmit, processing }) {
  const { t } = useTranslation();
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [warning, setWarning] = useState('');
  const inputRef = useRef(null);

  const selectFile = (f) => {
    if (!f) return;
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPT.split(',').includes(ext)) {
      setWarning(t('upload.errorFormat'));
      return;
    }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setWarning(t('upload.errorSize', { max: MAX_SIZE_MB }));
      return;
    }
    setWarning('');
    setFile(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    selectFile(e.dataTransfer.files[0]);
  };

  return (
    <div className="upload-form">
      <div
        className={`dropzone ${dragOver ? 'drag-over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => selectFile(e.target.files[0])}
        />
        {file ? (
          <p className="file-info">
            <strong>{file.name}</strong>
            <span>（{(file.size / 1024 / 1024).toFixed(1)} MB）</span>
          </p>
        ) : (
          <>
            <p className="dropzone-main">{t('upload.dragDrop')}</p>
            <p className="dropzone-sub">{t('upload.clickOrDrag')}</p>
          </>
        )}
      </div>

      {warning && <p className="warning">{warning}</p>}

      <button
        className="btn primary"
        disabled={!file || processing}
        onClick={() => onSubmit(file)}
      >
        {processing ? t('upload.processing') : t('upload.start')}
      </button>
    </div>
  );
}
