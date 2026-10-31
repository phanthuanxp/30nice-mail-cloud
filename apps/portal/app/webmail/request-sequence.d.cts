export class RequestSequence {
  begin(): number;
  isCurrent(sequence: number): boolean;
  invalidate(): void;
}

