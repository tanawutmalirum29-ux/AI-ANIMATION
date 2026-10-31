const assert=require('node:assert/strict'),fs=require('node:fs');
const core=require('../studio-asset-core.js');
const catalog=JSON.parse(fs.readFileSync('assets/library.json','utf8'));
assert.equal(catalog.version,1);
assert.ok(catalog.assets.length>=4);
for(const a of catalog.assets){
 const valid=core.asset(a),svg=core.svg(valid);
 assert.ok(svg.startsWith('<svg')&&svg.includes('</svg>'));
 assert.ok(!/script|onload|foreignObject|href=/i.test(svg));
 assert.ok(core.sceneMarkup({customAssets:[{asset:a,x:50,y:72,scale:1,front:true}]},'front',160).includes('<g transform='));
}
const hostile={name:'x" onload="alert(1)',category:'prop',shapes:[
 {type:'rect',x:'0" onclick="evil()',y:20,w:30,h:40,fill:'url(javascript:alert(1))',stroke:'#001122',strokeWidth:2},
 {type:'polygon',points:[[0,0],[50,0],[50,50]],fill:'#112233'}
]};
const svg=core.svg(hostile);
assert.ok(!/javascript:|onclick|onload|<script|url\(/i.test(svg));
assert.ok(svg.includes('fill="#b7c4cf"'));
assert.throws(()=>core.asset({name:'hi',shapes:[{type:'path',d:'M 0 0'}]}),/รูปทรง/);
assert.throws(()=>core.asset({name:'hi',shapes:[]}),/1–60/);
console.log('PASS: Art Vault catalog, bounded SVG, injection defense and scene rendering');
