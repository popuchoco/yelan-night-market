// Canvas object renderers live apart from scene projection and frame orchestration.
const MAIN_STALL_VISUALS = Object.freeze({
  mobile: Object.freeze({ width: 0, depth: 0, height: 0, lanterns: 0, smoke: 0 }),
  fixed: Object.freeze({ width: 30, depth: 14, height: 24, lanterns: 2, smoke: 1 }),
  dapaidang: Object.freeze({ width: 58, depth: 28, height: 42, lanterns: 3, smoke: 2 })
});

const MAIN_TIER_LEVEL = Object.freeze({ mobile: 0, fixed: 1, dapaidang: 2 });

/** Return geometry derived from existing progress; no scene coordinates are stored in the save. */
export function getStallVisualProfile(stall, state) {
  if (!stall?.main) return { ...stall, tierLevel: 0, expansions: 0, lanternCount: 2, smokeCount: 0 };
  const mainOutlet = (state.outlets || []).find(function(outlet) { return outlet.id === "main"; });
  const tier = MAIN_STALL_VISUALS[mainOutlet?.tier] ? mainOutlet.tier : "mobile";
  const tierVisual = MAIN_STALL_VISUALS[tier];
  const tierLevel = MAIN_TIER_LEVEL[tier];
  const expansions = Math.max(0, Math.min(9, Math.floor(Number(state.expansions) || 0)));
  const widthGain = tierVisual.width + expansions * 5;
  const depthGain = tierVisual.depth + expansions * 3;
  return {
    ...stall,
    x: stall.x - widthGain / 2,
    z: stall.z - depthGain / 2,
    w: stall.w + widthGain,
    d: stall.d + depthGain,
    h: stall.h + tierVisual.height,
    tier,
    tierLevel,
    expansions,
    lanternCount: 3 + tierVisual.lanterns + Math.floor(expansions / 3),
    smokeCount: 3 + tierVisual.smoke + Math.floor(expansions / 3)
  };
}

/** Split a stall's support posts into the two farther and two nearer to the active camera. */
export function splitStallSupportPosts(stall, depthAt) {
  const posts = [
    { index: 0, x: stall.x + 5, z: stall.z + 3 },
    { index: 1, x: stall.x + stall.w - 8, z: stall.z + 3 },
    { index: 2, x: stall.x + 5, z: stall.z + stall.d - 21 },
    { index: 3, x: stall.x + stall.w - 8, z: stall.z + stall.d - 21 }
  ].sort(function(a, b) {
    return depthAt(a.x + 3.5, a.z + 3.5) - depthAt(b.x + 3.5, b.z + 3.5);
  });
  return { rear: posts.slice(0, 2), front: posts.slice(2) };
}

export function createObjectRenderer(api) {
  const {
    ctx, view, project, cameraDepth, pathPolygon, drawBox, drawRoundRect, drawBillboard,
    state, DATA, onStallBounds, recordActorHit
  } = api;
  const knownOutletIds = new Set((state.outlets || []).filter(function(outlet) { return outlet.id !== "main"; }).map(function(outlet) { return outlet.id; }));
  const takeoverStartedAt = new Map();
  const reduceMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function drawStall(stall, time) {
    const scale = view.scale;
    const renderStall = getStallVisualProfile(stall, state);
    const supportPosts = splitStallSupportPosts(renderStall, cameraDepth);
    const acquiredOutlets = (state.outlets || []).filter(function(item) { return item.id !== "main"; });
    const availableStalls = DATA.stalls.filter(function(item) { return !item.main; });
    const claimedStalls = [];
    const acquiredStalls = acquiredOutlets.map(function(outlet) {
      let index = availableStalls.findIndex(function(item, candidate) {
        return !claimedStalls.includes(candidate) && item.id === outlet.type;
      });
      if (index < 0 && (outlet.type === "food" || outlet.type === "leisure")) {
        index = availableStalls.findIndex(function(item, candidate) {
          return !claimedStalls.includes(candidate) && (outlet.type === "leisure" ? item.id === "toy" : item.id !== "toy");
        });
      }
      if (index < 0) index = availableStalls.findIndex(function(item, candidate) { return !claimedStalls.includes(candidate); });
      if (index < 0) return null;
      claimedStalls.push(index);
      return availableStalls[index];
    }).filter(Boolean);
    const acquiredIndex = acquiredStalls.findIndex(function(item) { return item.id === stall.id; });
    const outlet = acquiredIndex >= 0 ? acquiredOutlets[acquiredIndex] : null;
    if (outlet && !knownOutletIds.has(outlet.id)) {
      knownOutletIds.add(outlet.id);
      takeoverStartedAt.set(outlet.id, time);
    }
    const inheritedAlpha = typeof ctx.globalAlpha === "number" ? ctx.globalAlpha : 1;
    const renderAlpha = inheritedAlpha * (stall.main || acquiredIndex >= 0 ? 1 : 0.78);
    ctx.save();
    ctx.globalAlpha = renderAlpha;
    if (acquiredIndex >= 0) {
      const territory = [
        project(renderStall.x - 12, 1, renderStall.z - 12),
        project(renderStall.x + renderStall.w + 12, 1, renderStall.z - 12),
        project(renderStall.x + renderStall.w + 12, 1, renderStall.z + renderStall.d + 14),
        project(renderStall.x - 12, 1, renderStall.z + renderStall.d + 14)
      ];
      pathPolygon(territory, "#d7b76a0a", "#d7b76a70", Math.max(1, 1.3 * scale));
    }
    const shadow = [
      project(renderStall.x - 18, 0, renderStall.z - 14),
      project(renderStall.x + renderStall.w + 18, 0, renderStall.z - 14),
      project(renderStall.x + renderStall.w + 18, 0, renderStall.z + renderStall.d + 20),
      project(renderStall.x - 18, 0, renderStall.z + renderStall.d + 20)
    ];
    pathPolygon(shadow, "#1017174d");
    function drawSupportPost(post) {
      drawBox(post.x, post.z, 7, 7, renderStall.h + 8, {
        top: "#dfbd82", sideA: "#765a3b", sideB: "#503f31", stroke: "#30291f"
      });
    }
    supportPosts.rear.forEach(drawSupportPost);
    drawBox(renderStall.x, renderStall.z, renderStall.w, renderStall.d, renderStall.h * 0.53, {
      top: "#73593e", sideA: "#5d4734", sideB: "#4d4033", stroke: "#312b2366"
    });
    drawBox(renderStall.x + 16, renderStall.z + 11, renderStall.w - 32, renderStall.d - 52, renderStall.h, {
      top: renderStall.roof, sideA: "#79593e", sideB: "#5c4734", stroke: "#32292099"
    });
    drawBox(renderStall.x + 8, renderStall.z + renderStall.d - 51, renderStall.w - 16, 34, 48, {
      top: "#d1a46b", sideA: "#8f6040", sideB: "#684b37", stroke: "#342b2399"
    });
    drawBox(renderStall.x + renderStall.w * 0.44, renderStall.z + renderStall.d - 45, renderStall.w * 0.12, 42, 52, {
      top: "#845536", sideA: "#6d472f", sideB: "#543b2c"
    });

    const roofY = renderStall.h + 7;
    const a = project(renderStall.x - 7, roofY, renderStall.z - 8);
    const b = project(renderStall.x + renderStall.w + 7, roofY, renderStall.z - 8);
    const c = project(renderStall.x + renderStall.w + 7, roofY, renderStall.z + renderStall.d + 4);
    const d = project(renderStall.x - 7, roofY, renderStall.z + renderStall.d + 4);
    pathPolygon([a, b, c, d], renderStall.roof, "#251f1a99", 1);
    const stripes = stall.main ? 8 : 6;
    for (let k = 0; k < stripes; k++) {
      if (k % 2 !== 0) continue;
      const x1 = renderStall.x - 7 + (renderStall.w + 14) * k / stripes;
      const x2 = renderStall.x - 7 + (renderStall.w + 14) * (k + 1) / stripes;
      pathPolygon([
        project(x1, roofY, renderStall.z + renderStall.d + 1),
        project(x2, roofY, renderStall.z + renderStall.d + 1),
        project(x2, roofY - (renderStall.main && renderStall.tierLevel ? 18 : 23), renderStall.z + renderStall.d + 4),
        project(x1, roofY - (renderStall.main && renderStall.tierLevel ? 18 : 23), renderStall.z + renderStall.d + 4)
      ], stall.main ? "#f0d69b" : "#e4d2a0");
    }

    if (renderStall.main && renderStall.tierLevel >= 1) {
      // A framed valance and wider service glazing distinguish a fixed shop from a cloth cart.
      const fascia = [
        project(renderStall.x - 3, roofY - 18, renderStall.z + renderStall.d + 4),
        project(renderStall.x + renderStall.w + 3, roofY - 18, renderStall.z + renderStall.d + 4),
        project(renderStall.x + renderStall.w + 3, roofY - 5, renderStall.z + renderStall.d + 4),
        project(renderStall.x - 3, roofY - 5, renderStall.z + renderStall.d + 4)
      ];
      pathPolygon(fascia, "#874d3e", "#e7c780", Math.max(1, scale));
    }
    if (renderStall.main && renderStall.tierLevel >= 2) {
      // The daipaidang tier gains a covered side counter, not just a taller roof.
      const wingZ0 = renderStall.z + renderStall.d * 0.28;
      const wingZ1 = renderStall.z + renderStall.d * 0.72;
      pathPolygon([
        project(renderStall.x + renderStall.w - 10, renderStall.h + 3, wingZ0),
        project(renderStall.x + renderStall.w + 42, renderStall.h + 3, wingZ0),
        project(renderStall.x + renderStall.w + 42, renderStall.h + 3, wingZ1),
        project(renderStall.x + renderStall.w - 10, renderStall.h + 3, wingZ1)
      ], "#a94f44", "#efd08a", Math.max(1, 1.2 * scale));
      drawBox(renderStall.x + renderStall.w - 9, renderStall.z + renderStall.d * 0.29, 34, renderStall.d * 0.42, 38, {
        top: "#d3a36a", sideA: "#986341", sideB: "#694934", stroke: "#392b2199"
      });
      drawBox(renderStall.x + renderStall.w + 34, wingZ0 + 2, 6, 6, renderStall.h * 0.76, {
        top: "#e0bd81", sideA: "#806040", sideB: "#604832"
      });
      drawBox(renderStall.x + renderStall.w + 34, wingZ1 - 8, 6, 6, renderStall.h * 0.76, {
        top: "#e0bd81", sideA: "#806040", sideB: "#604832"
      });
    }

    // Draw the two camera-near posts after the roof so supports never cut through its far edge.
    for (let rib = 1; rib < 4; rib++) {
      const start = project(renderStall.x + renderStall.w * rib / 4, renderStall.h + 9, renderStall.z - 5);
      const end = project(renderStall.x + renderStall.w * rib / 4, renderStall.h + 9, renderStall.z + renderStall.d + 5);
      ctx.strokeStyle = "#f0d59b99";
      ctx.lineWidth = Math.max(1, 1.3 * scale);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
    supportPosts.front.forEach(drawSupportPost);
    const window = project(renderStall.x + renderStall.w * 0.45, renderStall.h * 0.63, renderStall.z + renderStall.d * 0.43);
    const windowWidth = 34 + renderStall.tierLevel * 14;
    drawRoundRect(window.x - windowWidth / 2 * scale, window.y - 12 * scale, windowWidth * scale, 21 * scale, 4 * scale, "#e8bd70", "#ffe3a477");
    ctx.fillStyle = "#41564a";
    ctx.fillRect(window.x - (windowWidth / 2 - 4) * scale, window.y - 9 * scale, (windowWidth - 8) * scale, 15 * scale);

    if (stall.main) {
      const grill = project(renderStall.x + renderStall.w * 0.68, renderStall.h * 0.55, renderStall.z + renderStall.d * 0.70);
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
      for (let smoke = 0; smoke < renderStall.smokeCount; smoke++) {
        const phase = (time / 900 + smoke * 0.34) % 1;
        const smokePoint = project(
          renderStall.x + renderStall.w * 0.68 + Math.sin(time / 650 + smoke) * 11 * phase,
          renderStall.h * 0.55 + 16 + phase * 70,
          renderStall.z + renderStall.d * 0.70
        );
        ctx.globalAlpha = renderAlpha * (1 - phase) * 0.34;
        ctx.fillStyle = "#e4e8d5";
        ctx.beginPath();
        ctx.ellipse(smokePoint.x, smokePoint.y, 3 * scale + phase * 6 * scale, 4 * scale + phase * 5 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = renderAlpha;
      }
      // Expansion decisions become visible in the 2.5D map as outdoor tables.
      const tables = renderStall.expansions;
      for (let table = 0; table < tables; table++) {
        const tableColumn = table % 3;
        const tableRow = Math.floor(table / 3);
        const columnsInRow = Math.min(3, tables - tableRow * 3);
        const rowWidth = columnsInRow * 58 - 18;
        const tableX = renderStall.x + (renderStall.w - rowWidth) / 2 + tableColumn * 58;
        const tableZ = renderStall.z + renderStall.d + 29 + tableRow * 42;
        drawBox(tableX, tableZ, 40, 30, 17, {
          top: "#c89a61", sideA: "#8c6242", sideB: "#694a37", stroke: "#342b2399"
        });
        drawBox(tableX + 2, tableZ + 32, 9, 9, 12, {
          top: "#e2bd82", sideA: "#806040", sideB: "#644b37"
        });
        drawBox(tableX + 29, tableZ + 32, 9, 9, 12, {
          top: "#e2bd82", sideA: "#806040", sideB: "#644b37"
        });
      }
    }

    const sign = project(renderStall.x + renderStall.w / 2, renderStall.h + 31, renderStall.z + renderStall.d * 0.43);
    drawBillboard(sign, stall.name, !!stall.main, stall.roof);
    if (!stall.main) {
      if (acquiredIndex >= 0) {
        const outletStatus = outlet?.autoPaused ? "補" : (outlet?.efficiencyPenalty ? "修" : (outlet?.nextNightBonus ? "+" : (outlet?.manager ? "店" : (outlet?.active ? "營" : "休"))));
        const statusFill = outlet?.autoPaused ? "#d96d52" : (outlet?.efficiencyPenalty ? "#d6ad56" : (outlet?.nextNightBonus ? "#76a77e" : "#d8b665"));
        drawRoundRect(sign.x + 27 * scale, sign.y - 15 * scale, 16 * scale, 16 * scale, 5 * scale, statusFill, "#fff0ba");
        ctx.fillStyle = outletStatus === "補" || outletStatus === "修" ? "#fff5df" : "#332d20";
        ctx.font = "800 " + Math.max(8, 9 * scale) + "px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(outletStatus, sign.x + 27 * scale, sign.y - 14 * scale);
        drawRoundRect(sign.x - 32 * scale, sign.y + 12 * scale, 64 * scale, 14 * scale, 4 * scale, "#173b35", "#d7b76a");
        ctx.fillStyle = "#f3dca0";
        ctx.font = "800 " + Math.max(7, 8 * scale) + "px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("夜嵐旗下", sign.x, sign.y + 19 * scale);

        const startedAt = takeoverStartedAt.get(outlet.id);
        const elapsed = typeof startedAt === "number" ? time - startedAt : Infinity;
        if (!reduceMotion && elapsed >= 0 && elapsed < 1200) {
          const progress = elapsed / 1200;
          ctx.save();
          ctx.globalAlpha = renderAlpha * (1 - progress);
          const cueY = sign.y - (33 + progress * 18) * scale;
          drawRoundRect(sign.x - 43 * scale, cueY - 8 * scale, 86 * scale, 16 * scale, 6 * scale, "#173b35", "#f0d28a");
          ctx.fillStyle = "#f7e2ae";
          ctx.font = "800 " + Math.max(7, 8 * scale) + "px system-ui";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("新攤・已接手", sign.x, cueY);
          ctx.restore();
          ctx.globalAlpha = renderAlpha;
        } else if (typeof startedAt === "number") {
          takeoverStartedAt.delete(outlet.id);
        }
      }
    }
    const lanternCount = stall.main ? renderStall.lanternCount : 2;
    for (let lantern = 0; lantern < lanternCount; lantern++) {
      const x = renderStall.x + renderStall.w * (0.2 + lantern * (0.6 / (lanternCount - 1 || 1)));
      const point = project(x, renderStall.h - 10, renderStall.z + renderStall.d + 6);
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
      ctx.globalAlpha = renderAlpha * (0.25 + 0.12 * Math.sin(time / 300 + lantern));
      ctx.beginPath();
      ctx.arc(point.x + sway, point.y + 15 * scale, 13 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = renderAlpha;
    }

    if (stall.main || acquiredIndex >= 0) {
      const corners = [
        project(renderStall.x - 5, renderStall.h + 30, renderStall.z - 10),
        project(renderStall.x + renderStall.w + 5, renderStall.h + 30, renderStall.z - 10),
        project(renderStall.x + renderStall.w + 12, 0, renderStall.z + renderStall.d + 8),
        project(renderStall.x - 12, 0, renderStall.z + renderStall.d + 8)
      ];
      const xs = corners.map(function(point) { return point.x; });
      const ys = corners.map(function(point) { return point.y; });
      onStallBounds({
        left: Math.min.apply(null, xs) - 12, top: Math.min.apply(null, ys) - 12,
        right: Math.max.apply(null, xs) + 12, bottom: Math.max.apply(null, ys) + 12
      }, { type: stall.main ? "main" : "outlet", outletId: outlet?.id || null, outletName: outlet?.name || stall.name });
      if (stall.main && state.phase === "prep") {
        const marker = project(renderStall.x + renderStall.w * 0.5, renderStall.h + 96, renderStall.z + renderStall.d * 0.5);
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
    ctx.restore();
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
