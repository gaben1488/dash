import React, {useState} from 'react';
import { Check, Radio, RefreshCw, X, ArrowUpRight, MessageSquare, StickyNote, AlertCircle } from 'lucide-react';
import { needsNotice, selectionAxes } from './shell-model.mjs';
import PALETTES from './source-shell/palettes.json';

export function AppearancePanel({family, setFamily, finish, setFinish, motion, setMotion}) {
  const finishes = [
    ['candy','Кэнди','Лак и глубина выбранного предмета'],
    ['metal','Металлик','Мелкая грань и спокойный блик'],
    ['pearl','Перламутр','Мягкий перелив внутри пары'],
    ['xirallic','Ксираллик','Редкая искра на цветном слое'],
    ['matte','Мат','Тихая поверхность без бликов'],
    ['glass','Стекло','Свет и глубина под линзой'],
  ];
  return <div className="appearance-panel">
    <p>Те же барабаны, три найденных семейства. Меняется оформление; выбранные данные остаются.</p>
    <div className="family-choices">{PALETTES.map(p=><button key={p.name} className={family===p.name?'chosen':''} aria-pressed={family===p.name} onClick={()=>setFamily(p.name)}>
      <span className="family-head"><strong>{p.name}</strong>{family===p.name&&<Check size={15}/>}</span>
      <span className="family-swatches" aria-hidden="true">{p.tabs.map(t=><i key={t.name} title={t.name} style={{background:`linear-gradient(${t.top},${t.bottom})`}}/>)}</span>
    </button>)}</div>
    <h3>Поверхность выбранной вкладки</h3>
    <p className="muted">В основной композиции — кэнди. Стекло барабанов и спокойные таблицы сохраняют своё назначение.</p>
    <div className="finish-choices">{finishes.map(([id,name,description])=><button key={id} aria-pressed={finish===id} onClick={()=>setFinish(id)}>
      <span className={'material-sample finish-'+id}><span>{name}</span></span><small>{description}</small>
    </button>)}</div>
    <label className="motion-choice"><input type="checkbox" checked={motion} onChange={e=>setMotion(e.target.checked)}/><span>Живая заря <small>Медленный перелив внутри выбранного предмета. Системное уменьшение движения имеет приоритет.</small></span></label>
  </div>;
}

export function AxisPanel({filters, unit, week}) {
  const axes = selectionAxes(filters,unit,week);
  return <div className="axis-families">{['когда','кто','что','как'].map(f=><section key={f}>
    <h3>{f}</h3>{axes.filter(a=>a.family===f).map(a=><div key={a.key} className={'axis-row '+(a.active?'axis-active':'')} data-kind={a.kind}>
      <i aria-hidden="true"/><span>{a.name}<small>{String(a.value)}{a.kind==='mode'?' · режим':''}</small></span>
    </div>)}
  </section>)}</div>;
}

const phaseText = {
  ready:['Версия на экране','Пример последнего успешного чтения: 9 октября, 09:18, Камчатка.'],
  seen:['Правка замечена','Вебхук пришёл. Значения на экране ещё прежние.'],
  reading:['Читаем изменившуюся книгу','Формулы и значения ещё проверяются. Текущий экран остаётся доступным.'],
  waiting:['Новая версия готова','Применение отложено, чтобы не прервать работу.'],
  failed:['Прочитать новую версию не удалось','Прежние числа сохранены. Можно повторить чтение.'],
};
export function LivePanel({update, dispatch, refresh, onOpen, row, mode, setMode}) {
  const [tab,setTab]=useState('changes');
  const state = phaseText[update.phase] || phaseText.ready;
  return <div className="live-panel">
    <div className="live-panel-status"><Radio/><div><h3>{state[0]}</h3><p>{state[1]}</p></div><span className="version-chip">v{update.version} · демо</span></div>
    <div className="live-mode"><span>Обновление</span><strong>{mode==='webhook'?'По вебхуку':mode==='schedule'?'По расписанию':'Режим неизвестен'}</strong><small>{mode==='webhook'?'После уведомления читаются изменившиеся книги. Сигнал о правке ещё не означает готовность цифр.':mode==='schedule'?'Пример режима периодического чтения. Живое расписание в макете не подключено.':'Паспорт источника не получен; способ обновления не угадывается.'}</small></div>
    <div className="live-tabs" role="tablist" aria-label="Содержание эфира">{[['changes','Что изменилось'],['comments','Комментарии'],['sources','Откуда числа']].map(([id,name])=><button key={id} role="tab" aria-selected={tab===id} onClick={()=>setTab(id)}>{name}</button>)}</div>
    <div className="live-panel-body" role="tabpanel">
      {tab==='changes'&&<>
        <div className={'live-change '+(['seen','reading'].includes(update.phase)?'unconfirmed':'')}><time>09:18 · УО</time><h3>Проверяется связь с процедурой</h3><p>№ 173/1 и 173/2 относятся к одной процедуре. Повтор процедуры может быть правильной связью двух строк.</p><button className="text-button" onClick={()=>onOpen(row,'source')}>Открыть основание <ArrowUpRight size={13}/></button></div>
        <div className="live-change"><time>09:16 · УДТХ</time><h3>Прочитано, изменений нет</h3><p>Книга доступна. Это отличается от ошибки или пропущенного чтения.</p></div>
      </>}
      {tab==='comments'&&<div className="comment-kinds">
        <section><StickyNote/><div><h3>Примечание ячейки</h3><p>G{row.sheetRow} · {row.note}</p><button className="text-button" onClick={()=>onOpen(row,'source')}>К исходной ячейке <ArrowUpRight size={13}/></button></div></section>
        <section><MessageSquare/><div><h3>Обсуждение с ответами</h3><p>Проверка состава закупки. Ветка с авторами, ответами и состоянием «открыто / закрыто».</p><button className="text-button" onClick={()=>onOpen(row,'discussion')}>Открыть обсуждение <ArrowUpRight size={13}/></button></div></section>
        <p className="small-note">AF/AG/AH — самостоятельные поля таблицы. Эти три источника пояснений не смешиваются. Здесь показаны примеры, не импортированный журнал.</p>
      </div>}
      {tab==='sources'&&<div className="live-source-list">
        <h3>Какая версия показана</h3><p>Демонстрационный набор от 9 октября. Переключение стадий показывает поведение интерфейса; исходные суммы в этой пробе не меняются.</p>
        <dl><dt>Значение и формула</dt><dd>Отдельные поля одной ячейки</dd><dt>Примечание</dt><dd>Адрес ячейки сохранён</dd><dt>Обсуждение</dt><dd>Привязка и запись требуют API</dd><dt>Недельный архив</dt><dd>Исторические выгрузки не подключены</dd></dl>
        <button className="text-button" onClick={()=>onOpen(row,'source')}>Проверить число по ячейке <ArrowUpRight size={13}/></button>
      </div>}
    </div>
    {(update.phase==='waiting'||update.phase==='failed')&&<button className="primary" onClick={()=>update.phase==='waiting'?dispatch({type:'apply'}):refresh()}>{update.phase==='waiting'?'Показать готовую версию':'Повторить чтение'}</button>}
    <details className="demo-states"><summary>Проверить состояния на примере</summary><div className="state-options">
      <button onClick={()=>dispatch({type:'seen'})}>Уведомление о правке</button><button onClick={()=>dispatch({type:'read'})}>Чтение</button><button onClick={()=>dispatch({type:'complete',blocked:true})}>Готово, но я работаю</button><button onClick={()=>dispatch({type:'fail'})}>Ошибка</button><button onClick={()=>dispatch({type:'reset'})}>Вернуть исходный вид</button>
    </div><label>Режим примера <select value={mode} onChange={e=>setMode(e.target.value)}><option value="webhook">По вебхуку</option><option value="schedule">По расписанию</option><option value="unknown">Неизвестен</option></select></label></details>
  </div>;
}

export function UpdateNotice({update, dispatch, refresh, hasDraft}) {
  if(!needsNotice(update))return null;
  const failed=update.phase==='failed';
  return <div className="update-notice" role="status">
    {failed?<AlertCircle size={17}/>:<RefreshCw size={17}/>}
    <div><strong>{failed?'Новая версия пока недоступна':'Новые данные готовы'}</strong><small>{failed?'На экране прежняя версия. Повторите чтение.':hasDraft?'Вы пишете ответ. Черновик останется на месте.':'Применение отложено, чтобы не прервать работу.'}</small></div>
    <button onClick={()=>failed?refresh():dispatch({type:'apply'})}>{failed?'Повторить':'Показать сейчас'}</button>
    <button aria-label="Скрыть оповещение, версию не менять" onClick={()=>dispatch({type:'dismiss'})}><X size={15}/></button>
  </div>;
}
