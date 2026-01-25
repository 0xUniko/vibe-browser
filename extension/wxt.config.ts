import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "vibe-browser",
    description: "vibe browsing!",
    permissions: ["debugger", "tabGroups", "storage", "alarms"],
    host_permissions: ["<all_urls>"],
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      96: "icon/96.png",
      128: "icon/128.png",
    },
  },
});
