export type InsertOp = {
  type:     "insert";
  position: number;   
  text:     string;   
};

export type DeleteOp = {
  type:     "delete";
  position: number;   
  length:   number;   
};

export type Operation = InsertOp | DeleteOp;