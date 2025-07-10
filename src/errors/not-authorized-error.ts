export class NotAuthorizedError extends Error {
  public readonly statusCode = 401;
  public readonly name = "NotAuthorizedError";

  constructor(message = "Not authorized") {
    super(message);
    Object.setPrototypeOf(this, NotAuthorizedError.prototype);
  }
}
