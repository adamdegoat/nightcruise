// Walkable waypoint graph for the captain. Nodes are placed per room, edges are built automatically between
// nearby nodes with a clear straight line (doors count as passable: he opens them). A* for paths.
import * as THREE from 'three';

const MARGIN = 0.26;   // his body radius: keep lines this far from furniture and walls

export function segmentHitsBox(ax, az, bx, bz, c, m = MARGIN) {
  // slab test of segment A->B against the box grown by m
  const minX = c.minX - m, maxX = c.maxX + m, minZ = c.minZ - m, maxZ = c.maxZ + m;
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, d, lo, hi] of [[ax, dx, minX, maxX], [az, dz, minZ, maxZ]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; }
    let ta = (lo - p) / d, tb = (hi - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

export function lineClear(level, ax, az, bx, bz, { ignoreDoors = false, m = MARGIN } = {}) {
  for (const c of level.colliders) {
    if (c.disabled) continue;
    if (ignoreDoors && c.door) continue;
    if (segmentHitsBox(ax, az, bx, bz, c, m)) return false;
  }
  return true;
}

function inside(level, x, z) {
  for (const c of level.colliders) {
    if (c.door) continue;
    if (x > c.minX - MARGIN && x < c.maxX + MARGIN && z > c.minZ - MARGIN && z < c.maxZ + MARGIN) return true;
  }
  return false;
}

export function buildNav(level) {
  const pts = [];
  const add = (x, z, room) => { if (!inside(level, x, z)) pts.push({ x, z, room }); };
  // corridor, plus a node in front of every cabin door
  // two lanes so clutter in the middle of the corridor never cuts it in half
  for (let x = 0.6; x <= 27.6; x += 1.2) for (const z of [-0.42, 0, 0.42]) add(x, z, 'corridor');
  for (let i = 0; i < 6; i++) for (const side of [1, -1]) {
    const x0 = 3 + 4 * i, dx = x0 + 0.8;
    add(dx, 0, 'corridor');
    add(dx, side * 1.75, 'cabin');
    for (let x = x0 + 0.7; x <= x0 + 3.3; x += 0.65) for (let z = 1.7; z <= 3.5; z += 0.6) add(x, side * z, 'cabin');
  }
  // crew room (the stairwell corner is fenced)
  for (const [x, z] of [[-0.6, 0], [-2, -1.6], [-3.8, -1.6], [-5.6, -1.6], [-5.6, 0.4], [-3.8, 0.4], [-2, 0.4], [-6, -2.8], [-2.5, -2.8]]) add(x, z, 'crew');
  // dining hall + bar grid, kitchen grid
  for (let x = 28.6; x <= 43.4; x += 0.75) for (let z = -6.5; z <= 6.5; z += 0.75) {
    if (x > 38 && z < 0) continue;
    add(x, z, x > 38.6 ? 'bar' : 'hall');
  }
  add(37.3, -3.5, 'hall'); add(38.7, -3.5, 'kitchen'); add(39.5, -3.5, 'kitchen');
  for (let x = 38.7; x <= 43.4; x += 1.1) for (let z = -6.2; z <= -0.4; z += 1.1) add(x, z, 'kitchen');

  // edges
  const nodes = pts.map((p, i) => ({ ...p, i, links: [] }));
  for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
    const A = nodes[a], B = nodes[b];
    const d = Math.hypot(A.x - B.x, A.z - B.z);
    if (d > 2.2) continue;
    if (!lineClear(level, A.x, A.z, B.x, B.z, { ignoreDoors: true })) continue;
    A.links.push({ n: b, d }); B.links.push({ n: a, d });
  }
  const nav = { nodes };
  nav.nearest = (x, z, needClear = true) => {
    let best = null, bd = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd && (!needClear || d < 0.8 || lineClear(level, x, z, n.x, n.z, { ignoreDoors: true, m: 0.1 }))) { bd = d; best = n; }
    }
    return best;
  };
  nav.path = (from, to) => astar(nodes, from.i, to.i);
  nav.graphDist = (from) => dijkstra(nodes, from.i);
  return nav;
}

function astar(nodes, s, g) {
  const open = new Set([s]), came = new Map(), gs = new Map([[s, 0]]);
  const h = (i) => Math.hypot(nodes[i].x - nodes[g].x, nodes[i].z - nodes[g].z);
  const fs = new Map([[s, h(s)]]);
  while (open.size) {
    let cur = null, bf = Infinity;
    for (const i of open) { const f = fs.get(i); if (f < bf) { bf = f; cur = i; } }
    if (cur === g) {
      const out = [nodes[cur]];
      while (came.has(cur)) { cur = came.get(cur); out.unshift(nodes[cur]); }
      return out;
    }
    open.delete(cur);
    for (const { n, d } of nodes[cur].links) {
      const t = gs.get(cur) + d;
      if (t < (gs.get(n) ?? Infinity)) { came.set(n, cur); gs.set(n, t); fs.set(n, t + h(n)); open.add(n); }
    }
  }
  return null;
}

function dijkstra(nodes, s) {
  const dist = new Array(nodes.length).fill(Infinity); dist[s] = 0;
  const q = [s];
  while (q.length) {
    q.sort((a, b) => dist[a] - dist[b]);
    const cur = q.shift();
    for (const { n, d } of nodes[cur].links) {
      if (dist[cur] + d < dist[n]) { dist[n] = dist[cur] + d; q.push(n); }
    }
  }
  return dist;
}
