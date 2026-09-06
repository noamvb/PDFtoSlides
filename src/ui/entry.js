/** Browser entry point: start the app once the DOM is parsed. */
import { start } from "./app.js";

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { start(); }, { once: true });
} else {
  start();
}
