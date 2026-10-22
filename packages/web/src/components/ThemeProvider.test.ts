// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {pageDawnStyle} from './ThemeProvider';
const PAGES=['dashboard','report','svod','data','unfunded','yearlong','monitoring','economy','competition','discipline','quality','analytics','settings'] as const;

it('gives each primary page its own dawn instead of sharing Svod and Registry colors',()=>{
 const pairs=PAGES.map(page=>{
  const style=pageDawnStyle(page);
  return [style['--hdr-sky'],style['--hdr-horizon']].join(':');
 });
 expect(new Set(pairs).size).toBe(13);
});

it('declares foreground and both environment accents for every page',()=>{
 for(const page of PAGES){
  const style=pageDawnStyle(page);
  for(const role of ['--hdr-ink','--page-accent-light','--page-accent-dark'])expect(style[role]).toMatch(/^#[0-9a-f]{6}$/i);
 }
});

// Independent WCAG calculation, including the bounded glass reflection and
// hover brightness; endpoint checks alone miss intermediate gradient colors.
const rgb=(hex:string)=>[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)/255);
const luminance=(color:number[])=>color.reduce((sum,value,index)=>sum+[.2126,.7152,.0722][index]!*(value<=.04045?value/12.92:((value+.055)/1.055)**2.4),0);
const contrast=(a:number[],b:number[])=>{
 const values=[luminance(a),luminance(b)].sort((x,y)=>x-y);
 return (values[1]!+.05)/(values[0]!+.05);
};
it.each(PAGES)('keeps %s text readable throughout its dawn and glass reflection',page=>{
 const style=pageDawnStyle(page),sky=rgb(style['--hdr-sky']!),horizon=rgb(style['--hdr-horizon']!),ink=rgb(style['--hdr-ink']!);
 let minimum=Infinity;
 for(let step=0;step<=1000;step++){
  const color=sky.map((channel,index)=>channel+(horizon[index]!-channel)*step/1000);
  for(const overlay of [0,.05]){
   const adverse=color.map(channel=>style['--hdr-ink']==='#ffffff'?Math.min(1,channel*1.05*(1-overlay)+overlay):channel*(1-overlay));
   minimum=Math.min(minimum,contrast(adverse,ink));
  }
 }
 expect(minimum).toBeGreaterThanOrEqual(4.5);
 expect(contrast(rgb(style['--page-accent-light']!),rgb('#faf8f3'))).toBeGreaterThanOrEqual(4.5);
 expect(contrast(rgb(style['--page-accent-dark']!),rgb('#191919'))).toBeGreaterThanOrEqual(4.5);
});
it('uses the same dawn for header and page context',()=>{
 const style=pageDawnStyle('economy');
 expect(style['--page-sky']).toBe('#286c69');
 expect(style['--page-sky']).toBe(style['--hdr-sky']);
 expect(style['--page-horizon']).toBe(style['--hdr-horizon']);
});
it('retains the Control palette throughout its child routes',()=>{
 for(const page of ['recon','trust','issues','recs','journal'] as const)expect(pageDawnStyle(page)).toEqual(pageDawnStyle('quality'));
});
