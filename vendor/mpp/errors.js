// Read error with a stable code (for tests and UI) and an English message for the user.
export class MppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MppError';
    this.code = code;
  }
}
