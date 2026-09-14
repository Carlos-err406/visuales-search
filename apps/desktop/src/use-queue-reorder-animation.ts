import { useLayoutEffect, useRef, type RefObject } from "react";

type RowPosition = { top: number; width: number; height: number; status: string | undefined };
type Snapshot = { scope: string; order: string; rows: Map<string, RowPosition> };

export function useQueueReorderAnimation(container: RefObject<HTMLDivElement | null>, scope: string) {
  const previous = useRef<Snapshot | null>(null);
  const animations = useRef(new Map<HTMLElement, Animation>());

  useLayoutEffect(() => {
    const active = animations.current;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => {
      for (const [element, animation] of active) {
        animation.cancel();
        delete element.dataset.reordering;
      }
      active.clear();
      previous.current = null;
    };
    motion.addEventListener("change", stop);
    return () => {
      motion.removeEventListener("change", stop);
      stop();
    };
  }, []);

  useLayoutEffect(() => {
    const list = container.current;
    const old = previous.current;
    const active = animations.current;
    const rows = new Map<string, RowPosition>();
    const elements = list ? [...list.querySelectorAll<HTMLElement>("[data-transfer-id]")] : [];
    const origin = list ? list.getBoundingClientRect().top - list.scrollTop : 0;
    const shifts = new Map<HTMLElement, number>();
    for (const element of elements) {
      const shift = active.has(element) ? new DOMMatrixReadOnly(getComputedStyle(element).transform).m42 : 0;
      const rect = element.getBoundingClientRect();
      shifts.set(element, shift);
      rows.set(element.dataset.transferId!, {
        top: rect.top - origin - shift,
        width: element.offsetWidth,
        height: element.offsetHeight,
        status: element.dataset.transferStatus,
      });
    }
    const order = JSON.stringify([...rows.keys()]);
    previous.current = { scope, order, rows };
    // Animate only permutations of the same visible rows, not filtering, resizing, or status changes.
    const sameRows =
      old?.scope === scope &&
      old.rows.size === rows.size &&
      [...rows].every(([id, row]) => {
        const before = old.rows.get(id);
        return before && before.status === row.status && before.width === row.width && before.height === row.height;
      });
    if (sameRows && old.order === order) return;
    const animate = sameRows && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const [element, animation] of active) {
      animation.cancel();
      delete element.dataset.reordering;
    }
    active.clear();
    if (!animate) return;
    for (const element of elements) {
      const id = element.dataset.transferId!;
      // Include an unfinished slide so rapid reorders do not jump back to their last target.
      const delta = old.rows.get(id)!.top + shifts.get(element)! - rows.get(id)!.top;
      if (Math.abs(delta) < 0.5) continue;
      element.dataset.reordering = "true";
      const animation = element.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], {
        duration: 240,
        easing: "cubic-bezier(0.2, 0, 0, 1)",
      });
      active.set(element, animation);
      animation.onfinish = () => {
        if (active.get(element) !== animation) return;
        active.delete(element);
        delete element.dataset.reordering;
      };
    }
  });
}
