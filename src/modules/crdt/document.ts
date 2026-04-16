import { CharId, CharNode, CrdtOperation, DocumentState } from "./types";

export const SENTINEL_ID: CharId = { clientId: "__root__", clock: 0 };

export class CrdtDocument {
    private nodes: CharNode[] = [
        {
            id:      SENTINEL_ID,
            afterId: null,
            value:   "",
            deleted: true,  
        },
    ];

    insert(op: { char: CharNode; afterId: CharId | null }): void {
        const targetId = op.afterId ?? SENTINEL_ID;

        const afterIndex = this.findIndex(targetId);
        if (afterIndex === -1) {
            this.nodes.push(op.char);
            return;
        }

        let insertAt = afterIndex + 1;

        while (insertAt < this.nodes.length) {
            const candidate = this.nodes[insertAt];

            if (!this.idsEqual(candidate.afterId ?? SENTINEL_ID, targetId)) {
                break;
            }

            if (candidate.id.clock > op.char.id.clock) {
                break;
            }
            if (candidate.id.clock < op.char.id.clock) {
                insertAt++;
                continue;
            }

            if (candidate.id.clientId < op.char.id.clientId) {
                break;
            }

            insertAt++;
        }

        this.nodes.splice(insertAt, 0, op.char);
    }


    delete(charId: CharId): void {
        const node = this.findNode(charId);
        if (node) {
            node.deleted = true;
        }
    }

    merge(ops: CrdtOperation[]): void {
        const sorted = [...ops].sort((a, b) => {
            const clockA = a.type === "insert" ? a.char.id.clock : 0;
            const clockB = b.type === "insert" ? b.char.id.clock : 0;
            return clockA - clockB;
        });

        for (const op of sorted) {
            if (op.type === "insert") {
                this.insert({ char: op.char, afterId: op.afterId });
            } else {
                this.delete(op.charId);
            }
        }
    }

    toText(): string {
        return this.nodes
            .filter(n => !n.deleted)
            .map(n => n.value)
            .join("");
    }

    toState(): DocumentState {
        return [...this.nodes];
    }

    static fromState(state: DocumentState): CrdtDocument {
        const doc = new CrdtDocument();
        doc.nodes = [...state];
        return doc;
    }

    private findIndex(id: CharId): number {
        return this.nodes.findIndex(n => this.idsEqual(n.id, id));
    }

    private findNode(id: CharId): CharNode | undefined {
        return this.nodes.find(n => this.idsEqual(n.id, id));
    }

    private idsEqual(a: CharId, b: CharId): boolean {
        return a.clientId === b.clientId && a.clock === b.clock;
    }
}