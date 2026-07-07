import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcRoot = join(process.cwd(), 'src');
const pipelineRoot = join(srcRoot, 'pipeline');
const runtimeRoot = join(srcRoot, 'runtime');

function collectTsFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            files.push(...collectTsFiles(path));
            continue;
        }
        if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.test-helpers.ts')) {
            files.push(path);
        }
    }
    return files;
}

function readHeadlessProductionFiles(): Array<{ rel: string; text: string }> {
    return [
        ...collectTsFiles(pipelineRoot),
        ...collectTsFiles(runtimeRoot),
    ].map((path) => ({
        rel: relative(process.cwd(), path).replace(/\\/g, '/'),
        text: readFileSync(path, 'utf8'),
    }));
}

describe('headless architecture boundaries', () => {
    it('keeps headless interaction use-cases as top-level folders', () => {
        const headlessDirs = ['pipeline', 'runtime'].filter((entry) => statSync(join(srcRoot, entry)).isDirectory())
            .sort();
        expect(headlessDirs).toEqual([
            'pipeline',
            'runtime',
        ]);
    });

    it('does not import host/platform/plugin APIs from headless production code', () => {
        const offenders = readHeadlessProductionFiles()
            .filter((file) => /from ['"](?:@codemirror\/|obsidian|\.\.\/\.\.\/platform\/|\.\.\/platform\/|\.\.\/\.\.\/plugin\/|\.\.\/plugin\/)/.test(file.text))
            .map((file) => file.rel);
        expect(offenders).toEqual([]);
    });

    it('does not keep host DOM/event types in headless production code', () => {
        const forbidden = /\b(?:EditorView|HTMLElement|PointerEvent|MouseEvent|KeyboardEvent|FocusEvent|TouchEvent|DOMRect|clientX|clientY)\b|(?<!options\.)\bdocument\.|\bwindow\.|view\.dispatch|\bdispatch\s*\(|addEventListener|removeEventListener|querySelector|classList|getBoundingClientRect/;
        const offenders = readHeadlessProductionFiles()
            .filter((file) => forbidden.test(file.text))
            .map((file) => file.rel);
        expect(offenders).toEqual([]);
    });

    it('keeps platform resolution and command execution contracts out of headless production code', () => {
        const forbidden = /\b(?:DropValidationResult|MoveBlockCommand|BlockTransaction|applyMoveCommand|applyBlockTransaction|renderDropPreviewAtPoint|performDropAtPoint)\b/;
        const offenders = readHeadlessProductionFiles()
            .filter((file) => forbidden.test(file.text))
            .map((file) => file.rel);
        expect(offenders).toEqual([]);
    });

    it('does not keep the legacy drag folder', () => {
        expect(() => statSync(join(srcRoot, 'drag'))).toThrow();
    });

    it('does not keep old UI/source/move folders under headless layers', () => {
        const forbidden = [
            'cleanup',
            'drop',
            'effects',
            'input',
            'intent',
            'lifecycle',
            'mode',
            'preview',
            'source',
            'move',
            'state',
        ];
        const existing = forbidden
            .flatMap((dir) => [join(pipelineRoot, dir), join(runtimeRoot, dir)])
            .filter((path) => {
                try {
                    return statSync(path).isDirectory();
                } catch {
                    return false;
                }
            })
            .map((path) => relative(srcRoot, path).replace(/\\/g, '/'));
        expect(existing).toEqual([]);
    });

    it('keeps runtime input as headless points instead of host events', () => {
        const runtimeTypes = readFileSync(join(runtimeRoot, 'dragger-runtime-types.ts'), 'utf8');
        expect(runtimeTypes).toContain('point: DragPoint');
        expect(runtimeTypes).toContain('sourceLineFromInput(input: DraggerPressInput): number | null');
        expect(runtimeTypes).not.toMatch(/\bDraggerPressZone\b|\bDraggerPressTarget\b|\bzone:\b|\bskipLongPress\b|\bpassiveSelection\?:/);
    });
});
