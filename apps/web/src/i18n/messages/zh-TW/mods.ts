import type { modsEn } from "../en/mods";

export const modsZhTW: Readonly<Record<keyof typeof modsEn, string>> = {
  "mods.panel.title": "Mods",
  "mods.panel.empty": "這個對話串目前沒有開啟的 Mod 窗格。",
  "mods.panel.emptyHint":
    "你安裝的 Claude Code Mods 會在對話串的工作階段執行時，於此顯示它們的窗格。",
  "mods.panel.inactive": "這個對話串的 Claude 工作階段執行時，Mods 會顯示在這裡。",
  "mods.panel.unsupported":
    "這個對話串的代理程式不支援 Mods。請將 Claude Code 更新到支援 Mods 的版本，即可在此看到。",
  "mods.panel.serverUnsupported": "請更新此環境的 T3 Code 伺服器，才能看到 Claude Code Mods。",
  "mods.panel.notDrawn": "尚未繪製任何內容。",
  "mods.panel.from": "來自 {plugin}",
  "mods.panel.closePane": "關閉 {title}",
  "mods.element.unsupported": "這裡尚不支援 {element}。",
  "mods.band.label": "來自你的 Mods",
  "mods.commandPalette.toggle": "切換 Mods 面板",
};
