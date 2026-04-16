export type CharId = {
    clientId: string;
    clock: number;
}

export type CharNode = {
    id: CharId;
    afterId: CharId | null,
    value: string;
    deleted: boolean;
}

export type InsertOp = {
    type: "insert",
    char: CharNode;
    afterId: CharId | null;
}

export type DeleteOp = {
    type: "delete",
    charId: CharId;
}

export type InsertWireOp = {
    type: "insert";
    id: CharId;
    afterId: CharId | null;
    char: string;
};

export type DeleteWireOp = {
    type: "delete";
    id: CharId;
};

export type DocumentState = CharNode[];

export type CrdtOperation = InsertOp | DeleteOp;
export type CrdtWireOperation = InsertWireOp | DeleteWireOp;
