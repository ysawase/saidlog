import { useRef, useState } from 'react';

const ACCEPT = '.mp3,.mp4,.wav,.m4a';
const MAX_SIZE_MB = 200;

export default function UploadForm({ onSubmit, processing }) {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [warning, setWarning] = useState('');
  const inputRef = useRef(null);

  const selectFile = (f) => {
    if (!f) return;
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPT.split(',').includes(ext)) {
      setWarning('対応形式は mp3 / mp4 / wav / m4a です');
      return;
    }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setWarning(`ファイルサイズの上限は ${MAX_SIZE_MB}MB です`);
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
            <p className="dropzone-main">音声ファイルをドラッグ＆ドロップ</p>
            <p className="dropzone-sub">またはクリックして選択（mp3 / mp4 / wav / m4a）</p>
          </>
        )}
      </div>

      {warning && <p className="warning">{warning}</p>}

      <button
        className="btn primary"
        disabled={!file || processing}
        onClick={() => onSubmit(file)}
      >
        {processing ? '処理中…' : '文字起こしを開始'}
      </button>
    </div>
  );
}
