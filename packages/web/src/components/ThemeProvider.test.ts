// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {pageDawnStyle} from './ThemeProvider';
it('uses the same dawn for header and page context',()=>{
 const style=pageDawnStyle('economy');
 expect(style['--page-sky']).toBe('#a0d8bc');
 expect(style['--page-sky']).toBe(style['--hdr-sky']);
 expect(style['--page-horizon']).toBe(style['--hdr-horizon']);
});
it('retains the Control palette throughout its child routes',()=>{
 for(const page of ['recon','trust','issues','recs','journal'] as const)expect(pageDawnStyle(page)).toEqual(pageDawnStyle('quality'));
});
