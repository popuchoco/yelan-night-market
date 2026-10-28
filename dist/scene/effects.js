// Night-market event overlays are isolated from persistent world objects.
export function createEffectRenderer(api) {
  const { ctx, view, project, drawBox, drawRoundRect, todayEvent, state, mainStall, getGuestActors } = api;

  function drawEventEffects(time) {
    const event = todayEvent();
    if (event.id === "festival") {
      const center = project(mainStall.x + mainStall.w / 2, mainStall.h + 165, mainStall.z + mainStall.d / 2);
      for (let i = 0; i < 18; i++) {
        const angle = i * 2.399 + time / 2300;
        const radius = (20 + (i % 5) * 14) * view.scale;
        const x = center.x + Math.cos(angle) * radius;
        const y = center.y + Math.sin(angle) * radius * 0.58;
        ctx.globalAlpha = 0.32 + 0.52 * (0.5 + 0.5 * Math.sin(time / 270 + i));
        ctx.fillStyle = i % 3 === 0 ? "#f2d983" : "#ffab70";
        ctx.beginPath();
        ctx.arc(x, y, (i % 3 === 0 ? 2.5 : 1.5) * view.scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (event.id === "rain") {
      ctx.fillStyle = "#a9bec31a";
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.strokeStyle = "#c5d8dc70";
      ctx.lineWidth = 1;
      for (let i = 0; i < 72; i++) {
        const x = (i * 97 + time * 0.22) % view.w;
        const y = (i * 61 + time * 0.48) % view.h;
        ctx.globalAlpha = 0.2 + (i % 4) * 0.08;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 5, y + 13);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 4; i++) {
        const puddle = project(220 + i * 178, 1, 585 + (i % 2) * 88);
        ctx.strokeStyle = "#b7d9d744";
        ctx.beginPath();
        ctx.ellipse(puddle.x, puddle.y, 13 * view.scale + Math.sin(time / 300 + i) * 3, 4 * view.scale, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (event.id === "supplier") {
      const cart = project(835, 0, 832);
      const roll = Math.sin(time / 230) * 1.5 * view.scale;
      ctx.fillStyle = "#463d31";
      ctx.beginPath();
      ctx.ellipse(cart.x, cart.y, 17 * view.scale, 5 * view.scale, 0, 0, Math.PI * 2);
      ctx.fill();
      drawBox(800, 800, 54, 34, 36, { top: "#c99a60", sideA: "#966a43", sideB: "#735438" });
      ctx.fillStyle = "#f3ddab";
      ctx.font = Math.max(8, 10 * view.scale) + "px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("漁貨", cart.x + roll, cart.y - 23 * view.scale);
    }
    if (event.id === "complaint" && state.phase === "service") {
      const guest = getGuestActors()[state.customerIndex];
      if (guest) {
        const point = project(guest.x, 0, guest.z);
        drawRoundRect(point.x + 8 * view.scale, point.y - 52 * view.scale, 70 * view.scale, 22 * view.scale,
          7 * view.scale, "#fff0d8", "#dc8766");
        ctx.fillStyle = "#9c553f";
        ctx.font = "800 " + Math.max(7, 8 * view.scale) + "px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("等太久了！", point.x + 43 * view.scale, point.y - 41 * view.scale);
      }
    }
    if (event.id === "inspection") {
      const x = mainStall.x + mainStall.w + 18;
      const z = mainStall.z + mainStall.d * 0.62;
      drawBox(x, z, 12, 10, 27, { top: "#d4b77e", sideA: "#78877a", sideB: "#596c61", stroke: "#263630" });
      const head = project(x + 6, 37, z + 4);
      ctx.fillStyle = "#deb597";
      ctx.beginPath();
      ctx.arc(head.x, head.y, Math.max(4, 5 * view.scale), 0, Math.PI * 2);
      ctx.fill();
      drawRoundRect(head.x + 7 * view.scale, head.y - 23 * view.scale, 74 * view.scale, 21 * view.scale,
        7 * view.scale, "#f2e8cf", "#d8bd79");
      ctx.fillStyle = "#465447";
      ctx.font = "800 " + Math.max(7, 8 * view.scale) + "px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("設備巡查", head.x + 44 * view.scale, head.y - 13 * view.scale);
    }
  }

  return drawEventEffects;
}
