// Offline security checks: synthetic JWTs and keys only. No auth or network.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import esbuild from "esbuild";

const directory = mkdtempSync(join(tmpdir(), "ai-assist-auth-test-"));
try {
  const outfile = join(directory, "auth.cjs");
  await esbuild.build({
    entryPoints: ["src/chatgpt-auth.ts"], bundle: true, platform: "node",
    format: "cjs", outfile, external: ["electron"], logLevel: "error",
  });
  const { verifyChatGPTIdentity, chatGPTStatus } = createRequire(import.meta.url)(outfile);
  const now = 1_800_000_000_000;
  const client = "oaiapp_synthetic";
  const base = { iss: "https://auth.openai.com", aud: client, sub: "test-user",
    email: "synthetic@example.invalid", nonce: "test-nonce", iat: now / 1000 - 5, exp: now / 1000 + 60 };
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = { ...rsa.publicKey.export({ format: "jwk" }), kid: "rsa", use: "sig", alg: "RS256" };
  const ecJwk = { ...ec.publicKey.export({ format: "jwk" }), kid: "ec", use: "sig", alg: "ES256" };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  function jwt(claims = base, header = { alg: "RS256", kid: "rsa" }, pair = rsa) {
    const input = encode(header) + "." + encode(claims);
    const key = header.alg === "ES256" ? { key: pair.privateKey, dsaEncoding: "ieee-p1363" } : pair.privateKey;
    return input + "." + sign("sha256", Buffer.from(input), key).toString("base64url");
  }
  function verify(token, keys = [jwk], nonce = "test-nonce", subject) {
    return verifyChatGPTIdentity(token, keys, client, nonce, subject, now);
  }
  let checks = 0;
  function rejects(fn) { assert.throws(fn, /verification failed/); checks++; }
  assert.deepEqual(verify(jwt()), { subject: "test-user", email: "synthetic@example.invalid" }); checks++;
  assert.equal(verify(jwt(base, {alg:"ES256",kid:"ec"}, ec), [ecJwk]).subject, "test-user"); checks++;
  rejects(() => verify(jwt({...base, iss: "https://attacker.invalid"})));
  rejects(() => verify(jwt({...base, aud: "wrong-client"})));
  rejects(() => verify(jwt({...base, aud: [client, "other"]})));
  assert.equal(verify(jwt({...base, aud: [client, "other"], azp: client})).subject, "test-user"); checks++;
  rejects(() => verify(jwt({...base, azp: "other"})));
  rejects(() => verify(jwt({...base, exp: now / 1000})));
  rejects(() => verify(jwt({...base, exp: "99999999999"})));
  rejects(() => verify(jwt({...base, nbf: now / 1000 + 61})));
  rejects(() => verify(jwt({...base, iat: now / 1000 + 61})));
  rejects(() => verify(jwt({...base, nonce: "wrong-nonce"})));
  rejects(() => verify(jwt({...base, sub: ""})));
  rejects(() => verify(jwt(), [jwk], "test-nonce", "other-user"));
  assert.equal(verify(jwt(), [jwk], "test-nonce", "test-user").subject, "test-user"); checks++;
  const token = jwt();
  const parts = token.split(".");
  parts[1] = encode({...base, sub: "attacker"});
  rejects(() => verify(parts.join(".")));
  rejects(() => verify(jwt(base, {alg: "none", kid: "rsa"})));
  rejects(() => verify(jwt(base, {alg: "HS256", kid: "rsa"})));
  rejects(() => verify(jwt(base, {alg: "RS256", kid: "missing"})));
  rejects(() => verify(jwt(base, {alg: "RS256", kid: "rsa", crit: ["unknown"]})));
  rejects(() => verify(token, [jwk, jwk]));
  rejects(() => verify(token, [{...jwk, use: "enc"}]));
  rejects(() => verify(token, [{...jwk, alg: "HS256"}]));
  rejects(() => verify(token, [{...jwk, key_ops: ["encrypt"]}]));
  rejects(() => verify("not.a.token"));
  rejects(() => verify("a".repeat(100_001)));
  assert.equal(verifyChatGPTIdentity(jwt({...base, nonce: undefined}), [jwk], client, undefined, undefined, now).subject, "test-user"); checks++;
  const unavailable = await chatGPTStatus();
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.connected, false);
  assert.equal(unavailable.planUsageEnabled, false);
  assert.deepEqual(unavailable.accounts, []);
  assert.match(unavailable.error, /Obsidian Desktop/); checks++;

  // Exercise the real storage/refresh code in a VM with synthetic encrypted
  // records and an in-memory HTTPS server. Never touches Electron/user storage.
  const { readFileSync, writeFileSync, mkdirSync, existsSync } = await import("node:fs");
  const { runInNewContext } = await import("node:vm");
  const { EventEmitter } = await import("node:events");
  const nativeRequire = createRequire(import.meta.url);
  const testRoot = join(directory, "synthetic-electron-data");
  const storage = join(testRoot, "ru-ai-assist-chatgpt");
  mkdirSync(storage, {recursive:true});
  const file = join(storage, "accounts.enc");
  const runtimeNow = Date.now();
  const refreshedId = jwt({...base, nonce: undefined, exp: runtimeNow / 1000 + 3600, iat: runtimeNow / 1000 - 1});
  const initial = {
    version:1,hostId:"urn:uuid:synthetic",active:client,registrations:[{
      clientId:client,subject:"test-user",email:"synthetic@example.invalid",
      tokens:{access:"SYNTHETIC_OLD_ACCESS",refresh:"SYNTHETIC_OLD_REFRESH",id:refreshedId,
        scopes:["chatgpt.tokens.use.direct","resource.invoke"],expiresAt:runtimeNow-1},
    }],
  };
  const persist = value => writeFileSync(file, "TEST-ONLY:" + JSON.stringify(value));
  const inspect = () => JSON.parse(readFileSync(file,"utf8").replace(/^TEST-ONLY:/,""));
  let failKeys = true;
  let refreshes = 0;
  let revocations = [];
  let refreshedIdentity = refreshedId;
  let tokenFailure = false;

  let authExchanges=0;
  let authorizationUrl;
  let callbackServer;
  let badNonce=false;
  let authScope="openid profile email offline_access chatgpt.tokens.use.direct resource.invoke";
  let holdExchange=false;
  let releaseExchange;
  const fakeHttp={
    createServer() {
      const server=new EventEmitter();
      server.closed=false;
      server.listen=(port,host,ready)=>{assert.equal(host,"127.0.0.1");queueMicrotask(ready);};
      server.address=()=>({port:14557,address:"127.0.0.1"});
      server.close=()=>{server.closed=true;};
      callbackServer=server;
      return server;
    },
  };

  const requests = [];
  const fakeHttps = {
    request(url, opts, callback) {
      const req = new EventEmitter();
      let body = "";
      req.setTimeout = () => req;
      req.write = part => {body += part;};
      req.destroy = () => {};
      req.end = () => {
        queueMicrotask(() => {
          const endpoint = url.toString();
          requests.push(endpoint);
          const res = new EventEmitter();
          let payload;
          res.statusCode = 200;
          if (endpoint.endsWith("/.well-known/openid-configuration")) {
            payload = {issuer:"https://auth.openai.com",jwks_uri:"https://auth.openai.com/test-jwks",
              revocation_endpoint:"https://auth.openai.com/test-revoke"};
          } else if (endpoint.endsWith("/test-jwks")) {
            if (failKeys) {res.statusCode=503; payload={error:"temporarily_unavailable"};}
            else payload={keys:[jwk]};
          } else if (endpoint.endsWith("/api/accounts/oauth/token")) {

            const fields = new URLSearchParams(body);
            if (fields.get("grant_type")==="authorization_code") {
              authExchanges++;
              assert.ok(authorizationUrl);
              assert.equal(fields.get("client_id"),client);
              assert.equal(fields.get("code"),"SYNTHETIC_CODE");
              assert.equal(fields.get("resource"),"https://api.openai.com/v1");
              assert.equal(fields.get("redirect_uri"),authorizationUrl.searchParams.get("redirect_uri"));
              const {createHash}=nativeRequire("node:crypto");
              assert.equal(createHash("sha256").update(fields.get("code_verifier")).digest("base64url"),
                authorizationUrl.searchParams.get("code_challenge"));
              payload={access_token:"SYNTHETIC_AUTH_ACCESS",refresh_token:"SYNTHETIC_AUTH_REFRESH",
                id_token:jwt({...base,nonce:badNonce?"bad":authorizationUrl.searchParams.get("nonce"),
                  exp:Date.now()/1000+3600,iat:Date.now()/1000-1}),
                token_type:"Bearer",expires_in:3600,scope:authScope};
            } else {
              refreshes++;
              assert.equal(fields.get("refresh_token"),"SYNTHETIC_OLD_REFRESH");
              assert.equal(fields.get("client_id"),client);
              assert.equal(fields.get("grant_type"),"refresh_token");
              assert.equal(fields.has("scope"),false);
              if (tokenFailure) {res.statusCode=400;payload={error:"invalid_grant"};}
              else payload={access_token:"SYNTHETIC_NEW_ACCESS",refresh_token:"SYNTHETIC_NEW_REFRESH",
                id_token:refreshedIdentity,token_type:"Bearer",expires_in:3600,
                scope:"chatgpt.tokens.use.direct resource.invoke"};
            }

          } else if (endpoint.endsWith("/test-revoke")) {
            revocations.push(new URLSearchParams(body).get("token"));
            payload={};
          } else throw new Error("Unexpected mock network endpoint");
          const deliver=()=>{ callback(res); res.emit("data",Buffer.from(JSON.stringify(payload))); res.emit("end"); };
          if(holdExchange && new URLSearchParams(body).get("grant_type")==="authorization_code") releaseExchange=deliver;
          else deliver();
        });
      };
      return req;
    },
  };
  const fakeElectron = {
    safeStorage:{
      isEncryptionAvailable:()=>true,
      encryptString:value=>Buffer.from("TEST-ONLY:"+value),
      decryptString:value=>value.toString("utf8").replace(/^TEST-ONLY:/,""),
    },
    app:{getPath:()=>testRoot},
    shell:{openExternal:async url=>{authorizationUrl=new URL(url);}},
  };
  function makeAuthRuntime() {
    const module = {exports:{}};
    runInNewContext(readFileSync(outfile,"utf8"), {
      module,exports:module.exports,Buffer,URL,URLSearchParams,setTimeout,clearTimeout,
      process:{versions:{electron:"TEST"},pid:process.pid,kill:process.kill.bind(process)},
      require:name=>name==="electron"?fakeElectron:name==="https"?fakeHttps:name==="http"?fakeHttp:nativeRequire(name),
    });
    return module.exports;
  }
  persist(initial);
  let runtime = makeAuthRuntime();
  await assert.rejects(runtime.chatGPTAccessToken(),/verification is still pending/); checks++;
  assert.equal(refreshes,1);
  assert.equal(inspect().registrations[0].tokens.refresh,"SYNTHETIC_OLD_REFRESH");
  assert.equal(inspect().registrations[0].pendingRefresh.tokens.refresh,"SYNTHETIC_NEW_REFRESH");
  assert.equal((await runtime.chatGPTStatus()).planUsageEnabled,false);
  assert.equal((await runtime.chatGPTStatus()).verificationPending,true); checks++;
  // Simulate restart: pending ciphertext must be sufficient, without replay.
  failKeys=false;
  runtime=makeAuthRuntime();
  assert.equal(await runtime.chatGPTAccessToken(),"SYNTHETIC_NEW_ACCESS");
  assert.equal(refreshes,1);
  assert.equal(inspect().registrations[0].pendingRefresh,undefined);
  assert.equal(inspect().registrations[0].tokens.refresh,"SYNTHETIC_NEW_REFRESH"); checks++;
  // A validly signed identity for a different user must remain quarantined.
  persist(initial);
  refreshedIdentity=jwt({...base,sub:"other-user",nonce:undefined,exp:Date.now()/1000+3600});
  runtime=makeAuthRuntime();
  await assert.rejects(runtime.chatGPTAccessToken(),/verification is still pending/);
  const rotations=refreshes;
  await assert.rejects(runtime.chatGPTAccessToken(),/verification is still pending/);
  assert.equal(refreshes,rotations);
  assert.equal(inspect().registrations[0].subject,"test-user");
  assert.equal((await runtime.chatGPTStatus()).planUsageEnabled,false); checks++;
  // Sign out revokes the pending (current) session, not the obsolete token.
  const logout = await runtime.disconnectChatGPT();
  assert.equal(logout.revoked,true);
  assert.equal(revocations.at(-1),"SYNTHETIC_NEW_REFRESH");
  assert.equal(inspect().registrations[0].tokens,undefined);
  assert.equal(inspect().registrations[0].pendingRefresh,undefined);
  assert.equal(inspect().registrations[0].clientId,client);
  assert.equal(inspect().hostId,"urn:uuid:synthetic"); checks++;
  // Terminal refresh rejection clears tokens, preserving registration.
  persist(initial); tokenFailure=true; runtime=makeAuthRuntime();
  await assert.rejects(runtime.chatGPTAccessToken(),/expired or was revoked/);
  assert.equal(inspect().registrations[0].tokens,undefined);
  assert.equal(inspect().registrations[0].clientId,client); checks++;
  // Identity alone, direct-only and invoke-only grants cannot start inference.
  for (const scopes of [[], ["openid","profile","email"], ["chatgpt.tokens.use.direct"], ["resource.invoke"]]) {
    const limited=JSON.parse(JSON.stringify(initial));
    limited.registrations[0].tokens.scopes=scopes;
    limited.registrations[0].tokens.expiresAt=Date.now()+3600_000;
    persist(limited); runtime=makeAuthRuntime();
    const before=requests.length;
    assert.equal((await runtime.chatGPTStatus()).planUsageEnabled,false);
    await assert.rejects(runtime.chatGPTAccessToken(),/plan usage was not authorized/);
    assert.equal(requests.length,before);
    checks++;
  }
  assert.ok(requests.every(url=>url.startsWith("https://auth.openai.com/")));
  assert.equal(existsSync(join(storage,"session.lock")),false); checks++;


  // Fully mocked OAuth lifecycle: no listening sockets or real browser.
  async function beginLogin() {
    persist({version:1,hostId:"urn:uuid:synthetic",registrations:[]});
    authorizationUrl=undefined; badNonce=false; holdExchange=false; releaseExchange=undefined;
    authScope="openid profile email offline_access chatgpt.tokens.use.direct resource.invoke";
    failKeys=false; tokenFailure=false; runtime=makeAuthRuntime();
    const promise=runtime.connectChatGPT();
    promise.catch(()=>{});
    for(let i=0;i<20&&!authorizationUrl;i++) await new Promise(resolve=>setTimeout(resolve,0));
    assert.ok(authorizationUrl,"Synthetic browser should receive authorization URL");
    assert.equal(authorizationUrl.origin,"https://auth.openai.com");
    assert.equal(authorizationUrl.searchParams.get("client_id"),"dynamic_agent_client");
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"),"S256");
    assert.equal(authorizationUrl.searchParams.get("agent_name_hint"),"RU AI Assist");
    return {promise,server:callbackServer,url:authorizationUrl};
  }
  function callback(attempt, overrides={}) {
    const fields={state:attempt.url.searchParams.get("state"),code:"SYNTHETIC_CODE",client_id:client,...overrides};
    const query=new URLSearchParams();
    for(const [key,value] of Object.entries(fields)) if(value!==undefined) query.set(key,value);
    const response={status:0,body:"",writeHead(code){this.status=code;},end(body){this.body=body;}};
    attempt.server.emit("request",{method:"GET",url:"/auth/callback?"+query,headers:{host:"127.0.0.1:14557"}},response);
    return response;
  }
  let attempt=await beginLogin();
  await assert.rejects(runtime.connectChatGPT(),/already in progress/);
  runtime.cancelChatGPTLogin();
  await assert.rejects(attempt.promise,/cancelled locally.*remote revocation was not confirmed/);
  const beforeLate=requests.length;
  assert.equal(callback(attempt).status,410);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(requests.length,beforeLate);
  assert.equal((await runtime.chatGPTStatus()).connected,false);
  assert.equal(attempt.server.closed,true); checks++;

  attempt=await beginLogin();
  const beforeState=authExchanges;
  assert.equal(callback(attempt,{state:"wrong-state"}).status,400);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(authExchanges,beforeState);
  assert.equal(callback(attempt).status,200);
  assert.equal(callback(attempt).status,409); // consumed before async exchange ends
  const signedIn=await attempt.promise;
  assert.equal(signedIn.connected,true);
  assert.equal(signedIn.planUsageEnabled,true);
  assert.equal(authExchanges,beforeState+1);
  assert.equal(inspect().registrations[0].subject,"test-user"); checks++;

  attempt=await beginLogin(); badNonce=true;
  callback(attempt);
  await assert.rejects(attempt.promise,/identity verification failed/);
  assert.equal((await runtime.chatGPTStatus()).connected,false);
  assert.equal(inspect().registrations[0].tokens,undefined); checks++;

  attempt=await beginLogin();
  const beforeDeny=authExchanges;
  assert.equal(callback(attempt,{error:"access_denied",code:undefined}).status,400);
  await assert.rejects(attempt.promise,/declined or could not be completed/);
  assert.equal(authExchanges,beforeDeny);
  assert.equal((await runtime.chatGPTStatus()).connected,false); checks++;

  attempt=await beginLogin(); authScope="openid profile email offline_access";
  callback(attempt);
  const limitedLogin=await attempt.promise;
  assert.equal(limitedLogin.connected,true);
  assert.equal(limitedLogin.planUsageEnabled,false);
  const beforeInference=requests.length;
  await assert.rejects(runtime.chatGPTAccessToken(),/plan usage was not authorized/);
  assert.equal(requests.length,beforeInference); checks++;

  // Cancel after the token endpoint accepted the code but before returning.
  attempt=await beginLogin(); holdExchange=true;
  callback(attempt);
  for(let i=0;i<20&&!releaseExchange;i++) await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(releaseExchange);
  runtime.cancelChatGPTLogin();
  await assert.rejects(attempt.promise,/remote revocation was not confirmed/);
  releaseExchange();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await runtime.chatGPTStatus()).connected,false);
  assert.equal(inspect().registrations[0].tokens,undefined);
  assert.equal(inspect().active,undefined);
  assert.equal(existsSync(join(storage,"session.lock")),false); checks++;

  console.log("ChatGPT auth: " + checks + " offline security checks passed. No sign-in or network requests.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
