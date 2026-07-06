import { Capacitor } from '@capacitor/core';
import { downloadBlob } from '../lib/recorder.js';

function formatFilename(ext) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `saidlog_${date}_${time}.${ext}`;
}

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildLines(utterances, names) {
  return utterances.map((u) => `[${formatTime(u.startMs)}] ${names[u.speaker]}：${u.text}`);
}

export async function exportTxt(utterances, names, summary) {
  const lines = buildLines(utterances, names);
  if (summary) lines.push('', '--- AI要約 ---', summary);
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  await downloadBlob(blob, formatFilename('txt'));
}

export async function exportDocx(utterances, names, summary) {
  const { Document, Paragraph, TextRun, Packer } = await import('docx');
  const lines = buildLines(utterances, names);
  if (summary) lines.push('', '--- AI要約 ---', ...summary.split('\n'));
  const paragraphs = lines.map((l) => new Paragraph({ children: [new TextRun(l)] }));
  const doc = new Document({ sections: [{ children: paragraphs }] });
  const blob = await Packer.toBlob(doc);
  await downloadBlob(blob, formatFilename('docx'));
}

let pdfMakeReady = null;

async function initPdfMake() {
  if (pdfMakeReady) return pdfMakeReady;

  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  async function fetchFont(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`font fetch failed: ${r.status} ${path}`);
    return r.arrayBuffer();
  }

  const [pdfMakeModule, normalBuf, boldBuf] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    fetchFont('/fonts/NotoSansJP-Regular.ttf'),
    fetchFont('/fonts/NotoSansJP-Bold.ttf'),
  ]);

  const pdfMake = pdfMakeModule.default ?? pdfMakeModule;

  pdfMake.addVirtualFileSystem({
    'NotoSansJP-Regular.otf': toBase64(normalBuf),
    'NotoSansJP-Bold.otf': toBase64(boldBuf),
  });
  pdfMake.addFonts({
    NotoSansJP: {
      normal: 'NotoSansJP-Regular.otf',
      bold: 'NotoSansJP-Bold.otf',
    },
  });

  pdfMakeReady = pdfMake;
  return pdfMakeReady;
}

export async function exportPdf(utterances, names, summary) {
  const pdfMake = await initPdfMake();

  const content = utterances.map((u) => ({
    unbreakable: true,
    stack: [
      {
        text: [
          { text: `[${formatTime(u.startMs)}] `, color: '#888888', fontSize: 9 },
          { text: `${names[u.speaker]}：`, bold: true },
          { text: u.text },
        ],
      },
    ],
    margin: [0, 0, 0, 6],
  }));

  if (summary) {
    content.push({
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#cccccc' }],
      margin: [0, 12, 0, 12],
    });
    content.push({ text: summary });
  }

  const docDef = {
    content,
    defaultStyle: { font: 'NotoSansJP', fontSize: 11 },
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [40, 40, 40, 40],
  };
  const filename = formatFilename('pdf');

  if (Capacitor.isNativePlatform()) {
    const blob = await new Promise((resolve) => pdfMake.createPdf(docDef).getBlob(resolve));
    await downloadBlob(blob, filename);
  } else {
    pdfMake.createPdf(docDef).download(filename);
  }
}
