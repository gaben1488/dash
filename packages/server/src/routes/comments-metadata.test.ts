import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
const metadata=vi.hoisted(()=>vi.fn(()=>({status:'read',notes:[],total:0,shown:0,identity:'physical-address-only'})));
vi.mock('../config.js',()=>({ DEPARTMENT_SPREADSHEETS:{'УКСиМП':'configured-file'} }));
vi.mock('../services/snapshot.js',()=>({getDeptSheetCache:()=>({'УКСиМП':{sheetName:'Actual sheet',values:Array.from({length:534},()=>[])}})}));
vi.mock('../services/comment-witness-store.js',()=>({listCellNoteMetadata:metadata,listCommentWitnesses:()=>[],listCommentReadings:()=>[],countCommentWitnesses:()=>21,listDiscussionWitnesses:()=>({witnesses:[],counts:{eligible:1,shown:0,historyNotes:20,legacyProjections:0}})}));
vi.mock('../services/drive-comments.js',()=>({listStoredComments:()=>[],countStoredComments:()=>7,refreshCommentsForBooks:vi.fn()}));
it('uses the configured private source and actual cached sheet, without claiming the selected procurement owns the address',async()=>{
 const { commentsRoutes }=await import('./comments.js');const app=Fastify();await app.register(commentsRoutes);
 const response=await app.inject('/api/comments?view=cell-notes&book=uksimp&row=534&column=AF&rowRevision=stale');
 expect(response.statusCode).toBe(200);
 expect(metadata).toHaveBeenCalledWith('configured-file','Actual sheet',534,'AF');
 expect(response.json().warning).toContain('Строка в текущем чтении изменилась');
 expect(response.json().identity).toBe('physical-address-only');
 expect(response.payload).not.toContain('configured-file');
 expect((await app.inject('/api/comments?view=cell-notes&book=unknown&row=534&column=AF')).statusCode).toBe(400);
 expect((await app.inject('/api/comments?view=cell-notes&book=uksimp&row=534&column=AF7')).statusCode).toBe(400);
 await app.close();
});
it('keeps legacy totals separate from discussion witness counts and leaves the old response shape intact',async()=>{
 const { commentsRoutes }=await import('./comments.js');const app=Fastify();await app.register(commentsRoutes);
 const legacy=(await app.inject('/api/comments?limit=20')).json();expect(legacy.total).toBe(7);expect(legacy.discussionCounts).toBeUndefined();
 const view=(await app.inject('/api/comments?view=discussions&limit=20')).json();
 expect(view.total).toBe(7);expect(view.discussionCounts).toMatchObject({eligible:1,historyNotes:20});
 await app.close();
});
