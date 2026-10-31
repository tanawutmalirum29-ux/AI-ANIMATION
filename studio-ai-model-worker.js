/* Dedicated WebLLM model runtime; report bootstrap failures to the page.
 * A Worker error event hides useful Safari CDN / WebGPU diagnostics. */
(async()=>{
 try {
  if(!self.navigator?.gpu)throw Error('WebGPU ไม่พร้อมใช้งานภายใน Web Worker ของเบราว์เซอร์นี้');
  const mod=await import('https://esm.run/@mlc-ai/web-llm@0.2.80');
  if(typeof mod.WebWorkerMLCEngineHandler!=='function')throw Error('CDN ไม่ส่ง WebWorkerMLCEngineHandler');
  const handler=new mod.WebWorkerMLCEngineHandler();
  self.onmessage=event=>handler.onmessage(event);
  self.postMessage({type:'story-worker-ready'});
 }catch(err){
  self.postMessage({type:'story-worker-error',message:String(err?.message||err).slice(0,500)});
 }
})();
