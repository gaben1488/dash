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
 expect(fetchJSON).toHaveBeenCalledWith('/comments?view=discussions&limit=20');
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

it('keeps a different legacy version of the same Drive thread and shows reading gaps',async()=>{
 vi.mocked(fetchJSON).mockResolvedValue({total:1,comments:[{book:'Демо А',commentId:'same',content:'Новое пояснение',resolved:true}],witnesses:[{id:'old',book:'Демо А',kind:'drive_thread',readAt:'2026-10-12T00:00:00Z',evidence:{sourceId:'same',content:'Прежнее пояснение',raw:{resolved:false},posts:[{id:'post',author:'Автор',content:'Прежнее пояснение',raw:{createdTime:'2026-10-11T01:00:00Z'}}]}}],readings:[{id:'gap',book:'Демо Б',kind:'reading:threads',readAt:'2026-10-12T00:00:00Z',evidence:{status:'unavailable',reason:'Нет доступа к обсуждениям.',scope:[],count:null}}]});
 const view=render(<CommentFeed enabled readRevision={null}/>);
 await view.findByText('Новое пояснение');
 expect(view.getByText('Нет доступа к обсуждениям.',{exact:false})).toBeTruthy();
 expect(view.getByText('2026-10-11T01:00:00Z',{exact:false})).toBeTruthy();
 expect(view.getByText('Открыто в сохранённом чтении Google')).toBeTruthy();
});

it('shows replies separately from closure and separates message times from reading time',async()=>{
 vi.mocked(fetchJSON).mockResolvedValue({total:0,comments:[],witnesses:[{id:'thread',book:'Демо',kind:'drive_thread',readAt:'2026-10-13T06:00:00Z',evidence:{sourceId:'thread',author:'Автор вопроса',content:'Вопрос',raw:{resolved:false,createdTime:'2026-10-11T01:00:00Z',modifiedTime:'2026-10-12T02:00:00Z',replies:[{id:'reply',content:'Отработано'},{id:'deleted',content:'Удалённый ответ',deleted:true},{id:'action',action:'resolve'}]},posts:[]}}]});
 const view=render(<CommentFeed enabled readRevision={null}/>);
 await view.findByText('Есть ответы · 1');
 expect(view.getByText('Открыто в сохранённом чтении Google')).toBeTruthy();
 expect(view.getByText('Написано 2026-10-11T01:00:00Z · изменено 2026-10-12T02:00:00Z')).toBeTruthy();
 expect(view.getByText('Автор вопроса · прочитано 2026-10-13T06:00:00Z')).toBeTruthy();
 expect(view.getByText('Решение Dash и состояние обсуждения Google независимы.',{exact:false})).toBeTruthy();
});

it('keeps native replies and resolved state independent, and does not infer replies when metadata is missing',async()=>{
 vi.mocked(fetchJSON).mockResolvedValue({total:0,comments:[],witnesses:[{id:'closed',book:'Демо',kind:'native_thread',readAt:'2026-10-13T06:00:00Z',evidence:{content:'Вопрос',raw:{status:'RESOLVED',headPost:{createTime:'2026-10-12T01:00:00Z'},replies:[{postId:'reply',content:'Ответ'}]},posts:[]}},{id:'unknown',book:'Демо',kind:'drive_thread',evidence:{content:'Нет метаданных',posts:[]}}]});
 const view=render(<CommentFeed enabled readRevision={null}/>);
 await view.findByText('Есть ответы · 1');
 expect(view.getByText('Закрыто в сохранённом чтении Google')).toBeTruthy();
 expect(view.getByText('Наличие ответов не передано источником')).toBeTruthy();
 expect(view.getByText('Написано 2026-10-12T01:00:00Z')).toBeTruthy();
});

it('labels legacy metadata as a projection and retains its author, times and reply-count limitation',async()=>{
 vi.mocked(fetchJSON).mockResolvedValue({total:1,comments:[{book:'Демо',commentId:'legacy',content:'Прежний вопрос',author:'Автор',resolved:false,replies:2,recordedAt:'2026-10-13T06:00:00Z',createdAtMs:Date.parse('2026-10-11T01:00:00Z'),modifiedAtMs:Date.parse('2026-10-12T02:00:00Z')}],witnesses:[]});
 const view=render(<CommentFeed enabled readRevision={null}/>);
 await view.findByText('Автор · прочитано 2026-10-13T06:00:00Z');
 expect(view.getByText('Написано 2026-10-11T01:00:00.000Z · изменено 2026-10-12T02:00:00.000Z')).toBeTruthy();
 expect(view.getByText('Открыто в сохранённом чтении Google')).toBeTruthy();
 expect(view.getByText('Ответов по сохранённой проекции: 2; полные тексты не переданы. Адрес по цитате не угадываем.')).toBeTruthy();
});

it('does not count native resolve or reopen actions without text as answers',async()=>{
 vi.mocked(fetchJSON).mockResolvedValue({total:0,comments:[],witnesses:[{id:'actions',book:'Демо',kind:'native_thread',evidence:{raw:{status:'RESOLVED',replies:[{postId:'resolve',commentAction:'RESOLVE'},{postId:'reopen',commentAction:'REOPEN',content:'   '}]},posts:[]}}]});
 const view=render(<CommentFeed enabled readRevision={null}/>);
 await view.findByText('В этом чтении ответов нет');
 expect(view.getByText('Закрыто в сохранённом чтении Google')).toBeTruthy();
});

it('keeps genuine text attached to native actions and no-action-change posts as answers',async()=>{
 vi.mocked(fetchJSON).mockResolvedValue({total:0,comments:[],witnesses:[{id:'answers',book:'Демо',kind:'native_thread',evidence:{raw:{status:'OPEN',replies:[{postId:'resolve',commentAction:'RESOLVE',content:'Проверено по источнику'},{postId:'reopen',commentAction:'REOPEN',content:'Нужна повторная проверка'},{postId:'plain',commentAction:'NO_COMMENT_ACTION_CHANGE'}]},posts:[]}}]});
 const view=render(<CommentFeed enabled readRevision={null}/>);
 await view.findByText('Есть ответы · 3');
 expect(view.getByText('Открыто в сохранённом чтении Google')).toBeTruthy();
});

it('shows historical unclassified projection and mixed residual without dropping original note text',async()=>{
 vi.mocked(fetchJSON).mockResolvedValue({total:0,comments:[],witnesses:[{id:'mixed',book:'Демо',kind:'cell_note',evidence:{content:'Было: 327 (21.05.2026 10:17, автор)\nУточнить сумму',discussionText:'Уточнить сумму'}},{id:'legacy',book:'Демо',kind:'legacy_cache',evidence:{original:{content:'Старый вопрос',author:'Автор',resolved:0}}}]});
 const view=render(<CommentFeed enabled readRevision={null}/>);
 await view.findByText('Историческая проекция Drive');
 expect(view.getByText('Старый вопрос')).toBeTruthy();expect(view.getByText('Уточнить сумму')).toBeTruthy();
 expect(view.getByText(/Было: 327.*Уточнить сумму/)).toBeTruthy();
});
