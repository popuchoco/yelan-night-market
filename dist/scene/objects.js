// Canvas object renderers live apart from scene projection and frame orchestration.
export function createObjectRenderer(api) {
  const {
    ctx, view, project, pathPolygon, drawBox, drawRoundRect, drawBillboard,
    state, DATA, onStallBounds, recordActorHit
  } = api;

  function drawStall(stall, time) {
    const scale = view.scale;
    const acquiredOutlets = (state.outlets || []).filter(function(item) { return item.id !== "main"; });
    const availableStalls = DATA.stalls.filter(function(item) { return !item.main; });
    const claimedStalls = [];
    const acquiredStalls = acquiredOutlets.map(function(outlet) {
      let index = availableStalls.findIndex(function(item, candidate) {
        return !claimedStalls.includes(candidate) && (outlet.type === "leisure" ? item.id === "toy" : item.id !== "toy");
      });
      if (index < 0) index = availableStalls.findIndex(function(item, candidate) { return !claimedStalls.includes(candidate); });
      if (index < 0) return null;
      claimedStalls.push(index);
      return availableStalls[index];
    }).filter(Boolean);
    const acquiredIndex = acquiredStalls.findIndex(function(item) { return item.id === stall.id; });
    const outlet = acquiredIndex >= 0 ? acquiredOutlets[acquiredIndex] : null;
    const shadow = [
      project(stall.x - 18, 0, stall.z - 14),
      project(stall.x + stall.w + 18, 0, stall.z - 14),
      project(stall.x + stall.w + 18, 0, stall.z + stall.d + 20),
      project(stall.x - 18, 0, stall.z + stall.d + 20)
    ];
    pathPolygon(shadow, "#1017174d");
    drawBox(stall.x, stall.z, stall.w, stall.d, stall.h * 0.53, {
      top: "#73593e", sideA: "#5d4734", sideB: "#4d4033", stroke: "#312b2366"
    });
    drawBox(stall.x + 16, stall.z + 11, stall.w - 32, stall.d - 52, stall.h, {
      top: stall.roof, sideA: "#79593e", sideB: "#5c4734", stroke: "#32292099"
    });
    drawBox(stall.x + 8, stall.z + stall.d - 51, stall.w - 16, 34, 48, {
      top: "#d1a46b", sideA: "#8f6040", sideB: "#684b37", stroke: "#342b2399"
    });
    drawBox(stall.x + stall.w * 0.44, stall.z + stall.d - 45, stall.w * 0.12, 42, 52, {
      top: "#845536", sideA: "#6d472f", sideB: "#543b2c"
    });

    const roofY = stall.h + 7;
    const a = project(stall.x - 7, roofY, stall.z - 8);
    const b = project(stall.x + stall.w + 7, roofY, stall.z - 8);
    const c = project(stall.x + stall.w + 7, roofY, stall.z + stall.d + 4);
    const d = project(stall.x - 7, roofY, stall.z + stall.d + 4);
    pathPolygon([a, b, c, d], stall.roof, "#251f1a99", 1);
    const stripes = stall.main ? 8 : 6;
    for (let k = 0; k < stripes; k++) {
      if (k % 2 !== 0) continue;
      const x1 = stall.x - 7 + (stall.w + 14) * k / stripes;
      const x2 = stall.x - 7 + (stall.w + 14) * (k + 1) / stripes;
      pathPolygon([
        project(x1, roofY, stall.z + stall.d + 1),
        project(x2, roofY, stall.z + stall.d + 1),
        project(x2, roofY - 23, stall.z + stall.d + 4),
        project(x1, roofY - 23, stall.z + stall.d + 4)
      ], stall.main ? "#f0d69b" : "#e4d2a0");
    }

    // Posts, roof ribs, service window, and counter create readable stall volume.
    for (let post = 0; post < 4; post++) {
      const px = post % 2 ? stall.x + stall.w - 8 : stall.x + 5;
      const pz = post < 2 ? stall.z + 3 : stall.z + stall.d - 21;
      drawBox(px, pz, 7, 7, stall.h + 8, {
        top: "#dfbd82", sideA: "#765a3b", sideB: "#503f31", stroke: "#30291f"
      });
    }
    for (let rib = 1; rib < 4; rib++) {
      const start = project(stall.x + stall.w * rib / 4, stall.h + 9, stall.z - 5);
      const end = project(stall.x + stall.w * rib / 4, stall.h + 9, stall.z + stall.d + 5);
      ctx.strokeStyle = "#f0d59b99";
      ctx.lineWidth = Math.max(1, 1.3 * scale);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
    const window = project(stall.x + stall.w * 0.45, stall.h * 0.63, stall.z + stall.d * 0.43);
    drawRoundRect(window.x - 17 * scale, window.y - 12 * scale, 34 * scale, 21 * scale, 4 * scale, "#e8bd70", "#ffe3a477");
    ctx.fillStyle = "#41564a";
    ctx.fillRect(window.x - 13 * scale, window.y - 9 * scale, 26 * scale, 15 * scale);

    if (stall.main) {
      const grill = project(stall.x + stall.w * 0.68, stall.h * 0.55, stall.z + stall.d * 0.70);
      ctx.fillStyle = "#ef8d48";
      ctx.beginPath();
      ctx.ellipse(grill.x, grill.y, 10 * scale, 5 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffdb80";
      ctx.beginPath();
      ctx.moveTo(grill.x, grill.y - 2 * scale);
      ctx.quadraticCurveTo(grill.x - 6 * scale, grill.y - 12 * scale, grill.x + 1 * scale, grill.y - 15 * scale);
      ctx.quadraticCurveTo(grill.x + 8 * scale, grill.y - 10 * scale, grill.x + 5 * scale, grill.y - 2 * scale);
      ctx.fill();
      for (let smoke = 0; smoke < 3; smoke++) {
        const phase = (time / 900 + smoke * 0.34) % 1;
        const smokePoint = project(
          stall.x + stall.w * 0.68 + Math.sin(time / 650 + smoke) * 11 * phase,
          stall.h * 0.55 + 16 + phase * 70,
          stall.z + stall.d * 0.70
        );
        ctx.globalAlpha = (1 - phase) * 0.34;
        ctx.fillStyle = "#e4e8d5";
        ctx.beginPath();
        ctx.ellipse(smokePoint.x, smokePoint.y, 3 * scale + phase * 6 * scale, 4 * scale + phase * 5 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // Expansion decisions become visible in the 2.5D map as outdoor tables.
      const tables = Math.min(9, Number(state.expansions) || 0);
      for (let table = 0; table < tables; table++) {
        const tableColumn = table % 3;
        const tableRow = Math.floor(table / 3);
        const tableX = stall.x + 16 + tableColumn * 58;
        const tableZ = stall.z + stall.d + 29 + tableRow * 36;
        drawBox(tableX, tableZ, 34, 28, 15, {
          top: "#c89a61", sideA: "#8c6242", sideB: "#694a37", stroke: "#342b2399"
        });
        drawBox(tableX + 3, tableZ + 3, 5, 5, 22, {
          top: "#e2bd82", sideA: "#806040", sideB: "#644b37"
        });
        drawBox(tableX + 26, tableZ + 3, 5, 5, 22, {
          top: "#e2bd82", sideA: "#806040", sideB: "#644b37"
        });
      }
    }

    const sign = project(stall.x + stall.w / 2, stall.h + 31, stall.z + stall.d * 0.43);
    drawBillboard(sign, stall.name, !!stall.main, stall.roof);
    if (!stall.main) {
      if (acquiredIndex >= 0) {
        drawRoundRect(sign.x + 27 * scale, sign.y - 15 * scale, 16 * scale, 16 * scale, 5 * scale, "#d8b665", "#fff0ba");
        ctx.fillStyle = "#332d20";
        ctx.font = "800 " + Math.max(8, 9 * scale) + "px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(outlet?.manager ? "店" : (outlet?.active ? "營" : "休"), sign.x + 27 * scale, sign.y - 14 * scale);
      }
    }
    const lanternCount = stall.main ? 3 : 2;
    for (let lantern = 0; lantern < lanternCount; lantern++) {
      const x = stall.x + stall.w * (0.2 + lantern * (0.6 / (lanternCount - 1 || 1)));
      const point = project(x, stall.h - 10, stall.z + stall.d + 6);
      const sway = Math.sin(time / 540 + lantern * 1.7 + stall.x) * 3 * scale;
      ctx.strokeStyle = "#413a2f";
      ctx.lineWidth = Math.max(1, 1.2 * scale);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + sway, point.y + 10 * scale);
      ctx.stroke();
      drawRoundRect(point.x + sway - 4 * scale, point.y + 9 * scale, 8 * scale, 12 * scale, 3 * scale,
        stall.main ? "#dd7651" : "#e4b265", "#f3d996");
      ctx.fillStyle = "#ffde8b";
      ctx.globalAlpha = 0.25 + 0.12 * Math.sin(time / 300 + lantern);
      ctx.beginPath();
      ctx.arc(point.x + sway, point.y + 15 * scale, 13 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (stall.main || acquiredIndex >= 0) {
      const corners = [
        project(stall.x - 5, stall.h + 30, stall.z - 10),
        project(stall.x + stall.w + 5, stall.h + 30, stall.z - 10),
        project(stall.x + stall.w + 12, 0, stall.z + stall.d + 8),
        project(stall.x - 12, 0, stall.z + stall.d + 8)
      ];
      const xs = corners.map(function(point) { return point.x; });
      const ys = corners.map(function(point) { return point.y; });
      onStallBounds({
        left: Math.min.apply(null, xs) - 12, top: Math.min.apply(null, ys) - 12,
        right: Math.max.apply(null, xs) + 12, bottom: Math.max.apply(null, ys) + 12
      }, { type: stall.main ? "main" : "outlet", outletId: outlet?.id || null, outletName: outlet?.name || stall.name });
      if (stall.main && state.phase === "prep") {
        const marker = project(stall.x + stall.w * 0.5, stall.h + 96, stall.z + stall.d * 0.5);
        const bounce = Math.sin(time / 260) * 3 * scale;
        ctx.fillStyle = "#f4d588";
        ctx.beginPath();
        ctx.moveTo(marker.x, marker.y + bounce);
        ctx.lineTo(marker.x - 8 * scale, marker.y - 11 * scale + bounce);
        ctx.lineTo(marker.x + 8 * scale, marker.y - 11 * scale + bounce);
        ctx.closePath();
        ctx.fill();
        drawRoundRect(marker.x - 49 * scale, marker.y - 31 * scale + bounce, 98 * scale, 18 * scale, 7 * scale, "#223832e8", "#f3d38a88");
        ctx.font = "800 " + Math.max(7, 8 * scale) + "px system-ui";
        ctx.fillStyle = "#f5dd9c";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("點攤位・管備料", marker.x, marker.y - 22 * scale + bounce);
      }
    }
  }

  function drawHuman(actor, time, kind, index) {
    if (actor.hidden) return;
    const point = project(actor.x, 0, actor.z);
    const scale = view.scale * (actor.scale || 1);
    const moving = (actor.path && actor.path.length) || (actor.route && actor.route[actor.step]);
    const bob = moving
      ? Math.abs(Math.sin(time / 110 + (actor.phase || index || 0))) * 2.4 * scale
      : Math.sin(time / 460 + (actor.phase || index || 0)) * scale;
    ctx.fillStyle = "#13191a70";
    ctx.beginPath();
    ctx.ellipse(point.x, point.y + scale, 9 * scale, 4 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    const legY = point.y - 2 * scale + bob;
    ctx.strokeStyle = actor.pants || "#394741";
    ctx.lineWidth = Math.max(2, 3.5 * scale);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(point.x - 2 * scale, legY);
    ctx.lineTo(point.x - 3 * scale, legY + 8 * scale);
    ctx.moveTo(point.x + 2 * scale, legY);
    ctx.lineTo(point.x + 4 * scale, legY + 8 * scale);
    ctx.stroke();
    ctx.fillStyle = actor.outfit || "#c7795f";
    ctx.beginPath();
    ctx.moveTo(point.x - 6 * scale, point.y - 20 * scale + bob);
    ctx.quadraticCurveTo(point.x, point.y - 24 * scale + bob, point.x + 6 * scale, point.y - 20 * scale + bob);
    ctx.lineTo(point.x + 7 * scale, point.y - 5 * scale + bob);
    ctx.lineTo(point.x - 7 * scale, point.y - 5 * scale + bob);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = actor.skin || "#e6b594";
    ctx.lineWidth = Math.max(1.6, 2.2 * scale);
    ctx.beginPath();
    ctx.moveTo(point.x - 5 * scale, point.y - 17 * scale + bob);
    ctx.lineTo(point.x - 9 * scale, point.y - 8 * scale + bob);
    ctx.moveTo(point.x + 5 * scale, point.y - 17 * scale + bob);
    ctx.lineTo(point.x + 9 * scale, point.y - 9 * scale + bob);
    ctx.stroke();
    if (kind === "staff") {
      ctx.fillStyle = "#f2e6c8";
      ctx.fillRect(point.x - 4 * scale, point.y - 17 * scale + bob, 8 * scale, 10 * scale);
      ctx.fillStyle = "#c49255";
      ctx.fillRect(point.x - 4 * scale, point.y - 8 * scale + bob, 8 * scale, 3 * scale);
    } else if (kind === "guest" && actor.difficult) {
      ctx.fillStyle = "#ed8e68";
      ctx.font = Math.max(10, 12 * scale) + "px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("!", point.x + 8 * scale, point.y - 29 * scale + bob);
    } else if (kind === "guest" && index === state.customerIndex && state.phase === "service") {
      ctx.fillStyle = "#f0d385";
      ctx.font = Math.max(9, 11 * scale) + "px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("…", point.x + 8 * scale, point.y - 28 * scale + bob);
    }
    ctx.fillStyle = actor.skin || "#e8b999";
    ctx.beginPath();
    ctx.arc(point.x, point.y - 27 * scale + bob, 5.2 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = actor.hair || "#3b4036";
    ctx.beginPath();
    ctx.arc(point.x, point.y - 29 * scale + bob, 5.5 * scale, Math.PI, Math.PI * 2);
    ctx.lineTo(point.x + 5 * scale, point.y - 27 * scale + bob);
    ctx.quadraticCurveTo(point.x, point.y - 24 * scale + bob, point.x - 5 * scale, point.y - 27 * scale + bob);
    ctx.fill();

    if (kind === "guest" && index === state.customerIndex && state.phase === "service") {
      const pulse = 4 + Math.sin(time / 200) * 1.5;
      ctx.strokeStyle = "#f2d4889a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(point.x, point.y - 13 * scale, pulse * 1.5 * scale, 18 * scale, 0, 0, Math.PI * 2);
      ctx.stroke();
      recordActorHit({ x: point.x, y: point.y - 14 * scale, r: DATA.motion.guestClickRadius * scale, index: index, kind: "guest" });
    }
  }

  function drawProp(x, z, type, time) {
    if (type === "table") {
      drawBox(x, z, 49, 34, 27, { top: "#b89361", sideA: "#70563b", sideB: "#594831" });
      drawBox(x + 4, z + 4, 7, 7, 0, { top: "#5c705f", sideA: "#5c705f", sideB: "#5c705f" });
    } else if (type === "crate") {
      drawBox(x, z, 37, 34, 31, { top: "#b9834f", sideA: "#775338", sideB: "#64472f" });
      const center = project(x + 18, 33, z + 17);
      ctx.strokeStyle = "#e0b66f";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(center.x - 7 * view.scale, center.y);
      ctx.lineTo(center.x + 7 * view.scale, center.y);
      ctx.stroke();
    } else if (type === "plant") {
      drawBox(x, z, 27, 26, 17, { top: "#8e6546", sideA: "#654935", sideB: "#57442e" });
      const center = project(x + 13, 17, z + 13);
      for (let i = 0; i < 5; i++) {
        const angle = i / 5 * Math.PI * 2 + time / 1800;
        ctx.fillStyle = ["#738d60", "#607f58", "#93a26e"][i % 3];
        ctx.beginPath();
        ctx.ellipse(center.x + Math.cos(angle) * 6 * view.scale, center.y - 7 * view.scale - Math.sin(angle) * 4 * view.scale,
          5 * view.scale, 3.4 * view.scale, angle, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (type === "bench") {
      drawBox(x, z, 58, 18, 14, { top: "#ad8152", sideA: "#76553a", sideB: "#5e4933" });
      drawBox(x + 6, z + 4, 6, 6, 34, { top: "#987147", sideA: "#644d35", sideB: "#56432f" });
      drawBox(x + 46, z + 4, 6, 6, 34, { top: "#987147", sideA: "#644d35", sideB: "#56432f" });
    }
  }

  return { drawStall: drawStall, drawHuman: drawHuman, drawProp: drawProp };
}
