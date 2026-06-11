// 日本語フィラー。「あの」「その」単体は指示語と区別できないため、
// 長音付き（あのー、そのー）のみ除去対象にする。
const JA_FILLER =
  /(?:えー+っと|えーと|えっと|ええと|ええっと|あのー+|あのう|そのー+|えー+|えぇ+|あー+|あぁ+|うー+んと?|んー+と|んー+|ま[ぁあ]ー+)[、,]?\s*/g;

const EN_FILLER = /\b(?:um+|uh+|erm*|hmm+|mhm+)\b[,]?\s*/gi;

// 日本語文字（ひらがな・カタカナ・漢字）に挟まれたスペースのみ除去する。
// 英単語間のスペースは前後が日本語文字ではないため対象外。
const JA_CHAR = '[\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF々〆ー]';
const SPACE_BETWEEN_JA = new RegExp(`(?<=${JA_CHAR})[ \\t\\u3000]+(?=${JA_CHAR})`, 'g');

/**
 * フィラー語（あー、えーと、um など）を除去し、残った句読点を整える。
 */
export function removeFillers(text) {
  if (!text) return '';
  // STTは「ええ と、」のように語中にスペースを挟むことがあるため、
  // 先に日本語文字間のスペースを正規化してからフィラーを照合する
  return text
    .replace(SPACE_BETWEEN_JA, '')
    .replace(JA_FILLER, '')
    .replace(EN_FILLER, '')
    .replace(/^[、。,.\s]+/, '')
    .replace(/、{2,}/g, '、')
    .replace(/。{2,}/g, '。')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
