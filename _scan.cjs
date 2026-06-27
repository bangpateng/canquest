const { Resvg } = require('@resvg/resvg-js');
const { PNG } = require('pngjs');
const { readFileSync } = require('fs');
const src = readFileSync('apps/web/public/canquest-logo.svg','utf8');
const inner = src.replace(/<svg[^>]*>/,'').replace('</svg>','');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180">${inner}</svg>`;
const pngBuf = new Resvg(svg,{background:'rgba(0,0,0,0)'}).render().asPng();
const png = PNG.sync.read(pngBuf);
const {width,height,data}=png;
let minX=width,minY=height,maxX=0,maxY=0;
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4;
  if(data[i+3]>30){ if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
}
const cy=(minY+maxY)/2;
console.log(`INK bbox: x[${minX},${maxX}] y[${minY},${maxY}] w=${maxX-minX} h=${maxY-minY}`);
console.log(`ink vertical center y=${cy} | canvas center y=${height/2} | offset ${cy>height/2?'down':'up'} ${Math.abs(cy-height/2)}px`);
const pad=8;
const vbX=minX-pad, vbY=minY-pad, vbW=(maxX-minX)+2*pad, vbH=(maxY-minY)+2*pad;
console.log(`CENTERED viewBox = "${vbX} ${vbY} ${vbW} ${vbH}"  (width=${vbW} height=${vbH} aspect=${(vbW/vbH).toFixed(3)})`);
