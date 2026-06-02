import { createApp } from "vue";
import { createPinia } from "pinia";
import codicons from "@vscode/codicons/dist/codicon.css?inline";
import "#webview/style.css";
import App from "#webview/App.vue";

const codiconStyle = document.createElement("style");
codiconStyle.textContent = codicons.replace(/@font-face\s*{[^}]*}/, "");
document.head.append(codiconStyle);

createApp(App).use(createPinia()).mount("#webview");
