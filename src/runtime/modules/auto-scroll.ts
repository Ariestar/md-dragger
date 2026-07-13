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

export function autoScroll(
    port: ScrollPort,
    config: AutoScrollConfig | (() => AutoScrollConfig),
): DefaultUxModule {
    const cfg = () => (typeof config === 'function' ? config() : config);
    return {
        name: 'auto-scroll',
        onDragMove(ctx) {
            const active = cfg();
            if (active.edgeZonePx <= 0 || active.maxSpeedPx <= 0) return;
            port.nudge(ctx.point, active);
        },
    };
}
