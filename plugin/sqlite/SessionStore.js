var __CM_FILENAME__ = typeof __filename !== "undefined" ? __filename : require("node:path").resolve(process.argv[1] || "");
var __CM_DIRNAME__ = typeof __dirname !== "undefined" ? __dirname : require("node:path").dirname(__CM_FILENAME__);
var __IMPORT_META_URL__ = require("node:url").pathToFileURL(__CM_FILENAME__).href;
"use strict";var Je=Object.defineProperty;var hn=Object.getOwnPropertyDescriptor;var Ln=Object.getOwnPropertyNames;var Cn=Object.prototype.hasOwnProperty;var In=(n,e)=>{for(var t in e)Je(n,t,{get:e[t],enumerable:!0})},Dn=(n,e,t,s)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of Ln(e))!Cn.call(n,r)&&r!==t&&Je(n,r,{get:()=>e[r],enumerable:!(s=hn(e,r))||s.enumerable});return n};var Mn=n=>Dn(Je({},"__esModule",{value:!0}),n);var Po={};In(Po,{SessionStore:()=>Dt,TELEGRAM_WRAPUP_CLAIM_STALE_AFTER_MS:()=>Nn,rollupObservationFileLists:()=>bn});module.exports=Mn(Po);var yn=new Set;function Q(n,e,t="additive"){for(let s of yn)s({scope:n,reason:e,kind:t})}var ct=require("bun:sqlite");var y=require("fs"),De=require("path");var C=require("path"),Ze=require("os"),he=require("fs"),Pt=require("url");var L=require("fs"),yt=require("crypto"),w=require("path");var Un=null;function vn(n){return(Un??process.stderr.write.bind(process.stderr))(n)}function Z(n){vn(n)}var Ho=Promise.resolve();var Ut=process.platform==="win32";function ze(n){return n.replace(/^\uFEFF/,"")}function Qe(n){return JSON.parse(ze(n))}function _e(n){return Qe((0,L.readFileSync)(n,"utf-8"))}function wn(n){(0,L.existsSync)(n)||(0,L.mkdirSync)(n,{recursive:!0})}function vt(n){try{return(0,L.realpathSync)(n)}catch(e){if(e.code!=="ENOENT")throw e;let t=(0,w.dirname)(n);return t===n?n:(0,w.join)(vt(t),(0,w.basename)(n))}}function Fn(n){let e=n,t=new Set;try{for(;(0,L.lstatSync)(e).isSymbolicLink();){let s=(0,w.resolve)(e);if(t.has(s))throw Object.assign(new Error(`Symlink loop at ${e}`),{code:"ELOOP"});t.add(s);try{return(0,L.realpathSync)(e)}catch(r){if(r.code!=="ENOENT")throw r;let o=r instanceof Error?r:new Error(String(r));Z(`claude-mem: realpathSync failed for ${e}, resolving symlink manually: ${o.message}
`);let i=(0,L.readlinkSync)(e);e=(0,w.resolve)(vt((0,w.dirname)((0,w.resolve)(e))),i)}}}catch(s){if(s.code!=="ENOENT")throw s}return e}var xn=new Set(["EPERM","EBUSY","EACCES"]),Mt=[10,20,40,80,160,320];function kn(n){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,n)}function Pn(n,e,t=L.renameSync,s=Ut){if(!s)return t(n,e);for(let r=0;;r++)try{t(n,e);return}catch(o){let i=o.code??"";if(r>=Mt.length||!xn.has(i))throw o;kn(Mt[r])}}function X(n,e,t={}){let s=Fn(n);wn((0,w.dirname)(s));let r=(0,w.dirname)(s),o=(0,w.basename)(s),i=(0,w.join)(r,`.${o}.${process.pid}.${(0,yt.randomBytes)(6).toString("hex")}.tmp`),a=Buffer.from(JSON.stringify(e,null,2)+`
`,"utf-8"),_=t.mode;if(_===void 0)try{_=(0,L.statSync)(s).mode&511}catch{}let d;try{d=_!==void 0?(0,L.openSync)(i,"w",_):(0,L.openSync)(i,"w");let E=0;for(;E<a.length;){let c=(0,L.writeSync)(d,a,E,a.length-E);if(c===0)throw new Error(`writeSync stalled at ${E}/${a.length} bytes`);E+=c}if((0,L.fsyncSync)(d),(0,L.closeSync)(d),d=void 0,Pn(i,s),!Ut){let c;try{c=(0,L.openSync)(r,"r"),(0,L.fsyncSync)(c)}catch(u){let p=u instanceof Error?u:new Error(String(u));Z(`claude-mem: directory fsync failed for ${r}: ${p.message}
`)}finally{if(c!==void 0)try{(0,L.closeSync)(c)}catch{}}}}catch(E){if(d!==void 0)try{(0,L.closeSync)(d)}catch{}try{(0,L.unlinkSync)(i)}catch{}throw E}}var Bn=n=>n!==null&&typeof n=="object"&&!Array.isArray(n);function wt(n){let e=n.env;return Bn(e)&&Object.keys(e).some(t=>t.startsWith("CLAUDE_MEM_"))?"nested":"flat"}function ee(n){return wt(n)==="nested"?n.env:n}function Ft(n){return wt(n)!=="nested"?n:Object.fromEntries(Object.entries(n).filter(([e])=>!e.startsWith("CLAUDE_MEM_")))}var xt=require("os"),kt=require("path");function te(n,e=process.platform,t=(0,xt.homedir)()){return typeof n!="string"||n.length===0?n:n==="~"?t:n.startsWith("~/")||e==="win32"&&n.startsWith("~\\")?(0,kt.join)(t,n.slice(2)):n}function $n(){return typeof __CM_DIRNAME__<"u"?__CM_DIRNAME__:(0,C.dirname)((0,Pt.fileURLToPath)(__IMPORT_META_URL__))}var Zo=$n();function Hn(){if(process.env.CLAUDE_MEM_DATA_DIR)return te(process.env.CLAUDE_MEM_DATA_DIR);let n=(0,C.join)((0,Ze.homedir)(),".claude-mem"),e=(0,C.join)(n,"settings.json");try{if((0,he.existsSync)(e)){let t=_e(e);if(t===null||typeof t!="object"||Array.isArray(t))return n;let s=ee(t);if(typeof s.CLAUDE_MEM_DATA_DIR=="string"&&s.CLAUDE_MEM_DATA_DIR)return te(s.CLAUDE_MEM_DATA_DIR)}}catch{}return n}var M=Hn(),Gn=(0,C.join)((0,Ze.homedir)(),".claude"),Xn=process.env.CLAUDE_CONFIG_DIR||Gn,ei=(0,C.join)(Xn,"plugins","marketplaces","thedotmack"),jn=(0,C.join)(M,"logs"),Le=(0,C.join)(M,"settings.json"),Bt="claude-mem.db";var Ce=(0,C.join)(M,Bt),Wn=(0,C.join)(M,"observer-sessions"),se=(0,C.basename)(Wn);function Ie(n){(0,he.mkdirSync)(n,{recursive:!0})}var et={dataDir:()=>M,workerPid:()=>(0,C.join)(M,"worker.pid"),workerHeartbeat:()=>(0,C.join)(M,"worker-heartbeat.json"),serverPid:()=>(0,C.join)(M,".server-beta.pid"),serverPort:()=>(0,C.join)(M,".server-beta.port"),serverRuntime:()=>(0,C.join)(M,".server-beta.runtime.json"),settings:()=>(0,C.join)(M,"settings.json"),database:()=>(0,C.join)(M,Bt),backups:()=>(0,C.join)(M,"backups","auto"),pendingRestore:()=>(0,C.join)(M,"backups","restore-pending.json"),lastRestore:()=>(0,C.join)(M,"backups","last-restore.json"),chroma:()=>(0,C.join)(M,"chroma"),combinedCerts:()=>(0,C.join)(M,"combined_certs.pem"),transcriptsConfig:()=>(0,C.join)(M,"transcript-watch.json"),transcriptsState:()=>(0,C.join)(M,"transcript-watch-state.json"),corpora:()=>(0,C.join)(M,"corpora"),supervisorRegistry:()=>(0,C.join)(M,"supervisor.json"),envFile:()=>(0,C.join)(M,".env"),logsDir:()=>jn};var st=(o=>(o[o.DEBUG=0]="DEBUG",o[o.INFO=1]="INFO",o[o.WARN=2]="WARN",o[o.ERROR=3]="ERROR",o[o.SILENT=4]="SILENT",o))(st||{}),tt=null,nt=class{level=null;useColor;logFilePath=null;logFileInitialized=!1;logFileDate=null;logFd=null;constructor(){this.useColor=process.stdout.isTTY??!1}ensureLogFileInitialized(){let e=new Date().toISOString().split("T")[0];if(this.logFileInitialized&&this.logFileDate===e)return;let t=this.logFileDate!==e;this.closeLogFd(),this.logFileInitialized=!1,this.logFileDate=e;try{let s=et.logsDir();(0,y.existsSync)(s)||(0,y.mkdirSync)(s,{recursive:!0}),this.logFilePath=(0,De.join)(s,`claude-mem-${e}.log`),this.logFileInitialized=!0}catch(s){t&&console.error("[LOGGER] Failed to initialize log file:",s instanceof Error?s.message:String(s)),this.logFilePath=null}}closeLogFd(){if(this.logFd!==null){try{(0,y.closeSync)(this.logFd)}catch{}this.logFd=null}}appendLine(e,t){if(this.logFd!==null){let s=!1;try{let r=(0,y.fstatSync)(this.logFd),o=(0,y.statSync)(e);s=r.ino===o.ino&&r.dev===o.dev}catch{}s||this.closeLogFd()}this.logFd===null&&((0,y.mkdirSync)((0,De.dirname)(e),{recursive:!0}),this.logFd=(0,y.openSync)(e,"a"));try{let s=Buffer.from(t,"utf8");for(;s.length>0;){let r=(0,y.writeSync)(this.logFd,s);if(r<=0)throw new Error("log write accepted 0 bytes");s=s.subarray(r)}}catch(s){throw this.closeLogFd(),s}}getLevel(){if(this.level===null)try{let e=et.settings();if((0,y.existsSync)(e)){let s=(ee(_e(e)).CLAUDE_MEM_LOG_LEVEL||"INFO").toString().toUpperCase();this.level=st[s]??1}else this.level=1}catch(e){console.error("[LOGGER] Failed to load log level from settings:",e instanceof Error?e.message:String(e)),this.level=1}return this.level}safeStringify(e,t,s=6){let r=new WeakSet,o=(i,a)=>{if(typeof i=="bigint")return`${i}n`;if(i===null||typeof i!="object")return i;let _=i.toJSON,d=typeof _=="function"?_.call(i):i;if(typeof d=="bigint")return`${d}n`;if(d===null||typeof d!="object")return d;if(r.has(d))return"[Circular]";if(a>=s)return Array.isArray(d)?"[Array]":"[Object]";r.add(d);try{if(Array.isArray(d))return d.map(c=>o(c,a+1));let E={};for(let c of Object.keys(d))try{E[c]=o(d[c],a+1)}catch{E[c]="[unreadable]"}return E}finally{r.delete(d)}};try{return JSON.stringify(o(e,0),null,t)??String(e)}catch{return Array.isArray(e)?`[${e.length} items]`:"[unserializable]"}}formatData(e){if(e==null)return"";if(typeof e=="string")return e;if(typeof e=="number"||typeof e=="boolean")return e.toString();if(typeof e=="object"){if(e instanceof Error)return this.getLevel()===0?`${e.message}
${e.stack}`:e.message;if(Array.isArray(e))return`[${e.length} items]`;let t=Object.keys(e);return t.length===0?"{}":t.length<=3?this.safeStringify(e):`{${t.length} keys: ${t.slice(0,3).join(", ")}...}`}return String(e)}formatTool(e,t){if(!t)return e;let s=t;if(typeof t=="string")try{s=JSON.parse(t)}catch{s=t}if(s===null)return e;if(e==="Bash"&&s.command)return`${e}(${s.command})`;if(s.file_path)return`${e}(${s.file_path})`;if(s.notebook_path)return`${e}(${s.notebook_path})`;if(e==="Glob"&&s.pattern)return`${e}(${s.pattern})`;if(e==="Grep"&&s.pattern)return`${e}(${s.pattern})`;if(s.url)return`${e}(${s.url})`;if(s.query)return`${e}(${s.query})`;if(e==="Task"){if(s.subagent_type)return`${e}(${s.subagent_type})`;if(s.description)return`${e}(${s.description})`}return e==="Skill"&&s.skill?`${e}(${s.skill})`:e==="LSP"&&s.operation?`${e}(${s.operation})`:e}formatTimestamp(e){let t=e.getFullYear(),s=String(e.getMonth()+1).padStart(2,"0"),r=String(e.getDate()).padStart(2,"0"),o=String(e.getHours()).padStart(2,"0"),i=String(e.getMinutes()).padStart(2,"0"),a=String(e.getSeconds()).padStart(2,"0"),_=String(e.getMilliseconds()).padStart(3,"0");return`${t}-${s}-${r} ${o}:${i}:${a}.${_}`}log(e,t,s,r,o){if(e<this.getLevel())return;this.ensureLogFileInitialized();let i=this.formatTimestamp(new Date),a=st[e].padEnd(5),_=t.padEnd(6),d="";r?.correlationId?d=`[${r.correlationId}] `:r?.sessionId&&(d=`[session-${r.sessionId}] `);let E="";o!=null&&(o instanceof Error?E=this.getLevel()===0?`
${o.message}
${o.stack}`:` ${o.message}`:this.getLevel()===0&&typeof o=="object"?E=`
`+this.safeStringify(o,2):E=" "+this.formatData(o));let c="";if(r){let{sessionId:p,memorySessionId:m,correlationId:g,...f}=r;Object.keys(f).length>0&&(c=` {${Object.entries(f).map(([R,T])=>typeof T!="object"||T===null||T instanceof Error||T instanceof Date?`${R}=${T}`:`${R}=${Array.isArray(T)?this.safeStringify(T):this.formatData(T)}`).join(", ")}}`)}let u=`[${i}] [${a}] [${_}] ${d}${s}${c}${E}`;if(this.logFilePath)try{this.appendLine(this.logFilePath,u+`
`)}catch(p){let m=p instanceof Error?p:new Error(String(p));Z(`[LOGGER] Failed to write to log file: ${m.message}
${m.stack??""}
`)}else Z(u+`
`)}debug(e,t,s,r){this.log(0,e,t,s,r)}info(e,t,s,r){this.log(1,e,t,s,r)}warn(e,t,s,r){this.log(2,e,t,s,r)}setErrorSink(e){tt=e}error(e,t,s,r){this.log(3,e,t,s,r),this.routeErrorToSink(t,s,r)}routeErrorToSink(e,t,s){try{if(!tt||!(s instanceof Error))return;tt(s)}catch{}}dataIn(e,t,s,r){this.info(e,`\u2192 ${t}`,s,r)}dataOut(e,t,s,r){this.info(e,`\u2190 ${t}`,s,r)}success(e,t,s,r){this.info(e,`\u2713 ${t}`,s,r)}failure(e,t,s,r){this.error(e,`\u2717 ${t}`,s,r)}},l=new nt;var zt=require("node:async_hooks"),Qt=require("node:worker_threads");function de(n){return n.slice(0,4e3).replace(/\s+/g," ").trim().slice(0,300)}var ye=require("node:fs"),ot=require("node:module"),Gt=require("node:crypto"),Ee=require("node:path");var Yn=16,Kn=2,qn=3,Vn=240,Jn=6e4,zn=/^\s*at (?:async )?(?:(.*?) \()?(.+?):(\d+):(\d+)\)?\s*$/,Xt=/^\s*at /,Qn=/\.(?:c|m)?js$/,Zn="x_claudeMemBundle",it=/^(?:bun|node):|node:internal|^native(?::|$)|\(native\)/,er=["slow-query-log","stream-rows","sql-scope","sql-text","open-database","stack-source-map","event-loop-lag","threshold-env"],tr=new RegExp(`(?:^|/)src/services/sqlite/(?:${er.join("|")})\\.|${it.source}`);function P(){let n=Error.stackTraceLimit;Error.stackTraceLimit=Yn;try{return new Error("sql call site")}finally{Error.stackTraceLimit=n}}var Me;function jt(n,e){Me=n;try{return e()}finally{Me=void 0}}function Wt(){let n=Me;return Me=void 0,n}function Yt(n){let e=zn.exec(n);if(!e)return null;let[,t,s,r,o]=e;return{fn:t||void 0,file:s,line:Number(r),column:Number(o)}}function sr(n){try{let{mtimeNs:e,ctimeNs:t,size:s,ino:r}=(0,ye.statSync)(n,{bigint:!0});return{mtimeNs:e,ctimeNs:t,size:Number(s),ino:r}}catch{return null}}function $t(n,e){return n.size===e.size&&n.mtimeNs===e.mtimeNs&&n.ctimeNs===e.ctimeNs&&n.ino===e.ino}function nr(n){return(0,Gt.createHash)("sha256").update(n).digest("hex")}function rr(){let n=(new Error().stack??"").split(`
`).filter(e=>Xt.test(e))[0];return n&&Yt(n)?.file||null}function or(n={}){let e=n.stat??sr,t=n.readFile??(c=>(0,ye.readFileSync)(c)),s=n.runningBundlePath===void 0?rr():n.runningBundlePath,r=s&&Qn.test(s)?(0,Ee.resolve)(s):null,o=n.processStartedAtMs??Date.now()-process.uptime()*1e3,i=r?e(r):null,a=i&&Number(i.ctimeNs/1000000n)<=o?i:null,_,d=(c,u)=>(l.debug("DB",`Source map not used: ${c}`,{bundlePath:u}),null),E=c=>{try{return JSON.parse(new TextDecoder().decode(t(c)))}catch{return null}};return c=>{if(!r||!a||(0,Ee.resolve)(c)!==r)return d("not the bundle this process loaded",c);let u=e(r);if(!u||!$t(u,a))return d("bundle changed on disk since this process loaded it",c);let p=E(`${r}.map`);if(!p)return d("no readable map next to the bundle",c);let m=p[Zn];if(!m||m.size!==a.size)return d("map carries no build identity for this bundle",c);if(_===void 0){let g=nr(t(r)),f=e(r);if(!f||!$t(f,a))return d("bundle changed while its digest was taken",c);_=g}return m.sha256!==_?d("map was built for a different bundle",c):p}}var ir=or();function ar(n={}){let e=n.readPayload??ir,t=n.idleMs??Jn,s=n.now??(()=>Date.now()),r=n.schedule??((c,u)=>setTimeout(c,u)),o=new Map,i=0,a=!1,_=()=>{o.clear()},d=()=>{if(a)return;a=!0,r(()=>{a=!1,o.size!==0&&(s()-i>=t?_():d())},t).unref?.()},E=(c=>{if(i=s(),o.has(c))return o.get(c)??null;let u=null;try{u=e(c)}catch(p){l.debug("DB","Source map unreadable; slow-query callers stay unmapped",{bundlePath:c},p instanceof Error?p:new Error(String(p))),u=null}return o.set(c,u),d(),u});return E.clear=_,E}var _r=ar(),rt=new WeakMap;function dr(n){if(rt.has(n))return rt.get(n)??null;let e=null;try{e=typeof ot.SourceMap=="function"?new ot.SourceMap(n):null}catch{e=null}return rt.set(n,e),e}function Er(n){return n.replace(/^(?:\.\.\/)+/,"")}function Kt(n){let e=`${n.file}:${n.line}:${n.column}`;return n.fn?`${n.fn} (${e})`:e}function cr(n,e=_r){let t={display:Kt(n),source:n.file,mapped:!1,mapAvailable:!1};if(it.test(n.file))return t;let s;try{s=e(n.file)}catch{return t}if(!s)return t;let r=dr(s);if(!r)return t;let o={...t,mapAvailable:!0},i=r.findEntry(n.line-1,n.column-1);if(typeof i?.originalSource!="string"||typeof i.originalLine!="number")return o;let a=Er(i.originalSource),_=i.name||n.fn,d=`${a}:${i.originalLine+1}:${(i.originalColumn??0)+1}`,E=`[${(0,Ee.basename)(n.file)}:${n.line}:${n.column}]`;return{display:`${_?`${_} `:""}(${d}) ${E}`,source:a,mapped:!0,mapAvailable:!0}}function Ht(n,e,t){let s=[];for(let r of n){if(s.length>=e)break;let o=t(r);o!==null&&s.push(o.slice(0,Vn))}return s}function ur(n,e){let t=e.limit??qn,s=Ht(n,t,r=>{let o=cr(r,e.loadMap);return tr.test(o.source)?null:o.display});return s.length===0&&(s=Ht(n,t,r=>it.test(r.file)?null:Kt(r))),{caller:s[0]??"unknown",callers:s}}function lr(n){return n.map(Yt).filter(e=>e!==null)}function ce(n,e={}){let t=(n.stack??"").split(`
`).filter(s=>Xt.test(s));return ur(lr(t.slice(Kn)),e)}function Ue(n,e,t=process.env){let s=t[n];if(s===void 0)return e;let r=Number(s);return Number.isFinite(r)&&r>0?r:e}var pr=1e3,_t="unscoped-turn",mr=64,qt="(other)",Vt=300,Tr=3;var Sr=20;function fr(){return Qt.isMainThread?"main":"worker"}var Ar=new zt.AsyncLocalStorage;function gr(n){return n.length===0?"[]":`[${n.map(t=>{let s=[`x${t.count}`,`${t.ms}ms`];return t.scope&&s.push(`scope=${t.scope}`),t.caller&&s.push(`caller=${t.caller}`),`${t.sql} (${s.join(", ")})`}).join(" ; ")}]`}function Or(n,e){let{top:t,...s}=e;l.warn("DB",`${n} | top=${gr(t)}`,s)}function Rr(n,e,t){let s=t.now??(()=>performance.now());return{name:n,parent:e,thresholdMs:t.thresholdMs??Ue("CLAUDE_MEM_SLOW_REQUEST_MS",pr),now:s,warn:t.warn??Or,loadMap:t.loadMap,startedAt:s(),closed:!1,statements:0,sqlMs:0,maxMs:0,lastSeq:0,bySql:new Map}}function Nr(n,e,t,s){n.statements++,n.sqlMs+=t,t>n.maxMs&&(n.maxMs=t);let r=s===void 0?e:`${s}\0${e}`,o=e,i=s;!n.bySql.has(r)&&n.bySql.size>=mr&&(r=qt,o=qt,i=void 0);let a=n.bySql.get(r);return a||(a={count:0,ms:0,sql:o,scope:i},n.bySql.set(r,a)),a.count++,a.ms+=t,a}function br(n,e){return e.site===void 0&&e.ms>n.thresholdMs/Sr}function hr(n,e,t){let s=[...n.bySql.entries()].sort((r,o)=>o[1].ms-r[1].ms).slice(0,Tr).map(([,r])=>({sql:de(r.sql),count:r.count,ms:Math.round(r.ms),caller:r.site===void 0?void 0:ce(r.site,{limit:1,loadMap:n.loadMap}).caller,scope:r.scope}));return{scope:e,thread:fr(),statements:n.statements,sqlMs:Math.round(n.sqlMs),wallMs:Math.round(t),maxStatementMs:Math.round(n.maxMs),thresholdMs:n.thresholdMs,top:s}}function Lr(n,e,t){if(n.sqlMs<=n.thresholdMs)return null;let s=hr(n,e,t);return n.warn(`SLOW_REQUEST | scope=${s.scope} | statements=${s.statements} | sqlMs=${s.sqlMs} | wallMs=${s.wallMs}`,s),s}var ue,Jt={};function Cr(){let n=ue;ue=void 0,!(!n||n.statements===0)&&(n.closed=!0,Lr(n,_t,n.now()-n.startedAt))}function Ir(){return ue||(ue=Rr(_t,void 0,Jt),(Jt.schedule??setImmediate)(Cr)),ue}var at;var Dr=0,Mr=0;var j=[];function dt(n,e,t){try{let s=n.length>Vt?n.slice(0,Vt):n;j.length=0;for(let _=Ar.getStore();_;_=_.parent)_.closed||j.push(_);let r=j.length>0,o=r?j[0].name:_t;r||j.push(Ir());let i=at?r?at.scoped:at.unscoped:void 0;i&&j.push(i);let a=++Dr;r||(Mr=a);for(let _ of j){_.lastSeq=a;let d=Nr(_,s,e,_===i?o:void 0);br(_,d)&&(t??=P(),d.site=t)}}catch{}finally{j.length=0}}var yr=500,Ur=["all","get","run","values"],Zt=new WeakSet,es=new WeakSet,ve=new WeakMap;function vr(n,e){l.warn("DB",n,{...e})}function wr(n){return typeof n[0]=="string"?n[0]:""}function Et(n,e={}){if(Zt.has(n))return n;Zt.add(n);let t=e.thresholdMs??Ue("CLAUDE_MEM_SLOW_QUERY_MS",yr),s=e.now??(()=>performance.now()),r=e.warn??vr,o=0;function i(E,c,u,p){if(!E)return p();o++;let m=s();try{return p()}finally{o--;let g=s()-m,f=typeof u=="string"?u:ve.get(u)??"";dt(f,g,E),g>t&&r(`SLOW_QUERY | op=${c} | ms=${Math.round(g)}`,{op:c,elapsedMs:g,thresholdMs:t,sql:de(f),...ce(E)})}}function*a(E,c,u,p){let m=0,g=s(),f,N=0,R=T=>{let D=s();try{return T()}finally{m+=s()-D}};try{let T=R(()=>c.apply(E,u)[Symbol.iterator]());for(;;){let D=R(()=>T.next());if(D.done)return;f===void 0&&(f=m),N++,yield D.value}}finally{let T=s()-g,D=ve.get(E)??"";dt(D,m,p),(m>t||T>t)&&r(`SLOW_QUERY | op=iterate | wallMs=${Math.round(T)} | busyMs=${Math.round(m)}`,{op:"iterate",elapsedMs:T,busyMs:m,wallMs:T,thresholdMs:t,sql:de(D),...ce(p),firstRowMs:f,rows:N})}}let _=(E,c)=>{if(ve.has(E)||ve.set(E,c),es.has(E))return E;es.add(E);let u=E;for(let m of Ur){let g=u[m];typeof g=="function"&&(u[m]=function(...N){let R=o===0?P():void 0;return i(R,m,E,()=>g.apply(E,N))})}let p=u.iterate;return typeof p=="function"&&(u.iterate=function(...g){let f=Wt()??P();return a(E,p,g,f)}),E},d=n;for(let[E,c,u]of[["prepare","prepare",!0],["query","query",!0],["run","db.run",!1],["exec","db.exec",!1]]){let p=d[E];typeof p=="function"&&(d[E]=function(...g){let f=wr(g),N=o===0?P():void 0,R=i(N,c,f,()=>p.apply(n,g));return u?_(R,f):R})}return n}function ts(n,e){return Et(new ct.Database(n,e))}function we(n,e){return n instanceof ct.Database?Et(n):ts(n,e)}var qe=require("crypto");function x(n){let e=n.projects?.length?n.projects:n.project?[n.project]:[];return[...new Set(e.map(t=>t.trim()).filter(Boolean))]}function B(n,e,t){let s=e.map(()=>"?").join(",");return t.includeMerged?{sql:`(${n}.project COLLATE NOCASE IN (${s}) OR ${n}.merged_into_project COLLATE NOCASE IN (${s}))`,params:[...e,...e]}:{sql:`${n}.project COLLATE NOCASE IN (${s})`,params:[...e]}}var Fr=4;function ss(n,e){let t=x({projects:e});if(t.length===0)return[];let s=t.map(()=>"?").join(","),r=[[`SELECT project AS key FROM sdk_sessions WHERE project COLLATE NOCASE IN (${s})`,1],[`SELECT project FROM observations WHERE project COLLATE NOCASE IN (${s})`,1],[`SELECT merged_into_project FROM observations WHERE merged_into_project COLLATE NOCASE IN (${s})`,1],[`SELECT project FROM session_summaries WHERE project COLLATE NOCASE IN (${s})`,1],[`SELECT merged_into_project FROM session_summaries WHERE merged_into_project COLLATE NOCASE IN (${s})`,1],[`SELECT candidates.key FROM (
        SELECT project AS key FROM observations WHERE merged_into_project COLLATE NOCASE IN (${s})
        UNION
        SELECT project AS key FROM session_summaries WHERE merged_into_project COLLATE NOCASE IN (${s})
      ) candidates
      WHERE (
        (SELECT COUNT(*) FROM observations WHERE project COLLATE NOCASE = candidates.key)
        + (SELECT COUNT(*) FROM session_summaries WHERE project COLLATE NOCASE = candidates.key)
      ) = (
        (SELECT COUNT(*) FROM observations
          WHERE project COLLATE NOCASE = candidates.key AND merged_into_project COLLATE NOCASE IN (${s}))
        + (SELECT COUNT(*) FROM session_summaries
          WHERE project COLLATE NOCASE = candidates.key AND merged_into_project COLLATE NOCASE IN (${s}))
      )`,Fr]],o=n.prepare(r.map(([i])=>i).join(" UNION "));try{let i=o.all(...r.flatMap(([,a])=>Array(a).fill(t).flat()));return[...new Set([...t,...i.map(a=>a.key)])]}finally{o.finalize()}}var ns=require("crypto");function ut(n){return typeof n=="string"&&n.trim()!==""}function rs(n,e,t){return(0,ns.createHash)("sha256").update([n||"",e||"",t||""].join("\0")).digest("hex").slice(0,16)}function os(n){if(!n)return[];try{let e=JSON.parse(n);return Array.isArray(e)?e.filter(t=>typeof t=="string"&&t.length>0):[]}catch{return[]}}function is(n,e,t,s){n.prepare("DELETE FROM observation_files WHERE observation_id = ?").run(e);let r=new Set([...os(t),...os(s)]);if(r.size===0)return;let o=n.prepare("INSERT OR IGNORE INTO observation_files(path, observation_id) VALUES (?, ?)");for(let i of r)o.run(i,e)}function as(n){if(!n)return[];try{let e=JSON.parse(n);return Array.isArray(e)?e.filter(t=>typeof t=="string"&&t.length>0):[]}catch{return[]}}function lt(n=new Date){return n.toISOString().slice(0,10)}function _s(n,e=new Date,t=10){let s=lt(e);if(n.includes(s))return n;let r=[...n,s];return r.length>t?r.slice(r.length-t):r}function ds(n){let e=lt(new Date(n));return{dates:JSON.stringify([e]),lastReinforced:e}}function Fe(n,e,t=new Date){let s=n.prepare("SELECT reinforcement_dates FROM observations WHERE id = ?").get(e);if(!s)return!1;let r=as(s.reinforcement_dates),o=_s(r,t);return o===r?!1:(n.prepare("UPDATE observations SET reinforcement_dates = ?, last_reinforced = ? WHERE id = ?").run(JSON.stringify(o),o[o.length-1],e),!0)}var ls=require("crypto");var A="claude";function xr(n){return n.trim().toLowerCase().replace(/\s+/g,"-")}function b(n){if(!n)return A;let e=xr(n);return e?e==="transcript"||e.includes("codex")?"codex":e.includes("cursor")?"cursor":e.includes("claude")?"claude":e.includes("kimi")?"kimi":e==="pi-mono"?"pi":e==="agy"||e==="antigravity"||e.startsWith("antigravity-")?"antigravity-cli":e:A}function Es(n){let e=["claude","codex","antigravity-cli","cursor","kimi"];return[...n].sort((t,s)=>{let r=e.indexOf(t),o=e.indexOf(s);return r!==-1||o!==-1?r===-1?1:o===-1?-1:r-o:t.localeCompare(s)})}var kr=new Set(["dumb_search","claude_mem_search","claude_mem_timeline","claude_mem_get_observations","mem_search","search","timeline","get_observations","get_summaries","get_tool_uses","session_start_context","observation_search","observation_context","memory_search","memory_context"]);function Pr(n){if(!n.startsWith("mcp__"))return null;let e=n.split("__");if(e.length<3)return null;let t=e[1].toLowerCase();return!t.includes("claude-mem")&&!t.includes("claude_mem")&&!t.includes("mcp-search")&&!t.includes("mcp_search")&&!t.includes("cmem")?null:e.slice(2).join("__")}function pt(n){if(!n)return!1;if(n.startsWith("memory_")||n==="claude_mem_search"||n==="claude_mem_timeline"||n==="claude_mem_get_observations"||n==="dumb_search"||n==="mem_search"||n==="get_summaries")return!0;let e=Pr(n);return e!==null&&kr.has(e)}var Br=64*1024,$r=3;function cs(n,e=Br){let t=Buffer.byteLength(n,"utf8");if(t<=e)return n;let s=Buffer.from(n,"utf8"),r=e;for(;r>0&&(s[r]&192)===128;)r--;return`${s.subarray(0,r).toString("utf8")}\u2026[truncated: ${t} bytes]`}function Hr(n,e,t){return(0,ls.createHash)("sha256").update([n||"",e||"",t||""].join("\0")).digest("hex").slice(0,16)}function ps(n){n.run(`
    CREATE TABLE IF NOT EXISTS tool_uses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_use_id TEXT NOT NULL,
      content_session_id TEXT NOT NULL,
      memory_session_id TEXT,
      session_db_id INTEGER,
      project TEXT NOT NULL,
      platform_source TEXT NOT NULL DEFAULT '${A}',
      tool_name TEXT NOT NULL,
      tool_input TEXT,
      tool_response TEXT,
      cwd TEXT,
      prompt_number INTEGER,
      agent_type TEXT,
      agent_id TEXT,
      observation_id INTEGER,
      or_generation_id TEXT,
      or_session_id TEXT,
      content_hash TEXT,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL,
      UNIQUE(content_session_id, tool_use_id)
    )
  `),n.run("CREATE INDEX IF NOT EXISTS idx_tool_uses_project ON tool_uses(project)"),n.run("CREATE INDEX IF NOT EXISTS idx_tool_uses_project_nocase_created ON tool_uses(project COLLATE NOCASE, created_at_epoch DESC, id DESC)"),n.run("CREATE INDEX IF NOT EXISTS idx_tool_uses_memory_session ON tool_uses(memory_session_id)"),n.run("CREATE INDEX IF NOT EXISTS idx_tool_uses_content_session ON tool_uses(content_session_id)"),n.run("CREATE INDEX IF NOT EXISTS idx_tool_uses_session_db_id ON tool_uses(session_db_id)"),n.run("CREATE INDEX IF NOT EXISTS idx_tool_uses_tool_name ON tool_uses(tool_name)"),n.run("CREATE INDEX IF NOT EXISTS idx_tool_uses_created_at_epoch ON tool_uses(created_at_epoch)"),n.run("CREATE INDEX IF NOT EXISTS idx_tool_uses_name_created ON tool_uses(tool_name, created_at_epoch)"),n.run("CREATE INDEX IF NOT EXISTS idx_tool_uses_observation_id ON tool_uses(observation_id)"),n.run("CREATE INDEX IF NOT EXISTS idx_tool_uses_or_generation_id ON tool_uses(or_generation_id)"),Gr(n)}function Gr(n){let e=new Set(n.prepare("PRAGMA table_info(tool_uses)").all().map(t=>t.name));e.has("summary_state")||n.run("ALTER TABLE tool_uses ADD COLUMN summary_state TEXT"),e.has("summary_attempts")||n.run("ALTER TABLE tool_uses ADD COLUMN summary_attempts INTEGER NOT NULL DEFAULT 0"),e.has("summary_state_epoch")||n.run("ALTER TABLE tool_uses ADD COLUMN summary_state_epoch INTEGER"),n.run(`CREATE INDEX IF NOT EXISTS idx_tool_uses_summary_owed
    ON tool_uses(session_db_id, id) WHERE summary_state = 'pending'`)}function ms(n,e){if(!e.toolUseId||!e.contentSessionId||!e.toolName||pt(e.toolName))return null;let t=e.createdAtEpoch??Date.now(),s=new Date(t).toISOString(),r=Hr(e.toolName,e.toolInput,e.toolResponse),o=e.toolInput!=null?cs(e.toolInput):null,i=e.toolResponse!=null?cs(e.toolResponse):null,a=e.summaryOwed===void 0?null:e.summaryOwed?"pending":"done",_=n.prepare(`
    INSERT INTO tool_uses (
      tool_use_id, content_session_id, memory_session_id, session_db_id, project,
      platform_source, tool_name, tool_input, tool_response, cwd, prompt_number,
      agent_type, agent_id, or_generation_id, or_session_id, content_hash,
      created_at, created_at_epoch, summary_state, summary_state_epoch
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(content_session_id, tool_use_id) DO UPDATE SET
      memory_session_id = CASE WHEN tool_uses.observation_id IS NULL
        THEN COALESCE(excluded.memory_session_id, tool_uses.memory_session_id)
        ELSE tool_uses.memory_session_id END,
      session_db_id     = COALESCE(excluded.session_db_id, tool_uses.session_db_id),
      project           = CASE WHEN excluded.project != '' THEN excluded.project ELSE tool_uses.project END,
      platform_source   = excluded.platform_source,
      tool_input        = COALESCE(excluded.tool_input, tool_uses.tool_input),
      tool_response     = COALESCE(excluded.tool_response, tool_uses.tool_response),
      cwd               = COALESCE(excluded.cwd, tool_uses.cwd),
      prompt_number     = COALESCE(excluded.prompt_number, tool_uses.prompt_number),
      agent_type        = COALESCE(excluded.agent_type, tool_uses.agent_type),
      agent_id          = COALESCE(excluded.agent_id, tool_uses.agent_id),
      or_generation_id  = COALESCE(excluded.or_generation_id, tool_uses.or_generation_id),
      or_session_id     = COALESCE(excluded.or_session_id, tool_uses.or_session_id),
      content_hash      = excluded.content_hash,
      summary_state     = COALESCE(tool_uses.summary_state, excluded.summary_state),
      summary_state_epoch = COALESCE(tool_uses.summary_state_epoch, excluded.summary_state_epoch)
    RETURNING id
  `).get(e.toolUseId,e.contentSessionId,e.memorySessionId??null,e.sessionDbId??null,e.project??"",b(e.platformSource),e.toolName,o,i,e.cwd??null,e.promptNumber??null,e.agentType??null,e.agentId??null,e.orGenerationId??null,e.orSessionId??null,r,s,t,a,a===null?null:t);return _?_.id:null}function Ts(n,e){let t=e.toolUseIds.filter(o=>typeof o=="string"&&o.length>0);if(t.length===0)return 0;let s=t.map(()=>"?").join(","),r=n.prepare(`
    UPDATE tool_uses
    SET observation_id = COALESCE(observation_id, ?),
        memory_session_id = CASE WHEN observation_id IS NULL
          THEN COALESCE(?, memory_session_id)
          ELSE COALESCE(memory_session_id, ?)
        END
    WHERE content_session_id = ?
      AND tool_use_id IN (${s})
      AND (observation_id IS NULL OR observation_id = ?)
  `).run(e.observationId,e.memorySessionId??null,e.memorySessionId??null,e.contentSessionId,...t,e.observationId);return Number(r.changes??0)}function mt(n,e){let t=e.toolUseIds.filter(o=>typeof o=="string"&&o.length>0);if(t.length===0)return 0;let s=t.map(()=>"?").join(","),r=n.prepare(`
    UPDATE tool_uses
    SET summary_state = ?, summary_state_epoch = ?
    WHERE session_db_id = ?
      AND summary_state = 'pending'
      AND tool_use_id IN (${s})
  `).run(e.state,e.nowEpoch??Date.now(),e.sessionDbId,...t);return Number(r.changes??0)}function Ss(n,e){return n.prepare(`
    SELECT session_db_id AS sessionDbId, COUNT(*) AS owed, MIN(created_at_epoch) AS oldestCreatedAtEpoch
    FROM tool_uses
    WHERE summary_state = 'pending' AND session_db_id IS NOT NULL
    GROUP BY session_db_id
    ORDER BY oldestCreatedAtEpoch ASC, session_db_id ASC
    LIMIT ?
  `).all(e)}function fs(n){return n.prepare("SELECT COUNT(*) AS owed FROM tool_uses WHERE summary_state = 'pending'").get().owed}var Xr=500,us=500;function jr(n){return n===void 0||!Number.isFinite(n)?1/0:Math.ceil(n)}function Wr(n,e,t){let s=t===1/0?Xr:t+e.heldToolUseIds.size,r=n.prepare(`
    SELECT id, tool_use_id, summary_attempts FROM tool_uses INDEXED BY idx_tool_uses_summary_owed
    WHERE session_db_id = ? AND summary_state = 'pending' AND id > ?
    ORDER BY id ASC
    LIMIT ?
  `),o=[],i=[],a=0;for(;;){let _=r.all(e.sessionDbId,a,s);for(let d of _)if(a=d.id,!e.heldToolUseIds.has(d.tool_use_id)){if(d.summary_attempts>=$r){i.push(d.id);continue}if(o.push(d.id),o.length>=t)return{chosen:o,parkIds:i}}if(_.length<s)return{chosen:o,parkIds:i}}}function Yr(n,e){let t=[];for(let s=0;s<e.length;s+=us){let r=e.slice(s,s+us),o=r.map(()=>"?").join(",");t.push(...n.prepare(`SELECT * FROM tool_uses WHERE id IN (${o}) ORDER BY id ASC`).all(...r))}return t}function As(n,e){let t=e.nowEpoch??Date.now(),s=jr(e.limit);return s<=0?{rows:[],parked:0}:n.transaction(()=>{let{chosen:r,parkIds:o}=Wr(n,e,s),i=Yr(n,r),a=n.prepare("UPDATE tool_uses SET summary_state = 'parked', summary_state_epoch = ? WHERE id = ?");for(let d of o)a.run(t,d);let _=n.prepare("UPDATE tool_uses SET summary_attempts = summary_attempts + 1 WHERE id = ?");for(let d of r)_.run(d);return{rows:i,parked:o.length}}).immediate()}function gs(n){return n?{clause:`COALESCE(NULLIF(platform_source, ''), '${A}') = ?`,param:b(n)}:null}function Os(n,e,t={}){let s=[],r=[];for(let E of e){if(typeof E=="number"&&Number.isInteger(E)){s.push(E);continue}if(typeof E=="string"&&E.trim().length>0){let c=Number(E);Number.isInteger(c)&&String(c)===E.trim()&&s.push(c),r.push(E.trim())}}if(s.length===0&&r.length===0)return[];let o=[],i=[];s.length>0&&(o.push(`id IN (${s.map(()=>"?").join(",")})`),i.push(...s)),r.length>0&&(o.push(`tool_use_id IN (${r.map(()=>"?").join(",")})`),i.push(...r));let a=[`(${o.join(" OR ")})`];t.project&&(a.push("project COLLATE NOCASE = ?"),i.push(t.project)),t.contentSessionId&&(a.push("content_session_id = ?"),i.push(t.contentSessionId));let _=gs(t.platformSource);_&&(a.push(_.clause),i.push(_.param));let d=t.limit&&t.limit>0?`LIMIT ${Math.floor(t.limit)}`:"";return n.prepare(`
    SELECT * FROM tool_uses
    WHERE ${a.join(" AND ")}
    ORDER BY created_at_epoch DESC
    ${d}
  `).all(...i)}function Rs(n,e={}){let t=[],s=[];if(e.project&&(t.push("project COLLATE NOCASE = ?"),s.push(e.project)),e.contentSessionId&&(t.push("content_session_id = ?"),s.push(e.contentSessionId)),e.memorySessionId&&(t.push("memory_session_id = ?"),s.push(e.memorySessionId)),typeof e.sessionDbId=="number"&&(t.push("session_db_id = ?"),s.push(e.sessionDbId)),e.toolName){let d=Array.isArray(e.toolName)?e.toolName:[e.toolName];d.length>0&&(t.push(`tool_name IN (${d.map(()=>"?").join(",")})`),s.push(...d))}e.agentId&&(t.push("agent_id = ?"),s.push(e.agentId));let r=gs(e.platformSource);r&&(t.push(r.clause),s.push(r.param)),typeof e.dateStart=="number"&&(t.push("created_at_epoch >= ?"),s.push(e.dateStart)),typeof e.dateEnd=="number"&&(t.push("created_at_epoch <= ?"),s.push(e.dateEnd));let o=t.length>0?`WHERE ${t.join(" AND ")}`:"",i=e.orderBy==="date_asc"?"ASC":"DESC",a=Math.min(Math.max(Math.floor(e.limit??50),1),500),_=Math.max(Math.floor(e.offset??0),0);return n.prepare(`
    SELECT * FROM tool_uses
    ${o}
    ORDER BY created_at_epoch ${i}, id ${i}
    LIMIT ${a} OFFSET ${_}
  `).all(...s)}function Ns(n,e={}){let t=[],s=[];e.project&&(t.push("project COLLATE NOCASE = ?"),s.push(e.project)),e.contentSessionId&&(t.push("content_session_id = ?"),s.push(e.contentSessionId)),e.agentId&&(t.push("agent_id = ?"),s.push(e.agentId)),typeof e.dateStart=="number"&&(t.push("created_at_epoch >= ?"),s.push(e.dateStart)),typeof e.dateEnd=="number"&&(t.push("created_at_epoch <= ?"),s.push(e.dateEnd));let r=t.length>0?`WHERE ${t.join(" AND ")}`:"";return n.prepare(`
    SELECT tool_name, COUNT(DISTINCT tool_use_id) AS uses
    FROM tool_uses
    ${r}
    GROUP BY tool_name
    ORDER BY uses DESC, tool_name ASC
  `).all(...s)}function bs(n){n.run(`
    CREATE TABLE IF NOT EXISTS deliverables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      content_session_id TEXT NOT NULL,
      platform_source TEXT NOT NULL,
      agent_id TEXT,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_path TEXT NOT NULL,
      bucket_path TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      declared INTEGER NOT NULL DEFAULT 0,
      list_name TEXT,
      field TEXT,
      tool_use_id TEXT,
      occurred_at_epoch INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    )
  `),n.run("CREATE UNIQUE INDEX IF NOT EXISTS ux_deliverables_session_copy ON deliverables(platform_source, content_session_id, bucket_path)"),n.run("CREATE INDEX IF NOT EXISTS idx_deliverables_project ON deliverables(project COLLATE NOCASE, created_at_epoch)"),n.run("CREATE INDEX IF NOT EXISTS idx_deliverables_created ON deliverables(created_at_epoch DESC)")}function hs(n,e){let t=e.createdAtEpoch??Date.now(),s=n.prepare(`
    INSERT OR IGNORE INTO deliverables (
      project, content_session_id, platform_source, agent_id, title, kind, source_path, bucket_path, bytes, sha256,
      declared, list_name, field, tool_use_id, occurred_at_epoch, created_at, created_at_epoch
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(e.project,e.contentSessionId,e.platformSource,e.agentId??null,e.title,e.kind,e.sourcePath,e.bucketPath,e.bytes,e.sha256,e.declared?1:0,e.listName??null,e.field??null,e.toolUseId??null,e.occurredAtEpoch,new Date(t).toISOString(),t);if(s.changes>0){let o=Number(s.lastInsertRowid);return l.debug("DB","Deliverable recorded",{id:o,project:e.project,bucketPath:e.bucketPath}),{id:o,inserted:!0}}return{id:n.prepare("SELECT id FROM deliverables WHERE platform_source = ? AND content_session_id = ? AND bucket_path = ?").get(e.platformSource,e.contentSessionId,e.bucketPath)?.id??0,inserted:!1}}function Ls(n,e){return!Number.isSafeInteger(e)||e<1?null:n.prepare("SELECT * FROM deliverables WHERE id = ?").get(e)??null}function Cs(n,e){let t=o=>o.replace(/[A-Z]/g,i=>i.toLowerCase()),s=new Set(e.map(t)),r=e.at(-1);return n.map(o=>r&&s.has(t(o.project))?{...o,scope_project:r}:o)}function Is(n){n.run(`
    CREATE TABLE IF NOT EXISTS work_state_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      list_name TEXT NOT NULL,
      fields TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    )
  `),n.run("CREATE INDEX IF NOT EXISTS idx_work_state_entries_project ON work_state_entries(project COLLATE NOCASE, list_name, id)"),Kr(n)}function Kr(n){let e=new Set(n.query("PRAGMA table_info(work_state_entries)").all().map(t=>t.name));e.has("synced_at")||n.run("ALTER TABLE work_state_entries ADD COLUMN synced_at INTEGER"),e.has("origin_device_id")||n.run("ALTER TABLE work_state_entries ADD COLUMN origin_device_id TEXT"),e.has("origin_local_id")||n.run("ALTER TABLE work_state_entries ADD COLUMN origin_local_id TEXT"),e.has("sync_rev")||n.run("ALTER TABLE work_state_entries ADD COLUMN sync_rev TEXT NOT NULL DEFAULT '1'"),n.run("CREATE INDEX IF NOT EXISTS idx_work_state_entries_unsynced ON work_state_entries(id) WHERE synced_at IS NULL"),n.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_work_state_entries_origin
    ON work_state_entries(origin_device_id, origin_local_id)
    WHERE origin_device_id IS NOT NULL
  `)}function Ds(n,e){let t=e.createdAtEpoch??Date.now(),s=n.prepare(`
    INSERT INTO work_state_entries (project, list_name, fields, created_at, created_at_epoch)
    VALUES (?, ?, ?, ?, ?)
  `).run(e.project,e.listName,JSON.stringify(e.fields),new Date(t).toISOString(),t),r=Number(s.lastInsertRowid);return l.debug("DB","Work state entry appended",{id:r,project:e.project,listName:e.listName}),r}function Ms(n,e,t,s=""){if(e.length===0)return[];let r=e.map(()=>"?").join(", "),o=t===void 0?"":" AND list_name = ?",i=n.prepare(`
    SELECT id, project, list_name, fields, created_at_epoch
    FROM work_state_entries
    WHERE project COLLATE NOCASE IN (${r})${o}
    ORDER BY created_at_epoch, COALESCE(origin_device_id, ?), COALESCE(CAST(origin_local_id AS INTEGER), id)
  `);try{return i.all(...e,...t===void 0?[]:[t],s).map(_=>({..._,fields:JSON.parse(_.fields)}))}finally{i.finalize()}}var Y=require("fs"),$=require("path"),le=require("os");var xe={HEALTH_CHECK:3e3,API_REQUEST:3e4,SESSION_INIT_HOOK_CAP:15e3,SESSION_INIT_REQUEST:1e4,SESSION_INIT_REQUEST_MAX:14e3,HOOK_READINESS_WAIT:1e4,POST_SPAWN_WAIT:15e3,READINESS_WAIT:3e4,PORT_IN_USE_WAIT:3e3,POWERSHELL_COMMAND:1e4,WINDOWS_MULTIPLIER:1.5};function qr(n=process.platform){return n==="win32"?8e3:5e3}function ys(n=process.platform){return xe.SESSION_INIT_HOOK_CAP-qr(n)}function Us(n){return process.platform==="win32"?Math.round(n*xe.WINDOWS_MULTIPLIER):n}function vs(n){try{return new URL(n).hostname.toLowerCase()==="openrouter.ai"}catch{return!1}}var Vr="security_alert",Jr=new Set(["xiaomi/mimo-v2-flash:free"]);function zr(n){return typeof n=="boolean"?String(n):n}function Qr(n){let e=n.CLAUDE_MEM_OPENROUTER_MODEL;if(typeof e!="string"||!Jr.has(e.trim()))return!1;let t=typeof n.CLAUDE_MEM_OPENROUTER_BASE_URL=="string"?n.CLAUDE_MEM_OPENROUTER_BASE_URL.trim():"";return t===""||vs(t)}var ws=18e4,Fs=[{key:"CLAUDE_MEM_LLM_TIMEOUT_MS",legacy:"30000",markerTag:"llm-timeout-migrated-v1"},{key:"CLAUDE_MEM_FIELD_OPTIMIZE_TIMEOUT_MS",legacy:"30000",markerTag:"field-optimize-timeout-migrated-v1"}];function ks(n,e){return(0,$.join)((0,$.dirname)(n),`.${(0,$.basename)(n)}.${e.markerTag}`)}function Tt(n,e){try{(0,Y.writeFileSync)(ks(n,e),new Date().toISOString(),{encoding:"utf-8",mode:384})}catch{}}var xs=new Set;function Zr(n){return null}var ne=class{static DEFAULTS={CLAUDE_MEM_MEMORY_SEARCH_HOOK_ENABLED:"true",CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED:"true",CLAUDE_MEM_MEMORY_WATCH_ROOTS:"",CLAUDE_MEM_MODEL:"claude-haiku-4-5-20251001",CLAUDE_MEM_CONTEXT_OBSERVATIONS:"50",CLAUDE_MEM_SESSION_START_INCLUDE_ALL_SOURCES:"false",CLAUDE_MEM_CONTEXT_PROJECTS:"current",CLAUDE_MEM_WORKER_PORT:String(37700+(process.getuid?.()??77)%100),CLAUDE_MEM_WORKER_HOST:"127.0.0.1",CLAUDE_MEM_WORKER_INGEST_TOKEN:"",CLAUDE_MEM_WORKER_INGEST_MAX_BYTES:"5242880",CLAUDE_MEM_HOOK_SPOOL_TRANSPORT:"auto",CLAUDE_MEM_ALLOWED_ORIGINS:"",CLAUDE_MEM_PUBLIC_URL:"",CLAUDE_MEM_API_TIMEOUT_MS:String(Us(xe.API_REQUEST)),CLAUDE_MEM_SESSION_INIT_TIMEOUT_MS:String(ys()),CLAUDE_MEM_IDLE_EXIT_SEC:"0",CLAUDE_MEM_SKIP_TOOLS:"ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion",CLAUDE_MEM_SKIP_BASH_PATTERNS:"",CLAUDE_MEM_SKIP_SUBAGENT_OBSERVATIONS:"false",CLAUDE_MEM_SKIP_AGENT_TYPES:"",CLAUDE_MEM_CAPTURE_ADVISOR_CALLS:"false",CLAUDE_MEM_DELIVERABLES_ENABLED:"true",CLAUDE_MEM_PROVIDER:"claude",CLAUDE_MEM_CODEX_MODEL:"",CLAUDE_MEM_CODEX_PATH:"codex",CLAUDE_MEM_CODEX_REASONING_EFFORT:"low",CLAUDE_MEM_CODEX_MAX_CONCURRENT_AGENTS:"2",CLAUDE_MEM_CODEX_OBSERVATION_BATCH_SIZE:"8",CLAUDE_MEM_CODEX_OBSERVATION_BATCH_MAX_CHARS:"32000",CLAUDE_MEM_CLAUDE_OBSERVATION_BATCH_SIZE:"1",CLAUDE_MEM_CLAUDE_AUTH_METHOD:"subscription",CLAUDE_MEM_GEMINI_API_KEY:"",CLAUDE_MEM_GEMINI_API_KEYS:"",CLAUDE_MEM_GEMINI_MODEL:"gemini-flash-latest",CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED:"true",CLAUDE_MEM_OPENROUTER_API_KEY:"",CLAUDE_MEM_OPENROUTER_API_KEYS:"",CLAUDE_MEM_OPENROUTER_MODEL:"cohere/north-mini-code:free",CLAUDE_MEM_OPENROUTER_BASE_URL:"",CLAUDE_MEM_OPENROUTER_TEMPERATURE:"",CLAUDE_MEM_OPENROUTER_SITE_URL:"",CLAUDE_MEM_OPENROUTER_APP_NAME:"claude-mem",CLAUDE_MEM_OPENROUTER_EXTRA_BODY:"",CLAUDE_MEM_OPENROUTER_REASONING_EFFORT:"",CLAUDE_MEM_OPENAI_COMPAT_PRESET:"",CLAUDE_MEM_OPENAI_COMPAT_API_KEY:"",CLAUDE_MEM_OPENAI_COMPAT_API_KEYS:"",CLAUDE_MEM_OPENAI_COMPAT_BASE_URL:"",CLAUDE_MEM_OPENAI_COMPAT_MODEL:"",CLAUDE_MEM_OPENAI_COMPAT_REASONING:"",CLAUDE_MEM_OPENAI_COMPAT_OBSERVATION_BATCH_SIZE:"1",CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER:"claude",CLAUDE_MEM_QUOTA_FALLBACK_MODEL:"",CLAUDE_MEM_QUOTA_FALLBACK_AUTH_METHOD:"",CLAUDE_MEM_QUOTA_THRESHOLD_FIVE_HOUR:"0.95",CLAUDE_MEM_QUOTA_THRESHOLD_SEVEN_DAY:"0.93",CLAUDE_MEM_QUOTA_THRESHOLD_SEVEN_DAY_OPUS:"0.93",CLAUDE_MEM_QUOTA_THRESHOLD_SEVEN_DAY_SONNET:"0.92",CLAUDE_MEM_QUOTA_THRESHOLD_OVERAGE:"0.95",CLAUDE_MEM_DATA_DIR:(0,$.join)((0,le.homedir)(),".claude-mem"),CLAUDE_MEM_LOG_LEVEL:"INFO",CLAUDE_MEM_PYTHON_VERSION:"3.13",CLAUDE_CODE_PATH:"",CLAUDE_MEM_CLAUDE_CONFIG_DIR:"",CLAUDE_MEM_OBSERVER_CLAUDE_CONFIG_DIR:"",CLAUDE_MEM_MODE:"code",CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS:"false",CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS:"false",CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT:"false",CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT:"true",CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES:"",CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS:"",CLAUDE_MEM_CONTEXT_FULL_COUNT:"0",CLAUDE_MEM_CONTEXT_FULL_FIELD:"narrative",CLAUDE_MEM_CONTEXT_SESSION_COUNT:"10",CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY:"true",CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE:"false",CLAUDE_MEM_CONTEXT_MAIN_AGENT_ONLY:"true",CLAUDE_MEM_REINFORCE_ALPHA:"0",CLAUDE_MEM_CONTEXT_SHOW_TERMINAL_OUTPUT:"true",CLAUDE_MEM_WELCOME_HINT_ENABLED:"true",CLAUDE_MEM_WORK_STATE_ENABLED:"true",CLAUDE_MEM_FILE_READ_GATE_ENABLED:"true",CLAUDE_MEM_FOLDER_CLAUDEMD_ENABLED:"false",CLAUDE_MEM_FOLDER_USE_LOCAL_MD:"false",CLAUDE_MEM_TRANSCRIPTS_ENABLED:"true",CLAUDE_MEM_TRANSCRIPTS_CONFIG_PATH:(0,$.join)((0,le.homedir)(),".claude-mem","transcript-watch.json"),CLAUDE_MEM_CODEX_TRANSCRIPT_INGESTION:"false",CLAUDE_MEM_CODEX_SUBAGENT_INGESTION:"false",CLAUDE_MEM_SUMMARY_BACKLOG_SESSIONS:"1",CLAUDE_MEM_MAX_CONCURRENT_AGENTS:"2",CLAUDE_MEM_OBSERVER_MAX_CONVERSATION_CHARS:"400000",CLAUDE_MEM_OBSERVER_THINKING:"disabled",CLAUDE_MEM_OBSERVER_CONTEXT_WINDOW:"",CLAUDE_MEM_OBSERVER_MAX_OUTPUT_TOKENS:"4096",CLAUDE_MEM_OBSERVE_BARE_PROMPTS:"false",CLAUDE_MEM_HOOK_FAIL_LOUD_THRESHOLD:"3",CLAUDE_MEM_REDACT_ENABLED:"false",CLAUDE_MEM_REDACT_DISABLED_BUILTINS:"",CLAUDE_MEM_REDACT_CUSTOM_PATTERNS:"[]",CLAUDE_MEM_REDACT_LOG_MATCHES:"false",CLAUDE_MEM_REDACT_GENERIC_ENABLED:"false",CLAUDE_MEM_EXCLUDED_PROJECTS:"",CLAUDE_MEM_PROJECT_ENVIRONMENTS:"[]",CLAUDE_MEM_FOLDER_MD_EXCLUDE:"[]",CLAUDE_MEM_FOLDER_MD_SKELETON_DENYLIST:"[]",CLAUDE_MEM_SEMANTIC_INJECT:"false",CLAUDE_MEM_SEMANTIC_INJECT_LIMIT:"5",CLAUDE_MEM_SEMANTIC_INJECT_FORMAT:"narrative",CLAUDE_MEM_TIER_ROUTING_ENABLED:"true",CLAUDE_MEM_TIER_SIMPLE_MODEL:"haiku",CLAUDE_MEM_TIER_SUMMARY_MODEL:"",CLAUDE_MEM_TIER_FAST_MODEL:"haiku",CLAUDE_MEM_TIER_SMART_MODEL:"sonnet",CLAUDE_MEM_CHROMA_ENABLED:"true",CLAUDE_MEM_CHROMA_MODE:"local",CLAUDE_MEM_CHROMA_HOST:"127.0.0.1",CLAUDE_MEM_CHROMA_PORT:"8000",CLAUDE_MEM_CHROMA_SSL:"false",CLAUDE_MEM_CHROMA_API_KEY:"",CLAUDE_MEM_CHROMA_TENANT:"default_tenant",CLAUDE_MEM_CHROMA_DATABASE:"default_database",CLAUDE_MEM_CHROMA_PREWARM_TIMEOUT_MS:"120000",CLAUDE_MEM_CHROMA_MUTATION_TIMEOUT_MS:"600000",CLAUDE_MEM_CHROMA_MAX_PENDING_MUTATIONS:"5000",CLAUDE_MEM_CHROMA_EMBEDDING_FUNCTION:"default",CLAUDE_MEM_SERVER_VECTOR_SEARCH:"auto",CLAUDE_MEM_EMBEDDING_BACKFILL_THREADS:"",CLAUDE_MEM_EMBEDDING_MODEL:"all-MiniLM-L6-v2",CLAUDE_MEM_CHROMA_UVX_PATH:"",CLAUDE_MEM_SEARCH_RECENCY_DAYS:"90",CLAUDE_MEM_CLOUD_SYNC_TOKEN:"",CLAUDE_MEM_CLOUD_SYNC_USER_ID:"",CLAUDE_MEM_CLOUD_SYNC_HUB_URL:"",CLAUDE_MEM_CLOUD_SYNC_DEVICE_ID:"",CLAUDE_MEM_CLOUD_SYNC_DEVICE_NAME:(0,le.hostname)(),CLAUDE_MEM_CLOUD_SYNC_WS:"true",CLAUDE_MEM_CLOUD_SYNC_CONTENT_BATCH_SIZE:"40",CLAUDE_MEM_CLOUD_SYNC_REQUEST_TIMEOUT_MS:"90000",CLAUDE_MEM_LLM_TIMEOUT_MS:String(ws),CLAUDE_MEM_FIELD_OPTIMIZE_TIMEOUT_MS:String(ws),CLAUDE_MEM_LLM_STREAM_IDLE_TIMEOUT_MS:"90000",CLAUDE_MEM_WORKER_HEARTBEAT_STALE_MS:"120000",CLAUDE_MEM_TV_TOKEN:"",CLAUDE_MEM_PRO_PLAN:"",CLAUDE_MEM_PRO_FALLBACK_AT:"",CLAUDE_MEM_PRO_FALLBACK_MESSAGE:"",CLAUDE_MEM_PRO_FALLBACK_ACTION:"",CLAUDE_MEM_PRO_FALLBACK_URL:"",CLAUDE_MEM_PRO_MEMORY_KEY:"",CLAUDE_MEM_PRO_MEMORY_BASE_URL:"",CLAUDE_MEM_PRO_MEMORY_MODEL:"",CLAUDE_MEM_WORK_VIEW_AUTO_REFRESH:"true",CLAUDE_MEM_WORK_VIEW_COPY_PROVIDER:"",CLAUDE_MEM_WORK_VIEW_COPY_MODEL:"",CLAUDE_MEM_BACKUP_ENABLED:"false",CLAUDE_MEM_BACKUP_INTERVAL_HOURS:"24",CLAUDE_MEM_BACKUP_RETAIN_COUNT:"7",CLAUDE_MEM_TELEGRAM_ENABLED:"true",CLAUDE_MEM_TELEGRAM_BOT_TOKEN:"",CLAUDE_MEM_TELEGRAM_CHAT_ID:"",CLAUDE_MEM_TELEGRAM_WRAPUPS_ENABLED:"true",CLAUDE_MEM_TELEGRAM_OBSERVATION_ALERTS_ENABLED:"false",CLAUDE_MEM_TELEGRAM_WRAPUP_ROUTES:"{}",CLAUDE_MEM_TELEGRAM_TRIGGER_TYPES:"security_alert,sensitive",CLAUDE_MEM_TELEGRAM_TRIGGER_CONCEPTS:"",CLAUDE_MEM_GROK_BOT_AWARENESS_ENABLED:"true",CLAUDE_MEM_GROK_BOT_AWARENESS_AGENT_IDS:"521e962d-2ec3-4488-bfbc-54d5209ce118,95601360-61f7-4fd9-bb3a-2c976b2b85c0",CLAUDE_MEM_GROK_BOT_AWARENESS_TRIGGER_TYPES:"decision,bugfix,security_alert,sensitive",CLAUDE_MEM_GROK_BOT_AWARENESS_TRIGGER_CONCEPTS:"",CLAUDE_MEM_GROK_BOT_WEBHOOK_URL:"",CLAUDE_MEM_GROK_BOT_WEBHOOK_SECRET:"",CLAUDE_MEM_NOTION_ENABLED:"false",CLAUDE_MEM_NOTION_TOKEN:"",CLAUDE_MEM_NOTION_DATABASE_ID:"",CLAUDE_MEM_NOTION_AUTO_CREATE_PROPERTIES:"true",CLAUDE_MEM_GROK_BOT_INJECT_ENABLED:"true",CLAUDE_MEM_GROK_BOT_INJECT_AGENT_IDS:"*",CLAUDE_MEM_GROK_BOT_INJECT_TIER:"episode",CLAUDE_MEM_GROK_BOT_INJECT_WINDOW:"80",CLAUDE_MEM_GROK_BOT_INJECT_FALLBACK:"house",CLAUDE_MEM_GROK_BOT_INJECT_PLATFORM_SOURCE:"",CLAUDE_MEM_GROK_BOT_INJECT_PROJECTS_BY_AGENT:"",CLAUDE_MEM_GROK_BOT_INJECT_MAX_LINE_CHARS:"160",CLAUDE_MEM_GROK_BOT_INJECT_DEBOUNCE_MS:"1500",CLAUDE_MEM_GROK_BOT_INJECT_STANDING_LINE:"",CLAUDE_MEM_CCS_ALIGN_ENABLED:"true",CLAUDE_MEM_CCS_ALIGN_VIEWER_IDS:"ccs-align",CLAUDE_MEM_CCS_ALIGN_TRIGGER_TYPES:"decision,bugfix,security_alert,sensitive",CLAUDE_MEM_CCS_ALIGN_PATCH_SHADOWS:"false",CLAUDE_MEM_QUEUE_ENGINE:"sqlite",CLAUDE_MEM_REDIS_URL:"",CLAUDE_MEM_REDIS_HOST:"127.0.0.1",CLAUDE_MEM_REDIS_PORT:"6379",CLAUDE_MEM_REDIS_MODE:"external",CLAUDE_MEM_QUEUE_REDIS_PREFIX:`claude_mem_${process.env.CLAUDE_MEM_WORKER_PORT??String(37700+(process.getuid?.()??77)%100)}`,CLAUDE_MEM_AUTH_MODE:"api-key",CLAUDE_MEM_RUNTIME:"worker",CLAUDE_MEM_SERVER_URL:`http://127.0.0.1:${process.env.CLAUDE_MEM_SERVER_PORT??String(37877+(process.getuid?.()??77)%100)}`,CLAUDE_MEM_SERVER_API_KEY:"",CLAUDE_MEM_SERVER_PROJECT_ID:"",CLAUDE_MEM_SERVER_BETA_URL:`http://127.0.0.1:${process.env.CLAUDE_MEM_SERVER_PORT??String(37877+(process.getuid?.()??77)%100)}`,CLAUDE_MEM_SERVER_BETA_API_KEY:"",CLAUDE_MEM_SERVER_BETA_PROJECT_ID:"",CLAUDE_MEM_DEDUP_ENABLED:"false",CLAUDE_MEM_DEDUP_COSINE_THRESHOLD:"0.80",CLAUDE_MEM_DEDUP_IDF_VETO_DF:"10",CLAUDE_MEM_DEDUP_MIN_SHARED_TOKENS:"2",CLAUDE_MEM_DEDUP_MIN_PROJECT_DOCS:"10",CLAUDE_MEM_DEDUP_MAX_SCAN:"2000",CLAUDE_MEM_DEDUP_MAX_BACKFILL_ROWS:"50000",CLAUDE_MEM_TOOL_USES_RETENTION_DAYS:"0",CLAUDE_MEM_WORKER_AUTOSTART:"true",CLAUDE_MEM_PROJECT_NAME_SOURCE:"path"};static getAllDefaults(){return{...this.DEFAULTS}}static get(e){let t=process.env[e]??this.DEFAULTS[e],s=typeof t=="string"&&this.isVendorEndpoint(t,this.ENDPOINT_KEY.test(e))?this.DEFAULTS[e]:t;return e==="CLAUDE_MEM_WORKER_HOST"?this.normalizeWorkerHost(s):s}static normalizeWorkerHost(e){return e==="localhost"?"127.0.0.1":e}static VENDOR_HOST=/(^|\.)(cmem\.ai|claude-mem\.ai)$/i;static VENDOR_TEXT=/(^|[^a-z0-9-])(cmem|claude-mem)\.ai\.?(?![a-z0-9.-])/i;static ENDPOINT_KEY=/(URLS?|HOSTS?|ORIGINS?|ENDPOINTS?)$/;static isVendorEndpoint(e,t=!0){let s=e.trim();if(s==="")return!1;if(t){let o=s.split(/[\s,]+/).filter(Boolean);if(o.length>1)return o.some(i=>this.isVendorEndpoint(i,t))}try{let o=new URL(s).hostname.replace(/\.+$/,"");if(o!=="")return this.VENDOR_HOST.test(o)}catch{}if(!t)return!1;let r=s;try{r=decodeURIComponent(s)}catch{}return this.VENDOR_TEXT.test(r.normalize("NFKC"))}static dropVendorEndpoints(e){for(let t of Object.keys(e)){let s=e[t];typeof s!="string"||!this.isVendorEndpoint(s,this.ENDPOINT_KEY.test(t))||(console.warn(`[SETTINGS] ${t} named a vendor host; using the default instead`),e[t]=this.DEFAULTS[t])}}static finalizeSettings(e,t){let s=t?this.applyEnvOverrides(e):e;this.dropVendorEndpoints(s),s.CLAUDE_MEM_WORKER_HOST=this.normalizeWorkerHost(s.CLAUDE_MEM_WORKER_HOST);let r=s.CLAUDE_MEM_DATA_DIR?.trim();return r&&s.CLAUDE_MEM_TRANSCRIPTS_CONFIG_PATH===this.DEFAULTS.CLAUDE_MEM_TRANSCRIPTS_CONFIG_PATH&&(s.CLAUDE_MEM_TRANSCRIPTS_CONFIG_PATH=(0,$.join)(te(r),"transcript-watch.json")),s}static getInt(e){let t=this.get(e);return parseInt(t,10)}static applyEnvOverrides(e){let t={...e};for(let s of Object.keys(this.DEFAULTS))process.env[s]!==void 0&&(t[s]=process.env[s]);return t}static loadFromFile(e,t=!0,s={}){try{if(!(0,Y.existsSync)(e)){let u=this.getAllDefaults();if(!s.readOnly)try{X(e,u,{mode:384});for(let p of Fs)Tt(e,p);console.warn("[SETTINGS] Created settings file with defaults:",e)}catch(p){console.warn("[SETTINGS] Failed to create settings file, using in-memory defaults:",e,p instanceof Error?p.message:String(p))}return this.finalizeSettings(u,t)}let r=(0,Y.readFileSync)(e,"utf-8"),o=Qe(r),i=ee(o),a=i!==o,_=Ft(o),d=a&&Object.keys(_).some(u=>u!=="env");if(a&&!d&&!s.readOnly)try{X(e,i,{mode:384}),console.warn("[SETTINGS] Migrated settings file from nested to flat schema:",e)}catch(u){console.warn("[SETTINGS] Failed to auto-migrate settings file:",e,u instanceof Error?u.message:String(u))}if(i.CLAUDE_MEM_TELEGRAM_TRIGGER_TYPES===Vr&&(i={...i,CLAUDE_MEM_TELEGRAM_TRIGGER_TYPES:this.DEFAULTS.CLAUDE_MEM_TELEGRAM_TRIGGER_TYPES},!s.readOnly))try{X(e,d?{..._,env:i}:i,{mode:384}),console.warn("[SETTINGS] Migrated Telegram trigger types off the legacy default:",e)}catch(u){console.warn("[SETTINGS] Failed to migrate Telegram trigger types:",e,u instanceof Error?u.message:String(u))}if(Qr(i)){let u=String(i.CLAUDE_MEM_OPENROUTER_MODEL).trim();if(i={...i,CLAUDE_MEM_OPENROUTER_MODEL:this.DEFAULTS.CLAUDE_MEM_OPENROUTER_MODEL},!s.readOnly)try{X(e,d?{..._,env:i}:i,{mode:384}),console.warn(`[SETTINGS] Migrated OpenRouter model off the retired default ${u} to ${this.DEFAULTS.CLAUDE_MEM_OPENROUTER_MODEL}:`,e)}catch(p){console.warn("[SETTINGS] Failed to migrate the retired OpenRouter model:",e,p instanceof Error?p.message:String(p))}}let E=Zr(i.CLAUDE_MEM_CLOUD_SYNC_HUB_URL);if(E!==null&&(i={...i,CLAUDE_MEM_CLOUD_SYNC_HUB_URL:E},!s.readOnly))try{X(e,d?{..._,env:i}:i,{mode:384}),console.warn("[SETTINGS] Migrated cloud sync hub URL to",E,"from a retired hub host:",e)}catch(u){console.warn("[SETTINGS] Failed to migrate cloud sync hub URL:",e,u instanceof Error?u.message:String(u))}for(let u of Fs)if(!(0,Y.existsSync)(ks(e,u))){if(i[u.key]!==u.legacy){s.readOnly||Tt(e,u);continue}if(i={...i,[u.key]:this.DEFAULTS[u.key]},!s.readOnly)try{X(e,d?{..._,env:i}:i,{mode:384}),Tt(e,u),console.warn(`[SETTINGS] Migrated ${u.key} off the old ${u.legacy}ms default to ${this.DEFAULTS[u.key]}ms:`,e)}catch(p){let m=`${u.key}\0${e}`;xs.has(m)||(xs.add(m),console.warn(`[SETTINGS] Failed to migrate ${u.key}; using the new default in memory (reported once per process):`,e,p instanceof Error?p.message:String(p)))}}let c={...this.DEFAULTS};for(let u of Object.keys(this.DEFAULTS))i[u]!==void 0&&(c[u]=zr(i[u]));return this.finalizeSettings(c,t)}catch(r){console.warn("[SETTINGS] Failed to load settings, using defaults:",e,r instanceof Error?r.message:String(r));let o=this.getAllDefaults();return this.finalizeSettings(o,t)}}};var Gs=require("crypto");function pe(n){let e=(n??"").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]/gu," ").replace(/\s+/g," ").trim();return/[\p{L}\p{N}]/u.test(e)?e:""}function K(n){return(n??"").toLowerCase().trim().split(/\s+/).filter(Boolean)}function St(n,e){return Math.log(1+e/(n+.5))}function Ps(n,e){return t=>St(n(t),e)}function Bs(n,e){let t=new Map;for(let s of new Set(n))t.set(s,e(s));return t}function $s(n,e,t){let s=Bs(n,t),r=Bs(e,t),o=0,i=0,a=0;for(let[_,d]of s){i+=d*d;let E=r.get(_);E!==void 0&&(o+=d*E)}for(let[,_]of r)a+=_*_;return i===0||a===0?0:o/Math.sqrt(i*a)}function Hs(n,e,t,s){let r=new Set(n),o=new Set(e);for(let i of r)if(!o.has(i)&&t(i)>s)return!0;for(let i of o)if(!r.has(i)&&t(i)>s)return!0;return!1}function ft(n,e,t,s){let r=pe(n);if(r!==""&&r===pe(e))return{tier:"exact",method:"exact",score:1};let o=K(n),i=K(e),a=s.minSharedTokens??2,_=new Set(i),d=0;for(let c of new Set(o))_.has(c)&&d++;if(d<a)return{tier:"none",method:"none",score:0};let E=$s(o,i,t);return E>=s.cosineThreshold&&!Hs(o,i,t,s.vetoThetaIdf)?{tier:"candidate",method:"idf_cosine",score:E}:{tier:"none",method:"none",score:E}}function me(n,e){return!!n&&!!e}function ke(n,e,t,s=!1){let r=pe(t);if(r==="")return null;let o=b(e),i=s?"subagent":"main";return(0,Gs.createHash)("sha256").update(`${n}\0${o}\0${i}\0${r}`).digest("hex").slice(0,32)}function Xs(n,e,t){return t===null?null:n.prepare("SELECT id, occurrence_count, created_at_epoch FROM observations WHERE project = ? AND title_norm_key = ? ORDER BY created_at_epoch ASC, id ASC LIMIT 1").get(e,t)??null}function js(n,e,t){let s=[...new Set(K(t))],r=n.prepare("INSERT INTO token_df (project, token, df) VALUES (?, ?, 1) ON CONFLICT(project, token) DO UPDATE SET df = df + 1");for(let o of s)r.run(e,o);n.prepare("INSERT INTO dedup_meta (project, doc_count) VALUES (?, 1) ON CONFLICT(project) DO UPDATE SET doc_count = doc_count + 1").run(e)}function Ws(n,e){return St(n+1,e)}function Ys(n,e){return n.prepare("SELECT doc_count FROM dedup_meta WHERE project = ?").get(e)?.doc_count??0}function Ks(n,e){let t=Ys(n,e),s=n.prepare("SELECT token, df FROM token_df WHERE project = ?").all(e),r=new Map(s.map(o=>[o.token,o.df]));return{idfFn:Ps(o=>r.get(o)??0,t),docCount:t}}function qs(n){return n.prepare("INSERT OR IGNORE INTO observation_dedup_candidates (observation_id, duplicate_of_id, project, method, score, status, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")}function Vs(n,e,t){return Ys(n,e)>=t}function eo(n,e,t=Number.POSITIVE_INFINITY){let s=n.prepare("SELECT COUNT(*) c FROM observations WHERE project = ?").get(e).c;if(s>t)return l.warn("DEDUP",`Skipping dedup backfill for project ${e}: ${s} rows exceeds cap ${t} (CLAUDE_MEM_DEDUP_MAX_BACKFILL_ROWS)`),0;let r=n.prepare("SELECT o.id, o.title, o.agent_id, o.agent_type, s.platform_source FROM observations o LEFT JOIN sdk_sessions s ON s.memory_session_id = o.memory_session_id WHERE o.project = ?").all(e),o=n.prepare("UPDATE observations SET title_norm_key = ? WHERE id = ?"),i=n.prepare("INSERT INTO token_df (project, token, df) VALUES (?, ?, ?)");return n.transaction(()=>{let _=new Map;for(let d of r){o.run(ke(e,d.platform_source,d.title,me(d.agent_id,d.agent_type)),d.id);for(let E of new Set(K(d.title)))_.set(E,(_.get(E)??0)+1)}n.prepare("DELETE FROM token_df WHERE project = ?").run(e);for(let[d,E]of _)i.run(e,d,E);n.prepare("INSERT INTO dedup_meta (project, doc_count, last_rebuild_doc_count, deleted_since_rebuild) VALUES (?, ?, ?, 0) ON CONFLICT(project) DO UPDATE SET doc_count = excluded.doc_count, last_rebuild_doc_count = excluded.last_rebuild_doc_count, deleted_since_rebuild = 0").run(e,r.length,r.length)})(),r.length}function to(n,e,t){let s=n.prepare("SELECT id, title FROM observations WHERE project = ? AND title IS NOT NULL ORDER BY id ASC").all(e);if(s.length<2)return 0;if(s.length>t.maxBackfillRows)return l.warn("DEDUP",`Skipping dedup sweep for project ${e}: ${s.length} rows exceeds cap ${t.maxBackfillRows}`),0;let{idfFn:r,docCount:o}=Ks(n,e),i={cosineThreshold:t.cosineThreshold,vetoThetaIdf:Ws(t.idfVetoDf,o),minSharedTokens:t.minSharedTokens},a=s.map(f=>new Set(K(f.title))),_=new Map;for(let f of a)for(let N of f)_.set(N,(_.get(N)??0)+1);let d=Math.max(2,Math.ceil(Math.sqrt(s.length))*4),E=new Map;a.forEach((f,N)=>{for(let R of f){let T=_.get(R);if(T<2||T>d)continue;let D=E.get(R);D||(D=[],E.set(R,D)),D.push(N)}});let c=new Map;for(let f of E.values())for(let N=0;N<f.length;N++)for(let R=N+1;R<f.length;R++){let T=`${f[N]}:${f[R]}`;c.set(T,(c.get(T)??0)+1)}let u=qs(n),p=new Date().toISOString(),m=Date.now(),g=0;for(let[f,N]of c){if(N<t.minSharedTokens)continue;let[R,T]=f.split(":").map(Number),D=ft(s[R].title,s[T].title,r,i);D.tier==="candidate"&&(g+=u.run(s[T].id,s[R].id,e,D.method,D.score,"pending",p,m).changes)}return g}function Js(n,e){return n.prepare("SELECT DISTINCT project FROM observations").all().map(s=>s.project).map(s=>{let r=eo(n,s,e.maxBackfillRows),o=to(n,s,e);return{project:s,docs:r,candidates:o}})}function zs(n,e,t,s,r){if(!s)return 0;let{idfFn:o,docCount:i}=Ks(n,e),a={cosineThreshold:r.cosineThreshold,vetoThetaIdf:Ws(r.idfVetoDf,i),minSharedTokens:r.minSharedTokens},_=n.prepare("SELECT id, title FROM observations WHERE project = ? AND id != ? AND title IS NOT NULL ORDER BY created_at_epoch DESC, id DESC LIMIT ?").all(e,t,r.maxScan);_.length===r.maxScan&&l.debug("DEDUP",`Tier-1 scan hit MAX_SCAN=${r.maxScan} for project ${e}; older rows covered by dedup-scan`);let d=qs(n),E=new Date().toISOString(),c=Date.now(),u=0;for(let p of _){let m=ft(s,p.title,o,a);m.tier==="candidate"&&(u+=d.run(t,p.id,e,m.method,m.score,"pending",E,c).changes)}return u}function Qs(n,e,t,s,r){let o=Date.now()-s,i=r!==void 0?"up.session_db_id = ?":"up.content_session_id = ?",a=r??e;return n.prepare(`
    SELECT
      up.*,
      s.memory_session_id,
      s.project,
      COALESCE(s.platform_source, '${A}') as platform_source
    FROM user_prompts up
    JOIN sdk_sessions s ON up.session_db_id = s.id
    WHERE ${i}
      AND up.prompt_text = ?
      AND up.created_at_epoch >= ?
    ORDER BY up.created_at_epoch DESC
    LIMIT 1
  `).get(a,t,o)??void 0}var He=require("fs");var fe=String.raw`[A-Za-z0-9_.\-+/=~@#$%^*!?]`,q=`(?=${fe}{8})${fe}*[A-Za-z]${fe}*`,V=String.raw`(?:\\{0,3}["'])?`,H=String.raw`\s{0,8}`;function Zs(n){return new RegExp(`${n}${q}`,"gi")}function $e(n){return`(?<=${n}${V}${H}[=:]${H}${V})`}var Pe=String.raw`(?:token|secret|api_key)`,Be=String.raw`\\{0,3}["']`,At=String.raw`(?<!\\)"`,so=String.raw`(?:^|[\s?&]|\\[nrt]|${At})`,no=String.raw`(?:^|\n|\\n|${At})[ \t]{0,8}(?:-[ \t]{1,8})?`,ro=String.raw`(?:${Be})?[ \t]{0,8}(?:$|\r?\n|\\{1,3}[rn]|#|${At})`,oo=new RegExp([`${$e(String.raw`\b\w*_${Pe}`)}${q}`,`(?<=${Be}${Pe}${Be}${H}:${H}${Be})${q}`,`(?<=${so}${Pe}=${V})${q}(?!\\(|${fe})`,String.raw`(?<=--(?:token|secret|api[-_]key)(?:=|[ \t]{1,8})${V})${q}`,`(?<=${no}${Pe}:[ \\t]{1,8}${V})${q}(?=${ro})`].join("|"),"gi"),io=[{name:"aws_access_key",regex:/(?:AKIA|ASIA)[0-9A-Z]{16}/g},{name:"aws_secret_key",regex:new RegExp(`${$e(String.raw`(?:aws_secret_access_key|\bSecretAccessKey)`)}[A-Za-z0-9/+=]{40}`,"gi")},{name:"aws_session_token",regex:new RegExp(`${$e(String.raw`\b(?:aws_session_token|SessionToken)`)}[A-Za-z0-9/+=]{100,}`,"gi")},{name:"github_pat",regex:/\bgh[oprsu]_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{82}\b/g},{name:"openai_key",regex:/\bsk-(?!ant-)[A-Za-z0-9_-]{20,}(?!\w)/g},{name:"anthropic_key",regex:/\bsk-ant-[A-Za-z0-9_-]{20,}(?!\w)/g},{name:"slack_token",regex:/\b(?:xox[abeprs]|xapp)-[A-Za-z0-9-]{10,}(?!\w)/g},{name:"jwt",regex:/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?!\w)/g},{name:"private_key_pem",regex:/-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g},{name:"stripe_key",regex:/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g},{name:"google_api_key",regex:/\bAIza[0-9A-Za-z_-]{35}(?!\w)/g},{name:"claude_mem_key",regex:/\bcmem_[A-Za-z0-9_-]{32,}|\bcm_pro_[A-Za-z0-9_-]{8,}/g}],ao=[{name:"generic_password",regex:Zs($e(String.raw`\b(?:\w*_?(?:password|passwd)|\w+_pwd)`))},{name:"generic_token",regex:oo},{name:"bearer_token",regex:Zs(`(?<=\\bAuthorization${V}${H}:${H}${V}Bearer${H})`)}],_o=1024*1024,Eo="<redacted type='oversize'/>";function sn(n,e){if(!e.enabled||n.length===0)return{redacted:n,counts:{},oversize:!1};if(n.length>_o)return l.warn("REDACT","field exceeds the 1M-char redaction cap; replaced by an oversize marker",void 0,{inputLength:n.length}),{redacted:Eo,counts:{oversize:1},oversize:!0};let t=new Set(e.disabledBuiltinPatterns??[]),s={},r=n,o=[];for(let a of e.customPatterns??[]){if(!a.name||a.name.length===0){l.warn("REDACT","custom pattern skipped: missing name",void 0,{pattern:a});continue}try{o.push({name:a.name,regex:new RegExp(a.regex,"g")})}catch(_){l.warn("REDACT","custom pattern skipped: invalid regex",{name:a.name},_ instanceof Error?_:new Error(String(_)))}}let i=[...o,...io,...e.genericEnabled?ao:[]];for(let a of i)t.has(a.name)||(a.regex.lastIndex=0,r=r.replace(a.regex,()=>(s[a.name]=(s[a.name]??0)+1,`<redacted type='${a.name}'/>`)));return e.logMatches&&Object.keys(s).length>0&&l.debug("REDACT","patterns matched",void 0,{counts:s}),{redacted:r,counts:s,oversize:!1}}function co(n){if(!n||n.trim()==="")return[];try{let e=JSON.parse(n);return Array.isArray(e)?e.filter(t=>t&&typeof t.name=="string"&&typeof t.regex=="string"):(l.warn("REDACT","CLAUDE_MEM_REDACT_CUSTOM_PATTERNS is not a JSON array, ignoring"),[])}catch(e){return l.warn("REDACT","failed to parse CLAUDE_MEM_REDACT_CUSTOM_PATTERNS as JSON",void 0,e instanceof Error?e:new Error(String(e))),[]}}function uo(n){return{enabled:n.CLAUDE_MEM_REDACT_ENABLED==="true",disabledBuiltinPatterns:(n.CLAUDE_MEM_REDACT_DISABLED_BUILTINS??"").split(",").map(e=>e.trim()).filter(Boolean),customPatterns:co(n.CLAUDE_MEM_REDACT_CUSTOM_PATTERNS??"[]"),logMatches:n.CLAUDE_MEM_REDACT_LOG_MATCHES==="true",genericEnabled:n.CLAUDE_MEM_REDACT_GENERIC_ENABLED==="true"}}var Te=null,en=0,lo=5e3,Se=null,tn=!1,po={enabled:!0,disabledBuiltinPatterns:[],customPatterns:[],logMatches:!1},mo=/"CLAUDE_MEM_REDACT_ENABLED"\s*:\s*"true"/;function To(n){if(!(0,He.existsSync)(n))return null;try{return(0,He.readFileSync)(n,"utf-8")}catch{return""}}function So(n){if(n===null)return!1;try{let e=JSON.parse(ze(n));return e===null||typeof e!="object"||Array.isArray(e)}catch{return!0}}function fo(n,e,t){return process.env.CLAUDE_MEM_REDACT_ENABLED==="false"||!(Se?.enabled===!0||mo.test(e))?t:(tn||(tn=!0,l.warn("REDACT","settings.json could not be read; secret redaction stays on until it is repaired",{settingsPath:n,using:Se?.enabled?"the last configuration that loaded":"the built-in patterns"})),Se?.enabled?Se:po)}function nn(n=Le){let e=Date.now();if(Te&&e-en<lo)return Te;let t=ne.loadFromFile(n),s=uo(t),r=s.enabled?null:To(n);return So(r)?Te=fo(n,r,s):(Te=s,Se=s),en=e,Te}var Ra=new RegExp(`^${fe}{8,}$`);var Na=new RegExp(`^(${H}Bearer${H})${q}`,"i");var _n=["private","claude-mem-context","system_instruction","system-instruction","persisted-output","system-reminder"],Ao=new Set(_n),rn=/<([A-Za-z_][A-Za-z0-9_-]*)/y,on=/<\/([A-Za-z_][A-Za-z0-9_-]*)\s*>/y;function go(n){let e=Object.fromEntries(_n.map(E=>[E,0]));if(!n.includes("<"))return{text:n,counts:e,total:0};let t=n.length,s=new Int32Array(t+1);s[t]=t;for(let E=t-1;E>=0;E--)s[E]=n.charCodeAt(E)===62?E:s[E+1];let r=new Map,o=[],i=0,a=0;for(;a<t;){if(n.charCodeAt(a)!==60){a+=1;continue}on.lastIndex=a;let E=on.exec(n);if(E){let u=E[1],p=r.get(u),m=p&&p.head<p.items.length?p.items[p.head]:void 0;m&&a>=m.attrEnd&&(p.head+=1,o.push([m.start,a+E[0].length]),e[u]+=1,i+=1),a+=E[0].length;continue}rn.lastIndex=a;let c=rn.exec(n);if(c&&Ao.has(c[1])){let u=c[1],p=a+c[0].length,m={start:a,attrEnd:s[p]},g=r.get(u);g?g.items.push(m):r.set(u,{items:[m],head:0}),a=p;continue}a+=1}o.sort((E,c)=>E[0]-c[0]);let _="",d=0;for(let[E,c]of o)E>d&&(_+=n.slice(d,E)),c>d&&(d=c);return _+=n.slice(d),{text:_,counts:e,total:i}}var an=100;function Oo(n){return Ro(n,go(n))}function Ro(n,{text:e,counts:t,total:s}){return s>an&&l.warn("SYSTEM","tag count exceeds limit",void 0,{tagCount:s,maxAllowed:an,contentLength:n.length}),{stripped:sn(e.trim(),nn()).redacted,counts:t}}function Ge(n){return Oo(n).stripped}var No=["task-notification"],Ca=new RegExp(`^\\s*<(${No.join("|")})\\b[^>]*>(?:(?!<\\1\\b|</\\1\\b)[\\s\\S])*</\\1>\\s*$`),Ia=256*1024;var gt=4e3,Ot="[media prompt]";function J(n){let e=Ge(n).trim();return e.length<=gt?e:(l.debug("DB","Truncated stored prompt text to the configured cap",{originalLength:e.length,storedLength:gt}),`${e.slice(0,gt-1)}\u2026`)}var dn=5e3,bo=4194304,oe=68;function En(n){return n.prepare("PRAGMA user_version").get().user_version}var Ae=class extends Error{reason="schema_newer_than_binary";constructor(e){super(e),this.name="SchemaNewerThanBinaryError"}};function ge(n,e){n.run(`PRAGMA busy_timeout = ${dn}`);let t=En(n);if(!(t<=e))throw new Ae(`SQLite database has schema v${t}; this claude-mem knows up to schema v${e}. Upgrade claude-mem before opening this database.`)}function Rt(n,e){ge(n,e),En(n)<e&&n.run(`PRAGMA user_version = ${e}`)}function cn(n,e){n.transaction(()=>Rt(n,e)).immediate()}function ho(n){return n.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    LIMIT 1
  `).get()!=null}function re(n,e,t){try{n.run(e)}catch(s){let r=s instanceof Error?s:new Error(String(s));throw l.warn("DB",`Failed to apply SQLite pragma ${t}`,{sql:e},r),s}}function Xe(n,e={}){let{enableWal:t=!0,enableIncrementalAutoVacuum:s=!0}=e;re(n,`PRAGMA busy_timeout = ${dn}`,"busy_timeout"),re(n,"PRAGMA foreign_keys = ON","foreign_keys"),re(n,"PRAGMA synchronous = NORMAL","synchronous"),re(n,`PRAGMA journal_size_limit = ${bo}`,"journal_size_limit"),s&&!ho(n)&&re(n,"PRAGMA auto_vacuum = INCREMENTAL","auto_vacuum"),t&&re(n,"PRAGMA journal_mode = WAL","journal_mode")}var un=!1;function je(n,...e){let t=P();return ln(t,n,e)}function ln(n,e,t){if(typeof e.iterate=="function"){let s=e.iterate;return jt(n,()=>s.apply(e,t))}return un||(un=!0,l.warn("DB","bun:sqlite lacks Statement.iterate(); falling back to .all()",{bunVersion:typeof Bun<"u"?Bun.version:"unknown",requiredBunVersion:">=1.1.31",impact:"rows are materialized in memory; upgrade Bun to restore streaming"})),e.all(...t)}function Nt(n,e,t,s){let r=P();try{let o=Number(s.limit);if(!Number.isInteger(o)||o<0)throw new Error("Page limit must be a non-negative integer");let i=Number(s.offset??0);if(!Number.isInteger(i))throw new Error("Page offset must be an integer");let a=[];if(o===0)return a;let _=Math.max(0,i);for(let d of ln(r,n,e))if(t(d)){if(_>0){_--;continue}if(a.push(d),a.length===o)break}return a}finally{n.finalize()}}function ie(n){return n.replace(/\\/g,"/").replace(/\/+/g,"/").replace(/\/+$/,"")}function bt(n,e){let t=ie(n),s=ie(e);if(t.startsWith(s+"/"))return!t.slice(s.length+1).includes("/");let r=s.split("/"),o=t.split("/");if(o.length<2)return s===""||s===".";let i=o.slice(0,-1).join("/"),a=o[o.length-1],_=/^([A-Za-z]:)?\//;if(!_.test(s)&&_.test(t)&&s!==""&&i.endsWith("/"+s))return a!=="";if(s.endsWith("/"+i)||s===i)return!a.includes("/");for(let d=0;d<r.length;d++)if(r.slice(d).join("/")===i)return!0;return!1}var We=class extends Error{constructor(t,s=500,r,o){super(t);this.statusCode=s;this.code=r;this.details=o;this.name="AppError"}statusCode;code;details};var Lo=/^\d{4}-\d{2}-\d{2}$/,Co=/^(\d{4})-(\d{2})-(\d{2})/,Io=1440*60*1e3;function z(n,e){if(typeof n=="number")return pn(n,n,e);let t=n.trim(),s=Do(t)?new Date(t).getTime():Number.NaN,r=pn(s,n,e);return e==="end"&&Lo.test(t)?r+Io-1:r}function Do(n){let e=Co.exec(n);if(!e)return!0;let[t,s,r]=e.slice(1).map(Number),o=new Date(0);return o.setUTCFullYear(t,s-1,r),o.getUTCFullYear()===t&&o.getUTCMonth()===s-1&&o.getUTCDate()===r}function pn(n,e,t){if(Number.isNaN(n))throw new We(`Invalid date for the ${t} of the range: ${JSON.stringify(e)}. Use an ISO date such as 2025-01-31 or 2025-01-31T08:00:00Z.`,400,"INVALID_DATE");return n}var ht="\\u0E00-\\u0EFF\\u1000-\\u109F\\u1780-\\u17FF\\u3040-\\u30FF\\u3100-\\u318F\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uAC00-\\uD7AF\\uF900-\\uFAFF",mn=["observations_ai","observations_ad","observations_au"],Tn=["session_summaries_ai","session_summaries_ad","session_summaries_au"],Oe=`
  CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
    INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
    VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
  END;

  CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
    VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
  END;

  CREATE TRIGGER IF NOT EXISTS observations_au
  AFTER UPDATE OF title, subtitle, narrative, text, facts, concepts ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
    VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
    INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
    VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
  END;
`,Re=`
  CREATE TRIGGER IF NOT EXISTS session_summaries_ai AFTER INSERT ON session_summaries BEGIN
    INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
    VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
  END;

  CREATE TRIGGER IF NOT EXISTS session_summaries_ad AFTER DELETE ON session_summaries BEGIN
    INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
    VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
  END;

  CREATE TRIGGER IF NOT EXISTS session_summaries_au
  AFTER UPDATE OF request, investigated, learned, completed, next_steps, notes ON session_summaries BEGIN
    INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
    VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
    INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
    VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
  END;
`,Sn=class n{db;constructor(e=Ce,t={}){typeof e=="string"&&Ie(M),this.db=we(e),ge(this.db,oe),t.readOnly||Xe(this.db),this._fts5Available=this.isFts5Available(),t.readOnly||this.ensureFTSTables()}_fts5Available;ensureFTSTables(){let e=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts'").all(),t=e.some(o=>o.name==="observations_fts"),s=e.some(o=>o.name==="session_summaries_fts");if(t&&s&&this.hasAllFtsTriggers(mn)&&this.hasAllFtsTriggers(Tn))return;if(!this.isFts5Available()){l.warn("DB","FTS5 not available on this platform \u2014 skipping FTS table creation (search uses ChromaDB)");return}let r=t&&s;l.info("DB",r?"Converging FTS5 indexes and recreating missing sync triggers":"Creating FTS5 tables");try{this.db.transaction(()=>{Rt(this.db,oe);let o=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts'").all(),i=!o.some(E=>E.name==="observations_fts"),a=!o.some(E=>E.name==="session_summaries_fts"),_=!i&&!this.hasAllFtsTriggers(mn),d=!a&&!this.hasAllFtsTriggers(Tn);this.createFTSTablesAndTriggers(i,a),_&&(this.rebuildFtsIndex("observations_fts"),this.db.run(Oe)),d&&(this.rebuildFtsIndex("session_summaries_fts"),this.db.run(Re))}).immediate(),l.info("DB",r?"FTS5 indexes converged and sync triggers recreated":"FTS5 tables created successfully")}catch(o){if(o instanceof Ae)throw o;this._fts5Available=!1,l.warn("DB","FTS5 table creation failed \u2014 search will use ChromaDB and LIKE queries",{},o instanceof Error?o:void 0)}}hasAllFtsTriggers(e){let t=e.map(()=>"?").join(", ");return this.db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name IN (${t})`).all(...e).length===e.length}rebuildFtsIndex(e){this.db.run(`INSERT INTO ${e}(${e}) VALUES('rebuild')`)}isFts5Available(){try{return this.db.run("CREATE VIRTUAL TABLE temp._fts5_probe USING fts5(test_column)"),this.db.run("DROP TABLE temp._fts5_probe"),!0}catch(e){return l.debug("DB","FTS5 probe failed \u2014 FTS5 unavailable on this platform",void 0,e instanceof Error?e:new Error(String(e))),!1}}canReadFtsIndex(e){try{return this.db.prepare(`SELECT rowid FROM ${e} WHERE ${e} MATCH ? LIMIT 0`).all('"fts_read_probe"'),!0}catch{return!1}}createFTSTablesAndTriggers(e,t){e&&(this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
          title,
          subtitle,
          narrative,
          text,
          facts,
          concepts,
          content='observations',
          content_rowid='id'
        );
      `),this.db.run(`
        INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
        SELECT id, title, subtitle, narrative, text, facts, concepts
        FROM observations;
      `),this.db.run(Oe)),t&&(this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS session_summaries_fts USING fts5(
          request,
          investigated,
          learned,
          completed,
          next_steps,
          notes,
          content='session_summaries',
          content_rowid='id'
        );
      `),this.db.run(`
        INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
        SELECT id, request, investigated, learned, completed, next_steps, notes
        FROM session_summaries;
      `),this.db.run(Re))}buildFilterClause(e,t,s="o"){let r=[],o=x(e);if(o.length>0){let i=B(s,o,{includeMerged:!0});r.push(i.sql),t.push(...i.params)}if(e.platformSource&&(r.push(`COALESCE(NULLIF((SELECT s2.platform_source FROM sdk_sessions s2 WHERE s2.memory_session_id = ${s}.memory_session_id), ''), '${A}') = ?`),t.push(b(e.platformSource))),e.type)if(Array.isArray(e.type)){let i=e.type.map(()=>"?").join(",");r.push(`${s}.type IN (${i})`),t.push(...e.type)}else r.push(`${s}.type = ?`),t.push(e.type);if(e.dateRange){let{start:i,end:a}=e.dateRange;i&&(r.push(`${s}.created_at_epoch >= ?`),t.push(z(i,"start"))),a&&(r.push(`${s}.created_at_epoch <= ?`),t.push(z(a,"end")))}if(e.concepts){let i=Array.isArray(e.concepts)?e.concepts:[e.concepts],a=`${s}.concepts`,_=`CASE WHEN json_valid(${a}) THEN CASE
        WHEN json_type(${a}) = 'array' THEN ${a}
        WHEN json_type(${a}) = 'text' THEN json_array(json_extract(${a}, '$'))
        ELSE json_array(${a}) END ELSE json_array(${a}) END`,d=i.map(()=>`EXISTS (SELECT 1 FROM json_each(${_}) WHERE type = 'text' AND value = ?)`);d.length>0&&(r.push(`(${d.join(" OR ")})`),t.push(...i))}if(e.files){let i=Array.isArray(e.files)?e.files:[e.files],a=s==="s"?"files_edited":"files_modified",_=i.map(()=>`(
          EXISTS (SELECT 1 FROM json_each(${n.fileArrayJson(`${s}.files_read`)}) WHERE type = 'text' AND value LIKE ? ESCAPE '\\')
          OR EXISTS (SELECT 1 FROM json_each(${n.fileArrayJson(`${s}.${a}`)}) WHERE type = 'text' AND value LIKE ? ESCAPE '\\')
        )`);_.length>0&&(r.push(`(${_.join(" OR ")})`),i.forEach(d=>{let E=d.replace(/[\\%_]/g,"\\$&");t.push(`%${E}%`,`%${E}%`)}))}return r.length>0?r.join(" AND "):""}static UNSEGMENTED_SCRIPT=new RegExp(`[${ht}]`);static UNSEGMENTED_RUN=new RegExp(`[${ht}]+|[^\\s${ht}]+`,"g");static MAX_SUBSTRING_TERMS=500;static buildSubstringClause(e,t){let s=[...new Set(e.match(n.UNSEGMENTED_RUN)??[])].slice(0,n.MAX_SUBSTRING_TERMS);s.length===0&&s.push(e);let r=[];return{clause:`(${s.map(i=>{let a=`%${i.replace(/[\\%_]/g,"\\$&")}%`;for(let _=0;_<t.length;_+=1)r.push(a);return`(${t.map(_=>`${_} LIKE ? ESCAPE '\\'`).join(" OR ")})`}).join(" AND ")})`,params:r}}static MIN_ANY_TERM_TOKENS=3;static buildFTSMatchQuery(e){let t=(e.match(/\S+/g)??[]).filter(s=>/[\p{L}\p{N}]/u.test(s));return t.length===0?`"${e.replace(/"/g,'""')}"`:t.map(s=>`"${s.replace(/"/g,'""')}"`).join(" AND ")}buildFTSAnyTermQuery(e,t){let s=(e.match(/\S+/g)??[]).filter(a=>/[\p{L}\p{N}]/u.test(a));if(s.length<n.MIN_ANY_TERM_TOKENS)return null;let r=this.termDocFrequency(t),o=[...e].length,i;return r?o<n.ANY_TERM_SHORT_PROMPT_CHARS?i=n.pickRareTokens(s,r,n.ANY_TERM_SHORT_PROMPT_CAP):o<n.ANY_TERM_MEDIUM_PROMPT_CHARS?i=n.pickRareTokens(s,r,n.ANY_TERM_MEDIUM_PROMPT_CAP):i=n.pickRareWords(e,r):i=n.dedupeTokens(s).slice(0,n.ANY_TERM_LONG_PROMPT_CAP),i.length===0?null:i.map(a=>`"${a.replace(/"/g,'""')}"`).join(" OR ")}static ANY_TERM_SHORT_PROMPT_CHARS=200;static ANY_TERM_MEDIUM_PROMPT_CHARS=600;static ANY_TERM_SHORT_PROMPT_CAP=40;static ANY_TERM_MEDIUM_PROMPT_CAP=60;static ANY_TERM_LONG_PROMPT_CAP=40;static ANY_TERM_COMMON_SHARE=.3;static ANY_TERM_MATCHING_DOCUMENT_BUDGET=1024;static ANY_TERM_LONG_PROMPT_MAX_SHARE=.02;static ANY_TERM_LONG_PROMPT_MIN_WORD_CHARS=3;static ANY_TERM_CONTENT_TABLES={observations_fts:"observations",session_summaries_fts:"session_summaries"};vocabLookups=new Map;termDocFrequency(e){if(!this.vocabLookups.has(e)){let s=null;try{this.db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS temp.${e}_vocab USING fts5vocab(main, '${e}', 'row')`),s=this.db.prepare(`SELECT doc FROM temp.${e}_vocab WHERE term = ?`)}catch(r){l.debug("DB","FTS5 vocabulary unavailable; any-term queries are capped without frequencies",{ftsTable:e},r instanceof Error?r:void 0)}this.vocabLookups.set(e,s)}let t=this.vocabLookups.get(e);if(!t)return null;try{let s=n.ANY_TERM_CONTENT_TABLES[e],r=this.db.prepare(`SELECT count(*) AS n FROM ${s}`).get().n,o=new Map;return{rows:a=>{let _=a.toLowerCase().normalize("NFD").replace(new RegExp("\\p{Mn}","gu"),""),d=o.get(_);return d===void 0&&(d=t.get(_)?.doc??0,o.set(_,d)),d},total:r}}catch(s){return l.debug("DB","FTS5 vocabulary lookup failed; any-term queries are capped without frequencies",{ftsTable:e},s instanceof Error?s:void 0),this.vocabLookups.set(e,null),null}}static tokenRows(e,t){let s=e.match(/[\p{L}\p{N}]+/gu)??[];return s.length===0?0:Math.min(...s.map(r=>t.rows(r)))}static commonRowLimit(e,t){return Math.max(e*t,2)}static dedupeTokens(e){let t=new Set;return e.filter(s=>{let r=s.toLowerCase();return t.has(r)?!1:(t.add(r),!0)})}static pickRareTokens(e,t,s){let r=n.commonRowLimit(t.total,n.ANY_TERM_COMMON_SHARE),o=n.dedupeTokens(e),i=o.filter(c=>n.tokenRows(c,t)<r),a=i.length<=s?i:i.map(c=>({token:c,rows:n.tokenRows(c,t)})).sort((c,u)=>c.rows-u.rows).slice(0,s).map(c=>c.token);if(a.some(c=>n.tokenRows(c,t)>0))return a;let _=[...a],d=0,E=o.map(c=>({token:c,rows:n.tokenRows(c,t)})).filter(c=>c.rows>=r).sort((c,u)=>c.rows-u.rows);for(let{token:c,rows:u}of E){if(_.length===s)break;let p=/[^\x00-\x7F]/.test(c)?t.total:u;d+p>n.ANY_TERM_MATCHING_DOCUMENT_BUDGET||(_.push(c),d+=p)}return _}static pickRareWords(e,t){let s=n.commonRowLimit(t.total,n.ANY_TERM_LONG_PROMPT_MAX_SHARE),r=new Set((e.match(/[\p{L}\p{N}]+/gu)??[]).filter(i=>[...i].length>=n.ANY_TERM_LONG_PROMPT_MIN_WORD_CHARS).map(i=>i.toLowerCase())),o=[];for(let i of r){let a=t.rows(i);if(a>0&&a<s&&(o.push(i),o.length===n.ANY_TERM_LONG_PROMPT_CAP))break}return o}buildOrderClause(e="relevance",t=!0,s="observations_fts"){switch(e){case"relevance":return t?`ORDER BY ${s}.rank ASC`:"ORDER BY o.created_at_epoch DESC";case"date_desc":return"ORDER BY o.created_at_epoch DESC, o.id DESC";case"date_asc":return"ORDER BY o.created_at_epoch ASC, o.id ASC";default:return"ORDER BY o.created_at_epoch DESC"}}searchObservationsBySubstring(e,t,s,r,o){let i=n.buildSubstringClause(e,["o.title","o.subtitle","o.narrative","o.text","o.facts","o.concepts"]),a=[],_=this.buildFilterClause(t,a,"o"),d=`
      SELECT o.*, o.discovery_tokens
      FROM observations o
      WHERE ${i.clause}
      ${_?"AND "+_:""}
      ${this.buildOrderClause(s,!1)}
      LIMIT ? OFFSET ?
    `;return this.db.prepare(d).all(...i.params,...a,r,o)}searchSessionsBySubstring(e,t,s,r,o){let i=n.buildSubstringClause(e,["s.request","s.investigated","s.learned","s.completed","s.next_steps","s.notes"]),a={...t};delete a.type;let _=[],d=this.buildFilterClause(a,_,"s"),E=s==="date_asc"?"ORDER BY s.created_at_epoch ASC, s.id ASC":"ORDER BY s.created_at_epoch DESC, s.id DESC",c=`
      SELECT s.*, s.discovery_tokens
      FROM session_summaries s
      WHERE ${i.clause}
      ${d?"AND "+d:""}
      ${E}
      LIMIT ? OFFSET ?
    `;return this.db.prepare(c).all(...i.params,..._,r,o)}searchObservations(e,t={}){let s=[],{limit:r=50,offset:o=0,orderBy:i="relevance",...a}=t;if(!e){let _=this.buildFilterClause(a,s,"o");if(!_)return[];let d=this.buildOrderClause(i,!1),E=`
        SELECT o.*, o.discovery_tokens
        FROM observations o
        WHERE ${_}
        ${d}
        LIMIT ? OFFSET ?
      `;return s.push(r,o),this.db.prepare(E).all(...s)}if(n.UNSEGMENTED_SCRIPT.test(e))return this.searchObservationsBySubstring(e,a,i,r,o);if(this._fts5Available||this.canReadFtsIndex("observations_fts")){let _=this.buildFilterClause(a,s,"o"),d=this.buildOrderClause(i,!0,"observations_fts"),E=`
        SELECT o.*, o.discovery_tokens
        FROM observations o
        JOIN observations_fts ON observations_fts.rowid = o.id
        WHERE observations_fts MATCH ?
        ${_?"AND "+_:""}
        ${d}
        LIMIT ? OFFSET ?
      `;s.unshift(n.buildFTSMatchQuery(e));let c;try{c=this.db.prepare(E).all(...s,r,o)}catch(p){throw l.warn("DB","FTS5 observation search failed",{},p instanceof Error?p:void 0),p}if(c.length>0||o>0&&this.db.prepare(E).all(...s,1,0).length>0)return c;let u=this.searchObservationsBySubstring(e,a,i,r,o);return u.length>0||o>0&&this.searchObservationsBySubstring(e,a,i,1,0).length>0?u:this.searchFtsAnyTerm(E,e,s,r,o,"observations_fts")??u}return this.searchObservationsBySubstring(e,a,i,r,o)}searchSessions(e,t={}){let s=[],{limit:r=50,offset:o=0,orderBy:i="relevance",...a}=t;if(!e){let _={...a};delete _.type;let d=this.buildFilterClause(_,s,"s");if(!d)return[];let c=`
        SELECT s.*, s.discovery_tokens
        FROM session_summaries s
        WHERE ${d}
        ${i==="date_asc"?"ORDER BY s.created_at_epoch ASC, s.id ASC":"ORDER BY s.created_at_epoch DESC, s.id DESC"}
        LIMIT ? OFFSET ?
      `;return s.push(r,o),this.db.prepare(c).all(...s)}if(n.UNSEGMENTED_SCRIPT.test(e))return this.searchSessionsBySubstring(e,a,i,r,o);if(this._fts5Available||this.canReadFtsIndex("session_summaries_fts")){let _={...a};delete _.type;let d=this.buildFilterClause(_,s,"s"),E=i==="date_asc"?"ORDER BY s.created_at_epoch ASC, s.id ASC":i==="date_desc"?"ORDER BY s.created_at_epoch DESC, s.id DESC":"ORDER BY session_summaries_fts.rank ASC",c=`
        SELECT s.*, s.discovery_tokens
        FROM session_summaries s
        JOIN session_summaries_fts ON session_summaries_fts.rowid = s.id
        WHERE session_summaries_fts MATCH ?
        ${d?"AND "+d:""}
        ${E}
        LIMIT ? OFFSET ?
      `;s.unshift(n.buildFTSMatchQuery(e));let u;try{u=this.db.prepare(c).all(...s,r,o)}catch(m){throw l.warn("DB","FTS5 session search failed",{},m instanceof Error?m:void 0),m}if(u.length>0||o>0&&this.db.prepare(c).all(...s,1,0).length>0)return u;let p=this.searchSessionsBySubstring(e,a,i,r,o);return p.length>0||o>0&&this.searchSessionsBySubstring(e,a,i,1,0).length>0?p:this.searchFtsAnyTerm(c,e,s,r,o,"session_summaries_fts")??p}return this.searchSessionsBySubstring(e,a,i,r,o)}searchFtsAnyTerm(e,t,s,r,o,i){let a=this.buildFTSAnyTermQuery(t,i);if(!a)return null;let _=[a,...s.slice(1)],d=this.db.prepare(e).all(..._,r,o);return d.length>0||o>0&&this.db.prepare(e).all(..._,1,0).length>0?d:null}findByConcept(e,t={}){let s=[],{limit:r=50,offset:o=0,orderBy:i="date_desc",...a}=t,_={...a,concepts:e},d=this.buildFilterClause(_,s,"o"),E=this.buildOrderClause(i,!1),c=`
      SELECT o.*, o.discovery_tokens
      FROM observations o
      WHERE ${d}
      ${E}
      LIMIT ? OFFSET ?
    `;return s.push(r,o),this.db.prepare(c).all(...s)}hasDirectChildFile(e,t){let s=r=>{if(!r)return!1;try{let o=JSON.parse(r);if(Array.isArray(o))return o.some(i=>typeof i=="string"&&bt(i,t))}catch(o){l.debug("DB",`Failed to parse files JSON for observation ${e.id}`,void 0,o instanceof Error?o:void 0)}return!1};return s(e.files_modified)||s(e.files_read)}hasDirectChildFileSession(e,t){let s=r=>{if(!r)return!1;try{let o=JSON.parse(r);if(Array.isArray(o))return o.some(i=>typeof i=="string"&&bt(i,t))}catch(o){l.debug("DB",`Failed to parse files JSON for session summary ${e.id}`,void 0,o instanceof Error?o:void 0)}return!1};return s(e.files_read)||s(e.files_edited)}static filePathPatterns(e,t){let s=_=>_.replace(/[\\%_]/g,"\\$&"),r=t?[e,ie(e),ie(e).replaceAll("/","\\")]:[e],o=[...new Set(r)].map(_=>`%${s(_)}%`);if(!t||!/^([A-Za-z]:)?[\\/]/.test(e))return o;let i=ie(e).split("/").filter(_=>_.length>0),a=/^[A-Za-z]:$/.test(i[0]??"")?1:0;for(let _=a;_<i.length;_+=1){let d=i.slice(_);o.push(`${s(d.join("/")+"/")}%`),e.includes("\\")&&o.push(`${s(d.join("\\")+"\\")}%`)}return o}static fileArrayJson(e){return`CASE WHEN json_valid(${e}) THEN CASE WHEN json_type(${e}) = 'array' THEN ${e} ELSE '[]' END ELSE '[]' END`}static jsonArrayLikeClause(e,t){let s=Array.from({length:t},()=>"type = 'text' AND value LIKE ? ESCAPE '\\'").join(" OR ");return`(${e.map(r=>`EXISTS (SELECT 1 FROM json_each(${n.fileArrayJson(r)}) WHERE ${s})`).join(" OR ")})`}findByFile(e,t={}){let s=[],{limit:r=50,offset:o=0,orderBy:i="date_desc",isFolder:a=!1,..._}=t;delete _.files;let d=a?"":"LIMIT ? OFFSET ?",E=n.filePathPatterns(e,a),c=this.buildFilterClause(_,s,"o");s.push(...E,...E);let u=[c,n.jsonArrayLikeClause(["o.files_read","o.files_modified"],E.length)].filter(Boolean).join(" AND "),p=`${this.buildOrderClause(i,!1)}, o.id ${i==="date_asc"?"ASC":"DESC"}`,m=`
      SELECT o.*, o.discovery_tokens
      FROM observations o
      WHERE ${u}
      ${p}
      ${d}
    `;a||s.push(r,o);let g=this.db.prepare(m),f=a?Nt(g,s,S=>this.hasDirectChildFile(S,e),{limit:r,offset:o}):g.all(...s),N=[],R={..._};delete R.type;let T=[],D=x(R);if(D.length>0){let S=B("s",D,{includeMerged:!0});T.push(S.sql),N.push(...S.params)}if(R.platformSource&&(T.push(`COALESCE(NULLIF((SELECT s2.platform_source FROM sdk_sessions s2 WHERE s2.memory_session_id = s.memory_session_id), ''), '${A}') = ?`),N.push(b(R.platformSource))),R.dateRange){let{start:S,end:I}=R.dateRange;S&&(T.push("s.created_at_epoch >= ?"),N.push(z(S,"start"))),I&&(T.push("s.created_at_epoch <= ?"),N.push(z(I,"end")))}T.push(n.jsonArrayLikeClause(["s.files_read","s.files_edited"],E.length)),N.push(...E,...E);let G=`
      SELECT s.*, s.discovery_tokens
      FROM session_summaries s
      WHERE ${T.join(" AND ")}
      ORDER BY s.created_at_epoch ${i==="date_asc"?"ASC":"DESC"}
      ${d}
    `;a||N.push(r,o);let O=this.db.prepare(G),v=a?Nt(O,N,S=>this.hasDirectChildFileSession(S,e),{limit:r,offset:o}):O.all(...N);return{observations:f,sessions:v}}findByType(e,t={}){let s=[],{limit:r=50,offset:o=0,orderBy:i="date_desc",...a}=t,_={...a,type:e},d=this.buildFilterClause(_,s,"o"),E=this.buildOrderClause(i,!1),c=`
      SELECT o.*, o.discovery_tokens
      FROM observations o
      WHERE ${d}
      ${E}
      LIMIT ? OFFSET ?
    `;return s.push(r,o),this.db.prepare(c).all(...s)}searchUserPrompts(e,t={}){let s=[],{limit:r=20,offset:o=0,orderBy:i="relevance",...a}=t,_=[],d=x(a);if(d.length>0){let m=B("s",d,{includeMerged:!1});_.push(m.sql),s.push(...m.params)}if(a.platformSource&&(_.push(`COALESCE(NULLIF(s.platform_source, ''), '${A}') = ?`),s.push(b(a.platformSource))),a.dateRange){let{start:m,end:g}=a.dateRange;m&&(_.push("up.created_at_epoch >= ?"),s.push(z(m,"start"))),g&&(_.push("up.created_at_epoch <= ?"),s.push(z(g,"end")))}if(!e){if(_.length===0)return[];let m=`WHERE ${_.join(" AND ")}`,f=`
        SELECT
          up.*,
          s.project,
          s.memory_session_id,
          COALESCE(NULLIF(s.platform_source, ''), '${A}') as platform_source
        FROM user_prompts up
        JOIN sdk_sessions s ON up.session_db_id = s.id
        ${m}
        ${i==="date_asc"?"ORDER BY up.created_at_epoch ASC, up.id ASC":"ORDER BY up.created_at_epoch DESC, up.id DESC"}
        LIMIT ? OFFSET ?
      `;return s.push(r,o),this.db.prepare(f).all(...s)}let E=e.replace(/[\\%_]/g,"\\$&");_.push("up.prompt_text LIKE ? ESCAPE '\\'"),s.push(`%${E}%`);let c=`WHERE ${_.join(" AND ")}`,p=`
      SELECT
        up.*,
        s.project,
        s.memory_session_id,
        COALESCE(NULLIF(s.platform_source, ''), '${A}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      ${c}
      ${i==="date_asc"?"ORDER BY up.created_at_epoch ASC, up.id ASC":"ORDER BY up.created_at_epoch DESC, up.id DESC"}
      LIMIT ? OFFSET ?
    `;return s.push(r,o),this.db.prepare(p).all(...s)}close(){this.db.close()}};var fn=4096;var Mo=new Set(["set_title","set_prompt_session","remap_project"]),yo=/^(?:0|[1-9][0-9]*)$/,An=18446744073709551615n;function U(n){throw l.debug("CLOUD_SYNC","Rejected invalid canonical content",{reason:n}),new Error(`canonical content: ${n}`)}function Ke(n,e={}){return typeof n!="string"||!yo.test(n)?U("decimal values must be unsigned base-10 strings without leading zeroes"):(BigInt(n)>An&&U("decimal value exceeds uint64"),e.positive&&n==="0"&&U("decimal value must be positive"),n)}function Lt(n){let e=Ke(n);return BigInt(e)===An&&U("uint64 sequence overflow"),(BigInt(e)+1n).toString(10)}function Uo(n){(n===null||typeof n!="object"||Array.isArray(n))&&U("mutation must be an object");let e=n;if((typeof e.op!="string"||!Mo.has(e.op))&&U("unsupported mutation op"),e.op==="set_title"){let o=Ne(e,["fields","op","target"],"set_title"),i=Ye(o.target,["content_session_id","memory_session_id","platform_source"],"set_title.target");i.memory_session_id===void 0&&i.content_session_id===void 0&&U("set_title target requires a session identifier");for(let _ of["memory_session_id","content_session_id","platform_source"])i[_]!==void 0&&W(i[_],_);let a=Ne(o.fields,["custom_title"],"set_title.fields");W(a.custom_title,"custom_title");return}if(e.op==="set_prompt_session"){let o=Ne(e,["fields","op","target"],"set_prompt_session"),i=Ne(o.target,["origin_device_id","origin_local_id"],"set_prompt_session.target");vo(i.origin_device_id),Ke(i.origin_local_id);let a=Ye(o.fields,["content_session_id","memory_session_id","platform_source","project"],"set_prompt_session.fields");W(a.memory_session_id,"memory_session_id");for(let _ of["content_session_id","platform_source","project"])a[_]!==void 0&&W(a[_],_);return}let t=Ne(e,["fields","op","where"],"remap_project"),s=Ye(t.where,["memory_session_id","merged_into_project_is_null","project"],"remap_project.where");s.project!==void 0&&W(s.project,"project"),s.memory_session_id!==void 0&&W(s.memory_session_id,"memory_session_id"),s.merged_into_project_is_null!==void 0&&s.merged_into_project_is_null!==!0&&U("merged_into_project_is_null may only be true"),Object.keys(s).length===0&&U("remap_project where is empty");let r=Ye(t.fields,["merged_into_project","project"],"remap_project.fields");r.project!==void 0&&W(r.project,"project"),r.merged_into_project!==void 0&&W(r.merged_into_project,"merged_into_project"),Object.keys(r).length===0&&U("remap_project fields are empty")}function Ct(n){Uo(n)}function vo(n){return typeof n!="string"||n.length===0||Buffer.byteLength(n,"utf8")>128?U("origin_device_id must be a non-empty string of at most 128 UTF-8 bytes"):n}function W(n,e){return typeof n!="string"||n.length===0||n.trim().length===0||Buffer.byteLength(n,"utf8")>fn?U(`${e} must be a non-blank string of at most ${fn} UTF-8 bytes`):n}function Ne(n,e,t){if(n===null||typeof n!="object"||Array.isArray(n))return U(`${t} must be an object`);let s=n,r=Object.keys(s).sort(),o=[...e].sort();return(r.length!==o.length||r.some((i,a)=>i!==o[a]))&&U(`${t} must contain exactly: ${o.join(", ")}`),s}function Ye(n,e,t){if(n===null||typeof n!="object"||Array.isArray(n))return U(`${t} must be an object`);let s=n,r=new Set(e),o=Object.keys(s).find(i=>!r.has(i));return o&&U(`${t} contains unknown field ${o}`),s}var Nn=5*6e4,gn=`
  CREATE TABLE IF NOT EXISTS sync_entity_heads (
    entity_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('observation', 'summary', 'prompt', 'work_state')),
    origin_device_id TEXT NOT NULL,
    origin_local_id TEXT NOT NULL,
    entity_rev TEXT NOT NULL,
    operation_sha256 TEXT NOT NULL,
    deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
    updated_at_epoch INTEGER NOT NULL
  )`,On=`
  CREATE TABLE IF NOT EXISTS sync_content_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('observation', 'summary', 'prompt', 'work_state')),
    origin_local_id TEXT NOT NULL,
    entity_rev TEXT NOT NULL,
    body TEXT NOT NULL,
    operation_sha256 TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
    created_at_epoch INTEGER NOT NULL,
    UNIQUE(entity_id, entity_rev)
  )`,Rn=`
  CREATE TABLE IF NOT EXISTS sync_launch_exclusions (
    kind TEXT NOT NULL CHECK (kind IN ('observation', 'summary', 'prompt', 'work_state')),
    origin_local_id TEXT NOT NULL,
    through_rev TEXT NOT NULL,
    PRIMARY KEY (kind, origin_local_id)
  )`,h=n=>typeof n=="object"&&n!==null?JSON.stringify(n):n??null;function bn(n){let e=[],t=[],s=new Set,r=new Set;for(let o of n){for(let i of o.files_read??[])!i||s.has(i)||(s.add(i),e.push(i));for(let i of o.files_modified??[])!i||r.has(i)||(r.add(i),t.push(i))}return{files_read:e,files_edited:t}}var wo=200,Fo=1e3,xo=56,ko=57;function It(n){let e=Number(n);return Number.isSafeInteger(e)&&e>0?e:void 0}var Dt=class{db;syncOpsEnabled;statementCache=new Map;localSyncDeviceId="";constructor(e=Ce,t={}){this.syncOpsEnabled=t.syncOpsEnabled??!0,typeof e=="string"&&e!==":memory:"&&Ie(M),this.db=we(e),ge(this.db,oe),Xe(this.db),cn(this.db,oe),this.initializeSchema(),this.ensureWorkerPortColumn(),this.ensurePromptTrackingColumns(),this.removeSessionSummariesUniqueConstraint(),this.addObservationHierarchicalFields(),this.makeObservationsTextNullable(),this.createUserPromptsTable(),this.ensureDiscoveryTokensColumn(),this.createPendingMessagesTable(),this.renameSessionIdColumns(),this.addFailedAtEpochColumn(),this.addOnUpdateCascadeToForeignKeys(),this.addObservationContentHashColumn(),this.addSessionCustomTitleColumn(),this.addSessionPlatformSourceColumn(),this.addObservationModelColumns(),this.ensureMergedIntoProjectColumns(),this.addObservationSubagentColumns(),this.addObservationsUniqueContentHashIndex(),this.addObservationsMetadataColumn(),this.dropDeadPendingMessagesColumns(),this.ensurePendingMessagesToolUseIdColumn(),this.dropWorkerPidColumn(),this.ensureSDKSessionsPlatformContentIdentity(),this.ensureUserPromptsSessionDbId(),this.ensurePendingMessagesSessionToolUniqueIndex(),this.ensureSyncedAtColumns(),this.ensureSyncOriginColumns(),this.ensureSyncOutbox(),this.ensureSyncEntityLedger(),this.ensureSyncRevisionTextAffinity(),this.initializeSyncHubLaunchBaseline(),this.normalizeConceptTags(),this.ensureSDKSessionsObservedColumns(),this.ensureToolUsesTable(),this.ensureTelegramWrapupsTable(),this.addDedupTables(),this.refreshUnicodeTitleNormKeys(),this.ensureReinforcementColumns(),this.ensureSessionCwdColumn(),this.dropWriteOnlyUserPromptsFtsAndScopeFtsUpdateTriggers(),this.ensureProjectNocaseIndexes(),this.ensureAdvisorCallsTable(),this.ensureSessionProjectKeySourceColumn(),this.requeuePromptsDeadLetteredForSize(),this.ensureWorkStateTable(),this.ensureDeliverablesTable(),this.ensureHookSpoolConsumedTable(),this.ensureProjectRecencyIndexes(),this.ensureMergedIntoProjectCoveringIndexes(),this.ensureNativePromptIdentity(),this.ensureObservationFileIndex()}ensureObservationFileIndex(){this.db.transaction(()=>{if(this.db.query("SELECT version FROM schema_versions WHERE version = 68").get())return;this.db.run(`CREATE TABLE IF NOT EXISTS observation_files (
        path TEXT NOT NULL,
        observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
        PRIMARY KEY (path, observation_id)
      )`),this.db.run("CREATE INDEX IF NOT EXISTS idx_observation_files_observation ON observation_files(observation_id)");let e=t=>`SELECT o.id, je.value FROM observations o, json_each(o.${t}) je
         WHERE json_valid(o.${t}) AND json_type(o.${t}) = 'array' AND je.type = 'text'`;this.db.run(`INSERT OR IGNORE INTO observation_files(observation_id, path)
        ${e("files_read")} UNION ${e("files_modified")}`),this.db.prepare("INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)").run(68,new Date().toISOString())}).immediate()}indexObservationFiles(e,t,s){let r=new Set;for(let i of[...t,...s])typeof i=="string"&&i.length>0&&r.add(i);if(r.size===0)return;let o=this.db.prepare("INSERT OR IGNORE INTO observation_files(path, observation_id) VALUES (?, ?)");for(let i of r)o.run(i,e)}ensureNativePromptIdentity(){this.db.transaction(()=>{let e=this.db.query("PRAGMA table_info(user_prompts)").all();for(let t of["native_prompt_id","native_prompt_hash"])e.some(s=>s.name===t)||this.db.run(`ALTER TABLE user_prompts ADD COLUMN ${t} TEXT`);this.db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_prompts_native_identity
        ON user_prompts(session_db_id, native_prompt_id) WHERE native_prompt_id IS NOT NULL`)}).immediate()}refreshUnicodeTitleNormKeys(){this.db.transaction(()=>{if(this.db.query("SELECT version FROM schema_versions WHERE version = 65").get())return;let e=this.db.prepare(`SELECT o.id, o.project, o.title, o.agent_id, o.agent_type,
        s.platform_source FROM observations o LEFT JOIN sdk_sessions s
        ON s.memory_session_id = o.memory_session_id ORDER BY o.id`),t=this.db.prepare("UPDATE observations SET title_norm_key = ? WHERE id = ?");try{for(let s of je(e)){let r=s;t.run(ke(r.project,r.platform_source,r.title,me(r.agent_id,r.agent_type)),r.id)}this.db.prepare("INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)").run(65,new Date().toISOString())}finally{e.finalize(),t.finalize()}}).immediate()}getIndexColumns(e){return this.db.query(`PRAGMA index_info(${JSON.stringify(e)})`).all().map(t=>t.name)}hasUniqueIndexOnColumns(e,t){return this.db.query(`PRAGMA index_list(${e})`).all().some(r=>{if(r.unique!==1)return!1;let o=this.getIndexColumns(r.name);return o.length===t.length&&o.every((i,a)=>i===t[a])})}resolvePromptSessionDbId(e,t,s){if(t!==void 0)return t;let r=s?b(s):void 0;return r?this.db.prepare(`
        SELECT id
        FROM sdk_sessions
        WHERE COALESCE(NULLIF(platform_source, ''), ?) = ?
          AND content_session_id = ?
        LIMIT 1
      `).get(A,r,e)?.id??null:this.db.prepare(`
      SELECT id
      FROM sdk_sessions
      WHERE content_session_id = ?
      ORDER BY CASE COALESCE(NULLIF(platform_source, ''), '${A}')
        WHEN '${A}' THEN 0
        ELSE 1
      END, id
      LIMIT 1
    `).get(e)?.id??null}addDedupTables(){let e=this.db.query("PRAGMA table_info(observations)").all();e.some(t=>t.name==="occurrence_count")||this.db.run("ALTER TABLE observations ADD COLUMN occurrence_count INTEGER NOT NULL DEFAULT 1"),e.some(t=>t.name==="title_norm_key")||this.db.run("ALTER TABLE observations ADD COLUMN title_norm_key TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_title_norm ON observations(project, title_norm_key)"),this.db.run(`
      CREATE TABLE IF NOT EXISTS token_df (
        project TEXT    NOT NULL,
        token   TEXT    NOT NULL,
        df      INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (project, token)
      )
    `),this.db.run(`
      CREATE TABLE IF NOT EXISTS dedup_meta (
        project                TEXT    PRIMARY KEY,
        doc_count              INTEGER NOT NULL DEFAULT 0,
        last_rebuild_doc_count INTEGER NOT NULL DEFAULT 0,
        deleted_since_rebuild  INTEGER NOT NULL DEFAULT 0
      )
    `),this.db.run(`
      CREATE TABLE IF NOT EXISTS observation_dedup_candidates (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        observation_id   INTEGER NOT NULL,
        duplicate_of_id  INTEGER NOT NULL,
        project          TEXT    NOT NULL,
        method           TEXT    NOT NULL CHECK(method IN ('exact', 'idf_cosine')),
        score            REAL    NOT NULL,
        status           TEXT    NOT NULL DEFAULT 'pending'
                                 CHECK(status IN ('pending', 'merged', 'distinct', 'dismissed')),
        created_at       TEXT    NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        metadata         TEXT,
        FOREIGN KEY (observation_id)  REFERENCES observations(id) ON DELETE CASCADE,
        FOREIGN KEY (duplicate_of_id) REFERENCES observations(id) ON DELETE CASCADE,
        UNIQUE(observation_id, duplicate_of_id)
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_token_df_project ON token_df(project)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_dedup_candidates_project ON observation_dedup_candidates(project, status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_dedup_candidates_obs ON observation_dedup_candidates(observation_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(xo,new Date().toISOString())}dropWorkerPidColumn(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(32),s=this.db.query("PRAGMA table_info(pending_messages)").all().some(r=>r.name==="worker_pid");if(!(e&&!s)){if(s)try{this.db.run("DROP INDEX IF EXISTS idx_pending_messages_worker_pid"),this.db.run("ALTER TABLE pending_messages DROP COLUMN worker_pid"),l.debug("DB","Dropped worker_pid column and its index from pending_messages")}catch(r){l.warn("DB","Failed to drop worker_pid column from pending_messages",{},r instanceof Error?r:new Error(String(r)));return}e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(32,new Date().toISOString())}}ensureSDKSessionsPlatformContentIdentity(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(33),t=this.hasUniqueIndexOnColumns("sdk_sessions",["content_session_id"]),s=this.hasUniqueIndexOnColumns("sdk_sessions",["platform_source","content_session_id"]),o=this.db.query("PRAGMA table_info(sdk_sessions)").all().some(i=>i.name==="platform_source");if(!(e&&!t&&s&&o)){if(o||this.db.run(`ALTER TABLE sdk_sessions ADD COLUMN platform_source TEXT NOT NULL DEFAULT '${A}'`),this.db.run(`
      UPDATE sdk_sessions
      SET platform_source = '${A}'
      WHERE platform_source IS NULL OR platform_source = ''
    `),t){this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION");try{this.rebuildSdkSessionsWithCompositeIdentity(e),this.db.run("COMMIT")}catch(i){this.db.run("ROLLBACK");let a=i instanceof Error?i:new Error(String(i));throw l.error("DB","Failed to rebuild sdk_sessions with composite identity, rolled back",{},a),i}finally{this.db.run("PRAGMA foreign_keys = ON")}return}this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS ux_sdk_sessions_platform_content ON sdk_sessions(platform_source, content_session_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(33,new Date().toISOString())}}rebuildSdkSessionsWithCompositeIdentity(e){this.db.run("DROP TABLE IF EXISTS sdk_sessions_new"),this.db.run(`
      CREATE TABLE sdk_sessions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT NOT NULL,
        memory_session_id TEXT UNIQUE,
        project TEXT NOT NULL,
        platform_source TEXT NOT NULL DEFAULT '${A}',
        user_prompt TEXT,
        started_at TEXT NOT NULL,
        started_at_epoch INTEGER NOT NULL,
        completed_at TEXT,
        completed_at_epoch INTEGER,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed')),
        worker_port INTEGER,
        prompt_counter INTEGER DEFAULT 0,
        custom_title TEXT
      )
    `),this.db.run(`
      INSERT INTO sdk_sessions_new (
        id, content_session_id, memory_session_id, project, platform_source,
        user_prompt, started_at, started_at_epoch, completed_at, completed_at_epoch,
        status, worker_port, prompt_counter, custom_title
      )
      SELECT
        id, content_session_id, memory_session_id, project,
        COALESCE(NULLIF(platform_source, ''), '${A}'),
        user_prompt, started_at, started_at_epoch, completed_at, completed_at_epoch,
        status, worker_port, prompt_counter, custom_title
      FROM sdk_sessions
    `),this.db.run("DROP TABLE sdk_sessions"),this.db.run("ALTER TABLE sdk_sessions_new RENAME TO sdk_sessions"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source)"),this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS ux_sdk_sessions_platform_content ON sdk_sessions(platform_source, content_session_id)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(33,new Date().toISOString())}ensureUserPromptsSessionDbId(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(34);if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='user_prompts'").all().length===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(34,new Date().toISOString());return}let r=this.db.query("PRAGMA table_info(user_prompts)").all().some(_=>_.name==="session_db_id"),i=this.db.query("PRAGMA foreign_key_list(user_prompts)").all().some(_=>_.table==="sdk_sessions"&&_.from==="content_session_id");if(e&&r&&!i)return;let a=r?`COALESCE(up.session_db_id, (
          SELECT s.id FROM sdk_sessions s
          WHERE s.content_session_id = up.content_session_id
          ORDER BY CASE COALESCE(NULLIF(s.platform_source, ''), '${A}')
            WHEN '${A}' THEN 0
            ELSE 1
          END, s.id
          LIMIT 1
        ))`:`(
          SELECT s.id FROM sdk_sessions s
          WHERE s.content_session_id = up.content_session_id
          ORDER BY CASE COALESCE(NULLIF(s.platform_source, ''), '${A}')
            WHEN '${A}' THEN 0
            ELSE 1
          END, s.id
          LIMIT 1
        )`;this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION");try{this.rebuildUserPromptsWithSessionDbId(e,a),this.db.run("COMMIT")}catch(_){this.db.run("ROLLBACK");let d=_ instanceof Error?_:new Error(String(_));throw l.error("DB","Failed to rebuild user_prompts with session_db_id, rolled back",{},d),_}finally{this.db.run("PRAGMA foreign_keys = ON")}}rebuildUserPromptsWithSessionDbId(e,t){this.db.run("DROP TRIGGER IF EXISTS user_prompts_ai"),this.db.run("DROP TRIGGER IF EXISTS user_prompts_ad"),this.db.run("DROP TRIGGER IF EXISTS user_prompts_au"),this.db.run("DROP TABLE IF EXISTS user_prompts_new"),this.db.run(`
      CREATE TABLE user_prompts_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER,
        content_session_id TEXT NOT NULL,
        prompt_number INTEGER NOT NULL,
        prompt_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
      )
    `),this.db.run(`
      INSERT INTO user_prompts_new (
        id, session_db_id, content_session_id, prompt_number,
        prompt_text, created_at, created_at_epoch
      )
      SELECT
        up.id,
        ${t},
        up.content_session_id,
        up.prompt_number,
        up.prompt_text,
        up.created_at,
        up.created_at_epoch
      FROM user_prompts up
    `),this.db.run("DROP TABLE user_prompts"),this.db.run("ALTER TABLE user_prompts_new RENAME TO user_prompts"),this.db.run("CREATE INDEX IF NOT EXISTS idx_user_prompts_session ON user_prompts(session_db_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_user_prompts_claude_session ON user_prompts(content_session_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_user_prompts_created ON user_prompts(created_at_epoch DESC)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_user_prompts_prompt_number ON user_prompts(prompt_number)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_user_prompts_lookup ON user_prompts(session_db_id, prompt_number)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_user_prompts_content_lookup ON user_prompts(content_session_id, prompt_number)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(34,new Date().toISOString())}ensurePendingMessagesSessionToolUniqueIndex(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(35);if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(35,new Date().toISOString());return}let s=this.hasUniqueIndexOnColumns("pending_messages",["session_db_id","tool_use_id"]);if(!(e&&s)){this.db.run("BEGIN TRANSACTION");try{this.recreatePendingSessionToolUniqueIndex(e),this.db.run("COMMIT")}catch(r){this.db.run("ROLLBACK");let o=r instanceof Error?r:new Error(String(r));throw l.error("DB","Failed to recreate ux_pending_session_tool index, rolled back",{},o),r}}}recreatePendingSessionToolUniqueIndex(e){this.db.run("DROP INDEX IF EXISTS ux_pending_session_tool"),this.db.run(`
      DELETE FROM pending_messages
       WHERE id IN (
         SELECT id
           FROM (
             SELECT id,
                    ROW_NUMBER() OVER (
                      PARTITION BY session_db_id, tool_use_id
                      ORDER BY CASE status
                        WHEN 'processing' THEN 0
                        WHEN 'pending' THEN 1
                        ELSE 2
                      END, id
                    ) AS duplicate_rank
               FROM pending_messages
              WHERE tool_use_id IS NOT NULL
           )
          WHERE duplicate_rank > 1
         )
    `),this.db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_pending_session_tool
      ON pending_messages(session_db_id, tool_use_id)
      WHERE tool_use_id IS NOT NULL
    `),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(35,new Date().toISOString())}ensureSyncedAtColumns(){for(let e of["observations","session_summaries","user_prompts"])this.db.query(`PRAGMA table_info(${e})`).all().some(r=>r.name==="synced_at")||(this.db.run(`ALTER TABLE ${e} ADD COLUMN synced_at INTEGER`),l.debug("DB",`Added synced_at column to ${e} table`)),this.db.run(`CREATE INDEX IF NOT EXISTS idx_${e}_unsynced ON ${e}(id) WHERE synced_at IS NULL`);this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(39,new Date().toISOString())}ensureSyncOriginColumns(){for(let e of["observations","session_summaries","user_prompts"]){let t=this.db.query(`PRAGMA table_info(${e})`).all(),s=new Set(t.map(r=>r.name));s.has("origin_device_id")||(this.db.run(`ALTER TABLE ${e} ADD COLUMN origin_device_id TEXT`),l.debug("DB",`Added origin_device_id column to ${e} table`)),s.has("origin_local_id")||(this.db.run(`ALTER TABLE ${e} ADD COLUMN origin_local_id TEXT`),l.debug("DB",`Added origin_local_id column to ${e} table`)),s.has("sync_rev")||(this.db.run(`ALTER TABLE ${e} ADD COLUMN sync_rev TEXT NOT NULL DEFAULT '1'`),l.debug("DB",`Added sync_rev column to ${e} table`)),this.db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_${e}_origin
        ON ${e}(origin_device_id, origin_local_id)
        WHERE origin_device_id IS NOT NULL
      `)}this.db.run(`
      CREATE TABLE IF NOT EXISTS sync_state (
        k TEXT PRIMARY KEY,
        v TEXT
      )
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(41,new Date().toISOString())}ensureSyncOutbox(){this.db.run(`
      CREATE TABLE IF NOT EXISTS sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        op_uuid TEXT NOT NULL UNIQUE,
        rev TEXT NOT NULL DEFAULT '1',
        body TEXT NOT NULL,
        canonical_body TEXT,
        operation_sha256 TEXT,
        created_at_epoch INTEGER NOT NULL
      )
    `);let e=new Set(this.db.query("PRAGMA table_info(sync_outbox)").all().map(t=>t.name));e.has("canonical_body")||this.db.run("ALTER TABLE sync_outbox ADD COLUMN canonical_body TEXT"),e.has("operation_sha256")||this.db.run("ALTER TABLE sync_outbox ADD COLUMN operation_sha256 TEXT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(42,new Date().toISOString())}ensureSyncRevisionTextAffinity(){let e=[{table:"observations",column:"sync_rev",temporary:"sync_rev_text_v46"},{table:"session_summaries",column:"sync_rev",temporary:"sync_rev_text_v46"},{table:"user_prompts",column:"sync_rev",temporary:"sync_rev_text_v46"},{table:"sync_outbox",column:"rev",temporary:"rev_text_v46"}],t=(i,a)=>this.db.query(`PRAGMA table_info(${i})`).all().find(_=>_.name===a),s=i=>i?.type.trim().toUpperCase()==="TEXT";if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(46)&&e.every(i=>s(t(i.table,i.column))))return;this.db.transaction(()=>{for(let i of e){let a=this.db.query(`PRAGMA table_info(${i.table})`).all(),_=a.find(E=>E.name===i.column);if(!_)throw new Error(`schema v46: missing ${i.table}.${i.column}`);for(let E of je(this.db.query(`
          SELECT CAST(id AS TEXT) AS row_id,
                 typeof(${i.column}) AS storage_type,
                 CAST(${i.column} AS TEXT) AS revision
          FROM ${i.table}
        `))){let c=E;if(c.storage_type==="real")throw new Error(`schema v46: ${i.table}.${i.column} row ${c.row_id} is REAL and unrecoverably rounded`);if(c.storage_type!=="integer"&&c.storage_type!=="text")throw new Error(`schema v46: ${i.table}.${i.column} row ${c.row_id} has unsupported ${c.storage_type} storage`);try{Ke(c.revision,{positive:!0})}catch{throw new Error(`schema v46: ${i.table}.${i.column} row ${c.row_id} is not a positive canonical uint64 revision`)}}if(s(_))continue;if(a.some(E=>E.name===i.temporary))throw new Error(`schema v46: unexpected temporary column ${i.table}.${i.temporary}`);this.db.run(`ALTER TABLE ${i.table} ADD COLUMN ${i.temporary} TEXT NOT NULL DEFAULT '1'`),this.db.run(`UPDATE ${i.table} SET ${i.temporary} = CAST(${i.column} AS TEXT)`);let d=this.db.prepare(`
          SELECT CAST(id AS TEXT) AS row_id
          FROM ${i.table}
          WHERE ${i.temporary} <> CAST(${i.column} AS TEXT)
          LIMIT 1
        `).get();if(d)throw new Error(`schema v46: failed to copy ${i.table}.${i.column} row ${d.row_id} exactly`);this.db.run(`ALTER TABLE ${i.table} DROP COLUMN ${i.column}`),this.db.run(`ALTER TABLE ${i.table} RENAME COLUMN ${i.temporary} TO ${i.column}`)}this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(46,new Date().toISOString())})()}ensureSyncEntityLedger(){this.db.run(gn),this.widenSyncKindCheck("sync_entity_heads",gn),this.db.run(On),new Set(this.db.query("PRAGMA table_info(sync_content_outbox)").all().map(t=>t.name)).has("deleted")||(this.db.run("ALTER TABLE sync_content_outbox ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0"),this.db.run(`
        UPDATE sync_content_outbox
        SET deleted = CASE WHEN json_extract(body, '$.deleted') = 1 THEN 1 ELSE 0 END
      `)),this.widenSyncKindCheck("sync_content_outbox",On),this.db.run(`
      CREATE TABLE IF NOT EXISTS sync_dead_letter (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lane TEXT NOT NULL CHECK (lane IN ('content', 'mutation')),
        queue_key TEXT NOT NULL,
        kind TEXT,
        origin_local_id TEXT,
        entity_rev TEXT,
        reason TEXT NOT NULL,
        raw_body TEXT,
        created_at_epoch INTEGER NOT NULL,
        UNIQUE(lane, queue_key, entity_rev, reason)
      )
    `),this.db.run(`
      CREATE TABLE IF NOT EXISTS sync_pull_quarantine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        epoch TEXT NOT NULL,
        seq TEXT NOT NULL,
        kind TEXT,
        entity_id TEXT,
        origin_device_id TEXT,
        origin_local_id TEXT,
        entity_rev TEXT,
        operation_sha256 TEXT,
        reason TEXT NOT NULL,
        raw_body TEXT NOT NULL,
        retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
        created_at_epoch INTEGER NOT NULL,
        UNIQUE(epoch, seq)
      )
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(44,new Date().toISOString()),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(45,new Date().toISOString())}widenSyncKindCheck(e,t){let s=this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(e);if(!s||s.sql.includes("'work_state'"))return;let r=this.db.query(`PRAGMA table_info(${e})`).all().map(i=>i.name).join(", "),o=`${e}_pre_work_state`;this.db.transaction(()=>{this.db.run(`DROP TABLE IF EXISTS ${o}`),this.db.run(`ALTER TABLE ${e} RENAME TO ${o}`),this.db.run(t),this.db.run(`INSERT INTO ${e} (${r}) SELECT ${r} FROM ${o}`),this.db.run(`DROP TABLE ${o}`)}).immediate(),l.info("DB",`Rebuilt ${e} to admit the work_state sync kind`)}initializeSyncHubLaunchBaseline(){let e=[{table:"observations",kind:"observation"},{table:"session_summaries",kind:"summary"},{table:"user_prompts",kind:"prompt"}],t=this.db.prepare(`
      SELECT 1 AS present FROM sqlite_master
      WHERE type = 'table' AND name = 'sync_launch_exclusions'
    `).get()!==void 0;this.db.run(Rn),this.widenSyncKindCheck("sync_launch_exclusions",Rn);let s=this.db.prepare("SELECT version, applied_at FROM schema_versions WHERE version = ?").get(47);if(!s){let a=Date.now();this.db.transaction(()=>{this.db.run("DELETE FROM sync_launch_exclusions");for(let{table:E,kind:c}of e)this.db.prepare(`
            INSERT INTO sync_launch_exclusions (kind, origin_local_id, through_rev)
            SELECT ?, CAST(id AS TEXT), CAST(sync_rev AS TEXT)
            FROM ${E}
            WHERE origin_device_id IS NULL
          `).run(c),this.db.prepare(`
            UPDATE ${E} SET synced_at = ?
            WHERE synced_at IS NULL AND origin_device_id IS NULL
          `).run(a);this.db.run("DELETE FROM sync_outbox"),this.db.run("DELETE FROM sync_content_outbox"),this.db.run("DELETE FROM sync_dead_letter"),this.db.run("DELETE FROM sync_state");let d=new Date(a).toISOString();this.db.prepare("INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)").run(47,d),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(48,d)})();return}if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(48)&&t)return;let o=Date.parse(s.applied_at);if(!Number.isSafeInteger(o)||o<0)throw new Error(`schema v48: invalid v47 applied_at ${s.applied_at}`);this.db.transaction(()=>{for(let{table:a,kind:_}of e)this.db.prepare(`
          INSERT OR IGNORE INTO sync_launch_exclusions (kind, origin_local_id, through_rev)
          SELECT ?, CAST(id AS TEXT), CAST(sync_rev AS TEXT)
          FROM ${a}
          WHERE origin_device_id IS NULL
            AND synced_at > 0
            AND synced_at <= ?
        `).run(_,o);this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(48,new Date().toISOString())})()}normalizeConceptTags(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(49))return;let t=0;this.db.transaction(()=>{let r=this.db.prepare(`
        SELECT CAST(id AS TEXT) AS id, origin_device_id, CAST(sync_rev AS TEXT) AS sync_rev
        FROM observations
        WHERE concepts LIKE '%:%' AND json_valid(concepts)
      `).all();t=r.length,this.db.run(`
        UPDATE observations
        SET concepts = (
          SELECT json_group_array(
            CASE WHEN instr(value, ':') > 0
                 THEN trim(substr(value, 1, instr(value, ':') - 1))
                 ELSE value END)
          FROM json_each(observations.concepts))
        WHERE concepts LIKE '%:%' AND json_valid(concepts)
      `);for(let o of r){if(o.origin_device_id!==null)continue;let i=Lt(o.sync_rev);this.db.prepare(`
          UPDATE observations SET sync_rev = ?, synced_at = NULL
          WHERE id = ? AND origin_device_id IS NULL
        `).run(i,o.id)}this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(49,new Date().toISOString())})(),l.debug("DB",`Normalized prefixed concept tags in ${t} observations (v49)`)}dropDeadPendingMessagesColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(31),t=this.db.query("PRAGMA table_info(pending_messages)").all(),s=new Set(t.map(i=>i.name)),o=["retry_count","failed_at_epoch","completed_at_epoch"].filter(i=>s.has(i));if(!(e&&o.length===0)){if(o.length>0){this.db.run("BEGIN TRANSACTION");try{this.db.run("DELETE FROM pending_messages WHERE status NOT IN ('pending', 'processing')");for(let i of o)this.db.run(`ALTER TABLE pending_messages DROP COLUMN ${i}`),l.debug("DB",`Dropped dead column ${i} from pending_messages`);e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(31,new Date().toISOString()),this.db.run("COMMIT")}catch(i){this.db.run("ROLLBACK"),l.warn("DB","Failed to drop dead columns from pending_messages",{},i instanceof Error?i:new Error(String(i)));return}return}e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(31,new Date().toISOString())}}initializeSchema(){this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        id INTEGER PRIMARY KEY,
        version INTEGER UNIQUE NOT NULL,
        applied_at TEXT NOT NULL
      )
    `),this.db.run(`
      CREATE TABLE IF NOT EXISTS sdk_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT NOT NULL,
        memory_session_id TEXT UNIQUE,
        project TEXT NOT NULL,
        platform_source TEXT NOT NULL DEFAULT 'claude',
        user_prompt TEXT,
        started_at TEXT NOT NULL,
        started_at_epoch INTEGER NOT NULL,
        completed_at TEXT,
        completed_at_epoch INTEGER,
        status TEXT CHECK(status IN ('active', 'completed', 'failed')) NOT NULL DEFAULT 'active'
      );

      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project);
      CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
      CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT UNIQUE NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(4,new Date().toISOString())}ensureWorkerPortColumn(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(s=>s.name==="worker_port")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN worker_port INTEGER"),l.debug("DB","Added worker_port column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(5,new Date().toISOString())}ensurePromptTrackingColumns(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(a=>a.name==="prompt_counter")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN prompt_counter INTEGER DEFAULT 0"),l.debug("DB","Added prompt_counter column to sdk_sessions table")),this.db.query("PRAGMA table_info(observations)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE observations ADD COLUMN prompt_number INTEGER"),l.debug("DB","Added prompt_number column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN prompt_number INTEGER"),l.debug("DB","Added prompt_number column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(6,new Date().toISOString())}repairOrphanedSessionParents(e){let t=this.db.prepare(`
      SELECT COUNT(DISTINCT c.memory_session_id) AS n
      FROM ${e} c
      WHERE c.memory_session_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM sdk_sessions s WHERE s.memory_session_id = c.memory_session_id)
    `).get().n;t!==0&&(this.db.run(`
      INSERT INTO sdk_sessions
        (content_session_id, memory_session_id, project, started_at, started_at_epoch, status)
      SELECT
        c.memory_session_id,
        c.memory_session_id,
        MIN(c.project),
        MIN(c.created_at),
        MIN(c.created_at_epoch),
        'completed'
      FROM ${e} c
      WHERE c.memory_session_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM sdk_sessions s WHERE s.memory_session_id = c.memory_session_id)
      GROUP BY c.memory_session_id
      ON CONFLICT DO NOTHING
    `),l.warn("DB",`Created ${t} stub sdk_sessions parent(s) for orphaned ${e} rows before rebuild (#3378)`))}hasMemorySessionIdOnUpdateCascade(e){return this.db.query(`PRAGMA foreign_key_list(${e})`).all().some(s=>s.table==="sdk_sessions"&&s.from==="memory_session_id"&&s.on_update==="CASCADE")}carryLiveColumnsOntoNewTable(e,t,s){let r=this.db.query(`PRAGMA table_info(${e})`).all(),o=r.filter(i=>!s.includes(i.name));for(let i of o){let a=i.type?` ${i.type}`:"",_=i.dflt_value===null||i.dflt_value===void 0?"":` DEFAULT ${i.dflt_value}`;this.db.run(`ALTER TABLE ${t} ADD COLUMN "${i.name}"${a}${_}`),l.debug("DB",`Carried ${i.name} over the ${e} rebuild (#3849)`)}return r.map(i=>i.name)}removeSessionSummariesUniqueConstraint(){if(!this.db.query("PRAGMA index_list(session_summaries)").all().some(a=>a.unique===1&&a.origin==="u")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString());return}l.debug("DB","Removing UNIQUE constraint from session_summaries.memory_session_id"),this.db.run("BEGIN TRANSACTION"),this.repairOrphanedSessionParents("session_summaries");let s=["id","memory_session_id","project","request","investigated","learned","completed","next_steps","files_read","files_edited","notes","prompt_number","created_at","created_at_epoch"],o=this.db.query("PRAGMA table_info(session_summaries)").all().filter(a=>!s.includes(a.name));this.db.run("DROP TABLE IF EXISTS session_summaries_new"),this.db.run(`
      CREATE TABLE session_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);for(let a of o){let _=a.type?` ${a.type}`:"",d=a.dflt_value===null||a.dflt_value===void 0?"":` DEFAULT ${a.dflt_value}`;this.db.run(`ALTER TABLE session_summaries_new ADD COLUMN "${a.name}"${_}${d}`),l.debug("DB",`Carried ${a.name} over the session_summaries UNIQUE-constraint rebuild (#3890)`)}let i=[...s,...o.map(a=>a.name)].map(a=>`"${a}"`).join(", ");this.db.run(`
      INSERT INTO session_summaries_new (${i})
      SELECT ${i}
      FROM session_summaries
    `),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `),this.recreateFtsTriggersIfIndexed("session_summaries"),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString()),l.debug("DB","Successfully removed UNIQUE constraint from session_summaries.memory_session_id")}addObservationHierarchicalFields(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(8))return;if(this.db.query("PRAGMA table_info(observations)").all().some(r=>r.name==="title")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString());return}l.debug("DB","Adding hierarchical fields to observations table"),this.db.run(`
      ALTER TABLE observations ADD COLUMN title TEXT;
      ALTER TABLE observations ADD COLUMN subtitle TEXT;
      ALTER TABLE observations ADD COLUMN facts TEXT;
      ALTER TABLE observations ADD COLUMN narrative TEXT;
      ALTER TABLE observations ADD COLUMN concepts TEXT;
      ALTER TABLE observations ADD COLUMN files_read TEXT;
      ALTER TABLE observations ADD COLUMN files_modified TEXT;
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString()),l.debug("DB","Successfully added hierarchical fields to observations table")}makeObservationsTextNullable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(9))return;let s=this.db.query("PRAGMA table_info(observations)").all().find(r=>r.name==="text");if(!s||s.notnull===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString());return}l.debug("DB","Making observations.text nullable"),this.db.run("BEGIN TRANSACTION"),this.repairOrphanedSessionParents("observations"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.db.run(`
      CREATE TABLE observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `),this.db.run(`
      INSERT INTO observations_new
      SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
             narrative, concepts, files_read, files_modified, prompt_number,
             created_at, created_at_epoch
      FROM observations
    `),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(`
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `),this.recreateFtsTriggersIfIndexed("observations"),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString()),l.debug("DB","Successfully made observations.text nullable")}recreateFtsTriggersIfIndexed(e){let t=`${e}_fts`;this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(t).length>0&&(this.db.run(`INSERT INTO ${t}(${t}) VALUES('rebuild')`),this.db.run(e==="observations"?Oe:Re))}createUserPromptsTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(10))return;if(this.db.query("PRAGMA table_info(user_prompts)").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString());return}l.debug("DB","Creating user_prompts table"),this.db.run("BEGIN TRANSACTION"),this.db.run(`
      CREATE TABLE user_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER,
        content_session_id TEXT NOT NULL,
        prompt_number INTEGER NOT NULL,
        prompt_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_user_prompts_session ON user_prompts(session_db_id);
      CREATE INDEX idx_user_prompts_claude_session ON user_prompts(content_session_id);
      CREATE INDEX idx_user_prompts_created ON user_prompts(created_at_epoch DESC);
      CREATE INDEX idx_user_prompts_prompt_number ON user_prompts(prompt_number);
      CREATE INDEX idx_user_prompts_lookup ON user_prompts(session_db_id, prompt_number);
      CREATE INDEX idx_user_prompts_content_lookup ON user_prompts(content_session_id, prompt_number);
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),l.debug("DB","Successfully created user_prompts table")}ensureDiscoveryTokensColumn(){this.db.query("PRAGMA table_info(observations)").all().some(o=>o.name==="discovery_tokens")||(this.db.run("ALTER TABLE observations ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),l.debug("DB","Added discovery_tokens column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(o=>o.name==="discovery_tokens")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),l.debug("DB","Added discovery_tokens column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(11,new Date().toISOString())}createPendingMessagesTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(16))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString());return}l.debug("DB","Creating pending_messages table"),this.db.run(`
      CREATE TABLE pending_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER NOT NULL,
        content_session_id TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK(message_type IN ('observation', 'summarize')),
        tool_name TEXT,
        tool_input TEXT,
        tool_response TEXT,
        cwd TEXT,
        last_user_message TEXT,
        last_assistant_message TEXT,
        prompt_number INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing')),
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY (session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_session ON pending_messages(session_db_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_claude_session ON pending_messages(content_session_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString()),l.debug("DB","pending_messages table created successfully")}renameSessionIdColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(17))return;l.debug("DB","Checking session ID columns for semantic clarity rename");let t=0,s=(r,o,i)=>{let a=this.db.query(`PRAGMA table_info(${r})`).all(),_=a.some(E=>E.name===o);return a.some(E=>E.name===i)?!1:_?(this.db.run(`ALTER TABLE ${r} RENAME COLUMN ${o} TO ${i}`),l.debug("DB",`Renamed ${r}.${o} to ${i}`),!0):(l.warn("DB",`Column ${o} not found in ${r}, skipping rename`),!1)};s("sdk_sessions","claude_session_id","content_session_id")&&t++,s("sdk_sessions","sdk_session_id","memory_session_id")&&t++,s("pending_messages","claude_session_id","content_session_id")&&t++,s("observations","sdk_session_id","memory_session_id")&&t++,s("session_summaries","sdk_session_id","memory_session_id")&&t++,s("user_prompts","claude_session_id","content_session_id")&&t++,this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(17,new Date().toISOString()),t>0?l.debug("DB",`Successfully renamed ${t} session ID columns`):l.debug("DB","No session ID column renames needed (already up to date)")}addFailedAtEpochColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(20))return;this.db.query("PRAGMA table_info(pending_messages)").all().some(r=>r.name==="failed_at_epoch")||(this.db.run("ALTER TABLE pending_messages ADD COLUMN failed_at_epoch INTEGER"),l.debug("DB","Added failed_at_epoch column to pending_messages table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(20,new Date().toISOString())}addOnUpdateCascadeToForeignKeys(){let e=!this.hasMemorySessionIdOnUpdateCascade("observations"),t=!this.hasMemorySessionIdOnUpdateCascade("session_summaries");if(!e&&!t){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(21,new Date().toISOString());return}l.debug("DB","Adding ON UPDATE CASCADE to FK constraints on observations and session_summaries"),this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION");let s=["id","memory_session_id","project","text","type","title","subtitle","facts","narrative","concepts","files_read","files_modified","prompt_number","discovery_tokens","created_at","created_at_epoch"],r=`
      CREATE TABLE observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        discovery_tokens INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `,o=`
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `,i=["id","memory_session_id","project","request","investigated","learned","completed","next_steps","files_read","files_edited","notes","prompt_number","discovery_tokens","created_at","created_at_epoch"],a=`
      CREATE TABLE session_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        discovery_tokens INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `,_=`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `;try{e&&(this.db.run("DROP TRIGGER IF EXISTS observations_ai"),this.db.run("DROP TRIGGER IF EXISTS observations_ad"),this.db.run("DROP TRIGGER IF EXISTS observations_au"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.recreateObservationsWithCascade(r,s,o)),t&&(this.db.run("DROP TRIGGER IF EXISTS session_summaries_ai"),this.db.run("DROP TRIGGER IF EXISTS session_summaries_ad"),this.db.run("DROP TRIGGER IF EXISTS session_summaries_au"),this.db.run("DROP TABLE IF EXISTS session_summaries_new"),this.recreateSessionSummariesWithCascade(a,i,_)),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(21,new Date().toISOString()),this.db.run("COMMIT"),this.db.run("PRAGMA foreign_keys = ON"),l.debug("DB","Successfully added ON UPDATE CASCADE to FK constraints")}catch(d){throw this.db.run("ROLLBACK"),this.db.run("PRAGMA foreign_keys = ON"),d instanceof Error?d:new Error(String(d))}}recreateObservationsWithCascade(e,t,s){this.db.run(e);let o=this.carryLiveColumnsOntoNewTable("observations","observations_new",t).map(i=>`"${i}"`).join(", ");this.db.run(`INSERT INTO observations_new (${o}) SELECT ${o} FROM observations`),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(s),this.recreateFtsTriggersIfIndexed("observations")}recreateSessionSummariesWithCascade(e,t,s){this.db.run(e);let o=this.carryLiveColumnsOntoNewTable("session_summaries","session_summaries_new",t).map(i=>`"${i}"`).join(", ");this.db.run(`INSERT INTO session_summaries_new (${o}) SELECT ${o} FROM session_summaries`),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(s),this.recreateFtsTriggersIfIndexed("session_summaries")}addObservationContentHashColumn(){if(this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="content_hash")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString());return}this.db.run("ALTER TABLE observations ADD COLUMN content_hash TEXT"),this.db.run("UPDATE observations SET content_hash = substr(hex(randomblob(8)), 1, 16) WHERE content_hash IS NULL"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash, created_at_epoch)"),l.debug("DB","Added content_hash column to observations table with backfill and index"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString())}addSessionCustomTitleColumn(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(23),s=this.db.query("PRAGMA table_info(sdk_sessions)").all().some(r=>r.name==="custom_title");e&&s||(s||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN custom_title TEXT"),l.debug("DB","Added custom_title column to sdk_sessions table")),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(23,new Date().toISOString()))}addSessionPlatformSourceColumn(){let t=this.db.query("PRAGMA table_info(sdk_sessions)").all().some(i=>i.name==="platform_source"),r=this.db.query("PRAGMA index_list(sdk_sessions)").all().some(i=>i.name==="idx_sdk_sessions_platform_source");this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(24)&&t&&r||(t||(this.db.run(`ALTER TABLE sdk_sessions ADD COLUMN platform_source TEXT NOT NULL DEFAULT '${A}'`),l.debug("DB","Added platform_source column to sdk_sessions table")),this.db.run(`
      UPDATE sdk_sessions
      SET platform_source = '${A}'
      WHERE platform_source IS NULL OR platform_source = ''
    `),r||this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(24,new Date().toISOString()))}addObservationModelColumns(){let e=this.db.query("PRAGMA table_info(observations)").all(),t=e.some(r=>r.name==="generated_by_model"),s=e.some(r=>r.name==="relevance_count");t&&s||(t||this.db.run("ALTER TABLE observations ADD COLUMN generated_by_model TEXT"),s||this.db.run("ALTER TABLE observations ADD COLUMN relevance_count INTEGER DEFAULT 0"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(26,new Date().toISOString()))}ensureSDKSessionsObservedColumns(){let e=this.db.query("PRAGMA table_info(sdk_sessions)").all(),t=e.some(r=>r.name==="observed_model"),s=e.some(r=>r.name==="observed_billing");t&&s||(t||this.db.run("ALTER TABLE sdk_sessions ADD COLUMN observed_model TEXT"),s||this.db.run("ALTER TABLE sdk_sessions ADD COLUMN observed_billing TEXT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(50,new Date().toISOString()))}ensureToolUsesTable(){ps(this.db),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(51,new Date().toISOString())}ensureDeliverablesTable(){bs(this.db)}recordDeliverable(e){return hs(this.db,e)}getDeliverable(e){return Ls(this.db,e)}ensureWorkStateTable(){Is(this.db),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(61,new Date().toISOString()),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(66,new Date().toISOString()),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(67,new Date().toISOString())}ensureProjectRecencyIndexes(){this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_project_nocase_recent ON observations(project COLLATE NOCASE, created_at_epoch DESC)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_merged_into_nocase_recent ON observations(merged_into_project COLLATE NOCASE, created_at_epoch DESC)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_summaries_project_nocase_recent ON session_summaries(project COLLATE NOCASE, created_at_epoch DESC)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_summaries_merged_into_nocase_recent ON session_summaries(merged_into_project COLLATE NOCASE, created_at_epoch DESC)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(63,new Date().toISOString())}ensureMergedIntoProjectCoveringIndexes(){this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_merged_into_nocase_project ON observations(merged_into_project COLLATE NOCASE, project)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_summaries_merged_into_nocase_project ON session_summaries(merged_into_project COLLATE NOCASE, project)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(64,new Date().toISOString())}ensureHookSpoolConsumedTable(){this.db.run(`
      CREATE TABLE IF NOT EXISTS hook_spool_consumed (
        entry_key TEXT PRIMARY KEY,
        consumed_at_epoch_ms INTEGER NOT NULL
      )
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(62,new Date().toISOString())}isHookSpoolEntryConsumed(e){return this.db.prepare("SELECT 1 FROM hook_spool_consumed WHERE entry_key = ?").get(e)!=null}markHookSpoolEntryConsumed(e,t){this.db.prepare("INSERT INTO hook_spool_consumed (entry_key, consumed_at_epoch_ms) VALUES (?, ?) ON CONFLICT(entry_key) DO UPDATE SET consumed_at_epoch_ms = excluded.consumed_at_epoch_ms").run(e,t)}clearHookSpoolEntryConsumed(e){this.db.prepare("DELETE FROM hook_spool_consumed WHERE entry_key = ?").run(e)}pruneHookSpoolConsumedMarkersBefore(e){this.db.prepare("DELETE FROM hook_spool_consumed WHERE consumed_at_epoch_ms < ?").run(e)}ensureTelegramWrapupsTable(){this.db.run(`
      CREATE TABLE IF NOT EXISTS telegram_wrapups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform_source TEXT NOT NULL,
        content_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        route_key TEXT NOT NULL,
        summary_created_at_epoch INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('claimed', 'sent')),
        claimed_at_epoch INTEGER NOT NULL,
        sent_at_epoch INTEGER,
        UNIQUE(platform_source, content_session_id, project, route_key)
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_telegram_wrapups_platform_content ON telegram_wrapups(platform_source, content_session_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(52,new Date().toISOString())}ensureReinforcementColumns(){let e=this.db.query("PRAGMA table_info(observations)").all();e.some(t=>t.name==="reinforcement_dates")||this.db.run("ALTER TABLE observations ADD COLUMN reinforcement_dates TEXT"),e.some(t=>t.name==="last_reinforced")||this.db.run("ALTER TABLE observations ADD COLUMN last_reinforced TEXT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(ko,new Date().toISOString())}dropWriteOnlyUserPromptsFtsAndScopeFtsUpdateTriggers(){let e=this.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger'
        AND name IN ('observations_au', 'session_summaries_au')
        AND sql NOT LIKE '%UPDATE OF%'
    `).all().map(s=>s.name),t=this.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE name IN ('user_prompts_fts', 'user_prompts_ai', 'user_prompts_ad', 'user_prompts_au')
    `).all();if(e.length>0||t.length>0){this.db.run("BEGIN TRANSACTION");try{e.includes("observations_au")&&(this.db.run("DROP TRIGGER observations_au"),this.db.run(Oe)),e.includes("session_summaries_au")&&(this.db.run("DROP TRIGGER session_summaries_au"),this.db.run(Re)),this.db.run("DROP TRIGGER IF EXISTS user_prompts_ai"),this.db.run("DROP TRIGGER IF EXISTS user_prompts_ad"),this.db.run("DROP TRIGGER IF EXISTS user_prompts_au"),this.db.run("DROP TABLE IF EXISTS user_prompts_fts"),this.db.run("COMMIT")}catch(s){throw this.db.run("ROLLBACK"),l.error("DB","Failed to scope FTS update triggers / drop user_prompts_fts, rolled back",{},s instanceof Error?s:new Error(String(s))),s}l.info("DB","Scoped FTS update triggers to indexed columns and dropped the write-only user_prompts_fts",{rescopedTriggers:e,droppedUserPromptsFts:t.length>0})}this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(54,new Date().toISOString())}ensureMergedIntoProjectColumns(){this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="merged_into_project")||this.db.run("ALTER TABLE observations ADD COLUMN merged_into_project TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_merged_into ON observations(merged_into_project)"),this.db.query("PRAGMA table_info(session_summaries)").all().some(s=>s.name==="merged_into_project")||this.db.run("ALTER TABLE session_summaries ADD COLUMN merged_into_project TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_summaries_merged_into ON session_summaries(merged_into_project)")}requeuePromptsDeadLetteredForSize(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(60))return;let t="canonical content: body exceeds % UTF-8 bytes";this.db.transaction(()=>{let s=this.db.prepare(`
        UPDATE user_prompts SET synced_at = NULL
        WHERE synced_at = -1 AND origin_device_id IS NULL
          AND CAST(id AS TEXT) IN (
            SELECT origin_local_id FROM sync_dead_letter
            WHERE lane = 'content' AND kind = 'prompt' AND reason LIKE ?
          )
      `).run(t);this.db.prepare(`
        DELETE FROM sync_dead_letter WHERE lane = 'content' AND kind = 'prompt' AND reason LIKE ?
      `).run(t),s.changes>0&&l.info("DB","Re-queued prompts quarantined for size before the cloud-sync prompt clamp",{prompts:s.changes}),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(60,new Date().toISOString())})()}ensureSessionProjectKeySourceColumn(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(t=>t.name==="project_key_source")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN project_key_source TEXT"),l.debug("DB","Added project_key_source column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(59,new Date().toISOString())}ensureSessionCwdColumn(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(t=>t.name==="cwd")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN cwd TEXT"),l.debug("DB","Added cwd column to sdk_sessions table (#2864)")),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_cwd ON sdk_sessions(cwd)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(53,new Date().toISOString())}ensureProjectNocaseIndexes(){this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_project_nocase ON observations(project COLLATE NOCASE)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_merged_into_nocase ON observations(merged_into_project COLLATE NOCASE)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_summaries_project_nocase ON session_summaries(project COLLATE NOCASE)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_summaries_merged_into_nocase ON session_summaries(merged_into_project COLLATE NOCASE)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project_nocase ON sdk_sessions(project COLLATE NOCASE)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(55,new Date().toISOString())}ensureAdvisorCallsTable(){this.db.run(`
      CREATE TABLE IF NOT EXISTS advisor_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER NOT NULL,
        content_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        platform_source TEXT NOT NULL,
        tool_use_id TEXT NOT NULL,
        advisor_model TEXT,
        cwd TEXT,
        last_user_message TEXT,
        transcript_path TEXT,
        transcript_byte_offset INTEGER,
        advice TEXT NOT NULL,
        occurred_at_epoch INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY (session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
      )
    `),this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_advisor_calls_tool_use ON advisor_calls(tool_use_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_advisor_calls_session ON advisor_calls(session_db_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_advisor_calls_project ON advisor_calls(project)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_advisor_calls_occurred ON advisor_calls(occurred_at_epoch DESC)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(58,new Date().toISOString())}recordAdvisorCall(e){let t=new Date,s=this.db.prepare(`
      INSERT OR IGNORE INTO advisor_calls
      (session_db_id, content_session_id, project, platform_source, tool_use_id, advisor_model, cwd, last_user_message, transcript_path, transcript_byte_offset, advice, occurred_at_epoch, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.sessionDbId,e.contentSessionId,e.project,e.platformSource,e.toolUseId,e.advisorModel??null,e.cwd??null,e.lastUserMessage??null,e.transcriptPath??null,e.transcriptByteOffset??null,e.advice,e.occurredAtEpoch,t.toISOString(),t.getTime());return s.changes>0?{id:Number(s.lastInsertRowid),inserted:!0}:{id:this.db.prepare("SELECT id FROM advisor_calls WHERE tool_use_id = ?").get(e.toolUseId)?.id??0,inserted:!1}}getAdvisorCalls(e,t,s,r){let o="SELECT * FROM advisor_calls",i=[],a=[];s?(a.push("project = ?"),i.push(s)):(a.push("project != ?"),i.push(se)),r&&(a.push("platform_source = ?"),i.push(r)),o+=` WHERE ${a.join(" AND ")}`,o+=" ORDER BY occurred_at_epoch DESC LIMIT ? OFFSET ?",i.push(t+1,e);let _=this.db.prepare(o).all(...i);return{items:_.slice(0,t),hasMore:_.length>t,offset:e,limit:t}}getAdvisorCallById(e){return this.db.prepare("SELECT * FROM advisor_calls WHERE id = ?").get(e)??null}addObservationSubagentColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(27),t=this.db.query("PRAGMA table_info(observations)").all(),s=t.some(i=>i.name==="agent_type"),r=t.some(i=>i.name==="agent_id");s||this.db.run("ALTER TABLE observations ADD COLUMN agent_type TEXT"),r||this.db.run("ALTER TABLE observations ADD COLUMN agent_id TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_agent_type ON observations(agent_type)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_agent_id ON observations(agent_id)");let o=this.db.query("PRAGMA table_info(pending_messages)").all();if(o.length>0){let i=o.some(_=>_.name==="agent_type"),a=o.some(_=>_.name==="agent_id");i||this.db.run("ALTER TABLE pending_messages ADD COLUMN agent_type TEXT"),a||this.db.run("ALTER TABLE pending_messages ADD COLUMN agent_id TEXT")}e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(27,new Date().toISOString())}ensurePendingMessagesToolUseIdColumn(){if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString());return}this.db.query("PRAGMA table_info(pending_messages)").all().some(r=>r.name==="tool_use_id")||this.db.run("ALTER TABLE pending_messages ADD COLUMN tool_use_id TEXT"),this.db.run("BEGIN TRANSACTION");try{this.dedupePendingMessagesByToolUseId(),this.db.run("COMMIT")}catch(r){this.db.run("ROLLBACK");let o=r instanceof Error?r:new Error(String(r));throw l.error("DB","Failed to de-dupe pending_messages by tool_use_id, rolled back",{},o),r}}dedupePendingMessagesByToolUseId(){this.db.run(`
      DELETE FROM pending_messages
       WHERE id IN (
         SELECT id
           FROM (
             SELECT id,
                    ROW_NUMBER() OVER (
                      PARTITION BY session_db_id, tool_use_id
                      ORDER BY CASE status
                        WHEN 'processing' THEN 0
                        WHEN 'pending' THEN 1
                        ELSE 2
                      END, id
                    ) AS duplicate_rank
               FROM pending_messages
              WHERE tool_use_id IS NOT NULL
           )
          WHERE duplicate_rank > 1
         )
    `),this.db.run(`
      -- tool_use_id is optional for summaries and legacy rows; enforce de-dupe
      -- only for rows that came from a concrete tool-use event.
      CREATE UNIQUE INDEX IF NOT EXISTS ux_pending_session_tool
      ON pending_messages(session_db_id, tool_use_id)
      WHERE tool_use_id IS NOT NULL
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString())}addObservationsUniqueContentHashIndex(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(29))return;let t=this.db.query("PRAGMA table_info(observations)").all(),s=t.some(o=>o.name==="memory_session_id"),r=t.some(o=>o.name==="content_hash");if(!s||!r){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(29,new Date().toISOString());return}this.db.run("BEGIN TRANSACTION");try{this.dedupeObservationsByContentHash(),this.db.run("COMMIT")}catch(o){this.db.run("ROLLBACK");let i=o instanceof Error?o:new Error(String(o));throw l.error("DB","Failed to de-dupe observations by content_hash, rolled back",{},i),o}}dedupeObservationsByContentHash(){this.db.run(`
      UPDATE observations
         SET content_hash = '__null_migration_' || id || '__'
       WHERE content_hash IS NULL
    `),this.db.run(`
      DELETE FROM observations
       WHERE id IN (
         SELECT id
           FROM (
             SELECT id,
                    ROW_NUMBER() OVER (
                      PARTITION BY memory_session_id, content_hash
                      ORDER BY id
                    ) AS duplicate_rank
               FROM observations
           )
          WHERE duplicate_rank > 1
       )
    `),this.db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_observations_session_hash
      ON observations(memory_session_id, content_hash)
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(29,new Date().toISOString())}addObservationsMetadataColumn(){this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="metadata")||(this.db.run("ALTER TABLE observations ADD COLUMN metadata TEXT"),l.debug("DB","Added metadata column to observations table (#2116)")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(30,new Date().toISOString())}updateMemorySessionId(e,t){let s=this.db.prepare(`
      SELECT memory_session_id
      FROM sdk_sessions
      WHERE id = ?
    `).get(e);!s||s.memory_session_id===t||(this.db.transaction(()=>{this.db.prepare(`
        UPDATE sdk_sessions
        SET memory_session_id = ?
        WHERE id = ?
      `).run(t,e),this.db.prepare(`
        UPDATE tool_uses
        SET memory_session_id = ?
        WHERE session_db_id = ?
      `).run(t,e)})(),t&&this.requeuePromptSync(e))}enqueueMutationOp(e,t){if(!this.syncOpsEnabled)return;let s=JSON.parse(JSON.stringify(t));if(s.op==="set_prompt_session"){let r=s.target;r?.origin_device_id===null&&(r.origin_device_id="self")}Ct(s),t.op==="set_prompt_session"&&this.cachedStatement(`
        DELETE FROM sync_outbox
        WHERE json_valid(body)
          AND json_extract(body, '$.op') = 'set_prompt_session'
          AND json_extract(body, '$.target.origin_device_id') IS ?
          AND json_extract(body, '$.target.origin_local_id') = ?
      `).run(t.target?.origin_device_id??null,String(t.target?.origin_local_id??"")),this.cachedStatement(`
      INSERT INTO sync_outbox (op_uuid, rev, body, created_at_epoch)
      VALUES (?, ?, ?, ?)
    `).run((0,qe.randomUUID)(),String(e),JSON.stringify(t),Date.now())}requeuePromptSync(e){if(!this.syncOpsEnabled)return;let t=this.cachedStatement(`
      SELECT memory_session_id, project, content_session_id, platform_source
      FROM sdk_sessions WHERE id = ?
    `).get(e);if(!t?.memory_session_id)return;this.db.transaction(()=>{let r=this.cachedStatement(`
        SELECT CAST(id AS TEXT) AS id, CAST(sync_rev AS TEXT) AS sync_rev FROM user_prompts
        WHERE session_db_id = ? AND origin_device_id IS NULL
      `).all(e);if(r.length===0)return;let o=this.cachedStatement(`
        UPDATE user_prompts SET sync_rev = ?, synced_at = NULL
        WHERE id = ? AND origin_device_id IS NULL
      `);for(let i of r){let a=Lt(i.sync_rev);o.run(a,i.id),this.enqueueMutationOp(a,{op:"set_prompt_session",target:{origin_device_id:null,origin_local_id:i.id},fields:{memory_session_id:t.memory_session_id,project:t.project,content_session_id:t.content_session_id,platform_source:t.platform_source}})}})()}markSessionCompleted(e){let t=Date.now(),s=new Date(t).toISOString();this.db.prepare(`
      UPDATE sdk_sessions
      SET status = 'completed', completed_at = ?, completed_at_epoch = ?
      WHERE id = ?
    `).run(s,t,e)}reopenCompletedSession(e){this.db.prepare(`
      UPDATE sdk_sessions
      SET status = 'active', completed_at = NULL, completed_at_epoch = NULL
      WHERE id = ? AND status = 'completed'
    `).run(e)}ensureMemorySessionIdRegistered(e,t,s){let r=this.db.prepare(`
      SELECT id, memory_session_id, worker_port FROM sdk_sessions WHERE id = ?
    `).get(e);if(!r)throw new Error(`Session ${e} not found in sdk_sessions`);return r.memory_session_id===null?(this.db.prepare(`
        UPDATE sdk_sessions SET memory_session_id = ? WHERE id = ?
      `).run(t,e),this.requeuePromptSync(e),l.info("DB","Registered memory_session_id before storage (FK fix)",{sessionDbId:e,newId:t})):r.memory_session_id!==t&&l.debug("DB","Keeping the registered memory_session_id",{sessionDbId:e,registered:r.memory_session_id,offered:t}),typeof s=="number"&&r.worker_port!==s&&this.db.prepare(`
        UPDATE sdk_sessions SET worker_port = ? WHERE id = ?
      `).run(s,e),r.memory_session_id??t}getProjectReadKeys(e){return ss(this.db,e)}getAllProjects(e){let t=e?b(e):void 0,s=`
      SELECT DISTINCT project
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
        AND project != ?
    `,r=[se];return t&&(s+=" AND COALESCE(platform_source, ?) = ?",r.push(A,t)),s+=" ORDER BY project ASC",this.db.prepare(s).all(...r).map(i=>i.project)}getProjectCatalog(){let e=this.db.prepare(`
      SELECT
        COALESCE(platform_source, '${A}') as platform_source,
        project,
        MAX(started_at_epoch) as latest_epoch
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
        AND project != ?
      GROUP BY COALESCE(platform_source, '${A}'), project
      ORDER BY latest_epoch DESC
    `).all(se),t=[],s=new Set,r={};for(let i of e){let a=b(i.platform_source);r[a]||(r[a]=[]),r[a].includes(i.project)||r[a].push(i.project),s.has(i.project)||(s.add(i.project),t.push(i.project))}let o=Es(Object.keys(r));return{projects:t,sources:o,projectsBySource:Object.fromEntries(o.map(i=>[i,r[i]||[]]))}}getSessionCatalog(e={}){let t=Math.min(Math.max(Math.trunc(e.limit??wo),1),Fo),s=Math.max(Math.trunc(e.offset??0),0),r=`
      SELECT
        s.content_session_id,
        s.project,
        COALESCE(s.platform_source, '${A}') as platform_source,
        s.custom_title,
        s.started_at_epoch,
        (
          (SELECT COUNT(*) FROM observations o WHERE o.memory_session_id = s.memory_session_id)
          + (SELECT COUNT(*) FROM session_summaries ss WHERE ss.memory_session_id = s.memory_session_id)
          + (SELECT COUNT(*) FROM user_prompts up WHERE up.session_db_id = s.id)
        ) as item_count
      FROM sdk_sessions s
      WHERE s.project IS NOT NULL AND s.project != ''
        AND s.project != ?
    `,o=[se];e.project&&(r+=" AND s.project COLLATE NOCASE = ?",o.push(e.project)),e.platformSource&&(r+=` AND COALESCE(s.platform_source, '${A}') = ?`,o.push(b(e.platformSource))),r+=" ORDER BY s.started_at_epoch DESC, s.id DESC LIMIT ? OFFSET ?",o.push(t+1,s);let i=this.db.prepare(r).all(...o);return{sessions:i.slice(0,t),hasMore:i.length>t}}getUserPromptById(e){return this.db.prepare(`
      SELECT
        up.*,
        s.memory_session_id,
        s.project,
        COALESCE(s.platform_source, '${A}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      WHERE up.id = ?
    `).get(e)}findRecentDuplicateUserPrompt(e,t,s,r){return Qs(this.db,e,J(t),s,this.resolvePromptSessionDbId(e,r)??void 0)}getRecentSessionsWithStatus(e,t=3,s){let r=[e],o="";return s&&(o=`AND COALESCE(NULLIF(s.platform_source, ''), '${A}') = ?`,r.push(b(s))),r.push(t),this.db.prepare(`
      SELECT * FROM (
        SELECT
          s.memory_session_id,
          s.status,
          s.started_at,
          s.started_at_epoch,
          s.user_prompt,
          CASE WHEN sum.memory_session_id IS NOT NULL THEN 1 ELSE 0 END as has_summary
        FROM sdk_sessions s
        LEFT JOIN session_summaries sum ON s.memory_session_id = sum.memory_session_id
        WHERE s.project COLLATE NOCASE = ? AND s.memory_session_id IS NOT NULL
        ${o}
        GROUP BY s.memory_session_id
        ORDER BY s.started_at_epoch DESC
        LIMIT ?
      )
      ORDER BY started_at_epoch ASC
    `).all(...r)}getObservationsForSession(e,t){let s=[e],r="";return t&&(r=`
        AND EXISTS (
          SELECT 1
          FROM sdk_sessions s
          WHERE s.memory_session_id = observations.memory_session_id
            AND COALESCE(NULLIF(s.platform_source, ''), '${A}') = ?
        )
      `,s.push(b(t))),this.db.prepare(`
      SELECT title, subtitle, type, prompt_number
      FROM observations
      WHERE memory_session_id = ?
      ${r}
      ORDER BY created_at_epoch ASC
    `).all(...s)}getObservationById(e,t){return t?this.db.prepare(`
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions s ON s.memory_session_id = o.memory_session_id
      WHERE o.id = ?
        AND COALESCE(NULLIF(s.platform_source, ''), '${A}') = ?
    `).get(e,b(t))||null:this.db.prepare(`
        SELECT *
        FROM observations
        WHERE id = ?
      `).get(e)||null}upsertToolUse(e){return ms(this.db,e)}settleToolUseSummaries(e){return mt(this.db,e)}listSessionsOwedSummaries(e){return Ss(this.db,e)}countOwedToolUseSummaries(){return fs(this.db)}takeOwedToolUses(e,t,s){return As(this.db,{sessionDbId:e,heldToolUseIds:t,limit:s})}linkToolUsesToObservation(e){return Ts(this.db,e)}getToolUsesByIds(e,t={}){return Os(this.db,e,t)}queryToolUses(e={}){return Rs(this.db,e)}appendWorkStateEntry(e){let t=Ds(this.db,e);return Q({projects:[e.project]},"appendWorkStateEntry"),t}setLocalSyncDeviceId(e){this.localSyncDeviceId=e}getLocalSyncDeviceId(){return this.localSyncDeviceId}getWorkStateEntries(e,t){return Cs(Ms(this.db,this.getProjectReadKeys(e),t,this.localSyncDeviceId),e)}countToolUses(e={}){return Ns(this.db,e)}getObservationsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",platformSource:r,type:o,concepts:i,files:a}=t,_=It(t.limit),d=x(t),E=s==="relevance",c=s==="date_asc"?"ASC":"DESC",u=E?"":`ORDER BY o.created_at_epoch ${c}, o.id ${c}`,p=_&&!E?"LIMIT ?":"",m=e.map(()=>"?").join(","),g=[...e],f=[];if(d.length>0){let O=B("o",d,{includeMerged:!0});f.push(O.sql),g.push(...O.params)}if(r&&(f.push(`COALESCE(NULLIF(s.platform_source, ''), '${A}') = ?`),g.push(b(r))),o)if(Array.isArray(o)){let O=o.map(()=>"?").join(",");f.push(`o.type IN (${O})`),g.push(...o)}else f.push("o.type = ?"),g.push(o);if(i){let O=Array.isArray(i)?i:[i],v=`CASE WHEN json_valid(o.concepts) THEN CASE
        WHEN json_type(o.concepts) = 'array' THEN o.concepts
        WHEN json_type(o.concepts) = 'text' THEN json_array(json_extract(o.concepts, '$'))
        ELSE json_array(o.concepts) END ELSE json_array(o.concepts) END`,S=O.map(()=>`EXISTS (SELECT 1 FROM json_each(${v}) WHERE type = 'text' AND value = ?)`);S.length>0&&(g.push(...O),f.push(`(${S.join(" OR ")})`))}if(a){let O=Array.isArray(a)?a:[a],v=I=>`CASE WHEN json_valid(${I}) THEN CASE WHEN json_type(${I}) = 'array' THEN ${I} ELSE '[]' END ELSE '[]' END`,S=O.map(()=>`(EXISTS (SELECT 1 FROM json_each(${v("o.files_read")}) WHERE type = 'text' AND value LIKE ? ESCAPE '\\') OR EXISTS (SELECT 1 FROM json_each(${v("o.files_modified")}) WHERE type = 'text' AND value LIKE ? ESCAPE '\\'))`);S.length>0&&(O.forEach(I=>{let F=I.replace(/[\\%_]/g,"\\$&");g.push(`%${F}%`,`%${F}%`)}),f.push(`(${S.join(" OR ")})`))}let N=f.length>0?`WHERE o.id IN (${m}) AND ${f.join(" AND ")}`:`WHERE o.id IN (${m})`;p&&g.push(_);let T=this.db.prepare(`
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions s ON s.memory_session_id = o.memory_session_id
      ${N}
      ${u}
      ${p}
    `).all(...g);if(!E)return T;let D=new Map(T.map(O=>[O.id,O])),G=e.map(O=>D.get(O)).filter(O=>!!O);return _?G.slice(0,_):G}getSummaryForSession(e,t){let s=[e],r="";return t&&(r=`
        AND EXISTS (
          SELECT 1
          FROM sdk_sessions sdk
          WHERE sdk.memory_session_id = session_summaries.memory_session_id
            AND COALESCE(NULLIF(sdk.platform_source, ''), '${A}') = ?
        )
      `,s.push(b(t))),this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at,
        created_at_epoch
      FROM session_summaries
      WHERE memory_session_id = ?
      ${r}
      ORDER BY created_at_epoch DESC, id DESC
      LIMIT 1
    `).get(...s)||null}getSessionById(e){return this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project,
             COALESCE(platform_source, '${A}') as platform_source,
             user_prompt, custom_title, status,
             observed_model, observed_billing
      FROM sdk_sessions
      WHERE id = ?
      LIMIT 1
    `).get(e)||null}findSessionDbIdByContentSessionId(e,t){return this.db.prepare(`
      SELECT id
      FROM sdk_sessions
      WHERE COALESCE(NULLIF(platform_source, ''), ?) = ?
        AND content_session_id = ?
      LIMIT 1
    `).get(A,b(t),e)?.id??null}claimTelegramWrapup({platformSource:e,contentSessionId:t,project:s,routeKey:r,summaryCreatedAtEpoch:o}){let i=Date.now();return this.db.prepare(`
      INSERT OR IGNORE INTO telegram_wrapups
      (platform_source, content_session_id, project, route_key, summary_created_at_epoch, status, claimed_at_epoch, sent_at_epoch)
      VALUES (?, ?, ?, ?, ?, 'claimed', ?, NULL)
    `).run(b(e),t,s,r,o,i).changes===1?!0:this.db.prepare(`
      UPDATE telegram_wrapups
      SET summary_created_at_epoch = ?, claimed_at_epoch = ?, sent_at_epoch = NULL
      WHERE platform_source = ?
        AND content_session_id = ?
        AND project = ?
        AND route_key = ?
        AND status = 'claimed'
        AND claimed_at_epoch <= ?
    `).run(o,i,b(e),t,s,r,i-Nn).changes===1}markTelegramWrapupSent({platformSource:e,contentSessionId:t,project:s,routeKey:r}){this.db.prepare(`
      UPDATE telegram_wrapups
      SET status = 'sent', sent_at_epoch = ?
      WHERE platform_source = ?
        AND content_session_id = ?
        AND project = ?
        AND route_key = ?
        AND status = 'claimed'
    `).run(Date.now(),b(e),t,s,r)}releaseTelegramWrapupClaim({platformSource:e,contentSessionId:t,project:s,routeKey:r}){this.db.prepare(`
      DELETE FROM telegram_wrapups
      WHERE platform_source = ?
        AND content_session_id = ?
        AND project = ?
        AND route_key = ?
        AND status = 'claimed'
    `).run(b(e),t,s,r)}setSessionObservedMetadata(e,t,s){this.db.prepare(`
      UPDATE sdk_sessions
      SET observed_model = COALESCE(?, observed_model),
          observed_billing = COALESCE(?, observed_billing)
      WHERE id = ?
    `).run(t||null,s||null,e)}getSdkSessionsBySessionIds(e,t=[]){if(e.length===0&&t.length===0)return[];let s=[...new Set(e),...new Set(t)],r=new Map;for(let o=0;o<s.length;o+=500){let i=s.slice(o,o+500),a=i.filter(c=>typeof c=="string"),_=i.filter(c=>typeof c=="number"),d=[];a.length&&d.push(`memory_session_id IN (${a.map(()=>"?").join(",")})`),_.length&&d.push(`id IN (SELECT session_db_id FROM user_prompts WHERE id IN (${_.map(()=>"?").join(",")}))`);let E=this.db.prepare(`
        SELECT id, content_session_id, memory_session_id, project,
               COALESCE(platform_source, '${A}') as platform_source,
               user_prompt, custom_title,
               started_at, started_at_epoch, completed_at, completed_at_epoch, status
        FROM sdk_sessions
        WHERE ${d.join(" OR ")}
        ORDER BY started_at_epoch DESC
      `);for(let c of E.all(...i))r.set(c.id,c)}return[...r.values()].sort((o,i)=>i.started_at_epoch-o.started_at_epoch)}getPromptNumberFromUserPrompts(e,t,s){let r=this.resolvePromptSessionDbId(e,t),o=r!==null?"session_db_id = ?":"content_session_id = ?",i=r!==null?r:e;return s!==void 0?this.db.prepare(`
        SELECT COALESCE(MAX(prompt_number), 0) as count FROM user_prompts WHERE ${o} AND created_at_epoch <= ?
      `).get(i,s).count:this.db.prepare(`
      SELECT COALESCE(MAX(prompt_number), 0) as count FROM user_prompts WHERE ${o}
    `).get(i).count}getLatestPromptTextFromUserPrompts(e,t){let s=this.resolvePromptSessionDbId(e,t),r=s!==null?"session_db_id = ?":"content_session_id = ?",o=s!==null?s:e;return this.db.prepare(`
      SELECT prompt_text
      FROM user_prompts
      WHERE ${r}
        AND prompt_text IS NOT NULL
        AND length(trim(prompt_text)) > 0
      ORDER BY prompt_number DESC, created_at_epoch DESC
      LIMIT 1
    `).get(o)?.prompt_text??null}createSDKSession(e,t,s,r,o){let i=new Date,a=i.getTime(),_=o?b(o):A,d=J(s);r&&this.validateSetTitleMutation(e,_,r);let E=this.db.prepare(`
      SELECT id, platform_source
      FROM sdk_sessions
      WHERE COALESCE(NULLIF(platform_source, ''), ?) = ?
        AND content_session_id = ?
    `).get(A,_,e);if(E){if(t&&this.db.prepare(`
          UPDATE sdk_sessions SET project = ?
          WHERE id = ? AND (project IS NULL OR project = '' OR (project = 'unknown' AND cwd IS NULL))
        `).run(t,E.id),d&&d!==Ot&&this.db.prepare(`
          UPDATE sdk_sessions SET user_prompt = ?
          WHERE id = ? AND (user_prompt IS NULL OR user_prompt = '' OR user_prompt = ?)
        `).run(d,E.id,Ot),r){let u=this.db.prepare("SELECT custom_title FROM sdk_sessions WHERE id = ?").get(E.id);u&&u.custom_title===null&&(this.db.prepare(`
            UPDATE sdk_sessions SET custom_title = ?
            WHERE id = ? AND custom_title IS NULL
          `).run(r,E.id),this.enqueueSetTitleOp(e,_,r))}return E.id}let c=this.db.prepare(`
      INSERT INTO sdk_sessions
      (content_session_id, memory_session_id, project, platform_source, user_prompt, custom_title, started_at, started_at_epoch, status)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'active')
    `).run(e,t,_,d,r||null,i.toISOString(),a);return r&&this.enqueueSetTitleOp(e,_,r),Number(c.lastInsertRowid)}setSessionCwd(e,t,s){t.trim()&&this.db.prepare("UPDATE sdk_sessions SET cwd = ?, project_key_source = ? WHERE id = ? AND cwd IS NULL").run(t,s??null,e)}getSessionCwd(e){return this.db.prepare("SELECT cwd FROM sdk_sessions WHERE id = ?").get(e)?.cwd??null}enqueueSetTitleOp(e,t,s){let r=this.validateSetTitleMutation(e,t,s);this.enqueueMutationOp("1",r)}validateSetTitleMutation(e,t,s){let r={op:"set_title",target:{content_session_id:e,platform_source:t},fields:{custom_title:s}};return Ct(r),r}saveUserPrompt(e,t,s,r,o,i,a){let _=new Date(a??Date.now()),d=_.getTime(),E=J(s),c=this.resolvePromptSessionDbId(e,r);return this.db.prepare(`
      INSERT INTO user_prompts
      (session_db_id, content_session_id, prompt_number, prompt_text, created_at, created_at_epoch, native_prompt_id, native_prompt_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(c,e,t,E,_.toISOString(),d,o??null,i??null).lastInsertRowid}saveNativeUserPrompt(e,t,s,r,o=r,i={}){if(!s||s.length>256||/[\s\x00-\x1f\x7f]/.test(s))throw new Error("Invalid native prompt identity");let a=J(r),_=(0,qe.createHash)("sha256").update(Ge(o).trim()).digest("hex");return this.db.transaction(()=>{let d=this.db.prepare(`SELECT id, prompt_number, native_prompt_hash FROM user_prompts
        WHERE session_db_id = ? AND native_prompt_id = ?`).get(t,s);if(d){if(d.native_prompt_hash!==_)throw new Error("Native prompt identity was reused with different text");return{id:d.id,promptNumber:d.prompt_number,duplicate:!0}}let E=this.getPromptNumberFromUserPrompts(e,t)+1;return i.reopenSession!==!1&&this.reopenCompletedSession(t),{id:this.saveUserPrompt(e,E,a,t,s,_,i.createdAtEpoch),promptNumber:E,duplicate:!1}}).immediate()}importTranscriptUserPrompt(e){let t=J(e.promptText);if(!t)return{reason:"private"};let s=b(e.platformSource),o=this.db.prepare(`SELECT id FROM sdk_sessions
      WHERE COALESCE(NULLIF(platform_source, ''), ?) = ? AND content_session_id = ?`).get(A,s,e.contentSessionId)?.id;if(o!==void 0){let a=[t,...(e.hookTextVariants??[]).map(J).filter(Boolean)],d=this.db.prepare(`SELECT id, created_at_epoch FROM user_prompts
        WHERE session_db_id = ? AND native_prompt_id IS NULL
          AND prompt_text IN (${a.map(()=>"?").join(", ")})
          AND ABS(created_at_epoch - ?) <= ?
        ORDER BY ABS(created_at_epoch - ?), id`).all(o,...a,e.createdAtEpoch,e.hookMatchWindowMs,e.createdAtEpoch).find(E=>!e.claimedHookRowIds.has(E.id));if(d)return e.claimedHookRowIds.add(d.id),{reason:"recorded-by-hook",hookRowId:d.id}}else{let a=new Date(e.createdAtEpoch).toISOString(),_=this.db.prepare(`INSERT INTO sdk_sessions
        (content_session_id, memory_session_id, project, platform_source, user_prompt, started_at, started_at_epoch, completed_at, completed_at_epoch, status)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'completed')`).run(e.contentSessionId,e.project,s,t,a,e.createdAtEpoch,a,e.createdAtEpoch);o=Number(_.lastInsertRowid)}return{reason:this.saveNativeUserPrompt(e.contentSessionId,o,`transcript:${e.nativePromptId}`,e.promptText,e.promptText,{createdAtEpoch:e.createdAtEpoch,reopenSession:!1}).duplicate?"already-imported":"new"}}listHookRecordedPrompts(e){return this.db.prepare(`SELECT up.id, COALESCE(NULLIF(s.platform_source, ''), ?) AS platformSource,
        s.content_session_id AS contentSessionId, s.project, s.cwd, up.prompt_text AS promptText, up.created_at_epoch AS createdAtEpoch
      FROM user_prompts up JOIN sdk_sessions s ON s.id = up.session_db_id
      WHERE up.created_at_epoch >= ? AND s.project != ?
        AND (up.native_prompt_id IS NULL OR up.native_prompt_id NOT LIKE 'transcript:%')
      ORDER BY up.created_at_epoch, up.id`).all(A,e,se)}streamObservationTokenFields(){return je(this.db.prepare("SELECT title, subtitle, narrative, facts, discovery_tokens FROM observations ORDER BY id"))}getUserPrompt(e,t,s){let r=this.resolvePromptSessionDbId(e,s);return r!==null?this.db.prepare(`
        SELECT prompt_text
        FROM user_prompts
        WHERE session_db_id = ? AND prompt_number = ?
        LIMIT 1
      `).get(r,t)?.prompt_text??null:this.db.prepare(`
      SELECT prompt_text
      FROM user_prompts
      WHERE content_session_id = ? AND prompt_number = ?
      LIMIT 1
    `).get(e,t)?.prompt_text??null}dedupConfig(){let e=ne.loadFromFile(Le),t=(r,o)=>{let i=Number(e[r]);return Number.isFinite(i)?i:o},s=(r,o)=>Math.trunc(t(r,o));return{enabled:e.CLAUDE_MEM_DEDUP_ENABLED==="true",cosineThreshold:t("CLAUDE_MEM_DEDUP_COSINE_THRESHOLD",.8),idfVetoDf:s("CLAUDE_MEM_DEDUP_IDF_VETO_DF",10),minSharedTokens:s("CLAUDE_MEM_DEDUP_MIN_SHARED_TOKENS",2),maxScan:s("CLAUDE_MEM_DEDUP_MAX_SCAN",2e3),maxBackfillRows:s("CLAUDE_MEM_DEDUP_MAX_BACKFILL_ROWS",5e4),minProjectDocs:s("CLAUDE_MEM_DEDUP_MIN_PROJECT_DOCS",10)}}listDedupCandidates(e,t=100,s){let r="SELECT c.id, c.project, c.method, c.score, c.status, c.created_at_epoch, c.observation_id, o1.title AS observation_title, c.duplicate_of_id, o2.title AS duplicate_of_title FROM observation_dedup_candidates c JOIN observations o1 ON o1.id = c.observation_id JOIN observations o2 ON o2.id = c.duplicate_of_id ",o="(? IS NULL OR c.status = ?) ",i="ORDER BY c.score DESC, c.id DESC LIMIT ?",a=s??null;return e?this.db.prepare(`${r}WHERE c.project = ? AND ${o}${i}`).all(e,a,a,t):this.db.prepare(`${r}WHERE ${o}${i}`).all(a,a,t)}resolveDedupCandidate(e,t){return this.db.prepare("UPDATE observation_dedup_candidates SET status = ? WHERE id = ?").run(t,e).changes>0}isDedupEnabled(){return this.dedupConfig().enabled}runDedupScan(){return Js(this.db,this.dedupConfig())}maintainDedupOnInsert(e,t,s,r){js(this.db,e,s),Vs(this.db,e,r.minProjectDocs)&&zs(this.db,e,t,s,r)}storeObservation(e,t,s,r,o=0,i,a,_={}){if(!ut(s.title))throw new Error("storeObservation requires a non-empty title");let d=this.storeObservations(e,t,[s],null,r,o,i,a,_);return{id:d.observationIds[0],createdAtEpoch:d.createdAtEpoch,mergedIntoExisting:d.mergedIntoExisting[0]??!1}}storeSummary(e,t,s,r,o=0,i){let a=i??Date.now(),_=new Date(a).toISOString(),E=this.db.prepare(`
      INSERT INTO session_summaries
      (memory_session_id, project, request, investigated, learned, completed,
       next_steps, files_read, files_edited, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,t,s.request,s.investigated,s.learned,s.completed,s.next_steps,JSON.stringify(s.files_read??[]),JSON.stringify(s.files_edited??[]),s.notes,r||null,o,_,a);return Q({projects:[t]},"storeSummary"),{id:Number(E.lastInsertRowid),createdAtEpoch:a}}storeObservations(e,t,s,r,o,i=0,a,_,d={}){let E=a??Date.now(),c=new Date(E).toISOString(),u=ds(E),p=new Date(E),m=this.dedupConfig(),g=b(this.db.prepare("SELECT platform_source FROM sdk_sessions WHERE memory_session_id = ? LIMIT 1").get(e)?.platform_source),N=this.db.transaction(()=>{let R=[],T=[],D=[],G=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
         generated_by_model, metadata, title_norm_key, reinforcement_dates, last_reinforced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(memory_session_id, content_hash) DO NOTHING
        RETURNING id
      `),O=this.db.prepare("SELECT id FROM observations WHERE memory_session_id = ? AND content_hash = ?");for(let S of s){if(!ut(S.title)){l.debug("DB","Skipping observation with empty title");continue}let I=rs(e,S.title,S.narrative),F=ke(t,g,S.title,me(S.agent_id,S.agent_type));if(m.enabled){let Ve=O.get(e,I);if(Ve){Fe(this.db,Ve.id,p),R.push(Ve.id),T.push(!1);continue}let be=d.skipTitleDedup?null:Xs(this.db,t,F);if(be){this.db.prepare("UPDATE observations SET occurrence_count = occurrence_count + 1 WHERE id = ?").run(be.id),Fe(this.db,be.id,p),R.push(be.id),T.push(!0);continue}}let k=G.get(e,t,S.type,S.title,S.subtitle,JSON.stringify(S.facts),S.narrative,JSON.stringify(S.concepts),JSON.stringify(S.files_read),JSON.stringify(S.files_modified),o||null,i,S.agent_type??null,S.agent_id??null,I,c,E,_||null,S.metadata??null,F,u.dates,u.lastReinforced);if(k){m.enabled&&this.maintainDedupOnInsert(t,k.id,S.title,m),this.indexObservationFiles(k.id,S.files_read,S.files_modified),R.push(k.id),T.push(!1),D.push(k.id);continue}let ae=O.get(e,I);if(!ae)throw new Error(`storeObservations: ON CONFLICT without existing row for content_hash=${I}`);Fe(this.db,ae.id,p),R.push(ae.id),T.push(!1)}let v=null;if(r){let S=bn(s),I=r.files_read??S.files_read,F=r.files_edited??S.files_edited,ae=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, files_read, files_edited, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,t,r.request,r.investigated,r.learned,r.completed,r.next_steps,JSON.stringify(I),JSON.stringify(F),r.notes,o||null,i,c,E);v=Number(ae.lastInsertRowid)}return d.settleToolUses&&mt(this.db,{...d.settleToolUses,state:"done",nowEpoch:E}),{observationIds:R,mergedIntoExisting:T,insertedObservationIds:D,summaryId:v,createdAtEpoch:E}})();return Q({projects:[t]},"storeObservations"),N}updateDiscoveryTokens(e,t,s){e.length===0&&t===null||this.db.transaction(()=>{let r=this.db.prepare("UPDATE observations SET discovery_tokens = ? WHERE id = ?");for(let o of e)r.run(s,o);t!==null&&this.db.prepare("UPDATE session_summaries SET discovery_tokens = ? WHERE id = ?").run(s,t)})()}getSessionSummariesByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",platformSource:r}=t,o=It(t.limit),i=x(t),a=s==="relevance",_=s==="date_asc"?"ASC":"DESC",d=a?"":`ORDER BY ss.created_at_epoch ${_}, ss.id ${_}`,E=o&&!a?"LIMIT ?":"",c=e.map(()=>"?").join(","),u=[...e],p=[];if(i.length>0){let T=B("ss",i,{includeMerged:!0});p.push(T.sql),u.push(...T.params)}r&&(p.push(`COALESCE(NULLIF(s.platform_source, ''), '${A}') = ?`),u.push(b(r)));let m=p.length>0?`AND ${p.join(" AND ")}`:"";E&&u.push(o);let f=this.db.prepare(`
      SELECT ss.*
      FROM session_summaries ss
      LEFT JOIN sdk_sessions s ON s.memory_session_id = ss.memory_session_id
      WHERE ss.id IN (${c}) ${m}
      ${d}
      ${E}
    `).all(...u);if(!a)return f;let N=new Map(f.map(T=>[T.id,T])),R=e.map(T=>N.get(T)).filter(T=>!!T);return o?R.slice(0,o):R}getUserPromptsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",platformSource:r}=t,o=It(t.limit),i=x(t),a=s==="relevance",_=s==="date_asc"?"ASC":"DESC",d=a?"":`ORDER BY up.created_at_epoch ${_}, up.id ${_}`,E=o&&!a?"LIMIT ?":"",c=e.map(()=>"?").join(","),u=[...e],p=[];if(i.length>0){let T=B("s",i,{includeMerged:!1});p.push(T.sql),u.push(...T.params)}r&&(p.push(`COALESCE(NULLIF(s.platform_source, ''), '${A}') = ?`),u.push(b(r)));let m=p.length>0?`AND ${p.join(" AND ")}`:"";E&&u.push(o);let f=this.db.prepare(`
      SELECT
        up.*,
        s.project,
        s.memory_session_id,
        COALESCE(NULLIF(s.platform_source, ''), '${A}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      WHERE up.id IN (${c}) ${m}
      ${d}
      ${E}
    `).all(...u);if(!a)return f;let N=new Map(f.map(T=>[T.id,T])),R=e.map(T=>N.get(T)).filter(T=>!!T);return o?R.slice(0,o):R}getTimelineAroundTimestamp(e,t=10,s=10,r,o,i){return this.getTimelineAroundObservation(null,e,t,s,r,o,i)}getTimelineAroundObservation(e,t,s=10,r=10,o,i,a){let _=i?b(i):void 0,d=x({project:o,projects:a}),E=(O,v,S=!1)=>{let I=[],F=[];if(d.length>0){let k=B(O,d,{includeMerged:S});I.push(k.sql),F.push(...k.params)}return _&&(I.push(`COALESCE(NULLIF(${v}.platform_source, ''), '${A}') = ?`),F.push(_)),{clause:I.length>0?`AND ${I.join(" AND ")}`:"",params:F}},c=E("o","src",!0),u=E("ss","src",!0),p=E("s","s"),m,g;if(e!==null){let O=`
        SELECT o.id, o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE (o.created_at_epoch, o.id) <= (?, ?) ${c.clause}
        ORDER BY o.created_at_epoch DESC
        LIMIT ?
      `,v=`
        SELECT o.id, o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE (o.created_at_epoch, o.id) >= (?, ?) ${c.clause}
        ORDER BY o.created_at_epoch ASC
        LIMIT ?
      `;try{let S=this.db.prepare(O).all(t,e,...c.params,s+1),I=this.db.prepare(v).all(t,e,...c.params,r+1);if(S.length===0&&I.length===0)return{observations:[],sessions:[],prompts:[]};m=S.length>0?S[S.length-1].created_at_epoch:t,g=I.length>0?I[I.length-1].created_at_epoch:t}catch(S){return S instanceof Error?l.error("DB","Error getting boundary observations",{project:o},S):l.error("DB","Error getting boundary observations with non-Error",{},new Error(String(S))),{observations:[],sessions:[],prompts:[]}}}else{let O=`
        SELECT o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.created_at_epoch < ? ${c.clause}
        ORDER BY o.created_at_epoch DESC
        LIMIT ?
      `,v=`
        SELECT o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.created_at_epoch > ? ${c.clause}
        ORDER BY o.created_at_epoch ASC
        LIMIT ?
      `;try{let S=this.db.prepare(O).all(t,...c.params,s),I=this.db.prepare(v).all(t,...c.params,r);m=S.length>0?S[S.length-1].created_at_epoch:t,g=I.length>0?I[I.length-1].created_at_epoch:t}catch(S){return S instanceof Error?l.error("DB","Error getting boundary timestamps",{project:o},S):l.error("DB","Error getting boundary timestamps with non-Error",{},new Error(String(S))),{observations:[],sessions:[],prompts:[]}}}let f=`
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
      WHERE o.created_at_epoch >= ? AND o.created_at_epoch <= ? ${c.clause}
      ORDER BY o.created_at_epoch ASC, o.id ASC
    `,N=`
      SELECT ss.*
      FROM session_summaries ss
      LEFT JOIN sdk_sessions src ON src.memory_session_id = ss.memory_session_id
      WHERE ss.created_at_epoch >= ? AND ss.created_at_epoch <= ? ${u.clause}
      ORDER BY ss.created_at_epoch ASC, ss.id ASC
    `,R=`
      SELECT up.*, s.project, s.memory_session_id, COALESCE(NULLIF(s.platform_source, ''), '${A}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      WHERE up.created_at_epoch >= ? AND up.created_at_epoch <= ? ${p.clause}
      ORDER BY up.created_at_epoch ASC, up.id ASC
    `,T=this.db.prepare(f).all(m,g,...c.params),D=this.db.prepare(N).all(m,g,...u.params),G=this.db.prepare(R).all(m,g,...p.params);return{observations:T,sessions:D.map(O=>({id:O.id,memory_session_id:O.memory_session_id,project:O.project,request:O.request,completed:O.completed,next_steps:O.next_steps,created_at:O.created_at,created_at_epoch:O.created_at_epoch})),prompts:G.map(O=>({id:O.id,content_session_id:O.content_session_id,prompt_number:O.prompt_number,prompt_text:O.prompt_text,project:O.project,platform_source:O.platform_source,created_at:O.created_at,created_at_epoch:O.created_at_epoch}))}}getOrCreateManualSession(e,t=A){let s=b(t),r=`manual-${e}-${s}`,o=`manual-content-${e}-${s}`;if(this.db.prepare("SELECT memory_session_id FROM sdk_sessions WHERE memory_session_id = ?").get(r))return r;let a=new Date;return this.db.prepare(`
      INSERT INTO sdk_sessions (memory_session_id, content_session_id, project, platform_source, started_at, started_at_epoch, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(r,o,e,s,a.toISOString(),a.getTime()),l.info("SESSION","Created manual session",{memorySessionId:r,project:e,platformSource:s}),r}close(){this.db.close()}cachedStatement(e){let t=this.statementCache.get(e);return t||(t=this.db.prepare(e),this.statementCache.set(e,t)),t}importSdkSession(e){let t=b(e.platform_source),s=this.db.prepare(`SELECT id FROM sdk_sessions
       WHERE platform_source = ? AND content_session_id = ?`).get(t,e.content_session_id);if(s)return{imported:!1,id:s.id};let r=e.custom_title??null;if(r!==null&&typeof r!="string")throw new TypeError("Imported custom_title must be a string or null");let o=this.db.prepare(`
      INSERT INTO sdk_sessions (
        content_session_id, memory_session_id, project, platform_source, user_prompt, custom_title,
        started_at, started_at_epoch, completed_at, completed_at_epoch, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);return this.db.transaction(()=>({imported:!0,id:o.run(e.content_session_id,e.memory_session_id,e.project,t,e.user_prompt,r,e.started_at,e.started_at_epoch,e.completed_at,e.completed_at_epoch,e.status).lastInsertRowid}))()}importSessionSummary(e){if(typeof e?.memory_session_id!="string"||e.memory_session_id.trim()==="")return l.warn("DB","Skipping imported session summary without memory_session_id",{project:typeof e?.project=="string"?e.project:null}),{imported:!1,id:0};let t=this.db.prepare(`SELECT id FROM session_summaries WHERE memory_session_id = ?
        AND request IS ? AND investigated IS ? AND learned IS ? AND completed IS ?
        AND next_steps IS ? AND files_read IS ? AND files_edited IS ? AND notes IS ?
        AND prompt_number IS ? AND created_at_epoch = ?`).get(e.memory_session_id,h(e.request),h(e.investigated),h(e.learned),h(e.completed),h(e.next_steps),h(e.files_read),h(e.files_edited),h(e.notes),e.prompt_number??null,e.created_at_epoch);if(t)return{imported:!1,id:t.id};let r=this.db.prepare(`
      INSERT INTO session_summaries (
        memory_session_id, project, request, investigated, learned,
        completed, next_steps, files_read, files_edited, notes,
        prompt_number, discovery_tokens, created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.memory_session_id,e.project,h(e.request),h(e.investigated),h(e.learned),h(e.completed),h(e.next_steps),h(e.files_read),h(e.files_edited),h(e.notes),e.prompt_number,e.discovery_tokens||0,e.created_at,e.created_at_epoch);return Q({projects:[e.project]},"importSessionSummary"),{imported:!0,id:r.lastInsertRowid}}importObservation(e){if(typeof e?.memory_session_id!="string"||e.memory_session_id.trim()==="")return l.warn("DB","Skipping imported observation without memory_session_id",{title:typeof e?.title=="string"?e.title:null,type:typeof e?.type=="string"?e.type:null}),{imported:!1,id:0};let t=this.db.prepare(`
      SELECT id FROM observations
      WHERE memory_session_id = ? AND text IS ? AND type = ?
        AND title IS ? AND subtitle IS ? AND facts IS ? AND narrative IS ?
        AND concepts IS ? AND files_read IS ? AND files_modified IS ?
        AND prompt_number IS ? AND agent_type IS ?
        AND agent_id IS ? AND created_at_epoch = ?
    `).get(e.memory_session_id,h(e.text),e.type,h(e.title),h(e.subtitle),h(e.facts),h(e.narrative),h(e.concepts),h(e.files_read),h(e.files_modified),e.prompt_number??null,e.agent_type??null,e.agent_id??null,e.created_at_epoch);if(t)return{imported:!1,id:t.id};let s=this.db.prepare(`
      INSERT INTO observations (
        memory_session_id, project, text, type, title, subtitle,
        facts, narrative, concepts, files_read, files_modified,
        prompt_number, discovery_tokens, agent_type, agent_id,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),r=this.db.transaction(()=>{let i=s.run(e.memory_session_id,e.project,h(e.text),e.type,h(e.title),h(e.subtitle),h(e.facts),h(e.narrative),h(e.concepts),h(e.files_read),h(e.files_modified),e.prompt_number,e.discovery_tokens||0,e.agent_type??null,e.agent_id??null,e.created_at,e.created_at_epoch).lastInsertRowid;return is(this.db,i,e.files_read,e.files_modified),i})();return Q({projects:[e.project]},"importObservation"),{imported:!0,id:r}}rebuildObservationsFTSIndex(){this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run("INSERT INTO observations_fts(observations_fts) VALUES('rebuild')")}importUserPrompt(e){let t=null,s=e.platform_source?b(e.platform_source):void 0;if(typeof e.session_db_id=="number"){let a=this.db.prepare(`
        SELECT id, content_session_id, COALESCE(NULLIF(platform_source, ''), '${A}') as platform_source
        FROM sdk_sessions
        WHERE id = ?
        LIMIT 1
      `).get(e.session_db_id);a&&a.content_session_id===e.content_session_id&&(!s||b(a.platform_source)===s)&&(t=a.id)}t===null&&(t=this.resolvePromptSessionDbId(e.content_session_id,void 0,s));let r=this.db.prepare(`
      SELECT id FROM user_prompts
      WHERE ${t!==null?"session_db_id = ?":"content_session_id = ?"} AND prompt_number = ?
    `).get(t??e.content_session_id,e.prompt_number);return r?{imported:!1,id:r.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO user_prompts (
        session_db_id, content_session_id, prompt_number, prompt_text,
        created_at, created_at_epoch, native_prompt_id, native_prompt_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(t,e.content_session_id,e.prompt_number,h(e.prompt_text),e.created_at,e.created_at_epoch,e.native_prompt_id??null,e.native_prompt_hash??null).lastInsertRowid}}};0&&(module.exports={SessionStore,TELEGRAM_WRAPUP_CLAIM_STALE_AFTER_MS,rollupObservationFileLists});
//# sourceMappingURL=SessionStore.js.map
