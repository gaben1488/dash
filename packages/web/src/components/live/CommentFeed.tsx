import { useEffect, useState } from 'react';
import { fetchJSON } from '../../api';

const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const text=(value:unknown)=>typeof value==='string'?value:null;
const records=(value:unknown)=>Array.isArray(value)?value.map(record):[];

/** Cached original evidence: notes, native posts and legacy threads stay distinct. */
export function CommentFeed({enabled,readRevision}:{enabled:boolean;readRevision:string|null}) {
  const [data,setData]=useState<Record<string,unknown>|null>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    if(!enabled)return;
    let alive=true;setData(null);setFailed(false);
    void fetchJSON<unknown>('/comments?limit=20').then(value=>{
      const next=record(value);
      if(!Array.isArray(next.comments)||typeof next.total!=='number'||!Number.isSafeInteger(next.total)||next.total<0||
         (next.witnesses!==undefined&&!Array.isArray(next.witnesses)))throw new Error('COMMENT_FEED_SHAPE_UNAVAILABLE');
      if(alive)setData(next);
    }).catch(()=>{if(alive)setFailed(true);});
    return ()=>{alive=false;};
  },[enabled,readRevision]);
  if(failed)return <p className="uf-empty">Комментарии не прочитаны. Это не отсутствие обсуждений.</p>;
  if(data===null)return <p className="uf-empty">Читаем сохранённые обсуждения и заметки…</p>;
  const witnesses=records(data.witnesses).filter(w=>['native_thread','cell_note','drive_thread'].includes(String(w.kind)));
  const legacy=records(data.comments);
  // Deduplicate only the same Drive ID in the same book. Native Sheets IDs
  // and notes have another scope; similarity is not proof of one discussion.
  const legacyVisible=legacy.filter(c=>!witnesses.some(w=>w.kind==='drive_thread'&&w.book===c.book&&record(w.evidence).sourceId===c.commentId));
  return <section className="uf-comments" aria-label="Обсуждения и заметки Google">
    <p className="uf-scope">Сохранённые чтения. Время чтения отличается от времени комментария; это не недельный счёт изменений.</p>
    {data.witnesses===undefined&&<p className="uf-empty">Этот сервер не передал историю заметок и полные обсуждения. Доступна только прежняя проекция.</p>}
    {witnesses.map(w=>{
      const e=record(w.evidence), note=w.kind==='cell_note', posts=records(e.posts);
      return <article className="uf-comment" key={String(w.id)}>
        <header><b>{note?'Заметка ячейки':w.kind==='native_thread'?'Обсуждение Google':'Обсуждение Drive'}</b><span>{text(w.book)??'Книга неизвестна'} · {[text(e.sheet),text(e.cell)].filter(Boolean).join('!')||'адрес не доказан'}</span></header>
        <p className="uf-comment-text">{text(e.content)??'Текст не передан'}</p>
        <p className="uf-evidence">{note?'Автор заметки не известен':text(e.author)??'Автор не назван источником'} · прочитано {text(w.readAt)??'в неизвестное время'}</p>
        {posts.length>0&&<details><summary>Исходные сообщения и ответы · {posts.length}</summary>{posts.map((post,i)=><div className="uf-post" key={text(post.id)??i}><b>{text(post.author)??'Автор не назван'}</b><p>{text(post.content)??'Текст не передан'}</p></div>)}</details>}
        {note&&<p className="uf-scope">Имена и даты внутри заметки — её текст, не метаданные авторства Google.</p>}
        <p className="uf-scope">{text(e.sourceRevision)?'Есть ревизия источника':'Ревизия источника не доказана'}. Решение Dash и состояние обсуждения Google независимы.</p>
      </article>;
    })}
    {legacyVisible.map((c,i)=><article className="uf-comment" key={text(c.commentId)??i}><header><b>Сохранённая проекция Drive</b><span>{text(c.book)}</span></header><p className="uf-comment-text">{text(c.content)??'Текст не передан'}</p><p className="uf-evidence">{text(c.author)??'Автор не назван'} · {c.resolved===true?'Закрыто в сохранённом чтении Google':'Закрытие в Google не подтверждено'}</p><p className="uf-scope">{typeof c.replies==='number'?`Ответов: ${c.replies}; полные тексты не переданы.`:'Число ответов не передано.'} Адрес по цитате не угадываем.</p></article>)}
    {witnesses.length===0&&legacy.length===0&&<p className="uf-empty">В этом ответе сохранённых комментариев нет. Полнота чтения всех книг этим не доказана.</p>}
  </section>;
}
