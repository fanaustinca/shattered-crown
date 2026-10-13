import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=ultra`, { width: 640, height: 360 });
const r = await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(11); SC.teleport(-1250 + 8, 350 + 10); SC.stream(-1250, 350); SC.advance(2);
  const w = g.physics.world;
  const time = () => { const t0 = performance.now(); for (let i = 0; i < 30; i++) w.step(); return (performance.now() - t0) / 30; };
  w.profilerEnabled = true;
  const out = { base: time() };
  const tk = ['timingStep','timingCollisionDetection','timingBroadPhase','timingNarrowPhase','timingSolver','timingVelocityAssembly','timingVelocityResolution','timingVelocityUpdate','timingVelocityWriteback','timingCcd','timingIslandConstruction','timingUserChanges'];
  out.timings = Object.fromEntries(tk.map((k) => [k, +(w[k]?.() ?? -1).toFixed(3)]));
  const doors = []; for (const l of g.settlements.live.values()) for (const d of l.doors) doors.push(d);
  const R = window.RAPIER || g.physics.R;
  for (const d of doors) d.body.setBodyType(0, false); // Fixed
  out.doorsFixed = time();
  for (const d of doors) d.body.setBodyType(2, false);
  for (const d of doors) d.body.setEnabled(false);
  out.doorsOff = time();
  for (const d of doors) d.body.setEnabled(true);
  for (const d of doors) d.body.sleep();
  out.doorsSleep = time();
  let a2 = 0; w.forEachActiveRigidBody(() => a2++); out.activeAfterSleep = a2;
  for (const d of doors) d.body.setBodyType(2, false); // KinematicPositionBased
  // NPC bodies
  const npcs = g.residents.live;
  for (const n of npcs) n.body.setEnabled(false);
  out.npcOff = time();
  for (const n of npcs) n.body.setEnabled(true);
  out.again = time();
  const fixedB = []; w.bodies.forEach((b) => { if (b.isFixed()) fixedB.push(b); });
  // disable building bodies far from player (> 40m)
  let off = 0; for (const l of g.settlements.live.values()) if (l.root.position.distanceTo(g.player.pos) > 40) { l.body.setEnabled(false); off++; }
  out.farBuildingsOff = time(); out.off = off;
  for (const l of g.settlements.live.values()) l.body.setEnabled(true);
  let dynA = 0; w.forEachActiveRigidBody((b) => { if (b.isDynamic()) dynA++; }); out.dynActive = dynA;
  let sens = 0; w.colliders.forEach((c) => { if (c.isSensor()) sens++; }); out.sensors = sens;
  out.n = { doors: doors.length, npcs: npcs.length };
  let act = 0; w.forEachActiveRigidBody(() => act++); out.active = act;
  return out;
});
console.log(r);
await browser.close(); srv.close();
