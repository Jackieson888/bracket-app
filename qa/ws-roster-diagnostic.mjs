import WebSocket from "ws";
const baseUrl = "http://localhost:3000";
const slugRes = await fetch(`${baseUrl}/api/sessions`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ title:"diag", items:[{_id:"A",title:"A"},{_id:"B",title:"B"}] })});
const created = await slugRes.json();
const slug = created.slug;
const host = `diag-host-${Date.now()}`;
const friend = `diag-friend-${Date.now()}`;
await fetch(`${baseUrl}/api/sessions/${slug}`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ participantId: host, displayName: "Host" })});
await fetch(`${baseUrl}/api/sessions/${slug}`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ participantId: friend, displayName: "Friend" })});

function open(id, name) {
  return new Promise((resolve, reject)=>{
    const ws = new WebSocket(`ws://localhost:3000/ws?slug=${encodeURIComponent(slug)}&participantId=${encodeURIComponent(id)}&displayName=${encodeURIComponent(name)}`);
    const messages = [];
    const timeout = setTimeout(()=>reject(new Error(`timeout ${id}`)),5000);
    ws.on("message", (raw)=>{ try { messages.push(JSON.parse(raw.toString())); } catch {} });
    ws.on("open", ()=>{
      clearTimeout(timeout);
      ws.send(JSON.stringify({ type:"join", slug, participantId:id, displayName:name }));
      resolve({ ws, messages, id });
    });
    ws.on("error", reject);
  });
}

const h = await open(host, "Host");
const f = await open(friend, "Friend");
await new Promise(r=>setTimeout(r, 1500));
console.log(JSON.stringify({
  slug,
  hostStates: h.messages.filter(m=>m.type==="room-state").map(m=>m.clients.map(c=>c.id)),
  friendStates: f.messages.filter(m=>m.type==="room-state").map(m=>m.clients.map(c=>c.id))
}, null, 2));
h.ws.close();
f.ws.close();
