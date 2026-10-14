// Проброс CDP: 0.0.0.0:9223 → 127.0.0.1:9222 внутри netns браузера (Chrome слушает только localhost).
import net from "node:net";
net.createServer((c) => { const u = net.connect(9222, "127.0.0.1"); c.pipe(u).pipe(c); c.on("error", () => u.destroy()); u.on("error", () => c.destroy()); }).listen(9223, "0.0.0.0");
