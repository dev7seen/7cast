/**
 * 7CAST Arabic Text Shaper & Bidirectional Reorderer
 * Formats Arabic text for clean, ligature-perfect rendering in FFmpeg drawtext with OpenType fonts.
 */

const arabicMap = {
  // [isolated, initial, medial, final]
  0x0621: [0xFE80, 0xFE80, 0xFE80, 0xFE80], // Hamza
  0x0622: [0xFE81, 0xFE81, 0xFE82, 0xFE82], // Alef with Madda
  0x0623: [0x0623, 0x0623, 0xFE84, 0xFE84], // Alef with Hamza Above
  0x0624: [0xFE85, 0xFE85, 0xFE86, 0xFE86], // Waw with Hamza
  0x0625: [0x0625, 0x0625, 0xFE88, 0xFE88], // Alef with Hamza Below
  0x0626: [0xFE89, 0xFE8B, 0xFE8C, 0xFE8A], // Yeh with Hamza
  0x0627: [0x0627, 0x0627, 0xFE8E, 0xFE8E], // Alef (kept as 0x0627 when isolated for LamaSans compatibility)
  0x0628: [0xFE8D, 0xFE91, 0xFE92, 0xFE90], // Baa
  0x0629: [0xFE93, 0xFE93, 0xFE94, 0xFE94], // Teh Marbuta
  0x062A: [0xFE95, 0xFE97, 0xFE98, 0xFE96], // Teh
  0x062B: [0xFE99, 0xFE9B, 0xFE9C, 0xFE9A], // Theh
  0x062C: [0xFE9D, 0xFE9F, 0xFEA0, 0xFE9E], // Jeem
  0x062D: [0xFEA1, 0xFEA3, 0xFEA4, 0xFEA2], // Hah
  0x062E: [0xFEA5, 0xFEA7, 0xFEA8, 0xFEA6], // Khah
  0x062F: [0xFEA9, 0xFEA9, 0xFEAA, 0xFEAA], // Dal
  0x0630: [0xFEAB, 0xFEAB, 0xFEAC, 0xFEAC], // Thal
  0x0631: [0xFEAD, 0xFEAD, 0xFEAE, 0xFEAE], // Reh
  0x0632: [0xFEAF, 0xFEAF, 0xFEB0, 0xFEB0], // Zain
  0x0633: [0xFEB1, 0xFEB3, 0xFEB4, 0xFEB2], // Seen
  0x0634: [0xFEB5, 0xFEB7, 0xFEB8, 0xFEB6], // Sheen
  0x0635: [0xFEB9, 0xFEBB, 0xFEBC, 0xFEBA], // Sad
  0x0636: [0xFEBD, 0xFEBF, 0xFEC0, 0xFEBE], // Dad
  0x0637: [0xFEC1, 0xFEC3, 0xFEC4, 0xFEC2], // Tah
  0x0638: [0xFEC5, 0xFEC7, 0xFEC8, 0xFEC6], // Zah
  0x0639: [0xFEC9, 0xFECB, 0xFECC, 0xFECA], // Ain
  0x063A: [0xFECD, 0xFECF, 0xFED0, 0xFECE], // Ghain
  0x0641: [0xFED1, 0xFED3, 0xFED4, 0xFED2], // Feh
  0x0642: [0xFED5, 0xFED7, 0xFED8, 0xFED6], // Qaf
  0x0643: [0xFED9, 0xFEDB, 0xFEDC, 0xFEDA], // Kaf
  0x0644: [0xFEDD, 0xFEDF, 0xFEE0, 0xFEDE], // Lam
  0x0645: [0xFEE1, 0xFEE3, 0xFEE4, 0xFEE2], // Meem
  0x0646: [0xFEE5, 0xFEE7, 0xFEE8, 0xFEE6], // Noon
  0x0647: [0xFEE9, 0xFEEB, 0xFEEC, 0xFEEA], // Heh
  0x0648: [0xFEED, 0xFEED, 0xFEEE, 0xFEEE], // Waw
  0x0649: [0xFEEF, 0xFEEF, 0xFEF0, 0xFEF0], // Alef Maksura
  0x064A: [0xFEF1, 0xFEF3, 0xFEF4, 0xFEF2], // Yeh
  0x0640: [0x0640, 0x0640, 0x0640, 0x0640]  // Tatweel
};

const rightOnly = new Set([
  0x0622, 0x0623, 0x0624, 0x0625, 0x0627, 0x062F, 0x0630, 0x0631, 0x0632, 0x0648, 0x0649, 0x0629
]);

function shapeArabicText(text) {
  if (!text) return '';
  const chars = Array.from(text);
  const shaped = [];

  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].charCodeAt(0);
    const map = arabicMap[code];

    if (!map) {
      shaped.push(chars[i]);
      continue;
    }

    const prevCode = i > 0 ? chars[i - 1].charCodeAt(0) : null;
    const prevConnects = prevCode && arabicMap[prevCode] && !rightOnly.has(prevCode);

    const nextCode = i < chars.length - 1 ? chars[i + 1].charCodeAt(0) : null;
    const nextConnects = nextCode && arabicMap[nextCode];

    let formIndex = 0;
    if (prevConnects && nextConnects && !rightOnly.has(code)) {
      formIndex = 2; // medial
    } else if (prevConnects) {
      formIndex = 3; // final
    } else if (nextConnects && !rightOnly.has(code)) {
      formIndex = 1; // initial
    } else {
      formIndex = 0; // isolated
    }

    shaped.push(String.fromCharCode(map[formIndex]));
  }

  return bidiReorder(shaped);
}

function bidiReorder(chars) {
  const runs = [];
  let currentRun = [];
  let currentIsArabic = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const code = ch.charCodeAt(0);
    const isAr = (code >= 0x0600 && code <= 0x06FF) || (code >= 0xFB50 && code <= 0xFDFF) || (code >= 0xFE70 && code <= 0xFEFF);

    if (i === 0) {
      currentIsArabic = isAr;
      currentRun.push(ch);
    } else if (isAr === currentIsArabic) {
      currentRun.push(ch);
    } else {
      runs.push({ isArabic: currentIsArabic, text: currentRun });
      currentRun = [ch];
      currentIsArabic = isAr;
    }
  }
  if (currentRun.length > 0) {
    runs.push({ isArabic: currentIsArabic, text: currentRun });
  }

  const outRuns = [];
  for (const r of runs) {
    if (r.isArabic) {
      outRuns.push(r.text.reverse().join(''));
    } else {
      outRuns.push(r.text.join(''));
    }
  }

  return outRuns.reverse().join('');
}

module.exports = { shapeArabicText };
