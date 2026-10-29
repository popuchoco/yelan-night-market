import { boot } from "./game.js";

if (typeof document !== "undefined") {
  try {
    boot();
  } catch (error) {
    console.error("Unable to boot 夜嵐夜市", error);
    const saveLabel = document.getElementById("saveLabel");
    if (saveLabel) saveLabel.textContent = "遊戲啟動失敗・請重新整理";
    const toast = document.getElementById("toast");
    if (toast) {
      toast.textContent = "夜市暫時無法載入，請重新整理頁面。";
      toast.classList.add("show");
    }
  }
}
