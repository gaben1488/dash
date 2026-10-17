import { useEffect, useState } from 'react';
import { fetchJSON } from '../../api';

const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const text=(value:unknown)=>typeof value==='string'?value:null;
const records=(value:unknown)=>Array.isArray(value)?value.map(record):[];
function threadState(raw:Record<string,unknown>):string {
  if(raw.deleted===true)return 'Удалено в сохранённом чтении Google';
  if(raw.resolved===true||raw.status==='RESOLVED')return 'Закрыто в сохранённом чтении Google';
  if(raw.resolved===false||raw.status==='OPEN')return 'Открыто в сохранённом чтении Google';
  return 'Состояние обсуждения не передано Google';
}

/** Reply existence is source evidence, not an interpretation of its text. */
function replyState(raw:Record<string,unknown>):string {
  if(!Array.isArray(raw.replies))return 'Наличие ответов не передано источником';
  const replies=records(raw.replies).filter(post=>post.deleted!==true&&
    ((text(post.content)?.trim().length??0)>0||
      (typeof post.action!=='string'&&post.commentAction!=='RESOLVE'&&post.commentAction!=='REOPEN'&&
        (text(post.id)!==null||text(post.postId)!==null))));
  return replies.length>0?`Есть ответы · ${replies.length}`:'В этом чтении ответов нет';
}
function millisInstant(value:unknown):string|undefined {
  if(typeof value!=='number'||!Number.isFinite(value))return undefined;
  const date=new Date(value);
  return Number.isNaN(date.getTime())?undefined:date.toISOString();
}
function messageTimes(raw:Record<string,unknown>):string {
  const created=text(raw.createTime)??text(raw.createdTime),modified=text(raw.updateTime)??text(raw.modifiedTime);
  return created?`Написано ${created}${modified?` · изменено ${modified}`:''}`:
    modified?`Изменено ${modified}; время создания источник не передал`:'Время сообщения источник не передал';
}

/** Cached original evidence: notes, native posts and legacy threads stay distinct. */
export function CommentFeed({enabled,readRevision}:{enabled:boolean;readRevision:string|null}) {
  const [data,setData]=useState<Record<string,unknown>|null>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    if(!enabled)return;
    let alive=true;setData(null);setFailed(false);
    void fetchJSON<unknown>('/comments?view=discussions&limit=20').then(value=>{
      const next=record(value);
      if(!Array.isArray(next.comments)||typeof next.total!=='number'||!Number.isSafeInteger(next.total)||next.total<0||
         (next.witnesses!==undefined&&!Array.isArray(next.witnesses))||
         (next.readings!==undefined&&!Array.isArray(next.readings)))throw new Error('COMMENT_FEED_SHAPE_UNAVAILABLE');
      if(alive)setData(next);
    }).catch(()=>{if(alive)setFailed(true);});
    return ()=>{alive=false;};
  },[enabled,readRevision]);
  if(failed)return <p className="uf-empty">Комментарии не прочитаны. Это не отсутствие обсуждений.</p>;
  if(data===null)return <p className="uf-empty">Читаем сохранённые обсуждения и заметки…</p>;
  const witnesses=records(data.witnesses).filter(w=>['native_thread','cell_note','drive_thread','legacy_cache'].includes(String(w.kind)));
  const legacy=records(data.comments);
  // An old full witness must not hide a newer legacy projection. Same ID
  // alone proves a discussion, not an identical version of that discussion.
  const legacyVisible=legacy.filter(c=>!witnesses.some(w=>{
    const e=record(w.evidence),raw=record(e.raw);
    return w.kind==='drive_thread'&&w.book===c.book&&e.sourceId===c.commentId&&
      w.readAt===c.recordedAt&&e.content===c.content&&e.author===c.author&&
      raw.resolved===c.resolved&&raw.deleted===c.deleted&&
      Date.parse(String(raw.modifiedTime))===c.modifiedAtMs&&records(e.posts).length===Number(c.replies)+1;
  }));
  const readings=records(data.readings??data.witnesses).filter(w=>String(w.kind).startsWith('reading:'));
  return <section className="uf-comments" aria-label="Обсуждения и заметки Google">
    <p className="uf-scope">Сохранённые чтения. Время чтения отличается от времени комментария; это не недельный счёт изменений.</p>
    {data.witnesses===undefined&&<p className="uf-empty">Этот сервер не передал историю заметок и полные обсуждения. Доступна только прежняя проекция.</p>}
    {readings.length>0&&<details className="uf-reading"><summary>Полнота чтения обсуждений и заметок · {readings.length} каналов</summary>{readings.map(w=>{
      const e=record(w.evidence);
      const scope=Array.isArray(e.scope)?e.scope.filter((s):s is string=>typeof s==='string'):[];
      return <p key={String(w.id)} className="uf-scope"><b>{text(w.book)} · {w.kind==='reading:notes'?'заметки':'обсуждения'}</b>: {e.status==='read'?'прочитано':text(e.reason)??'чтение не подтверждено'} · {text(w.readAt)}{scope.length>0?` · ${scope.join(', ')}`:''}</p>;
    })}</details>}
    {witnesses.map(w=>{
      const original=record(record(w.evidence).original), archived=w.kind==='legacy_cache';
      const boolean=(value:unknown)=>typeof value==='boolean'?value:value===1?true:value===0?false:undefined;
      const e:Record<string,unknown>=archived?{...original,raw:{resolved:boolean(original.resolved),deleted:boolean(original.deleted),createdTime:millisInstant(original.createdAtMs),modifiedTime:millisInstant(original.modifiedAtMs)},posts:[]}:record(w.evidence);
      const note=w.kind==='cell_note', posts=records(e.posts),raw=record(e.raw);
      const head=w.kind==='native_thread'?record(raw.headPost):raw;
      return <article className="uf-comment" key={String(w.id)}>
        <header><b>{note?'Заметка ячейки':archived?'Историческая проекция Drive':w.kind==='native_thread'?'Обсуждение Google':'Обсуждение Drive'}</b><span>{text(w.book)??'Книга неизвестна'} · {[text(e.sheet),text(e.cell)].filter(Boolean).join('!')||'адрес не доказан'}</span></header>
        <p className="uf-comment-text">{(note?text(e.discussionText):null)??text(e.content)??'Текст не передан'}</p>
        {note&&text(e.discussionText)!==null&&e.discussionText!==e.content&&<details><summary>Исходная заметка с историей значений</summary><p className="uf-comment-text">{text(e.content)}</p></details>}
        <p className="uf-evidence">{note?'Автор заметки не известен':text(e.author)??'Автор не назван источником'} · прочитано {text(w.readAt)??'в неизвестное время'}</p>
        {!note&&<>
          <p className="uf-scope">{messageTimes(head)}</p>
          <p className="uf-scope">{threadState(raw)}</p>
          <p className="uf-scope">{replyState(raw)}</p>
        </>}
        {posts.length>0&&<details><summary>Исходные сообщения и ответы · {posts.length}</summary>{posts.map((post,i)=>{
          const raw=record(post.raw);
          return <div className="uf-post" key={`${text(post.id)??'post'}:${i}`}><b>{text(post.author)??'Автор не назван'}</b><p>{text(post.content)??'Текст не передан'}</p><p className="uf-scope">{messageTimes(raw)}</p></div>;
        })}</details>}
        {note&&<p className="uf-scope">Имена и даты внутри заметки — её текст, не метаданные авторства Google.</p>}
        <p className="uf-scope">{text(e.sourceRevision)?'Есть ревизия источника':'Ревизия источника не доказана'}. Решение Dash и состояние обсуждения Google независимы.</p>
      </article>;
    })}
    {legacyVisible.map((c,i)=><article className="uf-comment" key={text(c.commentId)??i}><header><b>Сохранённая проекция Drive</b><span>{text(c.book)}</span></header><p className="uf-comment-text">{text(c.content)??'Текст не передан'}</p><p className="uf-evidence">{text(c.author)??'Автор не назван'} · прочитано {text(c.recordedAt)??'в неизвестное время'}</p><p className="uf-scope">{messageTimes({createdTime:millisInstant(c.createdAtMs),modifiedTime:millisInstant(c.modifiedAtMs)})}</p><p className="uf-scope">{threadState(c)}</p><p className="uf-scope">{typeof c.replies==='number'?`Ответов по сохранённой проекции: ${c.replies}; полные тексты не переданы.`:'Число ответов не передано.'} Адрес по цитате не угадываем.</p></article>)}
    {witnesses.length===0&&legacy.length===0&&<p className="uf-empty">В этом ответе сохранённых комментариев нет. Полнота чтения всех книг этим не доказана.</p>}
  </section>;
}
