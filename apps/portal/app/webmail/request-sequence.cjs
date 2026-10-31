class RequestSequence {
  constructor() {
    this.current = 0;
  }

  begin() {
    this.current += 1;
    return this.current;
  }

  isCurrent(sequence) {
    return sequence === this.current;
  }

  invalidate() {
    this.current += 1;
  }
}

module.exports = { RequestSequence };

