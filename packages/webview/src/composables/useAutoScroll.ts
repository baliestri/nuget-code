import { nextTick, type Ref } from "vue";

export function useAutoScroll(panel: Ref<HTMLElement | undefined>) {
  async function scrollToEnd(): Promise<void> {
    await nextTick();
    if (!panel.value) {
      return;
    }
    panel.value.scrollTop = panel.value.scrollHeight;
  }

  return { scrollToEnd };
}
