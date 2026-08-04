import type { Point } from '../dragger-runtime-types';
import type { DefaultUxModule } from '../ux-module';

// Optional module shipped for hosts that want edge auto-scroll.
// Not imported by Runtime; host registers it via ux: { modules: [autoScroll(...)] }.

export type AutoScrollConfig = {
    edgeZonePx: number;
    maxSpeedPx: number;
};

export type ScrollPort = {
    nudge(point: Point, cfg: AutoScrollConfig): void;
};

const TICK_MS = 16;

export function autoScroll(port: ScrollPort, config: AutoScrollConfig | (() => AutoScrollConfig)): DefaultUxModule {
    const cfg = () => (typeof config === 'function' ? config() : config);
    let tick: ReturnType<typeof setInterval> | null = null;
    let point: Point | null = null;

    const nudge = () => {
        if (point === null) return;
        const active = cfg();
        if (active.edgeZonePx <= 0 || active.maxSpeedPx <= 0) return;
        port.nudge(point, active);
    };

    const start = () => {
        stop();
        tick = setInterval(nudge, TICK_MS);
    };

    const stop = () => {
        if (tick !== null) {
            clearInterval(tick);
            tick = null;
        }
    };

    return {
        name: 'auto-scroll',
        onDragStart(ctx) {
            point = ctx.point;
            start();
            nudge();
        },
        onDragMove(ctx) {
            point = ctx.point;
            nudge();
        },
        onDragEnd: stop,
        onCancel: stop,
        destroy: stop,
    };
}
