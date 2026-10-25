// Warm a heavy surface on INTENT instead of on click.
//
// The DOM audit moved construction out of boot and into the first open — which is right
// for what a page costs at rest, but it puts the whole build inside the click for anything
// expensive (a hundred-row list, a template set, an indicator library). The pointer
// already tells us what is about to happen: it RESTS on a trigger for a few hundred
// milliseconds before the click lands. This helper spends that idle time on the build, so
// the click itself only opens something that already exists.
//
// Rules that keep it "on demand" and not "eager by hover":
//   • a pointer merely passing over the bar must build nothing — `delay` is honoured and
//     a leave cancels the queued warm;
//   • no pointer at all (keyboard): focus IS the intent, so it warms immediately;
//   • the warm callback must be idempotent — it can run once per trigger, and again after
//     a destroy/re-create, but never twice on the same surface.
export function warmOnIntent(trigger: HTMLElement, warm: () => void, delay = 120): () => void {
    const win = trigger.ownerDocument.defaultView;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };
    const run = (): void => {
        cancel();
        warm();
    };
    const enter = (): void => {
        cancel();
        timer = setTimeout(run, delay);
    };
    const down = (): void => run(); // a press is intent with no lead time (touch included)
    // CAPTURE phase: this runs before the widget's own click handler, so a surface that is
    // opened BY a click is already built when that handler opens it. Without it the build
    // lands one microtask later, and the first frame of the open shows an empty surface.
    const click = (): void => run();
    trigger.addEventListener('pointerenter', enter);
    trigger.addEventListener('pointerleave', cancel);
    trigger.addEventListener('pointerdown', down);
    trigger.addEventListener('focus', run);
    trigger.addEventListener('click', click, true);
    return () => {
        cancel();
        trigger.removeEventListener('pointerenter', enter);
        trigger.removeEventListener('pointerleave', cancel);
        trigger.removeEventListener('pointerdown', down);
        trigger.removeEventListener('focus', run);
        trigger.removeEventListener('click', click, true);
    };
}
