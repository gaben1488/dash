// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { TableEditor } from './TableEditor';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('opens read-only metadata through the selected physical cell callback without saving or changing values',()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){} unobserve(){}});
 const callback=vi.fn(),save=vi.fn(),change=vi.fn();
 const row={_id:'row',_dept:'УКСиМП',_rowIndex:534,subject:'Предмет'};
 const view=render(<TableEditor rows={[row]} columns={[{key:'subject',label:'Предмет',type:'text'}]} onCellMetadata={callback} onSaveRow={save} onCellChange={change}/>);
 const button=view.getByRole('button',{name:'Заметки выбранной ячейки'});expect((button as HTMLButtonElement).disabled).toBe(true);
 fireEvent.focus(view.getByRole('cell',{name:'Предмет'}));
 fireEvent.click(button);expect(callback).toHaveBeenCalledWith(row,'subject');expect(save).not.toHaveBeenCalled();expect(change).not.toHaveBeenCalled();
});
it('preserves a clicked active editor and its uncommitted draft across metadata focus and close',()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){} unobserve(){}});
 const callback=vi.fn(),change=vi.fn(),save=vi.fn();const row={_id:'r',subject:'Untouched'};
 const props={rows:[row],columns:[{key:'subject',label:'Subject',type:'text' as const}],onCellMetadata:callback,onCellChange:change,onSaveRow:save};
 const view=render(<TableEditor {...props} metadataOpen={false}/>);
 fireEvent.click(view.getByRole('cell',{name:'Untouched'}));
 const input=view.getByRole('textbox',{name:'Subject: значение'}) as HTMLInputElement;
 fireEvent.change(input,{target:{value:'Pending draft'}});
 const button=view.getByRole('button',{name:'Заметки выбранной ячейки'});
 fireEvent.mouseDown(button);button.focus();fireEvent.mouseUp(button);fireEvent.click(button);
 expect(callback).toHaveBeenCalledTimes(1);expect(change).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
 view.rerender(<TableEditor {...props} metadataOpen/>);
 input.blur();
 view.rerender(<TableEditor {...props} metadataOpen={false}/>);
 expect((view.getByRole('textbox',{name:'Subject: значение'}) as HTMLInputElement).value).toBe('Pending draft');
 expect(document.activeElement).toBe(input);expect(change).not.toHaveBeenCalled();
});


it('shows field guidance without changing or saving the source', () => {
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){} unobserve(){}});
 const save=vi.fn(), change=vi.fn();
 const view=render(<TableEditor rows={[{_id:'r',date:'01.10.2026'}]}
  columns={[{key:'date',label:'Дата',type:'date',guidance:'Годовая потребность допускает пустую Q.'}]}
  onCellChange={change} onSaveRow={save}/>);
 fireEvent.click(view.getByRole('cell',{name:'01.10.2026'}));
 const input=view.getByRole('textbox',{name:'Дата: значение'});
 expect(view.getByRole('note').textContent).toContain('пустую Q');
 expect(input.getAttribute('aria-describedby')).toBe(view.getByRole('note').id);
 expect(change).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});
