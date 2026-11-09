import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import esbuild from "esbuild";
const dir = mkdtempSync(join(tmpdir(), "ai-assist-subscription-"));
const require = createRequire(import.meta.url);
let count = 0;
function check(name, run) { run(); count++; console.log("PASS " + name); }
const obsidian = {
  name: "offline-stubs",
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "mock" }));
    build.onResolve({ filter: /chatgpt-auth$/ }, () => ({ path: "auth", namespace: "mock" }));
    build.onResolve({ filter: /^https$/ }, () => ({ path: "https", namespace: "mock" }));
    build.onLoad({ filter: /.*/, namespace: "mock" }, ({path}) => ({ loader: "js", contents: path === "obsidian"
      ? `export const moment={locale:()=>"en"}; export const requestUrl=()=>{throw new Error("Paid API path must never run");}; export class TFile {}`
      : path === "auth" ? `export const chatGPTAccessToken=async()=>{if(globalThis.__deny)throw new Error("Plan permission not granted");return "synthetic-token";};`
      : `import {EventEmitter} from "node:events";
         export function request(options, callback) {
           globalThis.__options=options;
           const req=new EventEmitter(); req.destroyed=false;
           req.destroy=()=>{req.destroyed=true;globalThis.__destroyed=true;};
           req.end=body=>{globalThis.__body=body;queueMicrotask(()=>{
             if(req.destroyed)return;const res=new EventEmitter();res.statusCode=globalThis.__status??200;
             res.headers=globalThis.__headers??{"content-type":globalThis.__mime??(options.path.endsWith("responses")?"text/event-stream":"application/json"),"x-request-id":"req_synthetic"};res.setEncoding=()=>{};
             callback(res); for(const part of globalThis.__chunks??[]){if(req.destroyed)return;res.emit("data",part);} if(!req.destroyed)res.emit("end");
           });};return req;
         }`
    }));
  }
};
async function load(entry, name) {
  const file=join(dir,name+".cjs");
  await esbuild.build({entryPoints:[entry],outfile:file,bundle:true,platform:"node",format:"cjs",plugins:[obsidian],logLevel:"error"});
  return require(file);
}
try {
 const { responsesBody, ResponseStream, CHATGPT_PLAN_URL }=await load("src/chatgpt-responses.ts","responses");
 const { defaultSettings, providerOf, switchProvider, configFor, activeConfig }=await load("src/types.ts","types");
 const { chat, listModels }=await load("src/api.ts","api");
 const {responseDiagnostic}=await load("src/chatgpt.ts","transport");
 const cfg={baseUrl:CHATGPT_PLAN_URL,apiKey:"do-not-send-api-key",model:"account-model",temperature:0.8,maxTokens:42};
 const {chatGPTEfforts,chatGPTEffort}=await load("src/chatgpt-options.ts","options");
 check("documented model effort capabilities",()=>{assert.deepEqual(chatGPTEfforts("gpt-6.1-sol"),["low","medium","high","xhigh","max"]);assert.equal(chatGPTEfforts("gpt-6.1-terra")[0],"none");assert.deepEqual(chatGPTEfforts("unknown-model"),[]);});
 check("invalid effort falls back to server default",()=>{assert.equal(chatGPTEffort("gpt-6.1-sol","none"),undefined);assert.equal(chatGPTEffort("gpt-6.1-sol","ultra"),undefined);assert.equal(chatGPTEffort("unknown-model","high"),undefined);});
 check("subscription sends validated effort only",()=>{assert.deepEqual(responsesBody({...cfg,model:"gpt-6.1-sol",reasoningEffort:"high"},[],{}).reasoning,{effort:"high"});assert.equal(responsesBody({...cfg,model:"gpt-6.1-sol",reasoningEffort:"none"},[],{}).reasoning,undefined);assert.equal(responsesBody(cfg,[],{}).reasoning,undefined);});
 check("effort follows subscription model across action and private configs",()=>{const s=defaultSettings();s.chatGPTEfforts={"gpt-6.1-sol":"high"};s.profiles.chatgpt={apiKey:"",baseUrl:CHATGPT_PLAN_URL,model:"gpt-6.1-sol"};assert.equal(configFor(s,"chatgpt").reasoningEffort,"high");s.privateChat=true;s.privateProvider="chatgpt";assert.equal(activeConfig(s).reasoningEffort,"high");});
 const opts={stream:false,tools:[{type:"function",function:{name:"read_note",description:"Read a note",parameters:{type:"object",properties:{}}}}]};
 const body=responsesBody(cfg,[{role:"system",content:"instructions"},{role:"user",content:[{type:"text",text:"look"},{type:"image_url",image_url:{url:"data:image/png;base64,AA=="}}]}],opts);
 check("subscription requires stream and no stored state",()=>{assert.equal(body.stream,true);assert.equal(body.store,false);for(const key of ["temperature","max_tokens","max_output_tokens","previous_response_id"])assert.equal(key in body,false);});
 check("system becomes developer and images are preserved",()=>{assert.equal(body.input[0].role,"developer");assert.equal(body.input[1].content[1].type,"input_image");});
 check("function tools are namespaced",()=>{assert.equal(body.tools[0].type,"namespace");assert.equal(body.tools[0].tools[0].name,"read_note");});
 check("tool calls and outputs preserve call identity",()=>{
  const r=responsesBody(cfg,[{role:"assistant",content:"",tool_calls:[{id:"c",type:"function",function:{name:"read_note",arguments:"{}"}}]},{role:"tool",tool_call_id:"c",content:"note"}],opts);
  assert.equal(r.input[0].call_id,"c");assert.equal(r.input[1].type,"function_call_output");assert.equal(r.input[1].output,"note");
 });
 check("response items replay without duplicate calls",()=>{
  const items=[{type:"reasoning",encrypted_content:"synthetic"},{type:"function_call",call_id:"x",name:"read_note",arguments:"{}"}];
  const r=responsesBody(cfg,[{role:"assistant",content:"",responseItems:items,tool_calls:[{id:"x",type:"function",function:{name:"read_note",arguments:"{}"}}]}],opts);
  assert.deepEqual(r.input,items);
 });
 const done={type:"response.completed",response:{status:"completed",output:[{type:"message",role:"assistant",content:[{type:"output_text",text:"Hello"}]}],usage:{input_tokens:4,output_tokens:2,input_tokens_details:{cached_tokens:1}}}};
 const event=e=>'data: '+JSON.stringify(e)+'\r\n\r\n';
 const wire=event({type:"response.output_text.delta",delta:"Hello"})+event(done);
 check("SSE all two-part split boundaries and CRLF",()=>{for(let at=0;at<=wire.length;at++){const p=new ResponseStream();p.feed(wire.slice(0,at));p.feed(wire.slice(at));assert.equal(p.finish().text,"Hello");}});
 check("SSE bytewise chunks and final line without newline",()=>{const p=new ResponseStream();for(const c of wire.trimEnd())p.feed(c);assert.equal(p.finish().usage.cached,1);});
 check("SSE multiline data and comments",()=>{const p=new ResponseStream();p.feed(': comment\n'+'data: {"type":"response.completed",\n'+'data: "response":{"status":"completed","output":[]}}\n\n');assert.equal(p.finish().text,"");});
 check("DONE without response.completed fails",()=>{const p=new ResponseStream();p.feed('data: [DONE]\n\n');assert.throws(()=>p.finish(),/before response.completed/);});
 check("failed terminal after text fails",()=>{const p=new ResponseStream();p.feed(event({type:"response.output_text.delta",delta:"partial"}));assert.throws(()=>p.feed(event({type:"response.failed",response:{error:{code:"subscription_sharing_usage_limit_exceeded"}}})),/No paid API fallback/);});
 check("incomplete terminal never applies tools",()=>{const p=new ResponseStream();assert.throws(()=>p.feed(event({type:"response.incomplete"})),/incomplete/);});
 check("malformed terminal and JSON reject",()=>{assert.throws(()=>new ResponseStream().feed('data: nope\n\n'),/Malformed/);assert.throws(()=>new ResponseStream().feed(event({type:"response.completed",response:{status:"failed",output:[]}})),/did not confirm/);});
 check("completed tool call uses final arguments",()=>{const p=new ResponseStream();p.feed(event({type:"response.completed",response:{status:"completed",output:[{type:"function_call",namespace:"obsidian",call_id:"c",name:"read_note",arguments:'{"path":"n"}'}]}}));assert.deepEqual(p.finish().toolCalls,[{id:"c",name:"read_note",arguments:'{"path":"n"}'}]);});
 check("unexpected tool namespace rejected",()=>{const p=new ResponseStream();assert.throws(()=>p.feed(event({type:"response.completed",response:{status:"completed",output:[{type:"function_call",namespace:"shell",call_id:"c",name:"run",arguments:"{}"}]}})),/namespace/);});
 check("provider switching preserves old key and empties subscription key",()=>{const s=defaultSettings();s.apiKey="old-key";switchProvider(s,"chatgpt");assert.equal(providerOf(s),"chatgpt");assert.equal(s.apiKey,"");assert.equal(s.profiles.deepseek.apiKey,"old-key");switchProvider(s,"deepseek");assert.equal(s.apiKey,"old-key");});
 check("missing subscription model never falls back to paid private provider",()=>{const s=defaultSettings();s.privateChat=true;s.privateProvider="chatgpt";assert.equal(configFor(s,"chatgpt").baseUrl,CHATGPT_PLAN_URL);assert.equal(activeConfig(s).baseUrl,CHATGPT_PLAN_URL);});
 globalThis.__chunks=[wire];globalThis.__status=200;
 const result=await chat(cfg,[{role:"user",content:"hi"}],{stream:false});
 check("subscription routing ignores stored API key and enforces fixed endpoint",()=>{assert.equal(result.text,"Hello");assert.equal(globalThis.__options.hostname,"api.openai.com");assert.equal(globalThis.__options.path,"/v1/responses");assert.equal(globalThis.__options.headers.Authorization,"Bearer synthetic-token");assert.equal(JSON.parse(globalThis.__body).stream,true);});
 globalThis.__status=429;globalThis.__chunks=[JSON.stringify({error:{code:"subscription_sharing_usage_limit_exceeded"}})];
 await assert.rejects(chat(cfg,[],{stream:true}),/No paid API fallback/);count++;console.log("PASS limits never fall back");
 globalThis.__status=302;globalThis.__chunks=['redirect'];
 await assert.rejects(chat(cfg,[],{stream:true}),/HTTP 302/);count++;console.log("PASS redirects are not followed");
 globalThis.__status=200;globalThis.__chunks=[wire];globalThis.__destroyed=false;
 const abort=new AbortController();
 await assert.rejects(chat(cfg,[],{stream:true,signal:abort.signal,onDelta:()=>abort.abort()}),e=>e.aborted===true);
 check("cancellation destroys request",()=>assert.equal(globalThis.__destroyed,true));
 globalThis.__deny=true;globalThis.__options=null;
 await assert.rejects(chat(cfg,[],{stream:true}),/permission not granted/);
 check("denied permission makes no network call",()=>assert.equal(globalThis.__options,null));globalThis.__deny=false;
 globalThis.__chunks=[JSON.stringify({models:[{visibility:"list",slug:"one"},{visibility:"hidden",slug:"no"},{visibility:"list",slug:"two"}]})];
 const models=await listModels(cfg);check("account models retain server order and filter hidden",()=>assert.deepEqual(models,["one","two"]));
 globalThis.__headers={"Content-Type":"text/event-stream"};globalThis.__chunks=['event: response.completed\n'+event(done)];
 assert.equal((await chat(cfg,[],{stream:false})).text,"Hello");count++;console.log("PASS canonical header casing and event-first SSE");
 globalThis.__headers={};globalThis.__chunks=[': comment\n'+wire];let delta="";
 assert.equal((await chat(cfg,[],{stream:false,onDelta:t=>{delta+=t;}})).text,"Hello");assert.equal(delta,"Hello");count++;console.log("PASS headerless validated SSE forwards callbacks once");
 globalThis.__chunks=['event: response.created\ndata: {"type":"response.created"}\n\n'];
 await assert.rejects(chat(cfg,[],{stream:false}),/unexpected response format/);count++;
 globalThis.__chunks=['<html>not a response</html>'];
 await assert.rejects(chat(cfg,[],{stream:false}),/unexpected response format/);count++;
 globalThis.__headers={"content-type":"text/html"};globalThis.__chunks=[wire];
 await assert.rejects(chat(cfg,[],{stream:false}),/unexpected response format/);count++;
 delete globalThis.__headers;
 globalThis.__mime="application/json";globalThis.__chunks=[JSON.stringify({error:{code:"invalid_request",param:"stream",message:"DO_NOT_EXPOSE_SECRET"}})];
 await assert.rejects(chat(cfg,[],{stream:true}),e=>/HTTP 200; format application\/json; request req_synthetic; code invalid_request; parameter stream; body JSON error/.test(e.message)&&!e.message.includes("DO_NOT_EXPOSE_SECRET"));count++;console.log("PASS unexpected format diagnostics are allowlisted");
 check("diagnostic never echoes body or invalid metadata",()=>{const d=responseDiagnostic(200,"secret token","bad secret",'<html>SECRET</html>');assert.equal(d.includes("SECRET"),false);assert.equal(d.includes("secret token"),false);assert.match(d,/body HTML\/XML/);});
 delete globalThis.__mime;
 console.log(`${count} subscription checks passed. No real network, credentials, OAuth or inference used.`);
} finally { rmSync(dir,{recursive:true,force:true}); }