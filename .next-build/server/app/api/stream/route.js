"use strict";(()=>{var e={};e.id=160,e.ids=[160],e.modules={399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},4387:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>h,patchFetch:()=>v,requestAsyncStorage:()=>l,routeModule:()=>p,serverHooks:()=>f,staticGenerationAsyncStorage:()=>m});var a={};r.r(a),r.d(a,{GET:()=>c,dynamic:()=>d,runtime:()=>u});var n=r(9303),o=r(8716),i=r(670),s=r(1585);let u="nodejs",d="force-dynamic";async function c(e){let t=new TextEncoder;return new Response(new ReadableStream({start(r){let a=e=>{try{r.enqueue(t.encode(e))}catch{}};a(`retry: 3000

`),a(`event: ping
data: ${JSON.stringify({ok:!0})}

`);let n=(0,s.Ld)(e=>{a(`event: ${e.type}
data: ${JSON.stringify(e)}

`)}),o=setInterval(()=>a(`: keepalive

`),15e3);e.signal.addEventListener("abort",()=>{clearInterval(o),n();try{r.close()}catch{}})}}),{headers:{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache, no-transform",Connection:"keep-alive"}})}let p=new n.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/stream/route",pathname:"/api/stream",filename:"route",bundlePath:"app/api/stream/route"},resolvedPagePath:"/Users/houjunyi/WorkBuddy/2026-11-01-12-32-00/ai-office/src/app/api/stream/route.ts",nextConfigOutput:"",userland:a}),{requestAsyncStorage:l,staticGenerationAsyncStorage:m,serverHooks:f}=p,h="/api/stream/route";function v(){return(0,i.patchFetch)({serverHooks:f,staticGenerationAsyncStorage:m})}},9303:(e,t,r)=>{e.exports=r(517)},1585:(e,t,r)=>{r.d(t,{Ld:()=>n,h:()=>s,j8:()=>o});let a=new Set;function n(e){return a.add(e),()=>a.delete(e)}function o(e){for(let t of Array.from(a))try{t(e)}catch{}}let i=globalThis,s=i.__aiOffice??={}}};var t=require("../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),a=t.X(0,[948],()=>r(4387));module.exports=a})();