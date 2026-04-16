import { Clock } from "./clock";

export type CharId = {
    clientId: string;
    clock: Clock;
}

export type CharNode = {
    id: CharId;
    value: string;
    deleted: boolean;
}

export type InsertOp = {
    char: CharNode;
    positionId: CharId | null;
}

export type DeleteOp = {
    charId: CharId;
}

export type DocumentState = {
    chars: CharNode[];
}

export type CrdtOperation = InsertOp | DeleteOp;
