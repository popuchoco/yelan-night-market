import { DATA } from "./data.js";
import { createObjectRenderer, getStallVisualProfile } from "./scene/objects.js";
import { createEffectRenderer } from "./scene/effects.js";
import { createRevenueRenderer } from "./scene/revenue.js";

export function applyCameraAction(camera, action) {
  const next = { ...camera };
  const config = DATA.camera;
  if (action === "orbit-left") next.yaw -= config.orbitStep;
  if (action === "orbit-right") next.yaw += config.orbitStep;
  if (action === "tilt-up") next.elevation = Math.min(config.maxElevation, next.elevation + config.tiltStep);
  if (action === "tilt-down") next.elevation = Math.max(config.minElevation, next.elevation - config.tiltStep);
  if (action === "zoom-in") next.zoom = Math.min(config.maxZoom, next.zoom * config.zoomStep);
  if (action === "zoom-out") next.zoom = Math.max(config.minZoom, next.zoom / config.zoomStep);
  if (action === "camera-reset") return { yaw: config.defaultYaw, elevation: config.defaultElevation, zoom: 1, panX: 0, panY: 0 };
  return next;
}

/** Sort a ground-level object by its nearest-to-camera footprint edge, not its center. */
export function getFootprintDepth(bounds, depthAt) {
  const x = Number(bounds.x) || 0;
  const z = Number(bounds.z) || 0;
  const width = Math.max(0, Number(bounds.w) || 0);
  const depth = Math.max(0, Number(bounds.d) || 0);
  return Math.max(
    depthAt(x, z),
    depthAt(x + width, z),
    depthAt(x + width, z + depth),
    depthAt(x, z + depth)
  );
}

export function createScene(runtime) {
  const { state, todayEvent, getTonightGuests } = runtime;
  const { dishes } = DATA;
  var camera = { yaw: DATA.camera.defaultYaw, elevation: DATA.camera.defaultElevation, zoom: 1, panX: 0, panY: 0 };
  var canvas = document.getElementById("worldCanvas");
  var ctx = canvas.getContext("2d");
  var view = { w: 0, h: 0, scale: 1, dpr: 1 };
  var marketStalls = DATA.stalls;
  var mainStall = marketStalls.find(function(stall) { return stall.main; });
  var stallHitBounds = [];
  var actorHits = [];
  var eventHitBounds = [];
  var rainSeed = [];
  var smokeSeed = [];
  var ambientWalkers = createAmbientWalkers();
  var staffWalkers = [{ x: DATA.motion.staffStart.x, z: DATA.motion.staffStart.z, target: 0, speed: DATA.motion.staffSpeed, phase: 0 }];
  var guestActors = [];
  var pointer = null;
  var lastToast = "";
  var sceneToastUntil = 0;
  var paused = false;
  var motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var motionReduced = !!(motionQuery && motionQuery.matches);
  var animationTime = performance.now();

  function setToast(message) {
    lastToast = message;
    sceneToastUntil = performance.now() + 2600;
  }

  function spawnGuests(guests = getTonightGuests()) {
    guestActors = guests.map(function(guest, index) {
      var spawn = DATA.motion.guestSpawn;
      return { guest: guest, index: index, x: spawn.x + (index % 2) * spawn.xStep, z: spawn.z + index * spawn.zStep, speed: DATA.motion.guestSpeed,
        phase: index * 0.7, scale: 0.87 + (index % 2) * 0.08, outfit: guest.outfit || "#ba8060", skin: DATA.motion.guestSkin,
        pants: DATA.motion.guestPants, path: [], goalKey: "", arrived: false, hidden: false, difficult: !!guest.difficult };
    });
  }

      function createAmbientWalkers() {
        var palettes = DATA.motion.ambientColors;
        var routes = DATA.motion.ambientRoutes;
        return routes.map(function (route,index) { return { x:route[0].x, z:route[0].z, route:route, step:1, speed:DATA.motion.ambientSpeed+(index%3)*DATA.motion.ambientSpeedStep, outfit:palettes[index], phase:index*.9, scale:.78+(index%2)*.12 }; });
      }
      function moveToward(actor, target, distance) {
        var dx = target.x - actor.x, dz = target.z - actor.z;
        var length = Math.sqrt(dx*dx+dz*dz);
        if (length <= distance || length < 1) { actor.x = target.x; actor.z = target.z; return true; }
        actor.x += dx/length*distance; actor.z += dz/length*distance;
        return false;
      }
      function setGuestRoute(actor, key, points) {
        if (actor.goalKey === key) return;
        actor.goalKey = key;
        actor.path = points.slice();
      }
      function syncStaffWalkers() {
        var needed = 1 + Math.min(6, Number(state.hiredCrew) || 0);
        while (staffWalkers.length < needed) {
          var index = staffWalkers.length;
          staffWalkers.push({
            x: DATA.motion.staffStart.x + 14 * index,
            z: DATA.motion.staffStart.z + 12 * index,
            target: index % DATA.motion.staffRoute.length,
            speed: DATA.motion.staffSpeed * (index % 2 ? 0.92 : 1),
            phase: index * 0.8
          });
        }
        if (staffWalkers.length > needed) staffWalkers.length = needed;
      }
      function updateActors(dt) {
        ambientWalkers.forEach(function (walker) {
          var target = walker.route[walker.step];
          if (moveToward(walker,target,walker.speed*dt)) walker.step = (walker.step+1)%walker.route.length;
        });
        syncStaffWalkers();
        var staffPoints = DATA.motion.staffRoute;
        staffWalkers.forEach(function(walker) {
          if (!walker.path) walker.path = [];
          if (!walker.path.length) walker.path = [staffPoints[walker.target]];
          if (moveToward(walker,walker.path[0],walker.speed*dt)) {
            walker.path = [];
            walker.target = (walker.target+1)%staffPoints.length;
          }
        });
        if (state.phase === "service" || state.phase === "report") {
          guestActors.forEach(function (actor,index) {
            var key, points;
            if (index < state.customerIndex || state.phase === "report") {
              key = "exit-"+index;
              points = DATA.motion.guestExitRoute;
            } else if (index === state.customerIndex) {
              key = "counter-"+index;
              points = DATA.motion.guestCounterRoute;
            } else {
              var gap = index-state.customerIndex-1;
              var queueRoute = DATA.motion.queueRoutes[index%3];
              var q = {x:queueRoute[1].x,z:queueRoute[1].z+gap*52};
              key = "queue-"+index+"-"+state.customerIndex;
              points = [{x:queueRoute[0].x,z:queueRoute[0].z+gap*18},q];
            }
            setGuestRoute(actor,key,points);
            if (actor.path.length) {
              if (moveToward(actor,actor.path[0],(actor.speed||DATA.motion.guestSpeed)*dt)) actor.path.shift();
            }
            actor.arrived = !actor.path.length;
            if (index < state.customerIndex || state.phase === "report") actor.hidden = actor.x > 860 && actor.z > 800;
          });
        }
      }
      function resizeCanvas() {
        var rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        view.dpr = Math.min(window.devicePixelRatio || 1,2);
        view.w = rect.width; view.h = rect.height;
        canvas.width = Math.round(view.w*view.dpr);
        canvas.height = Math.round(view.h*view.dpr);
        ctx.setTransform(view.dpr,0,0,view.dpr,0,0);
        view.scale = Math.min(view.w/1450,view.h/860)*camera.zoom;
      }
      function cameraSpace(x,z) {
        var dx = x-500, dz = z-500;
        var c = Math.cos(camera.yaw), s = Math.sin(camera.yaw);
        return { x:dx*c-dz*s, z:dx*s+dz*c };
      }
      function project(x,y,z) {
        var p = cameraSpace(x,z);
        var horizontal = Math.sin(camera.elevation);
        var vertical = Math.cos(camera.elevation);
        var unit = view.scale;
        return { x:view.w*.5+camera.panX+(p.x-p.z)*.70710678*unit, y:view.h*.51+camera.panY+(p.x+p.z)*horizontal*.70710678*unit-y*vertical*unit, s:unit };
      }
      function cameraDepth(x,z) { return cameraSpace(x,z).z; }
      function pathPolygon(points,fill,stroke,width) {
        if (!points.length) return;
        ctx.beginPath(); ctx.moveTo(points[0].x,points[0].y);
        for (var i=1;i<points.length;i++) ctx.lineTo(points[i].x,points[i].y);
        ctx.closePath();
        if (fill) { ctx.fillStyle=fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle=stroke; ctx.lineWidth=width||1; ctx.stroke(); }
      }
      function worldPoly(coords,y,fill,stroke,width) {
        pathPolygon(coords.map(function (v) { return project(v.x,y||0,v.z); }),fill,stroke,width);
      }
      function drawGround() {
        var sky=ctx.createLinearGradient(0,0,0,view.h);
        sky.addColorStop(0,"#18353a"); sky.addColorStop(.37,"#27433d"); sky.addColorStop(1,"#1b2c2b");
        ctx.fillStyle=sky; ctx.fillRect(0,0,view.w,view.h);
        worldPoly([{x:-120,z:96},{x:1120,z:96},{x:1120,z:1040},{x:-120,z:1040}],0,"#665e49","#d1b87b33",1);
        for (var x=-120;x<1120;x+=118) {
          for (var z=100;z<1040;z+=118) {
            var road = z>526&&z<714;
            var pattern = ((Math.floor((x+120)/118)+Math.floor((z-100)/118))%2)===0;
            var color = road ? (pattern?"#7a7158":"#716950") : (pattern?"#88785b":"#7d7157");
            worldPoly([{x:x,z:z},{x:x+118,z:z},{x:x+118,z:z+118},{x:x,z:z+118}],0,color,"#e7d3a744",.65);
            if (road && pattern) {
              var dot=project(x+59,1,z+59); ctx.fillStyle="#ddc88d28"; ctx.beginPath(); ctx.arc(dot.x,dot.y,1.2*view.scale,0,Math.PI*2); ctx.fill();
            }
          }
        }
        worldPoly([{x:-120,z:20},{x:1120,z:20},{x:1120,z:146},{x:-120,z:146}],-3,"#305c60","#79a39a66",2);
        for (var i=0;i<13;i++) {
          var wx=25+i*82, wav=project(wx,2,70+Math.sin(performance.now()/950+i)*7);
          ctx.strokeStyle="#b4c8a848"; ctx.lineWidth=1.1; ctx.beginPath(); ctx.moveTo(wav.x-9,wav.y); ctx.quadraticCurveTo(wav.x,wav.y-4,wav.x+12,wav.y+1); ctx.stroke();
        }
        worldPoly([{x:30,z:155},{x:975,z:155},{x:945,z:210},{x:70,z:210}],4,"#9a8060","#f0d9a050",1);
        for (var p=0;p<9;p++) {
          var post=project(60+p*108,2,154);
          ctx.fillStyle="#d4bc83"; ctx.beginPath(); ctx.arc(post.x,post.y,2.4*view.scale,0,Math.PI*2); ctx.fill();
        }
        // Warm pavement pools anchor the playable strip rather than a floating dashboard.
        var lightPositions=[[285,540],[690,520],[336,768],[714,755]];
        lightPositions.forEach(function (v) {
          var glow=project(v[0],0,v[1]); var r=55*view.scale;
          var g=ctx.createRadialGradient(glow.x,glow.y,2,glow.x,glow.y,r);
          g.addColorStop(0,"#efc77c31"); g.addColorStop(1,"#efc77c00");
          ctx.fillStyle=g; ctx.fillRect(glow.x-r,glow.y-r,r*2,r*2);
        });
      }
      function drawBox(x,z,w,d,h,colors) {
        colors=colors||{};
        var ground=[project(x,0,z),project(x+w,0,z),project(x+w,0,z+d),project(x,0,z+d)];
        var top=[project(x,h,z),project(x+w,h,z),project(x+w,h,z+d),project(x,h,z+d)];
        var faces=[
          {i:0,j:1,color:colors.sideA||"#634c38"},
          {i:1,j:2,color:colors.sideB||"#4e4034"},
          {i:2,j:3,color:colors.sideA||"#71543a"},
          {i:3,j:0,color:colors.sideB||"#544335"}
        ].sort(function(a,b) {
          var da=(cameraDepth([x,x+w,x+w,x][a.i],[z,z,z+d,z+d][a.i])+cameraDepth([x,x+w,x+w,x][a.j],[z,z,z+d,z+d][a.j]))*.5;
          var db=(cameraDepth([x,x+w,x+w,x][b.i],[z,z,z+d,z+d][b.i])+cameraDepth([x,x+w,x+w,x][b.j],[z,z,z+d,z+d][b.j]))*.5;
          return da-db;
        });
        faces.forEach(function(face) { pathPolygon([top[face.i],top[face.j],ground[face.j],ground[face.i]],face.color,colors.stroke||"#362f2766",.7); });
        pathPolygon(top,colors.top||"#9b7650",colors.stroke||"#362f2766",.8);
        return { ground:ground, top:top };
      }
      function drawRoundRect(x,y,w,h,r,fill,stroke) {
        ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
        ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
        ctx.fillStyle=fill; ctx.fill(); if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}
      }
      function drawBillboard(point,text,main,roofColor) {
        var scale=view.scale;
        var width=(main?126:72)*scale, height=(main?30:22)*scale;
        width=Math.max(main?102:58,width); height=Math.max(19,height);
        drawRoundRect(point.x-width/2,point.y-height/2,width,height,6*scale,"#203936","#f1d29170");
        ctx.fillStyle=main?"#f2dc9e":"#e4d1a1";
        ctx.font="800 "+Math.max(main?10:7,Math.round((main?11:8)*scale))+"px system-ui, sans-serif";
        ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText(text,point.x,point.y-1*scale);
        if(main) {
          ctx.fillStyle=roofColor||"#ba5a46"; ctx.fillRect(point.x-width/2+4,point.y+height/2-3*scale,width-8*scale,3*scale);
        }
      }
      function boundsHit(x,y,b) { return !!b&&x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom; }
      const objectRenderer = createObjectRenderer({
        ctx: ctx, view: view, project: project, cameraDepth: cameraDepth, pathPolygon: pathPolygon, drawBox: drawBox,
        drawRoundRect: drawRoundRect, drawBillboard: drawBillboard, state: state, DATA: DATA,
        onStallBounds: function(bounds, target) { stallHitBounds.push({ ...bounds, target: target || { type: "main" } }); },
        recordActorHit: function(hit) { actorHits.push(hit); }
      });
      const drawStall = objectRenderer.drawStall;
      const drawHuman = objectRenderer.drawHuman;
      const drawProp = objectRenderer.drawProp;
      const drawEventEffects = createEffectRenderer({
        ctx: ctx, view: view, project: project, drawBox: drawBox, drawRoundRect: drawRoundRect,
        todayEvent: todayEvent, state: state, mainStall: mainStall,
        getGuestActors: function() { return guestActors; }
      });
      const revenueRenderer = createRevenueRenderer({ state: state, ctx: ctx, view: view, drawRoundRect: drawRoundRect, eventAnchor: eventAnchor });
      function drawScene(time) {
        if(!view.w||!view.h) resizeCanvas();
        ctx.setTransform(view.dpr,0,0,view.dpr,0,0);
        ctx.clearRect(0,0,view.w,view.h);
        actorHits=[];
        stallHitBounds=[];
        eventHitBounds=[];
        drawGround();
        var items=[];
        marketStalls.forEach(function(stall){
          const profile = getStallVisualProfile(stall, state);
          items.push({depth:getFootprintDepth(profile,cameraDepth),draw:function(){drawStall(stall,time);}});
        });
        [{x:330,z:332,w:49,d:34,type:"table"},{x:690,z:347,w:49,d:34,type:"table"},{x:320,z:730,w:37,d:34,type:"bench"},{x:690,z:738,w:37,d:34,type:"bench"},{x:320,z:300,w:27,d:26,type:"plant"},{x:677,z:300,w:27,d:26,type:"plant"},{x:295,z:466,w:58,d:18,type:"crate"},{x:705,z:476,w:58,d:18,type:"crate"}].forEach(function(prop){
          items.push({depth:getFootprintDepth(prop,cameraDepth),draw:function(){drawProp(prop.x,prop.z,prop.type,time);}});
        });
        ambientWalkers.forEach(function(walker,index){items.push({depth:cameraDepth(walker.x,walker.z),draw:function(){drawHuman(walker,time,"ambient",index);}});});
        if(state.phase==="service"||state.phase==="report") {
          guestActors.forEach(function(actor,index){items.push({depth:cameraDepth(actor.x,actor.z),draw:function(){drawHuman(actor,time,"guest",index);}});});
        }
        syncStaffWalkers();
        staffWalkers.forEach(function(walker,index){
          items.push({depth:cameraDepth(walker.x,walker.z),draw:function(){drawHuman({x:walker.x,z:walker.z,outfit:index?"#c4d2b7":"#dbe1cf",pants:"#394741",phase:walker.phase,scale:.9},time,"staff",index);}});
        });
        items.sort(function(a,b){return a.depth-b.depth;});
        items.forEach(function(item){item.draw();});
        if(state.phase==="service") {
          var active=guestActors[state.customerIndex];
          if(active) {
            var target=project(mainStall.x+mainStall.w*.50,2,mainStall.z+mainStall.d+68);
            ctx.strokeStyle="#f0d28799"; ctx.setLineDash([4,4]); ctx.lineWidth=1;
            ctx.beginPath(); ctx.moveTo(target.x,target.y); ctx.lineTo(project(active.x,0,active.z).x,project(active.x,0,active.z).y-12*view.scale); ctx.stroke(); ctx.setLineDash([]);
          }
        }
        drawEventEffects(time);
        drawOutletEventBeacons(time);
        revenueRenderer.draw(time, paused || motionReduced);
        if(performance.now()<sceneToastUntil&&lastToast) {
          var tw=Math.min(view.w-30,Math.max(170,lastToast.length*10));
          drawRoundRect((view.w-tw)/2,view.h*.19,tw,29,11,"#182727e8","#ead18c55");
          ctx.fillStyle="#f1e7c7"; ctx.font="700 9px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText(lastToast,view.w/2,view.h*.19+15,tw-20);
        }
      }

      function outletAlerts() {
        var branches = (state.outlets || []).filter(function(outlet) { return outlet && outlet.id !== "main"; });
        var alerts = [];
        if (state.managerEvent && state.managerEvent.outletId) {
          alerts.push({ outletId: state.managerEvent.outletId, kind: "manager", glyph: "!", color: "#d96d52" });
        }
        branches.forEach(function(outlet) {
          if (state.managerEvent && state.managerEvent.outletId === outlet.id) return;
          if (outlet.autoPaused) alerts.push({ outletId: outlet.id, kind: "stockout", glyph: "×", color: "#d96d52" });
          else if (Number(outlet.efficiencyPenalty) > 0) alerts.push({ outletId: outlet.id, kind: "equipment", glyph: "!", color: "#d6ad56" });
          else if (Number(outlet.nextNightBonus) > 0) alerts.push({ outletId: outlet.id, kind: "bonus", glyph: "+", color: "#70aa82" });
        });
        return alerts;
      }

      function drawOutletEventBeacons(time) {
        eventHitBounds = [];
        outletAlerts().forEach(function(alert) {
        var anchor = eventAnchor(alert.outletId);
        var scale = Math.max(0.8, view.scale);
        var x = anchor.x;
        var y = anchor.y + 17 * scale;
        var pulse = motionReduced ? 0 : 2 + Math.sin(time / 230) * 2;
        ctx.save();
        ctx.strokeStyle = alert.kind === "bonus" ? "#a8d1a9" : (alert.kind === "equipment" ? "#f1d27b" : "#f4b09a");
        ctx.lineWidth = Math.max(1.5, 2 * scale);
        ctx.beginPath();
        ctx.moveTo(x, anchor.y + 2 * scale);
        ctx.lineTo(x, y - 8 * scale);
        ctx.stroke();
        ctx.fillStyle = alert.color;
        ctx.beginPath();
        ctx.arc(x, y, (8 + pulse) * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = alert.kind === "bonus" ? "#dcf2d3" : "#ffe0bd";
        ctx.lineWidth = Math.max(1.5, 2 * scale);
        ctx.beginPath();
        ctx.arc(x, y, 8 * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#fff5df";
        ctx.font = "900 " + Math.max(11, 13 * scale) + "px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(alert.glyph, x, y + 0.5 * scale);
        ctx.restore();
        eventHitBounds.push({ left: x - 18 * scale, right: x + 18 * scale, top: y - 18 * scale, bottom: y + 18 * scale,
          outletId: alert.outletId, kind: alert.kind });
        });
      }

  function setCameraLabel() {
    var deg = ((Math.round(camera.yaw * 180 / Math.PI) % 360) + 360) % 360;
    var dir = deg < 45 || deg >= 315 ? "北岸" : (deg < 135 ? "東側" : (deg < 225 ? "南岸" : "西側"));
    document.getElementById("cameraLabel").textContent = (camera.elevation > 0.7 ? "高位俯視" : "斜俯視") + " · " + dir;
  }

  function cameraAction(action) {
    camera = applyCameraAction(camera, action);
    setCameraLabel();
    resizeCanvas();
  }

  function hitTest(x, y) {
    for (var i = actorHits.length - 1; i >= 0; i--) {
      var hit = actorHits[i], dx = x - hit.x, dy = y - hit.y;
      if (dx * dx + dy * dy <= hit.r * hit.r) return { type: "guest", index: hit.index };
    }
    for (var eventIndex = eventHitBounds.length - 1; eventIndex >= 0; eventIndex--) {
      var eventHit = eventHitBounds[eventIndex];
      if (x >= eventHit.left && x <= eventHit.right && y >= eventHit.top && y <= eventHit.bottom) {
        return { type: "outlet-event", outletId: eventHit.outletId, kind: eventHit.kind };
      }
    }
    for (var j = stallHitBounds.length - 1; j >= 0; j--) {
      var stallHit = stallHitBounds[j];
      if (x >= stallHit.left && x <= stallHit.right && y >= stallHit.top && y <= stallHit.bottom) {
        return stallHit.target.type === "outlet"
          ? { type: "outlet", outletId: stallHit.target.outletId, outletName: stallHit.target.outletName }
          : { type: "stall" };
      }
    }
    return null;
  }

  function eventAnchor(outletId) {
    var stall = mainStall;
    if (outletId && outletId !== "main") {
      var outlet = (state.outlets || []).find(function(item) { return item.id === outletId; });
      if (outlet) {
        var available = marketStalls.filter(function(item) { return !item.main; });
        var claimed = [];
        var branches = (state.outlets || []).filter(function(item) { return item.id !== "main"; });
        branches.forEach(function(branch) {
          var index = available.findIndex(function(item, candidate) { return !claimed.includes(candidate) && item.id === branch.type; });
          if (index < 0 && (branch.type === "food" || branch.type === "leisure")) {
            index = available.findIndex(function(item, candidate) {
              return !claimed.includes(candidate) && (branch.type === "leisure" ? item.id === "toy" : item.id !== "toy");
            });
          }
          if (index < 0) index = available.findIndex(function(item, candidate) { return !claimed.includes(candidate); });
          if (index >= 0) {
            claimed.push(index);
            if (branch.id === outletId) stall = available[index];
          }
        });
      }
    }
    var point = project(stall.x + stall.w * 0.5, stall.h + 74, stall.z + stall.d * 0.45);
    return { x: point.x, y: point.y };
  }

  function endPointer() {
    if (pointer && pointer.moved) canvas._ignoreNextClick = true;
    pointer = null;
    canvas.classList.remove("dragging");
  }

  function bindPointerControls() {
    canvas.addEventListener("pointerdown", function(event) {
      pointer = { x: event.clientX, y: event.clientY, yaw: camera.yaw, elevation: camera.elevation, moved: false };
      canvas.classList.add("dragging");
      if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", function(event) {
      if (!pointer) return;
      var dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) pointer.moved = true;
      if (pointer.moved) {
        camera.yaw = pointer.yaw + dx * DATA.camera.yawDrag;
        camera.elevation = Math.max(DATA.camera.minElevation, Math.min(DATA.camera.maxElevation, pointer.elevation + dy * DATA.camera.elevationDrag));
        setCameraLabel();
      }
    });
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("wheel", function(event) {
      event.preventDefault();
      camera.zoom = Math.max(DATA.camera.minZoom, Math.min(DATA.camera.maxZoom, camera.zoom * (event.deltaY < 0 ? DATA.camera.wheelZoomIn : DATA.camera.wheelZoomOut)));
      resizeCanvas();
    }, { passive: false });
    canvas.addEventListener("click", function(event) {
      if (canvas._ignoreNextClick) { canvas._ignoreNextClick = false; event.stopImmediatePropagation(); }
    }, true);
    window.addEventListener("resize", resizeCanvas);
  }

  function update(dt) {
    if (!paused && !motionReduced) {
      animationTime += dt * 1000;
      updateActors(dt);
    }
    revenueRenderer.update(animationTime, paused || motionReduced);
  }

  function draw() { drawScene(animationTime); }
  function togglePause() { paused = !paused; return paused; }
  if (motionQuery) {
    const onMotionChange = function(event) {
      motionReduced = event.matches;
      document.dispatchEvent(new Event("scene-motion-change"));
    };
    if (motionQuery.addEventListener) motionQuery.addEventListener("change", onMotionChange);
    else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);
  }

  bindPointerControls();
  setCameraLabel();
  resizeCanvas();
  return { canvas: canvas, update: update, draw: draw, spawnGuests: spawnGuests, cameraAction: cameraAction,
    setCameraLabel: setCameraLabel, hitTest: hitTest, eventAnchor: eventAnchor, showToast: setToast, togglePause: togglePause,
    getRevenueDisplay: revenueRenderer.getDisplay, drainRevenueAnnouncements: revenueRenderer.drainAnnouncements,
    showRevenueNotice: function(amount, label, outletId) { revenueRenderer.showNotice(amount, label, outletId, animationTime, paused || motionReduced); },
    get paused() { return paused; }, get motionReduced() { return motionReduced; },
    get motionSuppressed() { return paused || motionReduced; } };
}
