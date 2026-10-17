import type { ChangeEntry } from '@aemr/core';
import { buildSheetUrl } from '@aemr/shared';
import { sourceCellUrl } from '../../lib/monitoring/format';
import { entryAddress, entryChangeLine, entryWhoWhen, originNote, valueLabel } from './change-story-text';

function Origin({entry}:{entry:ChangeEntry}) {
  const source=entry.journalSource;
  const href=source?sourceCellUrl(buildSheetUrl(source.spreadsheetId),source.journalSheet,`A${source.journalRow}`):null;
  return href?<a href={href} target="_blank" rel="noopener noreferrer">{originNote(entry)}</a>:<>{originNote(entry)}</>;
}

/** Same source events in the Header depth and the full journal; no inferred edits. */
export function UpdateFeed({entries,onOpen}:{entries:readonly ChangeEntry[];onOpen:(entry:ChangeEntry)=>void}) {
  return <div className="uf-feed" role="region" aria-label="Лента обновлений">
    {entries.map(entry=><article key={entry.id} className="uf-event">
      <time className="uf-time" dateTime={entry.at??undefined}>{entry.at?.match(/T(\d{2}:\d{2})/)?.[1]??'время ?'}</time>
      <div className="uf-content">
        <p className="uf-change">{['row-added','row-vanished','row-identity-candidate','row-cleared'].includes(entry.kind)?entryChangeLine(entry):<><b>{entry.columnLabel??entry.column??'Поле'}</b><span className="uf-values"><del>{valueLabel(entry.before)}</del><span aria-hidden="true">→</span><strong>{valueLabel(entry.after)}</strong></span></>}</p>
        <p className="uf-address">{entryAddress({...entry,columnLabel:null})}</p>
        {entry.subject&&<p className="uf-subject">{entry.subject}</p>}
        <p className="uf-evidence">{entryWhoWhen(entry)} · <Origin entry={entry}/></p>
        {entry.evidence&&<details className="uf-originals"><summary>Исходные свидетельства · {entry.evidence.length}</summary>{entry.evidence.map((original,i)=><div className="uf-post" key={`${original.origin}:${original.id}:${i}`}><p>{entryAddress(original)} · <Origin entry={original}/></p><p><del>{valueLabel(original.before)}</del> → <strong>{valueLabel(original.after)}</strong></p><p className="uf-scope">{entryWhoWhen(original)}</p></div>)}</details>}
        {(entry.relatedRowSeq||entry.rowSeq||entry.subject)&&<button type="button" className="uf-drill" onClick={()=>onOpen(entry)}>{entry.kind==='row-vanished'?'поиск в Реестре':'в Реестре'}</button>}
      </div>
    </article>)}
  </div>;
}
