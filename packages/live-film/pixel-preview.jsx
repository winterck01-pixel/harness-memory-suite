import React,{useState,useEffect} from 'react';
const pixelCss=`.dsh-pixel-dolphin{animation:dsh-dolphin-swim 2.6s ease-in-out infinite}.dsh-dolphin-pixel{animation:dsh-pixel-light 1.8s ease-in-out infinite}.dsh-pixel-wave{animation:dsh-wave-flow 2s linear infinite}
@keyframes dsh-dolphin-swim{0%,100%{transform:translateY(4px) rotate(-3deg)}50%{transform:translateY(-7px) rotate(3deg)}}
@keyframes dsh-pixel-light{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes dsh-wave-flow{0%{transform:translateX(-12px);opacity:.25}50%{opacity:.8}100%{transform:translateX(12px);opacity:.25}}
@media(prefers-reduced-motion:reduce){.dsh-pixel-dolphin,.dsh-dolphin-pixel,.dsh-pixel-wave{animation:none}}`;
const dolphinPixels=[
'....................',
'..........##........',
'.........###........',
'......########......',
'....############....',
'...##############...',
'..############.###..',
'.##################.',
'...###############..',
'.....############...',
'.......########.....',
'.......###..###.....',
'......###...##......',
'..##.###............',
'.######.............',
'..####..............',
'..##.##.............',
'....................'];
export function PixelPreview({createdAt}){const [now,setNow]=useState(Date.now());useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[]);const seconds=Math.max(0,Math.floor((now-(createdAt||now))/1000));const clock=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');return <div style={{padding:20,textAlign:'center',minHeight:220,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}><style>{pixelCss}</style><div style={{fontSize:13,fontVariantNumeric:'tabular-nums',marginBottom:14}}>生成用时 <time aria-label='图片生成用时'>{clock}</time></div><svg role='img' aria-label='正在游动的像素海豚' width='180' height='156' viewBox='0 0 160 144' style={{overflow:'visible'}}><g className='dsh-pixel-dolphin' style={{transformOrigin:'80px 64px'}}>{dolphinPixels.flatMap((row,y)=>Array.from(row,(pixel,x)=>pixel==='#'?<rect key={x+':'+y} className='dsh-dolphin-pixel' x={x*7+10} y={y*6} width='5' height='5' fill={y<6?'#78adff':'#4d7cfa'} style={{animationDelay:((x+y)*.065)+'s'}}/>:null))}<rect x='108' y='37' width='4' height='4' fill='#fff'/></g><g className='dsh-pixel-wave' fill='#5d8dff'>{[0,1,2,3,4,5,6,7,8,9].map(x=><rect key={x} x={x*13+18} y={124+(x%2)*4} width='7' height='3'/>)}</g></svg><div style={{marginTop:12}}>正在生成图片…</div><small style={{marginTop:8,opacity:.65}}>结果将自动显示在这里</small></div>}
