import dgram from "node:dgram";
import { randomBytes } from "node:crypto";
import os from "node:os";

export const DISCOVERY_PORT = () => Number(process.env.DECAL_ITS_DISCOVERY_PORT || 42099);
const QUERY = "decal-its/query";
const HERE = "decal-its/here";
const MAX_PACKET = 1024;

/** Directed-broadcast address of every active IPv4 interface. Limited broadcast and multicast are blocked on many networks. */
export function broadcastTargets() {
  const extra = String(process.env.DECAL_ITS_DISCOVERY_TARGETS || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (extra.length > 0) return extra;
  const targets = new Set();
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const item of addresses ?? []) {
      if (item.family !== "IPv4" || item.internal) continue;
      const ip = item.address.split(".").map(Number);
      const mask = item.netmask.split(".").map(Number);
      targets.add(ip.map((part, index) => (part | (~mask[index] & 255))).join("."));
    }
  }
  return [...targets];
}

/** Answers "who is the number authority for this project?" with the LAN API port. Never answers for unknown projects. */
export function startResponder({ projects, label, port }) {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  let window = { start: Date.now(), count: 0 };
  socket.on("error", () => {});
  socket.on("message", async (message, remote) => {
    if (message.length > MAX_PACKET) return;
    if (Date.now() - window.start > 1000) window = { start: Date.now(), count: 0 };
    if (++window.count > 30) return;
    let packet;
    try { packet = JSON.parse(message.toString("utf8")); } catch { return; }
    if (packet?.k !== QUERY || packet.v !== 1 || typeof packet.p !== "string" || typeof packet.q !== "string") return;
    if (!(await projects()).has(packet.p)) return;
    const reply = Buffer.from(JSON.stringify({ k: HERE, v: 1, p: packet.p, q: packet.q, label, port: port() }));
    socket.send(reply, remote.port, remote.address);
  });
  socket.bind(DISCOVERY_PORT(), () => { try { socket.setBroadcast(true); } catch { /* ignore */ } });
  return { close: () => { try { socket.close(); } catch { /* already closed */ } } };
}

/** Looks for the authority of a project on the local network. Returns every distinct answer. */
export function discoverAuthority(projectId, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const queryId = randomBytes(8).toString("hex");
    const found = new Map();
    const finish = () => { try { socket.close(); } catch { /* closed */ } resolve([...found.values()]); };
    socket.on("error", finish);
    socket.on("message", (message, remote) => {
      if (message.length > MAX_PACKET) return;
      try {
        const packet = JSON.parse(message.toString("utf8"));
        if (packet.k !== HERE || packet.q !== queryId || packet.p !== projectId || !Number.isInteger(packet.port)) return;
        found.set(`${remote.address}:${packet.port}`, { address: remote.address, port: packet.port, label: String(packet.label ?? "").slice(0, 60) });
      } catch { /* ignore noise */ }
    });
    socket.bind(0, () => {
      try { socket.setBroadcast(true); } catch { /* ignore */ }
      const query = Buffer.from(JSON.stringify({ k: QUERY, v: 1, p: projectId, q: queryId }));
      for (const target of broadcastTargets()) socket.send(query, DISCOVERY_PORT(), target, () => {});
      setTimeout(finish, timeoutMs);
    });
  });
}
