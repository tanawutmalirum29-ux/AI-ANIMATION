/* On-device CPU / WASM inference worker.
 * No AI API: weights and runtime are downloaded locally. Status and error phases
 * are sent to the UI so Safari's worker crashes aren't reported as a mystery. */
let generator=null,loadedId='',pipelineTask='',currentPhase='bootstrap',currentRequest='';
const CPU_MODELS={
 'lamini-77m-cpu':{
  repo:'Xenova/LaMini-Flan-T5-77M',library:'v2',task:'text2text-generation'
 },
 'smollm2-135m-cpu':{
  repo:'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA',library:'v3',task:'text-generation'
 },
 'qwen2.5-0.5b-cpu':{
  repo:'onnx-community/Qwen2.5-0.5B-Instruct',library:'v3',task:'text-generation'
 }
};
const send=(type,requestId,payload={})=>
 self.postMessage({channel:'story-cpu',type,requestId,phase:currentPhase,...payload});
function progressInfo(p){
 const file=String(p?.file||'').split('/').pop();
 const value=Number(p?.progress);
 return {percent:Number.isFinite(value)?Math.max(0,Math.min(99,Math.round(value))):null,
  stage:[currentPhase,file,String(p?.status||'')].filter(Boolean).join(' · ').slice(0,290)};
}
function contentOf(output){
 const value=output?.[0]?.generated_text??output?.generated_text??'';
 if(typeof value==='string')return value;
 if(Array.isArray(value))return String(value[value.length-1]?.content||'');
 return String(value?.content||'');
}
const shortError=error=>String(error?.message||error||'unknown error').slice(0,800);
const phase=value=>{currentPhase=value; if(currentRequest)send('progress',currentRequest,{stage:value,percent:null})};
self.addEventListener('error',event=>{
 if(!currentRequest)return;
 send('fatal',currentRequest,{message:'Worker runtime error: '+String(event.message||'unknown')+
  (event.lineno?' (line '+event.lineno+')':'')});
});
self.addEventListener('unhandledrejection',event=>{
 if(!currentRequest)return;
 send('fatal',currentRequest,{message:'Unhandled WASM/ONNX rejection: '+shortError(event.reason)});
});
self.addEventListener('message',async event=>{
 const m=event.data;
 if(m?.channel!=='story-cpu'||!m.requestId)return;
 currentRequest=m.requestId;
 try{
  if(m.type==='init'){
   const info=CPU_MODELS[m.model];
   if(!info)throw Error('ไม่มีโมเดล CPU รุ่นนี้');
   if(!('WebAssembly' in self))throw Error('เบราว์เซอร์ไม่รองรับ WebAssembly');
   if(generator&&loadedId!==m.model){
    phase('คืนหน่วยความจำจากโมเดลเดิม');
    try{await generator.dispose?.()}catch(_){}
    generator=null;loadedId='';pipelineTask='';
   }
   if(!generator){
    phase('ดาวน์โหลดไลบรารี '+info.library);
    let pkg;
    if(info.library==='v2'){
     pkg=await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.15.1');
    }else{
     pkg=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
    }
    if(typeof pkg.pipeline!=='function')throw Error('CDN ไม่ส่ง pipeline()');
    if(pkg.env?.backends?.onnx?.wasm){
     pkg.env.backends.onnx.wasm.numThreads=1;
    }
    if(pkg.env)pkg.env.allowLocalModels=false;
    phase('เตรียมโมเดล '+info.repo);
    const options={
     progress_callback:p=>send('progress',m.requestId,progressInfo(p))
    };
    if(info.library==='v2')options.quantized=true;
    else{options.device='wasm';options.dtype='q4'}
    generator=await pkg.pipeline(info.task,info.repo,options);
    loadedId=m.model;pipelineTask=info.task;
   }
   phase('โมเดลอยู่ในหน่วยความจำ พร้อมทดสอบข้อความ');
   send('complete',m.requestId,{result:{ready:true}});
  }else if(m.type==='generate'){
   if(!generator)throw Error('ยังไม่ได้โหลดโมเดล');
   const messages=(m.messages||[]).filter(x=>x&&['system','user','assistant'].includes(x.role))
    .map(x=>({role:x.role,content:String(x.content||'').slice(0,7000)}));
   if(!messages.length)throw Error('ไม่มีคำสั่งให้โมเดลประมวลผล');
   const maxNew=Math.max(8,Math.min(pipelineTask==='text2text-generation'?180:650,Number(m.max_tokens)||150));
   phase('กำลังสร้างข้อความจริงบน CPU');
   let output;
   if(pipelineTask==='text2text-generation'){
    const prompt=messages.map(x=>x.role+': '+x.content).join('\n').slice(0,3000);
    output=await generator(prompt,{max_new_tokens:maxNew,do_sample:false});
   }else{
    output=await generator(messages,{max_new_tokens:maxNew,do_sample:false,return_full_text:false});
   }
   const content=contentOf(output);
   if(!content.trim())throw Error('โมเดลไม่สร้างข้อความ');
   const count=typeof generator.tokenizer?.encode==='function'?
    generator.tokenizer.encode(content).length:null;
   phase('CPU สร้างข้อความเสร็จ');
   send('complete',m.requestId,{result:{
    choices:[{message:{role:'assistant',content}}],
    usage:count===null?undefined:{completion_tokens:count}
   }});
  }else throw Error('คำสั่ง Worker ไม่ถูกต้อง');
 }catch(err){
  send('error',m.requestId,{message:shortError(err)});
 }finally{if(currentRequest===m.requestId)currentRequest=''}
});
send('boot',null,{phase:'worker script started'});
