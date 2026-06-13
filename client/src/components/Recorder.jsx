import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createRecorder, recordingFileName, downloadBlob } from '../lib/recorder.js';
import { listSessions, getSessionBlob, clearSession, cleanupStale } from '../lib/recordingDb.js';

const MAX_SIZE_BYTES = 50 * 1024 * 1024;
const LONG_RECORDING_MS = 90 * 60 * 1000;
const CHUNK_SEC = 5;

function formatDuration(ms) {
  const sec = Math.round(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function Recorder({ onTranscribe }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState('idle'); // idle | recording | confirming
  const [restoreInfo, setRestoreInfo] = useState(null);
  const [recordingMs, setRecordingMs] = useState(0);
  const [sizeWarning, setSizeWarning] = useState(false);
  const [result, setResult] = useState(null); // { blob, sessionId, mimeType, durationMs }
  const [error, setError] = useState('');
  const recorderRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    cleanupStale().catch(() => {});
    listSessions()
      .then((sessions) => {
        if (sessions.length === 0) return;
        const latest = sessions.reduce((a, b) => (a.lastAt > b.lastAt ? a : b));
        setRestoreInfo(latest);
      })
      .catch(() => {});
    return () => clearInterval(timerRef.current);
  }, []);

  const startTimer = () => {
    const startedAt = Date.now();
    timerRef.current = setInterval(() => setRecordingMs(Date.now() - startedAt), 1000);
  };

  const handleStart = async () => {
    setError('');
    setSizeWarning(false);
    setRecordingMs(0);
    const recorder = createRecorder({ onSizeWarning: () => setSizeWarning(true) });
    try {
      await recorder.start();
    } catch (err) {
      setError(
        err.name === 'NotAllowedError'
          ? t('recorder.errorMic')
          : t('recorder.errorStart', { message: err.message }),
      );
      return;
    }
    recorderRef.current = recorder;
    startTimer();
    setPhase('recording');
  };

  const handleStop = async () => {
    clearInterval(timerRef.current);
    try {
      const res = await recorderRef.current.stop();
      setResult(res);
      setPhase('confirming');
    } catch (err) {
      setError(t('recorder.errorStop', { message: err.message }));
      setPhase('idle');
    }
    recorderRef.current = null;
  };

  const handleRestore = async () => {
    const { sessionId, chunkCount, mimeType } = restoreInfo;
    setRestoreInfo(null);
    try {
      const blob = await getSessionBlob(sessionId);
      if (!blob) {
        await clearSession(sessionId);
        return;
      }
      setResult({ blob, sessionId, mimeType, durationMs: chunkCount * CHUNK_SEC * 1000 });
      setPhase('confirming');
    } catch (err) {
      setError(t('recorder.errorResume', { message: err.message }));
    }
  };

  const handleDiscardRestore = async () => {
    const { sessionId } = restoreInfo;
    setRestoreInfo(null);
    await clearSession(sessionId).catch(() => {});
  };

  const handleSave = () => {
    downloadBlob(result.blob, recordingFileName(result.mimeType));
    clearSession(result.sessionId).catch(() => {});
  };

  const handleTranscribe = () => {
    clearSession(result.sessionId).catch(() => {});
    onTranscribe(result.blob, result.mimeType);
    reset();
  };

  const handleDiscard = () => {
    clearSession(result.sessionId).catch(() => {});
    reset();
  };

  const reset = () => {
    setResult(null);
    setError('');
    setSizeWarning(false);
    setRecordingMs(0);
    setPhase('idle');
  };

  const oversize = result && result.blob.size > MAX_SIZE_BYTES;

  return (
    <div className="recorder">
      {phase === 'idle' && (
        <>
          {restoreInfo && (
            <div className="notice">
              <p>
                {t('recorder.confirm.pending')}（約
                {Math.max(1, Math.round((restoreInfo.chunkCount * CHUNK_SEC) / 60))}
                分）{t('recorder.confirm.resume')}
              </p>
              <button className="btn primary" onClick={handleRestore}>
                {t('recorder.confirm.resumeBtn')}
              </button>
              <button className="btn secondary" onClick={handleDiscardRestore}>
                {t('recorder.confirm.discard')}
              </button>
            </div>
          )}
          <button className="btn primary" onClick={handleStart}>
            {t('recorder.start')}
          </button>
        </>
      )}

      {phase === 'recording' && (
        <div className="notice">
          <p>{t('recorder.recording', { duration: formatDuration(recordingMs) })}</p>
          {recordingMs > LONG_RECORDING_MS && (
            <p className="warning">{t('recorder.warning.long')}</p>
          )}
          {sizeWarning && (
            <p className="warning">{t('recorder.warning.size')}</p>
          )}
          <button className="btn primary" onClick={handleStop}>
            {t('recorder.stop')}
          </button>
        </div>
      )}

      {phase === 'confirming' && result && (
        <div className="notice">
          <p>
            {t('recorder.duration', { duration: formatDuration(result.durationMs) })}
            {(result.blob.size / 1024 / 1024).toFixed(1)} MB
          </p>
          {oversize && (
            <p className="warning">{t('recorder.warning.overSize')}</p>
          )}
          <button className="btn secondary" onClick={handleSave}>
            {t('recorder.confirm.save')}
          </button>
          <button className="btn primary" disabled={oversize} onClick={handleTranscribe}>
            {t('recorder.confirm.transcribe')}
          </button>
          <button className="btn secondary" onClick={handleDiscard}>
            {t('recorder.confirm.discard2')}
          </button>
        </div>
      )}

      {error && <p className="warning">{error}</p>}
    </div>
  );
}
