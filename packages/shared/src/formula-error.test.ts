import { describe, it, expect } from 'vitest';
import { isFormulaError, formulaErrorCells } from './formula-error.js';

describe('isFormulaError — детектор ошибки формулы источника', () => {
  it('английские коды: #REF!, #VALUE!, #N/A, #NAME?, #DIV/0!, #NUM!, #NULL!, #ERROR!', () => {
    for (const v of ['#REF!', '#VALUE!', '#N/A', '#NAME?', '#DIV/0!', '#NUM!', '#NULL!', '#ERROR!']) {
      expect(isFormulaError(v), v).toBe(true);
    }
  });

  it('русские коды: #ЗНАЧ!, #ДЕЛ/0!, #Н/Д, #ССЫЛКА!, #ИМЯ?, #ЧИСЛО!, #ПУСТО!', () => {
    for (const v of ['#ЗНАЧ!', '#ДЕЛ/0!', '#Н/Д', '#ССЫЛКА!', '#ИМЯ?', '#ЧИСЛО!', '#ПУСТО!']) {
      expect(isFormulaError(v), v).toBe(true);
    }
  });

  it('ошибка с пояснением после кода — тоже ошибка (упавший IMPORTRANGE)', () => {
    expect(isFormulaError('#REF! (The source sheet for this IMPORTRANGE either does not exist...)')).toBe(true);
    expect(isFormulaError('#ЗНАЧ! (Функция не может обработать значение)')).toBe(true);
  });

  it('регистр и краевые пробелы не мешают', () => {
    expect(isFormulaError('  #ref!  ')).toBe(true);
    expect(isFormulaError('#знач!')).toBe(true);
  });

  it('упоминание кода в середине текста — НЕ ошибка (якорное сличение)', () => {
    expect(isFormulaError('см. правку #REF в строке 12')).toBe(false);
    expect(isFormulaError('исправили #ЗНАЧ! вчера')).toBe(false);
  });

  it('обычные значения — не ошибка: числа, текст, пустота, заглушки', () => {
    for (const v of [null, undefined, '', 123, '1 234,56', 'х', '-', 'Срок нарушен', '#5 позиция']) {
      expect(isFormulaError(v), String(v)).toBe(false);
    }
  });

  it('решётка с продолжением-словом — не код ошибки', () => {
    expect(isFormulaError('#REFERENCE')).toBe(false);
    expect(isFormulaError('#ЗНАЧЕНИЕ')).toBe(false);
  });
});

describe('formulaErrorCells — адреса ячеек с ошибкой', () => {
  it('возвращает графы с ошибками в порядке листа', () => {
    const found = formulaErrorCells({
      A: '1', K: '#REF!', C: 'МКУ Тест', AA: '#ЗНАЧ!', H: '#ДЕЛ/0!',
    });
    expect(found).toEqual([
      { column: 'H', value: '#ДЕЛ/0!' },
      { column: 'K', value: '#REF!' },
      { column: 'AA', value: '#ЗНАЧ!' },
    ]);
  });

  it('чистая строка — пустой список', () => {
    expect(formulaErrorCells({ A: '1', K: 1000, G: 'Ремонт' })).toEqual([]);
  });
});
