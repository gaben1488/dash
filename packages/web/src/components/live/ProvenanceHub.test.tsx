// @vitest-environment jsdom
import * as React from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, waitFor} from '@testing-library/react';
import {ProvenanceHub} from './ProvenanceHub';
import {useStore} from '../../store';
import {fetchChangeStory} from '../../lib/changes/change-story-client';
import type {ChangeStoryResponse} from '../../lib/changes/change-story-client';
import {CHANGE_KIND_ORDER} from '@aemr/core';
import {fetchJSON} from '../../api';
vi.mock('../../hooks/useLiveEvents',()=>({useLiveEvents:()=>({connected:false,lastEventAt:null,books:[],newIssues:0,recentRows:[]})}));
vi.mock('../../lib/changes/change-story-client',async original=>({...await original<typeof import('../../lib/changes/change-story-client')>(),fetchChangeStory:vi.fn()}));
vi.mock('../../api',async original=>({...await original<typeof import('../../api')>(),fetchJSON:vi.fn(()=>new Promise(()=>{}))}));
function story(entries:number):ChangeStoryResponse {
 return {since:'2026-10-08',digest:{books:1,booksNamed:['Демо'],rows:1,entries,byKind:Object.fromEntries(CHANGE_KIND_ORDER.map(k=>[k,k==='money'?entries:0])) as ChangeStoryResponse['digest']['byKind'],authors:[],firstAt:null,lastAt:null,emptiness:'none'},gaps:[],deletionsUnobservable:false,note:'',comparison:null,facets:{books:[],authors:[]},total:entries,shown:0,entries:[]};
}
afterEach(()=>{cleanup();vi.mocked(fetchChangeStory).mockReset();vi.mocked(fetchJSON).mockReset().mockImplementation(()=>new Promise<never>(()=>{}));useStore.setState({lastRefreshed:null});});
it('keeps a delayed journal response and rereads after a confirmed refresh',async()=>{
 let resolve!:(v:ChangeStoryResponse)=>void;
 vi.mocked(fetchChangeStory).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const view=render(<ProvenanceHub/>);fireEvent.click(view.getByRole('button'));
 await waitFor(()=>expect(fetchChangeStory).toHaveBeenCalledOnce());
 await act(async()=>{resolve(story(7));});
 await view.findByText(/7 правок/);
 vi.mocked(fetchChangeStory).mockResolvedValueOnce(story(9));
 act(()=>useStore.setState({lastRefreshed:'2026-10-12T06:00:00Z'}));
 await view.findByText(/9 правок/);
});
it('does not allow an older pending journal to replace a newer refresh',async()=>{
 let old!:(v:ChangeStoryResponse)=>void;
 vi.mocked(fetchChangeStory).mockImplementationOnce(()=>new Promise(r=>{old=r;})).mockResolvedValueOnce(story(11));
 const view=render(<ProvenanceHub/>);fireEvent.click(view.getByRole('button'));
 await waitFor(()=>expect(fetchChangeStory).toHaveBeenCalledOnce());
 act(()=>useStore.setState({lastRefreshed:'2026-10-12T06:01:00Z'}));
 await view.findByText(/11 правок/);
 await act(async()=>{old(story(3));});
 expect(view.queryByText(/3 правки/)).toBeNull();expect(view.getByText(/11 правок/)).toBeTruthy();
});
it('does not present an earlier source passport as current after reread fails',async()=>{
 vi.mocked(fetchChangeStory).mockResolvedValue(story(2));
 vi.mocked(fetchJSON).mockResolvedValueOnce({refresh:{webhookConfigured:true,autoRefreshMinutes:10,workWindowLabel:'пример'}}).mockRejectedValueOnce(new Error('offline'));
 const view=render(<ProvenanceHub/>);fireEvent.click(view.getByRole('button'));
 await view.findByText(/10 мин/);
 act(()=>useStore.setState({lastRefreshed:'2026-10-12T06:02:00Z'}));
 await waitFor(()=>expect(view.queryByText(/10 мин/)).toBeNull());
});

it('switches journal tabs with arrows, Home and End and keeps one tab stop',async()=>{
 vi.mocked(fetchChangeStory).mockResolvedValue(story(2));
 const view=render(<ProvenanceHub compact/>);
 fireEvent.click(view.getByRole('button',{name:/Журнал обновлений/}));
 const changes=view.getByRole('tab',{name:'Изменения'}),sources=view.getByRole('tab',{name:'Источники'});
 changes.focus();fireEvent.keyDown(changes,{key:'ArrowRight'});
 expect(document.activeElement).toBe(sources);expect(sources.getAttribute('aria-selected')).toBe('true');
 expect(changes.tabIndex).toBe(-1);expect(sources.tabIndex).toBe(0);
 fireEvent.keyDown(sources,{key:'Home'});expect(document.activeElement).toBe(changes);
 fireEvent.keyDown(changes,{key:'End'});expect(document.activeElement).toBe(sources);
});

it('opens the full journal with the same server-controlled weekly baseline',async()=>{
 vi.mocked(fetchChangeStory).mockResolvedValue(story(2));
 const view=render(<ProvenanceHub compact/>);
 fireEvent.click(view.getByRole('button',{name:/Журнал обновлений/}));
 fireEvent.click(view.getByRole('button',{name:/Весь журнал изменений/}));
 await waitFor(()=>expect(fetchChangeStory).toHaveBeenCalledWith(expect.objectContaining({limit:400,since:undefined})));
 fireEvent.click(view.getByRole('button',{name:'всё, что есть'}));
 await waitFor(()=>expect(fetchChangeStory).toHaveBeenCalledWith(expect.objectContaining({limit:400,since:'2020-01-01'})));
});
