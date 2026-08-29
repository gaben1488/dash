/* Общее для etalon-sync: авторизация ботом, адресация, цвета, чтение дампов. */
const { google } = require('C:/Users/filat/dash/packages/server/node_modules/googleapis');
const fs = require('fs');
const path = require('path');

const DUMP_DIR = 'E:/aemr-dumps/book-dumps/meta-2026-08-29';
const PLANS_DIR = 'E:/aemr-dumps/etalon-sync/plans';

const BOOKS = {
  uer:    { key: 'grbs-UER',    ru: 'УЭР',    id: '15NEAE1zK0qc5li4BCwT4Jq-MH6uuA_SFFMG22ZrM4t4', main: 'ВСЕ' },
  uio:    { key: 'grbs-UIO',    ru: 'УИО',    id: '1qCBY5EDSASxK6_ZPQbxzdF8cKIjcwcuykbnOc45Ukn8', main: 'УИО' },
  uagzo:  { key: 'grbs-UAGZO',  ru: 'УАГЗО',  id: '1DgO0t_Zx-PXmtLBp5ddkQvb2_pTkmyFKP_PaDqjOyXk', main: 'ВСЕ' },
  ufbp:   { key: 'grbs-UFBP',   ru: 'УФБП',   id: '14A7vvvvPFxY3SKwtYnMsNfmn_kkxbxWSkN78cYBfszQ', main: 'УФБП' },
  ud:     { key: 'grbs-UD',     ru: 'УД',     id: '1zrpgVaCyS4S4KBNMFuDleMJS-PSTonHmPY_bRLgTVsg', main: 'ВСЕ' },
  udth:   { key: 'grbs-UDTH',   ru: 'УДТХ',   id: '1bxh-mRLQ_ODsdpZ4JW2JJ8sOMjg4zJRhPydR6vjzqb4', main: 'УДТХ' },
  uksimp: { key: 'grbs-UKSiMP', ru: 'УКСиМП', id: '1aFAw9AfNxkTVCqwp6G6fchn3ZeDi8FwFu5-xgRSo7aI', main: 'ВСЕ' },
  uo:     { key: 'grbs-UO',     ru: 'УО',     id: '1AGvXDSKSjpPc11ce4NDK262qySM4W6nFTq2YcgQ6Sds', main: 'ВСЕ' },
};

function loadEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file || 'C:/Users/filat/dash/.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function sheetsApi(scope) {
  const env = loadEnv();
  let key = String(env.GOOGLE_PRIVATE_KEY || '').replace(/^['"]/, '').replace(/['"]$/, '').replace(/\\n/g, '\n');
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key,
    scopes: [scope === 'write' ? 'https://www.googleapis.com/auth/spreadsheets' : 'https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

function colLetter(idx) {
  let out = '';
  idx += 1;
  while (idx) { idx -= 1; out = String.fromCharCode(65 + (idx % 26)) + out; idx = Math.floor(idx / 26); }
  return out;
}

function colIndex(letter) {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function hexcolor(c) {
  if (!c) return null;
  const f = (x) => Math.round(255 * (x || 0));
  return '#' + [f(c.red), f(c.green), f(c.blue)].map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join('');
}

function rgbFromHex(hex) {
  const h = hex.replace('#', '');
  return { red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255 };
}

function a1(gr) {
  const cell = (c, r) => (c !== undefined && c !== null ? colLetter(c) : '') + (r !== undefined && r !== null ? String(r + 1) : '');
  const left = cell(gr.startColumnIndex, gr.startRowIndex);
  const right = cell(gr.endColumnIndex !== undefined && gr.endColumnIndex !== null ? gr.endColumnIndex - 1 : null,
    gr.endRowIndex !== undefined && gr.endRowIndex !== null ? gr.endRowIndex - 1 : null);
  if (!left && !right) return 'весь лист';
  return right && right !== left ? left + ':' + right : left;
}

function loadStruct(bookKey) {
  return JSON.parse(fs.readFileSync(path.join(DUMP_DIR, bookKey + '-struct.json'), 'utf8'));
}

module.exports = { BOOKS, DUMP_DIR, PLANS_DIR, loadEnv, sheetsApi, colLetter, colIndex, hexcolor, rgbFromHex, a1, loadStruct };
