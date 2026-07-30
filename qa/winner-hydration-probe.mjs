import WebSocket from "ws";
const baseUrl="http://localhost:3000"; const wsBase="ws://localhost:3000/ws";
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function api(path,options={}){const res=await fetch(`${baseUrl}${path}`,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});let body=null;try{body=await res.json();}catch{} return {status:res.status,body};}
function connect(slug,pid){return new Promise((resolve,reject)=>{const ws=new WebSocket(`${wsBase}?slug=${slug}`);const msgs=[];const t=setTimeout(()=>reject(new Error("timeout")),5000);ws.on("open",()=>{clearTimeout(t);ws.send(JSON.stringify({type:"join",slug,participantId:pid,displayName:pid}));resolve({ws,msgs});});ws.on("message",raw=>{try{msgs.push(JSON.parse(raw.toString()));}catch{}});ws.on("error",reject);});}
function latest(msgs,type){for(let i=msgs.length-1;i>=0;i-=1){if(msgs[i]?.type===type) return msgs[i];}return null;}
async function waitFor(fn,label,t=8000){const s=Date.now();while(Date.now()-s<t){if(fn()) return;await sleep(20);}throw new Error(`wait ${label}`);}

const items=[{_id:"A",title:"A"},{_id:"B",title:"B"},{_id:"C",title:"C"},{_id:"D",title:"D"}];
const create=await api("/api/sessions",{method:"POST",body:JSON.stringify({title:"winner-probe",items})});
const slug=create.body.slug; const host=`winner-host-${Date.now()}`; const friend=`winner-friend-${Date.now()}`;
await api(`/api/sessions/${slug}`,{method:"POST",body:JSON.stringify({participantId:host,displayName:host})});
await api(`/api/sessions/${slug}`,{method:"POST",body:JSON.stringify({participantId:friend,displayName:friend})});

const c=await connect(slug,host); await waitFor(()=>latest(c.msgs,"room-state"),"room");
c.ws.send(JSON.stringify({type:"start-game",slug,currentRoundItems:items})); await waitFor(()=>latest(c.msgs,"game-started"),"start");

for (const v of [
  {round:0,match:0,choice:0,playerId:host},
  {round:0,match:0,choice:0,playerId:friend},
  {round:0,match:1,choice:2,playerId:host},
  {round:0,match:1,choice:2,playerId:friend},
]) { c.ws.send(JSON.stringify({type:"vote",slug,...v})); await sleep(30); }
await waitFor(()=>latest(c.msgs,"vote-update")?.gameState?.round===1,"to final");

for (const v of [
  {round:1,match:0,choice:0,playerId:host},
  {round:1,match:0,choice:0,playerId:friend},
]) { c.ws.send(JSON.stringify({type:"vote",slug,...v})); await sleep(30); }
await waitFor(()=>latest(c.msgs,"vote-update")?.roomStatus==="completed" && latest(c.msgs,"vote-update")?.gameState?.winner?._id==="A","completed");
console.log("completed-update", JSON.stringify(latest(c.msgs,"vote-update")));
c.ws.close(); await sleep(800);

const c2=await connect(slug,host);
await waitFor(()=>latest(c2.msgs,"room-state")?.roomStatus==="completed" && latest(c2.msgs,"room-state")?.gameState?.winner?._id==="A","hydrate completed");
console.log("reconnect-room-state", JSON.stringify(latest(c2.msgs,"room-state")));
c2.ws.close();

const snap=await api(`/api/sessions/${slug}`);
console.log("api-snapshot", JSON.stringify({roomStatus:snap.body?.roomStatus,round:snap.body?.gameState?.round,currentMatch:snap.body?.gameState?.currentMatch,winner:snap.body?.gameState?.winner?._id||null}));
