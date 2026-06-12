import { useState } from 'react';
import UploadForm from './components/UploadForm.jsx';
import Recorder from './components/Recorder.jsx';
import TranscriptView from './components/TranscriptView.jsx';
import { uploadAudio, requestTranscription } from './api.js';
import { extensionOf } from './lib/recorder.js';

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

  // 録音Blobをファイル化して、手動アップロードと同じ文字起こし経路に合流させる
  const handleRecordedTranscribe = (blob, mimeType) => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const file = new File([blob], `saidlog-${stamp}.${extensionOf(mimeType)}`, { type: mimeType });
    handleTranscribe(file);
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
        <h1>Saidlog</h1>
        <p className="tagline">会議音声をアップロードするだけで、話者ごとの議事録に</p>
      </header>

      <main>
        {status !== 'done' && <UploadForm onSubmit={handleTranscribe} processing={busy} />}

        {status !== 'done' && !busy && <Recorder onTranscribe={handleRecordedTranscribe} />}

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

      <section className="usage-notes">
        <p>ご利用にあたって</p>
        <ul>
          <li>各話者が15秒以上話すと識別精度が上がります</li>
          <li>発言量が少ない話者は識別されにくい場合があります</li>
          <li>話者名は右のペンアイコンから編集できます</li>
          <li>
            本サービスはAI処理に外部APIを使用しています。運営側に費用が発生します。長時間の録音は分割してご利用ください。
          </li>
          <li>アップロードできるファイルは50MBまでです。超える場合は分割してください</li>
          <li>録音中は画面を開いたままにしてください（他のアプリへの切り替えや画面を閉じると録音が停止する場合があります）</li>
          <li>録音データの保存はご自身の端末で行えます。サーバーには保存されません</li>
        </ul>
      </section>

      <footer className="footer">Saidlog MVP — AI文字起こし・話者識別</footer>
    </div>
  );
}
