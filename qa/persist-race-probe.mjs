import WebSocket from "ws";
const baseUrl = "http://localhost:3000";
const wsBase = "ws://localhost:3000/ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

function connect(slug, pid) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}?slug=${slug}`);
    const messages = [];
    const t = setTimeout(() => reject(new Error("timeout")), 5000);
    ws.on("open", () => {
      clearTimeout(t);
      ws.send(JSON.stringify({ type: "join", slug, participantId: pid, displayName: pid }));
      resolve({ ws, messages });
    });
    ws.on("message", (raw) => { try { messages.push(JSON.parse(raw.toString())); } catch {} });
    ws.on("error", reject);
  });
}

function latest(messages, type) { for (let i=messages.length-1;i>=0;i-=1){ if(messages[i]?.type===type) return messages[i]; } return null; }

async function waitFor(fn, label, t=8000) {
  const s=Date.now(); while(Date.now()-s<t){ if(fn()) return; await sleep(20);} throw new Error(`wait ${label}`);
}

const items=[{_id:"A",title:"A"},{_id:"B",title:"B"},{_id:"C",title:"C"},{_id:"D",title:"D"}];
const create=await api("/api/sessions",{method:"POST",body:JSON.stringify({title:"probe",items})});
const slug=create.body.slug;
const host="probe-host"; const friend="probe-friend";
await api(`/api/sessions/${slug}`,{method:"POST",body:JSON.stringify({participantId:host,displayName:host})});
await api(`/api/sessions/${slug}`,{method:"POST",body:JSON.stringify({participantId:friend,displayName:friend})});

const c=await connect(slug,host);
await waitFor(()=>latest(c.messages,"room-state"),"room-state");
c.ws.send(JSON.stringify({type:"start-game",slug,currentRoundItems:items}));
await waitFor(()=>latest(c.messages,"game-started"),"start");
c.ws.send(JSON.stringify({type:"vote",slug,playerId:host,round:0,match:0,choice:0}));
c.ws.send(JSON.stringify({type:"vote",slug,playerId:friend,round:0,match:0,choice:0}));
await waitFor(()=>latest(c.messages,"vote-update")?.gameState?.currentMatch===1,"m0");
c.ws.send(JSON.stringify({type:"vote",slug,playerId:host,round:0,match:1,choice:2}));
c.ws.send(JSON.stringify({type:"vote",slug,playerId:friend,round:0,match:1,choice:2}));
await waitFor(()=>latest(c.messages,"vote-update")?.gameState?.round===1,"to round1");
console.log("before-close", JSON.stringify(latest(c.messages,"vote-update")?.gameState));
c.ws.close();

for (const delay of [0,200,500,1000,2000,5000]) {
  if(delay) await sleep(delay);
  const s=await api(`/api/sessions/${slug}`);
  console.log(`snapshot+${delay}ms`, JSON.stringify({roomStatus:s.body?.roomStatus, round:s.body?.gameState?.round, match:s.body?.gameState?.currentMatch, winner:s.body?.gameState?.winner?._id||null}));
}
