// WCAG 2.x contrast for WebAble final tokens
const hex2rgb = h => { h=h.replace('#',''); return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255); };
const lin = c => c<=0.04045? c/12.92 : Math.pow((c+0.055)/1.055,2.4);
const L = h => { const [r,g,b]=hex2rgb(h).map(lin); return 0.2126*r+0.7152*g+0.0722*b; };
export const cr = (a,b) => { const la=L(a), lb=L(b); const [hi,lo]=la>lb?[la,lb]:[lb,la]; return (hi+0.05)/(lo+0.05); };
// alpha composite fg (hex, alpha) over bg hex
export const over = (fg,a,bg) => { const f=hex2rgb(fg), b=hex2rgb(bg); return '#'+f.map((c,i)=>Math.round((c*a+b[i]*(1-a))*255).toString(16).padStart(2,'0')).join('').toUpperCase(); };
