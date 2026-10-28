import { DATA } from "./data.js";

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

export function createScene(runtime) {
  const { state, todayEvent, getTonightGuests } = runtime;
  const { dishes } = DATA;
  var camera = { yaw: DATA.camera.defaultYaw, elevation: DATA.camera.defaultElevation, zoom: 1, panX: 0, panY: 0 };
  var canvas = document.getElementById("worldCanvas");
  var ctx = canvas.getContext("2d");
  var view = { w: 0, h: 0, scale: 1, dpr: 1 };
  var marketStalls = DATA.stalls;
  var mainStall = marketStalls.find(function(stall) { return stall.main; });
  var stallHitBounds = null;
  var actorHits = [];
  var rainSeed = [];
  var smokeSeed = [];
  var ambientWalkers = createAmbientWalkers();
  var staffWalker = { x: DATA.motion.staffStart.x, z: DATA.motion.staffStart.z, target: 0, speed: DATA.motion.staffSpeed };
  var guestActors = [];
  var pointer = null;
  var lastToast = "";
  var sceneToastUntil = 0;
  var paused = false;
  var animationTime = performance.now();

  function setToast(message) {
    lastToast = message;
    sceneToastUntil = animationTime + 2600;
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
      function updateActors(dt) {
        ambientWalkers.forEach(function (walker) {
          var target = walker.route[walker.step];
          if (moveToward(walker,target,walker.speed*dt)) walker.step = (walker.step+1)%walker.route.length;
        });
        var staffPoints = DATA.motion.staffRoute;
        if (!staffWalker.path) staffWalker.path = [];
        if (!staffWalker.path.length) staffWalker.path = [staffPoints[staffWalker.target]];
        if (moveToward(staffWalker,staffWalker.path[0],staffWalker.speed*dt)) {
          staffWalker.path = [];
          staffWalker.target = (staffWalker.target+1)%staffPoints.length;
        }
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
      function drawStall(stall,time) {
        var s=view.scale;
        var shadow=[project(stall.x-18,0,stall.z-14),project(stall.x+stall.w+18,0,stall.z-14),project(stall.x+stall.w+18,0,stall.z+stall.d+20),project(stall.x-18,0,stall.z+stall.d+20)];
        pathPolygon(shadow,"#1017174d");
        drawBox(stall.x,stall.z,stall.w,stall.d,stall.h*.53,{top:"#73593e",sideA:"#5d4734",sideB:"#4d4033",stroke:"#312b2366"});
        drawBox(stall.x+16,stall.z+11,stall.w-32,stall.d-52,stall.h,{top:stall.roof,sideA:"#79593e",sideB:"#5c4734",stroke:"#32292099"});
        drawBox(stall.x+8,stall.z+stall.d-51,stall.w-16,34,48,{top:"#d1a46b",sideA:"#8f6040",sideB:"#684b37",stroke:"#342b2399"});
        drawBox(stall.x+stall.w*.44,stall.z+stall.d-45,stall.w*.12,42,52,{top:"#845536",sideA:"#6d472f",sideB:"#543b2c"});
        // Striped canopy fascia is a distinct depth layer, not a flat scene background.
        var roofY=stall.h+7;
        var a=project(stall.x-7,roofY,stall.z-8), b=project(stall.x+stall.w+7,roofY,stall.z-8);
        var c=project(stall.x+stall.w+7,roofY,stall.z+stall.d+4), d=project(stall.x-7,roofY,stall.z+stall.d+4);
        pathPolygon([a,b,c,d],stall.roof,"#251f1a99",1);
        var stripes=stall.main?8:6;
        for(var k=0;k<stripes;k++) {
          var xx=stall.x-7+(stall.w+14)*k/stripes;
          var x2=stall.x-7+(stall.w+14)*(k+1)/stripes;
          if(k%2===0) {
            pathPolygon([project(xx,roofY,stall.z+stall.d+1),project(x2,roofY,stall.z+stall.d+1),project(x2,roofY-23,stall.z+stall.d+4),project(xx,roofY-23,stall.z+stall.d+4)],stall.main?"#f0d69b":"#e4d2a0");
          }
        }
        // Roof ribs, posts and counter create readable 3D volume from the overhead camera.
        for(var post=0;post<4;post++) {
          var px=post%2?stall.x+stall.w-8:stall.x+5;
          var pz=post<2?stall.z+3:stall.z+stall.d-21;
          drawBox(px,pz,7,7,stall.h+8,{top:"#dfbd82",sideA:"#765a3b",sideB:"#503f31",stroke:"#30291f"});
        }
        for(var rib=1;rib<4;rib++) {
          var start=project(stall.x+stall.w*rib/4,stall.h+9,stall.z-5);
          var end=project(stall.x+stall.w*rib/4,stall.h+9,stall.z+stall.d+5);
          ctx.strokeStyle="#f0d59b99"; ctx.lineWidth=Math.max(1,1.3*s); ctx.beginPath(); ctx.moveTo(start.x,start.y); ctx.lineTo(end.x,end.y); ctx.stroke();
        }
        // Lit service window and bowls.
        var windowP=project(stall.x+stall.w*.45,stall.h*.63,stall.z+stall.d*.43);
        drawRoundRect(windowP.x-17*s,windowP.y-12*s,34*s,21*s,4*s,"#e8bd70","#ffe3a477");
        ctx.fillStyle="#41564a"; ctx.fillRect(windowP.x-13*s,windowP.y-9*s,26*s,15*s);
        if(stall.main) {
          var grill=project(stall.x+stall.w*.68,stall.h*.55,stall.z+stall.d*.70);
          ctx.fillStyle="#ef8d48"; ctx.beginPath(); ctx.ellipse(grill.x,grill.y,10*s,5*s,0,0,Math.PI*2); ctx.fill();
          ctx.fillStyle="#ffdb80"; ctx.beginPath(); ctx.moveTo(grill.x,grill.y-2*s); ctx.quadraticCurveTo(grill.x-6*s,grill.y-12*s,grill.x+1*s,grill.y-15*s); ctx.quadraticCurveTo(grill.x+8*s,grill.y-10*s,grill.x+5*s,grill.y-2*s); ctx.fill();
          for(var smoke=0;smoke<3;smoke++) {
            var phase=(time/900+smoke*.34)%1;
            var smokeP=project(stall.x+stall.w*.68+Math.sin(time/650+smoke)*11*phase,stall.h*.55+16+phase*70,stall.z+stall.d*.70);
            ctx.globalAlpha=(1-phase)*.34; ctx.fillStyle="#e4e8d5";
            ctx.beginPath(); ctx.ellipse(smokeP.x,smokeP.y,3*s+phase*6*s,4*s+phase*5*s,0,0,Math.PI*2); ctx.fill();
            ctx.globalAlpha=1;
          }
        }
        var signP=project(stall.x+stall.w/2,stall.h+31,stall.z+stall.d*.43);
        drawBillboard(signP,stall.name,!!stall.main,stall.roof);
        // Lantern pendulums sway independently along the awning.
        var lanternCount=stall.main?3:2;
        for(var l=0;l<lanternCount;l++) {
          var lx=stall.x+stall.w*(.2+l*(.6/(lanternCount-1||1)));
          var lz=stall.z+stall.d+6;
          var lp=project(lx,stall.h-10,lz);
          var sway=Math.sin(time/540+l*1.7+stall.x)*3*s;
          ctx.strokeStyle="#413a2f"; ctx.lineWidth=Math.max(1,1.2*s); ctx.beginPath(); ctx.moveTo(lp.x,lp.y); ctx.lineTo(lp.x+sway,lp.y+10*s); ctx.stroke();
          drawRoundRect(lp.x+sway-4*s,lp.y+9*s,8*s,12*s,3*s,stall.main?"#dd7651":"#e4b265","#f3d996");
          ctx.fillStyle="#ffde8b"; ctx.globalAlpha=.25+(.12*Math.sin(time/300+l)); ctx.beginPath(); ctx.arc(lp.x+sway,lp.y+15*s,13*s,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
        }
        if(stall.main) {
          var bounds=[project(stall.x-5,stall.h+30,stall.z-10),project(stall.x+stall.w+5,stall.h+30,stall.z-10),project(stall.x+stall.w+12,0,stall.z+stall.d+8),project(stall.x-12,0,stall.z+stall.d+8)];
          var xs=bounds.map(function(p){return p.x;}),ys=bounds.map(function(p){return p.y;});
          stallHitBounds={left:Math.min.apply(null,xs)-12,top:Math.min.apply(null,ys)-12,right:Math.max.apply(null,xs)+12,bottom:Math.max.apply(null,ys)+12};
          if(state.phase==="prep") {
            var marker=project(stall.x+stall.w*.5,stall.h+96,stall.z+stall.d*.5);
            var bounce=Math.sin(time/260)*3*s;
            ctx.fillStyle="#f4d588"; ctx.beginPath(); ctx.moveTo(marker.x,marker.y+bounce); ctx.lineTo(marker.x-8*s,marker.y-11*s+bounce); ctx.lineTo(marker.x+8*s,marker.y-11*s+bounce); ctx.closePath(); ctx.fill();
            drawRoundRect(marker.x-49*s,marker.y-31*s+bounce,98*s,18*s,7*s,"#223832e8","#f3d38a88");
            ctx.font="800 "+Math.max(7,8*s)+"px system-ui"; ctx.fillStyle="#f5dd9c"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("點攤位・管備料",marker.x,marker.y-22*s+bounce);
          }
        }
      }
      function drawHuman(actor,time,kind,index) {
        if(actor.hidden) return;
        var p=project(actor.x,0,actor.z);
        var s=view.scale*(actor.scale||1);
        var moving=(actor.path&&actor.path.length)||(actor.route&&actor.route[actor.step]);
        var bob=moving?Math.abs(Math.sin(time/110+(actor.phase||index||0)))*2.4*s:Math.sin(time/460+(actor.phase||index||0))*1*s;
        // Ground shadow and feet establish contact with the isometric tile plane.
        ctx.fillStyle="#13191a70"; ctx.beginPath(); ctx.ellipse(p.x,p.y+1*s,9*s,4*s,0,0,Math.PI*2); ctx.fill();
        var legY=p.y-2*s+bob;
        ctx.strokeStyle=actor.pants||"#394741"; ctx.lineWidth=Math.max(2,3.5*s); ctx.lineCap="round";
        ctx.beginPath(); ctx.moveTo(p.x-2*s,legY); ctx.lineTo(p.x-3*s,legY+8*s); ctx.moveTo(p.x+2*s,legY); ctx.lineTo(p.x+4*s,legY+8*s); ctx.stroke();
        ctx.fillStyle=actor.outfit||"#c7795f";
        ctx.beginPath(); ctx.moveTo(p.x-6*s,p.y-20*s+bob); ctx.quadraticCurveTo(p.x,p.y-24*s+bob,p.x+6*s,p.y-20*s+bob); ctx.lineTo(p.x+7*s,p.y-5*s+bob); ctx.lineTo(p.x-7*s,p.y-5*s+bob); ctx.closePath(); ctx.fill();
        ctx.strokeStyle=actor.skin||"#e6b594"; ctx.lineWidth=Math.max(1.6,2.2*s);
        ctx.beginPath(); ctx.moveTo(p.x-5*s,p.y-17*s+bob); ctx.lineTo(p.x-9*s,p.y-8*s+bob); ctx.moveTo(p.x+5*s,p.y-17*s+bob); ctx.lineTo(p.x+9*s,p.y-9*s+bob); ctx.stroke();
        if(kind==="staff") {
          ctx.fillStyle="#f2e6c8"; ctx.fillRect(p.x-4*s,p.y-17*s+bob,8*s,10*s);
          ctx.fillStyle="#c49255"; ctx.fillRect(p.x-4*s,p.y-8*s+bob,8*s,3*s);
        } else if(kind==="guest" && actor.difficult) {
          ctx.fillStyle="#ed8e68"; ctx.font=Math.max(10,12*s)+"px system-ui"; ctx.textAlign="center"; ctx.fillText("!",p.x+8*s,p.y-29*s+bob);
        } else if(kind==="guest" && index===state.customerIndex && state.phase==="service") {
          ctx.fillStyle="#f0d385"; ctx.font=Math.max(9,11*s)+"px system-ui"; ctx.textAlign="center"; ctx.fillText("…",p.x+8*s,p.y-28*s+bob);
        }
        ctx.fillStyle=actor.skin||"#e8b999"; ctx.beginPath(); ctx.arc(p.x,p.y-27*s+bob,5.2*s,0,Math.PI*2); ctx.fill();
        ctx.fillStyle=actor.hair||"#3b4036"; ctx.beginPath(); ctx.arc(p.x,p.y-29*s+bob,5.5*s,Math.PI,Math.PI*2); ctx.lineTo(p.x+5*s,p.y-27*s+bob); ctx.quadraticCurveTo(p.x,p.y-24*s+bob,p.x-5*s,p.y-27*s+bob); ctx.fill();
        if(kind==="guest"&&index===state.customerIndex&&state.phase==="service") {
          var pulse=4+Math.sin(time/200)*1.5;
          ctx.strokeStyle="#f2d4889a"; ctx.lineWidth=1.5;
          ctx.beginPath(); ctx.ellipse(p.x,p.y-13*s,pulse*1.5*s,18*s,0,0,Math.PI*2); ctx.stroke();
        }
        if(kind==="guest"&&index===state.customerIndex&&state.phase==="service") actorHits.push({x:p.x,y:p.y-14*s,r:DATA.motion.guestClickRadius*s,index:index,kind:"guest"});
      }
      function drawProp(x,z,type,time) {
        if(type==="table") {
          drawBox(x,z,49,34,27,{top:"#b89361",sideA:"#70563b",sideB:"#594831"});
          drawBox(x+4,z+4,7,7,0,{top:"#5c705f",sideA:"#5c705f",sideB:"#5c705f"});
        } else if(type==="crate") {
          drawBox(x,z,37,34,31,{top:"#b9834f",sideA:"#775338",sideB:"#64472f"});
          var c=project(x+18,33,z+17); ctx.strokeStyle="#e0b66f"; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(c.x-7*view.scale,c.y); ctx.lineTo(c.x+7*view.scale,c.y); ctx.stroke();
        } else if(type==="plant") {
          drawBox(x,z,27,26,17,{top:"#8e6546",sideA:"#654935",sideB:"#57442e"});
          var p=project(x+13,17,z+13);
          for(var i=0;i<5;i++) { var angle=(i/5)*Math.PI*2+time/1800; ctx.fillStyle=["#738d60","#607f58","#93a26e"][i%3]; ctx.beginPath(); ctx.ellipse(p.x+Math.cos(angle)*6*view.scale,p.y-7*view.scale-Math.sin(angle)*4*view.scale,5*view.scale,3.4*view.scale,angle,0,Math.PI*2); ctx.fill(); }
        } else if(type==="bench") {
          drawBox(x,z,58,18,14,{top:"#ad8152",sideA:"#76553a",sideB:"#5e4933"});
          drawBox(x+6,z+4,6,6,34,{top:"#987147",sideA:"#644d35",sideB:"#56432f"});
          drawBox(x+46,z+4,6,6,34,{top:"#987147",sideA:"#644d35",sideB:"#56432f"});
        }
      }
      function boundsHit(x,y,b) { return !!b&&x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom; }
      function drawEventEffects(time) {
        var event=todayEvent();
        if(event.id==="festival") {
          var center=project(mainStall.x+mainStall.w/2,mainStall.h+165,mainStall.z+mainStall.d/2);
          for(var i=0;i<18;i++) {
            var angle=i*2.399+time/2300;
            var radius=(20+(i%5)*14)*view.scale;
            var px=center.x+Math.cos(angle)*radius, py=center.y+Math.sin(angle)*radius*.58;
            ctx.globalAlpha=.32+.52*(.5+.5*Math.sin(time/270+i));
            ctx.fillStyle=i%3===0?"#f2d983":"#ffab70";
            ctx.beginPath(); ctx.arc(px,py,(i%3===0?2.5:1.5)*view.scale,0,Math.PI*2); ctx.fill();
          }
          ctx.globalAlpha=1;
        }
        if(event.id==="rain") {
          ctx.fillStyle="#a9bec31a"; ctx.fillRect(0,0,view.w,view.h);
          ctx.strokeStyle="#c5d8dc70"; ctx.lineWidth=1;
          for(var r=0;r<72;r++) {
            var x=(r*97+time*.22)%view.w, y=(r*61+time*.48)%view.h;
            ctx.globalAlpha=.2+(r%4)*.08; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x-5,y+13); ctx.stroke();
          }
          ctx.globalAlpha=1;
          for(var puddle=0;puddle<4;puddle++) {
            var pp=project(220+puddle*178,1,585+(puddle%2)*88);
            ctx.strokeStyle="#b7d9d744"; ctx.beginPath(); ctx.ellipse(pp.x,pp.y,13*view.scale+Math.sin(time/300+puddle)*3,4*view.scale,0,0,Math.PI*2); ctx.stroke();
          }
        }
        if(event.id==="supplier") {
          var cart=project(835,0,832);
          var roll=Math.sin(time/230)*1.5*view.scale;
          ctx.fillStyle="#463d31"; ctx.beginPath(); ctx.ellipse(cart.x,cart.y,17*view.scale,5*view.scale,0,0,Math.PI*2); ctx.fill();
          drawBox(800,800,54,34,36,{top:"#c99a60",sideA:"#966a43",sideB:"#735438"});
          ctx.fillStyle="#f3ddab"; ctx.font=Math.max(8,10*view.scale)+"px system-ui"; ctx.textAlign="center"; ctx.fillText("漁貨",cart.x+roll,cart.y-23*view.scale);
        }
        if(event.id==="complaint"&&state.phase==="service") {
          var g=guestActors[state.customerIndex];
          if(g) {
            var p=project(g.x,0,g.z);
            drawRoundRect(p.x+8*view.scale,p.y-52*view.scale,70*view.scale,22*view.scale,7*view.scale,"#fff0d8","#dc8766");
            ctx.fillStyle="#9c553f"; ctx.font="800 "+Math.max(7,8*view.scale)+"px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("等太久了！",p.x+43*view.scale,p.y-41*view.scale);
          }
        }
      }
      function drawScene(time) {
        if(!view.w||!view.h) resizeCanvas();
        ctx.setTransform(view.dpr,0,0,view.dpr,0,0);
        ctx.clearRect(0,0,view.w,view.h);
        actorHits=[];
        drawGround();
        var items=[];
        marketStalls.forEach(function(stall){items.push({depth:cameraDepth(stall.x+stall.w/2,stall.z+stall.d/2),draw:function(){drawStall(stall,time);}});});
        [{x:330,z:332,type:"table"},{x:690,z:347,type:"table"},{x:320,z:730,type:"bench"},{x:690,z:738,type:"bench"},{x:320,z:300,type:"plant"},{x:677,z:300,type:"plant"},{x:295,z:466,type:"crate"},{x:705,z:476,type:"crate"}].forEach(function(prop){
          items.push({depth:cameraDepth(prop.x,prop.z),draw:function(){drawProp(prop.x,prop.z,prop.type,time);}});
        });
        ambientWalkers.forEach(function(walker,index){items.push({depth:cameraDepth(walker.x,walker.z),draw:function(){drawHuman(walker,time,"ambient",index);}});});
        if(state.phase==="service"||state.phase==="report") {
          guestActors.forEach(function(actor,index){items.push({depth:cameraDepth(actor.x,actor.z),draw:function(){drawHuman(actor,time,"guest",index);}});});
        }
        items.push({depth:cameraDepth(staffWalker.x,staffWalker.z),draw:function(){drawHuman({x:staffWalker.x,z:staffWalker.z,outfit:"#dbe1cf",pants:"#394741",phase:1,scale:.9},time,"staff",0);}});
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
        if(performance.now()<sceneToastUntil&&lastToast) {
          var tw=Math.min(view.w-30,Math.max(170,lastToast.length*10));
          drawRoundRect((view.w-tw)/2,view.h*.19,tw,29,11,"#182727e8","#ead18c55");
          ctx.fillStyle="#f1e7c7"; ctx.font="700 9px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText(lastToast,view.w/2,view.h*.19+15,tw-20);
        }
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
    if (stallHitBounds && x >= stallHitBounds.left && x <= stallHitBounds.right && y >= stallHitBounds.top && y <= stallHitBounds.bottom) return { type: "stall" };
    return null;
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
    if (paused) return;
    animationTime += dt * 1000;
    updateActors(dt);
  }

  function draw() { drawScene(animationTime); }
  function togglePause() { paused = !paused; return paused; }

  bindPointerControls();
  setCameraLabel();
  resizeCanvas();
  return { canvas: canvas, update: update, draw: draw, spawnGuests: spawnGuests, cameraAction: cameraAction,
    setCameraLabel: setCameraLabel, hitTest: hitTest, showToast: setToast, togglePause: togglePause,
    get paused() { return paused; } };
}
