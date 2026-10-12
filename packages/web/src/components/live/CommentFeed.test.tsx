// @vitest-environment jsdom
import * as React from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render} from '@testing-library/react';
import {CommentFeed} from './CommentFeed';
import {fetchJSON} from '../../api';
vi.mock('../../api',()=>({fetchJSON:vi.fn()}));
afterEach(()=>{cleanup();vi.mocked(fetchJSON).mockReset();});
it('keeps cell-note claims, native posts and legacy cache distinct without dropping a book',async()=>{
 vi.mocked(fetchJSON).mockResolvedValue({total:1,comments:[{book:'Демо Б',commentId:'old',content:'Прежнее обсуждение',author:null,replies:2,resolved:true}],witnesses:[{id:'note',book:'Демо А',kind:'cell_note',readAt:'2026-10-12T00:00:00Z',evidence:{sourceId:'sheet!C7',sheet:'ВСЕ',cell:'C7',author:null,content:'Было 100; подпись внутри текста',posts:[]}},{id:'thread',book:'Демо А',kind:'native_thread',readAt:'2026-10-12T00:00:00Z',evidence:{sourceId:'native',content:'Вопрос сотрудника',author:'Автор вопроса',posts:[{id:'reply',author:'Координатор',content:'Отработано'}]}}]});
 const view=render(<CommentFeed enabled readRevision={null}/>);
 await view.findByText('Автор заметки не известен',{exact:false});
 expect(view.getByText('Прежнее обсуждение')).toBeTruthy();
 expect(view.getByText('Координатор')).toBeTruthy();expect(view.getByText('Отработано')).toBeTruthy();
 expect(fetchJSON).toHaveBeenCalledWith('/comments?limit=20');
});
it('does not read while the comments layer is closed',()=>{
 render(<CommentFeed enabled={false} readRevision={null}/>);expect(fetchJSON).not.toHaveBeenCalled();
});
it('a failed read does not become no comments',async()=>{
 vi.mocked(fetchJSON).mockRejectedValue(new Error('unavailable'));
 const view=render(<CommentFeed enabled readRevision={null}/>);
 await view.findByText('Комментарии не прочитаны. Это не отсутствие обсуждений.');
});

it('does not turn malformed successful HTTP into an empty comment cache',async()=>{
 vi.mocked(fetchJSON).mockResolvedValue({});
 const view=render(<CommentFeed enabled readRevision={null}/>);
 await view.findByText('Комментарии не прочитаны. Это не отсутствие обсуждений.');
});
