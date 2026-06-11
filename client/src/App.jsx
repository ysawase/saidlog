import { useState } from 'react';
import UploadForm from './components/UploadForm.jsx';
import TranscriptView from './components/TranscriptView.jsx';
import { transcribeFile } from './api.js';

export default function App() {
  const [status, setStatus] = useState('idle'); // idle | processing | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleTranscribe = async (file) => {
    setStatus('processing');
    setError('');
    setResult(null);
    try {
      const data = await transcribeFile(file);
      setResult(data);
      setStatus('done');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  };

  const handleReset = () => {
    setStatus('idle');
    setResult(null);
    setError('');
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Meetlog</h1>
        <p className="tagline">会議音声をアップロードするだけで、話者ごとの議事録に</p>
      </header>

      <main>
        {status !== 'done' && (
          <UploadForm onSubmit={handleTranscribe} processing={status === 'processing'} />
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

      <footer className="footer">Meetlog MVP — AssemblyAI による文字起こし・話者識別</footer>
    </div>
  );
}
