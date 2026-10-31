/* Browser-local text generation without WebGPU, via Transformers.js + WASM.
 * This worker owns its ONNX runtime. Terminating it releases its memory.
 * No paid APIs or remote inference; model assets are downloaded from Hugging Face.
 */
let generator=null,loadedId='';
const CPU_MODELS={
 'smollm2-135m-cpu':{repo:'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA'},
 'qwen2.5-0.5b-cpu':{repo:'onnx-community/Qwen2.5-0.5B-Instruct'}
};
function send(type,requestId,payload={}){self.postMessage({channel:'story-cpu',type,requestId,...payload})}
function describeProgress(p){
 const status=String(p?.status||'loading');
 const file=String(p?.file||'').split('/').pop();
 const value=Number(p?.progress);
 return {percent:Number.isFinite(value)?Math.min(98,Math.max(0,Math.round(value))):null,
  stage:(file?file+' · ':'')+status};
}
function cleanText(out){
 const value=out?.[0]?.generated_text??out?.generated_text??'';
 if(typeof value==='string')return value;
 if(Array.isArray(value))return String(value[value.length-1]?.content||'');
 return String(value?.content||'');
}
self.addEventListener('message',async event=>{
 const m=event.data;
 if(m?.channel!=='story-cpu'||!m.requestId)return;
 try{
  if(m.type==='init'){
   const info=CPU_MODELS[m.model];
   if(!info)throw Error('โมเดล CPU ไม่อยู่ในรายการที่รองรับ');
   if(generator&&loadedId!==m.model){try{await generator.dispose?.()}catch(_){}generator=null;loadedId=''}
   if(!generator){
    send('progress',m.requestId,{percent:null,stage:'กำลังโหลด Transformers.js (CPU/WASM)'});
    const {pipeline,env}=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
    // Prevent excessive CPU threads on low-memory iPads.
    if(env?.backends?.onnx?.wasm)env.backends.onnx.wasm.numThreads=1;
    generator=await pipeline('text-generation',info.repo,{
     device:'wasm',dtype:'q4',
     progress_callback:p=>send('progress',m.requestId,describeProgress(p))
    });
    loadedId=m.model;
   }
   send('complete',m.requestId,{result:{ready:true}});
  }else if(m.type==='generate'){
   if(!generator)throw Error('ยังไม่โหลดโมเดล CPU');
   const messages=(m.messages||[]).filter(x=>x&&['system','user','assistant'].includes(x.role))
    .map(x=>({role:x.role,content:String(x.content||'').slice(0,9000)}));
   if(!messages.length)throw Error('ไม่มีข้อความให้ AI วิเคราะห์');
   const maxNew=Math.max(8,Math.min(650,Number(m.max_tokens)||220));
   const output=await generator(messages,{
    max_new_tokens:maxNew,do_sample:false,return_full_text:false
   });
   const content=cleanText(output);
   const count=typeof generator.tokenizer?.encode==='function'?
    generator.tokenizer.encode(content).length:null;
   send('complete',m.requestId,{result:{
    choices:[{message:{role:'assistant',content}}],
    usage:count===null?undefined:{completion_tokens:count}
   }});
  }else throw Error('คำสั่ง CPU ไม่ถูกต้อง');
 }catch(err){send('error',m.requestId,{message:String(err?.message||err).slice(0,800)})}
});
