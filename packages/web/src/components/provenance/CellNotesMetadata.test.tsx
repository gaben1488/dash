// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { CellNotesMetadata } from './CellNotesMetadata';
import { fetchJSON } from '../../api';
vi.mock('../../api',()=>({ fetchJSON:vi.fn() }));
afterEach(()=>{cleanup();vi.mocked(fetchJSON).mockReset();});
it('reads only when opened and exposes original address claims without assigning them to the procurement',async()=>{
 vi.mocked(fetchJSON).mockResolvedValue({status:'unavailable',reason:'Нет доступа',identity:'physical-address-only',sheet:'ВСЕ',notes:[{id:'note',book:'УКСиМП',readAt:'2026-10-13T01:00:00Z',evidence:{sheet:'ВСЕ',sheetId:17,cell:'AF534',content:'Было: 327 (21.05.2026 10:17, автор)',author:null}}],total:1,shown:1,truncated:false});
 const view=render(<CellNotesMetadata deptId="УКСиМП" physicalRow={534} column="AF" rowRevision="revision"/>);
 expect(fetchJSON).not.toHaveBeenCalled();
 fireEvent.click(view.getByRole('button',{name:/Заметки ячейки/}));
 await view.findByText('Нет доступа');
 expect(view.getByText('Было: 327 (21.05.2026 10:17, автор)')).toBeTruthy();
 expect(view.getByText(/физическому адресу/)).toBeTruthy();
 expect(view.getByText(/Автор заметки Google не установлен/)).toBeTruthy();
 expect(fetchJSON).toHaveBeenCalledWith(expect.stringContaining('row=534&column=AF'));
});
it.each([{}, {status:'read',notes:[null]}, {status:'read',notes:[]}, {status:'read',notes:[],total:null,shown:0,truncated:false}, {status:'read',notes:[],total:1,shown:0,truncated:false}, {status:'read',notes:[],total:0,shown:1,truncated:false}, {status:'read',notes:[],total:0,shown:0,truncated:true}])('does not turn a malformed response into empty history: %j',async response=>{
 vi.mocked(fetchJSON).mockResolvedValue(response);
 const view=render(<CellNotesMetadata deptId="УКСиМП" physicalRow={4}/>);
 fireEvent.click(view.getByRole('button'));
 await view.findByText('Заметки не прочитаны. Это не отсутствие истории.');
 expect(view.queryByText(/заметок нет/)).toBeNull();
});
it('does not attach an old pending address response after the selected row moves',async()=>{
 let finish!:(value:unknown)=>void;
 vi.mocked(fetchJSON).mockImplementation(()=>new Promise<unknown>(resolve=>{finish=resolve;}) as Promise<never>);
 const view=render(<CellNotesMetadata deptId="УКСиМП" physicalRow={534} column="AF"/>);
 fireEvent.click(view.getByRole('button'));
 view.rerender(<CellNotesMetadata deptId="УКСиМП" physicalRow={155} column="AF"/>);
 finish({status:'read',identity:'physical-address-only',readAt:'2026-10-13T01:00:00Z',total:1,shown:1,truncated:false,notes:[{id:'old',book:'УКСиМП',readAt:'2026-10-13T01:00:00Z',evidence:{sheet:'ВСЕ',sheetId:17,cell:'AF534',content:'Заметка прежнего адреса'}}]});
 await Promise.resolve();
 expect(view.queryByText('Заметка прежнего адреса')).toBeNull();
 expect(view.getByRole('button').textContent).toBe('Заметки ячейки AF155');
});
it('claims empty history only from a complete confirmed read and rejects malformed count states',async()=>{
 vi.mocked(fetchJSON).mockResolvedValue({status:'read',identity:'physical-address-only',readAt:'2026-10-13T01:00:00Z',notes:[],total:0,shown:0,truncated:false});
 const view=render(<CellNotesMetadata deptId="УКСиМП" physicalRow={534}/>);
 fireEvent.click(view.getByRole('button'));await view.findByText('В сохранённых чтениях этого адреса заметок нет.');
 expect(view.getByText('Последнее сохранённое чтение канала: 2026-10-13T01:00:00Z')).toBeTruthy();
});
