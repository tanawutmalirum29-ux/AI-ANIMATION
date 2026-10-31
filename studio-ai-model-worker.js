/* One isolated WebLLM runtime per loaded model. Terminating this worker releases its
 * WASM tokenizer and GPU context without destroying the Story Studio page. */
import { WebWorkerMLCEngineHandler } from 'https://esm.sh/@mlc-ai/web-llm@0.2.80';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = event => handler.onmessage(event);
