import type { DepartmentId } from './types.js';

export const DEPARTMENT_SPREADSHEET_IDS: Readonly<Record<DepartmentId, string>> = {
  'УЭР': '15NEAE1zK0qc5li4BCwT4Jq-MH6uuA_SFFMG22ZrM4t4',
  'УИО': '1qCBY5EDSASxK6_ZPQbxzdF8cKIjcwcuykbnOc45Ukn8',
  'УАГЗО': '1DgO0t_Zx-PXmtLBp5ddkQvb2_pTkmyFKP_PaDqjOyXk',
  'УФБП': '14A7vvvvPFxY3SKwtYnMsNfmn_kkxbxWSkN78cYBfszQ',
  'УД': '1zrpgVaCyS4S4KBNMFuDleMJS-PSTonHmPY_bRLgTVsg',
  'УДТХ': '1bxh-mRLQ_ODsdpZ4JW2JJ8sOMjg4zJRhPydR6vjzqb4',
  'УКСиМП': '1aFAw9AfNxkTVCqwp6G6fchn3ZeDi8FwFu5-xgRSo7aI',
  'УО': '1AGvXDSKSjpPc11ce4NDK262qySM4W6nFTq2YcgQ6Sds',
} as const;
