import { useState } from 'react';
import UploadForm from './components/UploadForm.jsx';
import TranscriptView from './components/TranscriptView.jsx';
import { uploadAudio, requestTranscription } from './api.js';

export default function App() {
  const [status, setStatus] = useState('idle'); // idle | uploading | processing | done | error
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleTranscribe = async (file) => {
    setError('');
    setResult(null);

    setStatus('uploading');
    setUploadProgress(0);
    let filePath;
    try {
      filePath = await uploadAudio(file, setUploadProgress);
    } catch (err) {
      setError(`アップロードエラー: ${err.message}`);
      setStatus('error');
      return;
    }

    setStatus('processing');
    try {
      const data = await requestTranscription(filePath);
      setResult(data);
      setStatus('done');
    } catch (err) {
      setError(`文字起こしエラー: ${err.message}`);
      setStatus('error');
    }
  };

  const handleReset = () => {
    setStatus('idle');
    setResult(null);
    setError('');
  };

  const busy = status === 'uploading' || status === 'processing';

  return (
    <div className="app">
      <header className="header">
        <h1>Meetlog</h1>
        <p className="tagline">会議音声をアップロードするだけで、話者ごとの議事録に</p>
      </header>

      <main>
        {status !== 'done' && <UploadForm onSubmit={handleTranscribe} processing={busy} />}

        {status === 'uploading' && (
          <div className="notice processing">
            <div className="spinner" />
            <p>アップロード中… {uploadProgress}%</p>
          </div>
        )}

        {status === 'processing' && (
          <div className="notice processing">
            <div className="spinner" />
            <p>文字起こし中です… 音声の長さによっては数分かかります。</p>
          </div>
        )}

        {status === 'error' && <div className="notice error">{error}</div>}

        {status === 'done' && result && (
          <>
            <button className="btn secondary" onClick={handleReset}>
              ← 別のファイルを文字起こしする
            </button>
            <TranscriptView result={result} />
          </>
        )}
      </main>

      <footer className="footer">Meetlog MVP — AI文字起こし・話者識別</footer>
    </div>
  );
}
